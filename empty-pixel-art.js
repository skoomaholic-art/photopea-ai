(() => {
  // Original, lightweight pixel-art scene. Decorative UI only: never added to
  // Fabric canvases, project state, PNG/PSD export or saved templates.
  const scenes = [
    { host: "stage", kind: "vertical", empty: () => window.PosterApp?.hasUserImages?.() !== true },
    { host: "trainCanvasShell", kind: "train", empty: () => window.TrainEditor?.hasUserImages?.() !== true },
    { host: "top10CanvasShell", kind: "top10", empty: () => window.Top10Editor?.hasUserImages?.() !== true }
  ];
  let tick = 0;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const P = {
    void:"#090d0e", wall:"#161d1b", seam:"#24302a", brick:"#1b2824",
    skyline:"#090d13", glass:"#344745", amber:"#d5a361", soft:"#92704b",
    suit:"#171c1c", litSuit:"#323936", skin:"#947963", dark:"#070b0c",
    desk:"#352821", deskTop:"#57402b", rose:"#ad3432", roseLight:"#da5549",
    moon:"#c6bb9a", smoke:"#69716b", glass:"#71826f"
  };
  const px=(c,x,y,w,h,col)=>{c.fillStyle=col;c.fillRect(Math.round(x),Math.round(y),Math.ceil(w),Math.ceil(h));};
  const pixLine=(c,x,y,w,h,col)=>px(c,x,y,Math.max(1,w),Math.max(1,h),col);
  function draw(canvas,kind,frame) {
    const vertical = kind==="vertical" || kind==="top10";
    const w=kind==="train"?384:kind==="top10"?100:vertical?112:176;
    const h=kind==="train"?48:kind==="top10"?175:vertical?168:98;
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    const c=canvas.getContext("2d",{alpha:false});
    c.imageSmoothingEnabled=false;
    px(c,0,0,w,h,P.wall);
    const floor=Math.round(h*.76);
    // Apartment office wallpaper and diagonal stripes in subdued green-grey.
    for(let y=0;y<floor;y+=11){px(c,0,y,w,1,P.seam);}
    for(let x=0;x<w;x+=14){for(let y=4;y<floor;y+=13)px(c,x,y,1,5,P.brick);}
    px(c,0,floor,w,h-floor,P.dark);
    for(let x=3;x<w;x+=19)px(c,x,floor+2,1,h-floor-3,P.seam);

    const winW=vertical?46:kind==="train"?56:48;
    const winH=vertical?50:kind==="train"?25:47;
    const winX=w-winW-(vertical?5:kind==="train"?23:11),winY=Math.floor(h*.12);
    px(c,winX-3,winY-3,winW+6,winH+6,P.deskTop);
    px(c,winX,winY,winW,winH,P.skyline);
    // Rain and a softly glowing skyline beyond the window.
    for(let i=0;i<11;i++){
      const x=winX+2+(i*13)%(winW-5), ht=4+(i*11)%(winH*.45);
      px(c,x,winY+winH-ht,4,ht,i%3===0?"#131e24":"#17232b");
      if(i%2===0)px(c,x+1,winY+winH-ht+3,1,1,"#b59465");
      if(i%3===0)px(c,x+2,winY+winH-ht+7,1,1,"#8a7355");
    }
    px(c,winX+winW*.61,winY+7,6,6,P.moon);
    px(c,winX+winW*.61+1,winY+7,3,1,"#fff0b8");
    if(frame>=0){
      for(let i=0;i<8;i++){
        const x=winX+3+(i*17+frame*2)%(winW-4);
        const y=winY+4+(i*15+frame*4)%(winH-7);
        pixLine(c,x,y,1,3,"#394d52");
      }
    }
    px(c,winX+Math.floor(winW/2),winY,2,winH,P.deskTop);
    px(c,winX,winY+Math.floor(winH/2),winW,2,P.deskTop);

    // Bookshelves; deliberately abstract noir detail, not a film still.
    const shelfX=vertical?5:kind==="train"?25:12,shelfY=Math.floor(h*.15);
    px(c,shelfX,shelfY,vertical?18:22,Math.max(27,Math.floor(h*.34)),P.dark);
    for(let i=0;i<6;i++){
      const bx=shelfX+2+(i*3);const by=shelfY+5+(i%3);
      px(c,bx,by,2,Math.floor(h*.12),["#79583c","#465249","#624b3b"][i%3]);
    }
    px(c,shelfX,shelfY+Math.floor(h*.17),vertical?18:22,2,P.deskTop);
    px(c,shelfX,shelfY+Math.floor(h*.34),vertical?18:22,2,P.deskTop);

    // Seated suit silhouette with fedora, intentionally no facial likeness.
    const cx=Math.floor(kind==="train"?w*.48:w*.45);
    const headY=Math.round(h*.34), unit=vertical?1.05:kind==="train"?.73:1;
    const Z=v=>Math.max(1,Math.round(v*unit));
    px(c,cx-Z(10),headY-Z(3),Z(20),Z(4),P.dark);
    px(c,cx-Z(6),headY-Z(11),Z(12),Z(8),P.dark);
    px(c,cx-Z(4),headY-Z(12),Z(8),Z(2),P.litSuit);
    px(c,cx-Z(7),headY+Z(2),Z(14),Z(13),P.dark);
    px(c,cx-Z(6),headY+Z(2),Z(2),Z(9),P.skin);
    px(c,cx+Z(3),headY+Z(3),Z(2),Z(7),P.skin);
    px(c,cx-Z(4),headY+Z(7),Z(8),Z(2),P.dark);
    px(c,cx-Z(17),headY+Z(14),Z(34),Z(30),P.suit);
    px(c,cx-Z(16),headY+Z(15),Z(5),Z(21),P.litSuit);
    px(c,cx+Z(11),headY+Z(15),Z(4),Z(23),"#202725");
    px(c,cx-Z(2),headY+Z(16),Z(4),Z(15),"#d5c5a0");
    px(c,cx-Z(1),headY+Z(18),Z(2),Z(13),"#302628");
    // Small animated cigarette smoke; no smoking endorsement or interactive content.
    if(frame>=0){
      const drift=Math.sin(frame*.75)*2;
      for(let i=0;i<3;i++)px(c,cx+Z(12)+drift+i,headY-Z(4)-i*5+(frame%4),1,3,P.smoke);
    }
    const tableY=Math.round(h*.68);
    px(c,Math.max(2,cx-Z(34)),tableY,Z(68),Z(3),P.deskTop);
    px(c,Math.max(2,cx-Z(32)),tableY+Z(3),Z(64),Math.max(4,h-tableY-Z(4)),P.desk);
    px(c,Math.max(2,cx-Z(30)),tableY+Z(7),Z(60),Z(1),"#654730");
    px(c,cx-Z(7),tableY+Z(4),Z(14),Z(2),P.dark);
    // Small house cat next to the Don: an original low-resolution homage.
    const catX=cx+Z(5),catY=tableY-Z(6);
    px(c,catX,catY+Z(3),Z(8),Z(4),"#485049");
    px(c,catX+Z(5),catY,Z(4),Z(4),"#535850");
    px(c,catX+Z(5),catY-Z(2),Z(1),Z(2),"#535850");
    px(c,catX+Z(8),catY-Z(2),Z(1),Z(2),"#535850");
    px(c,catX+Z(8),catY+Z(2),1,1,"#e1c17a");
    px(c,catX-Z(1),catY+Z(1)-(frame>=0?frame%10===0?1:0:0),Z(2),Z(3),"#485049");
    // Brass desk lamp, flicker is sparse to avoid distracting the editor.
    const lx=cx+Z(24),ly=tableY-Z(5);
    px(c,lx-1,ly,2,6,P.soft);px(c,lx-6,ly-1,10,2,P.soft);
    px(c,lx-4,ly-7,8,5,P.amber);
    px(c,lx-3,ly-3,6,1,(frame%13===0)?P.soft:"#f2ca83");
    // A rose in a glass; the only intentionally saturated accent.
    const rx=cx-Z(21),ry=tableY-Z(4);
    px(c,rx,ry,1,Z(6),"#426647");px(c,rx-2,ry-3,5,3,frame%8===0?P.roseLight:P.rose);
    px(c,rx-1,ry+Z(4),3,1,P.glass);
    // Film-like border, deliberately quiet and not game UI.
    px(c,0,0,w,2,P.dark);px(c,0,h-2,w,2,P.dark);
  }

  function decorate(setting) {
    const host=document.getElementById(setting.host);
    if(!host)return;
    const layer=document.createElement("div");
    layer.className="pixel-idle";
    layer.hidden=true;
    layer.setAttribute("aria-label","Пустой холст. Загрузите изображение.");
    const canvas=document.createElement("canvas");
    canvas.className="pixel-idle-canvas";canvas.setAttribute("aria-hidden","true");
    const label=document.createElement("div");label.className="pixel-idle-caption";
    const over=document.createElement("span");over.className="pixel-idle-eyebrow";over.textContent="THE DON\u2019S OFFICE / PIXEL NOIR";
    const title=document.createElement("strong");title.textContent="Ваша история начинается здесь";
    const sub=document.createElement("span");sub.textContent="Загрузите изображение или выберите исходник";
    label.append(over,title,sub);layer.append(canvas,label);host.append(layer);
    return {setting,host,layer,canvas,shown:false,first:true};
  }

  const mounted=scenes.map(decorate).filter(Boolean);
  function sync() {
    for(const item of mounted){
      const empty=item.setting.empty();
      if(item.shown===empty)continue;
      item.shown=empty;
      if(empty){
        item.layer.hidden=false;
        item.layer.classList.remove("pixel-idle-leaving");
        item.first=true;
        draw(item.canvas,item.setting.kind,-1);
      } else {
        item.layer.classList.add("pixel-idle-leaving");
        window.setTimeout(()=>{
          if(!item.shown){item.layer.hidden=true;item.layer.classList.remove("pixel-idle-leaving");}
        },300);
      }
    }
  }
  sync();
  window.setInterval(sync,450);
  function visibleWorkspace(item){
    const id=item.setting.kind==="train"?"trainWorkspace":item.setting.kind==="top10"?"top10Workspace":"posterWorkspace";
    const panel=document.getElementById(id);
    return Boolean(panel && !panel.hidden && panel.classList.contains("active"));
  }
  const animate=()=>{
    if(!document.hidden && !reduceMotion.matches){
      tick++;
      for(const item of mounted)if(item.shown && visibleWorkspace(item))draw(item.canvas,item.setting.kind,tick);
    }
  };
  // Drawing only a handful of tiny pixel frames, and only for empty states.
  window.setInterval(animate,210);
  window.addEventListener("pageshow",sync);
  document.addEventListener("visibilitychange",sync);
  window.EmptyPixelArt={sync};
})();