(() => {
  const $ = id => document.getElementById(id);
  const ACCEPTED = new Set(["poster", "backdrop", "still", "image"]);
  let items = [], previews = [];

  const cleanFilename = name => {
    const value = String(name || "Постер").trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").slice(0,100).trim();
    return value || "Постер";
  };

  function discardPreviews() {
    previews.forEach(url => URL.revokeObjectURL(url));
    previews = [];
  }

  async function collect() {
    if (!window.AssetManager?.list) throw new Error("Локальное хранилище недоступно.");
    const assets = await AssetManager.list();
    // Stable imported URLs do not need multiple duplicate cards.
    const seen = new Set();
    return assets.filter(asset => {
      if (!ACCEPTED.has(asset.imageType) || !asset.originalAsset || asset.hiddenFromPosterArchive) return false;
      const key = asset.originalUrl || (asset.source !== "local" && asset.sourceId ? asset.source + ":" + asset.sourceId : asset.id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a,b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  }

  function status(text, type="") {
    $("posterArchiveStatus").textContent = text;
    $("posterArchiveStatus").className = "mini-status " + type;
  }

  async function refresh() {
    items = await collect();
    await render();
  }

  function button(text, className, action) {
    const el = document.createElement("button");
    el.type = "button"; el.textContent = text; el.className = className;
    el.addEventListener("click", () => Promise.resolve(action()).catch(err => status(err.message || "Ошибка архива.", "error")));
    return el;
  }

  async function apply(item) {
    const layer = "poster";
    const active = document.querySelector(".workspace-tab.active")?.dataset.workspace;
    if (!["vertical","horizontal","train","top10"].includes(active)) PosterApp.switchWorkspace("vertical");
    const src = await AssetManager.blobToDataUrl(item.originalAsset);
    await WorkspaceTools.importImage(src, item.title || "Постер", layer, {assetId:item.id});
    close();
  }

  async function saveName(item, input) {
    const newName = cleanFilename(input.value);
    const updated = await AssetManager.save({...item, title:newName, posterArchiveTitleLocked:true});
    const at = items.findIndex(i => i.id === item.id);
    if (at >= 0) items[at] = updated;
    await render();
    status("Название сохранено. Теперь изображение находится по новому имени.", "ok");
  }

  async function remove(item) {
    if (!window.confirm("Убрать «" + (item.title || "постер") + "» из архива? Открытые макеты не изменятся.")) return;
    // Hide instead of destroying source bytes that previously saved projects may reference.
    await AssetManager.save({...item, hiddenFromPosterArchive:true});
    await refresh();
    status("Постер убран из библиотеки; материалы сохранённых работ не затронуты.", "ok");
  }

  async function render() {
    const list = $("posterArchiveList"), query = $("posterArchiveSearch").value.toLocaleLowerCase("ru").trim();
    if (!list) return;
    discardPreviews();
    list.replaceChildren();
    const filtered = items.filter(item => !query || [item.title,item.source,item.year].some(value => String(value || "").toLocaleLowerCase("ru").includes(query)));
    $("posterArchiveCount").textContent = filtered.length + " / " + items.length;
    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className="logo-archive-empty";
      empty.textContent = items.length ? "По этому запросу ничего не найдено." : "Архив пока пуст. Загрузите постер или добавьте изображение из поиска.";
      list.append(empty);
      return;
    }
    for (const item of filtered.slice(0,120)) {
      const card=document.createElement("article");card.className="logo-archive-item";
      const preview=document.createElement("div");preview.className="logo-archive-preview";
      const img=document.createElement("img");img.alt=item.title || "Постер";img.loading="lazy";
      const url=URL.createObjectURL(item.originalAsset);previews.push(url);img.src=url;preview.append(img);
      const body=document.createElement("div");body.className="logo-archive-item-body";
      const title=document.createElement("strong");title.textContent=item.title || "Без названия";title.title=title.textContent;
      const meta=document.createElement("small");meta.textContent=[
        item.year, item.width && item.height ? item.width + " × " + item.height : "",
        item.source || "",item.license || ""
      ].filter(Boolean).join(" · ");
      const actions=document.createElement("div");actions.className="logo-archive-actions";
      actions.append(
        button("Использовать","primary",()=>apply(item)),
        button("Скачать", "",()=>PosterApp.downloadBlob(item.originalAsset,cleanFilename(item.title).replace(/\.(?:png|jpe?g|webp)$/i,"") + (item.mimeType==="image/png"?".png":item.mimeType==="image/webp"?".webp":".jpg"))),
        button("Переименовать","",()=>{
          edit.hidden=false;title.hidden=true;field.focus();field.select();
        }),
        button("Удалить","logo-archive-delete-button",()=>remove(item))
      );
      const edit=document.createElement("form");edit.className="logo-archive-edit";edit.hidden=true;
      const field=document.createElement("input");field.type="text";field.required=true;field.maxLength=100;
      field.value=item.title||"";field.setAttribute("aria-label","Новое название постера");
      const save=document.createElement("button");save.type="submit";save.textContent="Сохранить";
      const cancel=document.createElement("button");cancel.type="button";cancel.textContent="Отмена";
      cancel.onclick=()=>{edit.hidden=true;title.hidden=false;};
      edit.addEventListener("submit",ev=>{ev.preventDefault();save.disabled=true;saveName(item,field).catch(err=>status(err.message,"error")).finally(()=>{save.disabled=false;});});
      edit.append(field,save,cancel);body.append(title,edit,meta,actions);card.append(preview,body);list.append(card);
    }
    if(filtered.length>120)status("Показаны первые 120 изображений. Уточните поиск, чтобы найти остальные.");
  }

  async function open() {
    $("posterArchiveModal").hidden=false;
    document.body.classList.add("modal-open");
    $("posterArchiveSearch").value="";
    status("Загрузка сохранённых изображений...");
    try{await refresh();status(items.length?"Выберите изображение.":"Архив пока пуст.",items.length?"ok":"");}
    catch(err){status(err.message||"Не удалось открыть архив.","error");}
  }
  function close() {
    $("posterArchiveModal").hidden=true;
    document.body.classList.remove("modal-open");
    discardPreviews();
  }
  $("posterArchiveSearch")?.addEventListener("input",()=>{void render();});
  $("posterArchiveCloseBtn")?.addEventListener("click",close);
  $("posterArchiveModal")?.addEventListener("click",ev=>{if(ev.target===$("posterArchiveModal"))close();});
  window.PosterArchive={open,close,refresh};
})();