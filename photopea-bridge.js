(() => {
  const $=id=>document.getElementById(id);
  const PP_ORIGIN="https://www.photopea.com";
  const frame=$("photopeaFrame");
  let ready=false;
  let readyWaiters=[];
  let commandWaiters=[];
  let exportWaiter=null;
  let inspectWaiter=null;
  let context=null;
  const layeredMasterIds={};

  function setStatus(message,kind="") {
    $("photopeaStatus").textContent=message;
    $("photopeaStatus").className="mini-status "+kind;
  }

  function timeoutPromise(ms,message) {
    return new Promise((_,reject)=>setTimeout(()=>reject(new Error(message)),ms));
  }

  function waitReady() {
    if(ready) return Promise.resolve();
    return Promise.race([
      new Promise(resolve=>readyWaiters.push(resolve)),
      timeoutPromise(20000,"Photopea не ответил.")
    ]);
  }

  function ensureLoaded() {
    PosterApp.switchWorkspace("photopea");
    if(frame.src==="about:blank" || !frame.src) frame.src=frame.dataset.src;
    return waitReady();
  }

  async function sourceBlob(src) {
    if(!src) throw new Error("Изображение не выбрано.");
    if(src.startsWith("data:")) return AssetManager.dataUrlToBlob(src);
    return AssetManager.fetchImageBlob(src);
  }

  async function openBlob(blob, meta={}) {
    setStatus("Открываю документ в Photopea...");
    await ensureLoaded();
    const buffer=await blob.arrayBuffer();
    context={...meta,openedAt:Date.now()};
    frame.contentWindow.postMessage(buffer,PP_ORIGIN,[buffer]);
    setStatus("Документ передан в Photopea.","ok");
  }

  async function openAsset(asset, meta={}) {
    const src=await AssetManager.dataUrl(asset,true);
    return openBlob(await sourceBlob(src),{
      ...meta,
      assetId:asset.id,
      name:asset.title||"Asset",
      source:asset.source
    });
  }

  async function editSelected() {
    const selected=PosterApp.getSelectedImageContext();
    if(!selected?.src) throw new Error("Сначала выберите изображение.");
    return openBlob(await sourceBlob(selected.src),{
      target:selected.format,
      layer:selected.layer,
      assetId:selected.assetId||null,
      name:selected.name||"Selected image"
    });
  }

  function jsString(value) {
    return JSON.stringify(String(value ?? ""));
  }

  function safeNumber(value,fallback=0) {
    const n=Number(value);
    return Number.isFinite(n)?n:fallback;
  }

  function hexRgb(hex) {
    const value=String(hex||"#000000").replace("#","");
    const normalized=value.length===3?value.split("").map(x=>x+x).join(""):value.padEnd(6,"0").slice(0,6);
    return {
      r:parseInt(normalized.slice(0,2),16)||0,
      g:parseInt(normalized.slice(2,4),16)||0,
      b:parseInt(normalized.slice(4,6),16)||0
    };
  }

  function commonLayerScript(layer,varName) {
    const x=safeNumber(layer.x),y=safeNumber(layer.y);
    const w=Math.max(1,safeNumber(layer.width,1)),h=Math.max(1,safeNumber(layer.height,1));
    const rotation=safeNumber(layer.rotation);
    const opacity=Math.max(0,Math.min(100,safeNumber(layer.opacity,1)*100));
    const visible=layer.visible!==false;
    const locked=!!layer.locked;
    return [
      varName+".name="+jsString(layer.name||layer.id||"Layer")+";",
      "try{"+varName+".opacity="+opacity+";}catch(e){}",
      "try{"+varName+".visible="+visible+";}catch(e){}",
      "try{var __b="+varName+".bounds;var __l=Number(__b[0]),__t=Number(__b[1]),__r=Number(__b[2]),__bt=Number(__b[3]);var __cw=Math.max(.01,__r-__l),__ch=Math.max(.01,__bt-__t);"+varName+".resize("+w+"/__cw*100,"+h+"/__ch*100,AnchorPosition.MIDDLECENTER);}catch(e){}",
      "try{if("+rotation+"!==0)"+varName+".rotate("+rotation+",AnchorPosition.MIDDLECENTER);}catch(e){}",
      "try{var __b2="+varName+".bounds;var __cx=(Number(__b2[0])+Number(__b2[2]))/2,__cy=(Number(__b2[1])+Number(__b2[3]))/2;"+varName+".translate("+x+"-__cx,"+y+"-__cy);}catch(e){}",
      "try{"+varName+".allLocked="+locked+";}catch(e){}"
    ].join("\n");
  }

  function backgroundLayerScript(layer) {
    const color=hexRgb(layer.color);
    return [
      "var ly=doc.artLayers.add();",
      "ly.name="+jsString(layer.name||"Background")+";",
      "var col=new SolidColor();col.rgb.red="+color.r+";col.rgb.green="+color.g+";col.rgb.blue="+color.b+";",
      "doc.selection.selectAll();doc.selection.fill(col);doc.selection.deselect();",
      "try{ly.allLocked="+(!!layer.locked)+";}catch(e){}"
    ].join("\n");
  }

  function textLayerScript(layer) {
    const color=hexRgb(layer.fill);
    const fontSize=Math.max(1,safeNumber(layer.fontSize,24));
    const lines=[
      "var ly=doc.artLayers.add();ly.kind=LayerKind.TEXT;",
      "ly.name="+jsString(layer.name||"Text")+";",
      "var ti=ly.textItem;ti.contents="+jsString(layer.text||"")+";",
      "try{ti.font="+jsString(layer.fontFamily||"Arial")+";}catch(e){try{ti.font='ArialMT';}catch(e2){}}",
      "ti.size="+fontSize+";",
      "try{ti.leading="+(fontSize*safeNumber(layer.lineHeight,1.16))+";}catch(e){}",
      "try{ti.tracking="+safeNumber(layer.letterSpacing,0)+";}catch(e){}",
      "var tc=new SolidColor();tc.rgb.red="+color.r+";tc.rgb.green="+color.g+";tc.rgb.blue="+color.b+";ti.color=tc;",
      "try{ti.justification="+(layer.textAlign==="right"?"Justification.RIGHT":layer.textAlign==="center"?"Justification.CENTER":"Justification.LEFT")+";}catch(e){}",
      "ti.position=[0,"+fontSize+"];",
      commonLayerScript(layer,"ly")
    ];
    return lines.join("\n");
  }

  function imageLayerScript(layer) {
    const src=layer.sourceDataUrl||layer.sourceUrl;
    if(!src) return "";
    return [
      "app.activeDocument=doc;",
      "app.open("+jsString(src)+",null,true);",
      "var ly=doc.activeLayer;",
      commonLayerScript(layer,"ly")
    ].join("\n");
  }

  function buildLayeredScript(model) {
    const doc=model.document;
    const ordered=[...(model.layers||[])].sort((a,b)=>(a.zIndex||0)-(b.zIndex||0));
    const meta=encodeURIComponent(JSON.stringify({
      workspace:model.workspace,width:doc.width,height:doc.height,
      layers:ordered.map(layer=>({name:layer.name,type:layer.type,x:layer.x,y:layer.y,width:layer.width,height:layer.height,rotation:layer.rotation,locked:layer.locked}))
    }));
    const chunks=[
      "/*POSTER_LAYERED_MODEL:"+meta+"*/",
      "var doc=app.documents.add("+Number(doc.width)+","+Number(doc.height)+",72,"+jsString(doc.name||"Poster Editor")+",NewDocumentMode.RGB,DocumentFill.TRANSPARENT);",
      "doc.name="+jsString(doc.name||"Poster Editor")+";"
    ];
    for(const layer of ordered) {
      if(layer.type==="background") chunks.push(backgroundLayerScript(layer));
      else if(layer.type==="text") chunks.push(textLayerScript(layer));
      else chunks.push(imageLayerScript(layer));
    }
    chunks.push("try{doc.activeLayer=doc.layers[0];}catch(e){}");
    chunks.push("app.echoToOE("+jsString("POSTER_LAYERED_READY:"+model.workspace+":"+doc.width+"x"+doc.height+":"+ordered.length)+");");
    return chunks.join("\n");
  }

  async function sendScript(script) {
    await ensureLoaded();
    const donePromise=new Promise((resolve,reject)=>{
      commandWaiters.push({resolve,reject});
      frame.contentWindow.postMessage(script,PP_ORIGIN);
    });
    return Promise.race([donePromise,timeoutPromise(30000,"Photopea не завершил создание слоёв.")]);
  }

  async function inspectActiveDocument() {
    await ensureLoaded();
    const payloadPromise=new Promise((resolve,reject)=>{inspectWaiter={resolve,reject};});
    const script=[
      'if(!app.activeDocument){app.echoToOE("POSTER_INSPECT:"+encodeURIComponent(JSON.stringify({error:"no-document"})));}',
      'else{var __d=app.activeDocument;var __names=[];var __walk=function(__layers,__prefix){for(var __i=0;__i<__layers.length;__i++){var __ly=__layers[__i];var __name=(__prefix?__prefix+"/":"")+__ly.name;__names.push(__name);try{if(__ly.layers)__walk(__ly.layers,__name);}catch(e){}}};__walk(__d.layers,"");app.echoToOE("POSTER_INSPECT:"+encodeURIComponent(JSON.stringify({name:__d.name,width:Number(__d.width),height:Number(__d.height),layers:__names})));}'
    ].join("\n");
    frame.contentWindow.postMessage(script,PP_ORIGIN);
    try {
      return await Promise.race([payloadPromise,timeoutPromise(20000,"Photopea не вернул структуру документа.")]);
    } finally {
      inspectWaiter=null;
    }
  }

  async function openLayeredDocument(model) {
    if(!model?.document?.width||!model?.document?.height||!Array.isArray(model.layers)) throw new Error("Некорректная модель Photopea.");
    setStatus("Создаю многослойный документ в Photopea...");
    context={target:model.workspace,name:model.document.name,layeredModel:model,openedAt:Date.now(),composite:false};
    await sendScript(buildLayeredScript(model));
    setStatus("Многослойный документ открыт: "+model.layers.length+" слоёв.","ok");
    return model;
  }

  async function openStoredMaster(workspace, masterId) {
    if(!masterId || !window.SkoomaStore?.getPhotopeaMaster) return false;
    const saved=await SkoomaStore.getPhotopeaMaster(masterId);
    if(!saved?.blob) return false;
    layeredMasterIds[workspace]=masterId;
    await openBlob(saved.blob,{
      target:workspace,name:saved.name||workspace,layeredMasterId:masterId,
      layeredModel:saved.model||null,restoredLayeredMaster:true,composite:false
    });
    if(context) context.layeredMasterId=masterId;
    setStatus("Сохранённый layered PSD открыт в Photopea.","ok");
    return true;
  }

  async function editCurrentPoster() {
    const format=PosterApp.getActiveFormat();
    if(await openStoredMaster(format,PosterApp.getPhotopeaMasterId?.(format))) return;
    return openLayeredDocument(await PosterApp.buildPhotopeaModel(format));
  }

  async function editTrain() {
    if(!window.TrainEditor?.buildPhotopeaModel) throw new Error("Layered-модель Паровозика недоступна.");
    if(await openStoredMaster("train",TrainEditor.getPhotopeaMasterId?.())) return;
    return openLayeredDocument(await TrainEditor.buildPhotopeaModel());
  }

  async function editTop10() {
    if(!window.Top10Editor?.buildPhotopeaModel) throw new Error("Layered-модель ТОП10 недоступна.");
    if(await openStoredMaster("top10",Top10Editor.getPhotopeaMasterId?.())) return;
    return openLayeredDocument(await Top10Editor.buildPhotopeaModel());
  }

  function classifyDimensions(width,height) {
    const presets=[
      {id:"vertical",w:PosterApp.formats.vertical.w,h:PosterApp.formats.vertical.h},
      {id:"horizontal",w:PosterApp.formats.horizontal.w,h:PosterApp.formats.horizontal.h},
      {id:"train",w:TrainEditor.constants.MASTER_W,h:TrainEditor.constants.MASTER_H},
      {id:"top10",w:Top10Editor.constants.MASTER_W,h:Top10Editor.constants.MASTER_H}
    ];
    const exact=presets.find(p=>p.w===width&&p.h===height);
    if(exact) return {target:exact.id,reason:"exact-dimensions",difference:0};
    const ratio=width/height;
    const ranked=presets.map(p=>({...p,difference:Math.abs(ratio-p.w/p.h)/(p.w/p.h)})).sort((a,b)=>a.difference-b.difference);
    if(ranked[0]?.difference<=0.003) return {target:ranked[0].id,reason:"exact-aspect",difference:ranked[0].difference};
    if(ranked[0]?.difference<=0.03 && (!ranked[1] || ranked[1].difference-ranked[0].difference>0.01)) {
      return {target:ranked[0].id,reason:"nearest-aspect",difference:ranked[0].difference};
    }
    return null;
  }

  async function imageDimensions(blob) {
    if(globalThis.createImageBitmap) {
      const bitmap=await createImageBitmap(blob);
      const out={width:bitmap.width,height:bitmap.height};
      bitmap.close?.();
      return out;
    }
    const src=URL.createObjectURL(blob);
    try {
      const image=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=src;});
      return {width:image.naturalWidth,height:image.naturalHeight};
    } finally { URL.revokeObjectURL(src); }
  }

  function askTarget() {
    $("routeModal").hidden=false;
    document.body.classList.add("modal-open");
    return new Promise(resolve=>{
      const handler=e=>{
        const button=e.target.closest("[data-route-target]");
        if(!button)return;
        $("routeModal").removeEventListener("click",handler);
        $("routeModal").hidden=true;
        document.body.classList.remove("modal-open");
        resolve(button.dataset.routeTarget);
      };
      $("routeModal").addEventListener("click",handler);
    });
  }

  async function routeBlob(blob, dimensions, forcedTarget=null) {
    const auto=forcedTarget?{target:forcedTarget,reason:"forced"}:classifyDimensions(dimensions.width,dimensions.height);
    const target=auto?.target||await askTarget();
    const dataUrl=await AssetManager.blobToDataUrl(blob);
    const asset=await AssetManager.fromBlob(blob,{
      source:"photopea",
      sourceId:"photopea-"+Date.now(),
      title:context?.name||"Photopea edit",
      imageType:target==="train"?"backdrop":"poster",
      width:dimensions.width,
      height:dimensions.height,
      aspectRatio:dimensions.width/dimensions.height,
      editedAsset:blob
    });

    const masterId=context?.layeredMasterId||layeredMasterIds[target]||null;
    if(target==="train") {
      PosterApp.switchWorkspace("train");
      await TrainEditor.applyPhotopeaComposite(dataUrl,context?.name||"Photopea",masterId);
    } else if(target==="top10") {
      PosterApp.switchWorkspace("top10");
      await Top10Editor.applyPhotopeaComposite(dataUrl,context?.name||"Photopea",{assetId:asset.id,masterId});
    } else {
      PosterApp.switchWorkspace(target);
      await PosterApp.applyPhotopeaComposite(target,dataUrl,context?.name||"Photopea",asset.id,masterId);
    }
    const label=target==="train"?"Паровозик":target==="top10"?"ТОП10":target==="vertical"?"Вертикальный":"Горизонтальный";
    setStatus("Возвращено в "+label+" ("+dimensions.width+"×"+dimensions.height+").","ok");
    return target;
  }

  const sendButtons=["sendPhotopeaVerticalBtn","sendPhotopeaHorizontalBtn","sendPhotopeaTrainBtn","sendPhotopeaTop10Btn","sendPhotopeaAutoBtn"];

  function setSendButtonsDisabled(disabled) {
    for(const id of sendButtons) {
      const button=$(id);
      if(button) button.disabled=disabled;
    }
  }

  async function requestBinary(format) {
    const bufferPromise=Promise.race([
      new Promise((resolve,reject)=>{exportWaiter={resolve,reject};}),
      timeoutPromise(30000,"Photopea не ответил при экспорте "+format+".")
    ]);
    frame.contentWindow.postMessage('if(!app.activeDocument){throw new Error("Нет активного документа");} app.activeDocument.saveToOE('+jsString(format)+');',PP_ORIGIN);
    const buffer=await bufferPromise;
    exportWaiter=null;
    return buffer;
  }

  async function saveLayeredMaster(workspace) {
    if(!workspace||!window.SkoomaStore?.savePhotopeaMaster) return null;
    const buffer=await requestBinary("psd:true");
    const masterId="photopea-master-"+workspace+"-"+Date.now();
    await SkoomaStore.savePhotopeaMaster({
      masterId,workspace,createdAt:Date.now(),name:context?.name||workspace,
      blob:new Blob([buffer],{type:"image/vnd.adobe.photoshop"}),
      model:context?.layeredModel||null
    });
    layeredMasterIds[workspace]=masterId;
    if(context) context.layeredMasterId=masterId;
    return masterId;
  }

  async function sendBack(forcedTarget=null) {
    setSendButtonsDisabled(true);
    const targetLabel=forcedTarget==="vertical"?"вертикальный":forcedTarget==="horizontal"?"горизонтальный":forcedTarget==="train"?"паровозик":forcedTarget==="top10"?"ТОП10":"авто";
    setStatus("Сохраняю layered master и получаю preview → "+targetLabel+"...");
    try {
      await ensureLoaded();
      const masterWorkspace=forcedTarget||context?.target||null;
      if((context?.layeredModel||context?.layeredMasterId)&&masterWorkspace) {
        try { await saveLayeredMaster(masterWorkspace); } catch(error) { console.warn("PSD master save failed",error); }
      }
      const buffer=await requestBinary("png");
      const blob=new Blob([buffer],{type:"image/png"});
      const dims=await imageDimensions(blob);
      const target=await routeBlob(blob,dims,forcedTarget);
      await window.WorkArchive?.captureWorkspace?.(target,"photopea-return");
    } catch(error) {
      setStatus(error.message||"Не удалось получить документ из Photopea.","error");
    } finally {
      exportWaiter=null;
      setSendButtonsDisabled(false);
    }
  }

  window.addEventListener("message",event=>{
    if(event.source!==frame.contentWindow) return;
    if(event.origin && event.origin!==PP_ORIGIN) return;
    if(event.data==="done") {
      if(!ready) {
        ready=true;
        readyWaiters.splice(0).forEach(resolve=>resolve());
        setStatus("Photopea готов.","ok");
      } else {
        const waiter=commandWaiters.shift();
        if(waiter) waiter.resolve();
      }
      return;
    }
    if(typeof event.data==="string" && event.data.startsWith("POSTER_LAYERED_READY:")) {
      if(context) context.layeredReady=event.data;
      return;
    }
    if(typeof event.data==="string" && event.data.startsWith("POSTER_INSPECT:")) {
      if(inspectWaiter) {
        try { inspectWaiter.resolve(JSON.parse(decodeURIComponent(event.data.slice("POSTER_INSPECT:".length)))); }
        catch(error) { inspectWaiter.reject(error); }
      }
      return;
    }
    if(event.data instanceof ArrayBuffer && exportWaiter) exportWaiter.resolve(event.data);
  });

  frame.addEventListener("load",()=>setStatus("Photopea загружается..."));
  $("sendPhotopeaVerticalBtn").addEventListener("click",()=>sendBack("vertical"));
  $("sendPhotopeaHorizontalBtn").addEventListener("click",()=>sendBack("horizontal"));
  $("sendPhotopeaTrainBtn").addEventListener("click",()=>sendBack("train"));
  $("sendPhotopeaTop10Btn").addEventListener("click",()=>sendBack("top10"));
  $("sendPhotopeaAutoBtn").addEventListener("click",()=>sendBack(null));
  $("openPhotopeaBtn").addEventListener("click",()=>window.open("https://www.photopea.com/","_blank","noopener"));

  window.PhotopeaBridge={
    openAsset,
    openBlob,
    openLayeredDocument,
    editSelected,
    editCurrentPoster,
    editTrain,
    editTop10,
    sendBack,
    classifyDimensions,
    routeBlob,
    buildLayeredScript,
    inspectActiveDocument,
    getLayeredMasterId:workspace=>layeredMasterIds[workspace]||null,
    getContext:()=>context
  };
})();
