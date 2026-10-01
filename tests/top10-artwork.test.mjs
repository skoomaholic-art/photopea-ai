import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const root = new URL('../', import.meta.url);
const fixtureRoot = new URL('fixtures/top10/', import.meta.url);
const manifest = JSON.parse(await fs.readFile(new URL('manifest.json', fixtureRoot)));
const colored = (p, i) => p[i] < 80 && Math.max(p[i+1], p[i+2])-p[i] > 35 && Math.max(p[i+1], p[i+2]) > 65 && p[i+3] > 100;
const expectedCounters = new Map([[5,1],[6,1],[8,2],[9,1],[10,1]]);

function pixels(image,width=image.width,height=image.height){
  const canvas=createCanvas(width,height);
  canvas.getContext('2d').drawImage(image,0,0,width,height);
  return canvas.getContext('2d').getImageData(0,0,width,height).data;
}

function components(mask,width,height){
  const seen=new Uint8Array(mask.length),sizes=[];
  for(let start=0;start<mask.length;start++){
    if(!mask[start]||seen[start]) continue;
    let size=0;
    const stack=[start];seen[start]=1;
    while(stack.length){
      const current=stack.pop();size++;
      const x=current%width,y=Math.floor(current/width);
      const neighbours=[];
      if(x>0) neighbours.push(current-1);
      if(x+1<width) neighbours.push(current+1);
      if(y>0) neighbours.push(current-width);
      if(y+1<height) neighbours.push(current+width);
      for(const next of neighbours){
        if(mask[next]&&!seen[next]){seen[next]=1;stack.push(next);}
      }
    }
    sizes.push(size);
  }
  return sizes.sort((a,b)=>b-a);
}

function enclosedTransparency(data,width,height){
  let minX=width,minY=height,maxX=-1,maxY=-1;
  for(let p=0;p<width*height;p++){
    if(data[p*4+3]===0) continue;
    const x=p%width,y=Math.floor(p/width);
    minX=Math.min(minX,x);maxX=Math.max(maxX,x);
    minY=Math.min(minY,y);maxY=Math.max(maxY,y);
  }
  const subWidth=maxX-minX+1,subHeight=maxY-minY+1;
  const transparent=new Uint8Array(subWidth*subHeight);
  for(let y=0;y<subHeight;y++) for(let x=0;x<subWidth;x++){
    transparent[y*subWidth+x]=data[((y+minY)*width+x+minX)*4+3]===0?1:0;
  }
  const exterior=new Uint8Array(transparent.length),stack=[];
  const add=index=>{if(transparent[index]&&!exterior[index]){exterior[index]=1;stack.push(index);}};
  for(let x=0;x<subWidth;x++){add(x);add((subHeight-1)*subWidth+x);}
  for(let y=0;y<subHeight;y++){add(y*subWidth);add(y*subWidth+subWidth-1);}
  while(stack.length){
    const current=stack.pop(),x=current%subWidth,y=Math.floor(current/subWidth);
    if(x>0) add(current-1);
    if(x+1<subWidth) add(current+1);
    if(y>0) add(current-subWidth);
    if(y+1<subHeight) add(current+subWidth);
  }
  const interior=new Uint8Array(transparent.length);
  for(let i=0;i<interior.length;i++) interior[i]=transparent[i]&&!exterior[i]?1:0;
  return components(interior,subWidth,subHeight).filter(size=>size>=16).length;
}

test('TOP10 uses the approved vector artwork for positions 1 through 10', async t => {
  for(let number=1;number<=10;number++){
    await t.test('number '+number,async()=>{
      const file=new URL(`assets/top10/numbers/${number}.svg`,root);
      const svg=await fs.readFile(file,'utf8');
      assert.match(svg,/^<svg\b/);
      assert.match(svg,/width="500"/);
      assert.match(svg,/height="500"/);
      assert.match(svg,/viewBox="0 0 500 500"/);
      assert.match(svg,/<linearGradient\b/);
      assert.match(svg,/fill="url\(#g\)"/);
      assert.match(svg,/<path\b/);
      assert.doesNotMatch(svg,/<image\b/i,'approved number artwork must stay vector-only');
      assert.doesNotMatch(svg,/filter=/i,'approved number artwork must not use blur/filter effects');
      const image=await loadImage(file.pathname);
      assert.equal(image.width,500);
      assert.equal(image.height,500);
      const data=pixels(image);
      assert.equal(data[3],0,'outer corner remains transparent');
      let visible=0,coloured=0;
      for(let i=0;i<data.length;i+=4){
        if(data[i+3]>0){
          visible++;
          if(Math.max(data[i+1],data[i+2])-data[i]>20) coloured++;
        }
      }
      assert.ok(visible>4000,'number remains visible');
      assert.ok(coloured/visible>.65,'green-to-blue supplied gradient remains dominant');
    });
  }
});

test('application mark keeps its black background and uses white artwork', async () => {
  const icon=await loadImage(new URL('assets/poster-markup-icon.png',root).pathname);
  const actual=pixels(icon);
  let black=0,white=0,other=0;
  for(let i=0;i<actual.length;i+=4){
    if(actual[i+3]===0) continue;
    if(actual[i]===0&&actual[i+1]===0&&actual[i+2]===0) black++;
    else if(actual[i]===255&&actual[i+1]===255&&actual[i+2]===255) white++;
    else other++;
  }
  assert.ok(black>500000,'black background remains');
  assert.ok(white>40000,'white foreground artwork remains readable');
  assert.equal(other,0,'no red or tinted foreground pixels remain');
});
