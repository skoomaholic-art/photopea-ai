(() => {
  const KEY_NAME="poster-editor-server-library-key-v1";
  const MIGRATION_PREFIX="poster-editor-server-migrated-v1:";
  function getKey(){
    let key=localStorage.getItem(KEY_NAME);
    if(!key){
      key=(crypto.randomUUID?.()||Math.random().toString(36).slice(2))+"."+(crypto.randomUUID?.()||Math.random().toString(36).slice(2));
      localStorage.setItem(KEY_NAME,key);
    }
    return key;
  }
  function headers(extra={}){return {"Content-Type":"application/json","X-Library-Key":getKey(),...extra};}
  async function request(path,options={}){
    const response=await fetch(path,{...options,headers:headers(options.headers||{}),cache:"no-store"});
    let data={};try{data=await response.json();}catch{}
    if(!response.ok)throw new Error(data.message||data.error||("Серверное хранилище: HTTP "+response.status));
    return data;
  }
  function blobToDataUrl(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob);});}
  function dataUrlToBlob(value){
    const m=String(value||"").match(/^data:([^;]+);base64,(.+)$/);
    if(!m)throw new Error("Сервер вернул повреждённый файл.");
    const bin=atob(m[2]);const bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
    return new Blob([bytes],{type:m[1]});
  }
  function hydrateLogo(item){return {...item,originalAsset:dataUrlToBlob(item.dataUrl)};}
  async function saveLogo(item){
    const dataUrl=await blobToDataUrl(item.originalAsset);
    const saved=await request("/api/library/logos",{method:"POST",body:JSON.stringify({...item,originalAsset:undefined,dataUrl})});
    return hydrateLogo(saved.item);
  }
  async function listLogos(){const r=await request("/api/library/logos");return (r.items||[]).map(hydrateLogo);}
  async function renameLogo(id,title){const r=await request("/api/library/logos/"+encodeURIComponent(id),{method:"PATCH",body:JSON.stringify({title})});return hydrateLogo(r.item);}
  async function deleteLogo(id){await request("/api/library/logos/"+encodeURIComponent(id),{method:"DELETE"});}
  async function saveWork(item){const r=await request("/api/library/works",{method:"POST",body:JSON.stringify(item)});return r.item;}
  async function listWorks(workspace=null){const q=workspace?"?workspace="+encodeURIComponent(workspace):"";const r=await request("/api/library/works"+q);return r.items||[];}
  async function getWork(id){const r=await request("/api/library/works/"+encodeURIComponent(id));return r.item;}
  async function renameWork(id,title){const r=await request("/api/library/works/"+encodeURIComponent(id),{method:"PATCH",body:JSON.stringify({title})});return r.item;}
  async function deleteWork(id){await request("/api/library/works/"+encodeURIComponent(id),{method:"DELETE"});}
  async function status(){return request("/api/library/status");}
  function migrationDone(name){return localStorage.getItem(MIGRATION_PREFIX+name)==="1";}
  function markMigrated(name){localStorage.setItem(MIGRATION_PREFIX+name,"1");}
  async function copyKey(){await navigator.clipboard?.writeText(getKey());return getKey();}
  function setKey(value){
    value=String(value||"").trim();
    if(value.length<20||value.length>200)throw new Error("Ключ синхронизации должен содержать 20-200 символов.");
    localStorage.setItem(KEY_NAME,value);location.reload();
  }
  window.ServerLibrary={getKey,setKey,copyKey,status,saveLogo,listLogos,renameLogo,deleteLogo,saveWork,listWorks,getWork,renameWork,deleteWork,migrationDone,markMigrated};
})();