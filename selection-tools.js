window.SkoomaSelectionTools = {
  create(options) {
    const { canvas, Fabric: F, getTool, getActiveImage, getDocumentSize, onSelectionChanged } = options;
    const state = {
      current: null,
      drawing: false,
      start: null,
      points: [],
      overlay: null,
      maskOverlay: null
    };

    function isSelectionTool(tool) {
      return ["marquee", "lasso", "wand", "crop"].includes(tool);
    }

    function removeObject(object) {
      if (!object) return;
      try { canvas.remove(object); } catch {}
    }

    function clearVisuals() {
      removeObject(state.overlay);
      removeObject(state.maskOverlay);
      state.overlay = null;
      state.maskOverlay = null;
      canvas.requestRenderAll();
    }

    function clear() {
      clearVisuals();
      state.current = null;
      state.drawing = false;
      state.start = null;
      state.points = [];
      onSelectionChanged?.(null);
    }

    function selectionStyle(fill = "rgba(111,125,255,.11)") {
      return {
        fill,
        stroke: "#85a0ff",
        strokeWidth: 1.5,
        strokeDashArray: [7, 5],
        selectable: false,
        evented: false,
        objectCaching: false,
        excludeFromExport: true,
        name: "__selection__",
        hoverCursor: "crosshair"
      };
    }

    function normalizeRect(a, b, ratio = "") {
      let x = a.x;
      let y = a.y;
      let width = b.x - a.x;
      let height = b.y - a.y;

      if (ratio) {
        const [rw, rh] = ratio.split(":").map(Number);
        if (rw > 0 && rh > 0) {
          const desired = rw / rh;
          const sx = Math.sign(width) || 1;
          const sy = Math.sign(height) || 1;
          const aw = Math.abs(width);
          const ah = Math.abs(height);
          if (ah === 0 || aw / Math.max(1, ah) > desired) {
            height = sy * aw / desired;
          } else {
            width = sx * ah * desired;
          }
        }
      }

      if (width < 0) {
        x += width;
        width = Math.abs(width);
      }
      if (height < 0) {
        y += height;
        height = Math.abs(height);
      }

      const doc = getDocumentSize();
      x = Math.max(0, Math.min(doc.width, x));
      y = Math.max(0, Math.min(doc.height, y));
      width = Math.max(0, Math.min(width, doc.width - x));
      height = Math.max(0, Math.min(height, doc.height - y));
      return { x, y, width, height };
    }

    function drawRect(rect, isCrop = false) {
      removeObject(state.overlay);
      state.overlay = new F.Rect({
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        ...selectionStyle(isCrop ? "rgba(0,0,0,.04)" : "rgba(111,125,255,.11)")
      });
      if (isCrop) state.overlay.set({ stroke: "#f6c767", strokeDashArray: [10, 6] });
      canvas.add(state.overlay);
      canvas.bringObjectToFront(state.overlay);
      canvas.requestRenderAll();
    }

    function drawLasso(points, closed = false) {
      removeObject(state.overlay);
      if (points.length < 2) return;
      state.overlay = closed
        ? new F.Polygon(points, selectionStyle("rgba(111,125,255,.09)"))
        : new F.Polyline(points, { ...selectionStyle("rgba(111,125,255,.05)"), fill: "rgba(111,125,255,.03)" });
      canvas.add(state.overlay);
      canvas.bringObjectToFront(state.overlay);
      canvas.requestRenderAll();
    }

    async function showMask(maskCanvas, target) {
      removeObject(state.maskOverlay);
      if (!maskCanvas || !target) return;
      const overlayCanvas = SkoomaRaster.overlayFromMask(maskCanvas);
      const overlay = await F.FabricImage.fromURL(overlayCanvas.toDataURL("image/png"));
      overlay.set({
        left: target.left,
        top: target.top,
        scaleX: target.scaleX,
        scaleY: target.scaleY,
        angle: target.angle,
        skewX: target.skewX,
        skewY: target.skewY,
        flipX: target.flipX,
        flipY: target.flipY,
        originX: target.originX,
        originY: target.originY,
        opacity: 0.62,
        selectable: false,
        evented: false,
        excludeFromExport: true,
        name: "__selection_mask__"
      });
      state.maskOverlay = overlay;
      canvas.add(overlay);
      canvas.bringObjectToFront(overlay);
      canvas.requestRenderAll();
    }

    async function createWand(point) {
      const target = getActiveImage();
      if (!target) {
        onSelectionChanged?.({ error: "Magic Wand работает по выбранному image layer." });
        return;
      }
      const source = SkoomaRaster.sourceCanvasFromFabricImage(target);
      const pixel = SkoomaRaster.sceneToPixel(F, target, point);
      if (pixel.x < 0 || pixel.y < 0 || pixel.x >= source.width || pixel.y >= source.height) {
        return;
      }
      const imageData = source.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, source.width, source.height);
      const tolerance = Number(document.getElementById("wandTolerance")?.value || 18);
      const contiguous = document.getElementById("wandContiguous")?.checked !== false;
      const maskArray = SkoomaRaster.floodMask(imageData, pixel.x, pixel.y, tolerance, contiguous);
      const maskCanvas = SkoomaRaster.maskArrayToCanvas(maskArray, source.width, source.height);
      if (SkoomaRaster.isMaskEmpty(maskCanvas)) return;
      clearVisuals();
      state.current = { type: "mask", maskCanvas, target, inverted: false };
      await showMask(maskCanvas, target);
      onSelectionChanged?.(state.current);
    }

    function boundsFromMask(maskCanvas) {
      const ctx = maskCanvas.getContext("2d", { willReadFrequently: true });
      const data = ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;
      let minX = maskCanvas.width;
      let minY = maskCanvas.height;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < maskCanvas.height; y += 1) {
        for (let x = 0; x < maskCanvas.width; x += 1) {
          if (data[(y * maskCanvas.width + x) * 4 + 3] > 5) {
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          }
        }
      }
      return maxX < minX ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
    }

    function getMaskForActiveImage() {
      const target = getActiveImage();
      if (!target || !state.current) return null;

      if (state.current.type === "mask") {
        if (state.current.target !== target) return null;
        return state.current.maskCanvas;
      }

      if (state.current.type === "rect" || state.current.type === "crop") {
        return SkoomaRaster.rectMaskForObject(F, target, state.current.rect);
      }

      if (state.current.type === "lasso") {
        return SkoomaRaster.polygonMaskForObject(F, target, state.current.points);
      }
      return null;
    }

    async function invert() {
      if (!state.current) return;
      const target = getActiveImage();
      const mask = getMaskForActiveImage();
      if (!target || !mask) {
        onSelectionChanged?.({ error: "Для инверсии выберите image layer." });
        return;
      }
      const inverted = SkoomaRaster.invertMask(mask);
      clearVisuals();
      state.current = { type: "mask", maskCanvas: inverted, target, inverted: !state.current.inverted };
      await showMask(inverted, target);
      onSelectionChanged?.(state.current);
    }

    function getSceneBounds() {
      if (!state.current) return null;
      if (state.current.type === "rect" || state.current.type === "crop") {
        return { ...state.current.rect };
      }
      if (state.current.type === "lasso") {
        const xs = state.current.points.map(point => point.x);
        const ys = state.current.points.map(point => point.y);
        return {
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys)
        };
      }
      if (state.current.type === "mask" && state.current.target) {
        const local = boundsFromMask(state.current.maskCanvas);
        if (!local) return null;
        const target = state.current.target;
        const matrix = target.calcTransformMatrix();
        const corners = [
          new F.Point(local.x - target.width / 2, local.y - target.height / 2),
          new F.Point(local.x + local.width - target.width / 2, local.y - target.height / 2),
          new F.Point(local.x + local.width - target.width / 2, local.y + local.height - target.height / 2),
          new F.Point(local.x - target.width / 2, local.y + local.height - target.height / 2)
        ].map(point => F.util.transformPoint(point, matrix));
        const xs = corners.map(point => point.x);
        const ys = corners.map(point => point.y);
        return {
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys)
        };
      }
      return null;
    }

    function handleMouseDown(event) {
      const tool = getTool();
      if (!isSelectionTool(tool)) return false;
      const point = canvas.getScenePoint(event.e);

      if (tool === "wand") {
        createWand(point);
        return true;
      }

      state.drawing = true;
      state.start = point;
      state.points = [point];

      if (tool === "marquee" || tool === "crop") {
        const rect = normalizeRect(point, point, tool === "crop" ? (document.getElementById("cropRatio")?.value || "") : "");
        state.current = { type: tool === "crop" ? "crop" : "rect", rect };
        drawRect(rect, tool === "crop");
      } else if (tool === "lasso") {
        state.current = { type: "lasso", points: [...state.points] };
      }
      return true;
    }

    function handleMouseMove(event) {
      if (!state.drawing) return false;
      const tool = getTool();
      if (!["marquee", "lasso", "crop"].includes(tool)) return false;
      const point = canvas.getScenePoint(event.e);

      if (tool === "marquee" || tool === "crop") {
        const rect = normalizeRect(
          state.start,
          point,
          tool === "crop" ? (document.getElementById("cropRatio")?.value || "") : ""
        );
        state.current = { type: tool === "crop" ? "crop" : "rect", rect };
        drawRect(rect, tool === "crop");
      } else {
        const last = state.points[state.points.length - 1];
        const dx = point.x - last.x;
        const dy = point.y - last.y;
        if (dx * dx + dy * dy > 9) state.points.push(point);
        state.current = { type: "lasso", points: [...state.points] };
        drawLasso(state.points, false);
      }
      return true;
    }

    function handleMouseUp() {
      if (!state.drawing) return false;
      const tool = getTool();
      state.drawing = false;

      if (tool === "lasso" && state.points.length >= 3) {
        state.current = { type: "lasso", points: [...state.points] };
        drawLasso(state.points, true);
      }

      if ((state.current?.type === "rect" || state.current?.type === "crop") &&
          (state.current.rect.width < 2 || state.current.rect.height < 2)) {
        clear();
        return true;
      }

      onSelectionChanged?.(state.current);
      return true;
    }

    return {
      state,
      isSelectionTool,
      handleMouseDown,
      handleMouseMove,
      handleMouseUp,
      clear,
      invert,
      getMaskForActiveImage,
      getSceneBounds,
      showMask
    };
  }
};