import {createHash,randomUUID} from "node:crypto";

export function createLibraryStore({env,fetchImpl=fetch}={}){
  const bucket=String(env.LIBRARY_BUCKET||"").trim();
  let tokenCache={value:"",expires:0};
  const ready=()=>Boolean(bucket);
  function namespace(key){
    key=String(key||"").trim();
    if(key.length<20||key.length>200)throw Object.assign(new Error("Нужен корректный X-Library-Key."),{status:401,code:"library_key_required"});
    return createHash("sha256").update(key).digest("hex").slice(0,40);
  }
  async function token(){
    if(env.GCP_ACCESS_TOKEN)return env.GCP_ACCESS_TOKEN;
    if(tokenCache.value&&Date.now()<tokenCache.expires-60000)return tokenCache.value;
    const r=await fetchImpl("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",{headers:{"Metadata-Flavor":"Google"}});
    if(!r.ok)throw Object.assign(new Error("Не удалось получить доступ к серверному хранилищу."),{status:503,code:"storage_auth"});
    const data=await r.json();tokenCache={value:data.access_token,expires:Date.now()+Number(data.expires_in||300)*1000};return tokenCache.value;
  }
  const enc=value=>encodeURIComponent(value);
  async function gcs(url,options={}){
    if(!ready())throw Object.assign(new Error("Серверное хранилище ещё не настроено."),{status:503,code:"library_not_configured"});
    const access=await token();
    const response=await fetchImpl(url,{...options,headers:{Authorization:"Bearer "+access,...(options.headers||{})}});
    if(!response.ok){
      const text=await response.text().catch(()=> "");
      throw Object.assign(new Error("Ошибка серверного хранилища ("+response.status+")."),{status:response.status===404?404:503,code:"storage_error",detail:text.slice(0,400)});
    }
    return response;
  }
  function objectName(key,kind,id){return "libraries/v1/"+namespace(key)+"/"+kind+"/"+String(id).replace(/[^a-zA-Z0-9._-]/g,"_")+".json";}
  async function put(key,kind,item,idField){
    const id=String(item?.[idField]||randomUUID());
    const object=objectName(key,kind,id);
    const body=JSON.stringify({...item,[idField]:id,serverStoredAt:Date.now()});
    await gcs("https://storage.googleapis.com/upload/storage/v1/b/"+enc(bucket)+"/o?uploadType=media&name="+enc(object),{method:"POST",headers:{"Content-Type":"application/json; charset=utf-8"},body});
    return JSON.parse(body);
  }
  async function getObject(key,kind,id){
    const object=objectName(key,kind,id);
    const response=await gcs("https://storage.googleapis.com/download/storage/v1/b/"+enc(bucket)+"/o/"+enc(object)+"?alt=media");
    return response.json();
  }
  async function del(key,kind,id){
    const object=objectName(key,kind,id);
    await gcs("https://storage.googleapis.com/storage/v1/b/"+enc(bucket)+"/o/"+enc(object),{method:"DELETE"});
  }
  async function list(key,kind){
    const prefix="libraries/v1/"+namespace(key)+"/"+kind+"/";
    const response=await gcs("https://storage.googleapis.com/storage/v1/b/"+enc(bucket)+"/o?prefix="+enc(prefix)+"&fields=items(name)");
    const meta=await response.json();const names=(meta.items||[]).map(x=>x.name).filter(Boolean).slice(0,500);
    const items=await Promise.all(names.map(async name=>{
      try{const r=await gcs("https://storage.googleapis.com/download/storage/v1/b/"+enc(bucket)+"/o/"+enc(name)+"?alt=media");return await r.json();}catch{return null;}
    }));
    return items.filter(Boolean);
  }
  async function patch(key,kind,id,changes,idField){
    const item=await getObject(key,kind,id);
    return put(key,kind,{...item,...changes,[idField]:id},idField);
  }
  return {ready,put,getObject,del,list,patch};
}