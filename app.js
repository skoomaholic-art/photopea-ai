window.APP = (() => {
  const $ = id => document.getElementById(id);
  const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const cfg = {
    omdb: localStorage.getItem("skooma.omdb") || "",
    tmdb: localStorage.getItem("skooma.tmdb") || "",
    fanart: localStorage.getItem("skooma.fanart") || ""
  };
  const externalEditors = {
    photopea: { name: "Photopea", url: "https://www.photopea.com/", embed: true },
    vectorpea: { name: "Vectorpea", url: "https://www.vectorpea.com/", embed: true },
    jampea: { name: "Jampea", url: "https://jampea.com/", embed: false }
  };
  let assets = [];
  let assetFilter = "all";
  let assetQuery = "";

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[c]);
  }

  function uid(prefix = "id") {
    if (crypto.randomUUID) return prefix + "-" + crypto.randomUUID();
    return prefix + "-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  async function refreshPuterState() {
    try {
      $("puterState").textContent = puter.auth.isSignedIn() ? "Puter: авторизован" : "Puter: без входа";
    } catch {
      $("puterState").textContent = "Puter: готов";
    }
  }

  function setAutosaveState(text, kind = "") {
    const el = $("autosaveState");
    el.textContent = text;
    el.dataset.kind = kind;
  }

  function openModal(id) {
    $(id).classList.remove("hidden");
  }

  function closeModal(el) {
    el.closest(".modal-backdrop")?.classList.add("hidden");
  }

  function selectInspector(name) {
    qsa(".inspector-tab").forEach(btn => btn.classList.toggle("active", btn.dataset.inspector === name));
    qsa(".inspector-panel").forEach(panel => panel.classList.toggle("active", panel.id === name + "Panel"));
  }

  function openDrawer(name) {
    const drawer = $("toolDrawer");
    drawer.classList.remove("collapsed");
    qsa(".drawer-panel").forEach(panel => panel.classList.add("hidden"));
    qsa(".tool-button[data-panel]").forEach(btn => btn.classList.toggle("active", btn.dataset.panel === name));
    if (name === "ai") {
      $("drawerTitle").textContent = "AI";
      $("drawerSubtitle").textContent = "Генерация изображения прямо в проект";
      $("aiDrawer").classList.remove("hidden");
    } else if (name === "media") {
      $("drawerTitle").textContent = "Media Finder";
      $("drawerSubtitle").textContent = "TVmaze без ключа, OMDb / TMDB опционально";
      $("mediaDrawer").classList.remove("hidden");
    } else if (name === "assets") {
      $("drawerTitle").textContent = "Assets";
      $("drawerSubtitle").textContent = "Импортированные, найденные и AI-изображения";
      $("assetsDrawer").classList.remove("hidden");
      renderAssets();
    }
  }

  function closeDrawer() {
    $("toolDrawer").classList.add("collapsed");
    qsa(".tool-button[data-panel]").forEach(btn => btn.classList.remove("active"));
  }

  function switchEditor(value) {
    const skooma = $("skoomaHost");
    const poster = $("posterHost");
    const external = $("externalHost");
    const frame = $("externalEditorFrame");
    const fallback = $("externalFallback");
    if (value === "skooma") {
      skooma.classList.add("active");
      poster.classList.remove("active");
      external.classList.remove("active");
      frame.src = "about:blank";
      setTimeout(() => window.Studio?.fitToViewport(), 40);
      return;
    }
    if (value === "poster") {
      skooma.classList.remove("active");
      poster.classList.add("active");
      external.classList.remove("active");
      frame.src = "about:blank";
      window.PosterEditor?.resize?.();
      return;
    }
    const editor = externalEditors[value];
    skooma.classList.remove("active");
    poster.classList.remove("active");
    external.classList.add("active");
    $("externalEditorName").textContent = editor?.name || "External editor";
    $("externalOpenAlways").onclick = () => window.open(editor?.url, "_blank", "noopener");
    if (editor?.embed) {
      fallback.classList.add("hidden");
      frame.classList.remove("hidden");
      if (frame.src !== editor.url) frame.src = editor.url;
    } else {
      frame.classList.add("hidden");
      frame.src = "about:blank";
      fallback.classList.remove("hidden");
      $("externalFallbackTitle").textContent = editor?.name + " нельзя надёжно встроить";
      $("externalFallbackText").textContent = "Чтобы не показывать пустой или заблокированный iframe, Skooma открывает этот редактор отдельно.";
      $("externalOpenBtn").onclick = () => window.open(editor.url, "_blank", "noopener");
    }
  }

  async function addAsset(input) {
    const asset = {
      id: input.id || uid("asset"),
      name: input.name || "Asset",
      src: input.src,
      source: input.source || "local",
      kind: input.kind || "image",
      createdAt: input.createdAt || Date.now(),
      meta: input.meta || {}
    };
    assets = [asset, ...assets.filter(item => item.id !== asset.id)];
    try { await SkoomaStore.saveAsset(asset); } catch {}
    renderAssets();
    return asset;
  }

  async function removeAllAssets() {
    assets = [];
    try { await SkoomaStore.clearAssets(); } catch {}
    renderAssets();
  }

  function makeAssetCard(asset) {
    const card = document.createElement("div");
    card.className = "asset-card";
    card.title = "Двойной клик: добавить на холст";
    card.draggable = true;
    const resolution = asset.meta?.width && asset.meta?.height ? asset.meta.width + "×" + asset.meta.height : "";
    const language = asset.meta?.language ? String(asset.meta.language).toUpperCase() : "";
    const extra = [resolution, language, asset.kind].filter(Boolean).join(" · ");
    card.innerHTML = '<img src="' + asset.src + '" alt=""><div class="asset-info"><div class="asset-name">' +
      escapeHtml(asset.name) + '</div><div class="asset-source">' + escapeHtml(asset.source) + '</div>' +
      (extra ? '<div class="asset-meta">' + escapeHtml(extra) + '</div>' : '') + '</div>';
    card.ondblclick = () => {
      window.Studio?.addImageFromUrl(asset.src, asset.name, asset);
      $("editorSelect").value = "skooma";
      switchEditor("skooma");
    };
    card.ondragstart = event => {
      event.dataTransfer.setData("application/x-skooma-asset", asset.id);
      event.dataTransfer.effectAllowed = "copy";
    };
    return card;
  }

  function renderAssets() {
    const targets = [$("assetGridDrawer"), $("assetGridInspector")];
    const mediaSources = new Set(["TVmaze","OMDb","TMDB","fanart.tv","Wikidata","Wikimedia Commons","IMDb"]);
    const query = assetQuery.trim().toLowerCase();
    let filtered = assets.filter(asset => {
      if (assetFilter === "recent") {
        // applied after sorting / text search
      } else if (assetFilter === "upload") {
        if (asset.source !== "upload") return false;
      } else if (assetFilter === "generated") {
        if (asset.kind !== "generated") return false;
      } else if (assetFilter === "media") {
        if (!mediaSources.has(asset.source) &&
            !["poster","backdrop","logo","banner","still","fanart","portrait"].includes(asset.kind)) return false;
      } else if (assetFilter !== "all" && asset.kind !== assetFilter) {
        return false;
      }
      if (!query) return true;
      return [asset.name, asset.source, asset.kind, asset.meta?.language]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(query));
    });
    if (assetFilter === "recent") filtered = filtered.slice(0, 20);
    targets.forEach(target => {
      target.innerHTML = "";
      if (!filtered.length) {
        target.innerHTML = '<div class="empty-state">Нет assets по текущему фильтру.</div>';
        return;
      }
      filtered.forEach(asset => target.appendChild(makeAssetCard(asset)));
    });
  }

  function getAsset(id) {
    return assets.find(asset => asset.id === id) || null;
  }

  async function loadAssets() {
    try { assets = await SkoomaStore.listAssets(); } catch { assets = []; }
    renderAssets();
  }

  async function renderRecentProjects() {
    const root=$("recentProjectsList");
    root.innerHTML='<div class="empty-state">Загрузка...</div>';
    try{
      const projects=(await SkoomaStore.listProjects()).filter(project=>project.id!=="autosave");
      root.innerHTML="";
      if(!projects.length){root.innerHTML='<div class="empty-state">Сохранённых проектов пока нет.</div>';return}
      projects.slice(0,20).forEach(project=>{
        const row=document.createElement("div");
        row.className="recent-project-row";
        const date=project.updatedAt?new Date(project.updatedAt).toLocaleString():"";
        row.innerHTML='<div><div class="recent-project-title">'+escapeHtml(project.title||"Skooma Project")+
          '</div><div class="recent-project-meta">'+escapeHtml(date)+" · "+(project.width||"?")+"×"+(project.height||"?")+
          '</div></div><div class="recent-project-actions"><button class="small-button open-recent">Открыть</button>'+
          '<button class="small-button danger-button delete-recent">Удалить</button></div>';
        row.querySelector(".open-recent").onclick=async()=>{
          await window.Studio?.loadProjectById(project.id);
          $("recentProjectsModal").classList.add("hidden");
          $("editorSelect").value="skooma";switchEditor("skooma");
        };
        row.querySelector(".delete-recent").onclick=async()=>{
          await SkoomaStore.deleteProject(project.id);renderRecentProjects();
        };
        root.appendChild(row);
      });
    }catch(error){root.innerHTML='<div class="empty-state">Ошибка: '+escapeHtml(error.message)+'</div>'}
  }

  function saveSettings() {
    cfg.omdb = $("omdbKey").value.trim();
    cfg.tmdb = $("tmdbToken").value.trim();
    cfg.fanart = $("fanartKey").value.trim();
    localStorage.setItem("skooma.omdb", cfg.omdb);
    localStorage.setItem("skooma.tmdb", cfg.tmdb);
    localStorage.setItem("skooma.fanart", cfg.fanart);
    $("settingsModal").classList.add("hidden");
    window.Media?.refreshProviderState();
  }

  function openSettings() {
    $("omdbKey").value = cfg.omdb;
    $("tmdbToken").value = cfg.tmdb;
    $("fanartKey").value = cfg.fanart;
    openModal("settingsModal");
  }

  function bindPanelResizers() {
    const root=document.documentElement;
    const savedDrawer=Math.max(240,Math.min(520,Number(localStorage.getItem("skooma.drawerWidth"))||300));
    const savedInspector=Math.max(240,Math.min(520,Number(localStorage.getItem("skooma.inspectorWidth"))||300));
    root.style.setProperty("--drawer-width",savedDrawer+"px");
    root.style.setProperty("--inspector-width",savedInspector+"px");

    const bind=(handle,side)=>{
      if(!handle)return;
      handle.addEventListener("pointerdown",event=>{
        if(window.innerWidth<=900)return;
        event.preventDefault();
        handle.setPointerCapture?.(event.pointerId);
        handle.classList.add("dragging");
        const startX=event.clientX;
        const start=side==="drawer"
          ? $("toolDrawer").getBoundingClientRect().width
          : $("inspector").getBoundingClientRect().width;
        const move=moveEvent=>{
          const delta=moveEvent.clientX-startX;
          const width=Math.max(240,Math.min(520,start+(side==="drawer"?delta:-delta)));
          root.style.setProperty(side==="drawer"?"--drawer-width":"--inspector-width",width+"px");
        };
        const up=()=>{
          window.removeEventListener("pointermove",move);
          window.removeEventListener("pointerup",up);
          handle.classList.remove("dragging");
          const value=side==="drawer"
            ? $("toolDrawer").getBoundingClientRect().width
            : $("inspector").getBoundingClientRect().width;
          localStorage.setItem(side==="drawer"?"skooma.drawerWidth":"skooma.inspectorWidth",String(Math.round(value)));
          window.Studio?.fitToViewport?.();
        };
        window.addEventListener("pointermove",move);
        window.addEventListener("pointerup",up,{once:true});
      });
    };
    bind($("drawerResizer"),"drawer");
    bind($("inspectorResizer"),"inspector");
  }

  function bindUi() {
    $("editorSelect").onchange = event => switchEditor(event.target.value);
    $("settingsBtn").onclick = openSettings;
    $("saveSettingsBtn").onclick = saveSettings;
    $("puterLoginBtn").onclick = async () => {
      try { await puter.auth.signIn(); } finally { refreshPuterState(); }
    };

    $("newDocBtn").onclick = () => openModal("newDocModal");
    $("createDocBtn").onclick = () => {
      const width = Math.max(64, Number($("newDocWidth").value) || 1280);
      const height = Math.max(64, Number($("newDocHeight").value) || 720);
      window.Studio?.newDocument(width, height, $("newDocTransparent").checked);
      $("newDocModal").classList.add("hidden");
    };
    $("openImageBtn").onclick = () => $("fileInput").click();
    $("fileInput").onchange = async event => {
      const file = event.target.files?.[0];
      if (file) await window.Studio?.importFile(file);
      event.target.value = "";
    };
    $("saveProjectBtn").onclick = async () => {
      await window.Studio?.saveManualProject();
    };
    $("recentProjectsBtn").onclick = async () => {
      await renderRecentProjects();
      openModal("recentProjectsModal");
    };
    $("projectExportBtn").onclick = () => window.Studio?.exportProjectJson();
    $("projectImportBtn").onclick = () => $("projectInput").click();
    $("projectInput").onchange = async event => {
      const file = event.target.files?.[0];
      if (file) await window.Studio?.importProjectJson(file);
      event.target.value = "";
    };

    qsa(".modal-close").forEach(btn => btn.onclick = () => closeModal(btn));
    qsa(".modal-backdrop").forEach(backdrop => backdrop.onclick = event => {
      if (event.target === backdrop) backdrop.classList.add("hidden");
    });

    qsa(".inspector-tab").forEach(btn => btn.onclick = () => selectInspector(btn.dataset.inspector));
    qsa(".tool-button[data-panel]").forEach(btn => btn.onclick = () => {
      const name = btn.dataset.panel;
      if (!$("toolDrawer").classList.contains("collapsed") && btn.classList.contains("active")) closeDrawer();
      else openDrawer(name);
    });
    $("closeDrawerBtn").onclick = closeDrawer;

    $("aiProvider").onchange = event => {
      const perchance = event.target.value === "perchance";
      $("puterAiFields").classList.toggle("hidden", perchance);
      $("perchanceFields").classList.toggle("hidden", !perchance);
    };
    $("openPerchanceBtn").onclick = () => window.open("https://perchance.org/text-to-image-plugin", "_blank", "noopener");

    $("importAssetBtn").onclick = () => $("assetInput").click();
    $("assetInput").onchange = async event => {
      for (const file of event.target.files || []) {
        const src = await window.Studio.fileToDataUrl(file);
        await addAsset({ name: file.name, src, source: "upload" });
      }
      event.target.value = "";
    };
    $("clearAssetsBtn").onclick = () => {
      if (confirm("Очистить Asset Library?")) removeAllAssets();
    };
    qsa(".asset-filter").forEach(btn => btn.onclick = () => {
      assetFilter = btn.dataset.kind || "all";
      qsa(".asset-filter").forEach(item => item.classList.toggle("active", item === btn));
      renderAssets();
    });
    $("assetSearch").oninput = event => {
      assetQuery = event.target.value || "";
      renderAssets();
    };
  }

  bindUi();
  bindPanelResizers();
  refreshPuterState();
  loadAssets();

  return {
    cfg,
    uid,
    escapeHtml,
    addAsset,
    getAsset,
    renderAssets,
    openDrawer,
    closeDrawer,
    selectInspector,
    switchEditor,
    setAutosaveState,
    refreshPuterState,
    renderRecentProjects,
    get assets() { return assets; },
    get assetFilter() { return assetFilter; }
  };
})();
