(() => {
  const $=id=>document.getElementById(id);
  const PP_ORIGIN="https://www.photopea.com";
  const frame=$("photopeaFrame");
  let ready=false;
  let readyWaiters=[];
  let exportWaiter=null;
  let context=null;

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

  async function editCurrentPoster() {
    const format=PosterApp.getActiveFormat();
    const blob=await PosterApp.renderPosterBlob(format);
    return openBlob(blob,{target:format,layer:"poster",name:format+"-poster.png",composite:true});
  }

  async function editTrain() {
    if(!window.TrainEditor?.renderMasterBlob) throw new Error("Паровозик ещё не готов.");
    const blob=await TrainEditor.renderMasterBlob();
    return openBlob(blob,{target:"train",layer:"background",name:"parovozik.png",composite:true});
  }

  function classifyDimensions(width,height) {
    const presets=[
      {id:"vertical",w:PosterApp.formats.vertical.w,h:PosterApp.formats.vertical.h},
      {id:"horizontal",w:PosterApp.formats.horizontal.w,h:PosterApp.formats.horizontal.h},
      {id:"train",w:TrainEditor.constants.MASTER_W,h:TrainEditor.constants.MASTER_H}
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

    if(target==="train") {
      PosterApp.switchWorkspace("train");
      await TrainEditor.setBackgroundFromDataUrl(dataUrl,context?.name||"Photopea");
    } else {
      PosterApp.switchWorkspace(target);
      await PosterApp.setImageLayer("poster",dataUrl,context?.name||"Photopea",{assetId:asset.id});
    }
    setStatus("Возвращено в "+(target==="train"?"Паровозик":target==="vertical"?"Вертикальный":"Горизонтальный")+" ("+dimensions.width+"×"+dimensions.height+").","ok");
    return target;
  }

  const sendButtons=["sendPhotopeaVerticalBtn","sendPhotopeaHorizontalBtn","sendPhotopeaTrainBtn","sendPhotopeaAutoBtn"];

  function setSendButtonsDisabled(disabled) {
    for(const id of sendButtons) {
      const button=$(id);
      if(button) button.disabled=disabled;
    }
  }

  async function sendBack(forcedTarget=null) {
    setSendButtonsDisabled(true);
    const targetLabel=forcedTarget==="vertical"?"вертикальный":forcedTarget==="horizontal"?"горизонтальный":forcedTarget==="train"?"паровозик":"авто";
    setStatus("Получаю PNG из Photopea → "+targetLabel+"...");
    try {
      await ensureLoaded();
      const bufferPromise=Promise.race([
        new Promise((resolve,reject)=>{exportWaiter={resolve,reject};}),
        timeoutPromise(30000,"Photopea не ответил при экспорте.")
      ]);
      frame.contentWindow.postMessage('if(!app.activeDocument){throw new Error("Нет активного документа");} app.activeDocument.saveToOE("png");',PP_ORIGIN);
      const buffer=await bufferPromise;
      exportWaiter=null;
      const blob=new Blob([buffer],{type:"image/png"});
      const dims=await imageDimensions(blob);
      await routeBlob(blob,dims,forcedTarget);
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
      }
      return;
    }
    if(event.data instanceof ArrayBuffer && exportWaiter) exportWaiter.resolve(event.data);
  });

  frame.addEventListener("load",()=>setStatus("Photopea загружается..."));
  $("sendPhotopeaVerticalBtn").addEventListener("click",()=>sendBack("vertical"));
  $("sendPhotopeaHorizontalBtn").addEventListener("click",()=>sendBack("horizontal"));
  $("sendPhotopeaTrainBtn").addEventListener("click",()=>sendBack("train"));
  $("sendPhotopeaAutoBtn").addEventListener("click",()=>sendBack(null));
  $("openPhotopeaBtn").addEventListener("click",()=>window.open("https://www.photopea.com/","_blank","noopener"));

  window.PhotopeaBridge={
    openAsset,
    openBlob,
    editSelected,
    editCurrentPoster,
    editTrain,
    sendBack,
    classifyDimensions,
    routeBlob,
    getContext:()=>context
  };
})();
