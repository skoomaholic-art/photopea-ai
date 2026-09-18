/* Heavy raster operations for Skooma Studio.
 * magic-wand-tool 1.1.7 (MIT) is loaded from a pinned CDN URL.
 */
importScripts("https://unpkg.com/magic-wand-tool@1.1.7/dist/magic-wand.min.js");

self.onmessage = event => {
  const { id, type, payload } = event.data || {};
  try {
    if (type === "magic-wand") {
      const { width, height, data, x, y, tolerance } = payload;
      const image = {
        data: new Uint8ClampedArray(data),
        width,
        height,
        bytes: 4
      };
      const mask = self.MagicWand.floodFill(image, x, y, tolerance, null, true);
      if (!mask) {
        self.postMessage({ id, ok: true, result: null });
        return;
      }
      const out = mask.data instanceof Uint8Array ? mask.data : new Uint8Array(mask.data);
      self.postMessage({
        id,
        ok: true,
        result: {
          width: mask.width || width,
          height: mask.height || height,
          bounds: mask.bounds || null,
          data: out.buffer
        }
      }, [out.buffer]);
      return;
    }

    if (type === "histogram") {
      const { data } = payload;
      const pixels = new Uint8ClampedArray(data);
      const histogram = {
        r: new Uint32Array(256),
        g: new Uint32Array(256),
        b: new Uint32Array(256),
        luma: new Uint32Array(256)
      };
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2], a = pixels[i + 3];
        if (!a) continue;
        histogram.r[r]++;
        histogram.g[g]++;
        histogram.b[b]++;
        histogram.luma[Math.max(0, Math.min(255, Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)))]++;
      }
      self.postMessage({
        id,
        ok: true,
        result: {
          r: histogram.r.buffer,
          g: histogram.g.buffer,
          b: histogram.b.buffer,
          luma: histogram.luma.buffer
        }
      }, [histogram.r.buffer, histogram.g.buffer, histogram.b.buffer, histogram.luma.buffer]);
      return;
    }

    throw new Error("Unknown raster worker operation: " + type);
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message || String(error) });
  }
};