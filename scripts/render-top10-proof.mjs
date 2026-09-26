import fs from 'node:fs/promises';
import {createCanvas,loadImage} from '@napi-rs/canvas';
const fixtures=new URL('../tests/fixtures/top10/',import.meta.url);
const items=JSON.parse(await fs.readFile(new URL('manifest.json',fixtures)));
const canvas=createCanvas(1500,340),ctx=canvas.getContext('2d');
ctx.fillStyle='#101512';ctx.fillRect(0,0,1500,340);
for(const item of items){
 const x=((item.number-1)%5)*300,y=Math.floor((item.number-1)/5)*170;
 ctx.fillStyle='#c4d5cc';ctx.font='14px sans-serif';ctx.fillText(String(item.number)+'   REFERENCE / SVG',x+12,y+22);
 const [sx,sy,right,bottom]=item.crop,w=right-sx,h=bottom-sy;
 const ref=await loadImage(new URL(item.reference,fixtures).pathname);
 const svg=await loadImage(new URL('../assets/top10/numbers/'+item.number+'.svg',import.meta.url).pathname);
 const scale=.75;
 ctx.drawImage(ref,sx,sy,w,h,x+5+(135-w*scale)/2,y+45,w*scale,h*scale);
 ctx.save();ctx.translate(x+155+(135-w*scale)/2,y+45);
 ctx.scale(scale/item.scale,scale/item.scale);ctx.translate(-item.offsetX,-item.offsetY);
 ctx.drawImage(svg,0,0);ctx.restore();
}
await fs.writeFile(new URL('../docs/top10-reference-comparison.png',import.meta.url),canvas.toBuffer('image/png'));
console.log('Wrote docs/top10-reference-comparison.png');
