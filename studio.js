window.Studio = (() => {
  const $ = id => document.getElementById(id);
  const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const F = window.fabric;

  if (!F) {
    console.error("Fabric.js failed to load.");
    return {};
  }

  F.FabricObject.customProperties = ["name", "assetId", "source", "kind"];

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
    restoring: false
  };

  const MAX_HISTORY = 35;

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function objectName(object) {
    if (object.name) return object.name;
    if (object instanceof F.IText || object instanceof F.Textbox) return "Text";
    if (object instanceof F.FabricImage) return "Image";
    if (object instanceof F.Rect) return "Rectangle";
    if (object instanceof F.Ellipse) return "Ellipse";
    if (object instanceof F.Path) return object.globalCompositeOperation === "destination-out" ? "Eraser stroke" : "Brush stroke";
    return "Object";
  }

  function objectKind(object) {
    if (object.kind) return object.kind;
    if (object instanceof F.IText || object instanceof F.Textbox) return "text";
    if (object instanceof F.FabricImage) return "image";
    if (object instanceof F.Rect) return "shape";
    if (object instanceof F.Ellipse) return "shape";
    if (object instanceof F.Path) return "drawing";
    return "object";
  }

  function assignObjectMetadata(object, name, extra = {}) {
    object.name = name || objectName(object);
    object.kind = extra.kind || objectKind(object);
    if (extra.assetId) object.assetId = extra.assetId;
    if (extra.source) object.source = extra.source;
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
    state.width = width;
    state.height = height;
    canvas.setDimensions({ width, height });
    $("docStatus").textContent = width + " × " + height;
    fitToViewport();
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
    const scale = Math.min((rect.width - 48) / state.width, (rect.height - 48) / state.height, 1);
    state.viewScale = Math.max(0.05, Number.isFinite(scale) ? scale : 1);
    state.panX = 0;
    state.panY = 0;
    applyViewTransform();
  }

  function setZoom(next) {
    state.viewScale = Math.max(0.05, Math.min(6, next));
    applyViewTransform();
  }

  function setContext(name) {
    ["contextDefault", "contextBrush", "contextText", "contextMove"].forEach(id => $(id).classList.add("hidden"));
    $(name).classList.remove("hidden");
  }

  function setTool(tool) {
    state.tool = tool;
    qsa(".tool-button[data-tool]").forEach(btn => btn.classList.toggle("active", btn.dataset.tool === tool));
    canvas.isDrawingMode = false;
    canvas.selection = tool === "move";
    canvas.skipTargetFind = ["brush", "eraser", "hand", "zoom"].includes(tool);
    canvas.defaultCursor = tool === "hand" ? "grab" : tool === "zoom" ? "zoom-in" : "default";

    if (tool === "brush" || tool === "eraser") {
      canvas.isDrawingMode = true;
      const brush = new F.PencilBrush(canvas);
      brush.width = Math.max(1, Number($("brushSize").value) || 18);
      const opacity = Math.max(0.05, Number($("brushOpacity").value) || 1);
      brush.color = tool === "eraser" ? "rgba(0,0,0," + opacity + ")" : hexToRgba($("brushColor").value, opacity);
      canvas.freeDrawingBrush = brush;
      setContext("contextBrush");
    } else if (tool === "text") {
      setContext("contextText");
    } else if (tool === "move") {
      setContext(canvas.getActiveObject() ? "contextMove" : "contextDefault");
    } else {
      setContext("contextDefault");
    }

    const labels = {
      move: "Move (V)", brush: "Brush (B)", eraser: "Eraser (E)", text: "Text (T)",
      rect: "Rectangle (R)", ellipse: "Ellipse (O)", hand: "Hand (H)", zoom: "Zoom (Z)"
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
      version: 2,
      width: state.width,
      height: state.height,
      transparent: state.transparent,
      canvas: canvas.toJSON(["name", "assetId", "source", "kind"]),
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
      json: canvas.toJSON(["name", "assetId", "source", "kind"])
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
    state.width = snapshot.width;
    state.height = snapshot.height;
    state.transparent = snapshot.transparent;
    canvas.setDimensions({ width: state.width, height: state.height });
    canvas.backgroundColor = state.transparent ? null : "#ffffff";
    await canvas.loadFromJSON(snapshot.json);
    canvas.getObjects().forEach(obj => assignObjectMetadata(obj, obj.name, obj));
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
    const count = active.type === "activeselection" ? active.size() : 1;
    return count > 1 ? "Выбрано объектов: " + count : objectName(active);
  }

  function updateContextTransform() {
    const active = canvas.getActiveObject();
    if (!active || active.type === "activeselection") {
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
    const objects = canvas.getObjects();
    if (!objects.length) {
      list.innerHTML = '<div class="empty-state">Слоёв пока нет.</div>';
      return;
    }
    [...objects].reverse().forEach(object => {
      const row = document.createElement("div");
      row.className = "layer-row" + (canvas.getActiveObject() === object ? " active" : "");
      row.draggable = true;
      row.dataset.objectIndex = objects.indexOf(object);

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
      try {
        thumb.style.backgroundImage = "url(" + object.toDataURL({ format: "png", multiplier: 0.15 }) + ")";
        thumb.style.backgroundSize = "cover";
        thumb.style.backgroundPosition = "center";
      } catch {}

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
        event.dataTransfer.setData("text/x-skooma-layer", String(objects.indexOf(object)));
      };
      row.ondragover = event => event.preventDefault();
      row.ondrop = event => {
        event.preventDefault();
        const from = Number(event.dataTransfer.getData("text/x-skooma-layer"));
        const target = objects.indexOf(object);
        const moving = canvas.item(from);
        if (moving && from !== target) {
          canvas.moveObjectTo(moving, target);
          canvas.requestRenderAll();
          snapshotLabel("Изменён порядок слоёв");
          renderLayers();
        }
      };

      list.appendChild(row);
    });
  }

  function renderProperties() {
    const active = canvas.getActiveObject();
    const empty = $("emptyProperties");
    const panel = $("objectProperties");
    if (!active || active.type === "activeselection") {
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
  }

  function syncSelectionUi() {
    $("selectionStatus").textContent = selectionSummary();
    renderLayers();
    renderProperties();
    updateContextTransform();
  }

  async function addImageFromUrl(src, name = "Image", asset = null) {
    try {
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
        kind: "image"
      });
      canvas.add(image);
      canvas.setActiveObject(image);
      canvas.requestRenderAll();
      snapshotLabel("Добавлено изображение");
      syncSelectionUi();
      return image;
    } catch (error) {
      console.error(error);
      throw error;
    }
  }

  async function importSvg(file) {
    const text = await file.text();
    const parsed = await F.loadSVGFromString(text);
    const objects = (parsed.objects || []).filter(Boolean);
    if (!objects.length) throw new Error("SVG не содержит объектов.");
    const group = F.util.groupSVGElements(objects, parsed.options || {});
    const maxW = state.width * 0.8;
    const maxH = state.height * 0.8;
    const scale = Math.min(maxW / group.width, maxH / group.height, 1);
    group.set({
      left: (state.width - group.width * scale) / 2,
      top: (state.height - group.height * scale) / 2,
      scaleX: scale,
      scaleY: scale
    });
    assignObjectMetadata(group, file.name || "SVG", { source: "upload", kind: "vector" });
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
    const asset = await APP.addAsset({ name: file.name, src, source: "upload", kind: "image" });
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

  function duplicateActive() {
    const active = canvas.getActiveObject();
    if (!active || active.type === "activeselection") return;
    active.clone(["name", "assetId", "source", "kind"]).then(clone => {
      clone.set({ left: (active.left || 0) + 24, top: (active.top || 0) + 24 });
      clone.name = objectName(active) + " copy";
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
    if (active.type === "activeselection") {
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
    if (!active || active.type === "activeselection") return;
    const width = Math.max(1, Number($("propWidth").value) || active.getScaledWidth());
    const height = Math.max(1, Number($("propHeight").value) || active.getScaledHeight());
    active.name = $("propName").value.trim() || objectName(active);
    active.set({
      left: Number($("propX").value) || 0,
      top: Number($("propY").value) || 0,
      angle: Number($("propAngle").value) || 0,
      opacity: Math.max(0, Math.min(1, Number($("propOpacity").value) || 0))
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
    if (!active || active.type === "activeselection") return;
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

  async function loadAutosave() {
    try {
      const project = await SkoomaStore.getProject("autosave");
      if (!project?.canvas) {
        snapshotLabel("Начальное состояние");
        return;
      }
      state.restoring = true;
      state.historyMuted = true;
      state.width = project.width || 1280;
      state.height = project.height || 720;
      state.transparent = project.transparent !== false;
      canvas.setDimensions({ width: state.width, height: state.height });
      canvas.backgroundColor = state.transparent ? null : "#ffffff";
      await canvas.loadFromJSON(project.canvas);
      canvas.getObjects().forEach(obj => assignObjectMetadata(obj, obj.name, obj));
      canvas.requestRenderAll();
      state.historyMuted = false;
      state.restoring = false;
      state.history = [];
      state.historyIndex = -1;
      snapshotLabel("Восстановлен autosave");
      syncSelectionUi();
      fitToViewport();
    } catch (error) {
      console.error("Autosave restore failed", error);
      snapshotLabel("Начальное состояние");
    }
  }

  function exportImage(format = "png") {
    const mimeFormat = format === "jpg" ? "jpeg" : format;
    const data = canvas.toDataURL({ format: mimeFormat, quality: 0.92, multiplier: 1 });
    const a = document.createElement("a");
    a.href = data;
    a.download = "skooma-export." + (format === "jpeg" ? "jpg" : format);
    a.click();
  }

  function bindEvents() {
    canvas.on("selection:created", syncSelectionUi);
    canvas.on("selection:updated", syncSelectionUi);
    canvas.on("selection:cleared", syncSelectionUi);
    canvas.on("object:modified", () => {
      snapshotLabel("Изменён объект");
      syncSelectionUi();
    });
    canvas.on("path:created", event => {
      const path = event.path;
      if (!path) return;
      if (state.tool === "eraser") {
        path.globalCompositeOperation = "destination-out";
        path.selectable = false;
        path.evented = false;
      }
      assignObjectMetadata(path, state.tool === "eraser" ? "Eraser stroke" : "Brush stroke", {
        kind: "drawing",
        source: "studio"
      });
      snapshotLabel(state.tool === "eraser" ? "Ластик" : "Кисть");
      renderLayers();
    });

    canvas.on("mouse:down", event => {
      const pointer = event.e;
      if (state.tool === "hand") {
        state.isPanning = true;
        state.lastPointer = { x: pointer.clientX, y: pointer.clientY };
        canvas.defaultCursor = "grabbing";
      } else if (state.tool === "zoom") {
        setZoom(state.viewScale * (pointer.altKey ? 0.85 : 1.15));
      } else if (state.tool === "text" && !event.target) {
        const point = canvas.getScenePoint(event.e);
        addTextAt(point.x, point.y);
        setTool("move");
      } else if (state.tool === "rect" && !event.target) {
        const point = canvas.getScenePoint(event.e);
        addRectAt(point.x, point.y);
        setTool("move");
      } else if (state.tool === "ellipse" && !event.target) {
        const point = canvas.getScenePoint(event.e);
        addEllipseAt(point.x, point.y);
        setTool("move");
      }
    });

    canvas.on("mouse:move", event => {
      if (!state.isPanning || !state.lastPointer) return;
      const pointer = event.e;
      state.panX += pointer.clientX - state.lastPointer.x;
      state.panY += pointer.clientY - state.lastPointer.y;
      state.lastPointer = { x: pointer.clientX, y: pointer.clientY };
      applyViewTransform();
    });

    canvas.on("mouse:up", () => {
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
      const item = [...(event.clipboardData?.items || [])].find(entry => entry.type.startsWith("image/"));
      if (!item) return;
      const file = item.getAsFile();
      if (file) await importFile(file);
    });

    qsa(".tool-button[data-tool]").forEach(btn => btn.onclick = () => setTool(btn.dataset.tool));

    $("brushSize").oninput = () => {
      if (state.tool === "brush" || state.tool === "eraser") setTool(state.tool);
    };
    $("brushOpacity").oninput = () => {
      if (state.tool === "brush" || state.tool === "eraser") setTool(state.tool);
    };
    $("brushColor").oninput = () => {
      if (state.tool === "brush") setTool("brush");
    };

    $("generateAiBtn").onclick = generateAi;
    $("duplicateBtn").onclick = duplicateActive;
    $("deleteBtn").onclick = deleteActive;
    $("undoBtn").onclick = undo;
    $("redoBtn").onclick = redo;
    $("applyPropertiesBtn").onclick = applyProperties;
    $("applyTransformBtn").onclick = applyContextTransform;

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
      if (mod && event.key.toLowerCase() === "d") {
        event.preventDefault(); duplicateActive(); return;
      }
      if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault(); saveNow(); return;
      }
      if (!typing && event.key === "Delete") {
        event.preventDefault(); deleteActive(); return;
      }
      if (typing) return;

      const key = event.key.toLowerCase();
      if (key === "v") setTool("move");
      else if (key === "b") setTool("brush");
      else if (key === "e") setTool("eraser");
      else if (key === "t") setTool("text");
      else if (key === "r") setTool("rect");
      else if (key === "o") setTool("ellipse");
      else if (key === "h") setTool("hand");
      else if (key === "z") setTool("zoom");
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
    undo,
    redo
  };
})();