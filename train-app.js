(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const C = window.EditorCore;
  let ready = false;
  const persist = C.autosaver(
    "train-v1",
    () => JSON.parse(projectData()),
    (text) => ($("trainSaveStatus").textContent = text),
  );
  const W = 2952,
    H = 366,
    SEG = 492,
    COUNT = 6;
  const TARGETS = [
    { w: 164, h: 122, folder: "1 - 164x122" },
    { w: 246, h: 183, folder: "2 - 246x183" },
    { w: 328, h: 244, folder: "3 - 328x244" },
    { w: 492, h: 366, folder: "4 - 492x366" },
  ];
  const STICKERS = [
    ["none", "Без стикера", "none"],
    ["premiere", "Премьера", "gradient"],
    ["new-series", "Новые серии", "gradient"],
    ["new-series-kk", "Жаңа сериялар", "gradient"],
    ["new-season", "Новый сезон", "gradient"],
    ["new-season-kk", "Жаңа маусым", "gradient"],
    ["all-series", "Все серии", "gradient"],
    ["all-series-kk", "Барлық сериялар", "gradient"],
    ["new", "Новинка", "gradient"],
    ["new-kk", "Жаңа", "gradient"],
    ["exclusive", "Эксклюзив", "exclusive"],
    ["soon", "Скоро…", "dark"],
    ["soon-kk", "Жуырда…", "dark"],
    ["leaving", "Скоро уйдёт", "yellow"],
    ["leaving-kk", "Көріп үлгер", "yellow"],
  ].map(([id, label, style]) => ({ id, label, style }));
  const state = {
    background: "#101d16",
    layers: [],
    selected: null,
    sticker: { id: "none", x: 18, y: 18, scale: 1 },
    view: "unified",
    zoom: 50,
    previewSize: 3,
    exportSize: 3,
    history: [],
    future: [],
    activated: false,
    drag: null,
  };
  const imageCache = new Map();
  const canvas = $("trainCanvas"),
    ctx = canvas.getContext("2d");

  function uid(prefix = "layer") {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }
  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }
  function snapshot() {
    return {
      background: state.background,
      layers: state.layers,
      selected: state.selected,
      sticker: state.sticker,
      photopeaPsd: state.photopeaPsd,
      view: state.view,
      zoom: state.zoom,
      previewSize: state.previewSize,
      exportSize: state.exportSize,
    };
  }
  function restore(data) {
    state.background = data.background || "#101d16";
    state.photopeaPsd = data.photopeaPsd || null;
    state.layers = data.layers || [];
    state.view = data.view === "device" ? "device" : "unified";
    state.zoom = C.clamp(data.zoom || 50, 10, 100);
    state.previewSize = C.clamp(data.previewSize ?? 3, 0, 3);
    state.exportSize = C.clamp(data.exportSize ?? 3, 0, 3);
    canvas.style.width = (W * state.zoom) / 100 + "px";
    $("trainZoomInput").value = state.zoom;
    $("trainZoomValue").textContent = state.zoom + "%";
    $("trainPreviewSize").value = state.previewSize;
    $("trainExportSize").value = state.exportSize;
    state.selected = data.selected || null;
    state.sticker = {
      id: "none",
      x: 18,
      y: 18,
      scale: 1,
      ...(data.sticker || {}),
    };
    clampSticker();
    updateStickerPreview();
    $("trainBackgroundColor").value = state.background;
  }
  function commit() {
    state.history.push(clone(snapshot()));
    if (state.history.length > 40) state.history.shift();
    state.future = [];
    updateHistory();
  }
  function undo() {
    if (!state.history.length) return;
    state.future.push(clone(snapshot()));
    restore(state.history.pop());
    render();
  }
  function redo() {
    if (!state.future.length) return;
    state.history.push(clone(snapshot()));
    restore(state.future.pop());
    render();
  }
  function imageFor(src) {
    if (imageCache.has(src)) return Promise.resolve(imageCache.get(src));
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        imageCache.set(src, image);
        resolve(image);
      };
      image.onerror = reject;
      image.src = src;
    });
  }
  function fileData(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  function fitFor(image, maxW, maxH) {
    const ratio = Math.min(
      maxW / image.naturalWidth,
      maxH / image.naturalHeight,
    );
    return { w: image.naturalWidth * ratio, h: image.naturalHeight * ratio };
  }
  function selectedLayer() {
    return state.layers.find((layer) => layer.id === state.selected) || null;
  }
  function selectedSticker() {
    return STICKERS.find((item) => item.id === state.sticker.id) || STICKERS[0];
  }
  function stickerMetrics(
    item = selectedSticker(),
    scale = state.sticker.scale,
    renderScale = 1,
  ) {
    if (item.id === "none") return { w: 0, h: 0 };
    ctx.save();
    ctx.font = "700 42px Arial, sans-serif";
    const base = Math.max(130, ctx.measureText(item.label).width + 48);
    ctx.restore();
    return { w: base * scale * renderScale, h: 70 * scale * renderScale, base };
  }
  function clampSticker() {
    if (!STICKERS.some((i) => i.id === state.sticker.id))
      state.sticker.id = "none";
    const m = stickerMetrics(selectedSticker(), 1);
    state.sticker.scale = C.clamp(
      state.sticker.scale,
      0.3,
      Math.min(1.8, (SEG - 32) / (m.base || 130), (H - 32) / 70),
    );
    const r = stickerMetrics();
    state.sticker.x = C.clamp(state.sticker.x, 12, SEG - r.w - 12);
    state.sticker.y = C.clamp(state.sticker.y, 12, H - r.h - 12);
  }
  function roundRect(context, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    context.beginPath();
    context.moveTo(x + radius, y);
    context.arcTo(x + w, y, x + w, y + h, radius);
    context.arcTo(x + w, y + h, x, y + h, radius);
    context.arcTo(x, y + h, x, y, radius);
    context.arcTo(x, y, x + w, y, radius);
    context.closePath();
  }
  function drawSticker(context, sticker = state.sticker, scaleFactor = 1) {
    const item = STICKERS.find((entry) => entry.id === sticker.id);
    if (!item || item.id === "none") return;
    const m = stickerMetrics(item, sticker.scale, scaleFactor);
    const x = sticker.x * scaleFactor,
      y = sticker.y * scaleFactor;
    context.save();
    context.beginPath();
    context.rect(0, 0, SEG * scaleFactor, H * scaleFactor);
    context.clip();
    context.font = `700 ${42 * sticker.scale * scaleFactor}px Arial, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    let fill,
      stroke = "#c9fff0",
      text = "#fff";
    if (item.style === "gradient") {
      fill = context.createLinearGradient(x, y, x + m.w, y + m.h);
      fill.addColorStop(0, "#0496a9");
      fill.addColorStop(1, "#23d887");
    }
    if (item.style === "dark") {
      fill = "#07110d";
      stroke = "#98b9a5";
    }
    if (item.style === "yellow") {
      fill = "#ffd638";
      stroke = "#fff0a0";
      text = "#10150f";
    }
    if (item.style === "exclusive") {
      fill = "#07110d";
      stroke = "#39e6d0";
    }
    roundRect(context, x, y, m.w, m.h, 16 * scaleFactor);
    context.fillStyle = fill;
    context.fill();
    context.lineWidth = 4 * scaleFactor;
    context.strokeStyle = stroke;
    context.stroke();
    context.fillStyle = text;
    context.fillText(item.label, x + m.w / 2, y + m.h / 2 + 1 * scaleFactor);
    context.restore();
  }
  function drawImageLayer(context, layer, targetScale = 1) {
    const image = imageCache.get(layer.src);
    if (!image || !image.naturalWidth) return;
    const x = layer.x * targetScale,
      y = layer.y * targetScale,
      w = layer.w * targetScale,
      h = layer.h * targetScale;
    const cropX = Math.max(0, Math.min(1, layer.cropX ?? 0.5)),
      cropY = Math.max(0, Math.min(1, layer.cropY ?? 0.5));
    const sourceRatio = image.naturalWidth / image.naturalHeight,
      targetRatio = layer.w / layer.h;
    let sw = image.naturalWidth,
      sh = image.naturalHeight;
    if (sourceRatio > targetRatio) {
      sw = image.naturalHeight * targetRatio;
    } else {
      sh = image.naturalWidth / targetRatio;
    }
    sw /= Math.max(1, layer.cropZoom || 1);
    sh /= Math.max(1, layer.cropZoom || 1);
    const sx = (image.naturalWidth - sw) * cropX,
      sy = (image.naturalHeight - sh) * cropY;
    context.save();
    context.translate(x + w / 2, y + h / 2);
    context.rotate(((layer.rotation || 0) * Math.PI) / 180);
    context.drawImage(image, sx, sy, sw, sh, -w / 2, -h / 2, w, h);
    context.restore();
  }
  function croppedSource(l) {
    const im = imageCache.get(l.src),
      ratio = l.w / l.h;
    let sw = im.naturalWidth,
      sh = im.naturalHeight;
    if (sw / sh > ratio) sw = sh * ratio;
    else sh = sw / ratio;
    sw /= Math.max(1, l.cropZoom || 1);
    sh /= Math.max(1, l.cropZoom || 1);
    const c = C.canvas(Math.max(1, Math.ceil(sw)), Math.max(1, Math.ceil(sh)));
    c.getContext("2d").drawImage(
      im,
      (im.naturalWidth - sw) * (l.cropX ?? 0.5),
      (im.naturalHeight - sh) * (l.cropY ?? 0.5),
      sw,
      sh,
      0,
      0,
      c.width,
      c.height,
    );
    return {
      src: c.toDataURL(),
      rect: {
        x: l.x + l.w / 2,
        y: l.y + l.h / 2,
        w: l.w,
        h: l.h,
        rotation: l.rotation || 0,
      },
    };
  }
  function drawTextLayer(context, layer, targetScale = 1) {
    context.save();
    context.translate(
      (layer.x + layer.w / 2) * targetScale,
      (layer.y + layer.h / 2) * targetScale,
    );
    context.rotate(((layer.rotation || 0) * Math.PI) / 180);
    context.font = `${layer.bold ? "700" : "400"} ${layer.fontSize * (layer.w / layer.baseW) * targetScale}px Arial, sans-serif`;
    context.fillStyle = layer.color || "#fff";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(layer.text, 0, 0);
    context.restore();
  }
  function renderComposition(
    targetContext,
    targetW = W,
    targetH = H,
    includeSticker = true,
    includeGuides = false,
  ) {
    const scale = targetW / W;
    targetContext.clearRect(0, 0, targetW, targetH);
    targetContext.fillStyle = state.background;
    targetContext.fillRect(0, 0, targetW, targetH);
    state.layers.forEach((layer) => {
      if (layer.visible === false) return;
      targetContext.globalAlpha = layer.opacity ?? 1;
      if (layer.type === "image") drawImageLayer(targetContext, layer, scale);
      else if (layer.type === "text")
        drawTextLayer(targetContext, layer, scale);
    });
    targetContext.globalAlpha = 1;
    if (includeSticker) drawSticker(targetContext, state.sticker, scale);
    if (includeGuides) {
      targetContext.save();
      targetContext.strokeStyle = "#8cf06b99";
      targetContext.fillStyle = "#d9ffcf";
      targetContext.font = `700 ${22 * scale}px Arial,sans-serif`;
      targetContext.lineWidth = Math.max(1, 2 * scale);
      for (let i = 1; i < COUNT; i++) {
        const x = i * SEG * scale;
        targetContext.beginPath();
        targetContext.moveTo(x, 0);
        targetContext.lineTo(x, targetH);
        targetContext.stroke();
      }
      for (let i = 0; i < COUNT; i++) {
        targetContext.fillText(
          String(i + 1),
          i * SEG * scale + 10 * scale,
          28 * scale,
        );
      }
      targetContext.restore();
    }
  }
  function render() {
    renderComposition(ctx, W, H, true, true);
    renderLayerList();
    renderControls();
    renderPreview();
    updateHistory();
    $("trainStickerScale").value = Math.round(state.sticker.scale * 100);
    $("trainStickerScaleValue").textContent =
      Math.round(state.sticker.scale * 100) + "%";
    updateStickerPreview();
    if (ready) persist();
  }
  function renderPreview() {
    $("trainUnifiedBtn").classList.toggle("active", state.view === "unified");
    $("trainDeviceBtn").classList.toggle("active", state.view === "device");
    $("trainCanvasShell").parentElement.hidden = state.view !== "unified";
    $("trainDevicePreview").hidden = state.view !== "device";
    if (state.view !== "device") return;
    const holder = $("trainDevicePreview");
    holder.innerHTML = "";
    const target = TARGETS[state.previewSize];
    const master = document.createElement("canvas");
    master.width = W;
    master.height = H;
    renderComposition(master.getContext("2d"), W, H, true, false);
    const scaled = C.canvas(target.w * COUNT, target.h);
    scaled
      .getContext("2d")
      .drawImage(master, 0, 0, scaled.width, scaled.height);
    for (let i = 0; i < COUNT; i++) {
      const card = document.createElement("div");
      card.className = "train-device-card";
      card.style.width = target.w + "px";
      const c = document.createElement("canvas");
      c.width = target.w;
      c.height = target.h;
      c.getContext("2d").drawImage(
        scaled,
        i * target.w,
        0,
        target.w,
        target.h,
        0,
        0,
        target.w,
        target.h,
      );
      const label = document.createElement("span");
      label.textContent = `${i + 1} · ${target.w}×${target.h}`;
      card.append(c, label);
      holder.append(card);
    }
  }
  function renderLayerList() {
    const list = $("trainLayerList");
    list.innerHTML = "";
    if (!state.layers.length) {
      list.innerHTML =
        '<p class="inline-status">Добавьте изображение или текст.</p>';
      $("trainLayerCount").textContent = "0";
      return;
    }
    $("trainLayerCount").textContent = String(state.layers.length);
    [...state.layers].reverse().forEach((layer) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = `train-layer-item${layer.id === state.selected ? " active" : ""}`;
      item.innerHTML = `<span>${escapeHtml(layer.name)}<small>${layer.type === "image" ? `${Math.round(layer.w)}×${Math.round(layer.h)} px` : "Текст"}</small></span><b>›</b>`;
      item.addEventListener("click", () => {
        state.selected = layer.id;
        render();
      });
      list.append(item);
    });
  }
  function renderControls() {
    const layer = selectedLayer();
    $("trainRemoveBgBtn").disabled =
      !layer || layer.type !== "image" || layer.locked || removingBackground;
    $("trainSelectedName").textContent = layer ? layer.name : "Нет выбора";
    $("trainLayerControls").style.opacity = layer ? "1" : ".45";
    [
      "trainLayerScale",
      "trainLayerRotation",
      "trainCropX",
      "trainCropY",
      "trainLayerUp",
      "trainLayerDown",
      "trainLayerDelete",
    ].forEach((id) => ($(id).disabled = !layer || layer.locked));
    for (const id of [
      "trainLayerX",
      "trainLayerY",
      "trainCropZoom",
      "trainTextEdit",
      "trainTextColor",
    ])
      $(id).disabled = !layer || layer.locked;
    $("trainLayerLock").disabled = !layer;
    $("trainLayerVisible").disabled = !layer;
    $("trainLayerOpacity").disabled = !layer || layer.locked;
    if (layer) {
      $("trainLayerLock").checked = !!layer.locked;
      $("trainLayerLockLabel").textContent = layer.locked
        ? "Заблокирован"
        : "Открыт";
      $("trainLayerVisible").checked = layer.visible !== false;
      $("trainLayerOpacity").value = (layer.opacity ?? 1) * 100;
      $("trainLayerX").value = Math.round(layer.x);
      $("trainLayerY").value = Math.round(layer.y);
      $("trainCropZoom").value = (layer.cropZoom || 1) * 100;
      $("trainTextEdit").value = layer.text || "";
      $("trainTextColor").value = layer.color || "#ffffff";
    }
    if (!layer) return;
    const base = layer.baseW || layer.w;
    $("trainLayerScale").value = Math.round((layer.w / base) * 100);
    $("trainLayerScaleValue").textContent =
      `${Math.round((layer.w / base) * 100)}%`;
    $("trainLayerRotation").value = layer.rotation || 0;
    $("trainLayerRotationValue").textContent = `${layer.rotation || 0}°`;
    $("trainCropX").value = Math.round((layer.cropX ?? 0.5) * 100);
    $("trainCropY").value = Math.round((layer.cropY ?? 0.5) * 100);
  }
  function updateHistory() {
    $("trainUndoBtn").disabled = !state.history.length;
    $("trainRedoBtn").disabled = !state.future.length;
  }
  function escapeHtml(value) {
    return String(value).replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    );
  }
  function updateStickerPreview() {
    const item = selectedSticker();
    $("trainStickerSelectedLabel").textContent = item.label;
    const holder = $("trainStickerSelectedPreview");
    holder.innerHTML = "";
    const c = document.createElement("canvas");
    c.width = 120;
    c.height = 50;
    drawSticker(c.getContext("2d"), {
      ...state.sticker,
      x: 5,
      y: 5,
      scale: 0.34,
    });
    holder.append(c);
    $("trainStickerMenu")
      .querySelectorAll(".train-sticker-option")
      .forEach((button) =>
        button.classList.toggle("active", button.dataset.sticker === item.id),
      );
  }
  function buildStickerMenu() {
    const menu = $("trainStickerMenu");
    STICKERS.forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "train-sticker-option";
      button.dataset.sticker = item.id;
      const c = document.createElement("canvas");
      c.width = 120;
      c.height = 54;
      drawSticker(c.getContext("2d"), { id: item.id, x: 5, y: 5, scale: 0.32 });
      button.append(c, document.createTextNode(item.label));
      button.addEventListener("click", () => {
        commit();
        state.sticker.id = item.id;
        if (item.id !== "none") clampSticker();
        $("trainStickerMenu").hidden = true;
        $("trainStickerMenuButton").setAttribute("aria-expanded", "false");
        updateStickerPreview();
        render();
      });
      menu.append(button);
    });
    updateStickerPreview();
  }
  async function addImage(file, fullCanvas = false) {
    const src = await fileData(file);
    const image = await imageFor(src);
    if (
      image.naturalWidth < (fullCanvas ? W : 900) ||
      image.naturalHeight < (fullCanvas ? H : 330)
    ) {
      $("trainQualityStatus").textContent =
        "Предупреждение: исходник имеет небольшое разрешение и может потерять качество при экспорте.";
      $("trainQualityStatus").className = "inline-status train-quality-warning";
    }
    const fit = fullCanvas ? { w: W, h: H } : fitFor(image, 900, 330);
    const layer = {
      id: uid("image"),
      type: "image",
      name: file.name || "Изображение",
      src,
      x: fullCanvas ? 0 : (W - fit.w) / 2,
      y: fullCanvas ? 0 : (H - fit.h) / 2,
      w: fit.w,
      h: fit.h,
      baseW: fit.w,
      baseH: fit.h,
      rotation: 0,
      cropX: 0.5,
      cropY: 0.5,
    };
    commit();
    state.layers.push(layer);
    state.selected = layer.id;
    render();
  }
  async function handleFiles(files, fullCanvas = false) {
    for (const file of files)
      try {
        await addImage(file, fullCanvas);
      } catch (error) {
        $("trainQualityStatus").textContent =
          "Не удалось загрузить изображение: " + error.message;
        $("trainQualityStatus").className = "inline-status train-quality-error";
      }
  }
  function setLayerScale(value) {
    const layer = selectedLayer();
    if (!layer || layer.locked) return;
    const ratio = Number(value) / 100;
    const cx = layer.x + layer.w / 2,
      cy = layer.y + layer.h / 2;
    layer.w = layer.baseW * ratio;
    layer.h = layer.baseH * ratio;
    layer.x = cx - layer.w / 2;
    layer.y = cy - layer.h / 2;
    render();
  }
  function setLayerRotation(value) {
    const layer = selectedLayer();
    if (!layer || layer.locked) return;
    layer.rotation = Number(value);
    render();
  }
  function hitTest(x, y) {
    if (state.sticker.id !== "none") {
      const m = stickerMetrics();
      if (
        x >= state.sticker.x &&
        x <= state.sticker.x + m.w &&
        y >= state.sticker.y &&
        y <= state.sticker.y + m.h
      )
        return "sticker";
    }
    for (let i = state.layers.length - 1; i >= 0; i--) {
      const l = state.layers[i];
      if (l.locked || l.visible === false) continue;
      const a = (-(l.rotation || 0) * Math.PI) / 180,
        dx = x - l.x - l.w / 2,
        dy = y - l.y - l.h / 2;
      if (
        Math.abs(dx * Math.cos(a) - dy * Math.sin(a)) <= l.w / 2 &&
        Math.abs(dx * Math.sin(a) + dy * Math.cos(a)) <= l.h / 2
      )
        return l;
    }
    return null;
  }
  function pointerPosition(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * W) / rect.width,
      y: ((event.clientY - rect.top) * H) / rect.height,
    };
  }
  canvas.addEventListener("pointerdown", (event) => {
    const p = pointerPosition(event),
      hit = hitTest(p.x, p.y);
    if (!hit) return;
    commit();
    canvas.setPointerCapture(event.pointerId);
    state.drag = {
      hit,
      start: p,
      origin:
        hit === "sticker"
          ? { x: state.sticker.x, y: state.sticker.y }
          : { x: hit.x, y: hit.y },
      moved: false,
    };
    state.selected = hit === "sticker" ? null : hit.id;
    canvas.classList.add("layer-dragging");
    render();
  });
  canvas.addEventListener("pointermove", (event) => {
    const d = state.drag;
    if (!d) return;
    const p = pointerPosition(event),
      dx = p.x - d.start.x,
      dy = p.y - d.start.y;
    d.moved = true;
    if (d.hit === "sticker") {
      const m = stickerMetrics();
      state.sticker.x = Math.max(12, Math.min(SEG - m.w - 12, d.origin.x + dx));
      state.sticker.y = Math.max(12, Math.min(H - m.h - 12, d.origin.y + dy));
    } else {
      d.hit.x = Math.max(
        -d.hit.w * 0.8,
        Math.min(W - d.hit.w * 0.2, d.origin.x + dx),
      );
      d.hit.y = Math.max(
        -d.hit.h * 0.8,
        Math.min(H - d.hit.h * 0.2, d.origin.y + dy),
      );
    }
    render();
  });
  canvas.addEventListener("pointerup", (event) => {
    if (state.drag) {
      state.drag = null;
      canvas.classList.remove("layer-dragging");
      if (canvas.hasPointerCapture(event.pointerId))
        canvas.releasePointerCapture(event.pointerId);
    }
  });
  canvas.addEventListener("pointercancel", () => {
    state.drag = null;
    canvas.classList.remove("layer-dragging");
  });
  canvas.addEventListener(
    "wheel",
    (event) => {
      const p = pointerPosition(event),
        hit = hitTest(p.x, p.y);
      if (!hit) return;
      event.preventDefault();
      commit();
      const ratio = event.deltaY < 0 ? 1.05 : 0.95;
      if (hit === "sticker") {
        state.sticker.scale = Math.max(
          0.5,
          Math.min(1.8, state.sticker.scale * ratio),
        );
        clampSticker();
        render();
        return;
      }
      if (state.selected === hit.id)
        setLayerScale(
          Math.max(10, Math.min(300, (hit.w / hit.baseW) * 100 * ratio)),
        );
    },
    { passive: false },
  );
  async function addText() {
    const text = $("trainTextInput").value.trim();
    if (!text) return;
    commit();
    const layer = {
      id: uid("text"),
      type: "text",
      name: text.slice(0, 28),
      text,
      fontSize: 72,
      bold: true,
      color: "#ffffff",
      w: Math.max(160, text.length * 45),
      h: 90,
      x: W / 2 - Math.max(160, text.length * 45) / 2,
      y: H / 2 - 45,
      baseW: Math.max(160, text.length * 45),
      baseH: 90,
      rotation: 0,
    };
    state.layers.push(layer);
    state.selected = layer.id;
    $("trainTextInput").value = "";
    render();
  }
  function addBackground() {
    commit();
    state.background = $("trainBackgroundColor").value;
    render();
  }
  function reorder(direction) {
    const index = state.layers.findIndex((l) => l.id === state.selected);
    if (index < 0) return;
    const next = index + direction;
    if (next < 0 || next >= state.layers.length) return;
    commit();
    [state.layers[index], state.layers[next]] = [
      state.layers[next],
      state.layers[index],
    ];
    render();
  }
  function deleteLayer() {
    const index = state.layers.findIndex((l) => l.id === state.selected);
    if (index < 0) return;
    commit();
    state.layers.splice(index, 1);
    state.selected = null;
    render();
  }
  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  function zipStore(entries) {
    const encoder = new TextEncoder(),
      parts = [],
      central = [];
    let offset = 0;
    const put16 = (v, o, n) => v.setUint16(o, n, true),
      put32 = (v, o, n) => v.setUint32(o, n, true);
    for (const entry of entries) {
      const name = encoder.encode(entry.name),
        bytes = new Uint8Array(entry.bytes),
        crc = crc32(bytes),
        header = new Uint8Array(30 + name.length),
        view = new DataView(header.buffer);
      put32(view, 0, 0x04034b50);
      put16(view, 4, 20);
      put16(view, 6, 0);
      put16(view, 8, 0);
      put32(view, 14, crc);
      put32(view, 18, bytes.length);
      put32(view, 22, bytes.length);
      put16(view, 26, name.length);
      header.set(name, 30);
      parts.push(header, bytes);
      const record = new Uint8Array(46 + name.length),
        cv = new DataView(record.buffer);
      put32(cv, 0, 0x02014b50);
      put16(cv, 4, 20);
      put16(cv, 6, 20);
      put32(cv, 16, crc);
      put32(cv, 20, bytes.length);
      put32(cv, 24, bytes.length);
      put16(cv, 28, name.length);
      put32(cv, 42, offset);
      record.set(name, 46);
      central.push(record);
      offset += header.length + bytes.length;
    }
    const centralOffset = offset;
    central.forEach((record) => {
      parts.push(record);
      offset += record.length;
    });
    const end = new Uint8Array(22),
      ev = new DataView(end.buffer);
    put32(ev, 0, 0x06054b50);
    put16(ev, 8, entries.length);
    put16(ev, 10, entries.length);
    put32(ev, 12, offset - centralOffset);
    put32(ev, 16, centralOffset);
    parts.push(end);
    return new Blob(parts, { type: "application/zip" });
  }
  function pngBytes(canvasElement) {
    return new Promise((resolve, reject) =>
      canvasElement.toBlob(
        (blob) =>
          blob
            ? blob.arrayBuffer().then(resolve).catch(reject)
            : reject(new Error("Не удалось подготовить PNG")),
        "image/png",
      ),
    );
  }
  async function exportZip(all) {
    const status = $("trainExportStatus"),
      button = all ? $("trainDownloadAllBtn") : $("trainDownloadSelectedBtn"),
      old = button.textContent;
    button.disabled = true;
    button.textContent = "Собираю ZIP...";
    status.textContent = "Рендерю исходную композицию без направляющих...";
    try {
      const master = document.createElement("canvas");
      master.width = W;
      master.height = H;
      renderComposition(master.getContext("2d"), W, H, true, false);
      const indexes = all ? [0, 1, 2, 3] : [Number(state.exportSize)],
        entries = [];
      for (const index of indexes) {
        const target = TARGETS[index],
          full = document.createElement("canvas");
        full.width = target.w * COUNT;
        full.height = target.h;
        full
          .getContext("2d")
          .drawImage(master, 0, 0, W, H, 0, 0, full.width, full.height);
        for (let part = 0; part < COUNT; part++) {
          const out = document.createElement("canvas");
          out.width = target.w;
          out.height = target.h;
          out
            .getContext("2d")
            .drawImage(
              full,
              part * target.w,
              0,
              target.w,
              target.h,
              0,
              0,
              target.w,
              target.h,
            );
          entries.push({
            name: `${target.folder}/part_${part + 1}.png`,
            bytes: await pngBytes(out),
          });
        }
      }
      downloadBlob(
        zipStore(entries),
        all
          ? "Паровозик.zip"
          : `Паровозик - ${TARGETS[state.exportSize].folder}.zip`,
      );
      status.textContent = all
        ? "Готово: 4 папки и 24 PNG в архиве."
        : "Готово: 1 папка и 6 PNG в архиве.";
      status.className = "inline-status train-quality-status";
    } catch (error) {
      status.textContent = `Ошибка экспорта: ${error.message}`;
      status.className = "inline-status train-quality-error";
    } finally {
      button.disabled = false;
      button.textContent = old;
    }
  }
  function projectData() {
    return JSON.stringify(
      {
        version: 1,
        type: "poster-markup-train",
        master: { width: W, height: H, segments: COUNT, segmentWidth: SEG },
        background: state.background,
        layers: state.layers,
        sticker: state.sticker,
        photopeaPsd: state.photopeaPsd,
      },
      null,
      2,
    );
  }
  function saveProject() {
    downloadBlob(
      new Blob([projectData()], { type: "application/json" }),
      "Паровозик-project.json",
    );
    $("trainExportStatus").textContent = "Проект сохранён в JSON.";
  }
  async function openProject(file) {
    try {
      const data = JSON.parse(await file.text());
      if (
        data.type !== "poster-markup-train" ||
        data.master?.width !== W ||
        data.master?.height !== H
      )
        throw new Error("Это не проект Паровозика нужного формата.");
      if (!Array.isArray(data.layers) || data.layers.length > 100)
        throw new Error("Неверный список слоёв");
      for (const layer of data.layers) {
        if (
          !["image", "text"].includes(layer.type) ||
          ![layer.x, layer.y, layer.w, layer.h, layer.rotation || 0].every(
            Number.isFinite,
          ) ||
          layer.w <= 0 ||
          layer.h <= 0
        )
          throw new Error("Неверные параметры слоя");
        if (layer.type === "image") await imageFor(layer.src);
      }
      commit();
      restore(data);
      render();
      $("trainExportStatus").textContent =
        "Проект открыт, можно продолжать редактирование.";
    } catch (error) {
      $("trainExportStatus").textContent =
        `Ошибка открытия проекта: ${error.message}`;
      $("trainExportStatus").className = "inline-status train-quality-error";
    }
  }
  function activate() {
    if (state.activated) return;
    state.activated = true;
    canvas.style.width = `${(W * state.zoom) / 100}px`;
    render();
  }
  $("trainWideInput").addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (file) {
      $("trainWideName").textContent = file.name;
      handleFiles([file], true);
    }
  });
  $("trainLayerInput").addEventListener("change", (event) => {
    const files = [...event.target.files];
    $("trainLayerName").textContent = files.length
      ? `${files.length} файл(а/ов) выбрано`
      : "Слои не выбраны";
    handleFiles(files);
  });
  $("trainAddTextBtn").addEventListener("click", addText);
  $("trainAddBackgroundBtn").addEventListener("click", addBackground);
  $("trainUndoBtn").addEventListener("click", undo);
  $("trainRedoBtn").addEventListener("click", redo);
  $("trainLayerUp").addEventListener("click", () => reorder(1));
  $("trainLayerDown").addEventListener("click", () => reorder(-1));
  $("trainLayerDelete").addEventListener("click", deleteLayer);
  $("trainSaveBtn").addEventListener("click", saveProject);
  $("trainOpenInput").addEventListener("change", (event) => {
    if (event.target.files[0]) openProject(event.target.files[0]);
  });
  $("trainDownloadAllBtn").addEventListener("click", () => exportZip(true));
  $("trainDownloadSelectedBtn").addEventListener("click", () =>
    exportZip(false),
  );
  $("trainExportSize").addEventListener("change", (event) => {
    state.exportSize = Number(event.target.value);
    if (ready) persist();
  });
  $("trainPreviewSize").addEventListener("change", (event) => {
    state.previewSize = Number(event.target.value);
    renderPreview();
    if (ready) persist();
  });
  $("trainZoomInput").addEventListener("input", (event) => {
    $("trainZoomValue").textContent = `${event.target.value}%`;
    const value = Number(event.target.value);
    state.zoom = value;
    if (ready) persist();
    canvas.style.width = `${(value * W) / 100}px`;
  });
  $("trainUnifiedBtn").addEventListener("click", () => {
    state.view = "unified";
    renderPreview();
    if (ready) persist();
  });
  $("trainDeviceBtn").addEventListener("click", () => {
    state.view = "device";
    renderPreview();
    if (ready) persist();
  });
  $("trainStickerMenuButton").addEventListener("click", () => {
    const menu = $("trainStickerMenu");
    menu.hidden = !menu.hidden;
    $("trainStickerMenuButton").setAttribute(
      "aria-expanded",
      String(!menu.hidden),
    );
  });
  $("trainStickerScale").addEventListener("input", (event) => {
    state.sticker.scale = Number(event.target.value) / 100;
    clampSticker();
    $("trainStickerScaleValue").textContent = `${event.target.value}%`;
    updateStickerPreview();
    render();
  });
  $("trainLayerScale").addEventListener("input", (event) =>
    setLayerScale(event.target.value),
  );
  $("trainLayerRotation").addEventListener("input", (event) =>
    setLayerRotation(event.target.value),
  );
  $("trainCropX").addEventListener("input", (event) => {
    const l = selectedLayer();
    if (l && !l.locked) {
      l.cropX = Number(event.target.value) / 100;
      render();
    }
  });
  $("trainCropY").addEventListener("input", (event) => {
    const l = selectedLayer();
    if (l && !l.locked) {
      l.cropY = Number(event.target.value) / 100;
      render();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (
      $("trainWorkspace").hidden ||
      event.target.closest("input,textarea,select")
    )
      return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      event.shiftKey ? redo() : undo();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      redo();
    }
  });
  for (const id of [
    "trainStickerScale",
    "trainLayerScale",
    "trainLayerRotation",
    "trainCropX",
    "trainCropY",
    "trainLayerX",
    "trainLayerY",
    "trainCropZoom",
    "trainLayerOpacity",
    "trainTextEdit",
    "trainTextColor",
  ]) {
    $(id).addEventListener("pointerdown", () => commit());
    $(id).addEventListener("keydown", (e) => {
      if (!e.repeat) commit();
    });
  }
  for (const [id, key] of [
    ["trainLayerX", "x"],
    ["trainLayerY", "y"],
    ["trainCropZoom", "cropZoom"],
    ["trainLayerOpacity", "opacity"],
    ["trainTextEdit", "text"],
    ["trainTextColor", "color"],
  ])
    $(id).addEventListener("input", (e) => {
      const l = selectedLayer();
      if (!l || l.locked) return;
      l[key] = ["text", "color"].includes(key)
        ? e.target.value
        : Number(e.target.value) /
          (["cropZoom", "opacity"].includes(key) ? 100 : 1);
      render();
    });
  $("trainLayerLock").addEventListener("change", (e) => {
    const l = selectedLayer();
    if (l) {
      commit();
      l.locked = e.target.checked;
      state.drag = null;
      render();
    }
  });
  $("trainLayerVisible").addEventListener("change", (e) => {
    const l = selectedLayer();
    if (l) {
      commit();
      l.visible = e.target.checked;
      render();
    }
  });
  buildStickerMenu();
  let removingBackground = false;
  $("trainRemoveBgBtn").addEventListener("click", async () => {
    const layer = selectedLayer();
    if (!layer || layer.type !== "image" || layer.locked || removingBackground)
      return;
    const original = layer.src;
    removingBackground = true;
    renderControls();
    $("trainQualityStatus").textContent = "Удаляю фон локально...";
    try {
      const src = await C.removeBackground(original);
      await imageFor(src);
      if (!state.layers.includes(layer) || layer.src !== original)
        throw new Error("Исходный слой изменился во время обработки");
      commit();
      layer.src = src;
      render();
      $("trainQualityStatus").textContent =
        "Фон удалён. Положение, кадрирование и поворот сохранены.";
    } catch (e) {
      $("trainQualityStatus").textContent =
        "Не удалось удалить фон: " + e.message;
    } finally {
      removingBackground = false;
      renderControls();
    }
  });
  C.register("train", {
    activate,
    savedPsd: () => state.photopeaPsd,
    getState: () => clone(state),
    async document() {
      const bg = C.canvas(W, H);
      bg.getContext("2d").fillStyle = state.background;
      bg.getContext("2d").fillRect(0, 0, W, H);
      const children = [
        {
          name: "Canvas Background",
          canvas: bg,
          protected: { position: true },
        },
      ];
      for (const l of state.layers) {
        const c = C.canvas(W, H),
          cx = c.getContext("2d");
        if (l.type === "image") drawImageLayer(cx, l);
        else drawTextLayer(cx, l);
        children.push({
          name: l.name,
          canvas: c,
          ...(l.type === "image" ? { source: croppedSource(l) } : {}),
          hidden: l.visible === false,
          opacity: l.opacity ?? 1,
          protected: { position: !!l.locked },
        });
      }
      if (state.sticker.id !== "none") {
        const c = C.canvas(W, H);
        drawSticker(c.getContext("2d"));
        children.push({
          name: "Sticker · " + selectedSticker().label,
          canvas: c,
        });
      }
      return { width: W, height: H, name: "Паровозик", children };
    },
    async addPoster(src, name) {
      await imageFor(src);
      await addImage(
        new File([await (await fetch(src)).blob()], name || "Постер", {
          type: "image/png",
        }),
      );
    },
    async receive(src, meta) {
      await imageFor(src);
      commit();
      state.layers.forEach((l) => (l.visible = false));
      state.sticker.id = "none";
      state.photopeaPsd = meta.psd;
      await addImage(
        new File([await (await fetch(src)).blob()], "Photopea · результат", {
          type: "image/png",
        }),
        true,
      );
    },
  });
  C.read("train-v1")
    .then(async (s) => {
      if (s)
        await openProject(
          new Blob([JSON.stringify(s)], { type: "application/json" }),
        );
    })
    .catch(() => {
      $("trainSaveStatus").textContent = "Автосохранение недоступно";
    })
    .finally(() => {
      ready = true;
      render();
    });
  window.PosterTrain = {
    activate,
    exportAll: () => exportZip(true),
    renderComposition,
    stickerMetrics,
    hitTest,
    getState: () => clone(state),
  };
})();
