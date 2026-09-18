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
    const external = $("externalHost");
    const frame = $("externalEditorFrame");
    const fallback = $("externalFallback");
    if (value === "skooma") {
      skooma.classList.add("active");
      external.classList.remove("active");
      frame.src = "about:blank";
      setTimeout(() => window.Studio?.fitToViewport(), 40);
      return;
    }
    const editor = externalEditors[value];
    skooma.classList.remove("active");
    external.classList.add("active");
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
    card.innerHTML = '<img src="' + asset.src + '" alt=""><div class="asset-info"><div class="asset-name">' +
      escapeHtml(asset.name) + '</div><div class="asset-source">' + escapeHtml(asset.source) + '</div></div>';
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
    targets.forEach(target => {
      target.innerHTML = "";
      if (!assets.length) {
        target.innerHTML = '<div class="empty-state">Assets пока нет.</div>';
        return;
      }
      assets.forEach(asset => target.appendChild(makeAssetCard(asset)));
    });
  }

  function getAsset(id) {
    return assets.find(asset => asset.id === id) || null;
  }

  async function loadAssets() {
    try { assets = await SkoomaStore.listAssets(); } catch { assets = []; }
    renderAssets();
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
    $("saveProjectBtn").onclick = () => window.Studio?.saveNow();

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
  }

  bindUi();
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
    refreshPuterState
  };
})();