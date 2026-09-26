import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/ai-worker.js';
const image='data:image/png;base64,iVBORw0KGgo=',payload={provider:'xai',image,prompt:'Жекпе-жек чемпиондары',count:1};
const request=(path,body)=>new Request('https://test.invalid'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);
function mockFetch(t,fn=()=>{throw Error('Unexpected network');}){const old=globalThis.fetch;globalThis.fetch=fn;t.after(()=>{globalThis.fetch=old;});}

test('Worker config and disabled credit-spending routes make zero provider calls',async t=>{
 mockFetch(t);
 for(const endpoint of ['/api/config','/api/health']){const r=await worker.fetch(request(endpoint),{OPENROUTER_API_KEY:'secret-not-for-client'});const data=await r.json();assert.equal(r.status,200);assert.equal(data.upstreamChecked,false);assert.equal(data.providers.xai,false);assert.ok(!JSON.stringify(data).includes('secret-not-for-client'));}
 assert.equal((await worker.fetch(request('/api/generate',payload),{})).status,403);
 assert.equal((await worker.fetch(request('/api/remove-background',{provider:'removal',image}),{})).status,403);
});

test('Worker rejects missing keys and incompatible models before requests',async t=>{
 mockFetch(t);
 assert.equal((await worker.fetch(request('/api/generate',payload),{AI_REQUESTS_ENABLED:'true'})).status,503);
 assert.equal((await worker.fetch(request('/api/generate',payload),{AI_REQUESTS_ENABLED:'true',OPENROUTER_API_KEY:'fake',OPENROUTER_XAI_IMAGE_MODEL:'wrong'})).status,400);
});

test('Worker maps upstream auth, route, quota and server errors without exposing response details',async t=>{
 let status=401,message='sensitive-provider-message';mockFetch(t,async()=>new Response(JSON.stringify({error:{message}}),{status}));
 const env={AI_REQUESTS_ENABLED:'true',OPENROUTER_API_KEY:'fake'};
 for(const [http,expected] of [[401,401],[403,401],[404,404],[429,429],[500,502]]){status=http;const r=await worker.fetch(request('/api/generate',payload),env);assert.equal(r.status,expected);assert.ok(!(await r.text()).includes('sensitive-provider-message'));}
 status=400;message="Account doesn't have enough credits";const r=await worker.fetch(request('/api/generate',payload),env);assert.equal(r.status,402);assert.match((await r.json()).error,/закончились доступные кредиты/);
});

test('Worker image edit uses documented OpenRouter references and fake response',async t=>{
 let count=0;mockFetch(t,async(url,options)=>{count++;assert.equal(url,'https://openrouter.ai/api/v1/images');const body=JSON.parse(options.body);assert.equal(body.input_references[0].image_url.url,image);assert.equal(body.prompt,payload.prompt);return new Response(JSON.stringify({data:[{b64_json:'iVBORw0KGgo=',media_type:'image/png'}]}));});
 const r=await worker.fetch(request('/api/generate',payload),{AI_REQUESTS_ENABLED:'true',OPENROUTER_API_KEY:'fake'});assert.equal(r.status,200);assert.equal((await r.json()).images.length,1);assert.equal(count,1);
});

test('Worker Removal.AI adapter uses official API only when enabled; PNG retained',async t=>{
 mockFetch(t,async(url,options)=>{assert.equal(url,'https://api.removal.ai/3.0/remove');assert.equal(options.body.get('crop'),'0');assert.ok(options.body.get('image_file') instanceof Blob);return new Response(JSON.stringify({image_base64:image}));});
 const r=await worker.fetch(request('/api/remove-background',{provider:'removal',image}),{REMOTE_BACKGROUND_ENABLED:'true',REMOVAL_AI_KEY:'fake'});assert.equal(r.status,200);assert.equal((await r.json()).image,image);
});

test('Worker timeout is recoverable and unknown endpoint returns 404',async t=>{
 mockFetch(t,async()=>{throw new DOMException('timeout','TimeoutError');});
 const r=await worker.fetch(request('/api/generate',payload),{AI_REQUESTS_ENABLED:'true',OPENROUTER_API_KEY:'fake'});assert.equal(r.status,504);assert.match((await r.json()).error,/не ответил вовремя/);
 assert.equal((await worker.fetch(request('/api/absent'),{})).status,404);
});

test('Worker recognizes documented TMDB_READ_ACCESS_TOKEN without exposing it',async t=>{
 mockFetch(t);
 const r=await worker.fetch(request('/api/config'),{TMDB_READ_ACCESS_TOKEN:'test-private-token',TMDB_COMMERCIAL_APPROVED:'true'});
 const body=await r.json();assert.equal(body.posters.tmdb,true);assert.ok(!JSON.stringify(body).includes('test-private-token'));
});
