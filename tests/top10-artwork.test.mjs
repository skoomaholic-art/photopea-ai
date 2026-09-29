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

test('TOP10 uses exact transparent PNG cutouts from the supplied 1-10 references', async t => {
  const heights=[];
  for(const item of manifest){
    await t.test(`number ${item.number}`,async()=>{
      const source=await loadImage(new URL(item.reference,fixtureRoot).pathname);
      const preview=await loadImage(new URL(`assets/top10/reference-numbers/${item.number}.png`,root).pathname);
      const runtime=await loadImage(new URL(`assets/top10/numbers/${item.number}.png`,root).pathname);
      const [x,y,right,bottom]=item.crop,width=right-x,height=bottom-y;
      assert.equal(preview.width,width);
      assert.equal(preview.height,height);
      assert.equal(runtime.width,500);
      assert.equal(runtime.height,500);

      const referenceCanvas=createCanvas(width,height);
      referenceCanvas.getContext('2d').drawImage(source,-x,-y);
      const expected=referenceCanvas.getContext('2d').getImageData(0,0,width,height).data;
      const actual=pixels(preview);
      let sourceStroke=0,exactStroke=0,opaque=0,minY=height,maxY=0;
      for(let i=0;i<expected.length;i+=4){
        if(colored(expected,i)){
          sourceStroke++;
          if(expected[i]===actual[i]&&expected[i+1]===actual[i+1]&&expected[i+2]===actual[i+2]&&actual[i+3]===255) exactStroke++;
        }
        if(actual[i+3]){
          opaque++;
          const py=Math.floor(i/4/width);minY=Math.min(minY,py);maxY=Math.max(maxY,py);
        }
      }
      assert.ok(sourceStroke>2000,'reference stroke detected');
      assert.ok(exactStroke/sourceStroke>.99,'the supplied gradient stroke remains visually exact after edge cleanup');
      assert.ok(opaque<width*height*.86,'poster background was removed');
      assert.equal(actual[3],0,'transparent outside the glyph');
      assert.equal(enclosedTransparency(actual,width,height),expectedCounters.get(item.number)||0,'glyph counters are transparent');

      const runtimePixels=pixels(runtime);
      const visible=new Uint8Array(500*500);
      const alphaLevels=new Set();
      let transparentRgb=0,darkBoundary=0,boundary=0;
      for(let p=0;p<500*500;p++){
        const i=p*4,alpha=runtimePixels[i+3];
        alphaLevels.add(alpha);
        visible[p]=alpha>2?1:0;
        if(alpha===0) transparentRgb=Math.max(transparentRgb,runtimePixels[i],runtimePixels[i+1],runtimePixels[i+2]);
      }
      for(let p=0;p<500*500;p++){
        if(runtimePixels[p*4+3]<64) continue;
        const x=p%500,y=Math.floor(p/500);
        const touchesTransparency=(x>0&&runtimePixels[(p-1)*4+3]<=2)||(x<499&&runtimePixels[(p+1)*4+3]<=2)||(y>0&&runtimePixels[(p-500)*4+3]<=2)||(y<499&&runtimePixels[(p+500)*4+3]<=2);
        if(!touchesTransparency) continue;
        boundary++;
        if(Math.max(runtimePixels[p*4],runtimePixels[p*4+1],runtimePixels[p*4+2])<40) darkBoundary++;
      }
      assert.equal(components(visible,500,500).length,1,'no isolated alpha fragments or resize ringing');
      assert.ok(alphaLevels.size>32,'runtime cut-out retains smooth antialiasing');
      assert.equal(transparentRgb,0,'fully transparent pixels contain no fringe colour');
      assert.ok(darkBoundary/Math.max(boundary,1)<.025,'no black crop halo surrounds the coloured outline');
      heights.push(maxY-minY+1);
    });
  }
  assert.ok(Math.max(...heights)/Math.min(...heights)<1.06,'all positions retain the supplied visual height, including 10');
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
