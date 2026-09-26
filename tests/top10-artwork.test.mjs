import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await fs.readFile(new URL('fixtures/top10/manifest.json', import.meta.url)));
const colored = (p, i) => p[i] < 65 && Math.max(p[i+1], p[i+2])-p[i] > 45 && Math.max(p[i+1], p[i+2]) > 75 && p[i+3] > 100;

test('TOP10 SVG silhouettes match the supplied references, including curves and digit 10', async t => {
  const heights = [];
  for (const item of manifest) {
    await t.test(`number ${item.number}`, async () => {
      const source = await loadImage(new URL(`fixtures/top10/${item.reference}`, import.meta.url).pathname);
      const svg = await fs.readFile(new URL(`assets/top10/numbers/${item.number}.svg`, root), 'utf8');
      assert.match(svg, /C[\d.-]/, 'native curved contours');
      assert.doesNotMatch(svg, /<image|<text|base64|font-family/, 'no bitmap or font substitution');
      const rendered = await loadImage(Buffer.from(svg));
      const [x, y, right, bottom] = item.crop;
      const width = right-x, height = bottom-y;
      const reference = createCanvas(width, height), actual = createCanvas(width, height);
      reference.getContext('2d').drawImage(source, -x, -y);
      const ctx = actual.getContext('2d');
      ctx.setTransform(1/item.scale, 0, 0, 1/item.scale, -item.offsetX/item.scale, -item.offsetY/item.scale);
      ctx.drawImage(rendered, 0, 0);
      const a = reference.getContext('2d').getImageData(0, 0, width, height).data;
      const b = ctx.getImageData(0, 0, width, height).data;
      let intersection = 0, union = 0, colorError = 0, minY = height, maxY = 0;
      for (let i = 0; i < a.length; i += 4) {
        const left = colored(a, i), right = colored(b, i);
        if (left || right) union++;
        if (left && right) {
          intersection++;
          colorError += Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]);
        }
        if (right) { const y = Math.floor(i/4/width); minY=Math.min(minY,y); maxY=Math.max(maxY,y); }
      }
      const similarity = intersection/union;
      assert.ok(similarity > .9, `colored stroke overlap ${(similarity*100).toFixed(1)}%`);
      assert.ok(colorError/intersection/2 < 24, 'gradient close to supplied image');
      heights.push((maxY-minY+1)*item.scale);
      const full = createCanvas(500, 500), fc = full.getContext('2d');
      fc.drawImage(rendered, 0, 0);
      assert.equal(fc.getImageData(0,0,1,1).data[3],0,'transparent outside glyph');
    });
  }
  assert.ok(Math.max(...heights)/Math.min(...heights)<1.055, 'all numbers have the same visual height; 10 is not shrunk');
});
