(() => {
  const $ = id => document.getElementById(id);
  const F = window.fabric;
  const MASTER_W = 2952;
  const MASTER_H = 366;
  const SEG_W = 492;
  const SEG_H = 366;
  const EXPORT_SIZES = [
    { key: "164x122", segW: 164, segH: 122, folder: "1 - 164x122" },
    { key: "246x183", segW: 246, segH: 183, folder: "2 - 246x183" },
    { key: "328x244", segW: 328, segH: 244, folder: "3 - 328x244" },
    { key: "492x366", segW: 492, segH: 366, folder: "4 - 492x366" }
  ];
  const STICKER_ASSETS = {
    "Премьера": { src: "assets/stickers/premiere.svg?v=20260923a", width: 232 },
    "Новые серии": { src: "assets/stickers/new-series-ru.svg?v=20260923a", width: 260 },
    "Жаңа сериялар": { src: "assets/stickers/new-series-kz.svg?v=20260923a", width: 302 },
    "Новый сезон": { src: "assets/stickers/new-season-ru.svg?v=20260923a", width: 286 },
    "Жаңа маусым": { src: "assets/stickers/new-season-kz.svg?v=20260923a", width: 286 },
    "Все серии": { src: "assets/stickers/all-series-ru.svg?v=20260923a", width: 236 },
    "Барлық сериялар": { src: "assets/stickers/all-series-kz.svg?v=20260923a", width: 354 },
    "Новинка": { src: "assets/stickers/new-ru.svg?v=20260923a", width: 216 },
    "Жаңа": { src: "assets/stickers/new-kz.svg?v=20260923a", width: 166 },
    "Эксклюзив": { src: "assets/stickers/exclusive.svg?v=20260923a", width: 258 },
    "Скоро…": { src: "assets/stickers/soon-ru.svg?v=20260923a", width: 214 },
    "Жуырда…": { src: "assets/stickers/soon-kz.svg?v=20260923a", width: 222 },
    "Скоро уйдёт": { src: "assets/stickers/leaving-soon-ru.svg?v=20260923a", width: 288 },
    "Көріп үлгер": { src: "assets/stickers/leaving-soon-kz.svg?v=20260923a", width: 288 },
  };
  const STICKER_ALIASES = {
    "Барлық сериалдар": "Барлық сериялар",
    "Скоро...": "Скоро…",
    "Жуырда...": "Жуырда…"
  };
  let stickerLoadRequest = 0;

  if (!F) {
    console.error("Fabric.js failed to load.");
    $("trainStatus").textContent = "Fabric.js не загрузился. Проверьте сеть.";
    $("trainStatus").className = "status-line error";
    return;
  }

  const existingProps = F.FabricObject.customProperties || [];
  F.FabricObject.customProperties = [...new Set([...existingProps, "name", "kind", "sticker", "stickerText", "badgeText", "source", "rawWidth", "rawHeight", "stickerAsset", "uiBaseScaleX", "uiBaseScaleY"])] ;

  const canvas = new F.Canvas("trainCanvas", {
    preserveObjectStacking: true,
    enableRetinaScaling: false,
    selection: true,
    backgroundColor: "#101010"
  });

  const state = {
    history: [],
    historyIndex: -1,
    muted: false,
    restoring: false,
    displayZoom: 1,
    autosaveTimer: null,
    mode: "canvas",
    photopeaMasterId: null
  };

  function setStatus(message, kind = "") {
    $("trainStatus").textContent = message;
    $("trainStatus").className = "status-line " + kind;
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function activeObject() {
    return canvas.getActiveObject();
  }

  function objectName(obj) {
    if (!obj) return "";
    if (obj.name) return obj.name;
    if (obj.sticker) return "Стикер";
    if (obj instanceof F.IText || obj instanceof F.Textbox) return "Текст";
    if (obj instanceof F.FabricImage) return "Изображение";
    if (obj instanceof F.Rect) return "Плашка";
    return "Слой";
  }

  function metadata(obj, name, kind) {
    obj.name = name;
    obj.kind = kind;
    obj.set({
      transparentCorners: false,
      cornerColor: "#8cf06b",
      cornerStrokeColor: "#ffffff",
      borderColor: "#8cf06b",
      cornerStyle: "circle",
      padding: 1
    });
    return obj;
  }

  function resizeDisplay() {
    const viewport = $("trainCanvasView");
    if (!viewport) return;
    const available = Math.max(320, viewport.clientWidth - 36);
    const displayW = Math.min(MASTER_W, available);
    const displayH = Math.round(displayW * MASTER_H / MASTER_W);
    state.displayZoom = displayW / MASTER_W;

    // Keep Fabric's backing store at the full 2952 × 366 master resolution.
    // Only CSS dimensions are reduced for the editor. This removes the blurry
    // low-resolution preview and keeps pointer coordinates aligned.
    if (canvas.getWidth() !== MASTER_W || canvas.getHeight() !== MASTER_H) {
      canvas.setDimensions({ width: MASTER_W, height: MASTER_H });
    }
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    canvas.setDimensions({ width: displayW, height: displayH }, { cssOnly: true });

    const shell = $("trainCanvasShell");
    shell.style.width = displayW + "px";
    shell.style.height = displayH + "px";
    canvas.requestRenderAll();
  }

  function snapshot(label = "Изменение") {
    if (state.muted || state.restoring) return;
    const snap = {
      label,
      json: canvas.toJSON(F.FabricObject.customProperties),
      background: canvas.backgroundColor || "#101010"
    };
    if (state.historyIndex < state.history.length - 1) state.history = state.history.slice(0, state.historyIndex + 1);
    state.history.push(snap);
    if (state.history.length > 50) state.history.shift();
    state.historyIndex = state.history.length - 1;
    updateUndoButtons();
    scheduleAutosave();
  }

  async function restoreSnapshot(snap) {
    if (!snap) return;
    state.restoring = true;
    state.muted = true;
    await canvas.loadFromJSON(snap.json);
    canvas.backgroundColor = snap.background || "#101010";
    $("trainBgColor").value = normalizeColor(canvas.backgroundColor);
    state.muted = false;
    state.restoring = false;
    resizeDisplay();
    renderLayers();
    canvas.requestRenderAll();
    updateUndoButtons();
    scheduleDevicePreview();
  }

  async function undo() {
    if (state.historyIndex <= 0) return;
    state.historyIndex--;
    await restoreSnapshot(state.history[state.historyIndex]);
  }

  async function redo() {
    if (state.historyIndex >= state.history.length - 1) return;
    state.historyIndex++;
    await restoreSnapshot(state.history[state.historyIndex]);
  }

  function updateUndoButtons() {
    $("trainUndoBtn").disabled = state.historyIndex <= 0;
    $("trainRedoBtn").disabled = state.historyIndex >= state.history.length - 1;
  }

  function normalizeColor(value) {
    if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) return value;
    return "#101010";
  }

  async function addImageFromFile(file, kind = "image") {
    const src = await fileToDataUrl(file);
    const image = await F.FabricImage.fromURL(src);
    const rawW = image.width || image.getElement()?.naturalWidth || 1;
    const rawH = image.height || image.getElement()?.naturalHeight || 1;
    image.rawWidth = rawW;
    image.rawHeight = rawH;
    image.source = "upload";

    if (kind === "background") {
      const scale = Math.max(MASTER_W / rawW, MASTER_H / rawH);
      image.set({
        left: MASTER_W / 2, top: MASTER_H / 2, originX: "center", originY: "center",
        scaleX: scale, scaleY: scale
      });
      metadata(image, file.name || "Фон", "background");
      state.muted = true;
      canvas.add(image);
      canvas.sendObjectToBack(image);
      state.muted = false;
      canvas.setActiveObject(image);
      snapshot("Добавлен фон");
    } else {
      const maxW = kind === "logo" ? 520 : 720;
      const maxH = kind === "logo" ? 180 : 300;
      const scale = Math.min(maxW / rawW, maxH / rawH, 1);
      image.set({
        left: MASTER_W / 2, top: MASTER_H / 2, originX: "center", originY: "center",
        scaleX: scale, scaleY: scale
      });
      metadata(image, file.name || (kind === "logo" ? "Логотип" : "Изображение"), kind);
      canvas.add(image);
      canvas.setActiveObject(image);
    }
    canvas.requestRenderAll();
    if(rawW < image.getScaledWidth() || rawH < image.getScaledHeight()) setStatus("Исходник мал для выбранного масштаба. Детали могут потерять чёткость; экспорт доступен.");
  }

  async function applyPhotopeaComposite(src, name = "Photopea result", masterId = null) {
    const image = await F.FabricImage.fromURL(src);
    const rawW = image.width || image.getElement()?.naturalWidth || MASTER_W;
    const rawH = image.height || image.getElement()?.naturalHeight || MASTER_H;
    image.rawWidth = rawW; image.rawHeight = rawH; image.source = "photopea-composite";
    image.set({
      left: MASTER_W / 2, top: MASTER_H / 2, originX: "center", originY: "center",
      scaleX: MASTER_W / rawW, scaleY: MASTER_H / rawH
    });
    metadata(image, name || "Photopea result", "background");
    state.muted = true;
    canvas.discardActiveObject();
    canvas.clear();
    canvas.backgroundColor = "#101010";
    canvas.add(image);
    canvas.setActiveObject(image);
    state.muted = false;
    state.photopeaMasterId = masterId || null;
    state.history = [];
    state.historyIndex = -1;
    snapshot("Результат Photopea");
    state.photopeaMasterId = masterId || null;
    renderLayers();
    canvas.requestRenderAll();
    scheduleDevicePreview();
    scheduleAutosave(false);
    return image;
  }

  function getPhotopeaMasterId() {
    return state.photopeaMasterId || null;
  }

  async function setBackgroundFromDataUrl(src, name = "Photopea") {
    const image = await F.FabricImage.fromURL(src);
    const rawW = image.width || image.getElement()?.naturalWidth || 1;
    const rawH = image.height || image.getElement()?.naturalHeight || 1;
    const scale = Math.max(MASTER_W / rawW, MASTER_H / rawH);
    image.rawWidth = rawW;
    image.rawHeight = rawH;
    image.source = "photopea";
    image.set({
      left: MASTER_W / 2, top: MASTER_H / 2, originX: "center", originY: "center",
      scaleX: scale, scaleY: scale
    });
    metadata(image, name || "Photopea background", "background");
    state.muted = true;
    for (const old of canvas.getObjects().filter(obj => obj.kind === "background")) canvas.remove(old);
    canvas.add(image);
    canvas.sendObjectToBack(image);
    state.muted = false;
    canvas.setActiveObject(image);
    canvas.requestRenderAll();
    snapshot("Фон обновлён из Photopea");
    renderLayers();
    scheduleDevicePreview();
    return image;
  }

  function photopeaSvgDataUrl(svg) {
    return "data:image/svg+xml;charset=utf-8,"+encodeURIComponent(svg);
  }

  function segmentForObject(obj) {
    return Math.max(1,Math.min(6,Math.floor(Number(obj.left||0)/SEG_W)+1));
  }

  async function rasterObjectSource(obj) {
    const el=obj.getElement?.();
    const src=el?.currentSrc||el?.src||null;
    const cropped=Number(obj.cropX||0)!==0||Number(obj.cropY||0)!==0||
      (obj.rawWidth&&Math.round(obj.width||0)!==Math.round(obj.rawWidth))||
      (obj.rawHeight&&Math.round(obj.height||0)!==Math.round(obj.rawHeight));
    if(src&&!cropped) return src;
    try { return obj.toCanvasElement({withoutTransform:true,enableRetinaScaling:false}).toDataURL("image/png"); }
    catch { return src; }
  }

  async function buildPhotopeaModel() {
    const layers=[{
      id:"train-background",name:"Wide Background",type:"background",color:canvas.backgroundColor||"#101010",
      x:MASTER_W/2,y:MASTER_H/2,width:MASTER_W,height:MASTER_H,scaleX:1,scaleY:1,rotation:0,opacity:1,visible:true,locked:true,zIndex:0
    }];
    let imageIndex=0,logoIndex=0,textIndex=0,badgeIndex=0;
    for(const obj of canvas.getObjects()){
      const seg=segmentForObject(obj),center=obj.getCenterPoint();
      const common={x:center.x,y:center.y,width:Math.abs(Number(obj.getScaledWidth?.()||obj.width||1)),
        height:Math.abs(Number(obj.getScaledHeight?.()||obj.height||1)),scaleX:1,scaleY:1,rotation:Number(obj.angle||0),
        opacity:Number(obj.opacity??1),visible:obj.visible!==false,locked:!!obj.lockMovementX,zIndex:layers.length,segment:seg};
      if(obj instanceof F.IText||obj instanceof F.Textbox){
        textIndex++;
        layers.push({...common,id:"train-text-"+textIndex,name:obj.name||("Text - Segment "+seg),type:"text",text:obj.text||"",
          fontFamily:String(obj.fontFamily||"Arial").split(",")[0],fontSize:Number(obj.fontSize||54),fontWeight:String(obj.fontWeight||"normal"),
          lineHeight:Number(obj.lineHeight||1.16),letterSpacing:Number(obj.charSpacing||0),textAlign:obj.textAlign||"left",
          fill:typeof obj.fill==="string"?obj.fill:"#ffffff"});
      } else if(obj instanceof F.FabricImage){
        const isLogo=obj.kind==="logo",isSticker=!!obj.sticker;
        if(isLogo)logoIndex++;else imageIndex++;
        const src=isSticker&&obj.stickerAsset?await AssetManager.blobToDataUrl(await (await fetch(new URL(obj.stickerAsset,document.baseURI).href)).blob()):await rasterObjectSource(obj);
        layers.push({...common,id:isSticker?"sticker-segment-"+seg:(isLogo?"logo-"+logoIndex:"image-"+imageIndex),
          name:isSticker?("Sticker - "+(obj.stickerText||"Segment "+seg)):(isLogo?("Logo - Segment "+seg):(obj.kind==="background"?"Wide Background Image":("Image - Segment "+seg))),
          type:isSticker?"sticker":"image",sourceDataUrl:src,source:obj.source||"fabric",
          crop:{cropX:Number(obj.cropX||0),cropY:Number(obj.cropY||0),width:Number(obj.width||0),height:Number(obj.height||0)}});
      } else if(obj instanceof F.Rect){
        badgeIndex++;
        const w=Math.max(1,Number(obj.width||1)),h=Math.max(1,Number(obj.height||1)),rx=Math.max(0,Number(obj.rx||0));
        const fill=typeof obj.fill==="string"?obj.fill:"rgba(12,21,16,.88)",stroke=typeof obj.stroke==="string"?obj.stroke:"#3df0a0",sw=Number(obj.strokeWidth||0);
        const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'"><rect x="'+sw/2+'" y="'+sw/2+'" width="'+Math.max(0,w-sw)+'" height="'+Math.max(0,h-sw)+'" rx="'+rx+'" fill="'+fill+'" stroke="'+stroke+'" stroke-width="'+sw+'"/></svg>';
        layers.push({...common,id:"badge-"+badgeIndex,name:obj.name||("Badge - Segment "+seg),type:"shape",sourceDataUrl:photopeaSvgDataUrl(svg)});
      }
    }
    return {version:1,workspace:"train",document:{name:"PAROVOZIK",width:MASTER_W,height:MASTER_H,background:canvas.backgroundColor||"#101010"},layers};
  }

  async function renderMasterBlob() {
    const master = await toMasterCanvas();
    return canvasBlob(master);
  }

  function addText() {
    const value = $("trainTextInput").value.trim() || "Новый текст";
    const text = metadata(new F.IText(value, {
      left: MASTER_W / 2,
      top: MASTER_H / 2,
      originX: "center",
      originY: "center",
      fill: "#ffffff",
      fontSize: 54,
      fontWeight: 700,
      fontFamily: "Arial, sans-serif"
    }), "Текст: " + value.slice(0, 24), "text");
    canvas.add(text);
    canvas.setActiveObject(text);
    canvas.requestRenderAll();
  }

  function addRect() {
    const badge = metadata(new F.Rect({
      left: MASTER_W / 2,
      top: MASTER_H / 2,
      originX: "center",
      originY: "center",
      width: 360,
      height: 96,
      rx: 18,
      ry: 18,
      fill: "rgba(12,21,16,0.88)",
      stroke: "#3df0a0",
      strokeWidth: 2
    }), "Плашка", "badge");
    badge.badgeText = "";
    canvas.add(badge);
    canvas.setActiveObject(badge);
    canvas.requestRenderAll();
  }

  function duplicateActive() {
    const obj = activeObject();
    if (!obj || obj.sticker) return;
    obj.clone().then(clone => {
      clone.set({ left: (obj.left || 0) + 25, top: (obj.top || 0) + 20 });
      metadata(clone, objectName(obj) + " копия", obj.kind || "object");
      canvas.add(clone);
      canvas.setActiveObject(clone);
    });
  }

  function deleteActive() {
    const obj = activeObject();
    if (!obj) return;
    canvas.remove(obj);
    canvas.discardActiveObject();
    canvas.requestRenderAll();
  }

  function removeTrainLogo() {
    const logos = canvas.getObjects().filter(obj => obj.kind === "logo");
    if (!logos.length) return setStatus("Логотипов нет.", "");
    const active = activeObject();
    const target = active?.kind === "logo" ? active : logos[logos.length - 1];
    canvas.remove(target);
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    renderLayers();
    setStatus("Логотип удалён.", "ok");
  }

  function moveLayer(delta) {
    const obj = activeObject();
    if (!obj) return;
    const objects = canvas.getObjects();
    const index = objects.indexOf(obj);
    const target = Math.max(0, Math.min(objects.length - 1, index + delta));
    if (target === index) return;
    canvas.moveObjectTo(obj, target);
    canvas.requestRenderAll();
    snapshot("Изменён порядок слоёв");
    renderLayers();
  }

  function renderLayers() {
    const root = $("trainLayers");
    root.innerHTML = "";
    [...canvas.getObjects()].reverse().forEach(obj => {
      const row = document.createElement("div");
      row.className = "layer-row" + (obj === activeObject() ? " active" : "");
      const name = document.createElement("span");
      name.textContent = objectName(obj);
      name.title = objectName(obj);
      name.addEventListener("click", () => {
        obj.set({ selectable: true, evented: true });
        canvas.setActiveObject(obj);
        canvas.requestRenderAll();
        renderLayers();
      });
      const visible = document.createElement("button");
      visible.textContent = obj.visible === false ? "○" : "●";
      visible.title = "Видимость";
      visible.addEventListener("click", e => {
        e.stopPropagation();
        obj.visible = obj.visible === false;
        canvas.requestRenderAll();
        snapshot("Видимость слоя");
        renderLayers();
      });
      const lock = document.createElement("button");
      const locked = !!obj.lockMovementX;
      lock.textContent = locked ? "🔒" : "🔓";
      lock.title = "Блокировка";
      lock.addEventListener("click", e => {
        e.stopPropagation();
        const next = !obj.lockMovementX;
        obj.set({
          lockMovementX: next, lockMovementY: next,
          lockScalingX: next, lockScalingY: next, lockRotation: next
        });
        snapshot(next ? "Слой заблокирован" : "Слой разблокирован");
        renderLayers();
      });
      row.append(name, visible, lock);
      root.appendChild(row);
    });
    $("removeTrainLogoBtn").disabled = !canvas.getObjects().some(obj => obj.kind === "logo");
    syncObjectControls();
  }

  function syncObjectControls() {
    const obj = activeObject();
    if (obj && !obj.sticker) {
      if (!Number.isFinite(Number(obj.uiBaseScaleX)) || !Number.isFinite(Number(obj.uiBaseScaleY))) {
        obj.uiBaseScaleX = Number(obj.scaleX) || 1;
        obj.uiBaseScaleY = Number(obj.scaleY) || 1;
      }
      const sx = Number(obj.scaleX) || 1;
      const base = Number(obj.uiBaseScaleX) || 1;
      $("trainScaleInput").value = String(Math.max(5, Math.min(500, Math.round(sx / base * 100))));
    } else {
      $("trainScaleInput").value = "100";
    }
    const transformLocked = !!obj && (!!obj.lockScalingX || !!obj.lockScalingY);
    $("trainScaleInput").disabled = !obj || !!obj?.sticker || transformLocked;
    $("trainRotationInput").value = obj?.sticker ? 0 : (obj ? Math.round(obj.angle || 0) : 0);
    $("trainRotationInput").disabled = !obj || !!obj?.sticker || !!obj?.lockRotation;
    $("trainOpacityInput").value = obj ? (obj.opacity ?? 1) : 1;
    $("trainOpacityInput").disabled = !obj;
    $("applyCropBtn").disabled = !(obj instanceof F.FabricImage) || !!obj?.sticker;
  }

  function applyCrop() {
    const obj = activeObject();
    if (!(obj instanceof F.FabricImage) || obj.sticker) return setStatus("Обрезка доступна только для обычного изображения.", "error");
    const element = obj.getElement();
    const rawW = element?.naturalWidth || obj.rawWidth || obj.width;
    const rawH = element?.naturalHeight || obj.rawHeight || obj.height;
    const l = Math.max(0, Math.min(45, +$("cropLeftInput").value || 0)) / 100;
    const t = Math.max(0, Math.min(45, +$("cropTopInput").value || 0)) / 100;
    const r = Math.max(0, Math.min(45, +$("cropRightInput").value || 0)) / 100;
    const b = Math.max(0, Math.min(45, +$("cropBottomInput").value || 0)) / 100;
    if (l + r >= .95 || t + b >= .95) return setStatus("Слишком большая обрезка.", "error");

    const renderedW = obj.getScaledWidth();
    const renderedH = obj.getScaledHeight();
    const cropX = rawW * l;
    const cropY = rawH * t;
    const width = rawW * (1 - l - r);
    const height = rawH * (1 - t - b);
    obj.set({
      cropX, cropY, width, height,
      scaleX: renderedW / width,
      scaleY: renderedH / height
    });
    obj.uiBaseScaleX = obj.scaleX;
    obj.uiBaseScaleY = obj.scaleY;
    obj.setCoords();
    canvas.requestRenderAll();
    snapshot("Обрезано изображение");
    setStatus("Обрезка применена.", "ok");
  }

  function stickerStyle(text) {
    if (["Скоро…", "Жуырда…", "Скоро…", "Жуырда…"].includes(text)) {
      return { fill: "#111714", text: "#edf5ef", stroke: "#34493c", strokeWidth: 1 };
    }
    if (text === "Скоро уйдёт" || text === "Көріп үлгер") {
      return { fill: "#f3c641", text: "#10120f", stroke: "#f3c641", strokeWidth: 1 };
    }
    if (text === "Эксклюзив") {
      return { fill: "#0c1510", text: "#ffffff", stroke: "#3df0a0", strokeWidth: 3 };
    }
    return { fill: null, text: "#ffffff", stroke: "#2fb9a5", strokeWidth: 1 };
  }

  function buildPromoBadge(text, firstSegmentSticker = false) {
    const style = stickerStyle(text);
    const label = new F.IText(text, {
      left: 18, top: 11,
      fontFamily: "Arial, sans-serif",
      fontSize: 24, fontWeight: 800,
      fill: style.text,
      selectable: false, evented: false
    });
    const width = Math.max(142, (label.width || text.length * 15) + 36);
    const rectOptions = {
      left: 0, top: 0, width, height: 52, rx: 18, ry: 18,
      stroke: style.stroke, strokeWidth: style.strokeWidth
    };
    if (style.fill) rectOptions.fill = style.fill;
    else {
      rectOptions.fill = new F.Gradient({
        type: "linear",
        coords: { x1: 0, y1: 0, x2: width, y2: 0 },
        colorStops: [
          { offset: 0, color: "#147b93" },
          { offset: .52, color: "#159e7a" },
          { offset: 1, color: "#65c933" }
        ]
      });
    }
    const rect = new F.Rect(rectOptions);
    const group = new F.Group([rect, label], {
      left: firstSegmentSticker ? 24 : MASTER_W / 2,
      top: firstSegmentSticker ? 22 : MASTER_H / 2,
      originX: firstSegmentSticker ? "left" : "center",
      originY: firstSegmentSticker ? "top" : "center",
      lockScalingFlip: true,
      lockUniScaling: true,
      lockRotation: firstSegmentSticker,
      sticker: firstSegmentSticker,
      stickerText: firstSegmentSticker ? text : "",
      badgeText: text,
      name: (firstSegmentSticker ? "Стикер: " : "Плашка: ") + text,
      kind: firstSegmentSticker ? "sticker" : "badge"
    });
    if (firstSegmentSticker) group.setControlsVisibility({ mt: false, mb: false, ml: false, mr: false, mtr: false });
    else group.setControlsVisibility({ mt: false, mb: false, ml: false, mr: false });
    metadata(group, (firstSegmentSticker ? "Стикер: " : "Плашка: ") + text, firstSegmentSticker ? "sticker" : "badge");
    group.sticker = firstSegmentSticker;
    group.stickerText = firstSegmentSticker ? text : "";
    group.badgeText = text;
    return group;
  }

  function constrainSticker(obj) {
    if (!obj?.sticker) return;
    const width = obj.getScaledWidth();
    const height = obj.getScaledHeight();
    if (width > SEG_W - 12) {
      const ratio = (SEG_W - 12) / width;
      obj.scaleX *= ratio;
      obj.scaleY *= ratio;
    }
    const w = obj.getScaledWidth();
    const h = obj.getScaledHeight();
    obj.left = Math.max(0, Math.min(SEG_W - w, obj.left || 0));
    obj.top = Math.max(0, Math.min(SEG_H - h, obj.top || 0));
    obj.setCoords();
  }

  function normalizeStickerLabel(text) {
    return STICKER_ALIASES[text] || text || "Без стикера";
  }

  async function buildStickerAsset(text) {
    const normalized = normalizeStickerLabel(text);
    const asset = STICKER_ASSETS[normalized];
    if (!asset) throw new Error("Неизвестный стикер: " + normalized);

    const url = new URL(asset.src, document.baseURI).href;
    const image = await F.FabricImage.fromURL(url);
    const rawW = image.width || image.getElement()?.naturalWidth || 1;
    const rawH = image.height || image.getElement()?.naturalHeight || 1;
    const scale = asset.width / rawW;

    image.rawWidth = rawW;
    image.rawHeight = rawH;
    image.source = "sticker-asset";
    image.stickerAsset = asset.src;
    image.set({
      left: 24,
      top: 22,
      originX: "left",
      originY: "top",
      scaleX: scale,
      scaleY: scale,
      angle: 0,
      lockRotation: true,
      lockScalingFlip: true,
      objectCaching: false,
      sticker: true,
      stickerText: normalized,
      badgeText: normalized
    });
    metadata(image, "Стикер: " + normalized, "sticker");
    image.sticker = true;
    image.stickerText = normalized;
    image.badgeText = normalized;
    image.stickerAsset = asset.src;
    image.source = "sticker-asset";
    image.setControlsVisibility({ mt: false, mb: false, ml: false, mr: false, mtr: false });
    constrainSticker(image);
    return image;
  }

  function syncStickerSelect() {
    const select = $("stickerSelect");
    if (!select) return;
    const sticker = canvas.getObjects().find(obj => obj.sticker);
    const label = sticker ? normalizeStickerLabel(sticker.stickerText) : "Без стикера";
    select.value = [...select.options].some(option => option.value === label || option.textContent === label)
      ? label
      : "Без стикера";
  }

  async function setSticker(text) {
    const normalized = normalizeStickerLabel(text);
    const requestId = ++stickerLoadRequest;
    const old = canvas.getObjects().find(obj => obj.sticker);
    const previousLabel = old ? normalizeStickerLabel(old.stickerText) : "Без стикера";

    if (normalized === "Без стикера") {
      state.muted = true;
      if (old) canvas.remove(old);
      canvas.discardActiveObject();
      state.muted = false;
      canvas.requestRenderAll();
      snapshot("Стикер удалён");
      syncStickerSelect();
      renderLayers();
      scheduleDevicePreview();
      return;
    }

    try {
      const sticker = await buildStickerAsset(normalized);
      if (requestId !== stickerLoadRequest) return;
      state.muted = true;
      const current = canvas.getObjects().find(obj => obj.sticker);
      if(current) {
        const width=current.getScaledWidth();
        sticker.set({left:current.left,top:current.top,scaleX:width/sticker.width,scaleY:width/sticker.width});
        constrainSticker(sticker);canvas.remove(current);
      }
      canvas.add(sticker);
      canvas.setActiveObject(sticker);
      state.muted = false;
      canvas.requestRenderAll();
      snapshot("Стикер: " + normalized);
      syncStickerSelect();
      renderLayers();
      scheduleDevicePreview();
      setStatus("Стикер «" + normalized + "» добавлен.", "ok");
    } catch (error) {
      if (requestId !== stickerLoadRequest) return;
      $("stickerSelect").value = previousLabel;
      setStatus("Не удалось загрузить стикер «" + normalized + "»: " + (error.message || "ошибка ассета"), "error");
    }
  }

  function scheduleAutosave(markDirty = true) {
    if(markDirty && state.photopeaMasterId) state.photopeaMasterId=null;
    clearTimeout(state.autosaveTimer);
    state.autosaveTimer = setTimeout(async () => {
      try {
        if (!window.SkoomaStore || !window.PosterApp) return;
        const project = PosterApp.serialize();
        project.id = "poster-editor-autosave";
        await SkoomaStore.saveProject(project);
      } catch (error) {
        console.warn("Train autosave failed", error);
      }
    }, 700);
  }

  async function resetWorkspace() {
    state.muted = true;
    canvas.discardActiveObject();
    canvas.clear();
    canvas.backgroundColor = "#101010";
    $("trainBgColor").value = "#101010";
    $("stickerSelect").value = "Без стикера";
    $("trainScaleInput").value = "100";
    $("trainRotationInput").value = "0";
    $("trainOpacityInput").value = "1";
    for (const id of ["cropLeftInput","cropTopInput","cropRightInput","cropBottomInput"]) $(id).value = "0";
    state.muted = false;
    state.history = [];
    state.historyIndex = -1;
    state.photopeaMasterId = null;
    snapshot("Пустой холст");
    renderLayers();
    canvas.requestRenderAll();
    scheduleDevicePreview();
    scheduleAutosave();
    setStatus("Паровозик сброшен.", "ok");
  }

  function serialize() {
    return {
      version: 1,
      master: { width: MASTER_W, height: MASTER_H, segmentWidth: SEG_W, segmentHeight: SEG_H },
      background: canvas.backgroundColor || "#101010",
      canvas: canvas.toJSON(F.FabricObject.customProperties),
      photopeaMasterId: state.photopeaMasterId || null
    };
  }

  async function restore(data) {
    if (!data?.canvas) return;
    state.restoring = true;
    state.muted = true;
    state.photopeaMasterId = data.photopeaMasterId || null;
    await canvas.loadFromJSON(data.canvas);
    for(const obj of canvas.getObjects()) if(obj.sticker){constrainSticker(obj);canvas.bringObjectToFront(obj);}
    canvas.backgroundColor = data.background || "#101010";
    $("trainBgColor").value = normalizeColor(canvas.backgroundColor);
    state.muted = false;
    state.restoring = false;
    resizeDisplay();
    state.history = [];
    state.historyIndex = -1;
    snapshot("Проект восстановлен");
    renderLayers();
    syncStickerSelect();
    scheduleDevicePreview();
  }

  async function toMasterCanvas() {
    const active = canvas.getActiveObject();
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    const result = canvas.toCanvasElement(1);
    if (active) canvas.setActiveObject(active);
    canvas.requestRenderAll();
    return result;
  }

  function canvasBlob(c) {
    return new Promise((resolve, reject) => c.toBlob(blob => blob ? resolve(blob) : reject(new Error("Не удалось создать PNG.")), "image/png"));
  }

  const scaledMasters=new WeakMap();
  function scaledMaster(master,spec) {
    let cached=scaledMasters.get(master);if(!cached){cached=new Map();scaledMasters.set(master,cached);}
    if(!cached.has(spec.key)) {
      const out=document.createElement("canvas");out.width=spec.segW*6;out.height=spec.segH;
      const ctx=out.getContext("2d");ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";
      ctx.drawImage(master,0,0,out.width,out.height);cached.set(spec.key,out);
    }
    return cached.get(spec.key);
  }
  async function createSegmentBlob(master, spec, index) {
    const c = document.createElement("canvas");
    c.width = spec.segW;
    c.height = spec.segH;
    const ctx = c.getContext("2d");
    ctx.drawImage(scaledMaster(master,spec),index*spec.segW,0,spec.segW,spec.segH,0,0,spec.segW,spec.segH);
    return canvasBlob(c);
  }

  async function exportSelectedSize() {
    const spec = EXPORT_SIZES.find(x => x.key === $("trainSizeSelect").value) || EXPORT_SIZES[3];
    setStatus("Готовлю ZIP " + spec.key + "...");
    try {
      const master = await toMasterCanvas();
      const entries = [];
      for (let i = 0; i < 6; i++) entries.push({ name: spec.folder+"/part_" + (i + 1) + ".png", data: await createSegmentBlob(master, spec, i) });
      const zip = await ZipStore.build(entries);
      ZipStore.download(zip, "Паровозик-" + spec.key + ".zip");
      await window.WorkArchive?.captureWorkspace?.("train","download-selected-size");
      setStatus("ZIP " + spec.key + " готов: 6 PNG. Архивная версия сохранена.", "ok");
    } catch (error) {
      setStatus(error.message || "Ошибка экспорта.", "error");
    }
  }

  async function exportAllSizes() {
    setStatus("Готовлю Паровозик.zip: 24 PNG...");
    $("trainDownloadAllBtn").disabled = true;
    try {
      const master = await toMasterCanvas();
      const entries = [];
      for (const spec of EXPORT_SIZES) {
        for (let i = 0; i < 6; i++) {
          entries.push({
            name: spec.folder + "/part_" + (i + 1) + ".png",
            data: await createSegmentBlob(master, spec, i)
          });
        }
      }
      const zip = await ZipStore.build(entries);
      ZipStore.download(zip, "Паровозик.zip");
      await window.WorkArchive?.captureWorkspace?.("train","download-all-sizes");
      setStatus("Готово: 4 папки, 24 PNG. Архивная версия сохранена.", "ok");
    } catch (error) {
      setStatus(error.message || "Ошибка экспорта.", "error");
    } finally {
      $("trainDownloadAllBtn").disabled = false;
    }
  }

  let previewTimer;
  function scheduleDevicePreview() {
    if (state.mode !== "device") return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderDevicePreview, 140);
  }

  async function renderDevicePreview() {
    if (state.mode !== "device") return;
    try {
      const spec = EXPORT_SIZES.find(x => x.key === $("trainSizeSelect").value) || EXPORT_SIZES[3];
      const master = await toMasterCanvas();
      const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      document.querySelectorAll("#trainDeviceView canvas").forEach((part, i) => {
        part.width = Math.round(spec.segW * dpr);
        part.height = Math.round(spec.segH * dpr);
        part.style.aspectRatio = spec.segW + " / " + spec.segH;
        const ctx = part.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(master, i * SEG_W, 0, SEG_W, SEG_H, 0, 0, part.width, part.height);
      });
    } catch (error) {
      setStatus("Не удалось обновить предпросмотр.", "error");
    }
  }

  function setPreviewMode(mode) {
    state.mode = mode;
    const device = mode === "device";
    $("trainCanvasView").hidden = device;
    $("trainDeviceView").hidden = !device;
    $("trainCanvasModeBtn").classList.toggle("active", !device);
    $("trainDeviceModeBtn").classList.toggle("active", device);
    if (device) renderDevicePreview();
  }

  function activate() {
    requestAnimationFrame(() => {
      resizeDisplay();
      if (state.mode === "device") renderDevicePreview();
    });
  }

  canvas.on("object:added", e => {
    const sticker=canvas.getObjects().find(obj=>obj.sticker);if(sticker) canvas.bringObjectToFront(sticker);
    if (!state.muted && !state.restoring) snapshot("Добавлен слой");
    renderLayers();
    scheduleDevicePreview();
  });
  canvas.on("object:removed", () => {
    if (!state.muted && !state.restoring) snapshot("Удалён слой");
    renderLayers();
    scheduleDevicePreview();
  });
  canvas.on("object:modified", e => {
    constrainSticker(e.target);
    snapshot("Изменён объект");
    renderLayers();
    scheduleDevicePreview();
  });
  canvas.on("object:moving", e => constrainSticker(e.target));
  canvas.on("object:scaling", e => constrainSticker(e.target));
  let wheelSnapshotTimer;
  canvas.on("mouse:wheel", opt => {
    const obj = activeObject();
    if (!obj || obj.lockScalingX || obj.lockScalingY) return;
    const event = opt.e;
    const factor = event.deltaY < 0 ? 1.04 : 0.96;
    const currentScale = Math.max(obj.scaleX || 1, obj.scaleY || 1);
    const nextScale = Math.max(0.05, Math.min(8, currentScale * factor));
    obj.scale(nextScale);
    constrainSticker(obj);
    obj.setCoords();
    canvas.requestRenderAll();
    event.preventDefault();
    event.stopPropagation();
    clearTimeout(wheelSnapshotTimer);
    wheelSnapshotTimer = setTimeout(() => snapshot("Масштаб объекта"), 180);
  });
  canvas.on("selection:created", renderLayers);
  canvas.on("selection:updated", renderLayers);
  canvas.on("selection:cleared", renderLayers);

  $("trainBackgroundInput").addEventListener("change", async e => {
    const file = e.target.files?.[0];
    if (file) try { await addImageFromFile(file, "background"); } catch (error) { setStatus(error.message, "error"); }
    e.target.value = "";
  });
  $("trainImageInput").addEventListener("change", async e => {
    for (const file of [...(e.target.files || [])]) {
      try { await addImageFromFile(file, "image"); } catch (error) { setStatus(error.message, "error"); }
    }
    e.target.value = "";
  });
  $("removeTrainLogoBtn").addEventListener("click", removeTrainLogo);
  $("trainLogoInput").addEventListener("change", async e => {
    const file = e.target.files?.[0];
    if (file) try { await addImageFromFile(file, "logo"); } catch (error) { setStatus(error.message, "error"); }
    e.target.value = "";
  });
  $("trainAddTextBtn").addEventListener("click", addText);
  $("trainAddRectBtn").addEventListener("click", addRect);
  $("trainDuplicateBtn").addEventListener("click", duplicateActive);
  $("trainDeleteBtn").addEventListener("click", deleteActive);
  $("trainLayerUpBtn").addEventListener("click", () => moveLayer(1));
  $("trainLayerDownBtn").addEventListener("click", () => moveLayer(-1));
  $("trainUndoBtn").addEventListener("click", undo);
  $("trainRedoBtn").addEventListener("click", redo);
  $("trainScaleInput").addEventListener("input", e => {
    const obj = activeObject(); if (!obj || obj.sticker || obj.lockScalingX || obj.lockScalingY) return;
    if (!Number.isFinite(Number(obj.uiBaseScaleX)) || !Number.isFinite(Number(obj.uiBaseScaleY))) {
      obj.uiBaseScaleX = Number(obj.scaleX) || 1;
      obj.uiBaseScaleY = Number(obj.scaleY) || 1;
    }
    const factor=Math.max(5,Math.min(500,Number(e.target.value)||100))/100;
    obj.set({
      scaleX:(Number(obj.uiBaseScaleX)||1)*factor,
      scaleY:(Number(obj.uiBaseScaleY)||1)*factor
    });
    obj.setCoords();
    canvas.requestRenderAll();
    scheduleDevicePreview();
  });
  $("trainScaleInput").addEventListener("change", () => snapshot("Масштаб объекта"));
  $("trainRotationInput").addEventListener("input", e => {
    const obj = activeObject(); if (!obj) return;
    if (obj.sticker || obj.lockRotation) { if (obj.sticker) e.target.value = "0"; return; }
    obj.rotate(+e.target.value || 0); obj.setCoords(); canvas.requestRenderAll(); scheduleDevicePreview();
  });
  $("trainRotationInput").addEventListener("change", () => snapshot("Поворот объекта"));
  $("trainOpacityInput").addEventListener("input", e => {
    const obj = activeObject(); if (!obj) return;
    obj.set("opacity", +e.target.value); canvas.requestRenderAll();
  });
  $("trainOpacityInput").addEventListener("change", () => snapshot("Прозрачность объекта"));
  $("applyCropBtn").addEventListener("click", applyCrop);
  $("trainBgColor").addEventListener("input", e => { canvas.backgroundColor = e.target.value; canvas.requestRenderAll(); scheduleDevicePreview(); });
  $("trainBgColor").addEventListener("change", () => snapshot("Фон холста"));
  $("stickerSelect").addEventListener("change", e => { void setSticker(e.target.value); });
  $("trainCanvasModeBtn").addEventListener("click", () => setPreviewMode("canvas"));
  $("trainDeviceModeBtn").addEventListener("click", () => setPreviewMode("device"));
  $("trainSizeSelect").addEventListener("change", scheduleDevicePreview);
  $("trainEditPhotopeaBtn").addEventListener("click", () => window.PhotopeaBridge?.editTrain?.().catch(error => setStatus(error.message || "Не удалось открыть Photopea.", "error")));
  $("trainDownloadSelectedBtn").addEventListener("click", exportSelectedSize);
  $("trainDownloadAllBtn").addEventListener("click", exportAllSizes);
  window.addEventListener("resize", () => { if (!$("trainWorkspace").hidden) resizeDisplay(); });

  const catalog=$("stickerCatalog");
  for(const [label,spec] of Object.entries(STICKER_ASSETS)) {
    const button=document.createElement("button"),preview=document.createElement("img"),title=document.createElement("span");
    button.type="button";preview.src=spec.src;preview.alt="";title.textContent=label;
    button.append(preview,title);button.addEventListener("click",()=>{void setSticker(label);catalog.closest("details").open=false;});catalog.append(button);
  }
  snapshot("Пустой холст");
  resizeDisplay();
  renderLayers();

  window.TrainEditor = {
    activate, serialize, restore, resetWorkspace,
    exportAllSizes, exportSelectedSize, renderMasterBlob, buildPhotopeaModel, setBackgroundFromDataUrl, applyPhotopeaComposite, getPhotopeaMasterId,
    inspect: () => {
      const sticker = canvas.getObjects().find(obj => obj.sticker);
      return {
        objectCount: canvas.getObjects().length,
        sticker: sticker ? {
          text: sticker.stickerText,
          asset: sticker.stickerAsset || null,
          left: sticker.left || 0,
          top: sticker.top || 0,
          width: sticker.getScaledWidth(),
          height: sticker.getScaledHeight()
        } : null,
        badges: canvas.getObjects().filter(obj => obj.kind === "badge").map(obj => obj.badgeText),
        background: canvas.backgroundColor,
        masterSize: { width: canvas.getWidth(), height: canvas.getHeight() },
        displayZoom: state.displayZoom
      };
    },
    constants: { MASTER_W, MASTER_H, SEG_W, SEG_H, EXPORT_SIZES }
  };

  if (window.__pendingTrainProject) {
    const pending = window.__pendingTrainProject;
    delete window.__pendingTrainProject;
    restore(pending);
  }
  window.dispatchEvent(new CustomEvent("train-editor-ready"));
})();
