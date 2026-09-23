(() => {
  const $ = id => document.getElementById(id);
  let session = null;
  let renderToken = 0;
  let renderTimer = null;

  function status(message, kind="") {
    $("filterStatus").textContent=message;
    $("filterStatus").className="mini-status "+kind;
  }

  function valuesFromUi() {
    const out={};
    for (const control of ImageFilters.CONTROLS) {
      out[control.key]=Number(document.querySelector('[data-filter-range="' + control.key + '"]')?.value || 0);
    }
    return out;
  }

  function setValues(values) {
    for (const control of ImageFilters.CONTROLS) {
      const value=Number(values?.[control.key] ?? 0);
      const range=document.querySelector('[data-filter-range="' + control.key + '"]');
      const number=document.querySelector('[data-filter-number="' + control.key + '"]');
      if (range) range.value=String(value);
      if (number) number.value=String(value);
    }
    schedulePreview();
  }

  async function renderPreview() {
    if (!session) return;
    const token=++renderToken;
    status("Обновляю preview...");
    try {
      const canvas=await ImageFilters.renderToCanvas(session.originalDataUrl,valuesFromUi(),900);
      if (!session || token!==renderToken) return;
      const target=$("filterPreview");
      target.width=canvas.width; target.height=canvas.height;
      target.getContext("2d").drawImage(canvas,0,0);
      status(canvas.width + " × " + canvas.height + " preview","ok");
    } catch(error) {
      status(error.message || "Не удалось обработать preview.","error");
    }
  }

  function schedulePreview() {
    clearTimeout(renderTimer);
    renderTimer=setTimeout(renderPreview,70);
  }

  function buildControls() {
    const presetRoot=$("filterPresetGrid");
    presetRoot.innerHTML="";
    for (const name of Object.keys(ImageFilters.PRESETS)) {
      const button=document.createElement("button");
      button.type="button";
      button.className="filter-preset";
      button.textContent=name;
      button.addEventListener("click",()=>{
        presetRoot.querySelectorAll(".active").forEach(x=>x.classList.remove("active"));
        button.classList.add("active");
        setValues(ImageFilters.PRESETS[name]);
      });
      presetRoot.appendChild(button);
    }

    const root=$("filterControls");
    root.innerHTML="";
    for (const c of ImageFilters.CONTROLS) {
      const row=document.createElement("div");
      row.className="filter-control";
      const label=document.createElement("label");
      label.textContent=c.label;
      const range=document.createElement("input");
      range.type="range"; range.min=c.min; range.max=c.max; range.step=c.step; range.value="0";
      range.dataset.filterRange=c.key;
      const number=document.createElement("input");
      number.type="number"; number.min=c.min; number.max=c.max; number.step=c.step; number.value="0";
      number.dataset.filterNumber=c.key;
      const reset=document.createElement("button");
      reset.type="button"; reset.textContent="↺"; reset.title="Reset "+c.label;
      const sync=(source,target)=>{
        const value=Math.max(c.min,Math.min(c.max,Number(source.value)||0));
        source.value=String(value); target.value=String(value); schedulePreview();
      };
      range.addEventListener("input",()=>sync(range,number));
      number.addEventListener("input",()=>sync(number,range));
      reset.addEventListener("click",()=>{range.value="0";number.value="0";schedulePreview();});
      row.append(label,range,number,reset);
      root.appendChild(row);
    }
  }

  async function openAsset(asset, options={}) {
    if (!asset) throw new Error("Asset не найден.");
    const originalDataUrl=await AssetManager.dataUrl(asset,false);
    session={
      asset,
      originalDataUrl,
      layer: options.layer || (asset.imageType==="logo"?"logo":"poster"),
      onApply: options.onApply || null,
      name: options.name || asset.title || "Filtered asset"
    };
    $("filterModal").hidden=false;
    document.body.classList.add("modal-open");
    $("filterPresetGrid").querySelectorAll(".active").forEach(x=>x.classList.remove("active"));
    setValues(asset.filters || ImageFilters.DEFAULTS);
    await renderPreview();
  }

  async function openSelected() {
    const context=PosterApp.getSelectedImageContext();
    if (!context?.src) throw new Error("Сначала выберите изображение.");
    const asset=await AssetManager.ensureContextAsset(context);
    if (!context.assetId) PosterApp.attachAssetId(context.layer,asset.id);
    return openAsset(asset,{layer:context.layer,name:context.name});
  }

  async function apply() {
    if (!session) return;
    $("filterApplyBtn").disabled=true;
    status("Применяю фильтры в полном разрешении...");
    try {
      const settings=valuesFromUi();
      const blob=await ImageFilters.renderBlob(session.originalDataUrl,settings);
      const updated=await AssetManager.updateEdited(session.asset.id,blob,settings);
      const dataUrl=await AssetManager.dataUrl(updated,true);
      if (session.onApply) await session.onApply(dataUrl,updated,settings);
      else await PosterApp.setImageLayer(session.layer,dataUrl,session.name,{assetId:updated.id});
      status("Фильтры применены и сохранятся в экспорте.","ok");
      setTimeout(close,350);
    } catch(error) {
      status(error.message || "Не удалось применить фильтры.","error");
    } finally {
      $("filterApplyBtn").disabled=false;
    }
  }

  function resetAll() {
    $("filterPresetGrid").querySelectorAll(".active").forEach(x=>x.classList.remove("active"));
    setValues(ImageFilters.DEFAULTS);
  }

  function close() {
    $("filterModal").hidden=true;
    document.body.classList.remove("modal-open");
    session=null;
  }

  buildControls();
  $("filterCloseBtn").addEventListener("click",close);
  $("filterResetBtn").addEventListener("click",resetAll);
  $("filterApplyBtn").addEventListener("click",apply);
  $("filterModal").addEventListener("click",e=>{if(e.target===$("filterModal")) close();});

  window.FilterStudio={openAsset,openSelected,close};
})();
