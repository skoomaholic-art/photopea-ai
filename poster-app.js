(() => {
  const $ = id => document.getElementById(id);
  const apiBase = (document.querySelector('meta[name="poster-api"]')?.content || "").replace(/\/$/, "");
  const formats = {
    vertical: { w: 800, h: 1200, label: "Вертикальный" },
    horizontal: { w: 1920, h: 1080, label: "Горизонтальный" }
  };
  const makePosterState = () => ({
    poster: null, logo: null, posterName: "", logoName: "",
    posterX: 50, posterY: 50, posterScale: 100, posterRotation: 0,
    logoX: 50, logoY: 50, logoScale: 100, logoRotation: 0,
    posterLocked: true, background: "#000000"
  });

  const state = {
    activeFormat: "vertical",
    selectedLayer: "poster",
    posters: { vertical: makePosterState(), horizontal: makePosterState() },
    aiProviders: { xai: false, openai: false },
    backgroundProviders: { carve: false, removal: false },
    selectedAiResult: null,
    drag: null,
    autosaveTimer: null
  };

  const stage = $("stage");
  const posterImage = $("posterImage");
  const logoImage = $("logoImage");

  const current = () => state.posters[state.activeFormat];

  function showToast(message, kind = "") {
    const toast = $("toast");
    toast.textContent = message;
    toast.className = "toast " + kind;
    toast.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => { toast.hidden = true; }, 3200);
  }

  function setPosterStatus(message, kind = "") {
    $("posterStatus").textContent = message;
    $("posterStatus").className = "status-line " + kind;
  }

  function setAiStatus(message, kind = "") {
    $("aiStatus").textContent = message;
    $("aiStatus").className = "mini-status " + kind;
  }

  function setBgStatus(message, kind = "") {
    $("bgRemoveStatus").textContent = message;
    $("bgRemoveStatus").className = "mini-status " + kind;
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith("image/")) return reject(new Error("Выберите изображение."));
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error("Не удалось прочитать файл."));
      reader.readAsDataURL(file);
    });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function sourceToDataUrl(src) {
    if (!src) throw new Error("Изображение не выбрано.");
    if (src.startsWith("data:")) return src;
    const response = await fetch(src, { cache: "no-store" });
    if (!response.ok) throw new Error("Не удалось получить изображение.");
    return blobToDataUrl(await response.blob());
  }

  function scheduleAutosave() {
    clearTimeout(state.autosaveTimer);
    state.autosaveTimer = setTimeout(saveAutosave, 500);
  }

  function selectLayer(layer) {
    state.selectedLayer = layer === "logo" ? "logo" : "poster";
    $("posterLayerSelect").value = state.selectedLayer;
    posterImage.classList.toggle("selected-layer", state.selectedLayer === "poster" && !posterImage.hidden);
    logoImage.classList.toggle("selected-layer", state.selectedLayer === "logo" && !logoImage.hidden);
    syncLayerControls();
  }

  function syncLayerControls() {
    const s = current();
    const prefix = state.selectedLayer;
    $("layerScaleInput").value = s[prefix + "Scale"];
    $("layerRotationInput").value = s[prefix + "Rotation"];
    $("posterLockInput").checked = s.posterLocked;
    $("posterBgInput").value = s.background;
  }

  function renderPoster() {
    const f = formats[state.activeFormat];
    const s = current();
    stage.style.setProperty("--stage-ratio", String(f.w / f.h));
    stage.style.backgroundColor = s.background;
    $("posterEditorTitle").textContent = f.label + " постер";
    $("posterSizeLabel").textContent = f.w + " × " + f.h;
    $("stageMeta").textContent = f.label + " · " + f.w + " × " + f.h;

    posterImage.hidden = !s.poster;
    logoImage.hidden = !s.logo;
    if (s.poster && posterImage.src !== s.poster) posterImage.src = s.poster;
    if (s.logo && logoImage.src !== s.logo) logoImage.src = s.logo;

    posterImage.style.left = s.posterX + "%";
    posterImage.style.top = s.posterY + "%";
    posterImage.style.transform = `translate(-50%,-50%) rotate(${s.posterRotation}deg) scale(${s.posterScale / 100})`;

    logoImage.style.left = s.logoX + "%";
    logoImage.style.top = s.logoY + "%";
    logoImage.style.width = "35%";
    logoImage.style.height = "auto";
    logoImage.style.transform = `translate(-50%,-50%) rotate(${s.logoRotation}deg) scale(${s.logoScale / 100})`;

    $("posterEmpty").hidden = !!s.poster;
    selectLayer(state.selectedLayer);
  }

  function setFormat(format) {
    if (!formats[format]) return;
    state.activeFormat = format;
    renderPoster();
    setPosterStatus(formats[format].label + " редактор активен");
  }

  function switchWorkspace(name) {
    document.querySelectorAll(".workspace-tab").forEach(btn => {
      const active = btn.dataset.workspace === name;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", String(active));
    });

    const posterMode = name === "vertical" || name === "horizontal";
    $("posterWorkspace").hidden = !posterMode;
    $("posterWorkspace").classList.toggle("active", posterMode);
    $("trainWorkspace").hidden = name !== "train";
    $("trainWorkspace").classList.toggle("active", name === "train");
    $("photopeaWorkspace").hidden = name !== "photopea";
    $("photopeaWorkspace").classList.toggle("active", name === "photopea");

    if (posterMode) setFormat(name);
    if (name === "train") window.TrainEditor?.activate();
    if (name === "photopea" && $("photopeaFrame").src === "about:blank") $("photopeaFrame").src = $("photopeaFrame").dataset.src;
  }

  async function setImageLayer(layer, src, name = "") {
    const s = current();
    if (layer === "logo") {
      s.logo = src; s.logoName = name;
      s.logoX = 50; s.logoY = 50; s.logoScale = 100; s.logoRotation = 0;
    } else {
      s.poster = src; s.posterName = name;
      s.posterX = 50; s.posterY = 50; s.posterScale = 100; s.posterRotation = 0;
    }
    state.selectedLayer = layer;
    renderPoster();
    scheduleAutosave();
  }

  function resetSelectedLayer() {
    const s = current();
    const p = state.selectedLayer;
    s[p + "X"] = 50;
    s[p + "Y"] = 50;
    s[p + "Scale"] = 100;
    s[p + "Rotation"] = 0;
    renderPoster();
    scheduleAutosave();
  }

  async function searchPosters() {
    const q = $("posterSearchInput").value.trim();
    if (!q) return setPosterSearchStatus("Введите название.", "error");
    if (!apiBase) return setPosterSearchStatus("Не указан адрес API-сервера.", "error");

    $("posterSearchBtn").disabled = true;
    setPosterSearchStatus("Ищу постеры...");
    $("posterSearchResults").innerHTML = "";
    try {
      const response = await fetch(apiBase + "/api/posters?q=" + encodeURIComponent(q), { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Ошибка поиска.");
      const items = Array.isArray(data.results) ? data.results : [];
      if (!items.length) {
        setPosterSearchStatus("Ничего не найдено.", "error");
        return;
      }
      renderPosterResults(items);
      const providers = [...new Set(items.map(item => item.source))].join(", ");
      setPosterSearchStatus(`Найдено: ${items.length}. Источник: ${providers}.`, "ok");
    } catch (error) {
      setPosterSearchStatus(error.message || "Ошибка сети.", "error");
    } finally {
      $("posterSearchBtn").disabled = false;
    }
  }

  function setPosterSearchStatus(message, kind = "") {
    $("posterSearchStatus").textContent = message;
    $("posterSearchStatus").className = "mini-status " + kind;
  }

  function renderPosterResults(items) {
    const root = $("posterSearchResults");
    root.innerHTML = "";
    for (const item of items) {
      if (!item.image) continue;
      const card = document.createElement("button");
      card.type = "button";
      card.className = "poster-card";
      const img = document.createElement("img");
      img.src = item.image;
      img.alt = item.title || "Постер";
      img.loading = "lazy";
      const title = document.createElement("strong");
      title.textContent = item.title || "Без названия";
      const meta = document.createElement("small");
      meta.textContent = [item.year, item.source, item.quality].filter(Boolean).join(" · ");
      card.append(img, title, meta);
      card.addEventListener("click", () => {
        setImageLayer("poster", item.image, item.title || "poster");
        setPosterSearchStatus("Постер добавлен в " + formats[state.activeFormat].label.toLowerCase() + " редактор.", "ok");
      });
      root.appendChild(card);
    }
    if (!root.children.length) setPosterSearchStatus("Результаты есть, но у них нет изображений.", "error");
  }

  async function checkServer() {
    if (!apiBase) {
      $("aiServerBadge").textContent = "не настроен";
      $("bgProviderBadge").textContent = "не настроен";
      return;
    }
    try {
      const response = await fetch(apiBase + "/api/status", { cache: "no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const data = await response.json();
      state.aiProviders = {
        xai: !!data.providers?.xai,
        openai: !!data.providers?.openai
      };
      state.backgroundProviders = {
        carve: !!data.background?.carve,
        removal: !!data.background?.removal
      };
      const aiCount = Object.values(state.aiProviders).filter(Boolean).length;
      const bgCount = Object.values(state.backgroundProviders).filter(Boolean).length;
      $("aiServerBadge").textContent = aiCount ? aiCount + "/2 online" : "ключи не заданы";
      $("aiServerBadge").className = aiCount ? "ok" : "error";
      $("bgProviderBadge").textContent = bgCount ? bgCount + "/2 online" : "ключи не заданы";
      $("bgProviderBadge").className = bgCount ? "ok" : "error";
      updateAiAvailability();
      updateBgAvailability();
    } catch (error) {
      state.aiProviders = { xai: false, openai: false };
      state.backgroundProviders = { carve: false, removal: false };
      $("aiServerBadge").textContent = "offline";
      $("aiServerBadge").className = "error";
      $("bgProviderBadge").textContent = "offline";
      $("bgProviderBadge").className = "error";
      $("generateBtn").disabled = true;
      $("removeBackgroundBtn").disabled = true;
      setAiStatus("AI-сервер недоступен.", "error");
      setBgStatus("Сервер обработки недоступен.", "error");
    }
  }

  function updateAiAvailability() {
    const provider = $("aiProvider").value;
    const ready = !!state.aiProviders[provider];
    $("generateBtn").disabled = !ready;
    setAiStatus(
      ready ? "Провайдер готов." : (provider === "xai" ? "Ключ xAI не задан на сервере." : "Ключ OpenAI не задан на сервере."),
      ready ? "ok" : "error"
    );
  }

  function updateBgAvailability() {
    const provider = $("bgProviderSelect").value;
    const ready = provider === "auto"
      ? Object.values(state.backgroundProviders).some(Boolean)
      : !!state.backgroundProviders[provider];
    $("removeBackgroundBtn").disabled = !ready;
    if (!ready) {
      setBgStatus(provider === "auto" ? "Ни один API удаления фона не настроен." : "Ключ выбранного провайдера не задан.", "error");
    } else {
      setBgStatus("Удаление фона готово.", "ok");
    }
  }

  async function generateAi() {
    const provider = $("aiProvider").value;
    const s = current();
    if (!s.logo) return setAiStatus("Сначала добавьте логотип.", "error");
    if (!state.aiProviders[provider]) return updateAiAvailability();

    const button = $("generateBtn");
    button.disabled = true;
    setAiStatus("Генерирую 3 варианта...");
    try {
      const image = await sourceToDataUrl(s.logo);
      const lang = $("aiLanguage").value === "kk" ? "казахский" : "русский";
      const prompt = `${$("aiPrompt").value.trim()} Язык результата: ${lang}.`;
      const response = await fetch(apiBase + "/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, prompt, image, count: 3 })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Ошибка AI.");
      if (!Array.isArray(data.images) || !data.images.length) throw new Error("API не вернул изображения.");
      renderAiResults(data.images);
      setAiStatus("Готово: " + data.images.length + " варианта.", "ok");
    } catch (error) {
      setAiStatus(error.message || "Ошибка AI.", "error");
    } finally {
      button.disabled = !state.aiProviders[provider];
    }
  }

  function renderAiResults(images) {
    const root = $("results");
    root.innerHTML = "";
    state.selectedAiResult = null;
    images.forEach((src, index) => {
      const button = document.createElement("button");
      button.className = "result-card" + (index === 0 ? " active" : "");
      const img = document.createElement("img");
      img.src = src;
      img.alt = "AI вариант " + (index + 1);
      button.appendChild(img);
      button.addEventListener("click", () => {
        root.querySelectorAll(".result-card").forEach(x => x.classList.remove("active"));
        button.classList.add("active");
        state.selectedAiResult = src;
        $("moveResultBtn").disabled = false;
        $("downloadResultBtn").disabled = false;
      });
      root.appendChild(button);
      if (index === 0) {
        state.selectedAiResult = src;
        $("moveResultBtn").disabled = false;
        $("downloadResultBtn").disabled = false;
      }
    });
  }

  async function removeBackground() {
    const s = current();
    const layer = state.selectedLayer;
    const src = s[layer];
    if (!src) return setBgStatus("Выбранный слой пуст.", "error");

    const button = $("removeBackgroundBtn");
    button.disabled = true;
    setBgStatus("Удаляю фон...");
    try {
      const image = await sourceToDataUrl(src);
      const response = await fetch(apiBase + "/api/remove-background", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: $("bgProviderSelect").value, image })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Не удалось удалить фон.");
      if (!data.image) throw new Error("API не вернул прозрачное изображение.");
      s[layer] = data.image;
      renderPoster();
      scheduleAutosave();
      setBgStatus("Фон удалён через " + (data.provider || "API") + ". Положение и трансформация сохранены.", "ok");
    } catch (error) {
      setBgStatus(error.message || "Ошибка удаления фона.", "error");
    } finally {
      updateBgAvailability();
    }
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Не удалось загрузить изображение для экспорта."));
      image.src = src;
    });
  }

  function coverCrop(image, targetW, targetH) {
    const ir = image.naturalWidth / image.naturalHeight;
    const tr = targetW / targetH;
    if (ir > tr) {
      const sw = image.naturalHeight * tr;
      return { sx: (image.naturalWidth - sw) / 2, sy: 0, sw, sh: image.naturalHeight };
    }
    const sh = image.naturalWidth / tr;
    return { sx: 0, sy: (image.naturalHeight - sh) / 2, sw: image.naturalWidth, sh };
  }

  async function renderPosterBlob(format) {
    const f = formats[format];
    const s = state.posters[format];
    const canvas = document.createElement("canvas");
    canvas.width = f.w; canvas.height = f.h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = s.background || "#000";
    ctx.fillRect(0, 0, f.w, f.h);

    if (s.poster) {
      const image = await loadImage(s.poster);
      const crop = coverCrop(image, f.w, f.h);
      const layer = document.createElement("canvas");
      layer.width = f.w; layer.height = f.h;
      layer.getContext("2d").drawImage(image, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, f.w, f.h);
      ctx.save();
      ctx.translate(f.w * s.posterX / 100, f.h * s.posterY / 100);
      ctx.rotate(s.posterRotation * Math.PI / 180);
      ctx.scale(s.posterScale / 100, s.posterScale / 100);
      ctx.drawImage(layer, -f.w / 2, -f.h / 2);
      ctx.restore();
    }

    if (s.logo) {
      const image = await loadImage(s.logo);
      const baseW = f.w * 0.35;
      const baseH = baseW * image.naturalHeight / image.naturalWidth;
      ctx.save();
      ctx.translate(f.w * s.logoX / 100, f.h * s.logoY / 100);
      ctx.rotate(s.logoRotation * Math.PI / 180);
      ctx.scale(s.logoScale / 100, s.logoScale / 100);
      ctx.drawImage(image, -baseW / 2, -baseH / 2, baseW, baseH);
      ctx.restore();
    }

    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("PNG export failed.")), "image/png"));
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1200);
  }

  async function downloadPoster(format) {
    try {
      const blob = await renderPosterBlob(format);
      downloadBlob(blob, format === "vertical" ? "poster-vertical.png" : "poster-horizontal.png");
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function downloadBothPosters() {
    try {
      const [vertical, horizontal] = await Promise.all([renderPosterBlob("vertical"), renderPosterBlob("horizontal")]);
      const zip = await ZipStore.build([
        { name: "poster-vertical.png", data: vertical },
        { name: "poster-horizontal.png", data: horizontal }
      ]);
      ZipStore.download(zip, "posters.zip");
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  function plainProject() {
    return {
      version: 2,
      type: "poster-editor-project",
      updatedAt: Date.now(),
      posters: JSON.parse(JSON.stringify(state.posters)),
      train: window.TrainEditor?.serialize?.() || null
    };
  }

  async function saveAutosave() {
    if (!window.SkoomaStore) return;
    try {
      const project = plainProject();
      project.id = "poster-editor-autosave";
      await SkoomaStore.saveProject(project);
    } catch (error) {
      console.warn("Autosave failed", error);
    }
  }

  async function saveProject() {
    const project = plainProject();
    project.id = "poster-editor-autosave";
    try { await SkoomaStore?.saveProject(project); } catch {}
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    downloadBlob(blob, "poster-project.json");
    showToast("Проект сохранён локально и в JSON.", "ok");
  }

  async function restoreProject(project) {
    if (!project || project.type !== "poster-editor-project" || !project.posters) throw new Error("Это не проект Poster Editor.");
    state.posters.vertical = { ...makePosterState(), ...(project.posters.vertical || {}) };
    state.posters.horizontal = { ...makePosterState(), ...(project.posters.horizontal || {}) };
    renderPoster();
    if (project.train) {
      if (window.TrainEditor?.restore) await window.TrainEditor.restore(project.train);
      else window.__pendingTrainProject = project.train;
    }
    showToast("Проект восстановлен.", "ok");
  }

  async function openProjectFile(file) {
    if (!file) return;
    try {
      const project = JSON.parse(await file.text());
      await restoreProject(project);
      await saveAutosave();
    } catch (error) {
      showToast(error.message || "Не удалось открыть проект.", "error");
    } finally {
      $("projectFileInput").value = "";
    }
  }

  async function restoreAutosave() {
    try {
      const project = await SkoomaStore?.getProject("poster-editor-autosave");
      if (project) await restoreProject(project);
    } catch (error) {
      console.warn("Restore autosave failed", error);
    }
  }

  function beginDrag(layer, event) {
    const s = current();
    if (layer === "poster" && s.posterLocked) return;
    if (!s[layer]) return;
    selectLayer(layer);
    const rect = stage.getBoundingClientRect();
    state.drag = {
      layer, pointerId: event.pointerId,
      startX: event.clientX, startY: event.clientY,
      originX: s[layer + "X"], originY: s[layer + "Y"],
      stageW: rect.width, stageH: rect.height
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.currentTarget.classList.add("dragging");
    event.preventDefault();
  }

  function moveDrag(event) {
    if (!state.drag || state.drag.pointerId !== event.pointerId) return;
    const d = state.drag;
    const s = current();
    s[d.layer + "X"] = Math.max(-50, Math.min(150, d.originX + (event.clientX - d.startX) / d.stageW * 100));
    s[d.layer + "Y"] = Math.max(-50, Math.min(150, d.originY + (event.clientY - d.startY) / d.stageH * 100));
    renderPoster();
  }

  function endDrag(event) {
    if (!state.drag || (event.pointerId != null && state.drag.pointerId !== event.pointerId)) return;
    posterImage.classList.remove("dragging");
    logoImage.classList.remove("dragging");
    state.drag = null;
    scheduleAutosave();
  }

  document.querySelectorAll(".workspace-tab").forEach(btn => btn.addEventListener("click", () => switchWorkspace(btn.dataset.workspace)));
  $("openPhotopeaBtn").addEventListener("click", () => window.open("https://www.photopea.com/", "_blank", "noopener"));
  $("posterFileInput").addEventListener("change", async e => {
    try { const file = e.target.files?.[0]; if (file) await setImageLayer("poster", await readFile(file), file.name); } catch (error) { showToast(error.message, "error"); }
    e.target.value = "";
  });
  $("logoFileInput").addEventListener("change", async e => {
    try { const file = e.target.files?.[0]; if (file) await setImageLayer("logo", await readFile(file), file.name); } catch (error) { showToast(error.message, "error"); }
    e.target.value = "";
  });
  $("posterSearchBtn").addEventListener("click", searchPosters);
  $("posterSearchInput").addEventListener("keydown", e => { if (e.key === "Enter") searchPosters(); });
  $("posterLayerSelect").addEventListener("change", e => selectLayer(e.target.value));
  $("layerScaleInput").addEventListener("input", e => { current()[state.selectedLayer + "Scale"] = +e.target.value; renderPoster(); scheduleAutosave(); });
  $("layerRotationInput").addEventListener("input", e => { current()[state.selectedLayer + "Rotation"] = +e.target.value; renderPoster(); scheduleAutosave(); });
  $("centerLayerBtn").addEventListener("click", () => { current()[state.selectedLayer + "X"] = 50; current()[state.selectedLayer + "Y"] = 50; renderPoster(); scheduleAutosave(); });
  $("resetLayerBtn").addEventListener("click", resetSelectedLayer);
  $("posterLockInput").addEventListener("change", e => { current().posterLocked = e.target.checked; scheduleAutosave(); });
  $("posterBgInput").addEventListener("input", e => { current().background = e.target.value; renderPoster(); scheduleAutosave(); });
  $("aiProvider").addEventListener("change", updateAiAvailability);
  $("generateBtn").addEventListener("click", generateAi);
  $("moveResultBtn").addEventListener("click", () => { if (state.selectedAiResult) setImageLayer("logo", state.selectedAiResult, "AI logo"); });
  $("downloadResultBtn").addEventListener("click", async () => {
    if (!state.selectedAiResult) return;
    try { downloadBlob(await (await fetch(state.selectedAiResult)).blob(), "adapted-logo.png"); } catch { window.open(state.selectedAiResult, "_blank", "noopener"); }
  });
  $("bgProviderSelect").addEventListener("change", updateBgAvailability);
  $("removeBackgroundBtn").addEventListener("click", removeBackground);
  $("downloadVerticalBtn").addEventListener("click", () => downloadPoster("vertical"));
  $("downloadHorizontalBtn").addEventListener("click", () => downloadPoster("horizontal"));
  $("downloadPostersZipBtn").addEventListener("click", downloadBothPosters);
  $("saveProjectBtn").addEventListener("click", saveProject);
  $("projectFileInput").addEventListener("change", e => openProjectFile(e.target.files?.[0]));

  posterImage.addEventListener("pointerdown", e => beginDrag("poster", e));
  logoImage.addEventListener("pointerdown", e => beginDrag("logo", e));
  stage.addEventListener("pointermove", moveDrag);
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);
  posterImage.addEventListener("click", () => selectLayer("poster"));
  logoImage.addEventListener("click", () => selectLayer("logo"));

  window.PosterApp = {
    switchWorkspace,
    setFormat,
    serialize: plainProject,
    restore: restoreProject,
    renderPosterBlob,
    getState: () => JSON.parse(JSON.stringify(state.posters))
  };

  switchWorkspace("vertical");
  renderPoster();
  checkServer();
  setTimeout(restoreAutosave, 0);
})();
