(() => {
  const $=id=>document.getElementById(id);
  const scenes=[
    {host:"stage",workspace:"poster",orientation:()=>PosterApp?.getActiveFormat?.()==="horizontal"?"horizontal":"vertical",empty:()=>window.PosterApp?.hasUserImages?.()!==true},
    {host:"trainCanvasShell",workspace:"train",orientation:()=>"horizontal",empty:()=>window.TrainEditor?.hasUserImages?.()!==true},
    {host:"top10CanvasShell",workspace:"top10",orientation:()=>"vertical",empty:()=>window.Top10Editor?.hasUserImages?.()!==true}
  ];
  const reduced=window.matchMedia("(prefers-reduced-motion: reduce)");
  let rotationIndex=Math.floor(Math.random()*10);
  const mounted=[];

  function decorate(setting){
    const host=$(setting.host);if(!host)return null;
    const layer=document.createElement("div");
    layer.className="empty-showcase";layer.hidden=true;layer.setAttribute("aria-label","Пустая рабочая зона. Загрузите изображение.");
    const frame=document.createElement("div");frame.className="empty-showcase-frame";
    const image=document.createElement("div");image.className="empty-showcase-image";
    const shade=document.createElement("div");shade.className="empty-showcase-shade";
    const caption=document.createElement("div");caption.className="empty-showcase-caption";
    const title=document.createElement("strong");
    const hint=document.createElement("span");hint.textContent="Загрузите изображение, чтобы начать работу";
    caption.append(title,hint);frame.append(image,shade,caption);layer.append(frame);host.append(layer);
    return {setting,host,layer,image,title,shown:false,lastAsset:-1,lastOrientation:""};
  }
  function visible(item){
    const id=item.setting.workspace==="train"?"trainWorkspace":item.setting.workspace==="top10"?"top10Workspace":"posterWorkspace";
    const panel=$(id);return Boolean(panel && !panel.hidden && panel.classList.contains("active"));
  }
  function pick(item){
    const assets=window.EMPTY_PARODY_ASSETS||[];
    if(!assets.length)return;
    const orientation=item.setting.orientation();
    const offset=item.setting.workspace==="train"?3:item.setting.workspace==="top10"?6:0;
    const index=(rotationIndex+offset)%assets.length;
    const asset=assets[index];
    if(item.lastAsset===index && item.lastOrientation===orientation)return;
    item.lastAsset=index;item.lastOrientation=orientation;
    item.image.style.backgroundImage='url("'+asset[orientation]+'")';
    item.image.dataset.orientation=orientation;
    item.title.textContent=asset.title;
  }
  function sync(){
    for(const item of mounted){
      const empty=item.setting.empty();
      if(empty){
        pick(item);
        item.layer.hidden=false;
        item.layer.classList.remove("empty-showcase-leaving");
        item.shown=true;
      }else if(item.shown){
        item.shown=false;item.layer.classList.add("empty-showcase-leaving");
        setTimeout(()=>{if(!item.shown){item.layer.hidden=true;item.layer.classList.remove("empty-showcase-leaving");}},260);
      }
    }
  }
  function rotate(){
    if(document.hidden||reduced.matches)return;
    rotationIndex=(rotationIndex+1)%Math.max(1,(window.EMPTY_PARODY_ASSETS||[]).length);
    for(const item of mounted)if(item.shown&&visible(item)){item.lastAsset=-1;pick(item);}
  }
  scenes.forEach(s=>{const item=decorate(s);if(item)mounted.push(item);});
  sync();
  setInterval(sync,300);
  setInterval(rotate,14000);
  window.addEventListener("pageshow",sync);
  window.addEventListener("resize",sync);
  document.addEventListener("visibilitychange",sync);
  window.EmptyShowcase={sync};
})();