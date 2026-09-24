import {test,expect} from '@playwright/test';
import {fixture} from './dom-harness.mjs';
import {readFile} from 'node:fs/promises';
const health={apiVersion:'2026-09-23-runtime-v4',providers:{xai:true,openai:true,cloudflare:false},background:{local:true,removal:false,carve:false},images:{}};
async function start(page){
 await page.route('**/api/**',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Unmocked API disabled in tests'})}));
 await page.route('**/api/health',r=>r.fulfill({json:health}));
 await page.route('https://www.photopea.com/**',r=>r.fulfill({contentType:'text/html',body:'<script>parent.postMessage("done","*")</script>'}));
 await page.goto('/');await page.waitForFunction(()=>window.PosterApp&&window.TrainEditor&&window.Top10Editor);
}
async function upload(page,id,buffer,name='test.png'){await page.locator('#'+id).setInputFiles({name,mimeType:'image/png',buffer});}
async function download(page,id){const pending=page.waitForEvent('download');await page.locator('#'+id).click();const file=await pending;return readFile(await file.path());}

test('exact-title validation, detailed prompt, comparison, explicit apply and credit recovery (API fake)',async({page})=>{
 await start(page);await upload(page,'logoFileInput',fixture(320,100,{logo:true}),'original.png');await expect(page.locator('#aiOriginalPreview')).toBeVisible();
 await page.locator('#aiProvider').selectOption('xai');
 let calls=0,prompt='',fail=false;const result='data:image/png;base64,'+fixture(320,100,{logo:true,color:'#ffffff'}).toString('base64');
 await page.route('**/api/generate',async r=>{calls++;prompt=r.request().postDataJSON().prompt;await r.fulfill(fail?{status:402,json:{error:"Account doesn't have enough credits"}}:{json:{images:[result]}});});
 await page.locator('#generateBtn').click();await expect(page.locator('#aiStatus')).toHaveText('Введите точное название на казахском языке');expect(calls).toBe(0);
 const original=await page.evaluate(()=>PosterApp.getState().vertical.logo);
 await page.locator('#aiTitle').fill('Жекпе-жек чемпиондары');await page.locator('#generateBtn').click();await expect(page.locator('#aiResultPreview')).toHaveAttribute('src',result);expect(prompt).toContain('Жекпе-жек чемпиондары');expect(prompt).toContain('Не заменяй кириллицу латиницей');
 expect(await page.evaluate(()=>PosterApp.getState().vertical.logo)).toBe(original);await page.locator('#moveResultBtn').click();await expect.poll(()=>page.evaluate(()=>PosterApp.getState().vertical.logo)).toBe(result);await expect(page.locator('#aiOriginalPreview')).toHaveAttribute('src',original);
 const bytes=await download(page,'downloadResultBtn');expect(bytes.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');
 fail=true;await page.locator('#generateBtn').click();await expect(page.locator('#aiStatus')).toContainText('закончились доступные кредиты');await expect(page.locator('#generateBtn')).toBeEnabled();
});

test('poster edges contain image pixels; locks remain independent between formats',async({page})=>{
 await start(page);await upload(page,'posterFileInput',fixture(340,260,{border:10}));await expect(page.locator('#posterImage')).toBeVisible();
 await page.locator('#posterLockInput').uncheck();await page.locator('#layerRotationInput').fill('37');await page.locator('#layerScaleInput').fill('145');
 const png=await download(page,'downloadVerticalBtn');expect(png.readUInt32BE(16)).toBe(800);expect(png.readUInt32BE(20)).toBe(1200);
 const edges=await page.evaluate(async src=>{const im=await EditorCore.image(src),c=EditorCore.canvas(800,1200),x=c.getContext('2d');x.drawImage(im,0,0);const p=x.getImageData(0,0,800,1200).data;let wrong=0;for(let y=0;y<1200;y++)for(let k=0;k<800;k++)if(k===0||y===0||k===799||y===1199){const i=(y*800+k)*4;if(p[i]!==238||p[i+1]!==68||p[i+2]!==51||p[i+3]!==255)wrong++;}return wrong;},'data:image/png;base64,'+png.toString('base64'));expect(edges).toBe(0);
 await page.locator('[data-workspace="horizontal"]').click();await expect(page.locator('#posterLockInput')).toBeChecked();await expect(page.locator('#layerScaleInput')).toBeDisabled();await page.locator('[data-workspace="vertical"]').click();await expect(page.locator('#posterLockInput')).not.toBeChecked();await expect(page.locator('#layerRotationInput')).toHaveValue('37');
});

test('TOP10 unlock transform and portable project preserve independent state',async({page})=>{
 await start(page);await page.locator('[data-workspace="top10"]').click();await upload(page,'top10BackgroundInput',fixture(400,700),'top.png');
 await expect(page.locator('#top10NumberScale')).toBeDisabled();await page.locator('#top10numberLock').uncheck();await page.locator('#top10NumberScale').fill('80');await page.locator('#top10NumberRotation').fill('22');await page.locator('#top10PositionSelect').selectOption('10');
 const json=await download(page,'saveProjectBtn');const project=JSON.parse(json);expect(project.top10.numberLocked).toBe(false);expect(project.top10.numberRotation).toBe(22);
 await page.evaluate(()=>Top10Editor.resetClassic());await page.locator('#projectFileInput').setInputFiles({name:'project.json',mimeType:'application/json',buffer:json});await expect.poll(()=>page.evaluate(()=>Top10Editor.getState().numberRotation)).toBe(22);
 const png=await download(page,'top10DownloadBtn');expect(png.readUInt32BE(16)).toBe(800);expect(png.readUInt32BE(20)).toBe(1400);
});

test('small screen switches all workspaces without console errors or changing master sizes',async({page})=>{
 await page.setViewportSize({width:390,height:844});const errors=[];page.on('pageerror',e=>errors.push(e.message));await start(page);
 for(let cycle=0;cycle<3;cycle++)for(const workspace of ['vertical','horizontal','train','top10','photopea']){await page.locator(`[data-workspace="${workspace}"]`).click();await expect(page.locator(`[data-workspace="${workspace}"]`)).toHaveAttribute('aria-selected','true');}
 const sizes=await page.evaluate(()=>({train:TrainEditor.inspect().masterSize,top:Top10Editor.inspect().backingSize}));expect(sizes.train).toEqual({width:2952,height:366});expect(sizes.top).toEqual({width:800,height:1400});expect(errors).toEqual([]);
});
