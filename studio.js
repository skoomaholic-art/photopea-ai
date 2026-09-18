window.Studio = (() => {
  const $ = id => document.getElementById(id);
  const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const F = window.fabric;
  const MagicWand = window.MagicWand;

  if (!F) {
    console.error("Fabric.js failed to load.");
    return {};
  }

  F.FabricObject.customProperties = ["name", "assetId", "source", "kind", "helper", "__skoomaLockRatio"];

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
    pixelSelection: null,
    pixelSelectionTarget: null,
    pixelSelectionOverlay: null,
    marqueeStart: null,
    marqueeHelper: null,
    cropRect: null,
    wand: null,
    guides: { v: [], h: [] },
    filterState: new WeakMap(),
    lineStart: null,
    lineHelper: null,
    shapeStart: null,
    shapeHelper: null,
    penPoints: [],
    penHelper: null,
    aiReference: null,
    lastAiSrc: null,
    selectionBase: [],
    adjustingSelection: false,
    wandWorker: null,
    wandWorkerSeq: 0,
    wandWorkerPending: new Map(),
    nodeTarget: null,
    nodeHandles: [],
    eraserTarget: null,
    thumbCache: new WeakMap()
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

  function updateRulers() {
    const viewport=$("canvasViewport"),rx=$("rulerX"),ry=$("rulerY"),wrapper=canvas.wrapperEl;
    if(!viewport||!rx||!ry||!wrapper)return;
    const vp=viewport.getBoundingClientRect(),fr=wrapper.getBoundingClientRect();
    const dpr=Math.max(1,window.devicePixelRatio||1);
    const rw=Math.max(1,Math.floor(vp.width-20)),rh=Math.max(1,Math.floor(vp.height-20));
    rx.width=Math.floor(rw*dpr);rx.height=Math.floor(20*dpr);rx.style.width=rw+"px";rx.style.height="20px";
    ry.width=Math.floor(20*dpr);ry.height=Math.floor(rh*dpr);ry.style.width="20px";ry.style.height=rh+"px";
    const xctx=rx.getContext("2d"),yctx=ry.getContext("2d");
    xctx.setTransform(dpr,0,0,dpr,0,0);yctx.setTransform(dpr,0,0,dpr,0,0);
    xctx.clearRect(0,0,rw,20);yctx.clearRect(0,0,20,rh);
    xctx.fillStyle="#0d141c";xctx.fillRect(0,0,rw,20);yctx.fillStyle="#0d141c";yctx.fillRect(0,0,20,rh);
    const pxPerUnit=Math.max(.0001,state.viewScale);
    const candidates=[10,20,50,100,200,500,1000];
    const major=candidates.find(step=>step*pxPerUnit>=55)||1000;
    const minor=major/5;
    const originX=fr.left-vp.left-20;
    const originY=fr.top-vp.top-20;
    xctx.strokeStyle="#5f6c7b";xctx.fillStyle="#8fa0b3";xctx.font="9px system-ui";xctx.textBaseline="top";
    yctx.strokeStyle="#5f6c7b";yctx.fillStyle="#8fa0b3";yctx.font="9px system-ui";
    for(let x=0;x<=state.width;x+=minor){
      const sx=originX+x*pxPerUnit;if(sx<0||sx>rw)continue;
      const isMajor=Math.abs((x/major)-Math.round(x/major))<1e-6;
      xctx.beginPath();xctx.moveTo(sx,isMajor?7:13);xctx.lineTo(sx,20);xctx.stroke();
      if(isMajor)xctx.fillText(String(Math.round(x)),sx+2,1);
    }
    for(let y=0;y<=state.height;y+=minor){
      const sy=originY+y*pxPerUnit;if(sy<0||sy>rh)continue;
      const isMajor=Math.abs((y/major)-Math.round(y/major))<1e-6;
      yctx.beginPath();yctx.moveTo(isMajor?7:13,sy);yctx.lineTo(20,sy);yctx.stroke();
      if(isMajor){
        yctx.save();yctx.translate(1,sy-2);yctx.rotate(-Math.PI/2);yctx.fillText(String(Math.round(y)),0,0);yctx.restore();
      }
    }
  }

  function applyViewTransform() {
    const wrapper = canvas.wrapperEl;
    if (!wrapper) return;
    wrapper.style.transformOrigin = "center center";
    wrapper.style.transform = "translate(" + state.panX + "px," + state.panY + "px) scale(" + state.viewScale + ")";
    $("zoomStatus").textContent = Math.round(state.viewScale * 100) + "%";
    requestAnimationFrame(updateRulers);
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

  function pixelSelectionEnabled() {
    return $("selectionTargetMode")?.value === "pixels";
  }

  function activeImageLayer() {
    const active=canvas.getActiveObject();
    return active instanceof F.FabricImage && !isHelper(active) ? active : null;
  }

  function selectionMaskCanvas(draw) {
    const raw=document.createElement("canvas");
    raw.width=state.width;raw.height=state.height;
    const ctx=raw.getContext("2d");
    ctx.fillStyle="#ffffff";
    draw(ctx);
    const feather=Math.max(0,Math.min(40,Number($("selectionFeather")?.value)||0));
    if(!feather)return raw;
    const blurred=document.createElement("canvas");
    blurred.width=state.width;blurred.height=state.height;
    const bctx=blurred.getContext("2d");
    bctx.filter="blur("+feather+"px)";
    bctx.drawImage(raw,0,0);
    bctx.filter="none";
    return blurred;
  }

  function combinePixelSelection(nextMask) {
    const mode=$("selectionMode")?.value||"replace";
    if(!state.pixelSelection || mode==="replace") {
      state.pixelSelection=nextMask;
      return;
    }
    const out=document.createElement("canvas");
    out.width=state.width;out.height=state.height;
    const ctx=out.getContext("2d");
    ctx.drawImage(state.pixelSelection,0,0);
    if(mode==="add"){
      ctx.globalCompositeOperation="source-over";
      ctx.drawImage(nextMask,0,0);
    }else if(mode==="subtract"){
      ctx.globalCompositeOperation="destination-out";
      ctx.drawImage(nextMask,0,0);
    }else if(mode==="intersect"){
      ctx.globalCompositeOperation="destination-in";
      ctx.drawImage(nextMask,0,0);
    }
    ctx.globalCompositeOperation="source-over";
    state.pixelSelection=out;
  }

  function pixelMaskBounds(mask) {
    if(!mask)return null;
    const data=mask.getContext("2d",{willReadFrequently:true}).getImageData(0,0,mask.width,mask.height).data;
    let minX=mask.width,minY=mask.height,maxX=-1,maxY=-1;
    for(let y=0;y<mask.height;y++){
      for(let x=0;x<mask.width;x++){
        if(data[(y*mask.width+x)*4+3]>4){
          minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);
        }
      }
    }
    return maxX<minX?null:{x:minX,y:minY,width:maxX-minX+1,height:maxY-minY+1};
  }

  function updatePixelSelectionButtons() {
    const ready=!!state.pixelSelection && !!state.pixelSelectionTarget;
    ["selectionToLayerBtn","selectionMaskBtn","selectionDeletePixelsBtn"].forEach(id=>{
      if($(id))$(id).disabled=!ready;
    });
  }

  async function renderPixelSelectionOverlay() {
    if(state.pixelSelectionOverlay){
      canvas.remove(state.pixelSelectionOverlay);
      state.pixelSelectionOverlay=null;
    }
    if(!state.pixelSelection)return;
    const seq=(state.pixelOverlaySeq||0)+1;state.pixelOverlaySeq=seq;
    const colored=document.createElement("canvas");
    colored.width=state.width;colored.height=state.height;
    const ctx=colored.getContext("2d");
    ctx.drawImage(state.pixelSelection,0,0);
    ctx.globalCompositeOperation="source-in";
    ctx.fillStyle="rgba(111,125,255,.42)";
    ctx.fillRect(0,0,colored.width,colored.height);
    ctx.globalCompositeOperation="source-over";
    const overlay=await F.FabricImage.fromURL(colored.toDataURL("image/png"));
    if(seq!==state.pixelOverlaySeq)return;
    overlay.set({
      left:0,top:0,originX:"left",originY:"top",selectable:false,evented:false,
      excludeFromExport:true,helper:true,opacity:.72,name:"Pixel selection"
    });
    state.pixelSelectionOverlay=overlay;
    canvas.add(overlay);canvas.bringObjectToFront(overlay);canvas.requestRenderAll();
  }

  function clearPixelSelection(keepTarget=false) {
    if(state.pixelSelectionOverlay){
      canvas.remove(state.pixelSelectionOverlay);state.pixelSelectionOverlay=null;
    }
    if(state.marqueeHelper){
      canvas.remove(state.marqueeHelper);state.marqueeHelper=null;
    }
    state.marqueeStart=null;
    state.pixelSelection=null;
    if(!keepTarget)state.pixelSelectionTarget=null;
    updatePixelSelectionButtons();
    canvas.requestRenderAll();
  }

  function ensurePixelSelectionTarget() {
    if(state.pixelSelectionTarget && realObjects().includes(state.pixelSelectionTarget))return state.pixelSelectionTarget;
    state.pixelSelectionTarget=activeImageLayer();
    return state.pixelSelectionTarget;
  }

  function createPixelRectMask(rect) {
    return selectionMaskCanvas(ctx=>{
      ctx.fillRect(rect.left,rect.top,rect.width,rect.height);
    });
  }

  function createPixelPolygonMask(points) {
    return selectionMaskCanvas(ctx=>{
      if(points.length<3)return;
      ctx.beginPath();ctx.moveTo(points[0].x,points[0].y);
      for(let i=1;i<points.length;i++)ctx.lineTo(points[i].x,points[i].y);
      ctx.closePath();ctx.fill();
    });
  }

  function startPixelMarquee(point) {
    const target=ensurePixelSelectionTarget();
    if(!target){
      $("selectionStatus").textContent="Pixels: сначала выберите image layer.";
      return;
    }
    state.marqueeStart=point;
    state.marqueeHelper=new F.Rect({
      left:point.x,top:point.y,width:1,height:1,
      fill:"rgba(111,125,255,.08)",stroke:"#7d8cff",strokeWidth:1.5,strokeDashArray:[6,4],
      selectable:false,evented:false,excludeFromExport:true,helper:true,objectCaching:false
    });
    canvas.add(state.marqueeHelper);canvas.bringObjectToFront(state.marqueeHelper);
  }

  function updatePixelMarquee(point) {
    if(!state.marqueeStart||!state.marqueeHelper)return;
    const x=Math.min(state.marqueeStart.x,point.x),y=Math.min(state.marqueeStart.y,point.y);
    const width=Math.abs(point.x-state.marqueeStart.x),height=Math.abs(point.y-state.marqueeStart.y);
    state.marqueeHelper.set({left:x,top:y,width,height,scaleX:1,scaleY:1});
    state.marqueeHelper.setCoords();canvas.requestRenderAll();
  }

  async function finishPixelMarquee() {
    if(!state.marqueeHelper)return;
    const rect=state.marqueeHelper.getBoundingRect();
    canvas.remove(state.marqueeHelper);state.marqueeHelper=null;state.marqueeStart=null;
    if(rect.width<2||rect.height<2)return;
    combinePixelSelection(createPixelRectMask(rect));
    await renderPixelSelectionOverlay();
    updatePixelSelectionButtons();
    $("selectionStatus").textContent="Pixel selection "+Math.round(rect.width)+"×"+Math.round(rect.height);
  }

  async function finishPixelLasso() {
    if(!state.lassoHelper||state.lassoPoints.length<3)return;
    canvas.remove(state.lassoHelper);state.lassoHelper=null;
    combinePixelSelection(createPixelPolygonMask(state.lassoPoints));
    state.lassoPoints=[];
    await renderPixelSelectionOverlay();
    updatePixelSelectionButtons();
    $("selectionStatus").textContent="Pixel lasso selection";
  }

  function loadBrowserImage(src) {
    return new Promise((resolve,reject)=>{
      const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=src;
    });
  }

  async function renderTargetDocument(target) {
    const temp=new F.StaticCanvas(null,{width:state.width,height:state.height,backgroundColor:null});
    const clone=await target.clone(["name","assetId","source","kind"]);
    clone.set({selectable:false,evented:false});
    temp.add(clone);temp.renderAll();
    const src=temp.toDataURL({format:"png",multiplier:1});
    temp.dispose();
    const image=await loadBrowserImage(src);
    const out=document.createElement("canvas");out.width=state.width;out.height=state.height;
    out.getContext("2d").drawImage(image,0,0);
    return out;
  }

  async function pixelSelectionToLayer() {
    const target=ensurePixelSelectionTarget();
    if(!target||!state.pixelSelection)return;
    const source=await renderTargetDocument(target);
    const ctx=source.getContext("2d");
    ctx.globalCompositeOperation="destination-in";
    ctx.drawImage(state.pixelSelection,0,0);
    ctx.globalCompositeOperation="source-over";
    const bounds=pixelMaskBounds(state.pixelSelection);
    if(!bounds)return;
    const crop=document.createElement("canvas");crop.width=bounds.width;crop.height=bounds.height;
    crop.getContext("2d").drawImage(source,bounds.x,bounds.y,bounds.width,bounds.height,0,0,bounds.width,bounds.height);
    const src=crop.toDataURL("image/png");
    const asset=await APP.addAsset({name:"Pixel selection",src,source:"Studio",kind:"selection",
      meta:{width:bounds.width,height:bounds.height}});
    await addImageFromUrl(src,"Pixel selection",asset,{left:bounds.x,top:bounds.y,scaleX:1,scaleY:1});
    clearPixelSelection();
    snapshotLabel("Pixel selection → Layer");
  }

  async function applyPixelClip(deleteInside=false) {
    const target=ensurePixelSelectionTarget();
    if(!target||!state.pixelSelection)return;
    let mask=state.pixelSelection;
    if(deleteInside){
      const inverted=document.createElement("canvas");inverted.width=state.width;inverted.height=state.height;
      const ctx=inverted.getContext("2d");
      ctx.fillStyle="#fff";ctx.fillRect(0,0,state.width,state.height);
      ctx.globalCompositeOperation="destination-out";ctx.drawImage(mask,0,0);
      ctx.globalCompositeOperation="source-over";mask=inverted;
    }
    const clip=await F.FabricImage.fromURL(mask.toDataURL("image/png"));
    clip.set({left:0,top:0,originX:"left",originY:"top",absolutePositioned:true,selectable:false,evented:false});
    target.clipPath=target.clipPath?F.util.mergeClipPaths(target.clipPath,clip):clip;
    target.dirty=true;
    clearPixelSelection();
    canvas.setActiveObject(target);canvas.requestRenderAll();
    snapshotLabel(deleteInside?"Deleted selected pixels":"Pixel selection → Mask");
    syncSelectionUi();
  }

  function clearToolHelpers() {
    clearPixelSelection();
    if (state.lassoHelper) {
      canvas.remove(state.lassoHelper);
      state.lassoHelper = null;
    }
    if (state.cropRect) {
      canvas.remove(state.cropRect);
      state.cropRect = null;
    }
    if (state.lineHelper) {
      canvas.remove(state.lineHelper);
      state.lineHelper = null;
      state.lineStart = null;
    }
    if (state.shapeHelper) {
      canvas.remove(state.shapeHelper);
      state.shapeHelper = null;
      state.shapeStart = null;
    }
    if (state.penHelper) {
      canvas.remove(state.penHelper);
      state.penHelper = null;
    }
    state.penPoints = [];
    exitNodeEdit();
    clearWand();
    state.lassoPoints = [];
    $("canvasFrame").classList.remove("selection-mode","crop-mode","lasso-mode","wand-mode","eyedropper-mode","fill-mode");
  }

  function setBrush(tool) {
    canvas.isDrawingMode = true;
    if (tool === "eraser") {
      const active=canvas.getActiveObject();
      state.eraserTarget=active && !(active instanceof F.ActiveSelection) && !isHelper(active) ? active : null;
      if(state.eraserTarget) $("selectionStatus").textContent="Eraser: "+objectName(state.eraserTarget);
    } else {
      state.eraserTarget=null;
    }
    const brush = new F.PencilBrush(canvas);
    const configuredSize = Math.max(1, Number($("brushSize").value) || 18);
    const opacity = Math.max(0.05, Number($("brushOpacity").value) || 1);
    const flow = Math.max(0.05, Number($("brushFlow").value) || 1);
    const hardness = Math.max(0, Math.min(1, Number($("brushHardness").value) || 0));
    brush.width = tool === "pencil" ? Math.min(4, configuredSize) : configuredSize;
    brush.color = tool === "eraser" ? "rgba(255,255,255," + (opacity * flow) + ")" : hexToRgba($("brushColor").value, opacity * flow);
    if (tool !== "pencil" && hardness < 0.98 && F.Shadow) {
      brush.shadow = new F.Shadow({
        color: tool === "eraser" ? "rgba(255,255,255," + (opacity * flow * .55) + ")" : hexToRgba($("brushColor").value, opacity * flow * .55),
        blur: Math.max(0, (1 - hardness) * configuredSize * .7),
        offsetX: 0,
        offsetY: 0,
        affectStroke: true
      });
    }
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
      const pixels=pixelSelectionEnabled();
      if(pixels)state.pixelSelectionTarget=activeImageLayer()||state.pixelSelectionTarget;
      canvas.selection = !pixels;
      canvas.skipTargetFind = pixels;
      canvas.discardActiveObject();
      canvas.requestRenderAll();
      canvas.defaultCursor = "crosshair";
      $("selectionContextTitle").textContent = pixels ? "Rectangle Pixel Select" : "Rectangle Object Select";
      $("canvasFrame").classList.add("selection-mode");
      setContext("contextSelection");
      if(pixels&&!state.pixelSelectionTarget)$("selectionStatus").textContent="Pixels: сначала выберите image layer.";
    } else if (tool === "lasso") {
      const pixels=pixelSelectionEnabled();
      if(pixels)state.pixelSelectionTarget=activeImageLayer()||state.pixelSelectionTarget;
      canvas.skipTargetFind = true;
      canvas.defaultCursor = "crosshair";
      $("selectionContextTitle").textContent = pixels ? "Pixel Lasso" : "Object Lasso";
      $("canvasFrame").classList.add("lasso-mode");
      setContext("contextSelection");
      if(pixels){canvas.discardActiveObject();canvas.requestRenderAll();if(!state.pixelSelectionTarget)$("selectionStatus").textContent="Pixels: сначала выберите image layer."}
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
    } else if (tool === "rect" || tool === "ellipse" || tool === "line" || tool === "pen") {
      canvas.skipTargetFind = true;
      canvas.defaultCursor = "crosshair";
      setContext("contextShape");
    } else if (tool === "node") {
      setContext("contextShape");
      enterNodeEdit();
    } else if (tool === "image") {
      $("fileInput").click();
      setTool("move");
      return;
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
      rect:"Rectangle (R)", ellipse:"Ellipse (O)", line:"Line (N)", pen:"Pen (A)", node:"Node Edit (Q)", image:"Place Image (J)", hand:"Hand (H)", zoom:"Zoom (Z)"
    }[tool] || tool;
  }

  function hexToRgba(hex, alpha) {
    const raw = String(hex || "#000000").replace("#","");
    const full = raw.length === 3 ? raw.split("").map(x => x + x).join("") : raw;
    const n = parseInt(full,16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + alpha + ")";
  }

  function ensureWandWorker() {
    if (state.wandWorker) return state.wandWorker;
    try {
      const worker = new Worker("raster-worker.js");
      worker.onmessage = event => {
        const { id, ok, result, error } = event.data || {};
        const pending = state.wandWorkerPending.get(id);
        if (!pending) return;
        state.wandWorkerPending.delete(id);
        ok ? pending.resolve(result) : pending.reject(new Error(error || "Raster worker error"));
      };
      worker.onerror = error => {
        for (const pending of state.wandWorkerPending.values()) pending.reject(error);
        state.wandWorkerPending.clear();
        try { worker.terminate(); } catch {}
        state.wandWorker = null;
      };
      state.wandWorker = worker;
      return worker;
    } catch {
      return null;
    }
  }

  function runRasterWorker(type, payload, transfer = []) {
    const worker = ensureWandWorker();
    if (!worker) return Promise.reject(new Error("Raster worker unavailable"));
    const id = ++state.wandWorkerSeq;
    return new Promise((resolve, reject) => {
      state.wandWorkerPending.set(id, { resolve, reject });
      worker.postMessage({ id, type, payload }, transfer);
    });
  }

  function computeMaskBounds(maskData, width, height) {
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        if (!maskData[row + x]) continue;
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
    }
    return maxX < 0 ? null : { minX, minY, maxX, maxY };
  }

  function featherMaskCanvas(mask, bounds, feather = 0, fullDocument = false) {
    const minX = fullDocument ? 0 : bounds.minX;
    const minY = fullDocument ? 0 : bounds.minY;
    const width = fullDocument ? state.width : bounds.maxX - bounds.minX + 1;
    const height = fullDocument ? state.height : bounds.maxY - bounds.minY + 1;
    const raw = document.createElement("canvas");
    raw.width = width; raw.height = height;
    const rctx = raw.getContext("2d");
    const image = rctx.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcX = x + minX, srcY = y + minY;
        const selected = mask.data[srcY * state.width + srcX];
        if (!selected) continue;
        const p = (y * width + x) * 4;
        image.data[p] = image.data[p + 1] = image.data[p + 2] = 255;
        image.data[p + 3] = 255;
      }
    }
    rctx.putImageData(image, 0, 0);
    if (!feather) return raw;
    const blurred = document.createElement("canvas");
    blurred.width = width; blurred.height = height;
    const bctx = blurred.getContext("2d");
    bctx.filter = "blur(" + feather + "px)";
    bctx.drawImage(raw, 0, 0);
    return blurred;
  }

  function serialize(id="autosave", title="Autosave") {
    return {
      id,
      title,
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
      await SkoomaStore.saveProject(serialize("autosave","Autosave"));
      APP.setAutosaveState("Сохранено");
    } catch (error) {
      APP.setAutosaveState("Ошибка autosave");
      console.error(error);
    }
  }

  async function saveManualProject() {
    const suggested="Skooma Project "+new Date().toLocaleString();
    const title=window.prompt("Название проекта",suggested);
    if(title===null)return;
    const project=serialize("project-"+Date.now(),title.trim()||suggested);
    await SkoomaStore.saveProject(project);
    await SkoomaStore.saveProject(serialize("autosave","Autosave"));
    APP.setAutosaveState("Проект сохранён");
    return project;
  }

  async function loadProjectById(id) {
    const project=await SkoomaStore.getProject(id);
    if(!project)throw new Error("Проект не найден");
    await loadProjectObject(project,true);
    return project;
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
    state.thumbCache=new WeakMap();
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

  async function applyEraserStroke(path) {
    const target=state.eraserTarget;
    if(!target || !canvas.getObjects().includes(target)) {
      path.globalCompositeOperation="destination-out";
      assignObjectMetadata(path,"Eraser",{kind:"drawing",source:"studio"});
      snapshotLabel("Ластик");
      renderLayers();
      canvas.requestRenderAll();
      return;
    }

    canvas.remove(path);
    const temp=new F.StaticCanvas(null,{
      width:state.width,height:state.height,backgroundColor:"#ffffff"
    });
    const clone=await path.clone(["name","assetId","source","kind"]);
    clone.set({
      globalCompositeOperation:"destination-out",
      stroke:"#000000",
      fill:null,
      opacity:1,
      selectable:false,evented:false
    });
    temp.add(clone);
    temp.renderAll();
    const maskUrl=temp.toDataURL({format:"png",multiplier:1});
    temp.dispose();

    const newMask=await F.FabricImage.fromURL(maskUrl);
    newMask.set({
      left:0,top:0,originX:"left",originY:"top",
      absolutePositioned:true,selectable:false,evented:false
    });
    target.clipPath=target.clipPath
      ? F.util.mergeClipPaths(target.clipPath,newMask)
      : newMask;
    target.dirty=true;
    canvas.setActiveObject(target);
    canvas.requestRenderAll();
    snapshotLabel("Eraser mask");
    syncSelectionUi();
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
    $("ctxLockRatio").checked = !!active.__skoomaLockRatio;
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
      const fallback = objectKind(object) === "image" ? "▧" :
        objectKind(object) === "text" ? "T" :
        objectKind(object) === "drawing" ? "✎" :
        objectKind(object) === "group" ? "▦" : "◇";
      thumb.textContent = fallback;
      thumb.style.display = "grid";
      thumb.style.placeItems = "center";
      thumb.style.color = "#9fb0c3";
      thumb.style.fontWeight = "900";
      const cachedThumb=state.thumbCache.get(object);
      if(cachedThumb){
        thumb.textContent="";
        thumb.style.backgroundImage="url("+cachedThumb+")";
        thumb.style.backgroundSize="contain";
        thumb.style.backgroundRepeat="no-repeat";
        thumb.style.backgroundPosition="center";
      }else{
        const makeThumb=()=>{
          if(!thumb.isConnected)return;
          try{
            const maxDim=Math.max(object.getScaledWidth?.()||object.width||1,object.getScaledHeight?.()||object.height||1);
            const multiplier=Math.min(.25,48/Math.max(1,maxDim));
            const url=object.toDataURL({format:"png",multiplier:Math.max(.03,multiplier)});
            state.thumbCache.set(object,url);
            thumb.textContent="";
            thumb.style.backgroundImage="url("+url+")";
            thumb.style.backgroundSize="contain";
            thumb.style.backgroundRepeat="no-repeat";
            thumb.style.backgroundPosition="center";
          }catch{}
        };
        if("requestIdleCallback" in window)requestIdleCallback(makeThumb,{timeout:500});
        else setTimeout(makeThumb,0);
      }

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

    const isImage = active instanceof F.FabricImage;
    const isText = active instanceof F.IText || active instanceof F.Textbox;
    const canStyle = !isImage && !(active instanceof F.Group);
    $("styleProperties").classList.toggle("hidden", !canStyle);
    if (canStyle) {
      if (typeof active.fill === "string" && /^#[0-9a-f]{6}$/i.test(active.fill)) $("propFill").value = active.fill;
      if (typeof active.stroke === "string" && /^#[0-9a-f]{6}$/i.test(active.stroke)) $("propStroke").value = active.stroke;
      $("propStrokeWidth").value = Number(active.strokeWidth || 0);
    }

    $("textObjectProperties").classList.toggle("hidden", !isText);
    if (isText) {
      $("propTextContent").value = active.text || "";
      $("propTextSize").value = Math.round(active.fontSize || 48);
      $("propTextWeight").value = String(active.fontWeight || 400);
      $("propTextLineHeight").value = active.lineHeight || 1.16;
      $("propTextAlign").value = active.textAlign || "left";
      $("propTextFont").value = active.fontFamily || "Inter, Arial, sans-serif";
    }

    $("maskProperties").classList.toggle("hidden", !active.clipPath);
    $("imageFilters").classList.toggle("hidden", !isImage);
    if (isImage) syncFilterControls(active);
  }

  function syncSelectionUi() {
    $("selectionStatus").textContent = selectionSummary();
    renderLayers();
    renderProperties();
    updateContextTransform();
  }

  async function setBackgroundFromUrl(src,name="Background",asset=null) {
    const image = await F.FabricImage.fromURL(src,{ crossOrigin:"anonymous" });
    const scale = Math.max(state.width / image.width, state.height / image.height);
    image.set({
      left:state.width/2,top:state.height/2,
      originX:"center",originY:"center",
      scaleX:scale,scaleY:scale,
      selectable:false,evented:false,
      lockMovementX:true,lockMovementY:true,lockScalingX:true,lockScalingY:true,lockRotation:true
    });
    assignObjectMetadata(image,name,{assetId:asset?.id,source:asset?.source||"media",kind:"background"});
    canvas.add(image);
    canvas.sendObjectToBack(image);
    canvas.requestRenderAll();
    snapshotLabel("Установлен background");
    renderLayers();
    return image;
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
      fontWeight:$("textWeight").value,
      lineHeight:Math.max(.5,Number($("textLineHeight").value)||1.16),
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

  function vectorNodeSpecs(object) {
    if (object instanceof F.Polyline) {
      return object.points.map((point,index)=>({
        key:"point-"+index,label:"Node "+(index+1),kind:"endpoint",
        get:()=>({x:point.x,y:point.y}),
        set:(x,y)=>{object.points[index]={x,y}}
      }));
    }
    if (!(object instanceof F.Path) || !Array.isArray(object.path)) return [];

    const specs=[];
    let currentX=0,currentY=0,startX=0,startY=0;
    object.path.forEach((command,commandIndex)=>{
      const code=String(command[0]||"").toUpperCase();
      const add=(kind,xIndex,yIndex,xFallback,yFallback,label)=>{
        specs.push({
          key:commandIndex+"-"+kind+"-"+String(xIndex)+"-"+String(yIndex),
          label,kind,commandIndex,xIndex,yIndex,
          get:()=>({
            x:xIndex==null?xFallback():Number(command[xIndex]),
            y:yIndex==null?yFallback():Number(command[yIndex])
          }),
          set:(x,y)=>{
            if(xIndex!=null)command[xIndex]=x;
            if(yIndex!=null)command[yIndex]=y;
          }
        });
      };
      if(code==="M"||code==="L"||code==="T"){
        add("endpoint",1,2,()=>currentX,()=>currentY,"Node "+(commandIndex+1));
        currentX=Number(command[1]);currentY=Number(command[2]);
        if(code==="M"){startX=currentX;startY=currentY}
      }else if(code==="H"){
        const fixedY=currentY;
        add("endpoint",1,null,()=>currentX,()=>fixedY,"Node "+(commandIndex+1));
        currentX=Number(command[1]);
      }else if(code==="V"){
        const fixedX=currentX;
        add("endpoint",null,1,()=>fixedX,()=>currentY,"Node "+(commandIndex+1));
        currentY=Number(command[1]);
      }else if(code==="C"){
        add("control1",1,2,()=>currentX,()=>currentY,"Bezier control 1");
        add("control2",3,4,()=>currentX,()=>currentY,"Bezier control 2");
        add("endpoint",5,6,()=>currentX,()=>currentY,"Node "+(commandIndex+1));
        currentX=Number(command[5]);currentY=Number(command[6]);
      }else if(code==="S"||code==="Q"){
        add("control",1,2,()=>currentX,()=>currentY,"Bezier control");
        add("endpoint",3,4,()=>currentX,()=>currentY,"Node "+(commandIndex+1));
        currentX=Number(command[3]);currentY=Number(command[4]);
      }else if(code==="A"){
        add("endpoint",6,7,()=>currentX,()=>currentY,"Node "+(commandIndex+1));
        currentX=Number(command[6]);currentY=Number(command[7]);
      }else if(code==="Z"){
        currentX=startX;currentY=startY;
      }
    });
    return specs;
  }

  function vectorNodeScenePoint(object,spec) {
    const raw=spec.get();
    const local=new F.Point(raw.x-object.pathOffset.x,raw.y-object.pathOffset.y);
    return F.util.sendPointToPlane(local,object.calcTransformMatrix(),undefined);
  }

  function recalcVectorBounds(object,absoluteCenter=null) {
    const center=absoluteCenter||object.getCenterPoint();
    if(object instanceof F.Path && typeof object._setPath==="function"){
      object._setPath(object.path);
    }else if(typeof object.setDimensions==="function"){
      object.setDimensions();
    }
    object.setPositionByOrigin(center,"center","center");
    object.setCoords();
    object.dirty=true;
  }

  function refreshNodeHandles() {
    const object=state.nodeTarget;
    if(!object)return;
    state.nodeHandles.forEach(handle=>{
      const spec=handle.nodeSpec;
      if(!spec)return;
      const scene=vectorNodeScenePoint(object,spec);
      handle.set({left:scene.x,top:scene.y});
      handle.setCoords();
    });
    canvas.requestRenderAll();
  }

  function exitNodeEdit() {
    if(state.nodeTarget){
      state.nodeTarget.selectable=true;
      state.nodeTarget.evented=true;
      state.nodeTarget.setCoords();
    }
    state.nodeHandles.forEach(handle=>canvas.remove(handle));
    state.nodeHandles=[];
    state.nodeTarget=null;
    canvas.requestRenderAll();
  }

  function enterNodeEdit() {
    exitNodeEdit();
    const object=canvas.getActiveObject();
    const editable=object && !(object instanceof F.ActiveSelection) &&
      (object instanceof F.Polyline || object instanceof F.Path);
    if(!editable){
      $("selectionStatus").textContent="Node Edit: выберите Polyline / Polygon / Path. SVG group можно Ungroup.";
      return;
    }

    const specs=vectorNodeSpecs(object);
    if(!specs.length){
      $("selectionStatus").textContent="Node Edit: в выбранном vector нет редактируемых узлов.";
      return;
    }

    state.nodeTarget=object;
    object.selectable=false;
    object.evented=false;
    canvas.discardActiveObject();

    state.nodeHandles=specs.map((spec,index)=>{
      const scene=vectorNodeScenePoint(object,spec);
      const isControl=spec.kind!=="endpoint";
      const handle=new F.Circle({
        left:scene.x,top:scene.y,radius:isControl?4:5,originX:"center",originY:"center",
        fill:isControl?"#ffd166":"#ffffff",stroke:"#6f7dff",strokeWidth:2,
        selectable:true,evented:true,hasControls:false,hasBorders:false,
        excludeFromExport:true,helper:true,name:spec.label
      });
      handle.nodeSpec=spec;
      let centerBefore=null;
      handle.on("mousedown",()=>{centerBefore=object.getCenterPoint()});
      handle.on("moving",()=>{
        const scenePoint=handle.getCenterPoint();
        const local=F.util.sendPointToPlane(scenePoint,undefined,object.calcTransformMatrix());
        spec.set(local.x+object.pathOffset.x,local.y+object.pathOffset.y);
        object.dirty=true;
        canvas.requestRenderAll();
      });
      handle.on("modified",()=>{
        recalcVectorBounds(object,centerBefore);
        refreshNodeHandles();
        snapshotLabel("Изменён vector node");
      });
      canvas.add(handle);
      canvas.bringObjectToFront(handle);
      return handle;
    });
    $("selectionStatus").textContent="Node Edit: "+specs.filter(spec=>spec.kind==="endpoint").length+" nodes";
    canvas.requestRenderAll();
  }

  function beginShape(tool,point) {
    state.shapeStart=point;
    const common={
      left:point.x,top:point.y,
      fill:$("shapeFill").value,
      stroke:Number($("shapeStrokeWidth").value)>0?$("shapeStroke").value:null,
      strokeWidth:Number($("shapeStrokeWidth").value)||0,
      selectable:false,evented:false,excludeFromExport:false,helper:false,opacity:.85
    };
    state.shapeHelper=tool==="ellipse"
      ?new F.Ellipse({...common,rx:1,ry:1})
      :new F.Rect({...common,width:1,height:1,rx:4,ry:4});
    assignObjectMetadata(state.shapeHelper,tool==="ellipse"?"Ellipse":"Rectangle",{kind:"shape",source:"studio"});
    canvas.add(state.shapeHelper);canvas.requestRenderAll();
  }

  function updateShape(point,shift=false) {
    if(!state.shapeHelper||!state.shapeStart)return;
    const start=state.shapeStart;
    let width=Math.abs(point.x-start.x),height=Math.abs(point.y-start.y);
    if(shift){const size=Math.max(width,height);width=height=size}
    const left=Math.min(start.x,point.x),top=Math.min(start.y,point.y);
    if(state.shapeHelper instanceof F.Ellipse){
      state.shapeHelper.set({left,top,rx:Math.max(.5,width/2),ry:Math.max(.5,height/2)});
    }else{
      state.shapeHelper.set({left,top,width:Math.max(1,width),height:Math.max(1,height)});
    }
    state.shapeHelper.setCoords();canvas.requestRenderAll();
  }

  function finishShape() {
    if(!state.shapeHelper)return;
    const object=state.shapeHelper;
    state.shapeHelper=null;state.shapeStart=null;
    object.set({selectable:true,evented:true,opacity:1});
    canvas.setActiveObject(object);canvas.requestRenderAll();
    snapshotLabel("Добавлена фигура");syncSelectionUi();setTool("move");
  }

  function addLine(start,end) {
    const line = new F.Polyline([start,end],{
      stroke:$("shapeStroke").value || $("shapeFill").value,
      strokeWidth:Math.max(1,Number($("shapeStrokeWidth").value)||2),
      fill:"rgba(0,0,0,0)",
      objectCaching:false
    });
    assignObjectMetadata(line,"Line",{kind:"vector",source:"studio"});
    canvas.add(line); canvas.setActiveObject(line); canvas.requestRenderAll();
    snapshotLabel("Добавлена линия"); syncSelectionUi();
  }

  function beginLine(point) {
    state.lineStart = point;
    state.lineHelper = new F.Line([point.x,point.y,point.x,point.y],{
      stroke:"#9fb0ff",strokeWidth:1.5,strokeDashArray:[6,4],
      selectable:false,evented:false,excludeFromExport:true,helper:true
    });
    canvas.add(state.lineHelper);
  }

  function updateLine(point) {
    if (!state.lineHelper || !state.lineStart) return;
    state.lineHelper.set({x2:point.x,y2:point.y});
    canvas.requestRenderAll();
  }

  function finishLine(point) {
    if (!state.lineStart) return;
    const start=state.lineStart;
    if(state.lineHelper)canvas.remove(state.lineHelper);
    state.lineHelper=null;state.lineStart=null;
    addLine(start,point);setTool("move");
  }

  function beginPen(point) {
    state.penPoints.push({x:point.x,y:point.y});
    if(state.penHelper)canvas.remove(state.penHelper);
    state.penHelper=new F.Polyline(state.penPoints,{
      fill:"rgba(0,0,0,0)",stroke:"#9fb0ff",strokeWidth:1.5,strokeDashArray:[5,4],
      selectable:false,evented:false,excludeFromExport:true,helper:true,objectCaching:false
    });
    canvas.add(state.penHelper);canvas.requestRenderAll();
  }

  function finishPen(close=false) {
    if(state.penPoints.length<2){clearToolHelpers();setTool("move");return}
    const points=[...state.penPoints];
    if(close && points.length>2) points.push({...points[0]});
    if(state.penHelper)canvas.remove(state.penHelper);
    state.penHelper=null;state.penPoints=[];
    const poly=new F.Polyline(points,{
      fill:close?$("shapeFill").value:"rgba(0,0,0,0)",
      stroke:$("shapeStroke").value || $("shapeFill").value,
      strokeWidth:Math.max(1,Number($("shapeStrokeWidth").value)||2),
      objectCaching:false
    });
    assignObjectMetadata(poly,close?"Polygon":"Polyline",{kind:"vector",source:"studio"});
    canvas.add(poly);canvas.setActiveObject(poly);canvas.requestRenderAll();
    snapshotLabel(close?"Добавлен polygon":"Добавлен path");syncSelectionUi();setTool("move");
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

    const isImage = active instanceof F.FabricImage;
    const isText = active instanceof F.IText || active instanceof F.Textbox;
    if (!isImage && !(active instanceof F.Group)) {
      if ("fill" in active) active.fill = $("propFill").value;
      active.stroke = Number($("propStrokeWidth").value) > 0 ? $("propStroke").value : null;
      active.strokeWidth = Math.max(0, Number($("propStrokeWidth").value) || 0);
    }
    if (isText) {
      active.set({
        text:$("propTextContent").value,
        fontSize:Math.max(8,Number($("propTextSize").value)||48),
        fontWeight:$("propTextWeight").value,
        lineHeight:Math.max(.5,Number($("propTextLineHeight").value)||1.16),
        textAlign:$("propTextAlign").value,
        fontFamily:$("propTextFont").value.trim() || "Inter, Arial, sans-serif",
        fill:$("propFill").value
      });
    }

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
    active.__skoomaLockRatio = $("ctxLockRatio").checked;
    active.setControlsVisibility({
      ml:!active.__skoomaLockRatio,mr:!active.__skoomaLockRatio,
      mt:!active.__skoomaLockRatio,mb:!active.__skoomaLockRatio,
      tl:true,tr:true,bl:true,br:true,mtr:true
    });
    if (active.width) active.scaleX = width / active.width;
    if (active.height) active.scaleY = height / active.height;
    active.setCoords(); canvas.requestRenderAll();
    snapshotLabel("Transform"); syncSelectionUi();
  }

  async function selectAll() {
    if(pixelSelectionEnabled()){
      const target=ensurePixelSelectionTarget();
      if(!target){$("selectionStatus").textContent="Pixels: сначала выберите image layer.";return}
      const bounds=target.getBoundingRect();
      combinePixelSelection(createPixelRectMask(bounds));
      await renderPixelSelectionOverlay();
      updatePixelSelectionButtons();
      $("selectionStatus").textContent="Pixel selection: all active layer bounds";
      return;
    }
    const objects = realObjects().filter(object => object.selectable !== false && object.visible !== false);
    if (!objects.length) return;
    const selection = new F.ActiveSelection(objects,{ canvas });
    canvas.setActiveObject(selection); canvas.requestRenderAll(); syncSelectionUi();
  }

  function clearSelection() {
    clearPixelSelection();
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

  function segmentsIntersect(a,b,c,d) {
    const orient=(p,q,r)=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
    const o1=orient(a,b,c),o2=orient(a,b,d),o3=orient(c,d,a),o4=orient(c,d,b);
    return ((o1===0||o2===0||Math.sign(o1)!==Math.sign(o2)) &&
            (o3===0||o4===0||Math.sign(o3)!==Math.sign(o4)));
  }

  function lassoIntersectsObject(object, polygon) {
    const box=object.getCoords?.() || [];
    if(!box.length)return pointInPolygon(object.getCenterPoint(),polygon);
    if(box.some(point=>pointInPolygon(point,polygon)))return true;
    if(polygon.some(point=>pointInPolygon(point,box)))return true;
    for(let i=0;i<polygon.length;i++){
      const a=polygon[i],b=polygon[(i+1)%polygon.length];
      for(let j=0;j<box.length;j++){
        const c=box[j],d=box[(j+1)%box.length];
        if(segmentsIntersect(a,b,c,d))return true;
      }
    }
    return false;
  }

  function applyObjectSelection(objects, baseOverride = null) {
    const mode = $("selectionMode").value;
    const current = (baseOverride || canvas.getActiveObjects()).filter(object => !isHelper(object));
    let result = objects;
    if (mode === "add") result = [...new Set([...current,...objects])];
    if (mode === "subtract") result = current.filter(object => !objects.includes(object));
    if (mode === "intersect") result = current.filter(object => objects.includes(object));
    state.adjustingSelection = true;
    canvas.discardActiveObject();
    if (result.length === 1) canvas.setActiveObject(result[0]);
    else if (result.length > 1) canvas.setActiveObject(new F.ActiveSelection(result,{ canvas }));
    canvas.requestRenderAll();
    state.adjustingSelection = false;
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

  async function finishLasso() {
    if (!state.lassoHelper || state.lassoPoints.length < 3) return;
    if(pixelSelectionEnabled()){
      await finishPixelLasso();
      return;
    }
    const selected = realObjects().filter(object => lassoIntersectsObject(object,state.lassoPoints));
    canvas.remove(state.lassoHelper); state.lassoHelper=null;
    applyObjectSelection(selected);
    state.lassoPoints=[];
  }

  function updateCropFields() {
    if(!state.cropRect)return;
    $("cropWidth").value=Math.max(1,Math.round(state.cropRect.getScaledWidth()));
    $("cropHeight").value=Math.max(1,Math.round(state.cropRect.getScaledHeight()));
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
    updateCropFields();
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
    state.cropRect.setCoords(); canvas.requestRenderAll(); updateCropFields();
  }

  function setCropDimensions() {
    if(!state.cropRect)return;
    const width=Math.max(1,Number($("cropWidth").value)||state.cropRect.getScaledWidth());
    const height=Math.max(1,Number($("cropHeight").value)||state.cropRect.getScaledHeight());
    state.cropRect.set({
      scaleX:width/Math.max(1,state.cropRect.width),
      scaleY:height/Math.max(1,state.cropRect.height)
    });
    state.cropRect.setCoords();
    canvas.requestRenderAll();
    updateCropFields();
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
    if ($("wandMaskBtn")) $("wandMaskBtn").disabled=true;
    if ($("wandCancelBtn")) $("wandCancelBtn").disabled=true;
  }

  async function magicWandAt(point) {
    clearWand();
    const target = canvas.getActiveObject();
    const source = renderFlatCanvas();
    const ctx = source.getContext("2d",{ willReadFrequently:true });
    const imageData = ctx.getImageData(0,0,state.width,state.height);
    const x=Math.max(0,Math.min(state.width-1,Math.floor(point.x)));
    const y=Math.max(0,Math.min(state.height-1,Math.floor(point.y)));
    const tolerance=Math.max(0,Math.min(255,Number($("wandTolerance").value)||32));

    let mask = null;
    try {
      const transferable = imageData.data.buffer.slice(0);
      const result = await runRasterWorker("magic-wand",{
        width:state.width,height:state.height,data:transferable,x,y,tolerance
      },[transferable]);
      if (result) {
        mask = {
          width:result.width || state.width,
          height:result.height || state.height,
          bounds:result.bounds || null,
          data:new Uint8Array(result.data)
        };
      }
    } catch (workerError) {
      if (MagicWand?.floodFill) {
        mask=MagicWand.floodFill({
          data:imageData.data,width:state.width,height:state.height,bytes:4
        },x,y,tolerance,null,true);
      } else {
        console.error(workerError);
      }
    }

    if (!mask) {
      $("selectionStatus").textContent="Magic Wand: область не найдена";
      return;
    }

    let bounds=mask.bounds;
    if (!bounds || bounds.minX===undefined) bounds=computeMaskBounds(mask.data,state.width,state.height);
    if (!bounds) return;

    const feather=Math.max(0,Math.min(40,Number($("wandFeather").value)||0));
    const previewCanvas=featherMaskCanvas(mask,bounds,feather,true);
    const pctx=previewCanvas.getContext("2d");
    pctx.globalCompositeOperation="source-in";
    pctx.fillStyle="rgba(111,125,255,.45)";
    pctx.fillRect(0,0,previewCanvas.width,previewCanvas.height);
    const previewObj=await F.FabricImage.fromURL(previewCanvas.toDataURL("image/png"));
    previewObj.set({
      left:0,top:0,originX:"left",originY:"top",
      selectable:false,evented:false,excludeFromExport:true,helper:true,opacity:1
    });
    canvas.add(previewObj);canvas.bringObjectToFront(previewObj);canvas.requestRenderAll();

    state.wand={mask,bounds,source,preview:previewObj,target:target instanceof F.FabricImage?target:null,feather};
    $("wandToLayerBtn").disabled=false;
    $("wandMaskBtn").disabled=!(target instanceof F.FabricImage);
    $("wandCancelBtn").disabled=false;
    $("selectionStatus").textContent="Magic Wand selection";
  }

  async function wandToLayer() {
    if (!state.wand) return;
    const {mask,bounds,source,feather}=state.wand;
    const width=bounds.maxX-bounds.minX+1;
    const height=bounds.maxY-bounds.minY+1;
    const srcCtx=source.getContext("2d");
    const src=srcCtx.getImageData(bounds.minX,bounds.minY,width,height);
    const alphaCanvas=featherMaskCanvas(mask,bounds,feather,false);
    const alpha=alphaCanvas.getContext("2d",{willReadFrequently:true}).getImageData(0,0,width,height).data;
    for(let i=0;i<width*height;i++) {
      const a=alpha[i*4+3];
      src.data[i*4+3]=Math.round(src.data[i*4+3]*(a/255));
    }
    const out=document.createElement("canvas");out.width=width;out.height=height;
    out.getContext("2d").putImageData(src,0,0);
    const url=out.toDataURL("image/png");
    const asset=await APP.addAsset({name:"Magic Wand selection",src:url,source:"Studio",kind:"selection"});
    clearWand();
    await addImageFromUrl(url,"Magic Wand selection",asset,{left:bounds.minX,top:bounds.minY,scaleX:1,scaleY:1});
    snapshotLabel("Magic Wand → Layer");
    setTool("move");
  }

  async function wandToMask() {
    if (!state.wand?.target) return;
    const {mask,bounds,feather,target}=state.wand;
    const full=featherMaskCanvas(mask,bounds,feather,true);
    const maskImage=await F.FabricImage.fromURL(full.toDataURL("image/png"));
    maskImage.set({
      left:0,top:0,originX:"left",originY:"top",
      absolutePositioned:true,selectable:false,evented:false
    });
    target.clipPath=maskImage;
    target.dirty=true;
    clearWand();
    canvas.setActiveObject(target);
    canvas.requestRenderAll();
    snapshotLabel("Добавлена layer mask");
    syncSelectionUi();
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

  function parseHexColor(hex) {
    const raw=String(hex||"#000000").replace("#","");
    const full=raw.length===3?raw.split("").map(v=>v+v).join(""):raw.padEnd(6,"0");
    const value=parseInt(full,16)||0;
    return {r:(value>>16)&255,g:(value>>8)&255,b:value&255};
  }

  async function rasterFloodFillAt(point) {
    const source=renderFlatCanvas();
    const ctx=source.getContext("2d",{willReadFrequently:true});
    const imageData=ctx.getImageData(0,0,state.width,state.height);
    const x=Math.max(0,Math.min(state.width-1,Math.floor(point.x)));
    const y=Math.max(0,Math.min(state.height-1,Math.floor(point.y)));
    const tolerance=Math.max(0,Math.min(255,Number($("wandTolerance").value)||32));
    let mask=null;
    try{
      const buffer=imageData.data.buffer.slice(0);
      const result=await runRasterWorker("magic-wand",{width:state.width,height:state.height,data:buffer,x,y,tolerance},[buffer]);
      if(result)mask={data:new Uint8Array(result.data),bounds:result.bounds};
    }catch{
      if(MagicWand?.floodFill)mask=MagicWand.floodFill({data:imageData.data,width:state.width,height:state.height,bytes:4},x,y,tolerance,null,true);
    }
    if(!mask)return;
    const bounds=mask.bounds?.minX!==undefined?mask.bounds:computeMaskBounds(mask.data,state.width,state.height);
    if(!bounds)return;
    const width=bounds.maxX-bounds.minX+1,height=bounds.maxY-bounds.minY+1;
    const out=document.createElement("canvas");out.width=width;out.height=height;
    const octx=out.getContext("2d");const data=octx.createImageData(width,height);
    const color=parseHexColor($("shapeFill").value);
    for(let yy=0;yy<height;yy++)for(let xx=0;xx<width;xx++){
      const mi=(bounds.minY+yy)*state.width+(bounds.minX+xx);
      if(!mask.data[mi])continue;
      const p=(yy*width+xx)*4;
      data.data[p]=color.r;data.data[p+1]=color.g;data.data[p+2]=color.b;data.data[p+3]=255;
    }
    octx.putImageData(data,0,0);
    const src=out.toDataURL("image/png");
    const asset=await APP.addAsset({name:"Fill",src,source:"Studio",kind:"generated"});
    await addImageFromUrl(src,"Fill",asset,{left:bounds.minX,top:bounds.minY,scaleX:1,scaleY:1});
    snapshotLabel("Raster fill");
  }

  async function fillTarget(target,point) {
    if (target && !isHelper(target) && !(target instanceof F.FabricImage) && !(target instanceof F.Path)) {
      if ("fill" in target) {
        target.set("fill",$("shapeFill").value);
        canvas.requestRenderAll(); snapshotLabel("Fill");
        syncSelectionUi();
        return;
      }
    }
    await rasterFloodFillAt(point);
  }

  function groupSelected() {
    const active=canvas.getActiveObject();
    if (!(active instanceof F.ActiveSelection)) return;
    const matrix=active.calcTransformMatrix();
    const objects=active.getObjects().filter(object=>!isHelper(object));
    active.removeAll();
    canvas.discardActiveObject();
    objects.forEach(object=>{
      F.util.sendObjectToPlane(object,matrix,undefined);
      canvas.remove(object);
    });
    const group=new F.Group(objects,{ subTargetCheck:true });
    assignObjectMetadata(group,"Group",{ kind:"group",source:"studio" });
    canvas.add(group);canvas.setActiveObject(group);canvas.requestRenderAll();
    snapshotLabel("Сгруппированы слои");syncSelectionUi();
  }

  function ungroupSelected() {
    const active=canvas.getActiveObject();
    if (!(active instanceof F.Group) || active instanceof F.ActiveSelection) return;
    const matrix=active.calcTransformMatrix();
    const items=active.getObjects();
    active.removeAll();
    canvas.remove(active);
    items.forEach(object=>{
      F.util.sendObjectToPlane(object,matrix,undefined);
      canvas.add(object);
    });
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

  function readFilterState(image) {
    const defaults={ brightness:0,contrast:0,saturation:0,blur:0,grayscale:false,sepia:false,invert:false,sharpen:false };
    const saved=state.filterState.get(image);
    if(saved)return saved;
    const values={...defaults};
    for(const filter of image?.filters||[]){
      const type=String(filter?.type||filter?.constructor?.name||"").toLowerCase();
      if(type.includes("brightness"))values.brightness=Number(filter.brightness||0);
      else if(type.includes("contrast"))values.contrast=Number(filter.contrast||0);
      else if(type.includes("saturation"))values.saturation=Number(filter.saturation||0);
      else if(type.includes("blur"))values.blur=Number(filter.blur||0);
      else if(type.includes("grayscale"))values.grayscale=true;
      else if(type.includes("sepia"))values.sepia=true;
      else if(type.includes("invert"))values.invert=true;
      else if(type.includes("convolute"))values.sharpen=true;
    }
    state.filterState.set(image,values);
    return values;
  }

  function syncFilterControls(image) {
    const saved=readFilterState(image);
    $("filterBrightness").value=saved.brightness;
    $("filterContrast").value=saved.contrast;
    $("filterSaturation").value=saved.saturation;
    $("filterBlur").value=saved.blur;
    ["grayscale","sepia","invert","sharpen"].forEach(type=>{
      const btn=$("filter"+type.charAt(0).toUpperCase()+type.slice(1)+"Btn");
      if(btn)btn.classList.toggle("active-filter",!!saved[type]);
    });
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
    if (values.invert) filters.push(new F.filters.Invert());
    if (values.sharpen) filters.push(new F.filters.Convolute({ matrix:[0,-1,0,-1,5,-1,0,-1,0] }));
    image.filters=filters;
    image.applyFilters();
    state.filterState.set(image,values);
    canvas.requestRenderAll();
    if (commit) snapshotLabel("Image filters");
  }

  function toggleImageFilter(type) {
    const image=canvas.getActiveObject();
    if (!(image instanceof F.FabricImage)) return;
    const values=readFilterState(image);
    values[type]=!values[type];
    state.filterState.set(image,values);
    applyImageFilters(true);
  }

  function resetImageFilters() {
    const image=canvas.getActiveObject();
    if (!(image instanceof F.FabricImage)) return;
    state.filterState.set(image,{ brightness:0,contrast:0,saturation:0,blur:0,grayscale:false,sepia:false,invert:false,sharpen:false });
    image.filters=[];image.applyFilters();canvas.requestRenderAll();
    syncFilterControls(image);snapshotLabel("Filters reset");
  }

  async function generateAi(replace=false, promptOverride=null) {
    const prompt=(promptOverride ?? $("aiPrompt").value).trim();
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
      const options={
        model:$("aiModel").value,quality:$("aiQuality").value,ratio:{w,h},test_mode:$("aiTestMode").checked
      };
      if(state.aiReference) options.input_image=state.aiReference;
      const result=await puter.ai.txt2img(prompt,options);
      const src=result.src;
      state.lastAiSrc=src;
      $("downloadAiBtn").disabled=false;
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

  async function generateVariations() {
    const prompt=$("aiPrompt").value.trim();
    if(!prompt)return;
    const count=Math.max(2,Math.min(4,Number($("aiVariationCount").value)||3));
    const button=$("generateVariationsBtn"),old=button.textContent;
    button.disabled=true;button.textContent="Генерация "+count+"...";
    $("aiStatus").textContent="Создаю вариации...";
    try{
      for(let i=0;i<count;i++){
        await generateAi(false,prompt + (i ? " variation "+(i+1) : ""));
        const active=canvas.getActiveObject();
        if(active && !(active instanceof F.ActiveSelection)){
          active.set({left:(active.left||0)+i*28,top:(active.top||0)+i*18});
          active.setCoords();canvas.requestRenderAll();
        }
      }
      $("aiStatus").textContent="Вариации готовы."; $("aiStatus").className="drawer-status ok";
    }finally{button.disabled=false;button.textContent=old}
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
    const project={ ...serialize("project-export","Exported project"),assets:APP.assets || [] };
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
    canvas.on("selection:created",event=>{
      if(state.tool==="marquee"&&!state.adjustingSelection&&$("selectionMode").value!=="replace"){
        const selected=(event.selected||canvas.getActiveObjects()).filter(object=>!isHelper(object));
        applyObjectSelection(selected,state.selectionBase);
        return;
      }
      syncSelectionUi();
    });
    canvas.on("selection:updated",syncSelectionUi);
    canvas.on("selection:cleared",syncSelectionUi);
    canvas.on("object:modified",event=>{
      if(event.target===state.cropRect){updateCropFields();return}
      if(isHelper(event.target))return;
      state.guides={v:[],h:[]};snapshotLabel("Изменён объект");syncSelectionUi();
    });
    canvas.on("object:moving",event=>{if(event.target===state.cropRect){updateCropFields();return}if(!isHelper(event.target))snapObject(event.target)});
    canvas.on("object:scaling",event=>{if(event.target===state.cropRect)updateCropFields()});
    canvas.on("after:render",drawGuides);
    canvas.on("path:created",async event=>{
      const path=event.path;if(!path)return;
      if(state.tool==="eraser"){
        await applyEraserStroke(path);
        return;
      }
      assignObjectMetadata(path,state.tool==="pencil"?"Pencil":"Brush",{kind:"drawing",source:"studio"});
      snapshotLabel(state.tool==="pencil"?"Карандаш":"Кисть");
      renderLayers();canvas.requestRenderAll();
    });

    canvas.on("mouse:down:before",()=>{
      if(state.tool==="marquee") state.selectionBase=canvas.getActiveObjects().filter(object=>!isHelper(object));
    });

    canvas.on("mouse:down",event=>{
      const e=event.e;
      const point=canvas.getScenePoint(e);
      if(state.tool==="marquee"&&pixelSelectionEnabled()){
        startPixelMarquee(point);
      }else if(state.tool==="hand"){
        state.isPanning=true;state.lastPointer={x:e.clientX,y:e.clientY};canvas.defaultCursor="grabbing";
      }else if(state.tool==="zoom"){
        setZoom(state.viewScale*(e.altKey?.85:1.15));
      }else if(state.tool==="text"&&!event.target){
        addTextAt(point.x,point.y);setTool("move");
      }else if((state.tool==="rect"||state.tool==="ellipse")&&!event.target){
        beginShape(state.tool,point);
      }else if(state.tool==="line"&&!event.target){
        beginLine(point);
      }else if(state.tool==="pen"&&!event.target){
        beginPen(point);
      }else if(state.tool==="lasso"){
        startLasso(point);
      }else if(state.tool==="wand"){
        magicWandAt(point);
      }else if(state.tool==="eyedropper"){
        eyedropAt(point);
      }else if(state.tool==="fill"){
        fillTarget(event.target,point);
      }
    });

    canvas.on("mouse:move",event=>{
      const e=event.e;const point=canvas.getScenePoint(e);
      if(state.tool==="marquee"&&pixelSelectionEnabled()&&state.marqueeHelper){
        updatePixelMarquee(point);
      }else if(state.isPanning&&state.lastPointer){
        state.panX+=e.clientX-state.lastPointer.x;state.panY+=e.clientY-state.lastPointer.y;
        state.lastPointer={x:e.clientX,y:e.clientY};applyViewTransform();
      }else if(state.tool==="lasso"&&state.lassoHelper){
        updateLasso(point);
      }else if(state.tool==="line"&&state.lineHelper){
        updateLine(point);
      }else if((state.tool==="rect"||state.tool==="ellipse")&&state.shapeHelper){
        updateShape(point,!!e.shiftKey);
      }
    });

    canvas.on("mouse:dblclick",()=>{
      if(state.tool==="pen")finishPen(false);
    });

    canvas.on("mouse:up",event=>{
      if(state.isPanning){state.isPanning=false;state.lastPointer=null;canvas.defaultCursor="grab"}
      if(state.tool==="marquee"&&pixelSelectionEnabled()&&state.marqueeHelper)finishPixelMarquee();
      if(state.tool==="lasso"&&state.lassoHelper)finishLasso();
      if(state.tool==="line"&&state.lineHelper){
        const point=canvas.getScenePoint(event.e);
        const distance=state.lineStart?Math.hypot(point.x-state.lineStart.x,point.y-state.lineStart.y):0;
        if(distance>2)finishLine(point);
        else{canvas.remove(state.lineHelper);state.lineHelper=null;state.lineStart=null}
      }
      if((state.tool==="rect"||state.tool==="ellipse")&&state.shapeHelper)finishShape();
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
      const mediaArt=event.dataTransfer.getData("application/x-skooma-media-art");
      if(mediaArt){
        try{
          const art=JSON.parse(mediaArt);
          let src=art.url;
          try{
            const response=await fetch(art.url);
            if(response.ok){
              const blob=await response.blob();
              src=await fileToDataUrl(new File([blob],"media-art",{type:blob.type||"image/png"}));
            }
          }catch{}
          const asset=await APP.addAsset({name:(art.title||"Media")+" · "+(art.kind||"image"),src,source:art.source||"media",kind:art.kind||"image",meta:art.meta||{}});
          await addImageFromUrl(asset.src,asset.name,asset);
        }catch(error){console.error(error)}
        return;
      }
      const file=event.dataTransfer.files?.[0];if(file)await importFile(file);
    });

    document.addEventListener("paste",async event=>{
      if($("editorSelect").value!=="skooma")return;
      const item=[...(event.clipboardData?.items||[])].find(entry=>entry.type.startsWith("image/"));
      if(!item)return;const file=item.getAsFile();if(file)await importFile(file);
    });

    qsa(".tool-button[data-tool]").forEach(btn=>btn.onclick=()=>setTool(btn.dataset.tool));
    ["brushSize","brushHardness","brushOpacity","brushFlow","brushColor"].forEach(id=>$(id).oninput=()=>{if(["brush","pencil","eraser"].includes(state.tool))setTool(state.tool,true)});
    $("ctxLockRatio").onchange=()=>{
      const active=canvas.getActiveObject();
      if(!active||active instanceof F.ActiveSelection)return;
      active.__skoomaLockRatio=$("ctxLockRatio").checked;
      active.setControlsVisibility({
        ml:!active.__skoomaLockRatio,mr:!active.__skoomaLockRatio,
        mt:!active.__skoomaLockRatio,mb:!active.__skoomaLockRatio,
        tl:true,tr:true,bl:true,br:true,mtr:true
      });
      canvas.requestRenderAll();
    };

    $("selectAllBtn").onclick=selectAll;$("clearSelectionBtn").onclick=clearSelection;
    $("selectionToLayerBtn").onclick=pixelSelectionToLayer;
    $("selectionMaskBtn").onclick=()=>applyPixelClip(false);
    $("selectionDeletePixelsBtn").onclick=()=>applyPixelClip(true);
    $("selectionTargetMode").onchange=()=>{
      const target=activeImageLayer()||state.pixelSelectionTarget;
      clearPixelSelection();
      state.pixelSelectionTarget=$("selectionTargetMode").value==="pixels"?target:null;
      canvas.discardActiveObject();canvas.requestRenderAll();
      if(["marquee","lasso"].includes(state.tool))setTool(state.tool,true);
      syncSelectionUi();
    };
    $("wandToLayerBtn").onclick=wandToLayer;$("wandMaskBtn").onclick=wandToMask;
    $("wandCancelBtn").onclick=()=>{clearWand();canvas.requestRenderAll()};
    $("cropApplyBtn").onclick=applyCrop;$("cropCancelBtn").onclick=cancelCrop;$("cropRatio").onchange=updateCropRatio;
    $("cropWidth").onchange=setCropDimensions;$("cropHeight").onchange=setCropDimensions;

    $("generateAiBtn").onclick=()=>generateAi(false);$("replaceWithAiBtn").onclick=()=>generateAi(true);
    $("generateVariationsBtn").onclick=generateVariations;
    $("downloadAiBtn").onclick=()=>{if(!state.lastAiSrc)return;const a=document.createElement("a");a.href=state.lastAiSrc;a.download="skooma-ai.png";a.click()};
    $("aiReference").onchange=async event=>{
      const file=event.target.files?.[0];state.aiReference=file?await fileToDataUrl(file):null;
    };
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
    $("filterInvertBtn").onclick=()=>toggleImageFilter("invert");
    $("filterSharpenBtn").onclick=()=>toggleImageFilter("sharpen");
    $("filterResetBtn").onclick=resetImageFilters;
    $("removeMaskBtn").onclick=()=>{
      const active=canvas.getActiveObject();
      if(!active||!active.clipPath)return;
      active.clipPath=undefined;active.dirty=true;canvas.requestRenderAll();
      snapshotLabel("Layer mask removed");renderProperties();
    };

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
      if(!typing&&event.key==="Delete"){
        event.preventDefault();
        if(state.pixelSelection&&state.pixelSelectionTarget){applyPixelClip(true)}
        else deleteActive();
        return
      }
      if(event.key==="Escape"){clearToolHelpers();setTool("move");return}
      if(event.key==="Enter"&&state.tool==="crop"){applyCrop();return}
      if(event.key==="Enter"&&state.tool==="pen"){finishPen(false);return}
      if(typing)return;
      const key=event.key.toLowerCase();
      const map={v:"move",m:"marquee",l:"lasso",w:"wand",c:"crop",b:"brush",p:"pencil",e:"eraser",g:"fill",i:"eyedropper",t:"text",r:"rect",o:"ellipse",n:"line",a:"pen",q:"node",j:"image",h:"hand",z:"zoom"};
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
    canvas,fitToViewport,setTool,addImageFromUrl,setBackgroundFromUrl,importFile,fileToDataUrl,newDocument,saveNow,saveManualProject,loadProjectById,
    exportImage,exportProjectJson,importProjectJson,undo,redo
  };
})();