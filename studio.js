window.Studio = (() => {
  const $ = id => document.getElementById(id);
  const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const F = window.fabric;

  if (!F) {
    console.error("Fabric.js failed to load.");
    return {};
  }

  const CUSTOM_PROPS = [
    "uuid", "name", "assetId", "source", "kind",
    "originalSrc", "rasterSrc", "maskSrc", "maskBaseSrc"
  ];
  F.FabricObject.customProperties = CUSTOM_PROPS;

  const canvas = new F.Canvas("studioCanvas", {
    preserveObjectStacking: true,
    selection: true,
    backgroundColor: null,
    fireRightClick: true,
    stopContextMenu: true
  });

  const state = {
    width: 1280,
    height: 720,
    transparent: true,
    tool: "move",
    viewScale: 1,
    panX: 0,
    panY: 0,
    isPanning: false,
    lastPointer: null,
    history: [],
    historyIndex: -1,
    historyMuted: false,
    autosaveTimer: null,
    restoring: false,
    clipboard: null,
    previousTool: null,
    guides: [],
    eraser: null,
    eraserPreview: null,
    nodeHandles: [],
    nodeTarget: null
  };

  const MAX_HISTORY = 35;

  function docObjects() {
    return canvas.getObjects().filter(object => !object.excludeFromExport);
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function uid() {
    return APP.uid("obj");
  }

  function objectName(object) {
    if (object?.name) return object.name;
    if (object instanceof F.IText || object instanceof F.Textbox) return "Text";
    if (object instanceof F.FabricImage) return "Image";
    if (object instanceof F.Rect) return "Rectangle";
    if (object instanceof F.Ellipse) return "Ellipse";
    if (object instanceof F.Path) return "Path";
    if (object instanceof F.Group) return "Group";
    return "Object";
  }

  function objectKind(object) {
    if (object?.kind) return object.kind;
    if (object instanceof F.IText || object instanceof F.Textbox) return "text";
    if (object instanceof F.FabricImage) return "image";
    if (object instanceof F.Path) return "vector";
    if (object instanceof F.Group) return "group";
    if (object instanceof F.Rect || object instanceof F.Ellipse) return "shape";
    return "object";
  }

  function assignObjectMetadata(object, name, extra = {}) {
    object.uuid = object.uuid || extra.uuid || uid();
    object.name = name || objectName(object);
    object.kind = extra.kind || objectKind(object);
    if (extra.assetId !== undefined) object.assetId = extra.assetId;
    if (extra.source !== undefined) object.source = extra.source;
    if (extra.originalSrc !== undefined) object.originalSrc = extra.originalSrc;
    if (extra.rasterSrc !== undefined) object.rasterSrc = extra.rasterSrc;
    if (extra.maskSrc !== undefined) object.maskSrc = extra.maskSrc;
    if (extra.maskBaseSrc !== undefined) object.maskBaseSrc = extra.maskBaseSrc;
    object.set({
      transparentCorners: false,
      cornerColor: "#6f7dff",
      cornerStrokeColor: "#ffffff",
      borderColor: "#6f7dff",
      cornerStyle: "circle",
      padding: 1
    });
    return object;
  }

  function setDocumentSize(width, height) {
    state.width = Math.max(1, Math.round(width));
    state.height = Math.max(1, Math.round(height));
    canvas.setDimensions({ width: state.width, height: state.height });
    $("docStatus").textContent = state.width + " × " + state.height;
    fitToViewport();
  }

  function getDocumentSize() {
    return { width: state.width, height: state.height };
  }

  function applyViewTransform() {
    const wrapper = canvas.wrapperEl;
    if (!wrapper) return;
    wrapper.style.transformOrigin = "center center";
    wrapper.style.transform = "translate(" + state.panX + "px," + state.panY + "px) scale(" + state.viewScale + ")";
    $("zoomStatus").textContent = Math.round(state.viewScale * 100) + "%";
  }

  function fitToViewport() {
    const viewport = $("canvasViewport");
    if (!viewport || !canvas.wrapperEl) return;
    const rect = viewport.getBoundingClientRect();
    const next = Math.min((rect.width - 48) / state.width, (rect.height - 48) / state.height, 1);
    state.viewScale = Math.max(0.05, Number.isFinite(next) ? next : 1);
    state.panX = 0;
    state.panY = 0;
    applyViewTransform();
    refreshNodeHandles();
  }

  function setZoom(next) {
    state.viewScale = Math.max(0.05, Math.min(6, next));
    applyViewTransform();
    refreshNodeHandles();
  }

  function setContext(name) {
    [
      "contextDefault", "contextBrush", "contextText", "contextMove",
      "contextSelection", "contextWand", "contextCrop", "contextNode"
    ].forEach(id => $(id).classList.add("hidden"));
    $(name).classList.remove("hidden");
  }

  function getActiveImage() {
    const active = canvas.getActiveObject();
    return active instanceof F.FabricImage && !active.excludeFromExport ? active : null;
  }

  function clearTransient() {
    clearGuides();
    clearNodeHandles(false);
    if (!selectionTools?.isSelectionTool(state.tool)) selectionTools?.clear();
    if (state.eraserPreview) {
      canvas.remove(state.eraserPreview);
      state.eraserPreview = null;
    }
    state.eraser = null;
  }

  function setTool(tool) {
    if (state.tool === "node" && tool !== "node") clearNodeHandles(true);
    state.tool = tool;
    qsa(".tool-button[data-tool]").forEach(btn => btn.classList.toggle("active", btn.dataset.tool === tool));

    canvas.isDrawingMode = false;
    canvas.selection = tool === "move";
    canvas.skipTargetFind = [
      "brush", "eraser", "hand", "zoom", "marquee", "lasso", "wand", "crop", "node"
    ].includes(tool);
    canvas.defaultCursor = tool === "hand" ? "grab" :
      tool === "zoom" ? "zoom-in" :
      ["marquee", "lasso", "wand", "crop", "eraser"].includes(tool) ? "crosshair" : "default";

    if (tool === "brush") {
      const brush = new F.PencilBrush(canvas);
      brush.width = Math.max(1, Number($("brushSize").value) || 18);
      const opacity = Math.max(0.05, Number($("brushOpacity").value) || 1);
      brush.color = hexToRgba($("brushColor").value, opacity);
      canvas.freeDrawingBrush = brush;
      canvas.isDrawingMode = true;
      setContext("contextBrush");
    } else if (tool === "eraser") {
      setContext("contextBrush");
    } else if (tool === "text") {
      setContext("contextText");
    } else if (tool === "move") {
      setContext(canvas.getActiveObject() ? "contextMove" : "contextDefault");
    } else if (tool === "marquee" || tool === "lasso") {
      setContext("contextSelection");
    } else if (tool === "wand") {
      setContext("contextWand");
    } else if (tool === "crop") {
      setContext("contextCrop");
    } else if (tool === "node") {
      setContext("contextNode");
      enterNodeMode();
    } else {
      setContext("contextDefault");
    }

    const labels = {
      move: "Move (V)",
      marquee: "Rectangle Select (M)",
      lasso: "Lasso (L)",
      wand: "Magic Wand (W)",
      crop: "Crop (C)",
      brush: "Brush (B)",
      eraser: "Raster Eraser (E)",
      text: "Text (T)",
      rect: "Rectangle (R)",
      ellipse: "Ellipse (O)",
      node: "Vector Nodes (N)",
      hand: "Hand (H)",
      zoom: "Zoom (Z)"
    };
    $("toolStatus").textContent = labels[tool] || tool;
  }

  function hexToRgba(hex, alpha) {
    const raw = hex.replace("#", "");
    const full = raw.length === 3 ? raw.split("").map(x => x + x).join("") : raw;
    const n = parseInt(full, 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + alpha + ")";
  }

  function serialize() {
    return {
      id: "autosave",
      version: 3,
      width: state.width,
      height: state.height,
      transparent: state.transparent,
      canvas: canvas.toJSON(CUSTOM_PROPS),
      updatedAt: Date.now()
    };
  }

  async function saveNow() {
    try {
      APP.setAutosaveState("Сохраняю...");
      await SkoomaStore.saveProject(serialize());
      APP.setAutosaveState("Сохранено");
    } catch (error) {
      APP.setAutosaveState("Ошибка autosave");
      console.error(error);
    }
  }

  function scheduleAutosave() {
    clearTimeout(state.autosaveTimer);
    APP.setAutosaveState("Изменено");
    state.autosaveTimer = setTimeout(saveNow, 700);
  }

  function snapshotLabel(label) {
    if (state.historyMuted || state.restoring) return;
    const snap = {
      label,
      width: state.width,
      height: state.height,
      transparent: state.transparent,
      json: canvas.toJSON(CUSTOM_PROPS)
    };
    if (state.historyIndex < state.history.length - 1) {
      state.history = state.history.slice(0, state.historyIndex + 1);
    }
    state.history.push(snap);
    if (state.history.length > MAX_HISTORY) state.history.shift();
    state.historyIndex = state.history.length - 1;
    renderHistory();
    scheduleAutosave();
  }

  async function restoreSnapshot(snapshot) {
    if (!snapshot) return;
    state.restoring = true;
    state.historyMuted = true;
    selectionTools?.clear();
    clearGuides();
    clearNodeHandles(false);
    state.width = snapshot.width;
    state.height = snapshot.height;
    state.transparent = snapshot.transparent;
    canvas.setDimensions({ width: state.width, height: state.height });
    canvas.backgroundColor = state.transparent ? null : "#ffffff";
    await canvas.loadFromJSON(snapshot.json);
    docObjects().forEach(obj => assignObjectMetadata(obj, obj.name, obj));
    canvas.requestRenderAll();
    state.historyMuted = false;
    state.restoring = false;
    renderLayers();
    renderProperties();
    fitToViewport();
    $("docStatus").textContent = state.width + " × " + state.height;
  }

  async function undo() {
    if (state.historyIndex <= 0) return;
    state.historyIndex -= 1;
    await restoreSnapshot(state.history[state.historyIndex]);
    renderHistory();
  }

  async function redo() {
    if (state.historyIndex >= state.history.length - 1) return;
    state.historyIndex += 1;
    await restoreSnapshot(state.history[state.historyIndex]);
    renderHistory();
  }

  function renderHistory() {
    const list = $("historyList");
    list.innerHTML = "";
    state.history.forEach((entry, index) => {
      const row = document.createElement("div");
      row.className = "history-item" + (index === state.historyIndex ? " current" : "");
      row.textContent = entry.label;
      list.appendChild(row);
    });
  }

  function selectionSummary() {
    const active = canvas.getActiveObject();
    if (!active) return "Ничего не выбрано";
    const count = active instanceof F.ActiveSelection ? active.getObjects().length : 1;
    return count > 1 ? "Выбрано объектов: " + count : objectName(active);
  }

  function updateContextTransform() {
    const active = canvas.getActiveObject();
    if (!active || active instanceof F.ActiveSelection) {
      if (state.tool === "move") setContext("contextDefault");
      return;
    }
    $("ctxX").value = Math.round(active.left || 0);
    $("ctxY").value = Math.round(active.top || 0);
    $("ctxW").value = Math.round(active.getScaledWidth());
    $("ctxH").value = Math.round(active.getScaledHeight());
    $("ctxAngle").value = Math.round(active.angle || 0);
    if (state.tool === "move") setContext("contextMove");
  }

  function renderLayers() {
    const list = $("layersList");
    list.innerHTML = "";
    const objects = docObjects();
    if (!objects.length) {
      list.innerHTML = '<div class="empty-state">Слоёв пока нет.</div>';
      return;
    }

    [...objects].reverse().forEach(object => {
      const row = document.createElement("div");
      row.className = "layer-row" + (canvas.getActiveObject() === object ? " active" : "");
      row.draggable = true;
      row.dataset.uuid = object.uuid;

      const eye = document.createElement("button");
      eye.className = "layer-eye";
      eye.textContent = object.visible === false ? "○" : "●";
      eye.title = "Visibility";
      eye.onclick = event => {
        event.stopPropagation();
        object.visible = object.visible === false;
        canvas.requestRenderAll();
        snapshotLabel(object.visible ? "Показан слой" : "Скрыт слой");
        renderLayers();
      };

      const thumb = document.createElement("div");
      thumb.className = "layer-thumb";
      thumb.textContent = objectKind(object) === "image" ? "▧" :
        objectKind(object) === "text" ? "T" :
        objectKind(object) === "group" ? "▦" :
        objectKind(object) === "vector" ? "◇" : "◆";
      thumb.style.display = "grid";
      thumb.style.placeItems = "center";
      thumb.style.color = "#9fb0c3";
      thumb.style.fontWeight = "900";

      const meta = document.createElement("div");
      meta.className = "layer-meta";
      meta.innerHTML = '<div class="layer-name">' + APP.escapeHtml(objectName(object)) + '</div><div class="layer-type">' +
        APP.escapeHtml(objectKind(object)) + '</div>';

      const lock = document.createElement("button");
      lock.className = "layer-lock";
      lock.textContent = object.lockMovementX ? "🔒" : "🔓";
      lock.title = "Lock";
      lock.onclick = event => {
        event.stopPropagation();
        const locked = !object.lockMovementX;
        object.set({
          lockMovementX: locked,
          lockMovementY: locked,
          lockScalingX: locked,
          lockScalingY: locked,
          lockRotation: locked,
          selectable: !locked
        });
        snapshotLabel(locked ? "Слой заблокирован" : "Слой разблокирован");
        renderLayers();
      };

      row.append(eye, thumb, meta, lock);
      row.onclick = () => {
        canvas.setActiveObject(object);
        canvas.requestRenderAll();
        syncSelectionUi();
      };

      row.ondragstart = event => {
        event.dataTransfer.setData("text/x-skooma-layer", object.uuid);
      };
      row.ondragover = event => event.preventDefault();
      row.ondrop = event => {
        event.preventDefault();
        const fromUuid = event.dataTransfer.getData("text/x-skooma-layer");
        const moving = docObjects().find(item => item.uuid === fromUuid);
        if (!moving || moving === object) return;
        const actualTargetIndex = canvas.getObjects().indexOf(object);
        canvas.moveObjectTo(moving, actualTargetIndex);
        canvas.requestRenderAll();
        snapshotLabel("Изменён порядок слоёв");
        renderLayers();
      };

      list.appendChild(row);
    });
  }

  function renderProperties() {
    const active = canvas.getActiveObject();
    const empty = $("emptyProperties");
    const panel = $("objectProperties");
    if (!active || active instanceof F.ActiveSelection || active.excludeFromExport) {
      empty.classList.remove("hidden");
      panel.classList.add("hidden");
      return;
    }
    empty.classList.add("hidden");
    panel.classList.remove("hidden");
    $("propName").value = objectName(active);
    $("propX").value = Math.round(active.left || 0);
    $("propY").value = Math.round(active.top || 0);
    $("propWidth").value = Math.round(active.getScaledWidth());
    $("propHeight").value = Math.round(active.getScaledHeight());
    $("propAngle").value = Math.round(active.angle || 0);
    $("propOpacity").value = active.opacity ?? 1;
    $("propBlend").value = active.globalCompositeOperation || "source-over";
    const isImage = active instanceof F.FabricImage;
    $("removeMaskBtn").disabled = !isImage || !active.maskBaseSrc;
    $("resetRasterBtn").disabled = !isImage || !active.originalSrc;
  }

  function syncSelectionUi() {
    $("selectionStatus").textContent = selectionSummary();
    renderLayers();
    renderProperties();
    updateContextTransform();
  }

  async function addImageFromUrl(src, name = "Image", asset = null) {
    const image = await F.FabricImage.fromURL(src, { crossOrigin: "anonymous" });
    const maxW = state.width * 0.8;
    const maxH = state.height * 0.8;
    const scale = Math.min(maxW / image.width, maxH / image.height, 1);
    image.set({
      left: (state.width - image.width * scale) / 2,
      top: (state.height - image.height * scale) / 2,
      scaleX: scale,
      scaleY: scale
    });
    assignObjectMetadata(image, name, {
      assetId: asset?.id,
      source: asset?.source || "image",
      kind: "image",
      originalSrc: src,
      rasterSrc: src
    });
    canvas.add(image);
    canvas.setActiveObject(image);
    canvas.requestRenderAll();
    snapshotLabel("Добавлено изображение");
    syncSelectionUi();
    return image;
  }

  async function replaceImageSource(oldImage, src, updates = {}) {
    if (!(oldImage instanceof F.FabricImage)) return null;
    const objects = canvas.getObjects();
    const index = objects.indexOf(oldImage);
    const displayWidth = oldImage.getScaledWidth();
    const displayHeight = oldImage.getScaledHeight();
    const next = await F.FabricImage.fromURL(src, { crossOrigin: "anonymous" });
    next.set({
      left: oldImage.left,
      top: oldImage.top,
      angle: oldImage.angle,
      skewX: oldImage.skewX,
      skewY: oldImage.skewY,
      flipX: oldImage.flipX,
      flipY: oldImage.flipY,
      originX: oldImage.originX,
      originY: oldImage.originY,
      opacity: oldImage.opacity,
      globalCompositeOperation: oldImage.globalCompositeOperation,
      scaleX: displayWidth / Math.max(1, next.width),
      scaleY: displayHeight / Math.max(1, next.height)
    });
    assignObjectMetadata(next, oldImage.name, {
      uuid: oldImage.uuid,
      assetId: oldImage.assetId,
      source: oldImage.source,
      kind: "image",
      originalSrc: updates.originalSrc !== undefined ? updates.originalSrc : oldImage.originalSrc,
      rasterSrc: updates.rasterSrc !== undefined ? updates.rasterSrc : src,
      maskSrc: updates.maskSrc !== undefined ? updates.maskSrc : oldImage.maskSrc,
      maskBaseSrc: updates.maskBaseSrc !== undefined ? updates.maskBaseSrc : oldImage.maskBaseSrc
    });
    canvas.remove(oldImage);
    canvas.add(next);
    if (index >= 0) canvas.moveObjectTo(next, index);
    canvas.setActiveObject(next);
    canvas.requestRenderAll();
    return next;
  }

  async function importSvg(file) {
    const text = await file.text();
    const parsed = await F.loadSVGFromString(text);
    const objects = (parsed.objects || []).filter(Boolean);
    if (!objects.length) throw new Error("SVG не содержит объектов.");
    const group = F.util.groupSVGElements(objects, parsed.options || {});
    const maxW = state.width * 0.8;
    const maxH = state.height * 0.8;
    const scale = Math.min(maxW / Math.max(1, group.width), maxH / Math.max(1, group.height), 1);
    group.set({
      left: (state.width - group.width * scale) / 2,
      top: (state.height - group.height * scale) / 2,
      scaleX: scale,
      scaleY: scale
    });
    assignObjectMetadata(group, file.name || "SVG", { source: "upload", kind: "vector" });
    group.getObjects?.().forEach(obj => assignObjectMetadata(obj, objectName(obj), { source: "svg", kind: objectKind(obj) }));
    canvas.add(group);
    canvas.setActiveObject(group);
    canvas.requestRenderAll();
    snapshotLabel("Импортирован SVG");
    syncSelectionUi();
  }

  async function importFile(file) {
    if (file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg")) {
      await importSvg(file);
      return;
    }
    const src = await fileToDataUrl(file);
    const asset = await APP.addAsset({ name: file.name, src, source: "upload", kind: "upload" });
    await addImageFromUrl(src, file.name, asset);
  }

  function addTextAt(x = state.width / 2 - 120, y = state.height / 2 - 30) {
    const text = new F.IText("Новый текст", {
      left: x,
      top: y,
      fill: $("textColor").value,
      fontSize: Math.max(8, Number($("textSize").value) || 48),
      textAlign: $("textAlign").value,
      fontFamily: "Inter, Arial, sans-serif"
    });
    assignObjectMetadata(text, "Text", { kind: "text", source: "studio" });
    canvas.add(text);
    canvas.setActiveObject(text);
    text.enterEditing();
    text.selectAll();
    snapshotLabel("Добавлен текст");
    syncSelectionUi();
  }

  function addRectAt(x = state.width / 2 - 100, y = state.height / 2 - 60) {
    const rect = new F.Rect({ left: x, top: y, width: 200, height: 120, fill: "#6f7dff", rx: 4, ry: 4 });
    assignObjectMetadata(rect, "Rectangle", { kind: "shape", source: "studio" });
    canvas.add(rect);
    canvas.setActiveObject(rect);
    snapshotLabel("Добавлен прямоугольник");
    syncSelectionUi();
  }

  function addEllipseAt(x = state.width / 2 - 90, y = state.height / 2 - 60) {
    const ellipse = new F.Ellipse({ left: x, top: y, rx: 90, ry: 60, fill: "#4dd3aa" });
    assignObjectMetadata(ellipse, "Ellipse", { kind: "shape", source: "studio" });
    canvas.add(ellipse);
    canvas.setActiveObject(ellipse);
    snapshotLabel("Добавлен эллипс");
    syncSelectionUi();
  }

  async function copyActive() {
    const active = canvas.getActiveObject();
    if (!active || active instanceof F.ActiveSelection) return;
    state.clipboard = await active.clone(CUSTOM_PROPS);
  }

  async function pasteClipboard() {
    if (!state.clipboard) return;
    const clone = await state.clipboard.clone(CUSTOM_PROPS);
    clone.set({ left: (clone.left || 0) + 24, top: (clone.top || 0) + 24, evented: true });
    assignObjectMetadata(clone, objectName(clone) + " copy", clone);
    canvas.add(clone);
    canvas.setActiveObject(clone);
    canvas.requestRenderAll();
    state.clipboard = clone;
    snapshotLabel("Вставлен объект");
    syncSelectionUi();
  }

  async function cutActive() {
    await copyActive();
    deleteActive();
  }

  function duplicateActive() {
    const active = canvas.getActiveObject();
    if (!active || active instanceof F.ActiveSelection) return;
    active.clone(CUSTOM_PROPS).then(clone => {
      clone.set({ left: (active.left || 0) + 24, top: (active.top || 0) + 24 });
      assignObjectMetadata(clone, objectName(active) + " copy", clone);
      clone.uuid = uid();
      canvas.add(clone);
      canvas.setActiveObject(clone);
      canvas.requestRenderAll();
      snapshotLabel("Дублирован слой");
      syncSelectionUi();
    });
  }

  function deleteActive() {
    const active = canvas.getActiveObject();
    if (!active) return;
    if (active instanceof F.ActiveSelection) {
      active.getObjects().forEach(obj => canvas.remove(obj));
      canvas.discardActiveObject();
    } else {
      canvas.remove(active);
    }
    canvas.requestRenderAll();
    snapshotLabel("Удалён слой");
    syncSelectionUi();
  }

  function applyProperties() {
    const active = canvas.getActiveObject();
    if (!active || active instanceof F.ActiveSelection) return;
    const width = Math.max(1, Number($("propWidth").value) || active.getScaledWidth());
    const height = Math.max(1, Number($("propHeight").value) || active.getScaledHeight());
    active.name = $("propName").value.trim() || objectName(active);
    active.set({
      left: Number($("propX").value) || 0,
      top: Number($("propY").value) || 0,
      angle: Number($("propAngle").value) || 0,
      opacity: Math.max(0, Math.min(1, Number($("propOpacity").value))),
      globalCompositeOperation: $("propBlend").value || "source-over"
    });
    if (active.width) active.scaleX = width / active.width;
    if (active.height) active.scaleY = height / active.height;
    active.setCoords();
    canvas.requestRenderAll();
    snapshotLabel("Изменены свойства");
    syncSelectionUi();
  }

  function applyContextTransform() {
    const active = canvas.getActiveObject();
    if (!active || active instanceof F.ActiveSelection) return;
    const width = Math.max(1, Number($("ctxW").value) || active.getScaledWidth());
    const height = Math.max(1, Number($("ctxH").value) || active.getScaledHeight());
    active.set({
      left: Number($("ctxX").value) || 0,
      top: Number($("ctxY").value) || 0,
      angle: Number($("ctxAngle").value) || 0
    });
    if (active.width) active.scaleX = width / active.width;
    if (active.height) active.scaleY = height / active.height;
    active.setCoords();
    canvas.requestRenderAll();
    snapshotLabel("Transform");
    syncSelectionUi();
  }

  function groupActive() {
    const active = canvas.getActiveObject();
    if (!(active instanceof F.ActiveSelection)) return;
    let group = null;
    if (typeof active.toGroup === "function") {
      group = active.toGroup();
    } else {
      const objects = active.getObjects();
      canvas.discardActiveObject();
      objects.forEach(object => canvas.remove(object));
      group = new F.Group(objects);
      canvas.add(group);
      canvas.setActiveObject(group);
    }
    assignObjectMetadata(group, "Group", { kind: "group", source: "studio" });
    canvas.requestRenderAll();
    snapshotLabel("Слои сгруппированы");
    syncSelectionUi();
  }

  function ungroupActive() {
    const active = canvas.getActiveObject();
    if (!(active instanceof F.Group) || active instanceof F.ActiveSelection) return;
    if (typeof active.toActiveSelection === "function") {
      const selection = active.toActiveSelection();
      canvas.setActiveObject(selection);
      selection.getObjects().forEach(object => assignObjectMetadata(object, objectName(object), object));
      canvas.requestRenderAll();
      snapshotLabel("Группа разгруппирована");
      syncSelectionUi();
      return;
    }
  }

  async function rasterizeObjects(objects, bounds) {
    const temp = new F.StaticCanvas(null, {
      width: Math.max(1, Math.ceil(bounds.width)),
      height: Math.max(1, Math.ceil(bounds.height)),
      backgroundColor: null
    });
    for (const object of objects) {
      const clone = await object.clone(CUSTOM_PROPS);
      clone.set({
        left: (clone.left || 0) - bounds.left,
        top: (clone.top || 0) - bounds.top
      });
      temp.add(clone);
    }
    temp.requestRenderAll();
    const src = temp.toDataURL({ format: "png", multiplier: 1 });
    temp.dispose();
    return src;
  }

  async function mergeActive() {
    let active = canvas.getActiveObject();
    if (!active) return;
    let objects = [];
    if (active instanceof F.ActiveSelection) {
      objects = active.getObjects().filter(object => !object.excludeFromExport);
    } else {
      const layers = docObjects();
      const index = layers.indexOf(active);
      if (index <= 0) return;
      objects = [layers[index - 1], active];
    }
    if (objects.length < 2) return;
    const boundsList = objects.map(object => object.getBoundingRect());
    const left = Math.min(...boundsList.map(b => b.left));
    const top = Math.min(...boundsList.map(b => b.top));
    const right = Math.max(...boundsList.map(b => b.left + b.width));
    const bottom = Math.max(...boundsList.map(b => b.top + b.height));
    const bounds = { left, top, width: right - left, height: bottom - top };
    const src = await rasterizeObjects(objects, bounds);
    canvas.discardActiveObject();
    objects.forEach(object => canvas.remove(object));
    const image = await F.FabricImage.fromURL(src);
    image.set({ left: bounds.left, top: bounds.top });
    assignObjectMetadata(image, "Merged", {
      kind: "image",
      source: "merge",
      originalSrc: src,
      rasterSrc: src
    });
    canvas.add(image);
    canvas.setActiveObject(image);
    canvas.requestRenderAll();
    snapshotLabel("Слои объединены");
    syncSelectionUi();
  }

  async function flattenAll() {
    selectionTools.clear();
    clearGuides();
    clearNodeHandles(false);
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    const src = canvas.toDataURL({ format: "png", multiplier: 1 });
    docObjects().forEach(object => canvas.remove(object));
    const image = await F.FabricImage.fromURL(src);
    image.set({ left: 0, top: 0, scaleX: state.width / image.width, scaleY: state.height / image.height });
    assignObjectMetadata(image, "Flattened", {
      kind: "image",
      source: "flatten",
      originalSrc: src,
      rasterSrc: src
    });
    canvas.add(image);
    canvas.setActiveObject(image);
    snapshotLabel("Документ flatten");
    syncSelectionUi();
  }

  async function applySelectionDelete() {
    const image = getActiveImage();
    const mask = selectionTools.getMaskForActiveImage();
    if (!image || !mask) return;
    const source = SkoomaRaster.sourceCanvasFromFabricImage(image);
    const feather = selectionTools.state.current?.type === "mask" ? Number($("wandFeather").value || 0) : 0;
    const out = SkoomaRaster.applyDelete(source, mask, feather);
    const src = out.toDataURL("image/png");
    await replaceImageSource(image, src, {
      originalSrc: image.originalSrc || image.rasterSrc || image.getSrc?.() || src,
      rasterSrc: src,
      maskBaseSrc: image.maskBaseSrc,
      maskSrc: image.maskSrc
    });
    selectionTools.clear();
    snapshotLabel("Удалены выбранные пиксели");
    syncSelectionUi();
  }

  async function applySelectionMask() {
    const image = getActiveImage();
    const mask = selectionTools.getMaskForActiveImage();
    if (!image || !mask) return;
    const source = SkoomaRaster.sourceCanvasFromFabricImage(image);
    const feather = selectionTools.state.current?.type === "mask" ? Number($("wandFeather").value || 0) : 0;
    const maskCanvas = feather ? SkoomaRaster.featherMask(mask, feather) : mask;
    const out = SkoomaRaster.applyKeep(source, maskCanvas, 0);
    const src = out.toDataURL("image/png");
    const maskSrc = maskCanvas.toDataURL("image/png");
    const baseSrc = image.rasterSrc || image.getSrc?.() || src;
    await replaceImageSource(image, src, {
      originalSrc: image.originalSrc || baseSrc,
      rasterSrc: src,
      maskBaseSrc: baseSrc,
      maskSrc
    });
    selectionTools.clear();
    snapshotLabel("Применена маска");
    syncSelectionUi();
  }

  async function removeMask() {
    const image = getActiveImage();
    if (!image?.maskBaseSrc) return;
    await replaceImageSource(image, image.maskBaseSrc, {
      originalSrc: image.originalSrc,
      rasterSrc: image.maskBaseSrc,
      maskBaseSrc: null,
      maskSrc: null
    });
    snapshotLabel("Маска удалена");
    syncSelectionUi();
  }

  async function resetRaster() {
    const image = getActiveImage();
    if (!image?.originalSrc) return;
    await replaceImageSource(image, image.originalSrc, {
      originalSrc: image.originalSrc,
      rasterSrc: image.originalSrc,
      maskBaseSrc: null,
      maskSrc: null
    });
    snapshotLabel("Изображение восстановлено");
    syncSelectionUi();
  }

  function cropDocument(bounds) {
    if (!bounds) return;
    let x = Math.max(0, Math.floor(bounds.x));
    let y = Math.max(0, Math.floor(bounds.y));
    let width = Math.min(state.width - x, Math.max(1, Math.round(bounds.width)));
    let height = Math.min(state.height - y, Math.max(1, Math.round(bounds.height)));
    if (width < 2 || height < 2) return;

    docObjects().forEach(object => {
      object.set({
        left: (object.left || 0) - x,
        top: (object.top || 0) - y
      });
      object.setCoords();
    });
    state.width = width;
    state.height = height;
    canvas.setDimensions({ width, height });
    canvas.requestRenderAll();
    selectionTools.clear();
    fitToViewport();
    snapshotLabel("Документ обрезан");
    syncSelectionUi();
  }

  async function eraseRasterStroke() {
    const stroke = state.eraser;
    state.eraser = null;
    if (state.eraserPreview) {
      canvas.remove(state.eraserPreview);
      state.eraserPreview = null;
    }
    if (!stroke?.target || stroke.points.length < 1) return;

    const target = stroke.target;
    if (!docObjects().includes(target)) return;
    const source = SkoomaRaster.sourceCanvasFromFabricImage(target);
    const pixelPoints = SkoomaRaster.scenePointsToPixels(F, target, stroke.points);
    const avgScale = Math.max(0.0001, (Math.abs(target.scaleX || 1) + Math.abs(target.scaleY || 1)) / 2);
    const lineWidth = Math.max(1, Number($("brushSize").value || 18) / avgScale);
    const out = SkoomaRaster.eraseStroke(source, pixelPoints, lineWidth);
    const src = out.toDataURL("image/png");
    await replaceImageSource(target, src, {
      originalSrc: target.originalSrc || target.rasterSrc || target.getSrc?.() || src,
      rasterSrc: src,
      maskBaseSrc: target.maskBaseSrc,
      maskSrc: target.maskSrc
    });
    snapshotLabel("Raster eraser");
    syncSelectionUi();
  }

  function updateEraserPreview() {
    if (state.eraserPreview) canvas.remove(state.eraserPreview);
    if (!state.eraser?.points?.length) return;
    state.eraserPreview = new F.Polyline(state.eraser.points, {
      fill: "",
      stroke: "rgba(255,255,255,.72)",
      strokeWidth: Math.max(1, Number($("brushSize").value || 18)),
      strokeLineCap: "round",
      strokeLineJoin: "round",
      selectable: false,
      evented: false,
      excludeFromExport: true,
      objectCaching: false,
      name: "__eraser_preview__"
    });
    canvas.add(state.eraserPreview);
    canvas.bringObjectToFront(state.eraserPreview);
    canvas.requestRenderAll();
  }

  function clearGuides() {
    state.guides.forEach(line => canvas.remove(line));
    state.guides = [];
  }

  function addGuide(vertical, position) {
    const line = new F.Line(
      vertical ? [position, 0, position, state.height] : [0, position, state.width, position],
      {
        stroke: "#58d7ff",
        strokeWidth: 1 / Math.max(0.2, state.viewScale),
        selectable: false,
        evented: false,
        excludeFromExport: true,
        opacity: 0.85,
        name: "__guide__"
      }
    );
    state.guides.push(line);
    canvas.add(line);
    canvas.bringObjectToFront(line);
  }

  function snapMovingObject(target) {
    if (!target || target.excludeFromExport || target instanceof F.ActiveSelection) return;
    clearGuides();
    const threshold = 6 / Math.max(0.1, state.viewScale);
    const bounds = target.getBoundingRect();
    const sourceX = [bounds.left, bounds.left + bounds.width / 2, bounds.left + bounds.width];
    const sourceY = [bounds.top, bounds.top + bounds.height / 2, bounds.top + bounds.height];
    const targetX = [0, state.width / 2, state.width];
    const targetY = [0, state.height / 2, state.height];

    docObjects().forEach(object => {
      if (object === target || object.visible === false) return;
      const box = object.getBoundingRect();
      targetX.push(box.left, box.left + box.width / 2, box.left + box.width);
      targetY.push(box.top, box.top + box.height / 2, box.top + box.height);
    });

    let bestX = null;
    let bestY = null;
    for (const sx of sourceX) {
      for (const tx of targetX) {
        const diff = tx - sx;
        if (Math.abs(diff) <= threshold && (!bestX || Math.abs(diff) < Math.abs(bestX.diff))) {
          bestX = { diff, guide: tx };
        }
      }
    }
    for (const sy of sourceY) {
      for (const ty of targetY) {
        const diff = ty - sy;
        if (Math.abs(diff) <= threshold && (!bestY || Math.abs(diff) < Math.abs(bestY.diff))) {
          bestY = { diff, guide: ty };
        }
      }
    }

    if (bestX) {
      target.left = (target.left || 0) + bestX.diff;
      addGuide(true, bestX.guide);
    }
    if (bestY) {
      target.top = (target.top || 0) + bestY.diff;
      addGuide(false, bestY.guide);
    }
    if (bestX || bestY) target.setCoords();
  }

  function endpointIndexes(command) {
    const code = String(command?.[0] || "").toUpperCase();
    if (["M", "L", "T"].includes(code)) return [1, 2];
    if (code === "C") return [5, 6];
    if (["S", "Q"].includes(code)) return [3, 4];
    if (code === "A") return [6, 7];
    return null;
  }

  function clearNodeHandles(commit = false) {
    if (commit && state.nodeTarget && state.nodeHandles.length) snapshotLabel("Vector nodes edited");
    state.nodeHandles.forEach(handle => canvas.remove(handle));
    state.nodeHandles = [];
    state.nodeTarget = null;
    canvas.requestRenderAll();
  }

  function refreshNodeHandles() {
    if (!state.nodeTarget || !state.nodeHandles.length) return;
    const path = state.nodeTarget;
    state.nodeHandles.forEach(handle => {
      const info = handle.nodeInfo;
      const command = path.path?.[info.commandIndex];
      if (!command) return;
      const local = new F.Point(
        Number(command[info.xIndex]) - path.pathOffset.x,
        Number(command[info.yIndex]) - path.pathOffset.y
      );
      const scene = F.util.transformPoint(local, path.calcTransformMatrix());
      handle.set({
        left: scene.x,
        top: scene.y,
        radius: 5 / Math.max(0.2, state.viewScale)
      });
      handle.setCoords();
    });
    canvas.requestRenderAll();
  }

  function enterNodeMode() {
    clearNodeHandles(false);
    const target = canvas.getActiveObject();
    if (!(target instanceof F.Path) || !Array.isArray(target.path)) {
      $("selectionStatus").textContent = "Node Edit: выберите Path. SVG group можно сначала Ungroup.";
      return;
    }
    state.nodeTarget = target;
    target.selectable = false;

    target.path.forEach((command, commandIndex) => {
      const indexes = endpointIndexes(command);
      if (!indexes) return;
      const [xIndex, yIndex] = indexes;
      const local = new F.Point(
        Number(command[xIndex]) - target.pathOffset.x,
        Number(command[yIndex]) - target.pathOffset.y
      );
      const scene = F.util.transformPoint(local, target.calcTransformMatrix());
      const handle = new F.Circle({
        left: scene.x,
        top: scene.y,
        radius: 5 / Math.max(0.2, state.viewScale),
        originX: "center",
        originY: "center",
        fill: "#ffffff",
        stroke: "#6f7dff",
        strokeWidth: 2 / Math.max(0.2, state.viewScale),
        selectable: true,
        evented: true,
        hasControls: false,
        hasBorders: false,
        excludeFromExport: true,
        name: "__node__"
      });
      handle.nodeInfo = { commandIndex, xIndex, yIndex };
      handle.on("moving", () => {
        const inverse = F.util.invertTransform(target.calcTransformMatrix());
        const localPoint = F.util.transformPoint(new F.Point(handle.left, handle.top), inverse);
        command[xIndex] = localPoint.x + target.pathOffset.x;
        command[yIndex] = localPoint.y + target.pathOffset.y;
        target.dirty = true;
        canvas.requestRenderAll();
      });
      state.nodeHandles.push(handle);
      canvas.add(handle);
      canvas.bringObjectToFront(handle);
    });
    canvas.requestRenderAll();
  }

  async function generateAi() {
    const prompt = $("aiPrompt").value.trim();
    if (!prompt) {
      $("aiStatus").textContent = "Введите промпт.";
      $("aiStatus").className = "drawer-status error";
      return;
    }
    const button = $("generateAiBtn");
    button.disabled = true;
    button.textContent = "Генерация...";
    $("aiStatus").textContent = "Puter AI...";
    $("aiStatus").className = "drawer-status";
    try {
      const [w, h] = $("aiRatio").value.split(":").map(Number);
      const result = await puter.ai.txt2img(prompt, {
        model: $("aiModel").value,
        quality: $("aiQuality").value,
        ratio: { w, h },
        test_mode: $("aiTestMode").checked
      });
      const src = result.src;
      const asset = await APP.addAsset({
        name: "AI: " + prompt.slice(0, 32),
        src,
        source: "Puter / " + $("aiModel").selectedOptions[0].text,
        kind: "generated"
      });
      await addImageFromUrl(src, asset.name, asset);
      $("aiStatus").textContent = "Готово. Результат добавлен новым слоем.";
      $("aiStatus").className = "drawer-status ok";
      APP.refreshPuterState();
    } catch (error) {
      $("aiStatus").textContent = "Ошибка: " + (error?.message || error?.msg || String(error));
      $("aiStatus").className = "drawer-status error";
    } finally {
      button.disabled = false;
      button.textContent = "Сгенерировать";
    }
  }

  async function newDocument(width, height, transparent = true) {
    state.historyMuted = true;
    selectionTools?.clear();
    clearGuides();
    clearNodeHandles(false);
    canvas.clear();
    state.transparent = transparent;
    canvas.backgroundColor = transparent ? null : "#ffffff";
    setDocumentSize(width, height);
    canvas.requestRenderAll();
    state.historyMuted = false;
    state.history = [];
    state.historyIndex = -1;
    snapshotLabel("Новый документ");
    syncSelectionUi();
  }

  async function loadProjectData(project, restoreAssets = true) {
    if (!project?.canvas) throw new Error("Некорректный Skooma project.");
    state.restoring = true;
    state.historyMuted = true;
    selectionTools?.clear();
    clearGuides();
    clearNodeHandles(false);
    state.width = project.width || 1280;
    state.height = project.height || 720;
    state.transparent = project.transparent !== false;
    canvas.setDimensions({ width: state.width, height: state.height });
    canvas.backgroundColor = state.transparent ? null : "#ffffff";
    await canvas.loadFromJSON(project.canvas);
    docObjects().forEach(obj => assignObjectMetadata(obj, obj.name, obj));
    canvas.requestRenderAll();
    if (restoreAssets && Array.isArray(project.assets)) {
      for (const asset of project.assets) await APP.addAsset(asset);
    }
    state.historyMuted = false;
    state.restoring = false;
    state.history = [];
    state.historyIndex = -1;
    snapshotLabel("Проект загружен");
    syncSelectionUi();
    fitToViewport();
  }

  async function loadAutosave() {
    try {
      const project = await SkoomaStore.getProject("autosave");
      if (!project?.canvas) {
        snapshotLabel("Начальное состояние");
        return;
      }
      await loadProjectData(project, false);
      if (state.history[0]) state.history[0].label = "Восстановлен autosave";
      renderHistory();
    } catch (error) {
      console.error("Autosave restore failed", error);
      snapshotLabel("Начальное состояние");
    }
  }

  async function exportProjectFile() {
    const project = serialize();
    try { project.assets = await SkoomaStore.listAssets(); } catch { project.assets = []; }
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "skooma-project.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importProjectFile(file) {
    const text = await file.text();
    const project = JSON.parse(text);
    await loadProjectData(project, true);
    await saveNow();
  }

  function exportImage(format = "png") {
    selectionTools?.clear();
    clearGuides();
    clearNodeHandles(false);
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    const mimeFormat = format === "jpg" ? "jpeg" : format;
    const data = canvas.toDataURL({ format: mimeFormat, quality: 0.92, multiplier: 1 });
    const a = document.createElement("a");
    a.href = data;
    a.download = "skooma-export." + (format === "jpeg" ? "jpg" : format);
    a.click();
  }

  function selectionChanged(selection) {
    if (selection?.error) {
      $("selectionStatus").textContent = selection.error;
      return;
    }
    if (!selection) {
      $("selectionStatus").textContent = selectionSummary();
      return;
    }
    if (selection.type === "mask") {
      $("selectionStatus").textContent = "Magic Wand selection";
    } else if (selection.type === "lasso") {
      $("selectionStatus").textContent = "Lasso selection";
    } else if (selection.type === "crop") {
      $("selectionStatus").textContent = "Crop selection";
    } else {
      $("selectionStatus").textContent = "Rectangle selection";
    }
  }

  const selectionTools = SkoomaSelectionTools.create({
    canvas,
    Fabric: F,
    getTool: () => state.tool,
    getActiveImage,
    getDocumentSize,
    onSelectionChanged: selectionChanged
  });

  function bindEvents() {
    canvas.on("selection:created", syncSelectionUi);
    canvas.on("selection:updated", syncSelectionUi);
    canvas.on("selection:cleared", syncSelectionUi);
    canvas.on("object:moving", event => {
      if (event.target?.excludeFromExport) return;
      snapMovingObject(event.target);
      if (state.nodeTarget) refreshNodeHandles();
    });
    canvas.on("object:scaling", () => {
      clearGuides();
      if (state.nodeTarget) refreshNodeHandles();
    });
    canvas.on("object:rotating", () => {
      clearGuides();
      if (state.nodeTarget) refreshNodeHandles();
    });
    canvas.on("object:modified", event => {
      clearGuides();
      if (event.target?.excludeFromExport) return;
      snapshotLabel("Изменён объект");
      syncSelectionUi();
    });
    canvas.on("path:created", event => {
      const path = event.path;
      if (!path) return;
      assignObjectMetadata(path, "Brush stroke", { kind: "drawing", source: "studio" });
      snapshotLabel("Кисть");
      renderLayers();
    });

    canvas.on("mouse:down", event => {
      if (selectionTools.handleMouseDown(event)) return;

      const pointer = event.e;
      const scenePoint = canvas.getScenePoint(pointer);

      if (state.tool === "eraser") {
        const target = getActiveImage();
        if (!target) {
          $("selectionStatus").textContent = "Raster Eraser: выберите image layer.";
          return;
        }
        state.eraser = { target, points: [scenePoint] };
        updateEraserPreview();
        return;
      }

      if (state.tool === "hand") {
        state.isPanning = true;
        state.lastPointer = { x: pointer.clientX, y: pointer.clientY };
        canvas.defaultCursor = "grabbing";
      } else if (state.tool === "zoom") {
        setZoom(state.viewScale * (pointer.altKey ? 0.85 : 1.15));
      } else if (state.tool === "text" && !event.target) {
        addTextAt(scenePoint.x, scenePoint.y);
        setTool("move");
      } else if (state.tool === "rect" && !event.target) {
        addRectAt(scenePoint.x, scenePoint.y);
        setTool("move");
      } else if (state.tool === "ellipse" && !event.target) {
        addEllipseAt(scenePoint.x, scenePoint.y);
        setTool("move");
      }
    });

    canvas.on("mouse:move", event => {
      if (selectionTools.handleMouseMove(event)) return;

      const scenePoint = canvas.getScenePoint(event.e);
      if (state.eraser) {
        const last = state.eraser.points[state.eraser.points.length - 1];
        const dx = scenePoint.x - last.x;
        const dy = scenePoint.y - last.y;
        if (dx * dx + dy * dy > 4) state.eraser.points.push(scenePoint);
        updateEraserPreview();
        return;
      }

      if (!state.isPanning || !state.lastPointer) return;
      const pointer = event.e;
      state.panX += pointer.clientX - state.lastPointer.x;
      state.panY += pointer.clientY - state.lastPointer.y;
      state.lastPointer = { x: pointer.clientX, y: pointer.clientY };
      applyViewTransform();
    });

    canvas.on("mouse:up", async () => {
      if (selectionTools.handleMouseUp()) return;
      if (state.eraser) {
        await eraseRasterStroke();
        return;
      }
      if (state.isPanning) {
        state.isPanning = false;
        state.lastPointer = null;
        canvas.defaultCursor = "grab";
      }
    });

    $("canvasViewport").addEventListener("wheel", event => {
      if (!event.ctrlKey && state.tool !== "zoom") return;
      event.preventDefault();
      setZoom(state.viewScale * (event.deltaY < 0 ? 1.08 : 0.92));
    }, { passive: false });

    $("canvasViewport").addEventListener("dragover", event => event.preventDefault());
    $("canvasViewport").addEventListener("drop", async event => {
      event.preventDefault();
      const assetId = event.dataTransfer.getData("application/x-skooma-asset");
      if (assetId) {
        const asset = APP.getAsset(assetId);
        if (asset) await addImageFromUrl(asset.src, asset.name, asset);
        return;
      }
      const file = event.dataTransfer.files?.[0];
      if (file) await importFile(file);
    });

    document.addEventListener("paste", async event => {
      if ($("editorSelect").value !== "skooma") return;
      if (state.clipboard && !event.clipboardData?.items?.length) {
        await pasteClipboard();
        return;
      }
      const item = [...(event.clipboardData?.items || [])].find(entry => entry.type.startsWith("image/"));
      if (!item) return;
      const file = item.getAsFile();
      if (file) await importFile(file);
    });

    qsa(".tool-button[data-tool]").forEach(btn => btn.onclick = () => setTool(btn.dataset.tool));

    ["brushSize", "brushOpacity", "brushColor"].forEach(id => {
      $(id).oninput = () => {
        if (state.tool === "brush") setTool("brush");
      };
    });

    $("generateAiBtn").onclick = generateAi;
    $("duplicateBtn").onclick = duplicateActive;
    $("deleteBtn").onclick = deleteActive;
    $("groupBtn").onclick = groupActive;
    $("ungroupBtn").onclick = ungroupActive;
    $("mergeBtn").onclick = mergeActive;
    $("flattenBtn").onclick = flattenAll;
    $("undoBtn").onclick = undo;
    $("redoBtn").onclick = redo;
    $("applyPropertiesBtn").onclick = applyProperties;
    $("applyTransformBtn").onclick = applyContextTransform;
    $("removeMaskBtn").onclick = removeMask;
    $("resetRasterBtn").onclick = resetRaster;

    $("selectionDeleteBtn").onclick = applySelectionDelete;
    $("selectionMaskBtn").onclick = applySelectionMask;
    $("selectionInvertBtn").onclick = () => selectionTools.invert();
    $("selectionCropBtn").onclick = () => cropDocument(selectionTools.getSceneBounds());
    $("selectionClearBtn").onclick = () => selectionTools.clear();

    $("selectionDeleteWandBtn").onclick = applySelectionDelete;
    $("selectionMaskWandBtn").onclick = applySelectionMask;
    $("selectionClearWandBtn").onclick = () => selectionTools.clear();

    $("cropApplyBtn").onclick = () => cropDocument(selectionTools.getSceneBounds());
    $("cropCancelBtn").onclick = () => selectionTools.clear();
    $("nodeExitBtn").onclick = () => {
      clearNodeHandles(true);
      setTool("move");
    };

    $("exportBtn").onclick = () => exportImage($("exportFormat").value);
    $("exportProjectBtn").onclick = exportProjectFile;
    $("importProjectBtn").onclick = () => $("projectInput").click();
    $("projectInput").onchange = async event => {
      const file = event.target.files?.[0];
      if (file) {
        try {
          await importProjectFile(file);
        } catch (error) {
          alert("Project import error: " + error.message);
        }
      }
      event.target.value = "";
    };

    window.addEventListener("resize", fitToViewport);
    window.addEventListener("keydown", event => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      const typing = tag === "input" || tag === "textarea" || tag === "select" || canvas.getActiveObject()?.isEditing;
      const mod = event.ctrlKey || event.metaKey;

      if (mod && event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault(); undo(); return;
      }
      if ((mod && event.key.toLowerCase() === "y") || (mod && event.shiftKey && event.key.toLowerCase() === "z")) {
        event.preventDefault(); redo(); return;
      }
      if (mod && event.key.toLowerCase() === "c") {
        if (!typing) { event.preventDefault(); copyActive(); }
        return;
      }
      if (mod && event.key.toLowerCase() === "x") {
        if (!typing) { event.preventDefault(); cutActive(); }
        return;
      }
      if (mod && event.key.toLowerCase() === "v") {
        if (!typing && state.clipboard) { event.preventDefault(); pasteClipboard(); }
        return;
      }
      if (mod && event.key.toLowerCase() === "d") {
        event.preventDefault(); duplicateActive(); return;
      }
      if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault(); saveNow(); return;
      }
      if (!typing && event.code === "Space" && !event.repeat) {
        event.preventDefault();
        state.previousTool = state.tool;
        setTool("hand");
        return;
      }
      if (!typing && event.key === "Escape") {
        selectionTools.clear();
        clearNodeHandles(false);
        setTool("move");
        return;
      }
      if (!typing && event.key === "Delete") {
        if (selectionTools.state.current && getActiveImage()) {
          event.preventDefault();
          applySelectionDelete();
        } else {
          event.preventDefault();
          deleteActive();
        }
        return;
      }
      if (typing) return;

      const key = event.key.toLowerCase();
      if (key === "v") setTool("move");
      else if (key === "m") setTool("marquee");
      else if (key === "l") setTool("lasso");
      else if (key === "w") setTool("wand");
      else if (key === "c") setTool("crop");
      else if (key === "b") setTool("brush");
      else if (key === "e") setTool("eraser");
      else if (key === "t") setTool("text");
      else if (key === "r") setTool("rect");
      else if (key === "o") setTool("ellipse");
      else if (key === "n") setTool("node");
      else if (key === "h") setTool("hand");
      else if (key === "z") setTool("zoom");
    });

    window.addEventListener("keyup", event => {
      if (event.code === "Space" && state.previousTool) {
        const previous = state.previousTool;
        state.previousTool = null;
        setTool(previous);
      }
    });
  }

  bindEvents();
  setDocumentSize(state.width, state.height);
  setTool("move");
  loadAutosave();
  setTimeout(fitToViewport, 50);

  return {
    canvas,
    fitToViewport,
    setTool,
    addImageFromUrl,
    importFile,
    fileToDataUrl,
    newDocument,
    saveNow,
    exportImage,
    exportProjectFile,
    importProjectFile,
    undo,
    redo
  };
})();