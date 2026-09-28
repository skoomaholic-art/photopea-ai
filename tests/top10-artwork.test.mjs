import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const root = new URL('../', import.meta.url);
const fixtureRoot = new URL('fixtures/top10/', import.meta.url);
const manifest = JSON.parse(await fs.readFile(new URL('manifest.json', fixtureRoot)));
const colored = (p, i) => p[i] < 80 && Math.max(p[i+1], p[i+2])-p[i] > 35 && Math.max(p[i+1], p[i+2]) > 65 && p[i+3] > 100;

function pixels(image,width=image.width,height=image.height){
  const canvas=createCanvas(width,height);
  canvas.getContext('2d').drawImage(image,0,0,width,height);
  return canvas.getContext('2d').getImageData(0,0,width,height).data;
}

test('legacy TOP10 PNG artwork remains intact for older documents', async t => {
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
      assert.equal(exactStroke,sourceStroke,'every supplied gradient-stroke pixel is preserved exactly');
      assert.ok(opaque<width*height*.86,'poster background was removed');
      assert.equal(actual[3],0,'transparent outside the glyph');
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

test('TOP10 uses the ten clean transparent user-number assets in the active editor',async()=>{
  const script=await fs.readFile(new URL('../top10-editor.js',import.meta.url),'utf8');
  assert.ok(script.includes('assets/top10/numbers/${value}.svg'));
  assert.ok(script.includes('TOP10_NUMBER_PREVIEWS = TOP10_NUMBER_ASSETS'));
  for(let n=1;n<=10;n++){
    const src=await fs.readFile(new URL(`../assets/top10/numbers/${n}.svg`,import.meta.url),'utf8');
    assert.ok(src.startsWith('<svg ')&&src.includes('width="500" height="500"'));
    assert.ok(src.includes('fill="url(#g)" fill-rule="evenodd"'));
    assert.ok(!src.includes('<image')&&!src.includes('<rect'),'no opaque background or external images');
  }
});

test('TOP10 darkening slider is transparent at 0 and covers full height at 100',async()=>{
  const script=await fs.readFile(new URL('../top10-editor.js',import.meta.url),'utf8');
  const a=script.indexOf('  function darkeningStops(){');
  const b=script.indexOf('  function drawDarkening(ctx){',a);
  assert.ok(a>=0&&b>a,'shared gradient stops used by preview and export');
  const stopFunction=script.slice(a,b);
  const evaluate=intensity=>new Function('data','rgba',stopFunction+';return darkeningStops();')(
    {darkeningStart:58,darkeningIntensity:intensity,darkeningColor:'#000000'},
    (color,alpha)=>alpha
  ).map(stop=>stop.color);
  assert.deepEqual(evaluate(0),[0,0,0,0,0]);
  assert.deepEqual(evaluate(100),[1,1,1,1,1]);
  const middle=evaluate(50);
  assert.ok(middle[0]<middle[4]&&Math.abs(middle[4]-.5)<1e-8,'intermediate strength is vertically graduated');
});
