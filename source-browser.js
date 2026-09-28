(() => {
  const $ = id => document.getElementById(id);
  const apiBase=(document.querySelector('meta[name="poster-api"]')?.content||"").replace(/\/$/,"");
  const state={items:[],references:[],identity:null,candidates:[],providers:{},shown:48,tab:"all"};
  let activeSearch=null;

  function searchError(error) {
    if(error?.legacy) return "Сервер поиска устарел. Требуется обновить Cloudflare Worker.";
    if(error?.status===429) return "Превышен лимит поиска. Повторите позже.";
    if(error?.status===401 || error?.status===403) return "Нет доступа к серверу поиска. Проверьте его настройки.";
    if(error?.name==="TimeoutError") return "Сервер поиска не ответил вовремя.";
    return "Сервер поиска недоступен. Проверьте соединение и настройки сервера.";
  }

  function status(message,kind="") {
    $("sourceSearchStatus").textContent=message;
    $("sourceSearchStatus").className="mini-status "+kind;
    $("posterSearchStatus").textContent=message;
    $("posterSearchStatus").className="mini-status "+kind;
  }

  function open(prefill=true) {
    if(prefill) {
      $("sourceSearchQuery").value=$("posterSearchInput").value.trim();
      $("sourceSearchYear").value=$("posterSearchYear").value.trim();
    }
    $("sourceBrowserModal").hidden=false;
    document.body.classList.add("modal-open");
    $("sourceSearchQuery").focus();
  }

  function close() {
    $("sourceBrowserModal").hidden=true;
    document.body.classList.remove("modal-open");
  }

  function passes(item) {
    const source=$("sourceFilter").value;
    const format=$("formatFilter").value;
    const text=$("textFilter").value;
    const resolution=$("resolutionFilter").value;
    const language=$("languageFilter").value;

    if(state.tab==="poster" && item.imageType!=="poster") return false;
    if(state.tab==="horizontal" && !(item.imageType==="backdrop" || item.shape==="horizontal")) return false;
    if(state.tab==="still" && item.imageType!=="still") return false;
    if(state.tab==="textless" && item.isTextless!==true) return false;
    if(state.tab==="logo" && item.imageType!=="logo") return false;
    if(source!=="all" && String(item.source).toLowerCase().replace(/\s+/g,"")!==source) return false;
    if(format!=="all" && item.shape!==format) return false;
    if(text==="textless" && item.isTextless!==true) return false;
    if(text==="text" && item.isTextless!==false) return false;
    if(language==="none" && item.language!==null) return false;
    if(language!=="all" && language!=="none" && item.language!==language) return false;
    const max=Math.max(Number(item.width)||0,Number(item.height)||0);
    if(resolution==="fhd" && max<1920) return false;
    if(resolution==="2k" && max<2560) return false;
    if(resolution==="4k" && max<3840) return false;
    return true;
  }

  function filtered() {
    return state.items.filter(passes);
  }

  function detailText(item) {
    const ratio=item.aspectRatio?Number(item.aspectRatio).toFixed(2):"?";
    const lang=item.language||"без языка";
    const text=item.isTextless===true?"textless":item.isTextless===false?"с текстом":"текст ?";
    return [
      item.source,
      item.width&&item.height?(item.width+"×"+item.height):"размер ?",
      "AR "+ratio,
      lang,
      text,
      item.imageType
    ].filter(Boolean).join(" · ");
  }

  async function importAsset(item) {
    status("Загружаю оригинал...");
    const asset=await AssetManager.importRemote(item);
    status("Оригинал сохранён в Asset Manager.","ok");
    return asset;
  }

  async function useItem(item) {
    try {
      const asset=await importAsset(item);
      const src=await AssetManager.dataUrl(asset,true);
      const layer=item.imageType==="logo"?"logo":"poster";
      await WorkspaceTools.importImage(src,item.title||item.source,layer,{assetId:asset.id});
      close();
      status("Изображение добавлено в активный редактор.","ok");
    } catch(error) { status(error.message||"Не удалось импортировать изображение.","error"); }
  }

  async function filterItem(item) {
    try {
      const asset=await importAsset(item);
      await FilterStudio.openAsset(asset,{
        layer:item.imageType==="logo"?"logo":"poster",
        name:item.title||"Source asset"
      });
    } catch(error) { status(error.message||"Не удалось открыть фильтры.","error"); }
  }

  async function photopeaItem(item) {
    try {
      const asset=await importAsset(item);
      await PhotopeaBridge.openAsset(asset,{source:"search"});
      close();
    } catch(error) { status(error.message||"Не удалось открыть изображение в Photopea.","error"); }
  }

  async function downloadItem(item) {
    try {
      const blob=await AssetManager.fetchImageBlob(item.proxyUrl);
      PosterApp.downloadBlob(blob,(item.title||"source").replace(/[\\/:*?"<>|]+/g,"-")+"."+((blob.type||"").includes("png")?"png":"jpg"));
    } catch(error) { status(error.message||"Оригинал изображения недоступен.","error"); }
  }

  function renderProviderStatus() {
    const root=$("sourceProviderStatus");
    root.innerHTML="";
    const labels={tmdb:"TMDB",fanart:"Fanart.tv",wikimedia:"Wikimedia",tvmaze:"TVmaze"};
    for(const [key,label] of Object.entries(labels)) {
      const info=state.providers?.[key]||null;
      const pill=document.createElement("span");
      pill.className="service-pill "+(info?.enabled?"ok":info?.configured?"error":"muted");
      const stateText=info?.enabled?"Доступен":info?.configured?"Недоступен":"Не настроен";
      pill.textContent=label+" · "+stateText;
      if(info?.reason) pill.title=info.reason;
      root.appendChild(pill);
    }
  }

  function renderCandidates() {
    const root=$("sourceCandidates");
    root.innerHTML="";
    const candidates=Array.isArray(state.candidates)?state.candidates:[];
    if(candidates.length<=1) {
      root.hidden=true;
      return;
    }
    root.hidden=false;
    const label=document.createElement("strong");
    label.className="source-candidate-label";
    label.textContent="Найдено несколько вариантов. Выберите нужный:";
    root.appendChild(label);
    for(const candidate of candidates) {
      const button=document.createElement("button");
      button.type="button";
      button.className="source-candidate"+(
        state.identity?.tmdbId===candidate.tmdbId && state.identity?.mediaType===candidate.mediaType ? " active" : ""
      );
      const title=document.createElement("strong");
      title.textContent=candidate.title||candidate.originalTitle||"Без названия";
      const details=document.createElement("small");
      const original=candidate.originalTitle && candidate.originalTitle!==candidate.title ? candidate.originalTitle : "";
      details.textContent=[
        candidate.year||"год ?",
        candidate.mediaType==="tv"?"Сериал":"Фильм",
        original
      ].filter(Boolean).join(" · ");
      button.append(title,details);
      button.addEventListener("click",()=>{
        void search({tmdbId:candidate.tmdbId,mediaType:candidate.mediaType});
      });
      root.appendChild(button);
    }
  }

  function renderReferences() {
    const root=$("sourceReferences");
    root.innerHTML="";
    for(const ref of state.references||[]) {
      const button=document.createElement("button");
      button.type="button";
      button.className="reference-source";
      const strong=document.createElement("strong");
      strong.textContent=ref.name;
      const small=document.createElement("small");
      small.textContent=ref.mode==="automatic"?"API":"external/reference";
      button.append(strong,small);
      button.title=ref.reason||"";
      button.addEventListener("click",()=>window.open(ref.url,"_blank","noopener"));
      root.appendChild(button);
    }
  }

  function render() {
    const root=$("sourceGallery");
    root.innerHTML="";
    const items=filtered();
    const visible=items.slice(0,state.shown);
    for(const item of visible) {
      const card=document.createElement("article");
      card.className="source-card";
      const media=document.createElement("div");
      media.className="source-card-media";
      const img=document.createElement("img");
      img.src=item.thumbnailUrl||item.proxyUrl;
      img.alt=item.title||item.imageType||"Artwork";
      img.loading="lazy";
      img.addEventListener("error",()=>{img.hidden=true;media.classList.add("preview-unavailable");badge.textContent="Превью недоступно";});
      const badge=document.createElement("span");
      badge.textContent=item.isTextless===true?"TEXTLESS":String(item.imageType||"IMAGE").toUpperCase();
      media.append(img,badge);

      const body=document.createElement("div");
      body.className="source-card-body";
      const title=document.createElement("strong");
      title.textContent=[item.title,item.year].filter(Boolean).join(" · ")||"Без названия";
      const meta=document.createElement("small");
      meta.textContent=detailText(item);
      if(item.license) meta.title=item.license+(item.attribution?" · "+item.attribution:"");

      const actions=document.createElement("div");
      actions.className="source-card-actions";
      const defs=[
        ["Использовать",()=>useItem(item),"primary"],
        ["Фильтры",()=>filterItem(item),""],
        ["Photopea",()=>photopeaItem(item),""],
        ["Оригинал",()=>downloadItem(item),""],
        ["Источник",()=>item.sourceUrl&&window.open(item.sourceUrl,"_blank","noopener"),""]
      ];
      for(const [label,fn,klass] of defs) {
        const b=document.createElement("button"); b.type="button"; b.textContent=label; if(klass)b.className=klass; b.addEventListener("click",fn); actions.appendChild(b);
      }
      body.append(title,meta,actions);
      if(item.license || item.attribution) {
        const credit=document.createElement("small");
        credit.className="source-credit";
        credit.textContent=[item.attribution,item.license].filter(Boolean).join(" · ");
        body.appendChild(credit);
      }
      card.append(media,body);
      root.appendChild(card);
    }
    $("sourceLoadMoreBtn").hidden=visible.length>=items.length;
    $("sourceCount").textContent=items.length+" результатов";
    if(!items.length) {
      const empty=document.createElement("div");
      empty.className="source-empty";
      empty.textContent="По текущим фильтрам ничего нет.";
      root.appendChild(empty);
    }
    renderCandidates();
    renderProviderStatus();
    renderReferences();
  }

  async function search(forced={}) {
    const q=$("sourceSearchQuery").value.trim();
    const year=$("sourceSearchYear").value.trim();
    if(q.length<2) return status("Введите название фильма или сериала.","error");
    if(year && !/^\d{4}$/.test(year)) return status("Укажите год четырьмя цифрами.","error");
    activeSearch?.abort();
    const controller=new AbortController();activeSearch=controller;
    $("posterSearchInput").value=q; $("posterSearchYear").value=year;
    $("sourceSearchRun").disabled=true;
    status("Ищу TMDB / Fanart.tv / Commons / TVmaze...");
    try {
      const forcedId=forced?.tmdbId?String(forced.tmdbId):"";
      const forcedType=forced?.mediaType?String(forced.mediaType):"";
      const key="image-search:"+q.toLowerCase()+":"+year+":"+forcedType+":"+forcedId;
      let data=await SkoomaStore?.getCache?.(key).catch(()=>null);
      let fallbackReason="";
      if(!data) {
        const params=new URLSearchParams({q,year,source:"all"});
        if(forcedId) params.set("tmdbId",forcedId);
        if(forcedType) params.set("mediaType",forcedType);
        try {
          const response=await fetch(apiBase+"/api/images/search?"+params.toString(),{cache:"no-store",signal:AbortSignal.any([controller.signal,AbortSignal.timeout(12000)])});
          data=await response.json().catch(()=>({}));
          if(!response.ok || !Array.isArray(data.results)) throw Object.assign(new Error("Search request failed"),{
            status:response.status,legacy:[404,405].includes(response.status)||/use post/i.test(String(data.error||""))||response.ok
          });
          await SkoomaStore?.setCache?.(key,data,10*60*1000).catch(()=>{});
        } catch(error) {
          if(controller.signal.aborted)throw error;
          // Never retry a denied/rate-limited request or switch to a paid provider.
          if([401,403,429].includes(error.status) || !window.PublicImageSearch)throw error;
          fallbackReason=searchError(error);
          status(fallbackReason+" Ищу в открытых источниках...");
          data=await PublicImageSearch.search(q,year,controller.signal);
        }
      }
      if(controller!==activeSearch)return;
      state.items=Array.isArray(data.results)?data.results:[];
      state.references=Array.isArray(data.references)?data.references:[];
      state.identity=data.identity||null;
      state.candidates=Array.isArray(data.candidates)?data.candidates:[];
      state.providers=data.providers||{};
      state.shown=48;
      render();
      const problems=(data.errors||[]).map(x=>x.message).filter(Boolean);
      const identity=data.identity?[data.identity.title,data.identity.year].filter(Boolean).join(" · "):q;
      const fallback=data.fallback?fallbackReason+" Резервный поиск: TVmaze (сериалы) и Commons (свободные изображения). Покрытие тайтлов ограничено. ":"";
      status(fallback+identity+": "+state.items.length+" изображений."+(problems.length?" "+problems.join(" "):""),state.items.length?"ok":(problems.length?"error":""));
    } catch(error) {
      if(controller!==activeSearch || controller.signal.aborted)return;
      state.items=[]; state.references=[]; state.identity=null; state.candidates=[]; state.providers={}; render();
      status(searchError(error),"error");
    } finally {
      if(controller===activeSearch)$("sourceSearchRun").disabled=false;
    }
  }

  $("posterSearchBtn").addEventListener("click",()=>{open(true); if($("posterSearchInput").value.trim()) search();});
  $("posterSearchInput").addEventListener("keydown",e=>{if(e.key==="Enter"){open(true);search();}});
  $("sourceSearchRun").addEventListener("click",search);
  $("sourceSearchQuery").addEventListener("keydown",e=>{if(e.key==="Enter")search();});
  $("sourceBrowserClose").addEventListener("click",close);
  $("sourceBrowserModal").addEventListener("click",e=>{if(e.target===$("sourceBrowserModal"))close();});
  $("sourceLoadMoreBtn").addEventListener("click",()=>{state.shown+=48;render();});
  document.querySelectorAll("[data-image-tab]").forEach(btn=>btn.addEventListener("click",()=>{
    document.querySelectorAll("[data-image-tab]").forEach(x=>x.classList.remove("active"));
    btn.classList.add("active"); state.tab=btn.dataset.imageTab; state.shown=48; render();
  }));
  ["sourceFilter","formatFilter","textFilter","resolutionFilter","languageFilter"].forEach(id=>$(id).addEventListener("change",()=>{state.shown=48;render();}));

  window.AssetSourceBrowser={open,close,search,getState:()=>({...state})};
})();
