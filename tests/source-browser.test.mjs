import {test} from 'node:test';
import assert from 'node:assert/strict';
import {app,fixture} from './dom-harness.mjs';

const reply=(data,status=200)=>({ok:status<400,status,json:async()=>data});
const show={id:10,name:'Test show',premiered:'2020-02-01',image:{original:'https://static.tvmaze.com/uploads/images/original_untouched/1/1.jpg',medium:'https://static.tvmaze.com/uploads/images/medium_portrait/1/1.jpg'}};

test('legacy Use POST falls back to official public search; image imports in active workspace',async t=>{
 const a=await app(t),calls=[],normal=a.w.fetch;
 a.w.fetch=async(url,options)=>{
   const s=String(url);calls.push(s);
   if(s.includes('/api/images/search'))return reply({error:'Use POST'},405);
   if(s.startsWith('https://api.tvmaze.com/'))return reply([{show}]);
   if(s.startsWith('https://commons.wikimedia.org/'))return reply({query:{pages:{1:{pageid:1,title:'File:Test poster.jpg',imageinfo:[{mime:'image/jpeg',url:'https://upload.wikimedia.org/test.jpg',width:400,height:600,extmetadata:{Artist:{value:'<b>Author</b>'},LicenseShortName:{value:'CC BY-SA'}}}]}}}});
   if(s.startsWith('https://static.tvmaze.com/'))return {ok:true,headers:new Map([['content-type','image/png']]),blob:async()=>new a.w.Blob([fixture(500,700)],{type:'image/png'})};
   return normal(url,options);
 };
 await a.input('sourceSearchQuery','Test show','input');await a.input('sourceSearchYear','2020','input');
 await a.w.AssetSourceBrowser.search();
 const state=a.w.AssetSourceBrowser.getState();assert.equal(state.items.length,2);assert.equal(state.items[1].attribution,'Author');
 assert.match(a.el('sourceSearchStatus').textContent,/Резервный поиск/);assert.doesNotMatch(a.el('sourceSearchStatus').textContent,/Use POST/);
 assert.ok(calls.some(s=>s.includes('q=Test%20show')));assert.ok(calls.some(s=>s.includes('gsrsearch=Test+show+2020')));
 a.w.PosterApp.switchWorkspace('horizontal');
 a.el('sourceGallery').querySelector('button').click();
 for(let i=0;i<50&&!a.w.PosterApp.getState().horizontal.poster;i++)await new Promise(r=>setTimeout(r,20));
 assert.ok(a.w.PosterApp.getState().horizontal.poster);assert.equal(a.w.PosterApp.getState().vertical.poster,null);
 assert.equal(a.el('sourceSearchRun').disabled,false);
});

test('search rejects bad year; public sources filter year, missing images and unsafe URLs',async t=>{
 const a=await app(t);await a.input('sourceSearchQuery','Тайтл');await a.input('sourceSearchYear','xx');
 let calls=0;a.w.fetch=async()=>{calls++;return reply([]);};await a.w.AssetSourceBrowser.search();assert.equal(calls,0);
 a.w.fetch=async url=>String(url).includes('tvmaze')?reply([{show},{show:{...show,id:11,premiered:'2021-01-01'}},{show:{...show,id:12,image:null}},{show:{...show,id:13,image:{original:'javascript:alert(1)'}}}]):reply({query:{pages:{}}});
 const result=await a.w.PublicImageSearch.search('Тайтл','2020');assert.equal(result.results.length,1);assert.equal(result.results[0].year,'2020');
});

test('search handles rate limit and unavailable public sources without raw errors',async t=>{
 const a=await app(t);await a.input('sourceSearchQuery','Test');
 let calls=0;a.w.fetch=async()=>{calls++;return reply({error:'private technical detail'},429);};
 await a.w.AssetSourceBrowser.search();assert.equal(calls,1);assert.match(a.el('sourceSearchStatus').textContent,/Превышен лимит/);assert.equal(a.el('sourceSearchRun').disabled,false);
 a.w.fetch=async url=>String(url).includes('/api/images/search')?reply({},404):reply({},429);
 await a.w.AssetSourceBrowser.search();assert.equal(a.w.AssetSourceBrowser.getState().items.length,0);assert.match(a.el('sourceSearchStatus').textContent,/TVmaze: Превышен лимит/);assert.equal(a.el('sourceSearchRun').disabled,false);
});

test('late search response cannot overwrite a newer query',async t=>{
 const a=await app(t);let release;const slow=new Promise(r=>release=r);
 a.w.fetch=async url=>{const q=new URL(url).searchParams.get('q');if(q==='Old')await slow;return reply({results:[],identity:{title:q}});};
 await a.input('sourceSearchQuery','Old');const first=a.w.AssetSourceBrowser.search();
 await new Promise(r=>setTimeout(r,20));await a.input('sourceSearchQuery','New');await a.w.AssetSourceBrowser.search();release();await first;
 assert.match(a.el('sourceSearchStatus').textContent,/New/);assert.doesNotMatch(a.el('sourceSearchStatus').textContent,/Old/);
});
