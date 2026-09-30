(() => {
  const clean = value => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const imageUrl = value => {
    try { const u=new URL(value); return u.protocol==='https:' && ['static.tvmaze.com','upload.wikimedia.org'].includes(u.hostname) ? u.href : null; }
    catch { return null; }
  };
  function message(error) {
    if(error?.status===429) return 'Превышен лимит источника. Повторите поиск позже.';
    if(error?.status===401 || error?.status===403) return 'Источник не разрешил запрос.';
    if(error?.name==='TimeoutError') return 'Источник не ответил вовремя.';
    return 'Источник временно недоступен. Проверьте соединение.';
  }
  async function json(url, signal) {
    const combined=AbortSignal.any([signal,AbortSignal.timeout(12000)].filter(Boolean));
    const response=await fetch(url,{signal:combined,credentials:'omit',referrerPolicy:'no-referrer'});
    if(!response.ok) throw Object.assign(new Error('Public source request failed'),{status:response.status});
    return response.json();
  }
  function asset(source, id, title, url, thumb, extra={}) {
    const original=imageUrl(url);if(!original)return null;
    const width=Number(extra.width)||null,height=Number(extra.height)||null,ratio=width&&height?width/height:null;
    return {id:source+':'+id,source,sourceId:String(id),title:clean(title),imageType:'poster',
      originalUrl:original,proxyUrl:original,thumbnailUrl:imageUrl(thumb)||original,
      directPublic:true,width,height,aspectRatio:ratio,language:null,isTextless:null,
      shape:ratio?(ratio<.9?'vertical':ratio>1.2?'horizontal':'square'):'unknown',...extra};
  }
  async function tvmaze(query, year, signal) {
    const data=await json('https://api.tvmaze.com/search/shows?q='+encodeURIComponent(query),signal);
    if(!Array.isArray(data))throw new Error('Invalid TVmaze response');
    return data.map(item=>item.show).filter(show=>show && (!year || String(show.premiered||'').startsWith(year)))
      .map(show=>asset('TVmaze',show.id,show.name,show.image?.original,show.image?.medium,{
        year:String(show.premiered||'').slice(0,4),mediaType:'tv',shape:'vertical',
        sourceUrl:'https://www.tvmaze.com/shows/'+encodeURIComponent(show.id),
        attribution:'TVmaze',license:'Данные: CC BY-SA. Права на изображение проверяйте у источника.'
      })).filter(Boolean);
  }
  async function commons(query, year, signal) {
    const params=new URLSearchParams({action:'query',format:'json',origin:'*',generator:'search',
      gsrsearch:query+(year?' '+year:''),gsrnamespace:'6',gsrlimit:'24',prop:'imageinfo',
      iiprop:'url|size|mime|extmetadata',iiurlwidth:'400'});
    const data=await json('https://commons.wikimedia.org/w/api.php?'+params,signal);
    if(data.error)throw new Error('Commons request failed');
    return Object.values(data.query?.pages||{}).map(page=>{
      const info=page.imageinfo?.[0];if(!/^image\/(png|jpeg|webp)$/.test(info?.mime||''))return null;
      const meta=info.extmetadata||{};
      return asset('Wikimedia',page.pageid,String(page.title||'').replace(/^File:/,''),info.url,info.thumburl,{
        sourceUrl:'https://commons.wikimedia.org/wiki/'+encodeURIComponent(page.title),
        width:info.width,height:info.height,imageType:'image',
        shape:info.width/info.height>1.2?'horizontal':info.width/info.height<.9?'vertical':'square',
        license:clean(meta.LicenseShortName?.value)||'Смотрите лицензию на странице файла',
        attribution:clean(meta.Artist?.value),year:'',mediaType:null
      });
    }).filter(Boolean);
  }

  // Wikidata stores structured title/type IDs as CC0 data. Each image itself
  // is resolved through the Commons file API so its *own* license can be shown.
  // Do not equate CC0 Wikidata metadata with copyright clearance of an image.
  async function wikidata(query, year, signal) {
    const language=/[А-Яа-яЁёҚқҒғҮүҰұІіӘәӨөҺһ]/.test(query)?"ru":"en";
    const searchParams=new URLSearchParams({
      action:"wbsearchentities",format:"json",origin:"*",language,search:query,limit:"12"
    });
    const found=await json("https://www.wikidata.org/w/api.php?"+searchParams,signal);
    if(found.error)throw new Error("Wikidata entity search failed");
    const candidates=(found.search||[]).filter(row=>
      /film|movie|television|tv series|tv show|фильм|сериал|телесериал|мультфильм/i.test(
        String(row.description||"")
      )
    ).slice(0,8);
    if(!candidates.length)return [];
    const ids=candidates.map(row=>row.id).join("|");
    const entityParams=new URLSearchParams({action:"wbgetentities",format:"json",origin:"*",ids,props:"claims"});
    const payload=await json("https://www.wikidata.org/w/api.php?"+entityParams,signal);
    const files=new Map();
    for(const candidate of candidates){
      const item=payload.entities?.[candidate.id];
      if(!item||item.missing!==undefined)continue;
      const born=String(item.claims?.P577?.[0]?.mainsnak?.datavalue?.value?.time||"");
      const publishedYear=born.match(/[+-](\d{4})-/)?.[1]||"";
      if(year && publishedYear && year!==publishedYear)continue;
      for(const [prop,kind] of [["P154","logo"],["P18","poster"]]){
        const filename=item.claims?.[prop]?.[0]?.mainsnak?.datavalue?.value;
        if(typeof filename!=="string"||!filename.trim())continue;
        const key=filename.trim().replace(/_/g," ").toLowerCase();
        if(!files.has(key))files.set(key,[]);
        files.get(key).push({file:filename,title:candidate.label||query,year:publishedYear,
          kind,qid:candidate.id,description:candidate.description||""});
      }
    }
    if(!files.size)return [];
    const filenames=[...files.values()].map(links=>links[0].file);
    const fileParams=new URLSearchParams({
      action:"query",format:"json",origin:"*",prop:"imageinfo",
      titles:filenames.map(name=>"File:"+name).join("|"),
      iiprop:"url|size|mime|extmetadata",iiurlwidth:"400"
    });
    const metadata=await json("https://commons.wikimedia.org/w/api.php?"+fileParams,signal);
    if(metadata.error)throw new Error("Commons image metadata unavailable");
    const results=[];
    for(const page of Object.values(metadata.query?.pages||{})){
      const info=page.imageinfo?.[0];
      if(!/^image\/(?:png|jpeg|webp)$/.test(info?.mime||""))continue;
      const filename=String(page.title||"").replace(/^File:/,"");
      const rows=files.get(filename.replace(/_/g," ").toLowerCase())||[];
      for(const row of rows){
        const more=info.extmetadata||{},ratio=info.width/info.height;
        const result=asset("Wikidata",row.qid+":"+row.kind,row.title,info.url,info.thumburl,{
          imageType:row.kind,width:info.width,height:info.height,
          shape:ratio>1.2?"horizontal":ratio<.9?"vertical":"square",
          year:row.year,mediaType:/television|tv |сериал/i.test(row.description)?"tv":"movie",
          sourceUrl:"https://commons.wikimedia.org/wiki/"+encodeURIComponent(page.title),
          license:clean(more.LicenseShortName?.value)||"Проверьте лицензию конкретного файла",
          attribution:clean(more.Artist?.value),
          isTextless:row.kind==="logo"?null:null
        });
        if(result)results.push(result);
      }
    }
    return results;
  }

  async function search(query, year, signal) {
    const sources=[['tvmaze','TVmaze',()=>tvmaze(query,year,signal)],['wikimedia','Wikimedia Commons',()=>commons(query,year,signal)],['wikidata','Wikidata',()=>wikidata(query,year,signal)]];
    const settled=await Promise.allSettled(sources.map(([, , run])=>run()));
    if(signal?.aborted)throw signal.reason;
    const results=[],errors=[],providers={tmdb:{enabled:false,reason:'Нужен настроенный сервер'},fanart:{enabled:false,reason:'Нужен настроенный сервер'}};
    settled.forEach((result,i)=>{
      const [key,label]=sources[i];providers[key]={configured:true,enabled:result.status==='fulfilled',reason:'Прямой официальный API без ключа'};
      if(result.status==='fulfilled')results.push(...result.value);
      else {providers[key].reason=message(result.reason);errors.push({source:key,message:label+': '+message(result.reason)});}
    });
    return {results,errors,providers,fallback:true,_wikidataMerged:true,identity:null,candidates:[],references:[
      {name:'TVmaze',url:'https://www.tvmaze.com/api',mode:'automatic'},
      {name:'Wikimedia Commons',url:'https://commons.wikimedia.org',mode:'automatic'},
      {name:'Wikidata',url:'https://www.wikidata.org/wiki/Wikidata:Data_access',mode:'automatic'}
    ]};
  }
  window.PublicImageSearch={search,wikidata};
})();
