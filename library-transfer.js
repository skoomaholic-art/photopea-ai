(() => {
  // User-controlled transfer only. Data never leaves the browser or reaches a cloud service.
  const PREFIX="poster-editor/library/v1/";
  const decoder=new TextDecoder();
  const encoder=new TextEncoder();
  const MAX_FILE_BYTES=250*1024*1024;
  const MAX_ENTRIES=3000;
  function toast(message,kind="ok"){
    const node=document.getElementById("toast");
    if(!node)return;
    node.textContent=message;node.className="toast "+kind;node.hidden=false;
    window.clearTimeout(toast.timer);toast.timer=setTimeout(()=>node.hidden=true,6500);
  }
  function basicMeta(value){
    const out={...value};delete out.originalAsset;delete out.editedAsset;delete out.blob;
    return out;
  }
  async function collect(){
    const projects=await SkoomaStore.listProjects();
    const assets=await AssetManager.list(); // includes logo deletion tombstones
    const workArchives=[];
    for(const workspace of ["vertical","horizontal","train","top10"]){
      workArchives.push(...await SkoomaStore.listArchiveEntries(workspace));
    }
    const masters=[], masterIds=new Set();
    for(const row of workArchives){
      if(row.photopeaMasterId)masterIds.add(row.photopeaMasterId);
      if(row.projectState?.photopeaMasterId)masterIds.add(row.projectState.photopeaMasterId);
    }
    for(const project of projects){
      for(const w of [...Object.values(project.posters||{}),project.train,project.top10]){
        if(w?.photopeaMasterId)masterIds.add(w.photopeaMasterId);
      }
    }
    for(const id of masterIds){
      const result=await SkoomaStore.getPhotopeaMaster?.(id);
      if(result?.blob)masters.push(result);
    }
    return {projects,assets,workArchives,masters};
  }
  async function exportLibrary(){
    if(!window.ZipStore?.build)throw new Error("Модуль ZIP недоступен.");
    toast("Подготавливаю переносимый ZIP с библиотекой...");
    const data=await collect();
    const archive=[], manifest={
      format:"poster-editor-portable-library",version:1,exportedAt:new Date().toISOString(),
      projects:data.projects,workArchives:data.workArchives,assets:[],photopeaMasters:[]
    };
    for(const asset of data.assets){
      const item=basicMeta(asset);
      const folder=PREFIX+"assets/"+encodeURIComponent(String(asset.id))+"/";
      if(asset.originalAsset){item.originalFile=folder+"original";archive.push({name:item.originalFile,data:asset.originalAsset});}
      if(asset.editedAsset){item.editedFile=folder+"edited";archive.push({name:item.editedFile,data:asset.editedAsset});}
      manifest.assets.push(item);
    }
    for(const master of data.masters){
      const item=basicMeta(master);
      item.file=PREFIX+"masters/"+encodeURIComponent(String(master.masterId))+"/master";
      archive.push({name:item.file,data:master.blob});manifest.photopeaMasters.push(item);
    }
    archive.unshift({name:PREFIX+"manifest.json",data:JSON.stringify(manifest)});
    const zip=await ZipStore.build(archive);
    const stamp=new Date().toISOString().slice(0,10);
    ZipStore.download(zip,"poster-editor-library-"+stamp+".zip");
    toast("Библиотека сохранена. Перенесите ZIP на новый адрес и импортируйте его.");
    return {projects:data.projects.length,assets:data.assets.length,workArchives:data.workArchives.length,
      photopeaMasters:data.masters.length};
  }
  async function unzipOwnArchive(file){
    if(file.size>MAX_FILE_BYTES)throw new Error("ZIP превышает 250 МБ. Экспортируйте материалы по частям.");
    const bytes=new Uint8Array(await file.arrayBuffer());
    const view=new DataView(bytes.buffer);
    const files=new Map();
    let p=0;
    while(p+4<=bytes.length){
      const sig=view.getUint32(p,true);
      if(sig===0x02014b50 || sig===0x06054b50)break;
      if(sig!==0x04034b50 || p+30>bytes.length)throw new Error("Неверный формат ZIP.");
      const flags=view.getUint16(p+6,true),method=view.getUint16(p+8,true),
        size=view.getUint32(p+18,true),nameLen=view.getUint16(p+26,true),
        extraLen=view.getUint16(p+28,true);
      if(method!==0 || flags&0x0008)throw new Error("Поддерживается только ZIP, созданный Poster Editor.");
      const start=p+30+nameLen+extraLen,end=start+size;
      if(end>bytes.length || files.size>=MAX_ENTRIES)throw new Error("ZIP повреждён или содержит слишком много файлов.");
      const name=decoder.decode(bytes.slice(p+30,p+30+nameLen));
      if(!name.startsWith(PREFIX)||name.includes("..")||name.includes("\\")||files.has(name)){
        throw new Error("ZIP содержит недопустимый путь.");
      }
      files.set(name,new Blob([bytes.slice(start,end)]));
      p=end;
    }
    if(!files.has(PREFIX+"manifest.json"))throw new Error("В ZIP нет манифеста Poster Editor.");
    return files;
  }
  async function importLibrary(file){
    const files=await unzipOwnArchive(file);
    const manifest=JSON.parse(await files.get(PREFIX+"manifest.json").text());
    if(manifest.format!=="poster-editor-portable-library" || manifest.version!==1){
      throw new Error("Неизвестная версия резервной копии библиотеки.");
    }
    for(const asset of manifest.assets||[]){
      if(!asset.id||asset.originalFile&&!files.has(asset.originalFile)
        ||asset.editedFile&&!files.has(asset.editedFile))throw new Error("Не хватает исходных файлов для импорта.");
    }
    for(const master of manifest.photopeaMasters||[]){
      if(!master.masterId||!files.has(master.file))throw new Error("Не хватает PSD-файла для импорта.");
    }
    if(!window.confirm("Импортировать библиотеку из ZIP? Существующие материалы не удаляются. Совпадающие ID сохранят более новую версию."))return null;
    toast("Импортирую библиотеку в этот браузер...");
    const report={projects:0,assets:0,workArchives:0,photopeaMasters:0};
    for(const asset of manifest.assets||[]){
      const existing=await AssetManager.get(asset.id);
      if(existing && (existing.updatedAt||0)>(asset.updatedAt||0))continue;
      const type=asset.mimeType||"application/octet-stream";
      const originalAsset=asset.originalFile?new Blob([await files.get(asset.originalFile).arrayBuffer()],{type}):null;
      const editedAsset=asset.editedFile?new Blob([await files.get(asset.editedFile).arrayBuffer()],{type}):null;
      await SkoomaStore.saveAsset({...basicMeta(asset),originalAsset,editedAsset});
      report.assets++;
    }
    for(const entry of manifest.workArchives||[]){
      if(!entry.archiveId||!["vertical","horizontal","train","top10"].includes(entry.workspace))continue;
      const old=await SkoomaStore.getArchiveEntry(entry.archiveId);
      if(old && (old.updatedAt||old.createdAt||0)>=(entry.updatedAt||entry.createdAt||0))continue;
      await SkoomaStore.saveArchiveEntry(entry);report.workArchives++;
    }
    for(const project of manifest.projects||[]){
      if(!project.id)continue;
      const old=await SkoomaStore.getProject(project.id);
      // Never overwrite the destination's active working project.
      const duplicate=old && project.id==="poster-editor-autosave";
      const target=duplicate?{...project,id:"imported-"+Date.now()+"-"+Math.random().toString(36).slice(2),
        title:(project.title||"Проект")+" (импортирован)"}:project;
      if(!duplicate && old && (old.updatedAt||0)>=(project.updatedAt||0))continue;
      await SkoomaStore.saveProject(target);report.projects++;
    }
    for(const master of manifest.photopeaMasters||[]){
      const old=await SkoomaStore.getPhotopeaMaster(master.masterId);
      if(old && (old.updatedAt||0)>=(master.updatedAt||0))continue;
      const blob=new Blob([await files.get(master.file).arrayBuffer()],{type:"application/octet-stream"});
      await SkoomaStore.savePhotopeaMaster({...basicMeta(master),blob});report.photopeaMasters++;
    }
    toast("Импорт завершён. Восстановлено: "+report.workArchives+" работ, "+report.assets+" материалов, "+report.photopeaMasters+" PSD.");
    return report;
  }
  window.LibraryTransfer={exportLibrary,importLibrary};
})();