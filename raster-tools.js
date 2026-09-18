/*
 * Raster helpers for Skooma Multitool.
 *
 * Flood-fill / magic-selection behavior is adapted from miniPaint's MIT-licensed
 * Magic Eraser implementation:
 * https://github.com/viliusle/miniPaint
 * Original author: Vilius L.
 *
 * This file is an independent integration for Skooma Multitool. The original
 * miniPaint UI and application architecture are not copied.
 */
window.SkoomaRaster = (() => {
  function canvas(width, height) {
    const el = document.createElement("canvas");
    el.width = Math.max(1, Math.round(width));
    el.height = Math.max(1, Math.round(height));
    return el;
  }

  function sourceCanvasFromFabricImage(imageObject) {
    const element = imageObject.getElement();
    const width = Math.max(1, Math.round(imageObject.width || element?.naturalWidth || element?.videoWidth || element?.width || 1));
    const height = Math.max(1, Math.round(imageObject.height || element?.naturalHeight || element?.videoHeight || element?.height || 1));
    const out = canvas(width, height);
    const ctx = out.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(element, 0, 0, width, height);
    return out;
  }

  function sceneToPixel(F, object, point) {
    const matrix = object.calcTransformMatrix();
    const inverse = F.util.invertTransform(matrix);
    const local = F.util.transformPoint(new F.Point(point.x, point.y), inverse);
    return {
      x: local.x + (object.width || 0) / 2,
      y: local.y + (object.height || 0) / 2
    };
  }

  function scenePointsToPixels(F, object, points) {
    return points.map(point => sceneToPixel(F, object, point));
  }

  function polygonMask(width, height, points) {
    const out = canvas(width, height);
    if (!points?.length) return out;
    const ctx = out.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.closePath();
    ctx.fill();
    return out;
  }

  function rectMaskForObject(F, object, rect) {
    const x1 = Math.min(rect.x, rect.x + rect.width);
    const x2 = Math.max(rect.x, rect.x + rect.width);
    const y1 = Math.min(rect.y, rect.y + rect.height);
    const y2 = Math.max(rect.y, rect.y + rect.height);
    const points = [
      { x: x1, y: y1 },
      { x: x2, y: y1 },
      { x: x2, y: y2 },
      { x: x1, y: y2 }
    ];
    return polygonMask(
      object.width,
      object.height,
      scenePointsToPixels(F, object, points)
    );
  }

  function polygonMaskForObject(F, object, scenePoints) {
    return polygonMask(
      object.width,
      object.height,
      scenePointsToPixels(F, object, scenePoints)
    );
  }

  function floodMask(imageData, seedX, seedY, tolerancePercent = 18, contiguous = true) {
    const { width, height, data } = imageData;
    const x = Math.max(0, Math.min(width - 1, Math.round(seedX)));
    const y = Math.max(0, Math.min(height - 1, Math.round(seedY)));
    const seedIndex = (y * width + x) * 4;
    const seed = [
      data[seedIndex],
      data[seedIndex + 1],
      data[seedIndex + 2],
      data[seedIndex + 3]
    ];
    const threshold = Math.max(0, Math.min(100, Number(tolerancePercent) || 0)) * 255 / 100;
    const selected = new Uint8Array(width * height);

    const matches = pixelIndex => {
      const i = pixelIndex * 4;
      return Math.abs(data[i] - seed[0]) <= threshold &&
        Math.abs(data[i + 1] - seed[1]) <= threshold &&
        Math.abs(data[i + 2] - seed[2]) <= threshold &&
        Math.abs(data[i + 3] - seed[3]) <= threshold;
    };

    if (!contiguous) {
      for (let pixel = 0; pixel < selected.length; pixel += 1) {
        if (matches(pixel)) selected[pixel] = 255;
      }
      return selected;
    }

    const stack = [y * width + x];
    selected[y * width + x] = 255;
    const dx = [0, -1, 1, 0];
    const dy = [-1, 0, 0, 1];

    while (stack.length) {
      const pixel = stack.pop();
      const px = pixel % width;
      const py = Math.floor(pixel / width);

      for (let d = 0; d < 4; d += 1) {
        const nx = px + dx[d];
        const ny = py + dy[d];
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (selected[next]) continue;
        if (!matches(next)) continue;
        selected[next] = 255;
        stack.push(next);
      }
    }
    return selected;
  }

  function maskArrayToCanvas(mask, width, height) {
    const out = canvas(width, height);
    const ctx = out.getContext("2d");
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;
    for (let i = 0; i < mask.length; i += 1) {
      const k = i * 4;
      data[k] = 255;
      data[k + 1] = 255;
      data[k + 2] = 255;
      data[k + 3] = mask[i];
    }
    ctx.putImageData(imageData, 0, 0);
    return out;
  }

  function featherMask(maskCanvas, pixels = 0) {
    const amount = Math.max(0, Number(pixels) || 0);
    if (!amount) {
      const copy = canvas(maskCanvas.width, maskCanvas.height);
      copy.getContext("2d").drawImage(maskCanvas, 0, 0);
      return copy;
    }
    const out = canvas(maskCanvas.width, maskCanvas.height);
    const ctx = out.getContext("2d");
    ctx.filter = "blur(" + amount + "px)";
    ctx.drawImage(maskCanvas, 0, 0);
    ctx.filter = "none";
    return out;
  }

  function invertMask(maskCanvas) {
    const out = canvas(maskCanvas.width, maskCanvas.height);
    const ctx = out.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(maskCanvas, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    return out;
  }

  function overlayFromMask(maskCanvas, color = "rgba(111,125,255,.44)") {
    const out = canvas(maskCanvas.width, maskCanvas.height);
    const ctx = out.getContext("2d");
    ctx.drawImage(maskCanvas, 0, 0);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.globalCompositeOperation = "source-over";
    return out;
  }

  function applyDelete(sourceCanvas, maskCanvas, feather = 0) {
    const out = canvas(sourceCanvas.width, sourceCanvas.height);
    const ctx = out.getContext("2d");
    ctx.drawImage(sourceCanvas, 0, 0);
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(featherMask(maskCanvas, feather), 0, 0);
    ctx.globalCompositeOperation = "source-over";
    return out;
  }

  function applyKeep(sourceCanvas, maskCanvas, feather = 0) {
    const out = canvas(sourceCanvas.width, sourceCanvas.height);
    const ctx = out.getContext("2d");
    ctx.drawImage(sourceCanvas, 0, 0);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(featherMask(maskCanvas, feather), 0, 0);
    ctx.globalCompositeOperation = "source-over";
    return out;
  }

  function eraseStroke(sourceCanvas, points, lineWidth) {
    const out = canvas(sourceCanvas.width, sourceCanvas.height);
    const ctx = out.getContext("2d");
    ctx.drawImage(sourceCanvas, 0, 0);
    if (!points?.length) return out;
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "#fff";
    ctx.fillStyle = "#fff";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(1, Number(lineWidth) || 1);
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    if (points.length === 1) {
      ctx.arc(points[0].x, points[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      for (let i = 1; i < points.length; i += 1) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
    return out;
  }

  function canvasToDataUrl(input) {
    return input.toDataURL("image/png");
  }

  function isMaskEmpty(maskCanvas) {
    const ctx = maskCanvas.getContext("2d", { willReadFrequently: true });
    const data = ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i]) return false;
    }
    return true;
  }

  return {
    canvas,
    sourceCanvasFromFabricImage,
    sceneToPixel,
    scenePointsToPixels,
    polygonMask,
    rectMaskForObject,
    polygonMaskForObject,
    floodMask,
    maskArrayToCanvas,
    featherMask,
    invertMask,
    overlayFromMask,
    applyDelete,
    applyKeep,
    eraseStroke,
    canvasToDataUrl,
    isMaskEmpty
  };
})();