window.Studio = (() => {
  const $ = id => document.getElementById(id);
  const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const F = window.fabric;
  const MagicWand = window.MagicWand;

  if (!F) {
    console.error("Fabric.js failed to load.");
    return {};
  }

  F.FabricObject.customProperties = ["name", "assetId", "source", "kind", "helper"];

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
    lassoPoints: [],
    lassoHelper: null,
    cropRect: null,
    wand: null,
    guides: { v: [], h: [] },
    filterState: new WeakMap()
  };

  const MAX_HISTORY = 40;
  const SNAP = 6;

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function objectName(object) {
    if (object?.name) return object.name;
    if (object instanceof F.IText || object instanceof F.Textbox) return "Text";
    if (object instanceof F.FabricImage) return "Image";
    if (object instanceof F.Rect) return "Rectangle";
    if (object instanceof F.Ellipse) return "Ellipse";
    if (object instanceof F.Group) return "Group";
    if (object instanceof F.Path) return object.globalCompositeOperation === "destination-out" ? "Eraser" : "Brush";
    return "Object";
  }

  function objectKind(object) {
    if (object?.kind) return object.kind;
    if (object instanceof F.IText || object instanceof F.Textbox) return "text";
    if (object instanceof F.FabricImage) return "image";
    if (object instanceof F.Group) return "group";
    if (object instanceof F.Rect || object instanceof F.Ellipse) return "shape";
    if (object instanceof F.Path) return "drawing";
    return "object";
  }

  function isHelper(object) {
    return !!object?.helper || !!object?.excludeFromExport;
  }

  function realObjects() {
    return canvas.getObjects().filter(object => !isHelper(object));
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
    state.width = Math.max(1, Math.round(width));
    state.height = Math.max(1, Math.round(height));
    canvas.setDimensions({ width: state.width, height: state.height });
    $("docStatus").textContent = state.width + " × " + state.height;
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
    state.viewScale = Math.max(0.05, Math.min(8, next));
    applyViewTransform();
  }

  function setContext(name) {
    ["contextDefault","contextBrush","contextText","contextMove","contextSelection","contextWand","contextCrop","contextShape"]
      .forEach(id => $(id)?.classList.add("hidden"));
    $(name)?.classList.remove("hidden");
  }

  function clearToolHelpers() {
    if (state.lassoHelper) {
      canvas.remove(state.lassoHelper);
      state.lassoHelper = null;
    }
    if (state.cropRect) {
      canvas.remove(state.cropRect);
      state.cropRect = null;
    }
    clearWand();
    state.lassoPoints = [];
    $("canvasFrame").classList.remove("selection-mode","crop-mode","lasso-mode","wand-mode","eyedropper-mode","fill-mode");
  }

  function setBrush(tool) {
    canvas.isDrawingMode = true;
    const brush = new F.PencilBrush(canvas);
    const configuredSize = Math.max(1, Number($("brushSize").value) || 18);
    const opacity = Math.max(0.05, Number($("brushOpacity").value) || 1);
    brush.width = tool === "pencil" ? Math.min(4, configuredSize) : configuredSize;
    brush.color = tool === "eraser" ? "rgba(255,255,255,0.25)" : hexToRgba($("brushColor").value, opacity);
    canvas.freeDrawingBrush = brush;
    $("brushContextTitle").textContent = tool === "eraser" ? "Ластик" : tool === "pencil" ? "Карандаш" : "Кисть";
    setContext("contextBrush");
  }

  function setTool(tool, preserveHelpers = false) {
    if (!preserveHelpers) clearToolHelpers();
    state.tool = tool;
    qsa(".tool-button[data-tool]").forEach(btn => btn.classList.toggle("active", btn.dataset.tool === tool));

    canvas.isDrawingMode = false;
    canvas.selection = false;
    canvas.skipTargetFind = false;
    canvas.defaultCursor = "default";

    if (tool === "move") {
      canvas.selection = true;
      setContext(canvas.getActiveObject() ? "contextMove" : "contextDefault");
    } else if (tool === "marquee") {
      canvas.selection = true;
      canvas.discardActiveObject();
      canvas.requestRenderAll();
      canvas.defaultCursor = "crosshair";
      $("selectionContextTitle").textContent = "Rectangle Select";
      $("canvasFrame").classList.add("selection-mode");
      setContext("contextSelection");
    } else if (tool === "lasso") {
      canvas.skipTargetFind = true;
      canvas.defaultCursor = "crosshair";
      $("selectionContextTitle").textContent = "Lasso";
      $("canvasFrame").classList.add("lasso-mode");
      setContext("contextSelection");
    } else if (tool === "wand") {
      canvas.skipTargetFind = true;
      canvas.defaultCursor = "crosshair";
      $("canvasFrame").classList.add("wand-mode");
      setContext("contextWand");
    } else if (tool === "crop") {
      canvas.skipTargetFind = false;
      $("canvasFrame").classList.add("crop-mode");
      startCrop();
      setContext("contextCrop");
    } else if (["brush","pencil","eraser"].includes(tool)) {
      setBrush(tool);
    } else if (tool === "fill") {
      canvas.defaultCursor = "crosshair";
      $("canvasFrame").classList.add("fill-mode");
      setContext("contextShape");
    } else if (tool === "eyedropper") {
      canvas.skipTargetFind = true;
      canvas.defaultCursor = "crosshair";
      $("canvasFrame").classList.add("eyedropper-mode");
      setContext("contextDefault");
    } else if (tool === "text") {
      canvas.skipTargetFind = true;
      setContext("contextText");
    } else if (tool === "rect" || tool === "ellipse") {
      canvas.skipTargetFind = true;
      setContext("contextShape");
    } else if (tool === "hand") {
      canvas.skipTargetFind = true;
      canvas.defaultCursor = "grab";
      setContext("contextDefault");
    } else if (tool === "zoom") {
      canvas.skipTargetFind = true;
      canvas.defaultCursor = "zoom-in";
      setContext("contextDefault");
    }

    $("toolStatus").textContent = {
      move:"Move (V)", marquee:"Rectangle Select (M)", lasso:"Lasso (L)", wand:"Magic Wand (W)",
      crop:"Crop (C)", brush:"Brush (B)", pencil:"Pencil (P)", eraser:"Eraser (E)",
      fill:"Fill (G)", eyedropper:"Eyedropper (I)", text:"Text (T)",
      rect:"Rectangle (R)", ellipse:"Ellipse (O)", hand:"Hand (H)", zoom:"Zoom (Z)"
    }[tool] || tool;
  }

  function hexToRgba(hex, alpha) {
    const raw = String(hex || "#000000").replace("#","");
    const full = raw.length === 3 ? raw.split("").map(x => x + x).join("") : raw;
    const n = parseInt(full,16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + alpha + ")";
  }

  function serialize() {
    return {
      id:"autosave",
      version:3,
      width:state.width,
      height:state.height,
      transparent:state.transparent,
      canvas:canvas.toJSON(["name","assetId","source","kind","helper"]),
      updatedAt:Date.now()
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
    state.autosaveTimer = setTimeout(saveNow,700);
  }

  function snapshotLabel(label) {
    if (state.historyMuted || state.restoring) return;
    const snap = {
      label,
      width:state.width,
      height:state.height,
      transparent:state.transparent,
      json:canvas.toJSON(["name","assetId","source","kind","helper"])
    };
    if (state.historyIndex < state.history.length - 1) state.history = state.history.slice(0,state.historyIndex + 1);
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
    canvas.setDimensions({ width:state.width,height:state.height });
    canvas.backgroundColor = state.transparent ? null : "#ffffff";
    await canvas.loadFromJSON(snapshot.json);
    canvas.getObjects().filter(object => !isHelper(object)).forEach(object => assignObjectMetadata(object,object.name,object));
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
    state.history.forEach((entry,index) => {
      const row = document.createElement("div");
      row.className = "history-item" + (index === state.historyIndex ? " current" : "");
      row.textContent = entry.label;
      list.appendChild(row);
    });
  }

  function selectionSummary() {
    const active = canvas.getActiveObject();
    if (!active || isHelper(active)) return "Ничего не выбрано";
    const count = active instanceof F.ActiveSelection ? active.getObjects().filter(o => !isHelper(o)).length : 1;
    return count > 1 ? "Выбрано объектов: " + count : objectName(active);
  }

  function updateContextTransform() {
    const active = canvas.getActiveObject();
    if (!active || active instanceof F.ActiveSelection || isHelper(active)) {
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
    const objects = realObjects();
    if (!objects.length) {
      list.innerHTML = '<div class="empty-state">Слоёв пока нет.</div>';
      return;
    }

    [...objects].reverse().forEach(object => {
      const row = document.createElement("div");
      row.className = "layer-row" + (canvas.getActiveObject() === object ? " active" : "");
      row.draggable = true;
      row.dataset.objectIndex = canvas.getObjects().indexOf(object);

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
        objectKind(object) === "drawing" ? "✎" :
        objectKind(object) === "group" ? "▦" : "◇";
      thumb.style.display = "grid";
      thumb.style.placeItems = "center";
      thumb.style.color = "#9fb0c3";
      thumb.style.fontWeight = "900";

      const meta = document.createElement("div");
      meta.className = "layer-meta";
      meta.innerHTML = '<div class="layer-name">' + APP.escapeHtml(objectName(object)) +
        '</div><div class="layer-type">' + APP.escapeHtml(objectKind(object)) + '</div>';

      const lock = document.createElement("button");
      lock.className = "layer-lock";
      lock.textContent = object.lockMovementX ? "🔒" : "🔓";
      lock.title = "Lock";
      lock.onclick = event => {
        event.stopPropagation();
        const locked = !object.lockMovementX;
        object.set({
          lockMovementX:locked,lockMovementY:locked,lockScalingX:locked,lockScalingY:locked,
          lockRotation:locked,selectable:!locked
        });
        snapshotLabel(locked ? "Слой заблокирован" : "Слой разблокирован");
        renderLayers();
      };

      row.append(eye,thumb,meta,lock);
      row.onclick = () => {
        if (object.selectable === false) return;
        canvas.setActiveObject(object);
        canvas.requestRenderAll();
        syncSelectionUi();
      };
      row.ondragstart = event => event.dataTransfer.setData("text/x-skooma-layer",String(canvas.getObjects().indexOf(object)));
      row.ondragover = event => event.preventDefault();
      row.ondrop = event => {
        event.preventDefault();
        const from = Number(event.dataTransfer.getData("text/x-skooma-layer"));
        const target = canvas.getObjects().indexOf(object);
        const moving = canvas.item(from);
        if (moving && from !== target && !isHelper(moving)) {
          canvas.moveObjectTo(moving,target);
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
    if (!active || active instanceof F.ActiveSelection || isHelper(active)) {
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
    $("imageFilters").classList.toggle("hidden", !(active instanceof F.FabricImage));
    if (active instanceof F.FabricImage) syncFilterControls(active);
  }

  function syncSelectionUi() {
    $("selectionStatus").textContent = selectionSummary();
    renderLayers();
    renderProperties();
    updateContextTransform();
  }

  async function addImageFromUrl(src,name="Image",asset=null,placement=null) {
    const image = await F.FabricImage.fromURL(src,{ crossOrigin:"anonymous" });
    let scale = 1;
    if (!placement) {
      const maxW = state.width * 0.8;
      const maxH = state.height * 0.8;
      scale = Math.min(maxW / image.width,maxH / image.height,1);
    }
    image.set({
      left:placement?.left ?? (state.width - image.width * scale) / 2,
      top:placement?.top ?? (state.height - image.height * scale) / 2,
      scaleX:placement?.scaleX ?? scale,
      scaleY:placement?.scaleY ?? scale
    });
    assignObjectMetadata(image,name,{
      assetId:asset?.id,
      source:asset?.source || "image",
      kind:asset?.kind === "generated" ? "image" : "image"
    });
    canvas.add(image);
    canvas.setActiveObject(image);
    canvas.requestRenderAll();
    snapshotLabel("Добавлено изображение");
    syncSelectionUi();
    return image;
  }

  async function importSvg(file) {
    const text = await file.text();
    const parsed = await F.loadSVGFromString(text);
    const objects = (parsed.objects || []).filter(Boolean);
    if (!objects.length) throw new Error("SVG не содержит объектов.");
    const group = F.util.groupSVGElements(objects,parsed.options || {});
    const maxW = state.width * 0.8;
    const maxH = state.height * 0.8;
    const scale = Math.min(maxW / group.width,maxH / group.height,1);
    group.set({
      left:(state.width - group.width * scale) / 2,
      top:(state.height - group.height * scale) / 2,
      scaleX:scale,scaleY:scale
    });
    assignObjectMetadata(group,file.name || "SVG",{ source:"upload",kind:"vector" });
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
    const asset = await APP.addAsset({ name:file.name,src,source:"upload",kind:"upload" });
    await addImageFromUrl(src,file.name,asset);
  }

  function addTextAt(x=state.width/2-120,y=state.height/2-30) {
    const text = new F.IText("Новый текст",{
      left:x,top:y,fill:$("textColor").value,
      fontSize:Math.max(8,Number($("textSize").value)||48),
      textAlign:$("textAlign").value,
      fontFamily:$("textFont").value
    });
    assignObjectMetadata(text,"Text",{ kind:"text",source:"studio" });
    canvas.add(text);
    canvas.setActiveObject(text);
    text.enterEditing();
    text.selectAll();
    snapshotLabel("Добавлен текст");
    syncSelectionUi();
  }

  function addRectAt(x=state.width/2-100,y=state.height/2-60) {
    const rect = new F.Rect({
      left:x,top:y,width:200,height:120,fill:$("shapeFill").value,
      stroke:$("shapeStrokeWidth").value > 0 ? $("shapeStroke").value : null,
      strokeWidth:Number($("shapeStrokeWidth").value)||0,rx:4,ry:4
    });
    assignObjectMetadata(rect,"Rectangle",{ kind:"shape",source:"studio" });
    canvas.add(rect); canvas.setActiveObject(rect);
    snapshotLabel("Добавлен прямоугольник"); syncSelectionUi();
  }

  function addEllipseAt(x=state.width/2-90,y=state.height/2-60) {
    const ellipse = new F.Ellipse({
      left:x,top:y,rx:90,ry:60,fill:$("shapeFill").value,
      stroke:$("shapeStrokeWidth").value > 0 ? $("shapeStroke").value : null,
      strokeWidth:Number($("shapeStrokeWidth").value)||0
    });
    assignObjectMetadata(ellipse,"Ellipse",{ kind:"shape",source:"studio" });
    canvas.add(ellipse); canvas.setActiveObject(ellipse);
    snapshotLabel("Добавлен эллипс"); syncSelectionUi();
  }

  async function copyActive() {
    const active = canvas.getActiveObject();
    if (!active || active instanceof F.ActiveSelection || isHelper(active)) return;
    state.clipboard = await active.clone(["name","assetId","source","kind"]);
  }

  async function pasteClipboard() {
    if (!state.clipboard) return;
    const clone = await state.clipboard.clone(["name","assetId","source","kind"]);
    clone.set({ left:(clone.left||0)+24,top:(clone.top||0)+24,evented:true });
    clone.name = objectName(clone) + " copy";
    canvas.add(clone); canvas.setActiveObject(clone); canvas.requestRenderAll();
    state.clipboard = clone;
    snapshotLabel("Вставлен объект"); syncSelectionUi();
  }

  async function cutActive() { await copyActive(); deleteActive(); }

  function duplicateActive() {
    const active = canvas.getActiveObject();
    if (!active || active instanceof F.ActiveSelection || isHelper(active)) return;
    active.clone(["name","assetId","source","kind"]).then(clone => {
      clone.set({ left:(active.left||0)+24,top:(active.top||0)+24 });
      clone.name = objectName(active) + " copy";
      canvas.add(clone); canvas.setActiveObject(clone); canvas.requestRenderAll();
      snapshotLabel("Дублирован слой"); syncSelectionUi();
    });
  }

  function deleteActive() {
    const active = canvas.getActiveObject();
    if (!active || isHelper(active)) return;
    const objects = canvas.getActiveObjects().filter(object => !isHelper(object));
    canvas.discardActiveObject();
    objects.forEach(object => canvas.remove(object));
    canvas.requestRenderAll();
    snapshotLabel("Удалён слой");
    syncSelectionUi();
  }

  function applyProperties() {
    const active = canvas.getActiveObject();
    if (!active || active instanceof F.ActiveSelection || isHelper(active)) return;
    const width = Math.max(1,Number($("propWidth").value)||active.getScaledWidth());
    const height = Math.max(1,Number($("propHeight").value)||active.getScaledHeight());
    active.name = $("propName").value.trim() || objectName(active);
    active.set({
      left:Number($("propX").value)||0,
      top:Number($("propY").value)||0,
      angle:Number($("propAngle").value)||0,
      opacity:Math.max(0,Math.min(1,Number($("propOpacity").value))),
      globalCompositeOperation:$("propBlend").value || "source-over"
    });
    if (active.width) active.scaleX = width / active.width;
    if (active.height) active.scaleY = height / active.height;
    active.setCoords(); canvas.requestRenderAll();
    snapshotLabel("Изменены свойства"); syncSelectionUi();
  }

  function applyContextTransform() {
    const active = canvas.getActiveObject();
    if (!active || active instanceof F.ActiveSelection || isHelper(active)) return;
    const width = Math.max(1,Number($("ctxW").value)||active.getScaledWidth());
    const height = Math.max(1,Number($("ctxH").value)||active.getScaledHeight());
    active.set({
      left:Number($("ctxX").value)||0,
      top:Number($("ctxY").value)||0,
      angle:Number($("ctxAngle").value)||0
    });
    if (active.width) active.scaleX = width / active.width;
    if (active.height) active.scaleY = height / active.height;
    active.setCoords(); canvas.requestRenderAll();
    snapshotLabel("Transform"); syncSelectionUi();
  }

  function selectAll() {
    const objects = realObjects().filter(object => object.selectable !== false && object.visible !== false);
    if (!objects.length) return;
    const selection = new F.ActiveSelection(objects,{ canvas });
    canvas.setActiveObject(selection); canvas.requestRenderAll(); syncSelectionUi();
  }

  function clearSelection() {
    canvas.discardActiveObject(); canvas.requestRenderAll(); syncSelectionUi();
  }

  function pointInPolygon(point,polygon) {
    let inside = false;
    for (let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
      const xi=polygon[i].x, yi=polygon[i].y, xj=polygon[j].x, yj=polygon[j].y;
      const intersect=((yi>point.y)!==(yj>point.y)) &&
        (point.x < (xj-xi)*(point.y-yi)/(yj-yi+Number.EPSILON)+xi);
      if (intersect) inside=!inside;
    }
    return inside;
  }

  function applyObjectSelection(objects) {
    const mode = $("selectionMode").value;
    const current = canvas.getActiveObjects().filter(object => !isHelper(object));
    let result = objects;
    if (mode === "add") result = [...new Set([...current,...objects])];
    if (mode === "subtract") result = current.filter(object => !objects.includes(object));
    canvas.discardActiveObject();
    if (result.length === 1) canvas.setActiveObject(result[0]);
    else if (result.length > 1) canvas.setActiveObject(new F.ActiveSelection(result,{ canvas }));
    canvas.requestRenderAll();
    syncSelectionUi();
  }

  function startLasso(point) {
    state.lassoPoints = [point];
    state.lassoHelper = new F.Polyline([point],{
      fill:"rgba(111,125,255,0.08)",stroke:"#7d8cff",strokeWidth:1.5,
      selectable:false,evented:false,excludeFromExport:true,helper:true,objectCaching:false
    });
    canvas.add(state.lassoHelper);
  }

  function updateLasso(point) {
    if (!state.lassoHelper) return;
    state.lassoPoints.push(point);
    state.lassoHelper.set({ points:[...state.lassoPoints] });
    state.lassoHelper.setCoords();
    canvas.requestRenderAll();
  }

  function finishLasso() {
    if (!state.lassoHelper || state.lassoPoints.length < 3) return;
    const selected = realObjects().filter(object => pointInPolygon(object.getCenterPoint(),state.lassoPoints));
    canvas.remove(state.lassoHelper); state.lassoHelper=null;
    applyObjectSelection(selected);
    state.lassoPoints=[];
  }

  function startCrop() {
    if (state.cropRect) canvas.remove(state.cropRect);
    const inset = Math.round(Math.min(state.width,state.height)*0.08);
    state.cropRect = new F.Rect({
      left:inset,top:inset,width:Math.max(32,state.width-inset*2),height:Math.max(32,state.height-inset*2),
      fill:"rgba(0,0,0,0.04)",stroke:"#ffffff",strokeWidth:1.5,strokeDashArray:[8,6],
      cornerColor:"#ffffff",cornerStrokeColor:"#6f7dff",transparentCorners:false,
      excludeFromExport:true,helper:true,name:"Crop area"
    });
    canvas.add(state.cropRect); canvas.setActiveObject(state.cropRect); canvas.requestRenderAll();
  }

  function updateCropRatio() {
    if (!state.cropRect) return;
    const value = $("cropRatio").value;
    if (value === "free") {
      state.cropRect.lockUniScaling = false;
      return;
    }
    const [rw,rh] = value.split(":").map(Number);
    const ratio = rw/rh;
    const w = state.cropRect.getScaledWidth();
    state.cropRect.set({ scaleY:1,height:w/ratio });
    state.cropRect.setCoords(); canvas.requestRenderAll();
  }

  function applyCrop() {
    if (!state.cropRect) return;
    const box = state.cropRect.getBoundingRect();
    const left = Math.max(0,Math.round(box.left));
    const top = Math.max(0,Math.round(box.top));
    const width = Math.max(1,Math.min(state.width-left,Math.round(box.width)));
    const height = Math.max(1,Math.min(state.height-top,Math.round(box.height)));
    canvas.discardActiveObject();
    canvas.remove(state.cropRect); state.cropRect=null;
    realObjects().forEach(object => {
      object.set({ left:(object.left||0)-left,top:(object.top||0)-top });
      object.setCoords();
    });
    setDocumentSize(width,height);
    canvas.requestRenderAll();
    snapshotLabel("Crop " + width + "×" + height);
    setTool("move");
    syncSelectionUi();
  }

  function cancelCrop() {
    if (state.cropRect) canvas.remove(state.cropRect);
    state.cropRect=null; canvas.discardActiveObject(); canvas.requestRenderAll(); setTool("move");
  }

  function helpersVisible(value) {
    const changed=[];
    canvas.getObjects().forEach(object => {
      if (isHelper(object)) {
        changed.push([object,object.visible]);
        object.visible=value;
      }
    });
    return () => changed.forEach(([object,visible]) => object.visible=visible);
  }

  function renderFlatCanvas() {
    const restore = helpersVisible(false);
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    const el = canvas.toCanvasElement(1);
    restore();
    canvas.requestRenderAll();
    return el;
  }

  function clearWand() {
    if (state.wand?.preview) canvas.remove(state.wand.preview);
    state.wand=null;
    if ($("wandToLayerBtn")) $("wandToLayerBtn").disabled=true;
    if ($("wandCancelBtn")) $("wandCancelBtn").disabled=true;
  }

  async function magicWandAt(point) {
    clearWand();
    if (!MagicWand?.floodFill) {
      $("selectionStatus").textContent="Magic Wand library не загрузилась";
      return;
    }
    const source = renderFlatCanvas();
    const ctx = source.getContext("2d",{ willReadFrequently:true });
    const imageData = ctx.getImageData(0,0,state.width,state.height);
    const x=Math.max(0,Math.min(state.width-1,Math.floor(point.x)));
    const y=Math.max(0,Math.min(state.height-1,Math.floor(point.y)));
    const tolerance=Math.max(0,Math.min(255,Number($("wandTolerance").value)||32));
    const mask=MagicWand.floodFill({ data:imageData.data,width:state.width,height:state.height,bytes:4 },x,y,tolerance,null,true);
    if (!mask) return;
    let bounds=mask.bounds;
    if (!bounds || bounds.minX===undefined) {
      let minX=state.width,minY=state.height,maxX=0,maxY=0,found=false;
      for (let yy=0;yy<state.height;yy++) for (let xx=0;xx<state.width;xx++) {
        const idx=yy*state.width+xx;
        if (mask.data[idx]) { found=true;minX=Math.min(minX,xx);minY=Math.min(minY,yy);maxX=Math.max(maxX,xx);maxY=Math.max(maxY,yy); }
      }
      if (!found) return;
      bounds={ minX,minY,maxX,maxY };
    }
    const previewCanvas=document.createElement("canvas");
    previewCanvas.width=state.width; previewCanvas.height=state.height;
    const pctx=previewCanvas.getContext("2d");
    const preview=pctx.createImageData(state.width,state.height);
    for (let i=0;i<mask.data.length;i++) {
      if (mask.data[i]) {
        const p=i*4; preview.data[p]=111;preview.data[p+1]=125;preview.data[p+2]=255;preview.data[p+3]=105;
      }
    }
    pctx.putImageData(preview,0,0);
    const previewObj=await F.FabricImage.fromURL(previewCanvas.toDataURL("image/png"));
    previewObj.set({ left:0,top:0,selectable:false,evented:false,excludeFromExport:true,helper:true,opacity:1 });
    canvas.add(previewObj); canvas.bringObjectToFront(previewObj); canvas.requestRenderAll();
    state.wand={ mask,bounds,source,preview:previewObj };
    $("wandToLayerBtn").disabled=false;
    $("wandCancelBtn").disabled=false;
    $("selectionStatus").textContent="Magic Wand selection";
  }

  async function wandToLayer() {
    if (!state.wand) return;
    const { mask,bounds,source }=state.wand;
    const width=bounds.maxX-bounds.minX+1;
    const height=bounds.maxY-bounds.minY+1;
    const srcCtx=source.getContext("2d");
    const src=srcCtx.getImageData(bounds.minX,bounds.minY,width,height);
    for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
      const maskIndex=(bounds.minY+y)*state.width+(bounds.minX+x);
      if (!mask.data[maskIndex]) src.data[(y*width+x)*4+3]=0;
    }
    const out=document.createElement("canvas");out.width=width;out.height=height;
    out.getContext("2d").putImageData(src,0,0);
    const url=out.toDataURL("image/png");
    const asset=await APP.addAsset({ name:"Magic Wand selection",src:url,source:"Studio",kind:"selection" });
    clearWand();
    await addImageFromUrl(url,"Magic Wand selection",asset,{ left:bounds.minX,top:bounds.minY,scaleX:1,scaleY:1 });
    snapshotLabel("Magic Wand → Layer");
    setTool("move");
  }

  function eyedropAt(point) {
    const source=renderFlatCanvas();
    const d=source.getContext("2d").getImageData(
      Math.max(0,Math.min(state.width-1,Math.floor(point.x))),
      Math.max(0,Math.min(state.height-1,Math.floor(point.y))),1,1
    ).data;
    const hex="#" + [d[0],d[1],d[2]].map(v=>v.toString(16).padStart(2,"0")).join("");
    $("brushColor").value=hex; $("textColor").value=hex; $("shapeFill").value=hex;
    $("selectionStatus").textContent="Color " + hex.toUpperCase();
  }

  function fillTarget(target) {
    if (!target || isHelper(target)) {
      state.transparent=false;
      canvas.backgroundColor=$("shapeFill").value;
      canvas.requestRenderAll(); snapshotLabel("Изменён фон");
      return;
    }
    if ("fill" in target) {
      target.set("fill",$("shapeFill").value);
      canvas.requestRenderAll(); snapshotLabel("Fill");
      syncSelectionUi();
    }
  }

  function groupSelected() {
    const active=canvas.getActiveObject();
    if (!(active instanceof F.ActiveSelection)) return;
    const objects=active.removeAll().filter(object=>!isHelper(object));
    canvas.discardActiveObject();
    objects.forEach(object=>canvas.remove(object));
    const group=new F.Group(objects,{ subTargetCheck:true });
    assignObjectMetadata(group,"Group",{ kind:"group",source:"studio" });
    canvas.add(group);canvas.setActiveObject(group);canvas.requestRenderAll();
    snapshotLabel("Сгруппированы слои");syncSelectionUi();
  }

  function ungroupSelected() {
    const active=canvas.getActiveObject();
    if (!(active instanceof F.Group) || active instanceof F.ActiveSelection) return;
    const items=active.removeAll();
    canvas.remove(active);
    items.forEach(object=>canvas.add(object));
    const selection=new F.ActiveSelection(items,{ canvas });
    canvas.setActiveObject(selection);canvas.requestRenderAll();
    snapshotLabel("Разгруппированы слои");syncSelectionUi();
  }

  async function mergeSelected() {
    const objects=canvas.getActiveObjects().filter(object=>!isHelper(object));
    if (objects.length<2) return;
    const bounds=objects.reduce((acc,object)=>{
      const b=object.getBoundingRect();
      return {
        left:Math.min(acc.left,b.left),top:Math.min(acc.top,b.top),
        right:Math.max(acc.right,b.left+b.width),bottom:Math.max(acc.bottom,b.top+b.height)
      };
    },{ left:Infinity,top:Infinity,right:-Infinity,bottom:-Infinity });
    const width=Math.max(1,Math.ceil(bounds.right-bounds.left));
    const height=Math.max(1,Math.ceil(bounds.bottom-bounds.top));
    const temp=new F.StaticCanvas(null,{ width,height,backgroundColor:null });
    for (const object of objects) {
      const clone=await object.clone(["name","assetId","source","kind"]);
      clone.set({ left:(clone.left||0)-bounds.left,top:(clone.top||0)-bounds.top });
      temp.add(clone);
    }
    temp.renderAll();
    const src=temp.toDataURL({ format:"png",multiplier:1 });
    temp.dispose();
    canvas.discardActiveObject();
    objects.forEach(object=>canvas.remove(object));
    const asset=await APP.addAsset({ name:"Merged layer",src,source:"Studio",kind:"image" });
    await addImageFromUrl(src,"Merged layer",asset,{ left:bounds.left,top:bounds.top,scaleX:1,scaleY:1 });
    snapshotLabel("Merge layers");
  }

  async function flattenCanvas() {
    if (!realObjects().length) return;
    const src=exportDataUrl("png");
    state.historyMuted=true;
    canvas.clear();
    canvas.backgroundColor=null;
    const image=await F.FabricImage.fromURL(src);
    image.set({ left:0,top:0,scaleX:state.width/image.width,scaleY:state.height/image.height });
    assignObjectMetadata(image,"Flattened",{ kind:"image",source:"Studio" });
    canvas.add(image);canvas.setActiveObject(image);
    state.historyMuted=false;
    canvas.requestRenderAll();
    snapshotLabel("Flatten image");syncSelectionUi();
  }

  function snapObject(object) {
    if (!object || isHelper(object)) return;
    state.guides={ v:[],h:[] };
    const b=object.getBoundingRect();
    let dx=0,dy=0;
    const verticalTargets=[0,state.width/2,state.width];
    const horizontalTargets=[0,state.height/2,state.height];
    const objX=[b.left,b.left+b.width/2,b.left+b.width];
    const objY=[b.top,b.top+b.height/2,b.top+b.height];
    verticalTargets.forEach(target=>objX.forEach(x=>{
      if (Math.abs(x-target)<=SNAP && Math.abs(dx)===0) { dx=target-x;state.guides.v.push(target); }
    }));
    horizontalTargets.forEach(target=>objY.forEach(y=>{
      if (Math.abs(y-target)<=SNAP && Math.abs(dy)===0) { dy=target-y;state.guides.h.push(target); }
    }));
    realObjects().filter(other=>other!==object).forEach(other=>{
      const ob=other.getBoundingRect();
      const tx=[ob.left,ob.left+ob.width/2,ob.left+ob.width];
      const ty=[ob.top,ob.top+ob.height/2,ob.top+ob.height];
      tx.forEach(target=>objX.forEach(x=>{if(Math.abs(x-target)<=SNAP&&dx===0){dx=target-x;state.guides.v.push(target)}}));
      ty.forEach(target=>objY.forEach(y=>{if(Math.abs(y-target)<=SNAP&&dy===0){dy=target-y;state.guides.h.push(target)}}));
    });
    if (dx||dy) {
      object.set({ left:(object.left||0)+dx,top:(object.top||0)+dy });
      object.setCoords();
    }
  }

  function drawGuides() {
    if (!state.guides.v.length && !state.guides.h.length) return;
    const ctx=canvas.getTopContext?.() || canvas.getSelectionContext?.();
    if (!ctx) return;
    ctx.save();
    ctx.strokeStyle="rgba(77,211,170,.9)";
    ctx.lineWidth=1;
    ctx.setLineDash([5,4]);
    state.guides.v.forEach(x=>{ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,state.height);ctx.stroke()});
    state.guides.h.forEach(y=>{ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(state.width,y);ctx.stroke()});
    ctx.restore();
  }

  function syncFilterControls(image) {
    const saved=state.filterState.get(image) || { brightness:0,contrast:0,saturation:0,blur:0,grayscale:false,sepia:false };
    $("filterBrightness").value=saved.brightness;
    $("filterContrast").value=saved.contrast;
    $("filterSaturation").value=saved.saturation;
    $("filterBlur").value=saved.blur;
  }

  function applyImageFilters(commit=false) {
    const image=canvas.getActiveObject();
    if (!(image instanceof F.FabricImage)) return;
    const values=state.filterState.get(image) || { grayscale:false,sepia:false };
    values.brightness=Number($("filterBrightness").value)||0;
    values.contrast=Number($("filterContrast").value)||0;
    values.saturation=Number($("filterSaturation").value)||0;
    values.blur=Number($("filterBlur").value)||0;
    const filters=[];
    if (values.brightness) filters.push(new F.filters.Brightness({ brightness:values.brightness }));
    if (values.contrast) filters.push(new F.filters.Contrast({ contrast:values.contrast }));
    if (values.saturation) filters.push(new F.filters.Saturation({ saturation:values.saturation }));
    if (values.blur) filters.push(new F.filters.Blur({ blur:values.blur }));
    if (values.grayscale) filters.push(new F.filters.Grayscale());
    if (values.sepia) filters.push(new F.filters.Sepia());
    image.filters=filters;
    image.applyFilters();
    state.filterState.set(image,values);
    canvas.requestRenderAll();
    if (commit) snapshotLabel("Image filters");
  }

  function toggleImageFilter(type) {
    const image=canvas.getActiveObject();
    if (!(image instanceof F.FabricImage)) return;
    const values=state.filterState.get(image) || { brightness:0,contrast:0,saturation:0,blur:0,grayscale:false,sepia:false };
    values[type]=!values[type];
    state.filterState.set(image,values);
    applyImageFilters(true);
  }

  function resetImageFilters() {
    const image=canvas.getActiveObject();
    if (!(image instanceof F.FabricImage)) return;
    state.filterState.set(image,{ brightness:0,contrast:0,saturation:0,blur:0,grayscale:false,sepia:false });
    image.filters=[];image.applyFilters();canvas.requestRenderAll();
    syncFilterControls(image);snapshotLabel("Filters reset");
  }

  async function generateAi(replace=false) {
    const prompt=$("aiPrompt").value.trim();
    if (!prompt) {
      $("aiStatus").textContent="Введите промпт.";
      $("aiStatus").className="drawer-status error";return;
    }
    const button=replace?$("replaceWithAiBtn"):$("generateAiBtn");
    const oldText=button.textContent;button.disabled=true;button.textContent="Генерация...";
    $("aiStatus").textContent="Puter AI...";$("aiStatus").className="drawer-status";
    const previous=canvas.getActiveObject();
    try {
      const [w,h]=$("aiRatio").value.split(":").map(Number);
      const result=await puter.ai.txt2img(prompt,{
        model:$("aiModel").value,quality:$("aiQuality").value,ratio:{w,h},test_mode:$("aiTestMode").checked
      });
      const src=result.src;
      const asset=await APP.addAsset({
        name:"AI: "+prompt.slice(0,32),src,source:"Puter / "+$("aiModel").selectedOptions[0].text,kind:"generated"
      });
      let placement=null;
      if (replace && previous && !isHelper(previous) && !(previous instanceof F.ActiveSelection)) {
        placement={
          left:previous.left,top:previous.top,
          scaleX:previous.getScaledWidth() / (previous.width || previous.getScaledWidth()),
          scaleY:previous.getScaledHeight() / (previous.height || previous.getScaledHeight())
        };
        canvas.remove(previous);
      }
      const newImage=await addImageFromUrl(src,asset.name,asset);
      if (replace && previous) {
        newImage.set({
          left:previous.left,top:previous.top,angle:previous.angle||0,
          scaleX:previous.getScaledWidth()/newImage.width,
          scaleY:previous.getScaledHeight()/newImage.height
        });
        newImage.setCoords();canvas.requestRenderAll();
        snapshotLabel("AI replaced selected layer");
      }
      $("aiStatus").textContent=replace?"Выбранный слой заменён.":"Готово. Результат добавлен новым слоем.";
      $("aiStatus").className="drawer-status ok";
      APP.refreshPuterState();
    } catch (error) {
      $("aiStatus").textContent="Ошибка: "+(error?.message||error?.msg||String(error));
      $("aiStatus").className="drawer-status error";
    } finally {
      button.disabled=false;button.textContent=oldText;
    }
  }

  async function newDocument(width,height,transparent=true) {
    state.historyMuted=true;
    canvas.clear();
    state.transparent=transparent;
    canvas.backgroundColor=transparent?null:"#ffffff";
    setDocumentSize(width,height);
    canvas.requestRenderAll();
    state.historyMuted=false;
    state.history=[];state.historyIndex=-1;
    snapshotLabel("Новый документ");syncSelectionUi();setTool("move");
  }

  async function loadAutosave() {
    try {
      const project=await SkoomaStore.getProject("autosave");
      if (!project?.canvas) { snapshotLabel("Начальное состояние");return; }
      await loadProjectObject(project,false);
      state.history=[];state.historyIndex=-1;snapshotLabel("Восстановлен autosave");
    } catch (error) {
      console.error("Autosave restore failed",error);snapshotLabel("Начальное состояние");
    }
  }

  async function loadProjectObject(project,recordHistory=true) {
    state.restoring=true;state.historyMuted=true;
    state.width=project.width||1280;state.height=project.height||720;
    state.transparent=project.transparent!==false;
    canvas.setDimensions({ width:state.width,height:state.height });
    canvas.backgroundColor=state.transparent?null:"#ffffff";
    await canvas.loadFromJSON(project.canvas);
    canvas.getObjects().filter(o=>!isHelper(o)).forEach(o=>assignObjectMetadata(o,o.name,o));
    canvas.requestRenderAll();state.historyMuted=false;state.restoring=false;
    syncSelectionUi();fitToViewport();$("docStatus").textContent=state.width+" × "+state.height;
    if(recordHistory)snapshotLabel("Импортирован проект");
  }

  function exportProjectJson() {
    const project={ ...serialize(),id:"project",assets:APP.assets || [] };
    const blob=new Blob([JSON.stringify(project,null,2)],{ type:"application/json" });
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download="skooma-project.json";a.click();
    setTimeout(()=>URL.revokeObjectURL(url),5000);
  }

  async function importProjectJson(file) {
    try {
      const project=JSON.parse(await file.text());
      if (!project?.canvas) throw new Error("Неверный файл проекта");
      for (const asset of project.assets || []) await APP.addAsset(asset);
      await loadProjectObject(project,true);
    } catch (error) {
      alert("Не удалось открыть проект: "+error.message);
    }
  }

  function exportDataUrl(format="png") {
    const restore=helpersVisible(false);
    canvas.discardActiveObject();canvas.requestRenderAll();
    const data=canvas.toDataURL({ format:format==="jpg"?"jpeg":format,quality:.92,multiplier:1 });
    restore();canvas.requestRenderAll();
    return data;
  }

  function exportImage(format="png") {
    const data=exportDataUrl(format);
    const a=document.createElement("a");a.href=data;a.download="skooma-export."+format;a.click();
  }

  function bindEvents() {
    canvas.on("selection:created",syncSelectionUi);
    canvas.on("selection:updated",syncSelectionUi);
    canvas.on("selection:cleared",syncSelectionUi);
    canvas.on("object:modified",event=>{
      if(isHelper(event.target))return;
      state.guides={v:[],h:[]};snapshotLabel("Изменён объект");syncSelectionUi();
    });
    canvas.on("object:moving",event=>{if(!isHelper(event.target))snapObject(event.target)});
    canvas.on("after:render",drawGuides);
    canvas.on("path:created",event=>{
      const path=event.path;if(!path)return;
      if(state.tool==="eraser"){
        path.globalCompositeOperation="destination-out";
        path.name="Eraser";
      }
      assignObjectMetadata(path,state.tool==="eraser"?"Eraser":"Brush",{kind:"drawing",source:"studio"});
      snapshotLabel(state.tool==="eraser"?"Ластик":"Кисть");renderLayers();canvas.requestRenderAll();
    });

    canvas.on("mouse:down",event=>{
      const e=event.e;
      const point=canvas.getScenePoint(e);
      if(state.tool==="hand"){
        state.isPanning=true;state.lastPointer={x:e.clientX,y:e.clientY};canvas.defaultCursor="grabbing";
      }else if(state.tool==="zoom"){
        setZoom(state.viewScale*(e.altKey?.85:1.15));
      }else if(state.tool==="text"&&!event.target){
        addTextAt(point.x,point.y);setTool("move");
      }else if(state.tool==="rect"&&!event.target){
        addRectAt(point.x,point.y);setTool("move");
      }else if(state.tool==="ellipse"&&!event.target){
        addEllipseAt(point.x,point.y);setTool("move");
      }else if(state.tool==="lasso"){
        startLasso(point);
      }else if(state.tool==="wand"){
        magicWandAt(point);
      }else if(state.tool==="eyedropper"){
        eyedropAt(point);
      }else if(state.tool==="fill"){
        fillTarget(event.target);
      }
    });

    canvas.on("mouse:move",event=>{
      const e=event.e;const point=canvas.getScenePoint(e);
      if(state.isPanning&&state.lastPointer){
        state.panX+=e.clientX-state.lastPointer.x;state.panY+=e.clientY-state.lastPointer.y;
        state.lastPointer={x:e.clientX,y:e.clientY};applyViewTransform();
      }else if(state.tool==="lasso"&&state.lassoHelper){
        updateLasso(point);
      }
    });

    canvas.on("mouse:up",()=>{
      if(state.isPanning){state.isPanning=false;state.lastPointer=null;canvas.defaultCursor="grab"}
      if(state.tool==="lasso"&&state.lassoHelper)finishLasso();
    });

    $("canvasViewport").addEventListener("wheel",event=>{
      if(!event.ctrlKey&&state.tool!=="zoom")return;
      event.preventDefault();setZoom(state.viewScale*(event.deltaY<0?1.08:.92));
    },{passive:false});

    $("canvasViewport").addEventListener("dragover",event=>event.preventDefault());
    $("canvasViewport").addEventListener("drop",async event=>{
      event.preventDefault();
      const assetId=event.dataTransfer.getData("application/x-skooma-asset");
      if(assetId){const asset=APP.getAsset(assetId);if(asset)await addImageFromUrl(asset.src,asset.name,asset);return}
      const file=event.dataTransfer.files?.[0];if(file)await importFile(file);
    });

    document.addEventListener("paste",async event=>{
      if($("editorSelect").value!=="skooma")return;
      const item=[...(event.clipboardData?.items||[])].find(entry=>entry.type.startsWith("image/"));
      if(!item)return;const file=item.getAsFile();if(file)await importFile(file);
    });

    qsa(".tool-button[data-tool]").forEach(btn=>btn.onclick=()=>setTool(btn.dataset.tool));
    ["brushSize","brushOpacity","brushColor"].forEach(id=>$(id).oninput=()=>{if(["brush","pencil","eraser"].includes(state.tool))setTool(state.tool,true)});

    $("selectAllBtn").onclick=selectAll;$("clearSelectionBtn").onclick=clearSelection;
    $("wandToLayerBtn").onclick=wandToLayer;$("wandCancelBtn").onclick=()=>{clearWand();canvas.requestRenderAll()};
    $("cropApplyBtn").onclick=applyCrop;$("cropCancelBtn").onclick=cancelCrop;$("cropRatio").onchange=updateCropRatio;

    $("generateAiBtn").onclick=()=>generateAi(false);$("replaceWithAiBtn").onclick=()=>generateAi(true);
    $("duplicateBtn").onclick=duplicateActive;$("deleteBtn").onclick=deleteActive;
    $("groupBtn").onclick=groupSelected;$("ungroupBtn").onclick=ungroupSelected;
    $("mergeBtn").onclick=mergeSelected;$("flattenBtn").onclick=flattenCanvas;
    $("undoBtn").onclick=undo;$("redoBtn").onclick=redo;
    $("applyPropertiesBtn").onclick=applyProperties;$("applyTransformBtn").onclick=applyContextTransform;
    $("exportBtn").onclick=()=>exportImage($("exportFormat").value);

    ["filterBrightness","filterContrast","filterSaturation","filterBlur"].forEach(id=>{
      $(id).oninput=()=>applyImageFilters(false);$(id).onchange=()=>applyImageFilters(true);
    });
    $("filterGrayscaleBtn").onclick=()=>toggleImageFilter("grayscale");
    $("filterSepiaBtn").onclick=()=>toggleImageFilter("sepia");
    $("filterResetBtn").onclick=resetImageFilters;

    window.addEventListener("resize",fitToViewport);
    window.addEventListener("keydown",event=>{
      const tag=document.activeElement?.tagName?.toLowerCase();
      const typing=tag==="input"||tag==="textarea"||tag==="select"||canvas.getActiveObject()?.isEditing;
      const mod=event.ctrlKey||event.metaKey;
      if(mod&&event.key.toLowerCase()==="z"&&!event.shiftKey){event.preventDefault();undo();return}
      if((mod&&event.key.toLowerCase()==="y")||(mod&&event.shiftKey&&event.key.toLowerCase()==="z")){event.preventDefault();redo();return}
      if(mod&&event.key.toLowerCase()==="c"){if(!typing){event.preventDefault();copyActive()}return}
      if(mod&&event.key.toLowerCase()==="x"){if(!typing){event.preventDefault();cutActive()}return}
      if(mod&&event.key.toLowerCase()==="v"){if(!typing&&state.clipboard){event.preventDefault();pasteClipboard()}return}
      if(mod&&event.key.toLowerCase()==="d"){event.preventDefault();duplicateActive();return}
      if(mod&&event.key.toLowerCase()==="s"){event.preventDefault();saveNow();return}
      if(!typing&&event.code==="Space"&&!event.repeat){event.preventDefault();state.previousTool=state.tool;setTool("hand");return}
      if(!typing&&event.key==="Delete"){event.preventDefault();deleteActive();return}
      if(event.key==="Escape"){clearToolHelpers();setTool("move");return}
      if(event.key==="Enter"&&state.tool==="crop"){applyCrop();return}
      if(typing)return;
      const key=event.key.toLowerCase();
      const map={v:"move",m:"marquee",l:"lasso",w:"wand",c:"crop",b:"brush",p:"pencil",e:"eraser",g:"fill",i:"eyedropper",t:"text",r:"rect",o:"ellipse",h:"hand",z:"zoom"};
      if(map[key])setTool(map[key]);
    });
    window.addEventListener("keyup",event=>{
      if(event.code==="Space"&&state.previousTool){const previous=state.previousTool;state.previousTool=null;setTool(previous)}
    });
  }

  bindEvents();
  setDocumentSize(state.width,state.height);
  setTool("move");
  loadAutosave();
  setTimeout(fitToViewport,50);

  return {
    canvas,fitToViewport,setTool,addImageFromUrl,importFile,fileToDataUrl,newDocument,saveNow,
    exportImage,exportProjectJson,importProjectJson,undo,redo
  };
})();