window.PosterEditor = (() => {
  const $ = id => document.getElementById(id);
  const stage = $("posterStage"), poster = $("posterImage"), logo = $("posterLogo");
  const formats = { vertical:{width:800,height:1200,label:"Вертикальный"}, horizontal:{width:1920,height:1080,label:"Горизонтальный"} };
  const positions = { center:[50,50], "top-left":[18,18], "top-center":[50,18], "top-right":[82,18], "middle-left":[18,50], "middle-right":[82,50], "bottom-left":[18,82], "bottom-center":[50,82], "bottom-right":[82,82] };
  const state = { format:"vertical", poster:null, logo:null, x:50, y:50, scale:100, drag:false, grabX:0, grabY:0 };

  function setStatus(text, kind=""){ const el=$("posterStatus"); el.textContent=text; el.className="poster-status"+(kind?" "+kind:""); }
  function setFormat(name){
    state.format = formats[name] ? name : "vertical";
    const f = formats[state.format];
    stage.style.setProperty("--poster-ratio", f.width / f.height);
    document.querySelectorAll(".poster-format").forEach(btn => btn.classList.toggle("active", btn.dataset.posterFormat === state.format));
    $("posterStageMeta").textContent = `${f.label} · ${f.width} × ${f.height}`;
    $("posterExportBtn").textContent = `Скачать PNG · ${f.width} × ${f.height}`;
    requestAnimationFrame(applyPosition);
  }
  function readFile(file, target, kind){
    if(!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = event => {
      target.src = event.target.result; target.hidden = false; state[kind] = event.target.result;
      $(kind === "poster" ? "posterFileName" : "posterLogoName").textContent = file.name;
      if(kind === "logo"){ state.scale=100; $("posterScale").value=100; setPosition("center"); }
      if(kind === "poster") requestAnimationFrame(applyPosition);
      update();
    };
    reader.readAsDataURL(file);
  }
  function setPosition(name){ const p=positions[name]||positions.center; state.x=p[0]; state.y=p[1]; applyPosition(); }
  function applyPosition(){
    logo.style.left=state.x+"%"; logo.style.top=state.y+"%"; logo.style.transform=`translate(-50%,-50%) scale(${state.scale/100})`;
    if(!logo.hidden){
      const sr=stage.getBoundingClientRect(), lr=logo.getBoundingClientRect();
      if(sr.width&&sr.height&&lr.width&&lr.height){
        const halfW=lr.width/sr.width*50, halfH=lr.height/sr.height*50;
        state.x=Math.max(halfW,Math.min(100-halfW,state.x)); state.y=Math.max(halfH,Math.min(100-halfH,state.y));
        logo.style.left=state.x+"%"; logo.style.top=state.y+"%";
      }
    }
    $("posterScaleValue").value=state.scale+"%"; $("posterScaleValue").textContent=state.scale+"%";
  }
  function update(){ $("posterEmpty").hidden=!!(state.poster&&state.logo); setStatus(state.poster&&state.logo?"Готово к редактированию.":"Выберите формат и загрузите два изображения."); }
  function exportPoster(){
    if(!state.poster||!state.logo){setStatus("Сначала загрузите постер и логотип.","error");return;}
    const {width,height}=formats[state.format], p=new Image(), l=new Image();
    p.onload=()=>l.onload=()=>{
      const out=document.createElement("canvas"); out.width=width; out.height=height; const ctx=out.getContext("2d");
      const sourceRatio=p.width/p.height,targetRatio=width/height; let sx=0,sy=0,sw=p.width,sh=p.height;
      if(sourceRatio>targetRatio){sw=p.height*targetRatio;sx=(p.width-sw)/2}else{sh=p.width/targetRatio;sy=(p.height-sh)/2}
      ctx.drawImage(p,sx,sy,sw,sh,0,0,width,height);
      const sr=stage.getBoundingClientRect(),lr=logo.getBoundingClientRect();
      const lw=lr.width/sr.width*width,lh=lr.height/sr.height*height,lx=(lr.left+lr.width/2-sr.left)/sr.width*width-lw/2,ly=(lr.top+lr.height/2-sr.top)/sr.height*height-lh/2;
      ctx.drawImage(l,lx,ly,lw,lh);
      out.toBlob(blob=>{if(!blob){setStatus("Не удалось подготовить PNG.","error");return}const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`poster-${state.format}.png`;a.style.display="none";document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(url);a.remove()},1000);setStatus("PNG скачан.","ok")},"image/png");
    };
    p.onerror=()=>setStatus("Не удалось подготовить постер.","error"); l.onerror=()=>setStatus("Не удалось подготовить логотип.","error"); p.src=state.poster; l.src=state.logo;
  }

  $("posterFileInput").onchange=e=>readFile(e.target.files?.[0],poster,"poster");
  $("posterLogoInput").onchange=e=>readFile(e.target.files?.[0],logo,"logo");
  document.querySelectorAll(".poster-format").forEach(btn=>btn.onclick=()=>setFormat(btn.dataset.posterFormat));
  $("posterPosition").onchange=e=>setPosition(e.target.value);
  $("posterScale").oninput=e=>{state.scale=Number(e.target.value);applyPosition()};
  $("posterCenterBtn").onclick=()=>setPosition("center");
  $("posterResetBtn").onclick=()=>{state.scale=100;$("posterScale").value=100;$("posterPosition").value="center";setPosition("center")};
  $("posterExportBtn").onclick=exportPoster;
  logo.addEventListener("pointerdown",e=>{if(logo.hidden||e.button!==0)return;const sr=stage.getBoundingClientRect(),lr=logo.getBoundingClientRect();state.drag=true;state.grabX=e.clientX-(lr.left+lr.width/2);state.grabY=e.clientY-(lr.top+lr.height/2);logo.classList.add("dragging","selected");logo.setPointerCapture(e.pointerId);e.preventDefault()});
  logo.addEventListener("pointermove",e=>{if(!state.drag)return;const sr=stage.getBoundingClientRect();state.x=(e.clientX-state.grabX-sr.left)/sr.width*100;state.y=(e.clientY-state.grabY-sr.top)/sr.height*100;applyPosition()});
  ["pointerup","pointercancel"].forEach(type=>logo.addEventListener(type,()=>{state.drag=false;logo.classList.remove("dragging")}));
  logo.addEventListener("wheel",e=>{e.preventDefault();state.scale=Math.max(10,Math.min(300,state.scale+(e.deltaY<0?5:-5)));$("posterScale").value=state.scale;applyPosition()},{passive:false});
  document.addEventListener("keydown",e=>{if(e.key.toLowerCase()==="r"&&$("posterHost").classList.contains("active")){state.scale=100;$("posterScale").value=100;setPosition("center")}});
  setFormat("vertical"); update();
  return { resize:()=>requestAnimationFrame(applyPosition), setFormat };
})();
