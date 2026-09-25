(() => {
  const $ = id => document.getElementById(id);
  let confirmResolver = null;
  let archiveWorkspace = "vertical";
  const LABELS = { vertical:"Вертикальный", horizontal:"Горизонтальный", train:"Паровозик", top10:"ТОП10" };
  const clone = value => JSON.parse(JSON.stringify(value));
  const activePosterFormat = () => window.PosterApp?.getActiveFormat?.() || "vertical";

  function confirmAction({ title, message, confirmLabel="Да, сбросить" }) {
    if (confirmResolver) confirmResolver(false);
    $("resetConfirmTitle").textContent = title;
    $("resetConfirmMessage").textContent = message;
    $("resetConfirmOkBtn").textContent = confirmLabel;
    $("resetConfirmModal").hidden = false;
    document.body.classList.add("modal-open");
    return new Promise(resolve => { confirmResolver = resolve; });
  }

  function resolveConfirm(value) {
    if (!confirmResolver) return;
    const resolve = confirmResolver;
    confirmResolver = null;
    $("resetConfirmModal").hidden = true;
    document.body.classList.remove("modal-open");
    resolve(value);
  }

  $("resetConfirmCancelBtn").addEventListener("click", () => resolveConfirm(false));
  $("resetConfirmOkBtn").addEventListener("click", () => resolveConfirm(true));
  $("resetConfirmModal").addEventListener("click", e => { if (e.target === $("resetConfirmModal")) resolveConfirm(false); });

  async function resetWorkspace(workspace) {
    const messages = {
      vertical:"Вы уверены, что хотите сбросить вертикальный постер? Все изображения, логотипы, настройки, фильтры и изменения этой вкладки будут удалены.",
      horizontal:"Вы уверены, что хотите сбросить горизонтальный постер? Все изображения, логотипы, настройки, фильтры и изменения этой вкладки будут удалены.",
      train:"Вы уверены, что хотите сбросить Паровозик? Все изображения, логотипы, стикеры, тексты, фон, настройки и изменения будут удалены.",
      top10:"Вы уверены, что хотите сбросить ТОП10 до классического стиля? Все изображения, логотипы и пользовательские настройки ТОП10 будут удалены. Будут восстановлены стандартные параметры шаблона."
    };
    const ok = await confirmAction({
      title: workspace === "top10" ? "Сбросить до классического стиля" : "Сбросить " + LABELS[workspace],
      message: messages[workspace]
    });
    if (!ok) return false;
    if (workspace === "vertical" || workspace === "horizontal") await PosterApp.resetWorkspace(workspace);
    else if (workspace === "train") await TrainEditor.resetWorkspace();
    else if (workspace === "top10") await Top10Editor.resetClassic();
    return true;
  }

  async function thumbnailFromBlob(blob) {
    const bitmap = await createImageBitmap(blob);
    try {
      const scale = Math.min(1, 360 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext("2d").drawImage(bitmap,0,0,canvas.width,canvas.height);
      return canvas.toDataURL("image/webp",0.82);
    } finally { bitmap.close?.(); }
  }

  function archiveAssetIds(workspace, projectState) {
    const ids=new Set();
    if (workspace==="vertical" || workspace==="horizontal") {
      if(projectState?.posterAssetId) ids.add(projectState.posterAssetId);
      if(projectState?.logoAssetId) ids.add(projectState.logoAssetId);
    } else if (workspace==="top10") {
      if(projectState?.backgroundAssetId) ids.add(projectState.backgroundAssetId);
      if(projectState?.logoAssetId) ids.add(projectState.logoAssetId);
    }
    return [...ids];
  }

  async function portableAsset(assetId) {
    if(!assetId || !window.AssetManager?.get) return null;
    const asset=await AssetManager.get(assetId);
    if(!asset) return null;
    let originalDataUrl=null,editedDataUrl=null;
    try { if(asset.originalAsset) originalDataUrl=await AssetManager.blobToDataUrl(asset.originalAsset); } catch {}
    try { if(asset.editedAsset) editedDataUrl=await AssetManager.blobToDataUrl(asset.editedAsset); } catch {}
    return {
      id:asset.id,source:asset.source,sourceId:asset.sourceId,sourceUrl:asset.sourceUrl,originalUrl:asset.originalUrl,
      proxyUrl:asset.proxyUrl,thumbnailUrl:asset.thumbnailUrl,title:asset.title,year:asset.year,mediaType:asset.mediaType,
      imageType:asset.imageType,width:asset.width,height:asset.height,aspectRatio:asset.aspectRatio,language:asset.language,
      isTextless:asset.isTextless,mimeType:asset.mimeType,filters:asset.filters,license:asset.license,attribution:asset.attribution,
      createdAt:asset.createdAt,updatedAt:asset.updatedAt,originalDataUrl,editedDataUrl
    };
  }

  async function bundleAssets(workspace, projectState) {
    const assets=[];
    for(const id of archiveAssetIds(workspace,projectState)) {
      try { const item=await portableAsset(id); if(item) assets.push(item); }
      catch(error) { console.warn("Archive asset bundle failed",id,error); }
    }
    return assets;
  }

  async function restoreBundledAssets(items=[]) {
    if(!window.AssetManager?.save) return;
    for(const item of items||[]) {
      if(!item?.id) continue;
      try {
        const originalAsset=item.originalDataUrl ? await AssetManager.dataUrlToBlob(item.originalDataUrl) : null;
        const editedAsset=item.editedDataUrl ? await AssetManager.dataUrlToBlob(item.editedDataUrl) : null;
        await AssetManager.save({
          ...item,
          originalDataUrl:undefined,editedDataUrl:undefined,
          originalAsset,editedAsset,
          id:item.id
        });
      } catch(error) { console.warn("Archive asset restore failed",item.id,error); }
    }
  }

  async function workspaceSnapshot(workspace) {
    if (workspace === "vertical" || workspace === "horizontal") {
      return {
        projectState:clone(PosterApp.getState()[workspace]),
        masterWidth:PosterApp.formats[workspace].w,
        masterHeight:PosterApp.formats[workspace].h,
        previewBlob:await PosterApp.renderPosterBlob(workspace)
      };
    }
    if (workspace === "train") return {
      projectState:clone(TrainEditor.serialize()),
      masterWidth:TrainEditor.constants.MASTER_W,
      masterHeight:TrainEditor.constants.MASTER_H,
      previewBlob:await TrainEditor.renderMasterBlob()
    };
    if (workspace === "top10") return {
      projectState:clone(Top10Editor.serialize()),
      masterWidth:Top10Editor.constants.MASTER_W,
      masterHeight:Top10Editor.constants.MASTER_H,
      previewBlob:await Top10Editor.renderBlob()
    };
    throw new Error("Неизвестная рабочая среда: " + workspace);
  }

  async function captureWorkspace(workspace, reason="export") {
    if (!window.SkoomaStore?.saveArchiveEntry) return null;
    const snap = await workspaceSnapshot(workspace);
    const createdAt = Date.now();
    const entry = {
      archiveId:(crypto.randomUUID?.() || ("archive-" + createdAt + "-" + Math.random().toString(36).slice(2))),
      workspace, createdAt, updatedAt:createdAt, reason, projectVersion:4,
      title:LABELS[workspace] + " - " + new Date(createdAt).toLocaleString("ru-RU"),
      masterWidth:snap.masterWidth, masterHeight:snap.masterHeight,
      preview:await thumbnailFromBlob(snap.previewBlob),
      projectState:snap.projectState,
      assets:await bundleAssets(workspace,snap.projectState),
      photopeaMasterId:window.PhotopeaBridge?.getLayeredMasterId?.(workspace) || snap.projectState?.photopeaMasterId || null
    };
    await SkoomaStore.saveArchiveEntry(entry);
    return entry;
  }

  async function captureAll(reason="save-project") {
    const results=[];
    for (const workspace of ["vertical","horizontal","train","top10"]) {
      try { results.push(await captureWorkspace(workspace,reason)); }
      catch(error) { console.warn("Archive snapshot failed for",workspace,error); }
    }
    return results;
  }

  async function restoreEntry(entry) {
    await restoreBundledAssets(entry.assets || []);
    if (entry.workspace === "vertical" || entry.workspace === "horizontal") {
      await PosterApp.restoreWorkspace(entry.workspace,clone(entry.projectState));
      PosterApp.switchWorkspace(entry.workspace);
    } else if (entry.workspace === "train") {
      await TrainEditor.restore(clone(entry.projectState)); PosterApp.switchWorkspace("train");
    } else if (entry.workspace === "top10") {
      await Top10Editor.restore(clone(entry.projectState)); PosterApp.switchWorkspace("top10");
    }
    closeArchive();
  }

  function downloadJson(value,name) {
    PosterApp.downloadBlob(new Blob([JSON.stringify(value,null,2)],{type:"application/json"}),name);
  }

  async function renderArchive() {
    const root=$("archiveList"); root.innerHTML=""; $("archiveStatus").textContent="Загрузка...";
    const entries=await SkoomaStore.listArchiveEntries(archiveWorkspace);
    $("archiveStatus").textContent=entries.length ? entries.length + " версий" : "Архив пока пуст.";
    for (const entry of entries) {
      const card=document.createElement("article"); card.className="archive-item";
      const preview=document.createElement("img"); preview.src=entry.preview || ""; preview.alt="";
      const body=document.createElement("div"); body.className="archive-item-body";
      const title=document.createElement("strong"); title.textContent=entry.title;
      const meta=document.createElement("small");
      meta.textContent=new Date(entry.createdAt).toLocaleString("ru-RU")+" · "+entry.masterWidth+" × "+entry.masterHeight+" · "+(entry.reason||"snapshot");
      const actions=document.createElement("div"); actions.className="archive-actions";
      for (const [label,action] of [["Восстановить","restore"],["Скачать","download"],["Переименовать","rename"],["Удалить","delete"]]) {
        const button=document.createElement("button"); button.type="button"; button.textContent=label;
        button.dataset.archiveAction=action; button.dataset.archiveId=entry.archiveId;
        if(action==="delete") button.classList.add("danger");
        actions.appendChild(button);
      }
      body.append(title,meta,actions); card.append(preview,body); root.appendChild(card);
    }
  }

  async function openArchive(workspace) {
    archiveWorkspace=workspace;
    $("archiveTitle").textContent="Архив - "+LABELS[workspace];
    $("archiveModal").hidden=false; document.body.classList.add("modal-open");
    await renderArchive();
  }
  function closeArchive(){ $("archiveModal").hidden=true; document.body.classList.remove("modal-open"); }

  $("archiveCloseBtn").addEventListener("click",closeArchive);
  $("archiveModal").addEventListener("click",e=>{if(e.target===$("archiveModal")) closeArchive();});
  $("archiveList").addEventListener("click",async e=>{
    const button=e.target.closest("[data-archive-action]"); if(!button) return;
    const entry=await SkoomaStore.getArchiveEntry(button.dataset.archiveId); if(!entry) return;
    const action=button.dataset.archiveAction;
    if(action==="restore") return restoreEntry(entry);
    if(action==="download") return downloadJson(entry,(entry.workspace+"-"+entry.archiveId+".json"));
    if(action==="rename"){
      const title=window.prompt("Название архивной версии:",entry.title);
      if(title?.trim()){await SkoomaStore.renameArchiveEntry(entry.archiveId,title);await renderArchive();}
      return;
    }
    if(action==="delete"){
      const ok=await confirmAction({title:"Удалить архивную версию",message:"Вы уверены, что хотите удалить «"+entry.title+"»? Текущая работа не будет затронута.",confirmLabel:"Да, удалить"});
      if(ok){await SkoomaStore.deleteArchiveEntry(entry.archiveId);await renderArchive();}
    }
  });

  $("posterArchiveBtn").addEventListener("click",()=>openArchive(activePosterFormat()));
  $("trainArchiveBtn").addEventListener("click",()=>openArchive("train"));
  $("top10ArchiveBtn").addEventListener("click",()=>openArchive("top10"));
  $("posterResetWorkspaceBtn").addEventListener("click",()=>resetWorkspace(activePosterFormat()));
  $("trainResetWorkspaceBtn").addEventListener("click",()=>resetWorkspace("train"));
  $("top10ResetClassicBtn").addEventListener("click",()=>resetWorkspace("top10"));

  window.WorkspaceTools={confirmAction,resetWorkspace};
  window.WorkArchive={bundleAssets,restoreBundledAssets,captureWorkspace,captureAll,openArchive,restoreEntry,list:(workspace)=>SkoomaStore.listArchiveEntries(workspace)};
})();
(() => {
  const $=id=>document.getElementById(id);
  const active=()=>document.querySelector('.workspace-tab.active')?.dataset.workspace||'vertical';
  const clone=x=>JSON.parse(JSON.stringify(x));
  const labels={vertical:'Вертикальный',horizontal:'Горизонтальный',train:'Паровозик',top10:'ТОП10'};
  const read=w=>w==='top10'?Top10Editor.serialize():PosterApp.getState()[w];
  const status=text=>{$('projectToolsStatus').textContent=text;};
  const histories={},timers={};let restoring=false;
  function record(w){
    if(restoring||!histories[w])return;
    const h=histories[w],value=read(w),json=JSON.stringify(value);
    if(json===JSON.stringify(h.items[h.index]))return;
    h.items=h.items.slice(0,h.index+1);h.items.push(clone(value));if(h.items.length>20)h.items.shift();h.index=h.items.length-1;
  }
  function changed(w){if(restoring)return;clearTimeout(timers[w]);timers[w]=setTimeout(()=>record(w),250);}
  async function travel(delta){
    const w=active();if(w==='photopea')return status('Для отмены в Photopea используйте её меню «Редактирование».');
    if(w==='train'){await TrainEditor[delta<0?'undo':'redo']();return;}
    clearTimeout(timers[w]);record(w);const h=histories[w];if(!h)return;
    const index=h.index+delta;if(index<0||index>=h.items.length)return status('Нет действий для '+(delta<0?'отмены':'повтора')+'.');
    restoring=true;
    try {const value=clone(h.items[index]);if(w==='top10')await Top10Editor.restore(value);else await PosterApp.restoreWorkspace(w,value);h.index=index;
      const p=PosterApp.serialize();p.id='poster-editor-autosave';await SkoomaStore.saveProject(p);status(delta<0?'Действие отменено.':'Действие повторено.');
    }catch(e){status(e.message);}finally{restoring=false;}
  }
  function resetHistory(){for(const w of ['vertical','horizontal','top10'])histories[w]={items:[clone(read(w))],index:0};}
  window.WorkHistory={changed,reset:resetHistory};resetHistory();
  $('globalUndo').onclick=()=>travel(-1);$('globalRedo').onclick=()=>travel(1);
  document.addEventListener('keydown',e=>{
    if(!(e.ctrlKey||e.metaKey)||!['z','y'].includes(e.key.toLowerCase()))return;
    if(e.target.closest('input,textarea,[contenteditable="true"]')||document.querySelector('.modal-backdrop:not([hidden])'))return;
    if(active()==='photopea')return;e.preventDefault();void travel(e.shiftKey||e.key.toLowerCase()==='y'?1:-1);
  });
  async function importImage(src,name,layer='poster',options={},target=active()){
    if(target==='train') {const blob=await AssetManager.dataUrlToBlob(src);await TrainEditor.addImageFromFile(new File([blob],name||'Изображение.png',{type:blob.type}),layer==='logo'?'logo':'image');}
    else if(target==='top10')await Top10Editor[layer==='logo'?'setLogoFromDataUrl':'setBackgroundFromDataUrl'](src,name,options);
    else if(target==='vertical'||target==='horizontal'){PosterApp.switchWorkspace(target);await PosterApp.setImageLayer(layer,src,name,options);}
    else throw new Error('Выберите редактор, в который нужно добавить изображение.');
  }
  $('copyLayerBtn').onclick=async()=>{
    try{
      const w=active(),target=$('copyLayerTarget').value;let c;
      if(w==='train')c=TrainEditor.getSelectedImageContext();
      else if(w==='top10'){const s=Top10Editor.getState(),k=Top10Editor.getSelectedLayer();if(['logo','background'].includes(k))c={src:s[k],name:s[k+'Name'],layer:k==='logo'?'logo':'poster'};}
      else if(w!=='photopea')c=PosterApp.getSelectedImageContext();
      if(!c?.src)throw new Error('Выберите изображение или логотип.');
      if(w===target)throw new Error('Выберите другой редактор.');
      if(target!=='train'){
        const s=target==='top10'?Top10Editor.getState():PosterApp.getState()[target];const key=target==='top10'&&c.layer!=='logo'?'background':c.layer;
        if(s[key]&&!await WorkspaceTools.confirmAction({title:'Заменить изображение',message:'В редакторе «'+labels[target]+'» уже есть этот слой. Заменить его копией?',confirmLabel:'Заменить'}))return;
      }
      await importImage(c.src,c.name,c.layer,{},target);PosterApp.switchWorkspace(target);status('Изображение скопировано и вписано. Исходный макет сохранён.');
    }catch(e){status(e.message);}
  };
  let templates=[];
  async function listTemplates(){templates=(await SkoomaStore.listProjects()).filter(p=>p.template===true);const select=$('projectTemplates');select.replaceChildren(new Option('Выберите шаблон',''));for(const t of templates)select.add(new Option(t.title||t.id,t.id));}
  $('saveTemplateBtn').onclick=async()=>{try{const title=$('projectTitle').value.trim();if(!title)throw new Error('Введите название проекта.');const p=PosterApp.serialize();p.id='template-'+crypto.randomUUID();p.template=true;p.title=title;await SkoomaStore.saveProject(p);await listTemplates();status('Шаблон со всеми четырьмя макетами сохранён в этом браузере.');}catch(e){status(e.message);}};
  $('applyTemplateBtn').onclick=async()=>{try{const t=templates.find(x=>x.id===$('projectTemplates').value);if(!t)throw new Error('Выберите шаблон.');if(!await WorkspaceTools.confirmAction({title:'Открыть шаблон',message:'Текущая работа будет сохранена в архив, затем заменена шаблоном.',confirmLabel:'Открыть'}))return;await WorkArchive.captureAll('before-template');await PosterApp.restore(clone(t));resetHistory();status('Шаблон открыт.');}catch(e){status(e.message);}};
  $('deleteTemplateBtn').onclick=async()=>{try{const id=$('projectTemplates').value;if(!id)return;if(!await WorkspaceTools.confirmAction({title:'Удалить шаблон',message:'Удалить выбранный шаблон из этого браузера?',confirmLabel:'Удалить'}))return;await SkoomaStore.deleteProject(id);await listTemplates();}catch(e){status(e.message);}};
  const restore=PosterApp.restore;PosterApp.restore=async p=>{await restore(p);$('projectTitle').value=p.title||'';resetHistory();};
  const serialize=PosterApp.serialize;PosterApp.serialize=()=>({...serialize(),title:$('projectTitle').value.trim()});
  $('projectTitle').onchange=async()=>{try{const p=PosterApp.serialize();p.id='poster-editor-autosave';await SkoomaStore.saveProject(p);}catch{status('Автосохранение не удалось. Скачайте проект.');}};
  WorkspaceTools.importImage=importImage;
  void listTemplates().catch(()=>status('Хранилище шаблонов недоступно.'));
})();
