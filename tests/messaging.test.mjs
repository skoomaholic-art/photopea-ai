import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas} from '@napi-rs/canvas';
import {initializeCanvas,writePsd,readPsd} from 'ag-psd';
import {app,fixture,settle} from './dom-harness.mjs';
initializeCanvas(createCanvas);

// Protocol fake only. It exercises real application messages, not Photopea's engine.
function fakePhotopea(a){
 const {w}=a,frame=a.el('photopeaFrame'),requests=[];let src='about:blank',document=null,hold=false,fail=false,doneFirst=false;
 const emit=(data,origin='https://www.photopea.com')=>{
  if(Object.prototype.toString.call(data)==='[object ArrayBuffer]'){const copy=new w.Uint8Array(data.byteLength);copy.set(new Uint8Array(data));data=copy.buffer;}
  w.dispatchEvent(new w.MessageEvent('message',{source:receiver,origin,data}));
 };
 const receiver={async postMessage(payload,origin){
  assert.equal(origin,'https://www.photopea.com');requests.push(payload);if(hold)return;
  if(fail){fail=false;emit('POSTER_ERROR:'+encodeURIComponent('Ошибка тестового документа'));queueMicrotask(()=>emit('done'));return;}
  if(typeof payload!=='string'){const parsed=readPsd(payload,{skipLayerImageData:true,skipCompositeImageData:true});document={width:parsed.width,height:parsed.height,layers:parsed.children.map(l=>({name:l.name}))};}
  else if(payload.includes('POSTER_LAYERED_MODEL:')){
   document=JSON.parse(decodeURIComponent(payload.match(/POSTER_LAYERED_MODEL:([^*]+)\*\//)[1]));
   emit(`POSTER_LAYERED_READY:${document.workspace}:${document.width}x${document.height}:${document.layers.length}`);
  }else if(payload.includes('saveToOE')){
   if(!document){emit('POSTER_ERROR:'+encodeURIComponent('Нет активного документа'));emit('done');return;}
   let bytes;
   if(payload.includes('psd:true'))bytes=writePsd({width:document.width,height:document.height,children:document.layers.map(l=>({name:l.name}))});
   else {const b=fixture(document.width,document.height,{color:'#284b39'});bytes=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);}
   if(doneFirst){emit('done');await new Promise(r=>setTimeout(r,15));emit(bytes);return;}
   emit(bytes);
  }else if(payload.includes('POSTER_INSPECT:'))emit('POSTER_INSPECT:'+encodeURIComponent(JSON.stringify({width:document.width,height:document.height,layers:document.layers.map(l=>l.name)})));
  queueMicrotask(()=>emit('done'));
 }};
 Object.defineProperty(frame,'contentWindow',{value:receiver});Object.defineProperty(frame,'src',{get:()=>src,set:value=>{src=value;queueMicrotask(()=>emit('done'));}});
 return {requests,emit,get doc(){return document;},set hold(v){hold=v;},set fail(v){fail=v;},set doneFirst(v){doneFirst=v;}};
}

test('Photopea mock: layered ACK, inspect, all return routes, PSD retention and reopening',async t=>{
 const a=await app(t),fake=fakePhotopea(a),P=a.w.PosterApp,B=a.w.PhotopeaBridge;
 await a.file('posterFileInput',fixture(),'poster.png');await a.file('logoFileInput',fixture(300,100,{logo:true}),'logo.png');
 await B.editCurrentPoster();assert.equal(a.el('photopeaWorkspace').hidden,false);assert.ok(B.getContext().layeredReady);assert.equal(a.el('sendPhotopeaVerticalBtn').disabled,false);
 assert.deepEqual(fake.doc.layers.map(l=>l.name),['Background','Постер','Логотип']);assert.equal(fake.doc.width,800);
 const info=await B.inspectActiveDocument();assert.equal(info.width,800);assert.equal(info.layers.length,3);
 fake.doneFirst=true;
 for(const target of ['horizontal','vertical','train','top10']){
  await B.sendBack(target);assert.match(a.el('photopeaStatus').textContent,/Возвращено/);
  const masterId=B.getLayeredMasterId(target);assert.ok(masterId);const stored=await a.w.SkoomaStore.getPhotopeaMaster(masterId);
  const parsed=readPsd(await stored.blob.arrayBuffer(),{skipLayerImageData:true,skipCompositeImageData:true});assert.equal(parsed.children.length,3);
 }
 P.switchWorkspace('vertical');await B.editCurrentPoster();assert.equal(B.getContext().restoredLayeredMaster,true);assert.equal(fake.doc.layers.length,3);
 for(const [w,h,target] of [[800,1200,'vertical'],[1920,1080,'horizontal'],[2952,366,'train'],[800,1400,'top10'],[1600,2800,'top10']])assert.equal(B.classifyDimensions(w,h).target,target);
 assert.equal(B.classifyDimensions(1000,1000),null);assert.deepEqual(a.errors,[]);
});

test('Photopea mock: errors release controls, foreign origin ignored and late replies cannot shift queue',async t=>{
 const a=await app(t),fake=fakePhotopea(a),B=a.w.PhotopeaBridge;
 await a.file('posterFileInput',fixture());fake.fail=true;await assert.rejects(B.editCurrentPoster(),/Ошибка тестового документа/);assert.equal(a.el('sendPhotopeaVerticalBtn').disabled,false);
 await B.editCurrentPoster();fake.hold=true;
 const realTimeout=a.w.setTimeout.bind(a.w);a.w.setTimeout=(fn,ms,...rest)=>realTimeout(fn,ms===30000?20:ms,...rest);
 const command=B.inspectActiveDocument();fake.emit('POSTER_INSPECT:'+encodeURIComponent('{"width":1}'),'https://untrusted.invalid');
 await assert.rejects(command,/не завершила операцию/);fake.emit('done');
 await assert.rejects(B.inspectActiveDocument(),/Перезагрузите/);
 fake.hold=false;await a.click('reloadPhotopeaBtn');await B.editCurrentPoster();assert.ok(B.getContext().layeredReady);assert.deepEqual(a.errors,[]);
});

test('Photopea script has separate layers and guarded transforms; no external window.open',async t=>{
 const a=await app(t);await a.file('posterFileInput',fixture());await a.file('logoFileInput',fixture(200,100,{logo:true}));
 await a.input('layerRotationInput',23);const model=await a.w.PosterApp.buildPhotopeaModel(),script=a.w.PhotopeaBridge.buildLayeredScript(model);
 assert.ok(script.includes('app.open('));assert.ok(script.includes(',null,true)'));assert.ok(script.includes('.rotate(23'));assert.ok(script.includes('Логотип'));assert.ok(!script.includes('flatten('));
 const f=fakePhotopea(a);let opened=false;a.w.open=()=>{opened=true;};await a.click('openPhotopeaBtn');assert.equal(opened,false);assert.equal(a.el('photopeaWorkspace').hidden,false);assert.deepEqual(a.errors,[]);
});

test('Photopea tab: missing handshake exits loading, preserves project and retry recovers',async t=>{
 const a=await app(t),P=a.w.PosterApp,B=a.w.PhotopeaBridge;
 await a.file('posterFileInput',fixture());const before=JSON.stringify(P.getState().vertical);
 const frame=a.el('photopeaFrame');let src='about:blank';
 Object.defineProperty(frame,'src',{configurable:true,get:()=>src,set:value=>{src=value;frame.dispatchEvent(new a.w.Event('load'));}});
 const realTimeout=a.w.setTimeout.bind(a.w);a.w.setTimeout=(fn,ms,...rest)=>realTimeout(fn,ms===20000?20:ms,...rest);
 P.switchWorkspace('photopea');
 await assert.rejects(B.load(),/Photopea не ответила/);
 assert.match(a.el('photopeaStatus').textContent,/Макеты сохранены/);
 assert.equal(frame.getAttribute('aria-busy'),'false');
 frame.dispatchEvent(new a.w.Event('load'));
 assert.match(a.el('photopeaStatus').textContent,/не ответила/,'late load cannot restore eternal loading status');
 assert.equal(JSON.stringify(P.getState().vertical),before);
 fakePhotopea(a);await a.click('reloadPhotopeaBtn');await B.load();
 frame.dispatchEvent(new a.w.Event('load'));
 assert.match(a.el('photopeaStatus').textContent,/готова/,'load after done cannot regress ready status');
 await B.editCurrentPoster();assert.ok(B.getContext().layeredReady);assert.deepEqual(a.errors,[]);
});
