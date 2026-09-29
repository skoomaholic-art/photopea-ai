import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { app, fixture, unzip, settle } from './dom-harness.mjs';
const plain=x=>JSON.parse(JSON.stringify(x));
const url=b=>'data:image/png;base64,'+b.toString('base64');
async function pixels(blob){const im=await loadImage(Buffer.isBuffer(blob)?blob:Buffer.from(await blob.arrayBuffer()));const c=createCanvas(im.width,im.height),ctx=c.getContext('2d');ctx.drawImage(im,0,0);return {im,c,ctx,data:ctx.getImageData(0,0,im.width,im.height).data};}

test('active poster: cover/crop has source pixels on every edge after rotation; independent PNG and ZIP', async t=>{
  const a=await app(t),P=a.w.PosterApp;
  await a.file('posterFileInput',fixture(340,260,{border:10}),'vertical.png');
  await a.input('posterLockInput',false,'change');
  await a.input('layerRotationInput',37);await a.input('layerScaleInput',145);
  await a.file('logoFileInput',fixture(300,100,{logo:true,color:'#ffffff'}),'logo.png');
  const before=plain(P.getState().vertical);
  const {im,data}=await pixels((await a.take('downloadVerticalBtn')).bytes);
  assert.equal(im.width,800);assert.equal(im.height,1200);
  for(let y=0;y<1200;y++)for(let x=0;x<800;x++)if(x===0||x===799||y===0||y===1199){
    const k=(y*800+x)*4;assert.deepEqual(Array.from(data.slice(k,k+4)),[238,68,51,255],`source at ${x},${y}`);
  }
  P.switchWorkspace('horizontal');await settle();assert.equal(P.getState().horizontal.poster,null);
  await a.file('posterFileInput',fixture(300,700,{color:'#1155aa'}),'horizontal.png');
  const h=await pixels((await a.take('downloadHorizontalBtn')).bytes);assert.equal(h.im.width,1920);assert.equal(h.im.height,1080);
  const entries=unzip((await a.take('downloadPostersZipBtn')).bytes);assert.equal(entries.size,2);
  for(const [name,w,h] of [['poster-vertical.png',800,1200],['poster-horizontal.png',1920,1080]]){const image=await loadImage(entries.get(name));assert.equal(image.width,w);assert.equal(image.height,h);}
  for(let i=0;i<5;i++)for(const target of ['train','top10','horizontal','vertical'])P.switchWorkspace(target);
  assert.deepEqual(plain(P.getState().vertical),before);assert.deepEqual(a.errors,[]);
});

test('active poster locks, layer model, original alpha and exact title prompt',async t=>{
 const a=await app(t),P=a.w.PosterApp;
 await a.file('posterFileInput',fixture());await a.file('logoFileInput',fixture(300,100,{logo:true}));
 await a.input('layerRotationInput',25);await a.input('layerOpacityInput',70);
 await a.input('logoLockInput',true,'change');
 assert.equal(a.el('layerScaleInput').disabled,true);assert.equal(a.el('removePosterLogoBtn').disabled,true);
 await a.input('layerScaleInput',200);assert.equal(P.getState().vertical.logoScale,100);
 const model=await P.buildPhotopeaModel();assert.deepEqual(Array.from(model.layers,l=>l.name),['Background','Постер','Логотип']);
 assert.equal(model.layers[2].rotation,25);assert.equal(model.layers[2].opacity,.7);assert.equal(model.layers[2].locked,true);
 const {data}=await pixels(Buffer.from(P.getState().vertical.logo.split(',')[1],'base64'));assert.equal(data[3],0);
 const prompt=P.buildLogoPrompt('Жекпе-жек чемпиондары','казахский','Сохранить фактуру');
 for(const term of ['Жекпе-жек чемпиондары','казахский','кириллицу','прозрачным','соотношение сторон','потёртости','Сохранить фактуру'])assert.ok(prompt.includes(term));
 for(const message of ["Account doesn't have enough credits",'Account does not have enough balance','Not enough credits','Quota exceeded','Insufficient credits for image generation'])assert.match(P.aiError(new Error(message)),/закончились доступные кредиты/);
 P.switchWorkspace('horizontal');assert.equal(a.el('logoLockInput').checked,false);assert.equal(a.el('posterLockInput').checked,true);
 assert.deepEqual(a.errors,[]);
});

test('active TOP10: five layers, unlock number, exact master, filters isolated and portable project',async t=>{
 const a=await app(t),P=a.w.PosterApp,T=a.w.Top10Editor;
 P.switchWorkspace('top10');await a.file('top10BackgroundInput',fixture(500,700),'top-bg.png');await a.file('top10LogoInput',fixture(300,100,{logo:true}),'top-logo.png');
 assert.equal(a.el('top10Canvas').width,800);assert.equal(a.el('top10Canvas').height,1400);assert.equal(a.el('top10NumberScale').disabled,true);
 await a.input('top10numberLock',false,'change');await a.input('top10NumberScale',80);await a.input('top10NumberRotation',22);await a.click('top10NumberCenter');
 await a.input('top10PositionSelect','10','change');
 let model=await T.buildPhotopeaModel();assert.deepEqual(Array.from(model.layers,l=>l.name),['Canvas Background','Background Image','Bottom Darkening','Logo','TOP10 Number']);
 assert.equal(model.layers[4].rotation,22);assert.equal(model.layers[4].width,400);assert.equal(model.layers[4].locked,false);assert.equal(model.layers[4].y,700);
 const original=plain(T.getState()),changed=plain(original);changed.backgroundFilters.brightness=25;await T.restore(changed);
 model=await T.buildPhotopeaModel();assert.equal(model.layers[4].rotation,22);assert.equal(T.getState().logo,original.logo);assert.equal(T.getState().darkeningIntensity,original.darkeningIntensity);
 const saved=await a.take('saveProjectBtn'),project=JSON.parse(saved.bytes);await T.resetClassic();assert.equal(T.getState().numberLocked,true);
 await P.restore(project);assert.equal(T.getState().numberRotation,22);assert.equal(T.getState().numberLocked,false);assert.equal(T.getState().ranking,'10');
 const out=await pixels(await T.renderBlob());assert.equal(out.im.width,800);assert.equal(out.im.height,1400);
 await new Promise(r=>setTimeout(r,650));const auto=await a.w.SkoomaStore.getProject('poster-editor-autosave');assert.ok(auto?.top10);
 assert.deepEqual(a.errors,[]);
});

test('active Train: exact 24 PNG ZIP, pixel-perfect stitching at four sizes, sticky replacement and saved project',async t=>{
 const a=await app(t),T=a.w.TrainEditor,P=a.w.PosterApp;P.switchWorkspace('train');
 await T.setBackgroundFromDataUrl(url(fixture(2952,366,{pattern:true})),'wide.png');
 const master=await pixels(await T.renderMasterBlob());assert.equal(master.im.width,2952);assert.equal(master.im.height,366);
 const baseline=unzip((await a.take('trainDownloadAllBtn')).bytes);assert.equal(baseline.size,24);
 const folders=new Set([...baseline.keys()].map(n=>n.split('/')[0]));assert.deepEqual([...folders],['1 - 164x122','2 - 246x183','3 - 328x244','4 - 492x366']);
 for(const [j,w,h] of [[1,164,122],[2,246,183],[3,328,244],[4,492,366]]){
   const expected=createCanvas(w*6,h),ctx=expected.getContext('2d');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(master.im,0,0,w*6,h);
   const stitched=createCanvas(w*6,h),dest=stitched.getContext('2d');
   for(let part=1;part<=6;part++){const im=await loadImage(baseline.get(`${j} - ${w}x${h}/part_${part}.png`));assert.equal(im.width,w);assert.equal(im.height,h);dest.drawImage(im,(part-1)*w,0);}
   assert.deepEqual(dest.getImageData(0,0,w*6,h).data,ctx.getImageData(0,0,w*6,h).data,`seam-free ${w}`);
 }
 await a.input('stickerSelect','Жаңа сериялар','change');await settle();assert.equal(T.inspect().sticker.text,'Жаңа сериялар');
 const project=plain(T.serialize()),sticker=project.canvas.objects.find(o=>o.sticker);sticker.left=100;sticker.top=70;sticker.scaleX*=.8;sticker.scaleY=sticker.scaleX;await T.restore(project);
 const previous=plain(T.inspect().sticker);await a.input('stickerSelect','Скоро уйдёт','change');assert.equal(T.inspect().sticker.left,previous.left);assert.equal(T.inspect().sticker.top,previous.top);assert.ok(Math.abs(T.inspect().sticker.width-previous.width)<.01);
 const withSticker=unzip((await a.take('trainDownloadAllBtn')).bytes);
 for(const folder of folders)for(let part=1;part<=6;part++){const name=`${folder}/part_${part}.png`,before=(await pixels(baseline.get(name))).data,after=(await pixels(withSticker.get(name))).data;if(part===1)assert.notDeepEqual(after,before);else assert.deepEqual(after,before);}
 await a.input('trainSizeSelect','246x183','change');const selected=unzip((await a.take('trainDownloadSelectedBtn')).bytes);assert.equal(selected.size,6);assert.ok([...selected.keys()].every(n=>n.startsWith('2 - 246x183/part_')));
 const portable=JSON.parse((await a.take('saveProjectBtn')).bytes);await T.resetWorkspace();assert.equal(T.inspect().objectCount,0);await P.restore(portable);assert.equal(T.inspect().sticker.text,'Скоро уйдёт');
 const invalid=plain(T.serialize()),object=invalid.canvas.objects.find(o=>o.sticker);object.left=9999;object.top=-100;object.scaleX=12;object.scaleY=12;await T.restore(invalid);
 const bounded=T.inspect().sticker;assert.ok(bounded.left>=0 && bounded.left+bounded.width<=492.01);assert.ok(bounded.top>=0 && bounded.top+bounded.height<=366.01);
 await a.input('stickerSelect','Без стикера','change');assert.equal(T.inspect().sticker,null);assert.deepEqual(a.errors,[]);
});

test('local background removal mock preserves logo geometry and alpha; failure restores button',async t=>{
 const a=await app(t),P=a.w.PosterApp;
 await a.file('posterFileInput',fixture());await a.file('logoFileInput',fixture(300,100),'logo.png');await a.input('layerRotationInput',28);await a.input('layerScaleInput',130);
 const before=P.getState().vertical;
 a.w.LocalBackgroundRemoval.remove=async()=>new a.w.Blob([fixture(300,100,{logo:true})],{type:'image/png'});
 await a.input('bgProviderSelect','local','change');await a.click('removeBackgroundBtn');for(let i=0;i<50&&a.el('removeBackgroundBtn').disabled;i++)await settle();
 const after=P.getState().vertical;assert.equal(after.logoRotation,before.logoRotation);assert.equal(after.logoScale,before.logoScale);assert.equal(after.logoX,before.logoX);
 assert.equal((await pixels(Buffer.from(after.logo.split(',')[1],'base64'))).data[3],0);
 a.w.LocalBackgroundRemoval.remove=async()=>{throw Error('test failure');};await a.click('removeBackgroundBtn');await settle();assert.equal(a.el('removeBackgroundBtn').disabled,false);assert.match(a.el('bgRemoveStatus').textContent,/test failure/);
 assert.deepEqual(a.errors,[]);
});
