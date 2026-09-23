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
    selection: false,
    backgroundColor: "#050505"
  });

  const freshState = () => ({
    background:null, backgroundOriginal:null, backgroundName:"", backgroundAssetId:null,
    backgroundX:400, backgroundY:700, backgroundScale:100, backgroundRotation:0, backgroundFilters:DEFAULTS(),
    logo:null, logoName:"", logoAssetId:null,
    logoX:400, logoY:895, logoScale:100, logoRotation:0, logoAboveDarkening:true,
    ranking:"2",
    darkeningColor:"#000000", darkeningIntensity:94, darkeningStart:58,
    numberFill:"#050505", numberStrokeStart:"#00ff33", numberStrokeEnd:"#0070ff", numberStrokeWidth:18
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
    const start=Math.max(0,Math.min(.96,Number(data.darkeningStart||0)/100));
    const intensity=Math.max(0,Math.min(1,Number(data.darkeningIntensity||0)/100));
    const middle=start+(1-start)*.54;
    const strong=start+(1-start)*.82;
    const gradient=ctx.createLinearGradient(0,0,0,MASTER_H);
    gradient.addColorStop(0,rgba(data.darkeningColor,0));
    gradient.addColorStop(start,rgba(data.darkeningColor,0));
    gradient.addColorStop(middle,rgba(data.darkeningColor,intensity*.34));
    gradient.addColorStop(strong,rgba(data.darkeningColor,intensity*.72));
    gradient.addColorStop(1,rgba(data.darkeningColor,intensity));
    ctx.fillStyle=gradient;
    ctx.fillRect(0,0,MASTER_W,MASTER_H);
  }

  function refreshDarkening(){
    if(objects.darkening) canvas.remove(objects.darkening);
    const start=Math.max(0,Math.min(.96,Number(data.darkeningStart||0)/100));
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
    canvas.add(objects.darkening);
    applyStacking();
  }

  function numberFontSize(value,ctx){
    let size=value==="10"?370:445;
    while(size>260){
      ctx.font=`900 ${size}px "Arial Black","Arial",sans-serif`;
      if(ctx.measureText(value).width+Number(data.numberStrokeWidth||0)*2<=630) break;
      size-=6;
    }
    return size;
  }

  function drawNumber(ctx){
    const value=String(data.ranking||"2");
    const fontSize=numberFontSize(value,ctx);
    const x=MASTER_W/2,baseline=1330;
    ctx.save();
    ctx.textAlign="center";ctx.textBaseline="alphabetic";
    ctx.font=`900 ${fontSize}px "Arial Black","Arial",sans-serif`;
    ctx.lineJoin="round";ctx.lineCap="round";ctx.miterLimit=2;
    const stroke=Math.max(1,Math.min(60,Number(data.numberStrokeWidth||18)));
    const gradient=ctx.createLinearGradient(160,1010,650,1370);
    gradient.addColorStop(0,data.numberStrokeStart||"#00ff33");
    gradient.addColorStop(.52,"#00d96f");
    gradient.addColorStop(1,data.numberStrokeEnd||"#0070ff");
    ctx.strokeStyle=gradient;ctx.lineWidth=stroke;ctx.fillStyle=data.numberFill||"#050505";
    ctx.strokeText(value,x,baseline);ctx.fillText(value,x,baseline);
    const metrics=ctx.measureText(value);
    const ascent=metrics.actualBoundingBoxAscent||fontSize*.77;
    const descent=metrics.actualBoundingBoxDescent||fontSize*.08;
    runtime.numberMetrics={
      left:x-metrics.width/2-stroke/2,top:baseline-ascent-stroke/2,
      width:metrics.width+stroke,height:ascent+descent+stroke,bottom:baseline+descent+stroke/2
    };
    ctx.restore();
  }

  function refreshNumber(){
    if(objects.number) canvas.remove(objects.number);
    const layer=document.createElement("canvas");
    layer.width=MASTER_W;layer.height=MASTER_H;
    drawNumber(layer.getContext("2d"));
    objects.number=lockedObject(new F.FabricImage(layer,{left:0,top:0,originX:"left",originY:"top",objectCaching:false}),"number");
    canvas.add(objects.number);
    applyStacking();
  }

  function applyStacking(){
    const ordered=data.logoAboveDarkening
      ?[objects.background,objects.darkening,objects.logo,objects.number]
      :[objects.background,objects.logo,objects.darkening,objects.number];
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
    const target=layer==="background"?objects.background:layer==="logo"?objects.logo:null;
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
    if(kind!=="background"&&kind!=="logo") return;
    runtime.selectedLayer=kind;
    renderLayers();
    syncControls();
  }

  function renderLayers(){
    const root=$("top10Layers");
    if(!root) return;
    root.innerHTML="";
    const order=data.logoAboveDarkening
      ?["number","logo","darkening","background"]
      :["number","darkening","logo","background"];
    const labels={number:"TOP_NUMBER",logo:"LOGO",darkening:"BOTTOM_DARKENING",background:"BACKGROUND_IMAGE"};
    for(const layer of order){
      const row=document.createElement("button");
      row.type="button";
      row.className="top10-layer-row"+(runtime.selectedLayer===layer?" active":"");
      if((layer==="background"&&!data.background)||(layer==="logo"&&!data.logo)) row.classList.add("empty");
      const title=document.createElement("span");title.textContent=labels[layer];
      const lock=document.createElement("b");lock.textContent=(layer==="number"||layer==="darkening")?"🔒":"";
      row.append(title,lock);row.addEventListener("click",()=>selectLayer(layer));root.appendChild(row);
    }
  }

  function syncControls(){
    document.querySelectorAll("[data-top10-controls]").forEach(section=>{
      section.hidden=section.dataset.top10Controls!==runtime.selectedLayer;
    });
    $("top10BgScale").value=String(Math.round(data.backgroundScale));
    $("top10BgRotation").value=String(Math.round(data.backgroundRotation));
    $("top10LogoScale").value=String(Math.round(data.logoScale));
    $("top10LogoRotation").value=String(Math.round(data.logoRotation));
    $("top10PositionSelect").value=String(data.ranking);
    $("top10DarkColor").value=data.darkeningColor;
    $("top10DarkIntensity").value=String(data.darkeningIntensity);
    $("top10DarkStart").value=String(data.darkeningStart);
    $("top10NumberFill").value=data.numberFill;
    $("top10NumberStrokeStart").value=data.numberStrokeStart;
    $("top10NumberStrokeEnd").value=data.numberStrokeEnd;
    $("top10NumberStrokeWidth").value=String(data.numberStrokeWidth);
    const hasBg=!!data.background,hasLogo=!!data.logo;
    ["top10BgScale","top10BgRotation","top10BgCenter","top10BgReset","top10FilterBtn"].forEach(id=>{$(id).disabled=!hasBg;});
    ["top10LogoScale","top10LogoRotation","top10LogoCenter","top10LogoReset","top10LogoUp","top10LogoDown"].forEach(id=>{$(id).disabled=!hasLogo;});
    $("removeTop10LogoBtn").disabled=!hasLogo;
  }

  function updateObjectTransform(layer){
    const obj=objects[layer];if(!obj) return;
    const prefix=layer==="background"?"background":"logo";
    const base=obj.top10BaseScale||1;
    obj.set({
      left:data[prefix+"X"],top:data[prefix+"Y"],angle:data[prefix+"Rotation"],
      scaleX:base*data[prefix+"Scale"]/100,scaleY:base*data[prefix+"Scale"]/100
    });
    obj.setCoords();canvas.requestRenderAll();
  }

  function updateStateFromObject(obj){
    const layer=obj?.top10Kind;
    if(layer!=="background"&&layer!=="logo") return;
    const base=obj.top10BaseScale||1;
    data[layer+"X"]=obj.left;data[layer+"Y"]=obj.top;data[layer+"Rotation"]=obj.angle||0;
    data[layer+"Scale"]=Math.max(5,Math.min(500,(obj.scaleX||base)/base*100));
    syncControls();scheduleAutosave();
  }

  function centerLayer(layer){
    if(layer==="background"){data.backgroundX=400;data.backgroundY=700;}
    else if(layer==="logo"){data.logoX=400;data.logoY=895;}
    updateObjectTransform(layer);scheduleAutosave();
  }

  function resetLayer(layer){
    if(layer==="background"){
      data.backgroundX=400;data.backgroundY=700;data.backgroundScale=100;data.backgroundRotation=0;
    }else if(layer==="logo"){
      data.logoX=400;data.logoY=895;data.logoScale=100;data.logoRotation=0;
    }
    updateObjectTransform(layer);syncControls();scheduleAutosave();
  }

  async function setBackgroundFromDataUrl(src,name="TOP10 image",options={}){
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

  async function renderCanvas(){
    const out=document.createElement("canvas");out.width=MASTER_W;out.height=MASTER_H;
    const ctx=out.getContext("2d");ctx.fillStyle="#050505";ctx.fillRect(0,0,MASTER_W,MASTER_H);
    const background=await processedBackgroundForExport();
    if(background) drawTransformed(ctx,background,"background",true);
    const logo=data.logo?await imageFromSource(data.logo):null;
    if(!data.logoAboveDarkening&&logo) drawTransformed(ctx,logo,"logo",false);
    drawDarkening(ctx);
    if(data.logoAboveDarkening&&logo) drawTransformed(ctx,logo,"logo",false);
    drawNumber(ctx);
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

  function scheduleAutosave(){
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
    if(objects.background){canvas.remove(objects.background);objects.background=null;}
    if(objects.logo){canvas.remove(objects.logo);objects.logo=null;}
    refreshDarkening();refreshNumber();
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
        locked:true,left:objects.darkening?.left??0,top:objects.darkening?.top??0,
        selectable:objects.darkening?.selectable??false,evented:objects.darkening?.evented??false
      },
      number:{
        locked:true,left:objects.number?.left??0,top:objects.number?.top??0,
        selectable:objects.number?.selectable??false,evented:objects.number?.evented??false,
        bounds:runtime.numberMetrics?{...runtime.numberMetrics}:null
      },
      layers:data.logoAboveDarkening
        ?["TOP_NUMBER","LOGO","BOTTOM_DARKENING","BACKGROUND_IMAGE"]
        :["TOP_NUMBER","BOTTOM_DARKENING","LOGO","BACKGROUND_IMAGE"]
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
    if(layer!=="background"&&layer!=="logo") return;
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
  $("top10LogoDown").addEventListener("click",()=>{data.logoAboveDarkening=false;applyStacking();scheduleAutosave();});

  $("top10PositionSelect").addEventListener("change",e=>{
    data.ranking=String(e.target.value);refreshNumber();syncControls();scheduleAutosave();
  });

  $("top10DarkColor").addEventListener("input",e=>{data.darkeningColor=e.target.value;refreshDarkening();scheduleAutosave();});
  $("top10DarkIntensity").addEventListener("input",e=>{
    data.darkeningIntensity=Math.max(0,Math.min(100,Number(e.target.value)||0));refreshDarkening();scheduleAutosave();
  });
  $("top10DarkStart").addEventListener("input",e=>{
    data.darkeningStart=Math.max(0,Math.min(96,Number(e.target.value)||0));refreshDarkening();scheduleAutosave();
  });

  function refreshNumberStyle(){
    data.numberFill=$("top10NumberFill").value;
    data.numberStrokeStart=$("top10NumberStrokeStart").value;
    data.numberStrokeEnd=$("top10NumberStrokeEnd").value;
    data.numberStrokeWidth=Math.max(1,Math.min(60,Number($("top10NumberStrokeWidth").value)||18));
    refreshNumber();scheduleAutosave();
  }
  $("top10NumberFill").addEventListener("input",refreshNumberStyle);
  $("top10NumberStrokeStart").addEventListener("input",refreshNumberStyle);
  $("top10NumberStrokeEnd").addEventListener("input",refreshNumberStyle);
  $("top10NumberStrokeWidth").addEventListener("input",refreshNumberStyle);

  $("top10EditPhotopeaBtn").addEventListener("click",()=>{
    window.PhotopeaBridge?.editTop10?.().catch(error=>setStatus(error.message||"Photopea недоступен.","error"));
  });
  $("top10DownloadBtn").addEventListener("click",download);
  window.addEventListener("resize",()=>{if(!$("top10Workspace").hidden) resizeDisplay();});

  refreshDarkening();refreshNumber();resizeDisplay();renderLayers();syncControls();

  window.Top10Editor={
    activate,serialize,restore,resetClassic,renderCanvas,renderBlob,download,
    setBackgroundFromDataUrl,setLogoFromDataUrl,openFilters,inspect,
    getState:()=>clone(data),getSelectedLayer:()=>runtime.selectedLayer,
    constants:{MASTER_W,MASTER_H}
  };

  if(window.__pendingTop10Project!==undefined){
    const pending=window.__pendingTop10Project;delete window.__pendingTop10Project;restore(pending);
  }
  window.dispatchEvent(new CustomEvent("top10-editor-ready"));
})();