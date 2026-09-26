// Offline unit-test harness. It does NOT replace the Playwright/browser suite.
import fs from "node:fs";
import { Window } from "happy-dom";
import { createCanvas, Image, ImageData } from "@napi-rs/canvas";
import { IDBFactory } from "fake-indexeddb";
import { webcrypto } from "node:crypto";

export async function app(t) {
  const w = new Window({
    url: "http://localhost:4173/",
    settings: {
      enableJavaScriptEvaluation: true,
      suppressInsecureJavaScriptEnvironmentWarning: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableIframePageLoading: true,
    },
  });
  const canvasMap = new WeakMap(),
    imageMap = new WeakMap(),
    downloads = [],
    blobs = new Map(),
    errors = [];
  // Happy DOM's native Blob checks the Node realm's ArrayBuffer constructor.
  // Browser code runs in another VM realm; preserve binary bytes across that seam.
  const BlobBase = w.Blob;
  w.Blob = class extends BlobBase {
    constructor(parts = [], options) {
      super(
        parts.map((p) =>
          Object.prototype.toString.call(p) === "[object ArrayBuffer]"
            ? Buffer.from(new Uint8Array(p))
            : p,
        ),
        options,
      );
    }
  };
  // fake-indexeddb uses Node's structuredClone, which does not know Happy DOM Blob.
  // Blobs are immutable; preserve them while cloning the surrounding stored records.
  const originalClone=globalThis.structuredClone;
  function cloneStored(value,seen=new Map()) {
    if(value instanceof w.Blob) return value;
    if(value && (Array.isArray(value)||Object.prototype.toString.call(value)==="[object Object]")) {
      if(seen.has(value)) return seen.get(value);
      const out=Array.isArray(value)?[]:{};seen.set(value,out);
      for(const [key,item] of Object.entries(value))out[key]=cloneStored(item,seen);return out;
    }
    return originalClone(value);
  }
  globalThis.structuredClone=cloneStored;
  t.after(()=>{globalThis.structuredClone=originalClone;});
  w.addEventListener("error", (e) => errors.push(e.message));
  Object.defineProperty(w, "indexedDB", { value: new IDBFactory() });
  w.structuredClone = structuredClone;
  class LocalImage extends Image {
    set src(value) {
      if(typeof value==="string" && /^(?:http:\/\/localhost:4173\/|assets\/)/.test(value)) {
        const rel=value.replace("http://localhost:4173/", "").split("?")[0];
        super.src=fs.readFileSync(new URL("../"+rel,import.meta.url));
      } else super.src=value;
    }
    get src(){return super.src;}
  }
  w.Image = LocalImage;
  w.createImageBitmap=async blob=>{const img=new LocalImage();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;blob.arrayBuffer().then(bytes=>{img.src=Buffer.from(bytes);});});img.close=()=>{};return img;};
  w.devicePixelRatio=1;
  w.confirm=()=>true;
  w.ImageData = ImageData;
  Object.defineProperty(w, "crypto", { value: webcrypto });
  w.fetch = async (url) => {
    if (String(url).startsWith("data:")) {
      const r = await fetch(url);
      return {
        ok: true,
        blob: async () =>
          new w.Blob([await r.arrayBuffer()], {
            type: r.headers.get("content-type"),
          }),
        arrayBuffer: () => r.arrayBuffer(),
      };
    }
    if (/\/api\/(config|health|status)$/.test(String(url)))
      return {
        ok: true,
        json: async () => ({apiVersion:"2026-09-23-runtime-v4", providers:{}, background:{}, images:{}, tmdbConfigured: false, aiEnabled: false }),
      };
    const rel=String(url).replace("http://localhost:4173/", "").split("?")[0];
    if(rel.startsWith("assets/")) { const bytes=fs.readFileSync(new URL("../"+rel,import.meta.url));return {ok:true,json:async()=>JSON.parse(bytes),text:async()=>bytes.toString(),blob:async()=>new w.Blob([bytes],{type:rel.endsWith("svg")?"image/svg+xml":"application/octet-stream"})}; }
    throw new Error("Network disabled in unit tests: " + url);
  };
  function native(el) {
    if (
      !canvasMap.has(el) ||
      canvasMap.get(el).width !== el.width ||
      canvasMap.get(el).height !== el.height
    )
      canvasMap.set(
        el,
        createCanvas(Math.max(1, el.width), Math.max(1, el.height)),
      );
    return canvasMap.get(el);
  }
  w.HTMLCanvasElement.prototype.getContext = function () {
    const ctx = native(this).getContext("2d");
    return new Proxy(ctx, {
      get(target, key) {
        if (key === "drawImage")
          return (im, ...args) =>
            target.drawImage(
              im instanceof w.HTMLCanvasElement
                ? native(im)
                : imageMap.get(im) || im,
              ...args,
            );
        const v = target[key];
        return typeof v === "function" ? v.bind(target) : v;
      },
      set(target, key, v) {
        target[key] = v;
        return true;
      },
    });
  };
  w.HTMLCanvasElement.prototype.toDataURL = function (type = "image/png") {
    return native(this).toDataURL(type);
  };
  w.HTMLCanvasElement.prototype.toBlob = function (callback) {
    callback(
      new w.Blob([native(this).toBuffer("image/png")], { type: "image/png" }),
    );
  };
  Object.defineProperty(w.HTMLImageElement.prototype, "src", {
    get() {
      return this.getAttribute("src") || "";
    },
    set(value) {
      this.setAttribute("src", value);
      const im = new LocalImage();
      imageMap.set(this, im);
      im.onload = () => {
        this.dispatchEvent(new w.Event("load"));
      };
      im.onerror = () => {
        this.dispatchEvent(new w.Event("error"));
      };
      im.src = value;
    },
  });
  for (const k of ["naturalWidth", "naturalHeight", "width", "height"])
    Object.defineProperty(w.HTMLImageElement.prototype, k, {
      get() {
        return imageMap.get(this)?.[k] || Number(this.getAttribute(k)) || 0;
      },
      set(value){this.setAttribute(k,value);},
    });
  w.URL.createObjectURL = (blob) => {
    const u = "blob:unit-" + blobs.size;
    blobs.set(u, blob);
    return u;
  };
  w.URL.revokeObjectURL = (u) => blobs.delete(u);
  w.HTMLAnchorElement.prototype.click = function () {
    downloads.push({ name: this.download, blob: blobs.get(this.href) });
  };
  w.document.write(
    fs
      .readFileSync(new URL("../index.html", import.meta.url), "utf8")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ""),
  );
  for (const file of [
    "assets/fabric.js", "editor-core.js", "storage.js", "zip-store.js", "asset-manager.js",
    "local-background-removal.js", "image-filters.js", "poster-app.js", "train-editor.js",
    "top10-editor.js", "filter-studio.js", "public-image-search.js", "source-browser.js", "photopea-bridge.js",
    "range-number-sync.js", "workspace-tools.js"
  ]) {
    try {w.eval(fs.readFileSync(new URL("../" + file, import.meta.url), "utf8"));}
    catch(error){throw new Error(file+": "+error.message,{cause:error});}
  }
  t.after(async () => {
    await w.happyDOM.abort();
    w.close();
  });
  await settle();
  const el = (id) => w.document.getElementById(id);
  async function input(id, value, type = "input") {
    const e = el(id);
    if (typeof value === "boolean") e.checked = value;
    else e.value = String(value);
    e.dispatchEvent(new w.Event(type, { bubbles: true }));
    await settle();
  }
  async function file(id, bytes, name = "test.png", type = "image/png") {
    const dt = new w.DataTransfer();
    dt.items.add(new w.File([bytes], name, { type }));
    el(id).files = dt.files;
    el(id).dispatchEvent(new w.Event("change", { bubbles: true }));
    const state = () => {
      if(id==="top10BackgroundInput") return w.Top10Editor.getState().backgroundName===name;
      if(id==="top10LogoInput") return w.Top10Editor.getState().logoName===name;
      if(id==="posterFileInput") return w.PosterApp.getState()[w.PosterApp.getActiveFormat()].posterName===name;
      if(id==="logoFileInput") return w.PosterApp.getState()[w.PosterApp.getActiveFormat()].logoName===name;
      if(id==="trainImageInput" || id==="trainLogoInput") return w.TrainEditor.serialize().canvas.objects.some(o=>o.name===name);
      return true;
    };
    for (let n = 0; n < 100; n++) {
      await settle();
      if (state()) break;
    }
    await settle();
  }
  async function click(id) {
    el(id).click();
    await settle();
  }
  async function take(id) {
    const n = downloads.length;
    await click(id);
    for (let i = 0; i < 100 && downloads.length === n; i++)
      await new Promise((r) => setTimeout(r, 10));
    if (downloads.length === n)
      throw Error(
        "No download from " +
          id +
          ": " +
          el("posterStatus").textContent +
          " " +
          el("trainStatus").textContent,
      );
    const d = downloads.at(-1);
    return { name: d.name, bytes: Buffer.from(await d.blob.arrayBuffer()) };
  }
  return { w, el, input, file, click, take, errors, native };
}
export async function settle() {
  await new Promise((r) => setTimeout(r, 30));
}
export function fixture(width = 320, height = 240, options = {}) {
  const c = createCanvas(width, height),
    x = c.getContext("2d");
  if (options.pattern) {
    const p = x.createImageData(width, height);
    for (let y = 0; y < height; y++)
      for (let v = 0; v < width; v++) {
        const k = (y * width + v) * 4;
        p.data[k] = v % 251;
        p.data[k + 1] = y % 253;
        p.data[k + 2] = Math.floor(v / 251) * 20;
        p.data[k + 3] = 255;
      }
    x.putImageData(p, 0, 0);
  } else {
    x.fillStyle = options.color || "#ee4433";
    const b = options.border || 0;
    x.fillRect(b, b, width - 2 * b, height - 2 * b);
    if (options.logo) x.clearRect(0, 0, width / 2, height);
  }
  return c.toBuffer("image/png");
}
export function unzip(b) {
  const m = new Map();
  let p = 0;
  while (b.readUInt32LE(p) === 0x04034b50) {
    const n = b.readUInt16LE(p + 26),
      e = b.readUInt16LE(p + 28),
      size = b.readUInt32LE(p + 18),
      start = p + 30 + n + e;
    m.set(
      b.toString("utf8", p + 30, p + 30 + n),
      b.subarray(start, start + size),
    );
    p = start + size;
  }
  return m;
}
