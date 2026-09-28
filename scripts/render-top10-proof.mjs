import fs from 'node:fs/promises';
import {createCanvas,loadImage} from '@napi-rs/canvas';
const fixtures=new URL('../tests/fixtures/top10/',import.meta.url);
const items=JSON.parse(await fs.readFile(new URL('manifest.json',fixtures)));
const canvas=createCanvas(1500,340),ctx=canvas.getContext('2d');
ctx.fillStyle='#101512';ctx.fillRect(0,0,1500,340);
for(const item of items){
 const x=((item.number-1)%5)*300,y=Math.floor((item.number-1)/5)*170;
 ctx.fillStyle='#c4d5cc';ctx.font='14px sans-serif';ctx.fillText(String(item.number)+'   SOURCE / EXACT PNG',x+12,y+22);
 const [sx,sy,right,bottom]=item.crop,w=right-sx,h=bottom-sy;
 const ref=await loadImage(new URL(item.reference,fixtures).pathname);
 const png=await loadImage(new URL('../assets/top10/reference-numbers/'+item.number+'.png',import.meta.url).pathname);
 const scale=.75;
 ctx.drawImage(ref,sx,sy,w,h,x+5+(135-w*scale)/2,y+45,w*scale,h*scale);
 ctx.drawImage(png,x+155+(135-w*scale)/2,y+45,w*scale,h*scale);
}
await fs.writeFile(new URL('../docs/top10-reference-comparison.png',import.meta.url),canvas.toBuffer('image/png'));
console.log('Wrote docs/top10-reference-comparison.png');
