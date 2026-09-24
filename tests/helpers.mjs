import fs from "node:fs";
import { expect } from "@playwright/test";

export async function boot(page) {
  await page.route("https://js.puter.com/**", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: "window.puter={ai:{}};",
    }),
  );
  await page.route("**/api/ai/generate", (r) => r.abort());
  await page.goto("/");
  await page.waitForFunction(
    () => window.PosterApp && window.Top10Editor && window.TrainEditor,
  );
}
export async function imageFixture(
  page,
  {
    width = 320,
    height = 240,
    color = "#db502f",
    border = 0,
    pattern = false,
    logo = false,
  } = {},
) {
  return Buffer.from(
    await page.evaluate(
      (o) => {
        const c = document.createElement("canvas");
        c.width = o.width;
        c.height = o.height;
        const x = c.getContext("2d");
        if (o.pattern) {
          const p = x.createImageData(c.width, c.height);
          for (let y = 0; y < c.height; y++)
            for (let v = 0; v < c.width; v++) {
              const i = (y * c.width + v) * 4;
              p.data[i] = v % 251;
              p.data[i + 1] = y % 253;
              p.data[i + 2] = Math.floor(v / 251) * 20;
              p.data[i + 3] = 255;
            }
          x.putImageData(p, 0, 0);
        } else {
          x.fillStyle = o.color;
          x.fillRect(
            o.border,
            o.border,
            c.width - o.border * 2,
            c.height - o.border * 2,
          );
        }
        if (o.logo) {
          x.clearRect(0, 0, c.width, c.height);
          x.fillStyle = o.color;
          x.fillRect(c.width / 4, c.height / 4, c.width / 2, c.height / 2);
        }
        return c.toDataURL().split(",")[1];
      },
      { width, height, color, border, pattern, logo },
    ),
    "base64",
  );
}
export const upload = (page, id, buffer, name = "image.png") =>
  page.locator("#" + id).setInputFiles({ name, mimeType: "image/png", buffer });
export async function download(page, selector) {
  const p = page.waitForEvent("download");
  await page.locator(selector).click();
  const d = await p;
  return {
    name: d.suggestedFilename(),
    bytes: fs.readFileSync(await d.path()),
  };
}
export function pngSize(bytes) {
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}
export function unzip(bytes) {
  const out = new Map();
  let p = 0;
  while (bytes.readUInt32LE(p) === 0x04034b50) {
    const compression = bytes.readUInt16LE(p + 8),
      size = bytes.readUInt32LE(p + 18),
      nl = bytes.readUInt16LE(p + 26),
      el = bytes.readUInt16LE(p + 28),
      name = bytes.toString("utf8", p + 30, p + 30 + nl),
      start = p + 30 + nl + el;
    expect(compression).toBe(0);
    out.set(name, bytes.subarray(start, start + size));
    p = start + size;
  }
  expect(bytes.readUInt32LE(p)).toBe(0x02014b50);
  return out;
}
export async function pixels(page, bytes) {
  return page.evaluate(
    async (src) => {
      const im = await EditorCore.image(src),
        c = EditorCore.canvas(im.width, im.height),
        x = c.getContext("2d");
      x.drawImage(im, 0, 0);
      const p = x.getImageData(0, 0, c.width, c.height).data;
      let transparentEdges = 0;
      for (let y = 0; y < c.height; y++)
        for (let v = 0; v < c.width; v++)
          if (
            (v === 0 || y === 0 || v === c.width - 1 || y === c.height - 1) &&
            p[(y * c.width + v) * 4 + 3] !== 255
          )
            transparentEdges++;
      return {
        transparentEdges,
        corner: Array.from(p.slice(0, 4)),
        center: Array.from(
          p.slice(
            (Math.floor(c.height / 2) * c.width + Math.floor(c.width / 2)) * 4,
            (Math.floor(c.height / 2) * c.width + Math.floor(c.width / 2)) * 4 +
              4,
          ),
        ),
      };
    },
    "data:image/png;base64," + bytes.toString("base64"),
  );
}
export async function fakePhotopea(page) {
  const bundle = fs.readFileSync(
    new URL("../assets/psd.js", import.meta.url),
    "utf8",
  );
  await page.route("https://www.photopea.com/**", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: `<!doctype html><title>Fake Photopea - no network</title><script>${bundle}</script><script>
    let doc,bytes;window.commandLog=[];
    addEventListener('message',async e=>{window.commandLog.push(typeof e.data==='string'?e.data:'PSD');try{
      if(e.data instanceof ArrayBuffer){bytes=e.data;doc=PSD.readPsd(bytes);window.doc=doc;}
      else if(e.data.includes('saveToOE("png")')){if(!doc)throw Error('Нет документа');const blob=await new Promise(r=>doc.canvas.toBlob(r));parent.postMessage(await blob.arrayBuffer(),e.origin);}
      else if(e.data.includes('saveToOE("psd")'))parent.postMessage(bytes,e.origin);
      else if(e.data.includes('PM_META:')){if(!doc)throw Error('Нет документа');parent.postMessage('PM_META:'+JSON.stringify({width:doc.width,height:doc.height,count:doc.children.length}),e.origin);}
    }catch(error){parent.postMessage('PM_ERROR:'+error.message,e.origin);}parent.postMessage('done',e.origin);});
    parent.postMessage('done','*');
  </script>`,
    }),
  );
}
export async function photopeaDoc(page) {
  const f = page
    .frames()
    .find((f) => f.url().startsWith("https://www.photopea.com"));
  return f.evaluate(() => ({
    width: doc.width,
    height: doc.height,
    layers: doc.children.map((l) => ({
      name: l.name,
      left: l.left,
      top: l.top,
      opacity: l.opacity,
      hidden: l.hidden,
      locked: l.protected?.position,
      text: l.text?.text,
      transform: l.placedLayer?.transform,
    })),
  }));
}
