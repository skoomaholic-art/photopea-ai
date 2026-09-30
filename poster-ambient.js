/* Poster Editor: locally rendered 2D pixel vignette.
   Presentation-only canvas, never attached to export/composition layers. */
(() => {
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const scenes = new Map();
  const $ = id => document.getElementById(id);

  function drawPixelScene(canvas, time) {
    const landscape = canvas.closest(".poster-stage")?.clientWidth >
      canvas.closest(".poster-stage")?.clientHeight || canvas.closest(".pixel-stage-wide");
    const w = landscape ? 320 : 160, h = landscape ? 180 : 240;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d", {alpha: false});
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    const tick = motion.matches ? 0 : time;
    const flicker = motion.matches ? 0 : Math.sin(tick * .002) * .08 + Math.sin(tick * .009) * .035;
    const r = (x,y,rw,rh,color) => {ctx.fillStyle=color;ctx.fillRect(Math.round(x),Math.round(y),Math.round(rw),Math.round(rh));};
    const cx = Math.round(w / 2), cy = Math.round(h * .48);
    // Low-lit, 1940s-inspired study. All shapes are original procedural artwork.
    r(0,0,w,h,"#080e0d");
    for(let y=0;y<h;y+=4) {
      r(0,y,w,4,y < h*.5 ? (y%12===0?"#121b17":"#101712") : "#10120e");
    }
    // Carved wood panels and cinematic side shadows.
    for(let x=8;x<w;x+=30) {r(x,0,1,h*.69,"#263025");r(x+3,0,1,h*.69,"#080f0d");}
    r(0,h*.68,w,4,"#342516");r(0,h*.70,w,h*.30,"#1a140e");
    for(let x=0;x<w;x+=9) r(x,h*.70,1,h*.3,x%18===0?"#281d13":"#211810");
    // Tall rainy window. A little extra horizontal framing in landscape.
    const wx = landscape ? 26 : 9, ww = landscape ? 66 : 41;
    r(wx-3,21,ww+6,Math.round(h*.49),"#241f16");
    r(wx,24,ww,Math.round(h*.45),"#0a181a");
    r(wx+3,27,ww-6,Math.round(h*.44)-5,"#15272a");
    r(wx+ww*.49,24,3,Math.round(h*.45),"#352d1d");
    r(wx, Math.round(h*.26), ww,3,"#352d1d");
    r(wx+5,h*.39,10,2,"#7d6843");
    r(wx+22,h*.36,4,4,"#8c7951");
    if (!motion.matches) {
      for(let i=0;i<12;i++) {
        let x=wx+4+(i*13)%(ww-9), y=29+((i*37+Math.floor(tick/95)*(i%3+1)) % Math.round(h*.41));
        r(x,y,1,4,"#54726a");
      }
    }
    // Heavy curtain in deep burgundy.
    r(wx+ww-3,18,7,h*.48,"#32171a");
    r(wx+ww+4,18,4,h*.5,"#481f20");
    // Two antique pictures.
    const px = landscape ? w-72 : w-35;
    r(px,29,27,36,"#493622"); r(px+3,32,21,30,"#17170f"); r(px+6,36,15,24,"#29251b");
    r(px+12,39,3,11,"#876746");
    // Golden lamp pool (angular pixelated halation).
    const lampX = cx+(landscape?95:47), lampY = cy-23;
    let a=Math.max(0,Math.min(1,.77+flicker));
    for(let j=3;j>=0;j--) {
      ctx.globalAlpha=a*(j===0?.28:.085);
      r(lampX-9-j*7,lampY+j*1,21+j*14,13+j*12,j%2?"#bd7d35":"#d9a34e");
    }
    ctx.globalAlpha=1;
    r(lampX-9,lampY-8,19,4,"#99763f"); r(lampX-12,lampY-4,25,7,"#c59c51");
    r(lampX-4,lampY+3,8,13,"#8d7040"); r(lampX-8,lampY+16,17,3,"#665035");
    r(lampX-2,lampY-4,5,4,"#f1d58a");
    // Desk, elbow silhouettes and woodgrain.
    const deskY = Math.round(h*.65), deskX=landscape?65:14, deskW=w-deskX*2;
    r(deskX-2,deskY-4,deskW+4,8,"#422719");r(deskX,deskY,deskW,7,"#755038");
    r(deskX+7,deskY+8,deskW-14,24,"#382117");
    r(deskX+14,deskY+34,deskW-28,4,"#271a12");
    r(deskX+10,deskY+16,deskW-20,1,"#62402a");
    r(deskX+10,deskY+22,deskW-20,1,"#4d3020");
    // Seated enigmatic figure with dark tailored suit.
    const faceX=cx-6, faceY=cy-15;
    r(cx-30,cy+9,63,28,"#0a0f10");
    r(cx-39,cy+29,78,22,"#111716");
    r(cx-38,cy+45,77,6,"#242821");
    r(cx-27,cy+7,19,21,"#171b1b");r(cx+11,cy+7,18,21,"#171b1b");
    // White shirt collar and wine-red tie, almost hidden in the shadow.
    r(cx-6,cy+10,5,13,"#b9ac92");r(cx+3,cy+10,4,13,"#b1a68d");
    r(cx-2,cy+15,3,19,"#60222a");
    // Hair, cheek and shadow, no likeness to any real actor.
    r(faceX-8,faceY-2,27,25,"#291b15");r(faceX-5,faceY+1,21,18,"#6a4933");
    r(faceX+6,faceY+4,10,14,"#a2784e");r(faceX-7,faceY+2,10,18,"#3e3027");
    r(faceX-10,faceY-4,29,7,"#171615");r(faceX-7,faceY-7,24,4,"#25211a");
    r(faceX+6,faceY+7,3,1,"#11140e");r(faceX+14,faceY+7,3,1,"#10140e");
    r(faceX+7,faceY+16,8,1,"#352621");
    // Left hand rests on the table; subtle finger animation.
    const hand=Math.round(Math.sin(tick*.0015)*1);
    r(cx-28,deskY-6+hand,15,6,"#866648");
    r(cx-26,deskY-2+hand,11,3,"#a27c54");
    // Single red rose in a thin glass.
    const rx=landscape?cx-98:cx-53,ry=deskY-21;
    r(rx,ry+7,2,22,"#3b6141");r(rx-2,ry+15,6,3,"#3a5840");
    r(rx-5,ry,9,8,"#691f27");r(rx-3,ry-4,8,7,"#a32a33");
    r(rx,ry-5,3,3,"#d34f44");
    r(rx-5,deskY+2,10,11,"#344541");r(rx-7,deskY+12,14,2,"#657668");
    // A few cinematic dust motes, subtle and restrained.
    if(!motion.matches) for(let i=0;i<5;i++) {
      const sx=(i*41+Math.floor(tick/210)*(i%2+1))%w;
      const sy=(i*37+Math.floor(tick/390)*(i%3+1))%Math.round(h*.62);
      r(sx,sy,1,1,"#615b48");
    }
    // Soft letterbox strips. No protected movie logo or character likeness.
    r(0,0,w,7,"#050807");r(0,h-7,w,7,"#050807");
  }

  function createScene(canvas) {
    let raf=0,last=0;
    const visible=()=>{
      const host=canvas.closest(".empty-state, .pixel-stage-wide");
      if (!host || host.hidden || document.hidden) return false;
      if (host.closest(".workspace")?.classList.contains("active")===false) return false;
      return !getComputedStyle(host).display.includes("none");
    };
    const frame=now=>{
      raf=0;
      if(!visible()) return;
      if(now-last>85 || !last) {drawPixelScene(canvas,now);last=now;}
      if(!motion.matches) raf=requestAnimationFrame(frame);
    };
    const sync=()=>{
      if(!visible()) {if(raf)cancelAnimationFrame(raf);raf=0;return;}
      if(motion.matches){drawPixelScene(canvas,0);return;}
      if(!raf)raf=requestAnimationFrame(frame);
    };
    scenes.set(canvas,{sync});
    return sync;
  }

  function buildOverlay(container, wide) {
    if(!container)return null;
    const layer=document.createElement("div");
    layer.className="pixel-stage-overlay"+(wide?" pixel-stage-wide":"");
    layer.setAttribute("aria-hidden","true");
    const ambient=document.createElement("div");
    ambient.className="godfather-pixel";
    const canvas=document.createElement("canvas");
    canvas.className="pixel-canvas";
    canvas.width=wide?320:160;
    canvas.height=wide?180:240;
    const label=document.createElement("span");
    label.className="pixel-caption";label.textContent="AN OFFER YOU CAN CREATE";
    const caption=document.createElement("span");
    caption.className="pixel-overlay-note";caption.textContent="Добавьте изображение";
    ambient.append(canvas,label);layer.append(ambient,caption);
    container.append(layer);
    const sync=createScene(canvas);
    sync();
    return {layer,sync};
  }

  // The wide train canvas and TOP10 have their own export renderers.
  // These overlays live in the UI only, not inside Fabric or export layers.
  function mountOtherWorkspaces() {
    const train=buildOverlay($("trainCanvasShell"),true);
    const top10=buildOverlay($("top10CanvasShell"),false);
    const update=()=>{
      if(train) {
        try {
          const serialized=window.TrainEditor?.serialize?.();
          const objects=serialized?.canvas?.objects||[];
          const hasImages=objects.some(obj=>obj.kind==="logo" || obj.kind==="image" ||
            obj.kind==="poster" || obj.type==="image");
          const populated=hasImages||Boolean(serialized?.photopeaMasterId);
          train.layer.hidden=populated;
          train.sync();
        } catch {train.layer.hidden=true;train.sync();}
      }
      if(top10) {
        try {
          const state=window.Top10Editor?.getState?.();
          top10.layer.hidden=Boolean(state?.background || state?.logo || state?.photopeaComposite);
          top10.sync();
        } catch {top10.layer.hidden=true;top10.sync();}
      }
    };
    update();
    document.querySelectorAll(".workspace-tab").forEach(tab=>tab.addEventListener("click",()=>{
      requestAnimationFrame(update);
    }));
    document.querySelectorAll("#trainLogoInput,#trainImageInput,#top10BackgroundInput,#top10LogoInput").forEach(
      input=>input.addEventListener("change",()=>setTimeout(update,250))
    );
    setInterval(()=>{if(!document.hidden)update();},850);
  }

  function init() {
    const poster=$("posterEmpty");
    if(!poster)return;
    const cvs=poster.querySelector(".pixel-canvas");
    if(!cvs)return;
    const sync=createScene(cvs);
    const observer=new MutationObserver(sync);
    observer.observe(poster,{attributes:true,attributeFilter:["hidden","style"]});
    observer.observe($("posterWorkspace"),{attributes:true,attributeFilter:["class"]});
    observer.observe($("stage"),{attributes:true,attributeFilter:["style"]});
    motion.addEventListener?.("change",sync);
    window.addEventListener("resize",sync);
    document.addEventListener("visibilitychange",sync);
    // Routing into the archives that already exist. Posters use their own shelf.
    document.querySelectorAll("[data-library-open]").forEach(button=>button.addEventListener("click",async()=>{
      button.closest("details").open=false;
      const target=button.dataset.libraryOpen;
      if(target==="works") {
        const tab=document.querySelector(".workspace-tab.active")?.dataset.workspace||"vertical";
        await window.WorkArchive?.openArchive(tab==="photopea"?"vertical":tab);
      } else if(target==="logos") {
        const tab=document.querySelector(".workspace-tab.active")?.dataset.workspace||"vertical";
        await window.LogoArchive?.open(tab==="train"?"train":tab==="top10"?"top10":"poster");
      } else if(target==="posters") {
        openPosterShelf();
      }
    }));
    document.addEventListener("click", event=>{
      document.querySelectorAll(".library-menu[open]").forEach(d=>{if(!d.contains(event.target))d.open=false;});
    });
    sync();
    mountOtherWorkspaces();
  }

  // Poster shelf reuses the existing IndexedDB assets, without modifying images or old projects.
  const shelf=()=>$("posterLibraryModal");
  async function openPosterShelf() {
    const modal=shelf();
    if(!modal) return;
    modal.hidden=false;
    document.body.classList.add("modal-open");
    $("posterLibrarySearch").value="";
    await renderPosterShelf();
  }
  function closePosterShelf(){
    shelf().hidden=true;
    document.body.classList.remove("modal-open");
  }
  async function renderPosterShelf(){
    const root=$("posterLibraryGallery"),status=$("posterLibraryStatus");
    root.replaceChildren();status.textContent="Загружаю архив...";
    try {
      const assets=(await window.AssetManager.list()).filter(asset=>asset.imageType==="poster" && asset.originalAsset);
      const q=$("posterLibrarySearch").value.trim().toLowerCase();
      const items=assets.filter(asset=>!q||String(asset.title||"").toLowerCase().includes(q));
      status.textContent=assets.length ? assets.length+" изображений в этом браузере" : "Архив постеров пока пуст.";
      if(!items.length&&assets.length)status.textContent="По запросу ничего не найдено.";
      for(const asset of items){
        const card=document.createElement("article");
        card.className="poster-library-item";
        const img=document.createElement("img");img.alt=asset.title||"Постер";
        img.loading="lazy";img.src=await AssetManager.blobToDataUrl(asset.originalAsset);
        const body=document.createElement("div");body.className="poster-library-body";
        const title=document.createElement("strong");title.textContent=asset.title||"Без названия";
        title.title=title.textContent;
        const meta=document.createElement("small");
        meta.textContent=[asset.year,asset.width&&asset.height?asset.width+" × "+asset.height:"",asset.source].filter(Boolean).join(" · ");
        const actions=document.createElement("div");actions.className="poster-library-actions";
        const add=(label,action,cls="")=>{
          const button=document.createElement("button");
          button.type="button";button.textContent=label;button.className=cls;
          button.addEventListener("click",async()=>{
            button.disabled=true;
            try {await action(asset);}
            catch(e){status.textContent=e.message||"Не удалось выполнить действие.";status.classList.add("error");}
            finally{button.disabled=false;}
          });
          actions.append(button);
        };
        add("Использовать",async a=>{
          const image=await AssetManager.blobToDataUrl(a.originalAsset);
          const tab=document.querySelector(".workspace-tab.active")?.dataset.workspace;
          if(tab!=="vertical"&&tab!=="horizontal")window.PosterApp.switchWorkspace("vertical");
          await PosterApp.setImageLayer("poster",image,a.title||"Постер",{assetId:a.id});
          closePosterShelf();
        },"primary");
        add("Скачать",async a=>{
          const url=URL.createObjectURL(a.originalAsset),link=document.createElement("a");
          link.href=url;link.download=a.title||"poster.png";link.click();
          setTimeout(()=>URL.revokeObjectURL(url),3000);
        });
        add("Переименовать",async a=>{
          const name=window.prompt("Новое название постера:",a.title||"");
          if(name===null)return;
          const clean=name.trim();
          if(!clean || clean.length>120)throw Error("Введите название длиной от 1 до 120 символов.");
          await AssetManager.save({...a,title:clean});
          await renderPosterShelf();
        });
        add("Удалить",async a=>{
          if(!window.confirm("Удалить постер «"+(a.title||"Без названия")+"» из локального архива?"))return;
          await SkoomaStore.deleteAsset(a.id);
          await renderPosterShelf();
        },"delete");
        body.append(title,meta,actions);card.append(img,body);root.append(card);
      }
    }catch(e){status.textContent=e.message||"Не удалось загрузить архив.";status.classList.add("error");}
  }

  document.addEventListener("DOMContentLoaded",()=>{
    init();
    $("posterLibraryClose")?.addEventListener("click",closePosterShelf);
    shelf()?.addEventListener("click",e=>{if(e.target===shelf())closePosterShelf();});
    $("posterLibrarySearch")?.addEventListener("input",()=>{void renderPosterShelf();});
  });
})();
