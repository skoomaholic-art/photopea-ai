(() => {
  const $ = id => document.getElementById(id);
  const F = window.fabric;
  const MASTER_W = 800;
  const MASTER_H = 1400;
  const DEFAULTS = () => window.ImageFilters?.cloneDefaults?.() || {
    brightness:0, contrast:0, exposure:0, saturation:0, temperature:0, tint:0,
    highlights:0, shadows:0, whites:0, blacks:0, hue:0, blur:0,
    sharpen:0, grain:0, vignette:0
  };
  const TOP10_NUMBER_ASSETS = Object.freeze({
    "1":"assets/top10/numbers/1.svg","2":"assets/top10/numbers/2.svg","3":"assets/top10/numbers/3.svg",
    "4":"assets/top10/numbers/4.svg","5":"assets/top10/numbers/5.svg","6":"assets/top10/numbers/6.svg",
    "7":"assets/top10/numbers/7.svg","8":"assets/top10/numbers/8.svg","9":"assets/top10/numbers/9.svg",
    "10":"assets/top10/numbers/10.svg"
  });
  const NUMBER_X = 400;
  const NUMBER_Y = 1150;
  const NUMBER_SIZE = 500;
  let numberLoadToken = 0;

  if (!F) {
    console.error("Fabric.js failed to load for TOP10.");
    const status = $("top10Status");
    if (status) {
      status.textContent = "Fabric.js не загрузился.";
      status.className = "status-line error";
    }
    return;
  }

  const canvas = new F.Canvas("top10Canvas", {
    preserveObjectStacking: true,
    enableRetinaScaling: false,
    selection: false,
    backgroundColor: "#050505"
  });

  const freshState = () => ({
    background:null, backgroundOriginal:null, backgroundName:"", backgroundAssetId:null,
    backgroundX:400, backgroundY:700, backgroundScale:100, backgroundRotation:0, backgroundFilters:DEFAULTS(),
    logo:null, logoName:"", logoAssetId:null,
    logoX:400, logoY:895, logoScale:100, logoRotation:0, logoAboveDarkening:true,
    numberX:NUMBER_X,numberY:NUMBER_Y,numberScale:100,numberRotation:0,numberLocked:true,
    darkeningX:400,darkeningY:700,darkeningScale:100,darkeningRotation:0,darkeningLocked:true,canvasBackground:"#050505",
    ranking:"2", numberAsset:TOP10_NUMBER_ASSETS["2"],
    darkeningColor:"#000000", darkeningIntensity:94, darkeningStart:58,
    photopeaMasterId:null, photopeaComposite:false
  });

  let data=freshState();
  const objects={background:null,logo:null,darkening:null,number:null};
  const runtime={selectedLayer:"background",displayZoom:1,autosaveTimer:null,filterPreviewToken:0,numberMetrics:null};

  function setStatus(message,kind=""){
    $("top10Status").textContent=message;
    $("top10Status").className="status-line "+kind;
  }
  const clone=value=>JSON.parse(JSON.stringify(value));

  function readFile(file){
    return new Promise((resolve,reject)=>{
      if(!file?.type?.startsWith("image/")) return reject(new Error("Выберите изображение."));
      const reader=new FileReader();
      reader.onload=()=>resolve(reader.result);
      reader.onerror=()=>reject(reader.error||new Error("Не удалось прочитать изображение."));
      reader.readAsDataURL(file);
    });
  }

  function imageFromSource(src){
    return new Promise((resolve,reject)=>{
      const image=new Image();
      image.crossOrigin="anonymous";
      image.onload=()=>resolve(image);
      image.onerror=()=>reject(new Error("Не удалось загрузить изображение."));
      image.src=src;
    });
  }

  const sourceSize=source=>({
    width:source.naturalWidth||source.videoWidth||source.width||1,
    height:source.naturalHeight||source.videoHeight||source.height||1
  });

  function hexRgb(hex){
    const value=String(hex||"#000000").replace("#","");
    const normalized=value.length===3?value.split("").map(x=>x+x).join(""):value.padEnd(6,"0").slice(0,6);
    return {r:parseInt(normalized.slice(0,2),16)||0,g:parseInt(normalized.slice(2,4),16)||0,b:parseInt(normalized.slice(4,6),16)||0};
  }

  function rgba(hex,alpha){
    const c=hexRgb(hex);
    return `rgba(${c.r},${c.g},${c.b},${Math.max(0,Math.min(1,alpha))})`;
  }

  const backgroundBaseScale=(w,h)=>Math.max(MASTER_W/w,MASTER_H/h);
  const logoBaseScale=(w,h)=>Math.min(540/w,240/h);

  function decorateEditable(obj,kind){
    obj.top10Kind=kind;
    obj.set({
      originX:"center",originY:"center",transparentCorners:false,
      cornerColor:"#8cf06b",cornerStrokeColor:"#ffffff",borderColor:"#8cf06b",
      cornerStyle:"circle",lockUniScaling:true,lockScalingFlip:true,padding:1
    });
    obj.setControlsVisibility({mt:false,mb:false,ml:false,mr:false});
    return obj;
  }

  function lockedObject(obj,kind){
    obj.top10Kind=kind;
    obj.set({
      selectable:false,evented:false,
      lockMovementX:true,lockMovementY:true,lockScalingX:true,lockScalingY:true,lockRotation:true,
      hasControls:false,hasBorders:false
    });
    return obj;
  }

  function drawDarkening(ctx){
    const start=Math.max(0,Math.min(1,Number(data.darkeningStart||0)/100));
    const intensity=Math.max(0,Math.min(1,Number(data.darkeningIntensity||0)/100));
    const middle=start+(1-start)*.54;
    const strong=start+(1-start)*.82;
    const gradient=ctx.createLinearGradient(0,0,0,MASTER_H);
    gradient.addColorStop(0,rgba(data.darkeningColor,0));
    gradient.addColorStop(start,rgba(data.darkeningColor,0));
    gradient.addColorStop(middle,rgba(data.darkeningColor,intensity*.34));
    gradient.addColorStop(strong,rgba(data.darkeningColor,intensity*.72));
    gradient.addColorStop(1,rgba(data.darkeningColor,intensity));
    ctx.save();ctx.translate(data.darkeningX,data.darkeningY);ctx.rotate(data.darkeningRotation*Math.PI/180);ctx.scale(data.darkeningScale/100,data.darkeningScale/100);
    // Construct in layer coordinates so moving/rotating the layer moves its gradient too.
    const local=ctx.createLinearGradient(0,-MASTER_H/2,0,MASTER_H/2);
    local.addColorStop(0,rgba(data.darkeningColor,0));local.addColorStop(start,rgba(data.darkeningColor,0));local.addColorStop(middle,rgba(data.darkeningColor,intensity*.34));local.addColorStop(strong,rgba(data.darkeningColor,intensity*.72));local.addColorStop(1,rgba(data.darkeningColor,intensity));
    ctx.fillStyle=local;ctx.fillRect(-MASTER_W/2,-MASTER_H/2,MASTER_W,MASTER_H);ctx.restore();
  }

  function refreshDarkening(){
    if(objects.darkening){ canvas.remove(objects.darkening); objects.darkening=null; }
    if(data.photopeaComposite){ applyStacking(); return; }
    const start=Math.max(0,Math.min(1,Number(data.darkeningStart||0)/100));
    const intensity=Math.max(0,Math.min(1,Number(data.darkeningIntensity||0)/100));
    const middle=start+(1-start)*.54;
    const strong=start+(1-start)*.82;
    const gradient=new F.Gradient({
      type:"linear",coords:{x1:0,y1:0,x2:0,y2:MASTER_H},
      colorStops:[
        {offset:0,color:rgba(data.darkeningColor,0)},
        {offset:start,color:rgba(data.darkeningColor,0)},
        {offset:middle,color:rgba(data.darkeningColor,intensity*.34)},
        {offset:strong,color:rgba(data.darkeningColor,intensity*.72)},
        {offset:1,color:rgba(data.darkeningColor,intensity)}
      ]
    });
    objects.darkening=lockedObject(new F.Rect({
      left:0,top:0,originX:"left",originY:"top",width:MASTER_W,height:MASTER_H,fill:gradient,strokeWidth:0
    }),"darkening");
    objects.darkening.set({left:data.darkeningX,top:data.darkeningY,originX:"center",originY:"center",angle:data.darkeningRotation,scaleX:data.darkeningScale/100,scaleY:data.darkeningScale/100});
    objects.darkening.top10BaseScale=1;
    applyLock("darkening");canvas.add(objects.darkening);
    applyStacking();
  }

  function applyLock(layer) {
    const obj=objects[layer];if(!obj)return;
    const locked=!!data[layer+"Locked"];
    obj.set({selectable:!locked,evented:!locked,hasControls:!locked,lockMovementX:locked,lockMovementY:locked,lockScalingX:locked,lockScalingY:locked,lockRotation:locked});
    obj.setCoords();canvas.requestRenderAll();
  }

  function currentNumberAsset() {
    return TOP10_NUMBER_ASSETS[String(data.ranking || "2")] || TOP10_NUMBER_ASSETS["2"];
  }

  async function refreshNumber(){
    const token=++numberLoadToken;
    if(objects.number){ canvas.remove(objects.number); objects.number=null; }
    if(data.photopeaComposite){ runtime.numberMetrics=null; applyStacking(); return; }
    const asset=currentNumberAsset();
    data.numberAsset=asset;
    const url=new URL(asset,document.baseURI).href;
    const image=await F.FabricImage.fromURL(url);
    if(token!==numberLoadToken) return;
    objects.number=lockedObject(image,"number");
    objects.number.set({
      left:data.numberX,top:data.numberY,angle:data.numberRotation,originX:"center",originY:"center",
      scaleX:NUMBER_SIZE/(image.width||500)*data.numberScale/100,scaleY:NUMBER_SIZE/(image.height||500)*data.numberScale/100,
      objectCaching:false
    });
    objects.number.top10BaseScale=NUMBER_SIZE/(image.width||500);
    applyLock("number");
    objects.number.numberAsset=asset;
    objects.number.numberValue=String(data.ranking);
    runtime.numberMetrics={left:NUMBER_X-NUMBER_SIZE/2,top:NUMBER_Y-NUMBER_SIZE/2,width:NUMBER_SIZE,height:NUMBER_SIZE,bottom:NUMBER_Y+NUMBER_SIZE/2,asset};
    canvas.add(objects.number);
    applyStacking();
  }

  async function drawNumberAsset(ctx){
    const asset=currentNumberAsset();
    data.numberAsset=asset;
    const image=await imageFromSource(new URL(asset,document.baseURI).href);
    EditorCore.draw(ctx,image,{x:data.numberX,y:data.numberY,w:NUMBER_SIZE*data.numberScale/100,h:NUMBER_SIZE*data.numberScale/100,rotation:data.numberRotation});
  }

  function applyStacking(){
    data.logoAboveDarkening=true;
    const ordered=[objects.background,objects.darkening,objects.logo,objects.number];
    ordered.filter(Boolean).forEach((obj,index)=>canvas.moveObjectTo(obj,index));
    canvas.requestRenderAll();
    renderLayers();
  }

  function makeBackgroundObject(source){
    const size=sourceSize(source);
    const base=backgroundBaseScale(size.width,size.height);
    const obj=decorateEditable(new F.FabricImage(source,{
      left:data.backgroundX,top:data.backgroundY,
      scaleX:base*data.backgroundScale/100,scaleY:base*data.backgroundScale/100,
      angle:data.backgroundRotation,objectCaching:false
    }),"background");
    obj.top10BaseScale=base;
    return obj;
  }

  function makeLogoObject(source){
    const size=sourceSize(source);
    const base=logoBaseScale(size.width,size.height);
    const obj=decorateEditable(new F.FabricImage(source,{
      left:data.logoX,top:data.logoY,
      scaleX:base*data.logoScale/100,scaleY:base*data.logoScale/100,
      angle:data.logoRotation,objectCaching:false
    }),"logo");
    obj.top10BaseScale=base;
    return obj;
  }

  function replaceBackgroundElement(source){
    if(objects.background) canvas.remove(objects.background);
    objects.background=makeBackgroundObject(source);
    canvas.add(objects.background);
    applyStacking();
    if(runtime.selectedLayer==="background") canvas.setActiveObject(objects.background);
    canvas.requestRenderAll();
  }

  async function renderBackgroundVisual(src=data.background){
    if(!src){
      if(objects.background){canvas.remove(objects.background);objects.background=null;applyStacking();}
      renderLayers();syncControls();return;
    }
    replaceBackgroundElement(await imageFromSource(src));
    renderLayers();syncControls();
  }

  async function renderLogoVisual(src=data.logo){
    if(objects.logo){canvas.remove(objects.logo);objects.logo=null;}
    if(src){
      objects.logo=makeLogoObject(await imageFromSource(src));
      canvas.add(objects.logo);
    }
    applyStacking();
    if(runtime.selectedLayer==="logo"&&objects.logo) canvas.setActiveObject(objects.logo);
    renderLayers();syncControls();
  }

  function resizeDisplay(){
    const view=$("top10CanvasView");
    if(!view) return;
    const availableW=Math.max(300,view.clientWidth-30);
    const availableH=Math.max(420,Math.min(window.innerHeight-155,940));
    const scale=Math.min(1,availableW/MASTER_W,availableH/MASTER_H);
    const displayW=Math.round(MASTER_W*scale),displayH=Math.round(MASTER_H*scale);
    runtime.displayZoom=scale;
    if(canvas.getWidth()!==MASTER_W||canvas.getHeight()!==MASTER_H) canvas.setDimensions({width:MASTER_W,height:MASTER_H});
    canvas.setViewportTransform([1,0,0,1,0,0]);
    canvas.setDimensions({width:displayW,height:displayH},{cssOnly:true});
    const shell=$("top10CanvasShell");
    shell.style.width=displayW+"px";shell.style.height=displayH+"px";
    canvas.requestRenderAll();
  }

  function selectLayer(layer){
    if(!["background","logo","darkening","number"].includes(layer)) return;
    runtime.selectedLayer=layer;
    const target=objects[layer] && !data[layer+"Locked"]?objects[layer]:null;
    const active=canvas.getActiveObject();
    if(target){
      if(active!==target) canvas.setActiveObject(target);
    }else if(active){
      canvas.discardActiveObject();
    }
    canvas.requestRenderAll();renderLayers();syncControls();
  }

  function syncLayerFromFabricSelection(event){
    const kind=event?.selected?.[0]?.top10Kind;
    if(!objects[kind]) return;
    runtime.selectedLayer=kind;
    renderLayers();
    syncControls();
  }

  function renderLayers(){
    const root=$("top10Layers");
    if(!root) return;
    root.innerHTML="";
    const order=data.photopeaComposite?["background","canvasBackground"]:["number","logo","darkening","background","canvasBackground"];
    const labels={number:"TOP10 Number",logo:"Logo",darkening:"Bottom Darkening",background:data.photopeaComposite?"Photopea Result":"Background Image",canvasBackground:"Canvas Background"};
    for(const layer of order){
      const row=document.createElement("button");
      row.type="button";
      row.className="top10-layer-row"+(runtime.selectedLayer===layer?" active":"");
      if((layer==="background"&&!data.background)||(layer==="logo"&&!data.logo)) row.classList.add("empty");
      const title=document.createElement("span");title.textContent=labels[layer];
      const lock=document.createElement("b");lock.textContent=data[layer+"Locked"]?"🔒":"";
      row.append(title,lock);row.addEventListener("click",()=>selectLayer(layer));root.appendChild(row);
    }
  }

  function syncControls(){
    document.querySelectorAll("[data-top10-controls]").forEach(section=>{
      section.hidden=section.dataset.top10Always==null && section.dataset.top10Controls!==runtime.selectedLayer;
    });
    $("top10BgScale").value=String(Math.round(data.backgroundScale));
    $("top10BgRotation").value=String(Math.round(data.backgroundRotation));
    $("top10LogoScale").value=String(Math.round(data.logoScale));
    $("top10LogoRotation").value=String(Math.round(data.logoRotation));
    $("top10PositionSelect").value=String(data.ranking);
    $("top10DarkColor").value=data.darkeningColor;
    $("top10DarkIntensity").value=String(data.darkeningIntensity);
    $("top10DarkStart").value=String(data.darkeningStart);
    const hasBg=!!data.background,hasLogo=!!data.logo;
    ["top10BgScale","top10BgRotation","top10BgCenter","top10BgReset","top10FilterBtn"].forEach(id=>{$(id).disabled=!hasBg;});
    ["top10LogoScale","top10LogoRotation","top10LogoCenter","top10LogoReset","top10LogoUp","top10LogoDown"].forEach(id=>{$(id).disabled=!hasLogo;});
    $("removeTop10LogoBtn").disabled=!hasLogo;
    $("top10LogoDown").disabled=true;$("top10LogoUp").disabled=true;
    $("top10NumberScale").value=String(data.numberScale);$("top10NumberRotation").value=String(data.numberRotation);
    for(const id of ["top10NumberScale","top10NumberRotation","top10NumberCenter","top10NumberReset"]) $(id).disabled=data.numberLocked;
    for(const layer of ["number","darkening"]){$("top10"+layer+"Lock").checked=data[layer+"Locked"];$("top10"+layer+"LockLabel").textContent=data[layer+"Locked"]?"Заблокирован":"Открыт";}
    $("top10CanvasBackground").value=data.canvasBackground;
  }

  function updateObjectTransform(layer){
    const obj=objects[layer];if(!obj) return;
    const prefix=layer;
    const base=obj.top10BaseScale||1;
    obj.set({
      left:data[prefix+"X"],top:data[prefix+"Y"],angle:data[prefix+"Rotation"],
      scaleX:base*data[prefix+"Scale"]/100,scaleY:base*data[prefix+"Scale"]/100
    });
    obj.setCoords();canvas.requestRenderAll();
    if(layer==="number") runtime.numberMetrics={...obj.getBoundingRect(),bottom:obj.getBoundingRect().top+obj.getBoundingRect().height,asset:data.numberAsset};
  }

  function updateStateFromObject(obj){
    const layer=obj?.top10Kind;
    if(!objects[layer] || data[layer+"Locked"]) return;
    const base=obj.top10BaseScale||1;
    data[layer+"X"]=obj.left;data[layer+"Y"]=obj.top;data[layer+"Rotation"]=obj.angle||0;
    data[layer+"Scale"]=Math.max(5,Math.min(500,(obj.scaleX||base)/base*100));
    if(layer==="number") runtime.numberMetrics={...obj.getBoundingRect(),bottom:obj.getBoundingRect().top+obj.getBoundingRect().height,asset:data.numberAsset};
    syncControls();scheduleAutosave();
  }

  function centerLayer(layer){
    if(data[layer+"Locked"]) return;
    if(layer==="number"){data.numberX=MASTER_W/2;data.numberY=MASTER_H/2;}
    if(layer==="background"){data.backgroundX=400;data.backgroundY=700;}
    else if(layer==="logo"){data.logoX=400;data.logoY=895;}
    updateObjectTransform(layer);scheduleAutosave();
  }

  function resetLayer(layer){
    if(data[layer+"Locked"]) return;
    if(layer==="number"){data.numberX=NUMBER_X;data.numberY=NUMBER_Y;data.numberScale=100;data.numberRotation=0;}
    if(layer==="background"){
      data.backgroundX=400;data.backgroundY=700;data.backgroundScale=100;data.backgroundRotation=0;
    }else if(layer==="logo"){
      data.logoX=400;data.logoY=895;data.logoScale=100;data.logoRotation=0;
    }
    updateObjectTransform(layer);syncControls();scheduleAutosave();
  }

  async function applyPhotopeaComposite(src,name="Photopea result",options={}){
    data={...freshState(),
      background:src,backgroundOriginal:src,backgroundName:name,
      backgroundAssetId:options.assetId||null,
      backgroundX:400,backgroundY:700,backgroundScale:100,backgroundRotation:0,
      photopeaMasterId:options.masterId||null,photopeaComposite:true
    };
    if(objects.logo){canvas.remove(objects.logo);objects.logo=null;}
    if(objects.darkening){canvas.remove(objects.darkening);objects.darkening=null;}
    if(objects.number){canvas.remove(objects.number);objects.number=null;}
    await renderBackgroundVisual(src);
    runtime.selectedLayer="background";
    canvas.discardActiveObject();
    applyStacking();
    syncControls();
    scheduleAutosave(false);
    setStatus("Результат Photopea возвращён без дублирования слоёв.","ok");
  }

  function getPhotopeaMasterId(){return data.photopeaMasterId||null;}

  async function leavePhotopeaComposite(){
    if(!data.photopeaComposite) return;
    data.photopeaComposite=false;
    data.photopeaMasterId=null;
    refreshDarkening();
    await refreshNumber();
    applyStacking();
  }

  async function setBackgroundFromDataUrl(src,name="TOP10 image",options={}){
    data.photopeaComposite=false;
    data.photopeaMasterId=null;
    data.background=src;data.backgroundOriginal=options.original||src;data.backgroundName=name;
    data.backgroundAssetId=options.assetId||null;data.backgroundFilters={...DEFAULTS(),...(options.filters||{})};
    data.backgroundX=400;data.backgroundY=700;data.backgroundScale=100;data.backgroundRotation=0;
    await renderBackgroundVisual(src);selectLayer("background");scheduleAutosave();setStatus("Изображение добавлено.","ok");
  }

  function removeTop10Logo(){
    if(!data.logo) return;
    if(objects.logo){
      canvas.remove(objects.logo);
      objects.logo=null;
    }
    data.logo=null;
    data.logoName="";
    data.logoAssetId=null;
    data.logoX=400;
    data.logoY=895;
    data.logoScale=100;
    data.logoRotation=0;
    data.logoAboveDarkening=true;
    if(runtime.selectedLayer==="logo") runtime.selectedLayer="background";
    canvas.discardActiveObject();
    applyStacking();
    syncControls();
    scheduleAutosave();
    setStatus("Логотип удалён.","ok");
  }

  async function setLogoFromDataUrl(src,name="TOP10 logo",options={}){
    if(data.photopeaComposite){
      data.photopeaComposite=false;
      data.photopeaMasterId=null;
      refreshDarkening();
      await refreshNumber();
    }
    data.logo=src;data.logoName=name;data.logoAssetId=options.assetId||null;
    data.logoX=400;data.logoY=895;data.logoScale=100;data.logoRotation=0;
    await renderLogoVisual(src);selectLayer("logo");scheduleAutosave();setStatus("Логотип добавлен отдельным слоем.","ok");
  }

  async function openFilters(){
    if(!data.background) return setStatus("Сначала загрузите основное изображение.","error");
    if(!window.FilterStudio||!window.AssetManager) return setStatus("Модуль цветокора недоступен.","error");
    let asset=data.backgroundAssetId?await AssetManager.get(data.backgroundAssetId):null;
    if(!asset){
      asset=await AssetManager.fromDataUrl(data.backgroundOriginal||data.background,{
        source:"top10",sourceId:data.backgroundName||"top10-background",
        title:data.backgroundName||"TOP10 background",imageType:"poster"
      });
      data.backgroundAssetId=asset.id;
      if(Object.values(data.backgroundFilters||{}).some(Number)){
        const previewBlob=await ImageFilters.renderBlob(data.backgroundOriginal||data.background,data.backgroundFilters);
        asset=await AssetManager.updateEdited(asset.id,previewBlob,data.backgroundFilters);
      }
    }
    await FilterStudio.openAsset(asset,{
      layer:"top10-background",name:data.backgroundName||"TOP10 background",
      onPreview:async previewCanvas=>{
        const token=++runtime.filterPreviewToken;
        const copy=document.createElement("canvas");
        copy.width=previewCanvas.width;copy.height=previewCanvas.height;
        copy.getContext("2d").drawImage(previewCanvas,0,0);
        if(token!==runtime.filterPreviewToken) return;
        replaceBackgroundElement(copy);
      },
      onCancel:async()=>{runtime.filterPreviewToken++;await renderBackgroundVisual(data.background);},
      onApply:async(dataUrl,updated,settings)=>{
        runtime.filterPreviewToken++;data.background=dataUrl;data.backgroundAssetId=updated.id;
        data.backgroundFilters={...DEFAULTS(),...settings};
        if(!data.backgroundOriginal){
          try{data.backgroundOriginal=await AssetManager.dataUrl(updated,false);}catch{}
        }
        scheduleAutosave();
        setStatus("Цветокор применён только к BACKGROUND_IMAGE.","ok");
        renderBackgroundVisual(dataUrl).catch(error=>setStatus(error.message||"Не удалось обновить preview.","error"));
      }
    });
  }

  async function processedBackgroundForExport(){
    const src=data.backgroundOriginal||data.background;if(!src) return null;
    if(window.ImageFilters) return ImageFilters.renderToCanvas(src,data.backgroundFilters||DEFAULTS(),2800);
    return imageFromSource(data.background);
  }

  function drawTransformed(ctx,source,prefix,isBackground){
    const size=sourceSize(source);
    const base=isBackground?backgroundBaseScale(size.width,size.height):logoBaseScale(size.width,size.height);
    const scale=base*Number(data[prefix+"Scale"]||100)/100;
    ctx.save();ctx.translate(Number(data[prefix+"X"]),Number(data[prefix+"Y"]));
    ctx.rotate(Number(data[prefix+"Rotation"]||0)*Math.PI/180);ctx.scale(scale,scale);
    ctx.drawImage(source,-size.width/2,-size.height/2);ctx.restore();
  }

  function top10CanvasDataUrl(canvasEl){return canvasEl.toDataURL("image/png");}

  async function bestTop10Asset(assetId,fallback,filters=null){
    if(!assetId) return fallback;
    try{
      const asset=await AssetManager.get(assetId);
      if(!asset) return fallback;
      const filtered=filters&&Object.values(filters).some(value=>Number(value)!==0);
      return fallback || await AssetManager.dataUrl(asset,true);
    }catch{return fallback;}
  }

  async function darkeningDataUrl(){
    const c=document.createElement("canvas");c.width=MASTER_W;c.height=MASTER_H;
    const saved=[data.darkeningX,data.darkeningY,data.darkeningScale,data.darkeningRotation];
    try {data.darkeningX=400;data.darkeningY=700;data.darkeningScale=100;data.darkeningRotation=0;drawDarkening(c.getContext("2d"));}
    finally {[data.darkeningX,data.darkeningY,data.darkeningScale,data.darkeningRotation]=saved;}
    return top10CanvasDataUrl(c);
  }

  async function buildPhotopeaModel(){
    const layers=[{id:"top10-canvas-background",name:"Canvas Background",type:"background",color:data.canvasBackground,
      x:MASTER_W/2,y:MASTER_H/2,width:MASTER_W,height:MASTER_H,scaleX:1,scaleY:1,rotation:0,opacity:1,visible:true,locked:true,zIndex:0}];
    if(data.photopeaComposite && data.background){
      const source=await bestTop10Asset(data.backgroundAssetId,data.background,data.backgroundFilters);
      layers.push({id:"top10-photopea-result",name:"Photopea Result",type:"image",assetId:data.backgroundAssetId||null,sourceDataUrl:source,
        x:MASTER_W/2,y:MASTER_H/2,width:MASTER_W,height:MASTER_H,scaleX:1,scaleY:1,rotation:0,opacity:1,visible:true,locked:false,zIndex:1});
      return {version:1,workspace:"top10",document:{name:"TOP10",width:MASTER_W,height:MASTER_H,background:"#050505"},layers};
    }
    let backgroundLayer=null,logoLayer=null;
    if(data.background){
      const source=await bestTop10Asset(data.backgroundAssetId,data.background,data.backgroundFilters);
      const image=await imageFromSource(source),size=sourceSize(image),base=backgroundBaseScale(size.width,size.height)*Number(data.backgroundScale||100)/100;
      backgroundLayer={id:"top10-background",name:"Background Image",
        type:"image",assetId:data.backgroundAssetId||null,sourceDataUrl:source,originalDataUrl:data.backgroundOriginal||source,
        x:Number(data.backgroundX),y:Number(data.backgroundY),width:size.width*base,height:size.height*base,scaleX:1,scaleY:1,
        rotation:Number(data.backgroundRotation||0),opacity:1,visible:true,locked:false};
    }
    const darkeningLayer={id:"top10-darkening",name:"Bottom Darkening",type:"gradient",sourceDataUrl:await darkeningDataUrl(),
      x:data.darkeningX,y:data.darkeningY,width:MASTER_W*data.darkeningScale/100,height:MASTER_H*data.darkeningScale/100,scaleX:1,scaleY:1,rotation:data.darkeningRotation,opacity:1,visible:true,locked:data.darkeningLocked,
      gradient:{color:data.darkeningColor,intensity:data.darkeningIntensity,start:data.darkeningStart},originalTransform:{x:data.darkeningX,y:data.darkeningY,scale:data.darkeningScale,rotation:data.darkeningRotation}};
    if(data.logo){
      const source=await bestTop10Asset(data.logoAssetId,data.logo,null),image=await imageFromSource(source),size=sourceSize(image);
      const base=logoBaseScale(size.width,size.height)*Number(data.logoScale||100)/100;
      logoLayer={id:"top10-logo",name:"Logo",type:"image",assetId:data.logoAssetId||null,sourceDataUrl:source,
        x:Number(data.logoX),y:Number(data.logoY),width:size.width*base,height:size.height*base,scaleX:1,scaleY:1,
        rotation:Number(data.logoRotation||0),opacity:1,visible:true,locked:false};
    }
    const numberLayer={id:"top10-number",name:"TOP10 Number",type:"image",sourceDataUrl:await AssetManager.blobToDataUrl(await (await fetch(new URL(currentNumberAsset(),document.baseURI).href)).blob()),
      x:data.numberX,y:data.numberY,width:NUMBER_SIZE*data.numberScale/100,height:NUMBER_SIZE*data.numberScale/100,scaleX:1,scaleY:1,rotation:data.numberRotation,opacity:1,visible:true,locked:data.numberLocked,
      value:String(data.ranking),asset:data.numberAsset||currentNumberAsset()};
    const blank=document.createElement("canvas");blank.width=MASTER_W;blank.height=MASTER_H;
    const empty=(id,name)=>({id,name,type:"image",sourceDataUrl:blank.toDataURL("image/png"),x:400,y:700,width:800,height:1400,opacity:1,visible:true,locked:false});
    const ordered=[backgroundLayer||empty("top10-background","Background Image"),darkeningLayer,logoLayer||empty("top10-logo","Logo"),numberLayer];
    for(const layer of ordered.filter(Boolean)){layer.zIndex=layers.length;layers.push(layer);}
    return {version:1,workspace:"top10",document:{name:"TOP10",width:MASTER_W,height:MASTER_H,background:"#050505"},layers};
  }

  async function renderCanvas(){
    const out=document.createElement("canvas");out.width=MASTER_W;out.height=MASTER_H;
    const ctx=out.getContext("2d");ctx.fillStyle=data.canvasBackground;ctx.fillRect(0,0,MASTER_W,MASTER_H);
    const background=await processedBackgroundForExport();
    if(background) drawTransformed(ctx,background,"background",true);
    if(data.photopeaComposite) return out;
    const logo=data.logo?await imageFromSource(data.logo):null;
    if(!data.logoAboveDarkening&&logo) drawTransformed(ctx,logo,"logo",false);
    drawDarkening(ctx);
    if(data.logoAboveDarkening&&logo) drawTransformed(ctx,logo,"logo",false);
    await drawNumberAsset(ctx);
    return out;
  }

  async function renderBlob(){
    const out=await renderCanvas();
    return new Promise((resolve,reject)=>out.toBlob(blob=>blob?resolve(blob):reject(new Error("Не удалось экспортировать ТОП10.")),"image/png"));
  }

  async function download(){
    setStatus("Готовлю PNG 800 × 1400...");
    try{
      PosterApp.downloadBlob(await renderBlob(),"top10.png");
      await window.WorkArchive?.captureWorkspace?.("top10","download-top10");
      setStatus("ТОП10 экспортирован: 800 × 1400 PNG. Архивная версия сохранена.","ok");
    }catch(error){setStatus(error.message||"Ошибка экспорта.","error");}
  }

  function scheduleAutosave(markDirty=true){
    if(markDirty && data.photopeaMasterId) data.photopeaMasterId=null;
    clearTimeout(runtime.autosaveTimer);
    runtime.autosaveTimer=setTimeout(async()=>{
      try{
        if(!window.SkoomaStore||!window.PosterApp) return;
        const project=PosterApp.serialize();project.id="poster-editor-autosave";
        await SkoomaStore.saveProject(project);
      }catch(error){console.warn("TOP10 autosave failed",error);}
    },650);
  }

  function serialize(){return {version:1,...clone(data)};}

  async function resetClassic(){
    await restore(null);
    scheduleAutosave();
    setStatus("ТОП10 сброшен до классического стиля.","ok");
  }

  async function restore(saved){
    data={...freshState(),...(saved||{})};
    data.backgroundFilters={...DEFAULTS(),...(saved?.backgroundFilters||{})};
    data.logoAboveDarkening=true;canvas.backgroundColor=data.canvasBackground;
    if(objects.background){canvas.remove(objects.background);objects.background=null;}
    if(objects.logo){canvas.remove(objects.logo);objects.logo=null;}
    refreshDarkening();await refreshNumber();
    if(data.background) await renderBackgroundVisual(data.background);
    if(data.logo) await renderLogoVisual(data.logo);
    selectLayer("background");syncControls();applyStacking();
    setStatus(saved?"ТОП10 восстановлен из проекта.":"Новый шаблон ТОП10 готов.","ok");
  }

  function inspect(){
    return {
      masterSize:{width:canvas.getWidth(),height:canvas.getHeight()},
      backingSize:{width:$("top10Canvas").width,height:$("top10Canvas").height},
      displayZoom:runtime.displayZoom,selectedLayer:runtime.selectedLayer,state:clone(data),
      darkening:{
        locked:data.darkeningLocked,left:objects.darkening?.left??0,top:objects.darkening?.top??0,
        selectable:objects.darkening?.selectable??false,evented:objects.darkening?.evented??false
      },
      number:{
        locked:data.numberLocked,left:objects.number?.left??0,top:objects.number?.top??0,
        selectable:objects.number?.selectable??false,evented:objects.number?.evented??false,
        asset:data.numberAsset||currentNumberAsset(),
        value:String(data.ranking),
        bounds:runtime.numberMetrics?{...runtime.numberMetrics}:null
      },
      layers:data.photopeaComposite?["PHOTOPEA_RESULT"]:(data.logoAboveDarkening
        ?["TOP_NUMBER","LOGO","BOTTOM_DARKENING","BACKGROUND_IMAGE"]
        :["TOP_NUMBER","BOTTOM_DARKENING","LOGO","BACKGROUND_IMAGE"])
    };
  }

  function activate(){requestAnimationFrame(()=>{resizeDisplay();canvas.requestRenderAll();});}

  canvas.on("object:modified",e=>updateStateFromObject(e.target));
  canvas.on("object:moving",e=>updateStateFromObject(e.target));
  canvas.on("object:scaling",e=>updateStateFromObject(e.target));
  canvas.on("object:rotating",e=>updateStateFromObject(e.target));
  canvas.on("selection:created",syncLayerFromFabricSelection);
  canvas.on("selection:updated",syncLayerFromFabricSelection);
  canvas.on("mouse:wheel",opt=>{
    const obj=canvas.getActiveObject(),layer=obj?.top10Kind;
    if(!objects[layer] || data[layer+"Locked"]) return;
    opt.e.preventDefault();opt.e.stopPropagation();
    const delta=opt.e.deltaY<0?4:-4,min=layer==="background"?25:10;
    data[layer+"Scale"]=Math.max(min,Math.min(500,data[layer+"Scale"]+delta));
    updateObjectTransform(layer);syncControls();scheduleAutosave();
  });

  $("top10BackgroundInput").addEventListener("change",async e=>{
    const file=e.target.files?.[0];
    try{
      if(file){
        const asset=window.AssetManager?await AssetManager.fromFile(file,{imageType:"poster",source:"top10"}):null;
        const src=asset?await AssetManager.dataUrl(asset,false):await readFile(file);
        await setBackgroundFromDataUrl(src,file.name,{assetId:asset?.id||null});
      }
    }catch(error){setStatus(error.message||"Не удалось загрузить изображение.","error");}
    finally{e.target.value="";}
  });

  $("removeTop10LogoBtn").addEventListener("click",removeTop10Logo);

  $("top10LogoInput").addEventListener("change",async e=>{
    const file=e.target.files?.[0];
    try{
      if(file){
        const asset=window.AssetManager?await AssetManager.fromFile(file,{imageType:"logo",source:"top10"}):null;
        const src=asset?await AssetManager.dataUrl(asset,false):await readFile(file);
        await setLogoFromDataUrl(src,file.name,{assetId:asset?.id||null});
      }
    }catch(error){setStatus(error.message||"Не удалось загрузить логотип.","error");}
    finally{e.target.value="";}
  });

  $("top10BgScale").addEventListener("input",e=>{
    data.backgroundScale=Math.max(25,Math.min(500,Number(e.target.value)||100));
    updateObjectTransform("background");scheduleAutosave();
  });
  $("top10BgRotation").addEventListener("input",e=>{
    data.backgroundRotation=Number(e.target.value)||0;updateObjectTransform("background");scheduleAutosave();
  });
  $("top10BgCenter").addEventListener("click",()=>centerLayer("background"));
  $("top10BgReset").addEventListener("click",()=>resetLayer("background"));
  $("top10FilterBtn").addEventListener("click",()=>openFilters().catch(error=>setStatus(error.message,"error")));

  $("top10LogoScale").addEventListener("input",e=>{
    data.logoScale=Math.max(10,Math.min(500,Number(e.target.value)||100));
    updateObjectTransform("logo");scheduleAutosave();
  });
  $("top10LogoRotation").addEventListener("input",e=>{
    data.logoRotation=Number(e.target.value)||0;updateObjectTransform("logo");scheduleAutosave();
  });
  $("top10LogoCenter").addEventListener("click",()=>centerLayer("logo"));
  $("top10LogoReset").addEventListener("click",()=>resetLayer("logo"));
  $("top10LogoUp").addEventListener("click",()=>{data.logoAboveDarkening=true;applyStacking();scheduleAutosave();});
  $("top10LogoDown").addEventListener("click",()=>setStatus("Порядок шаблона фиксирован: логотип над затемнением."));

  for(const layer of ["number","darkening"]) $("top10"+layer+"Lock").addEventListener("change",e=>{
    data[layer+"Locked"]=e.target.checked;applyLock(layer);selectLayer(layer);syncControls();scheduleAutosave();
  });
  $("top10NumberScale").addEventListener("input",e=>{if(data.numberLocked)return;data.numberScale=Math.max(10,Math.min(300,+e.target.value));updateObjectTransform("number");scheduleAutosave();});
  $("top10NumberRotation").addEventListener("input",e=>{if(data.numberLocked)return;data.numberRotation=+e.target.value;updateObjectTransform("number");scheduleAutosave();});
  $("top10NumberCenter").addEventListener("click",()=>centerLayer("number"));
  $("top10NumberReset").addEventListener("click",()=>resetLayer("number"));
  $("top10CanvasBackground").addEventListener("input",e=>{data.canvasBackground=e.target.value;canvas.backgroundColor=e.target.value;canvas.requestRenderAll();scheduleAutosave();});

  $("top10PositionSelect").addEventListener("change",async e=>{
    await leavePhotopeaComposite();
    data.ranking=String(e.target.value);
    data.numberAsset=currentNumberAsset();
    await refreshNumber();
    syncControls();
    scheduleAutosave();
  });

  $("top10DarkColor").addEventListener("input",async e=>{await leavePhotopeaComposite();data.darkeningColor=e.target.value;refreshDarkening();scheduleAutosave();});
  $("top10DarkIntensity").addEventListener("input",async e=>{await leavePhotopeaComposite();
    data.darkeningIntensity=Math.max(0,Math.min(100,Number(e.target.value)||0));refreshDarkening();scheduleAutosave();
  });
  $("top10DarkStart").addEventListener("input",async e=>{await leavePhotopeaComposite();
    data.darkeningStart=Math.max(0,Math.min(100,Number(e.target.value)||0));refreshDarkening();scheduleAutosave();
  });


  $("top10EditPhotopeaBtn").addEventListener("click",()=>{
    window.PhotopeaBridge?.editTop10?.().catch(error=>setStatus(error.message||"Photopea недоступен.","error"));
  });
  $("top10DownloadBtn").addEventListener("click",download);
  window.addEventListener("resize",()=>{if(!$("top10Workspace").hidden) resizeDisplay();});

  refreshDarkening();void refreshNumber();resizeDisplay();renderLayers();syncControls();

  window.Top10Editor={
    activate,serialize,restore,resetClassic,renderCanvas,renderBlob,buildPhotopeaModel,download,
    setBackgroundFromDataUrl,setLogoFromDataUrl,applyPhotopeaComposite,getPhotopeaMasterId,openFilters,inspect,
    getState:()=>clone(data),getSelectedLayer:()=>runtime.selectedLayer,
    numberAssets:TOP10_NUMBER_ASSETS,
    constants:{MASTER_W,MASTER_H}
  };

  if(window.__pendingTop10Project!==undefined){
    const pending=window.__pendingTop10Project;delete window.__pendingTop10Project;restore(pending);
  }
  window.dispatchEvent(new CustomEvent("top10-editor-ready"));
})();