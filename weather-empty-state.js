(() => {
  const CITY={lat:43.238949,lon:76.889709,tz:"Asia/Almaty"};
  const REFRESH=15*60*1000;
  const $=id=>document.getElementById(id);
  const scenes=[
    {host:"stage",panel:"posterWorkspace",orientation:()=>window.PosterApp?.getActiveFormat?.()==="horizontal"?"horizontal":"vertical",empty:()=>window.PosterApp?.hasUserImages?.()!==true},
    {host:"trainCanvasShell",panel:"trainWorkspace",orientation:()=>"wide",empty:()=>window.TrainEditor?.hasUserImages?.()!==true},
    {host:"top10CanvasShell",panel:"top10Workspace",orientation:()=>"vertical",empty:()=>window.Top10Editor?.hasUserImages?.()!==true}
  ];
  const mounted=[];
  let weather=null,lastFetch=0;

  function localParts(){
    const parts=Object.fromEntries(new Intl.DateTimeFormat("en-GB",{timeZone:CITY.tz,hour12:false,hour:"2-digit",minute:"2-digit",weekday:"short"}).formatToParts(new Date()).filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));
    return {hour:Number(parts.hour),minute:Number(parts.minute),weekday:parts.weekday};
  }
  function minutesOfDay(value){
    const match=String(value||"").match(/T(\d{2}):(\d{2})/);
    return match ? Number(match[1])*60+Number(match[2]) : null;
  }
  function period(isDay,sunrise=null,sunset=null){
    const p=localParts(),now=p.hour*60+p.minute;
    const rise=minutesOfDay(sunrise),set=minutesOfDay(sunset);
    if(Number.isFinite(rise)&&Number.isFinite(set)){
      if(now<rise||now>=set+45)return "night";
      if(now<rise+150)return "morning";
      if(now>=set-120)return "evening";
      return "day";
    }
    const h=p.hour;
    if(isDay===false||h<5||h>=22)return "night";
    if(h<10)return "morning";
    if(h<17)return "day";
    return "evening";
  }
  function fallback(){
    const p=period(null,null,null);
    return {temperature:null,weatherCode:null,clouds:null,precipitation:0,rain:0,snowfall:0,isDay:p!=="night",period:p,source:"fallback"};
  }
  function condition(w){
    const code=Number(w.weatherCode),snow=(w.snowfall||0)>0||[71,73,75,77,85,86].includes(code);
    const rain=(w.rain||0)>0||(w.precipitation||0)>0||[51,53,55,56,57,61,63,65,66,67,80,81,82,95,96,99].includes(code);
    if(snow)return "snow"; if(rain)return "rain";
    if((w.clouds||0)>=55||[2,3,45,48].includes(code))return "cloud";
    if([0,1].includes(code))return "sun";
    return "neutral";
  }
  async function loadWeather(force=false){
    if(!force&&weather&&Date.now()-lastFetch<REFRESH)return weather;
    lastFetch=Date.now();
    try{
      const q=new URLSearchParams({
        latitude:String(CITY.lat),longitude:String(CITY.lon),
        current:"temperature_2m,weather_code,cloud_cover,is_day,precipitation,rain,snowfall",
        daily:"sunrise,sunset",timezone:CITY.tz,forecast_days:"1"
      });
      const response=await fetch("https://api.open-meteo.com/v1/forecast?"+q.toString(),{cache:"no-store",signal:AbortSignal.timeout(7000)});
      if(!response.ok)throw new Error("weather");
      const data=await response.json(),c=data.current||{};
      weather={temperature:Number.isFinite(Number(c.temperature_2m))?Number(c.temperature_2m):null,weatherCode:Number(c.weather_code),
        clouds:Number(c.cloud_cover)||0,precipitation:Number(c.precipitation)||0,rain:Number(c.rain)||0,snowfall:Number(c.snowfall)||0,
        isDay:c.is_day===1,sunrise:data.daily?.sunrise?.[0]||null,sunset:data.daily?.sunset?.[0]||null,source:"open-meteo"};
      weather.period=period(weather.isDay,weather.sunrise,weather.sunset);
    }catch{weather=fallback();}
    sync();return weather;
  }
  function state(){
    const w=weather||fallback(),kind=condition(w),temp=w.temperature;
    const cold=Number.isFinite(temp)?temp<=3:kind==="snow";
    return {...w,kind,cold,sleeping:w.period==="night"};
  }
  function sceneMarkup(){
    return '<div class="cat-room">'
      +'<div class="cat-window"><div class="cat-sky"></div><div class="cat-sun"></div><div class="cat-cloud cat-cloud-a"></div><div class="cat-cloud cat-cloud-b"></div><div class="cat-rain"></div><div class="cat-snow"></div><i class="window-bar v"></i><i class="window-bar h"></i></div>'
      +'<div class="cat-lamp"><i class="lamp-shade"></i><i class="lamp-stem"></i><i class="lamp-glow"></i></div>'
      +'<div class="cat-shelf"><i></i><i></i><i></i><i></i></div>'
      +'<div class="cat-rug"></div>'
      +'<div class="cat-awake-wrap"><div class="cat-chair"></div><div class="cat-person"><i class="cat-tail"></i><i class="cat-torso"></i><i class="cat-head"><b class="ear left"></b><b class="ear right"></b><em class="eye left"></em><em class="eye right"></em><span class="muzzle"></span></i><i class="cat-arm left"></i><i class="cat-arm right"></i></div><div class="cat-cup"></div></div>'
      +'<div class="cat-sleep-wrap"><div class="cat-bed"></div><div class="cat-sleeper"><i class="cat-head"><b class="ear left"></b><b class="ear right"></b><em class="sleep-eye left"></em><em class="sleep-eye right"></em><span class="muzzle"></span></i><i class="cat-pillow"></i><i class="cat-blanket light"></i><i class="cat-blanket warm"></i></div></div>'
      +'</div><div class="cat-scene-hud"><div><strong class="cat-scene-title">Дома хорошо</strong><span class="cat-scene-sub">Алматы</span></div><div class="cat-scene-weather"><b class="cat-scene-temp">Алматы</b><span class="cat-scene-condition">Погода</span></div></div>';
  }
  function make(cfg){
    const host=$(cfg.host); if(!host)return null;
    const root=document.createElement("div");root.className="weather-empty-state";root.hidden=true;root.innerHTML=sceneMarkup();host.append(root);
    return {cfg,root,lastKey:""};
  }
  function renderPrecip(root,kind){
    const rain=root.querySelector(".cat-rain"),snow=root.querySelector(".cat-snow");
    if(rain&&!rain.childElementCount)for(let i=0;i<28;i++){const s=document.createElement("i");s.style.left=((i*37)%100)+"%";s.style.animationDelay=(-i*.11)+"s";rain.append(s);}
    if(snow&&!snow.childElementCount)for(let i=0;i<34;i++){const s=document.createElement("i");s.style.left=((i*47)%100)+"%";s.style.animationDelay=(-i*.17)+"s";snow.append(s);}
    rain.hidden=kind!=="rain";snow.hidden=kind!=="snow";
  }
  function apply(item){
    const s=state(),orientation=item.cfg.orientation(),key=[s.period,s.kind,s.cold,orientation,Math.round(s.temperature||0)].join("|");
    if(key===item.lastKey)return;item.lastKey=key;
    const r=item.root;r.dataset.period=s.period;r.dataset.condition=s.kind;r.dataset.orientation=orientation;
    r.classList.toggle("sleeping",s.sleeping);r.classList.toggle("awake",!s.sleeping);r.classList.toggle("cold-night",s.sleeping&&s.cold);
    const title=s.sleeping?(s.cold?"Тихая холодная ночь":"Спокойной ночи"):(s.period==="morning"?"Доброе утро":s.period==="evening"?"Тихий вечер":"Дома хорошо");
    r.querySelector(".cat-scene-title").textContent=title;
    r.querySelector(".cat-scene-sub").textContent="Алматы · "+(s.source==="open-meteo"?"живая погода":"локальное время");
    r.querySelector(".cat-scene-temp").textContent=Number.isFinite(s.temperature)?Math.round(s.temperature)+"°":"Алматы";
    r.querySelector(".cat-scene-condition").textContent=s.kind==="snow"?"Снег":s.kind==="rain"?"Дождь":s.kind==="sun"?"Солнечно":s.kind==="cloud"?"Облачно":s.period==="night"?"Ночь":"Спокойно";
    renderPrecip(r,s.kind);
  }
  function sync(){
    for(const item of mounted){
      let empty=false;try{empty=item.cfg.empty();}catch{}
      if(empty){apply(item);item.root.hidden=false;item.root.classList.remove("leaving");}
      else if(!item.root.hidden){item.root.classList.add("leaving");setTimeout(()=>{let e=false;try{e=item.cfg.empty();}catch{}if(!e){item.root.hidden=true;item.root.classList.remove("leaving");}},240);}
    }
  }
  scenes.forEach(x=>{const item=make(x);if(item)mounted.push(item);});
  weather=fallback();sync();loadWeather(true);
  setInterval(sync,450);setInterval(()=>loadWeather(true),REFRESH);
  addEventListener("pageshow",sync);addEventListener("resize",sync);
  document.addEventListener("visibilitychange",()=>{if(!document.hidden){sync();loadWeather();}});
  window.WeatherEmptyState={sync,refresh:()=>loadWeather(true),getWeather:()=>({...state()})};
})();