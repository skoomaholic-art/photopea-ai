window.Media = (() => {
  const $ = id => document.getElementById(id);

  function status(message, kind = "") {
    const el = $("mediaStatus");
    el.textContent = message;
    el.className = "drawer-status" + (kind ? " " + kind : "");
  }

  function stripHtml(value) {
    const div = document.createElement("div");
    div.innerHTML = value || "";
    return div.textContent || "";
  }

  function year(value) {
    return value ? String(value).slice(0,4) : "";
  }

  function tmdbHeaders() {
    return { Authorization:"Bearer " + APP.cfg.tmdb, Accept:"application/json" };
  }

  function claimValue(claims,pid) {
    return claims?.[pid]?.[0]?.mainsnak?.datavalue?.value;
  }

  async function cached(key, producer, ttlMs = 20 * 60 * 1000) {
    try {
      const hit = await SkoomaStore.getCache("media:" + key);
      if (hit !== null && hit !== undefined) return hit;
    } catch {}
    const value = await producer();
    try { await SkoomaStore.setCache("media:" + key, value, ttlMs); } catch {}
    return value;
  }

  const providers = {
    tvmaze: {
      label:"TVmaze",
      enabled:()=>true,
      async search(query) {
        const response=await fetch("https://api.tvmaze.com/search/shows?q="+encodeURIComponent(query));
        if(!response.ok)throw new Error("TVmaze HTTP "+response.status);
        const rows=await response.json();
        return rows.map(row=>{
          const show=row.show;
          return {
            provider:"TVmaze",providerKey:"tvmaze",id:show.id,title:show.name,originalTitle:show.name,
            year:year(show.premiered),type:"series",poster:show.image?.medium||show.image?.original||"",
            overview:stripHtml(show.summary),sourceUrl:show.url,raw:show
          };
        });
      },
      async details(item) {
        const base="https://api.tvmaze.com/shows/"+item.id;
        const [showR,imagesR,seasonsR,episodesR,castR]=await Promise.all([
          fetch(base),fetch(base+"/images"),fetch(base+"/seasons"),fetch(base+"/episodes"),fetch(base+"/cast")
        ]);
        if(!showR.ok)throw new Error("TVmaze details HTTP "+showR.status);
        const show=await showR.json();
        const images=imagesR.ok?await imagesR.json():[];
        const seasons=seasonsR.ok?await seasonsR.json():[];
        const episodes=episodesR.ok?await episodesR.json():[];
        const cast=castR.ok?await castR.json():[];
        return {
          overview:stripHtml(show.summary),
          meta:{
            Status:show.status,
            Runtime:show.runtime?show.runtime+" min":"",
            Genres:(show.genres||[]).join(", "),
            Language:show.language||"",
            Network:show.network?.name||show.webChannel?.name||"",
            Seasons:String(seasons.length||""),
            Episodes:String(episodes.length||""),
            Cast:cast.slice(0,8).map(row=>row.person?.name).filter(Boolean).join(", ")
          },
          artwork:images.map(image=>({
            url:image.resolutions?.original?.url||image.resolutions?.medium?.url,
            kind:image.type==="background"?"backdrop":image.type||"image",
            source:"TVmaze",
            meta:{ width:image.resolutions?.original?.width,height:image.resolutions?.original?.height }
          })).filter(image=>image.url)
        };
      }
    },

    omdb: {
      label:"OMDb",
      enabled:()=>!!APP.cfg.omdb,
      async search(query) {
        const response=await fetch("https://www.omdbapi.com/?apikey="+encodeURIComponent(APP.cfg.omdb)+"&s="+encodeURIComponent(query));
        if(!response.ok)throw new Error("OMDb HTTP "+response.status);
        const data=await response.json();
        if(data.Response==="False")return[];
        return (data.Search||[]).map(item=>({
          provider:"OMDb",providerKey:"omdb",id:item.imdbID,title:item.Title,originalTitle:item.Title,
          year:item.Year,type:item.Type,poster:item.Poster&&item.Poster!=="N/A"?item.Poster:"",
          overview:"",sourceUrl:"https://www.imdb.com/title/"+item.imdbID+"/",raw:item
        }));
      },
      async details(item) {
        const response=await fetch("https://www.omdbapi.com/?apikey="+encodeURIComponent(APP.cfg.omdb)+"&i="+encodeURIComponent(item.id)+"&plot=full");
        if(!response.ok)throw new Error("OMDb HTTP "+response.status);
        const data=await response.json();
        if(data.Response==="False")throw new Error(data.Error||"OMDb error");
        return {
          overview:data.Plot&&data.Plot!=="N/A"?data.Plot:"",
          meta:{
            Year:data.Year,Rated:data.Rated,Released:data.Released,Runtime:data.Runtime,Genres:data.Genre,
            Director:data.Director,Writer:data.Writer,Actors:data.Actors,IMDb:data.imdbRating,Awards:data.Awards,
            "IMDb ID":data.imdbID
          },
          artwork:data.Poster&&data.Poster!=="N/A"?[{url:data.Poster,kind:"poster",source:"OMDb"}]:[]
        };
      }
    },

    tmdb: {
      label:"TMDB",
      enabled:()=>!!APP.cfg.tmdb,
      async search(query) {
        const response=await fetch(
          "https://api.themoviedb.org/3/search/multi?query="+encodeURIComponent(query)+"&language=ru-RU&include_adult=false",
          {headers:tmdbHeaders()}
        );
        if(!response.ok)throw new Error("TMDB HTTP "+response.status);
        const data=await response.json();
        return (data.results||[])
          .filter(item=>["movie","tv","person"].includes(item.media_type))
          .map(item=>({
            provider:"TMDB",providerKey:"tmdb",id:item.id,
            title:item.title||item.name||item.original_name,
            originalTitle:item.original_title||item.original_name||item.name,
            year:year(item.release_date||item.first_air_date),
            type:item.media_type==="movie"?"movie":item.media_type==="tv"?"series":"person",
            poster:item.poster_path?"https://image.tmdb.org/t/p/w500"+item.poster_path:
              item.profile_path?"https://image.tmdb.org/t/p/w500"+item.profile_path:"",
            backdrop:item.backdrop_path?"https://image.tmdb.org/t/p/w780"+item.backdrop_path:"",
            overview:item.overview||"",
            sourceUrl:"https://www.themoviedb.org/"+(item.media_type==="movie"?"movie/":item.media_type==="tv"?"tv/":"person/")+item.id,
            mediaType:item.media_type,raw:item
          }));
      },
      async details(item) {
        const type=item.mediaType||item.type;
        if(type==="person") {
          const r=await fetch("https://api.themoviedb.org/3/person/"+item.id+"?language=ru-RU",{headers:tmdbHeaders()});
          if(!r.ok)throw new Error("TMDB person HTTP "+r.status);
          const p=await r.json();
          return {
            overview:p.biography||"",
            meta:{ Birthday:p.birthday||"",Place:p.place_of_birth||"",KnownFor:p.known_for_department||"" },
            artwork:p.profile_path?[{url:"https://image.tmdb.org/t/p/original"+p.profile_path,kind:"portrait",source:"TMDB"}]:[]
          };
        }
        const endpoint=type==="movie"?"movie":"tv";
        const base="https://api.themoviedb.org/3/"+endpoint+"/"+item.id;
        const [detailsR,imagesR,creditsR,externalR]=await Promise.all([
          fetch(base+"?language=ru-RU",{headers:tmdbHeaders()}),
          fetch(base+"/images?include_image_language=ru,en,null",{headers:tmdbHeaders()}),
          fetch(base+"/credits?language=ru-RU",{headers:tmdbHeaders()}),
          fetch(base+"/external_ids",{headers:tmdbHeaders()})
        ]);
        if(!detailsR.ok)throw new Error("TMDB details HTTP "+detailsR.status);
        const details=await detailsR.json();
        const images=imagesR.ok?await imagesR.json():{};
        const credits=creditsR.ok?await creditsR.json():{};
        const external=externalR.ok?await externalR.json():{};
        const artwork=[];
        (images.posters||[]).slice(0,14).forEach(image=>artwork.push({
          url:"https://image.tmdb.org/t/p/w780"+image.file_path,kind:"poster",source:"TMDB",
          meta:{width:image.width,height:image.height,language:image.iso_639_1}
        }));
        (images.backdrops||[]).slice(0,14).forEach(image=>artwork.push({
          url:"https://image.tmdb.org/t/p/w1280"+image.file_path,kind:"backdrop",source:"TMDB",
          meta:{width:image.width,height:image.height,language:image.iso_639_1}
        }));
        (images.logos||[]).slice(0,12).forEach(image=>artwork.push({
          url:"https://image.tmdb.org/t/p/w780"+image.file_path,kind:"logo",source:"TMDB",
          meta:{width:image.width,height:image.height,language:image.iso_639_1}
        }));

        if(APP.cfg.fanart){
          try{
            const fanUrl=endpoint==="movie"
              ?"https://webservice.fanart.tv/v3.2/movies/"+item.id+"?api_key="+encodeURIComponent(APP.cfg.fanart)
              :external.tvdb_id
                ?"https://webservice.fanart.tv/v3.2/tv/"+external.tvdb_id+"?api_key="+encodeURIComponent(APP.cfg.fanart)
                :null;
            if(fanUrl){
              const fanR=await fetch(fanUrl);
              if(fanR.ok){
                const fan=await fanR.json();
                Object.entries(fan).forEach(([kind,list])=>{
                  if(!Array.isArray(list))return;
                  list.slice(0,6).forEach(image=>{
                    if(!image?.url)return;
                    const mapped=/logo/i.test(kind)?"logo":/background|fanart/i.test(kind)?"backdrop":/poster/i.test(kind)?"poster":/banner/i.test(kind)?"banner":kind;
                    artwork.push({
                      url:image.url,kind:mapped,source:"fanart.tv",
                      meta:{width:image.width,height:image.height,language:image.lang}
                    });
                  });
                });
              }
            }
          }catch{}
        }

        const directors=(credits.crew||[]).filter(person=>person.job==="Director").slice(0,4).map(person=>person.name);
        const cast=(credits.cast||[]).slice(0,10).map(person=>person.name);
        return {
          overview:details.overview||"",
          meta:{
            Runtime:details.runtime?details.runtime+" min":"",
            Genres:(details.genres||[]).map(row=>row.name).join(", "),
            Status:details.status||"",
            Original:details.original_title||details.original_name||"",
            Director:directors.join(", "),
            Cast:cast.join(", "),
            "TMDB ID":String(details.id||item.id),
            IMDb:external.imdb_id||details.imdb_id||"",
            TVDB:external.tvdb_id||""
          },
          artwork
        };
      }
    },

    wikidata: {
      label:"Wikidata",
      enabled:()=>true,
      async search(query) {
        const url="https://www.wikidata.org/w/api.php?action=wbsearchentities&search="+
          encodeURIComponent(query)+"&language=ru&uselang=ru&type=item&limit=15&format=json&origin=*";
        const response=await fetch(url);
        if(!response.ok)throw new Error("Wikidata HTTP "+response.status);
        const data=await response.json();
        const all=data.search||[];
        const media=all.filter(item=>/film|movie|телесериал|сериал|television|tv series|animated|мультфильм|cinema/i.test((item.description||"")+" "+(item.label||"")));
        return (media.length?media:all.slice(0,8)).map(item=>({
          provider:"Wikidata",providerKey:"wikidata",id:item.id,title:item.label||item.id,originalTitle:item.label||item.id,
          year:"",type:"metadata",poster:"",overview:item.description||"",sourceUrl:"https://www.wikidata.org/wiki/"+item.id,raw:item
        }));
      },
      async details(item) {
        const url="https://www.wikidata.org/w/api.php?action=wbgetentities&ids="+encodeURIComponent(item.id)+
          "&props=claims|labels|descriptions&languages=ru|en&format=json&origin=*";
        const response=await fetch(url);
        if(!response.ok)throw new Error("Wikidata HTTP "+response.status);
        const data=await response.json();
        const entity=data.entities?.[item.id]||{};
        const claims=entity.claims||{};
        const time=claimValue(claims,"P577");
        const official=claimValue(claims,"P856");
        return {
          overview:entity.descriptions?.ru?.value||entity.descriptions?.en?.value||item.overview||"",
          meta:{
            Wikidata:item.id,
            IMDb:claimValue(claims,"P345")||"",
            "TMDB Movie":claimValue(claims,"P4947")||"",
            "TMDB TV":claimValue(claims,"P4983")||"",
            "Release date":time?.time?String(time.time).replace(/^\+/,"").split("T")[0]:"",
            "Official website":official||""
          },
          artwork:[]
        };
      }
    }
  };

  async function imageToDataUrl(url) {
    const response=await fetch(url);
    if(!response.ok)throw new Error("Image HTTP "+response.status);
    const blob=await response.blob();
    return Studio.fileToDataUrl(new File([blob],"asset",{type:blob.type||"image/png"}));
  }

  async function materializeArtwork(artwork,title) {
    let src=artwork.url;
    try{src=await imageToDataUrl(artwork.url)}catch{}
    return APP.addAsset({
      name:title+" · "+artwork.kind,src,source:artwork.source,kind:artwork.kind,meta:artwork.meta||{}
    });
  }

  async function addArtworkToProject(artwork,title) {
    status("Добавляю artwork...");
    try{
      const asset=await materializeArtwork(artwork,title);
      await Studio.addImageFromUrl(asset.src,asset.name,asset);
      APP.switchEditor("skooma");$("editorSelect").value="skooma";
      status("Добавлено в Studio.","ok");
    }catch(error){status("Не удалось добавить изображение: "+error.message,"error")}
  }

  async function setArtworkBackground(artwork,title) {
    status("Устанавливаю фон...");
    try{
      const asset=await materializeArtwork(artwork,title);
      await Studio.setBackgroundFromUrl(asset.src,asset.name,asset);
      APP.switchEditor("skooma");$("editorSelect").value="skooma";
      status("Фон установлен.","ok");
    }catch(error){status("Не удалось установить фон: "+error.message,"error")}
  }

  async function downloadArtwork(artwork,title) {
    try{
      const response=await fetch(artwork.url);
      const blob=await response.blob();
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=url;a.download=(title+"-"+artwork.kind).replace(/[^\wа-яё-]+/gi,"_")+".png";a.click();
      setTimeout(()=>URL.revokeObjectURL(url),4000);
    }catch{window.open(artwork.url,"_blank","noopener")}
  }

  function metadataText(item,details) {
    const lines=[item.title,item.originalTitle!==item.title?item.originalTitle:"",item.year,item.type,item.provider]
      .filter(Boolean);
    Object.entries(details?.meta||{}).filter(([,value])=>value).forEach(([key,value])=>lines.push(key+": "+value));
    if(details?.overview)lines.push("",details.overview);
    return lines.join("\n");
  }

  function normalizeTitle(value) {
    return String(value||"").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
      .replace(/[^a-zа-яё0-9]+/gi," ").trim();
  }

  function mergeResults(items) {
    const map=new Map();
    const providerPriority={TMDB:4,OMDb:3,TVmaze:2,Wikidata:1};
    for(const item of items) {
      const key=normalizeTitle(item.title)+"|"+String(item.year||"")+"|"+String(item.type==="metadata"?"":item.type||"");
      if(!map.has(key)){
        map.set(key,{...item,sources:[item]});
        continue;
      }
      const base=map.get(key);
      base.sources.push(item);
      if(!base.poster&&item.poster)base.poster=item.poster;
      if(!base.backdrop&&item.backdrop)base.backdrop=item.backdrop;
      if(!base.overview&&item.overview)base.overview=item.overview;
      if((providerPriority[item.provider]||0)>(providerPriority[base.provider]||0)){
        const sources=base.sources;
        const preservedPoster=base.poster||item.poster;
        const preservedBackdrop=base.backdrop||item.backdrop;
        Object.assign(base,item);
        base.sources=sources;
        base.poster=preservedPoster;
        base.backdrop=preservedBackdrop;
      }
    }
    return [...map.values()];
  }

  function renderResults(items) {
    const root=$("mediaResults");
    root.innerHTML="";
    if(!items.length){root.innerHTML='<div class="empty-state">Ничего не найдено.</div>';return}
    items.slice(0,40).forEach(item=>{
      const card=document.createElement("article");
      card.className="media-card";
      const poster=item.poster?'<img class="media-poster" src="'+item.poster+'" alt="">':'<div class="media-poster"></div>';
      card.innerHTML=poster+
        '<div><div class="media-title">'+APP.escapeHtml(item.title)+'</div>'+
        '<div class="media-meta">'+APP.escapeHtml([item.originalTitle!==item.title?item.originalTitle:"",item.year,item.type].filter(Boolean).join(" · "))+'</div>'+
        '<div>'+(item.sources||[item]).map(source=>'<span class="asset-provider-badge">'+APP.escapeHtml(source.provider)+'</span>').join("")+'</div>'+
        '<div class="media-actions"><button class="secondary-button details-btn">Детали</button>'+
        (item.poster?'<button class="secondary-button poster-btn">Poster → Canvas</button>':'')+
        (item.sourceUrl?'<button class="secondary-button source-btn">Source</button>':'')+
        '</div></div>';
      card.querySelector(".details-btn").onclick=event=>{event.stopPropagation();loadDetails(item,card)};
      const posterBtn=card.querySelector(".poster-btn");
      if(posterBtn)posterBtn.onclick=async event=>{event.stopPropagation();await addArtworkToProject({url:item.poster,kind:"poster",source:item.provider},item.title)};
      const sourceBtn=card.querySelector(".source-btn");
      if(sourceBtn)sourceBtn.onclick=event=>{event.stopPropagation();window.open(item.sourceUrl,"_blank","noopener")};
      root.appendChild(card);
    });
  }

  function artworkCard(artwork,item) {
    const card=document.createElement("div");
    card.className="asset-card media-art-card";
    card.draggable=true;
    card.innerHTML='<img src="'+artwork.url+'" alt=""><div class="asset-info"><div class="asset-name">'+
      APP.escapeHtml(artwork.kind)+'</div><div class="asset-source">'+APP.escapeHtml(artwork.source)+'</div></div>'+
      '<div class="media-art-actions"><button class="small-button add-art">Add</button><button class="small-button bg-art">BG</button><button class="small-button dl-art">↓</button></div>';
    card.title="Double click: add to canvas";
    card.ondblclick=()=>addArtworkToProject(artwork,item.title);
    card.ondragstart=event=>{
      event.dataTransfer.setData("application/x-skooma-media-art",JSON.stringify({
        url:artwork.url,kind:artwork.kind,source:artwork.source,title:item.title,meta:artwork.meta||{}
      }));
      event.dataTransfer.effectAllowed="copy";
    };
    card.querySelector(".add-art").onclick=event=>{event.stopPropagation();addArtworkToProject(artwork,item.title)};
    card.querySelector(".bg-art").onclick=event=>{event.stopPropagation();setArtworkBackground(artwork,item.title)};
    card.querySelector(".dl-art").onclick=event=>{event.stopPropagation();downloadArtwork(artwork,item.title)};
    return card;
  }

  async function loadDetails(item,card) {
    const sources=item.sources||[item];
    status("Загружаю детали...");
    try{
      const settled=await Promise.allSettled(sources.map(source=>{
        const provider=providers[source.providerKey];
        if(!provider)return null;
        return cached(source.providerKey+":details:"+source.id,()=>provider.details(source),30*60*1000);
      }));
      const packets=settled.map((result,index)=>result.status==="fulfilled"&&result.value?{source:sources[index],details:result.value}:null).filter(Boolean);
      if(!packets.length)throw new Error("Не удалось загрузить детали ни у одного provider.");

      document.querySelectorAll(".media-detail-inline").forEach(node=>node.remove());
      const block=document.createElement("div");
      block.className="media-detail-inline";

      const preferred=[...packets].sort((a,b)=>{
        const rank={TMDB:4,OMDb:3,TVmaze:2,Wikidata:1};
        return (rank[b.source.provider]||0)-(rank[a.source.provider]||0);
      });
      const overview=preferred.find(packet=>packet.details.overview)?.details.overview||"";

      const mergedMeta=new Map();
      for(const packet of preferred){
        for(const [key,value] of Object.entries(packet.details.meta||{})){
          if(value&&!mergedMeta.has(key))mergedMeta.set(key,value);
        }
      }
      const meta=[...mergedMeta.entries()]
        .map(([key,value])=>'<div class="media-meta"><strong>'+APP.escapeHtml(key)+':</strong> '+APP.escapeHtml(value)+'</div>').join("");

      block.innerHTML='<div class="media-meta media-overview">'+APP.escapeHtml(overview)+'</div>'+meta+
        '<div class="media-actions details-actions"><button class="secondary-button copy-meta">Copy metadata</button></div>';

      block.querySelector(".copy-meta").onclick=async()=>{
        const synthetic={...item,provider:(item.sources||[item]).map(s=>s.provider).join(", ")};
        await navigator.clipboard.writeText(metadataText(synthetic,{overview,meta:Object.fromEntries(mergedMeta)}));
        status("Metadata скопированы.","ok");
      };

      const sourceLinks=document.createElement("div");
      sourceLinks.className="media-actions details-actions";
      sources.filter(source=>source.sourceUrl).forEach(source=>{
        const btn=document.createElement("button");
        btn.className="secondary-button";
        btn.textContent="Open "+source.provider;
        btn.onclick=()=>window.open(source.sourceUrl,"_blank","noopener");
        sourceLinks.appendChild(btn);
      });
      block.appendChild(sourceLinks);

      const artwork=[];
      const seenArt=new Set();
      packets.forEach(packet=>(packet.details.artwork||[]).forEach(art=>{
        if(!art?.url||seenArt.has(art.url))return;
        seenArt.add(art.url);artwork.push(art);
      }));

      if(artwork.length){
        const grouped={};
        artwork.forEach(art=>{const key=art.kind||"image";(grouped[key]??=[]).push(art)});
        const tabs=document.createElement("div");tabs.className="art-tabs";
        const artWrap=document.createElement("div");artWrap.className="asset-grid";artWrap.style.marginTop="8px";
        const order=["poster","backdrop","logo","still","banner","portrait","image"];
        const kinds=Object.keys(grouped).sort((a,b)=>{
          const ai=order.indexOf(a),bi=order.indexOf(b);
          return (ai<0?99:ai)-(bi<0?99:bi)||a.localeCompare(b);
        });
        let current=kinds[0];
        function renderKind(){
          artWrap.innerHTML="";
          (grouped[current]||[]).slice(0,32).forEach(art=>artWrap.appendChild(artworkCard(art,item)));
          [...tabs.children].forEach(btn=>btn.classList.toggle("active",btn.dataset.kind===current));
        }
        kinds.forEach(kind=>{
          const btn=document.createElement("button");btn.className="asset-filter";btn.dataset.kind=kind;
          btn.textContent=kind+" ("+grouped[kind].length+")";
          btn.onclick=()=>{current=kind;renderKind()};tabs.appendChild(btn);
        });
        renderKind();
        block.append(tabs,artWrap);
      }

      card.appendChild(block);
      status("Детали загружены из "+packets.map(p=>p.source.provider).join(", ")+".","ok");
    }catch(error){status(error.message,"error")}
  }

  async function search() {
    const query=$("mediaQuery").value.trim();
    if(!query)return status("Введите название.","error");
    const active=Object.values(providers).filter(provider=>provider.enabled());
    status("Ищу: "+active.map(provider=>provider.label).join(", ")+"...");
    const settled=await Promise.allSettled(active.map(provider=>
      cached(provider.label+":search:"+query.toLowerCase(),()=>provider.search(query),15*60*1000)
    ));
    const items=[],errors=[];
    settled.forEach((result,index)=>{
      if(result.status==="fulfilled")items.push(...result.value);
      else errors.push(active[index].label+": "+result.reason?.message);
    });
    const merged=mergeResults(items);
    renderResults(merged);
    if(errors.length)status("Найдено "+merged.length+". "+errors.join(" | "),"warn");
    else status("Найдено: "+merged.length,"ok");
  }

  function refreshProviderState() {
    $("omdbProviderChip").classList.toggle("active",!!APP.cfg.omdb);
    $("tmdbProviderChip").classList.toggle("active",!!APP.cfg.tmdb);
    const enabled=["TVmaze","Wikidata"];
    if(APP.cfg.omdb)enabled.push("OMDb");
    if(APP.cfg.tmdb)enabled.push("TMDB");
    status("Активные providers: "+enabled.join(", ")+".");
  }

  $("mediaSearchBtn").onclick=search;
  $("mediaQuery").onkeydown=event=>{if(event.key==="Enter")search()};
  $("openKinoriumBtn").onclick=()=>{
    const q=$("mediaQuery").value.trim();
    window.open(q?"https://ru.kinorium.com/search/?q="+encodeURIComponent(q):"https://ru.kinorium.com/","_blank","noopener");
  };
  $("openImdbBtn").onclick=()=>{
    const q=$("mediaQuery").value.trim();
    window.open(q?"https://www.imdb.com/find/?q="+encodeURIComponent(q):"https://www.imdb.com/","_blank","noopener");
  };

  try{SkoomaStore.clearExpiredCache()}catch{}
  refreshProviderState();
  return {search,refreshProviderState,providers,materializeArtwork};
})();