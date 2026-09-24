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