(() => {
  const $ = id => document.getElementById(id);
  const apiBase = (document.querySelector('meta[name="poster-api"]')?.content || "").replace(/\/$/, "");
  const formats = {
    vertical: { w: 800, h: 1200, label: "Вертикальный" },
    horizontal: { w: 1920, h: 1080, label: "Горизонтальный" }
  };
  const decodedImages = new Map();
  const EXPECTED_API_VERSION = "2026-09-23-runtime-v4";
  const makePosterState = () => ({
    poster: null, logo: null, posterName: "", logoName: "",
    posterX: 50, posterY: 50, posterScale: 100, posterRotation: 0,
    logoX: 50, logoY: 50, logoScale: 100, logoRotation: 0,
    posterLocked: true, logoLocked: false, background: "#000000", order: ["poster", "logo"],
    posterAssetId: null, logoAssetId: null, posterMode: "cover", photopeaMasterId: null,
    posterOpacity: 1, logoOpacity: 1, posterVisible: true, logoVisible: true,
    aiOriginal: null, aiResults: [], aiSelected: null, aiTitle: "", aiLanguage: "kk"
  });

  const state = {
    activeFormat: "vertical",
    selectedLayer: "poster",
    posters: { vertical: makePosterState(), horizontal: makePosterState() },
    aiProviders: { cloudflare: false, xai: false, openai: false },
    aiProviderDetails: {},
    backgroundProviders: { local: true, carve: false, removal: false },
    imageProviders: {},
    workerVersion: null,
    selectedAiResult: null,
    drag: null,
    handleTransform: null,
    autosaveTimer: null
  };

  const stage = $("stage");
  const posterImage = $("posterImage");
  const logoImage = $("logoImage");
  const transformOverlay = $("posterTransformOverlay");

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

  async function resizeDataUrlForAi(src, maxSide = 510) {
    const dataUrl = await sourceToDataUrl(src);
    const image = await new Promise((resolve, reject) => {
      const item = new Image();
      item.onload = () => resolve(item);
      item.onerror = () => reject(new Error("Не удалось подготовить reference image."));
      item.src = dataUrl;
    });
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (Math.max(width, height) <= maxSide) return dataUrl;
    const ratio = maxSide / Math.max(width, height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  }

  function localBackgroundReady() {
    return !!window.LocalBackgroundRemoval?.isAvailable?.();
  }

  function providerStatusMessage(detail) {
    const status = detail?.status;
    if (status === "rate_limited") return "Провайдер временно упёрся в лимит.";
    if (status === "auth_error") return "Ключ провайдера отклонён.";
    if (status === "timeout") return "Проверка провайдера превысила таймаут.";
    if (status === "incompatible") return "Модель не поддерживает image-to-image.";
    if (status === "offline") return "Провайдер сейчас недоступен.";
    return "Провайдер не настроен.";
  }

  function scheduleAutosave(markDirty = true) {
    if(markDirty && current()?.photopeaMasterId) current().photopeaMasterId=null;
    if(markDirty) window.WorkHistory?.changed(state.activeFormat);
    clearTimeout(state.autosaveTimer);
    state.autosaveTimer = setTimeout(saveAutosave, 500);
  }

  function selectLayer(layer) {
    state.selectedLayer = layer === "logo" ? "logo" : "poster";
    $("posterLayerSelect").value = state.selectedLayer;
    posterImage.classList.toggle("selected-layer", state.selectedLayer === "poster" && !posterImage.hidden);
    logoImage.classList.toggle("selected-layer", state.selectedLayer === "logo" && !logoImage.hidden);
    syncLayerControls();
    requestAnimationFrame(updateTransformOverlay);
  }

  function syncLayerControls() {
    const s = current();
    const prefix = state.selectedLayer;
    const scaleInput = $("layerScaleInput");
    scaleInput.min = prefix === "poster" ? "100" : "10";
    scaleInput.value = Math.max(prefix === "poster" ? 100 : 10, s[prefix + "Scale"]);
    $("layerRotationInput").value = s[prefix + "Rotation"];
    $("posterLockInput").checked = s.posterLocked;
    $("logoLockInput").checked = s.logoLocked;
    $("posterBgInput").value = s.background;
    $("layerOpacityInput").value = Math.round((s[prefix+"Opacity"]??1)*100);
    $("layerVisibleInput").checked = s[prefix+"Visible"]!==false;
    for(const id of ["layerScaleInput","layerRotationInput","layerOpacityInput","layerPositionInput","layerVisibleInput","centerLayerBtn","resetLayerBtn","posterLayerUpBtn","posterLayerDownBtn"])
      $(id).disabled = !!s[prefix+"Locked"];
    $("posterLockLabel").textContent=s.posterLocked?"Заблокирован":"Открыт";
    $("logoLockLabel").textContent=s.logoLocked?"Заблокирован":"Открыт";
    $("removePosterLogoBtn").disabled=!s.logo || s.logoLocked;
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
    $("removePosterLogoBtn").disabled = !s.logo;
    if (s.poster && posterImage.src !== s.poster) posterImage.src = s.poster;
    if (s.logo && logoImage.src !== s.logo) logoImage.src = s.logo;

    const order = Array.isArray(s.order) ? s.order : ["poster", "logo"];
    posterImage.style.zIndex = String(order.indexOf("poster") + 1);
    logoImage.style.zIndex = String(order.indexOf("logo") + 1);

    posterImage.style.left = s.posterX + "%";
    posterImage.style.top = s.posterY + "%";
    const image=decodedImages.get(s.poster);
    if(s.poster && !image) loadImage(s.poster).then(()=>{if(s===current()) renderPoster();}).catch(error=>setPosterStatus(error.message,"error"));
    if(image) {
      const rect=posterGeometry(s,f,image);
      s.posterX=rect.x/f.w*100;s.posterY=rect.y/f.h*100;
      posterImage.style.left=s.posterX+"%";posterImage.style.top=s.posterY+"%";
      posterImage.style.width=(rect.w/f.w*100)+"%";
      posterImage.style.height=(rect.h/f.h*100)+"%";
      posterImage.style.transform=`translate(-50%,-50%) rotate(${s.posterRotation}deg)`;
    }
    posterImage.style.opacity=String(s.posterOpacity??1);
    logoImage.style.opacity=String(s.logoOpacity??1);
    posterImage.hidden=!s.poster || s.posterVisible===false;
    logoImage.hidden=!s.logo || s.logoVisible===false;

    logoImage.style.left = s.logoX + "%";
    logoImage.style.top = s.logoY + "%";
    logoImage.style.width = "35%";
    logoImage.style.height = "auto";
    logoImage.style.transform = `translate(-50%,-50%) rotate(${s.logoRotation}deg) scale(${s.logoScale / 100})`;

    $("posterEmpty").hidden = !!s.poster;
    selectLayer(state.selectedLayer);
    requestAnimationFrame(updateTransformOverlay);
  }

  function selectedDomLayer() {
    const s=current();
    if(state.selectedLayer==="logo"&&s.logo) return {el:logoImage,layer:"logo",locked:!!s.logoLocked};
    if(state.selectedLayer==="poster"&&s.poster) return {el:posterImage,layer:"poster",locked:!!s.posterLocked};
    return null;
  }

  function updateTransformOverlay() {
    const selected=selectedDomLayer();
    if(!selected||!transformOverlay||selected.el.hidden){
      if(transformOverlay) transformOverlay.hidden=true;
      return;
    }
    const stageRect=stage.getBoundingClientRect();
    const raw=selected.el.getBoundingClientRect();
    const rect=selected.layer==="poster"?{left:Math.max(raw.left,stageRect.left+5),top:Math.max(raw.top,stageRect.top+5),width:Math.min(raw.right,stageRect.right-5)-Math.max(raw.left,stageRect.left+5),height:Math.min(raw.bottom,stageRect.bottom-5)-Math.max(raw.top,stageRect.top+5)}:raw;
    transformOverlay.hidden=false;
    transformOverlay.classList.toggle("locked",selected.locked);
    transformOverlay.style.left=(rect.left-stageRect.left)+"px";
    transformOverlay.style.top=(rect.top-stageRect.top)+"px";
    transformOverlay.style.width=rect.width+"px";
    transformOverlay.style.height=rect.height+"px";
  }

  function startHandleTransform(event) {
    const action=event.currentTarget.dataset.transformAction;
    const selected=selectedDomLayer();
    if(!selected||selected.locked)return;
    const rect=selected.el.getBoundingClientRect();
    const cx=rect.left+rect.width/2,cy=rect.top+rect.height/2;
    const dx=event.clientX-cx,dy=event.clientY-cy;
    const s=current(),layer=selected.layer;
    state.handleTransform={
      action,layer,pointerId:event.pointerId,cx,cy,
      startDistance:Math.max(1,Math.hypot(dx,dy)),
      startAngle:Math.atan2(dy,dx),
      originScale:Number(s[layer+"Scale"]||100),
      originRotation:Number(s[layer+"Rotation"]||0)
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }

  function moveHandleTransform(event) {
    const t=state.handleTransform;
    if(!t||t.pointerId!==event.pointerId)return false;
    const dx=event.clientX-t.cx,dy=event.clientY-t.cy,s=current();
    if(t.action==="scale"){
      const ratio=Math.hypot(dx,dy)/t.startDistance;
      const min=t.layer==="poster"?100:10;
      s[t.layer+"Scale"]=Math.max(min,Math.min(300,t.originScale*ratio));
    } else if(t.action==="rotate"){
      const angle=Math.atan2(dy,dx);
      s[t.layer+"Rotation"]=Math.max(-360,Math.min(360,t.originRotation+(angle-t.startAngle)*180/Math.PI));
    }
    renderPoster();
    return true;
  }

  function endHandleTransform(event) {
    if(!state.handleTransform||(event.pointerId!=null&&state.handleTransform.pointerId!==event.pointerId))return false;
    state.handleTransform=null;
    scheduleAutosave();
    updateTransformOverlay();
    return true;
  }

  function setFormat(format) {
    if (!formats[format]) return;
    state.drag=null; state.handleTransform=null;
    state.activeFormat = format;
    renderPoster(); syncAiPanel();
    setPosterStatus(formats[format].label + " редактор активен");
  }

  function switchWorkspace(name) {
    window.scrollTo({top:0,left:0,behavior:"instant"});
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
    $("top10Workspace").hidden = name !== "top10";
    $("top10Workspace").classList.toggle("active", name === "top10");
    $("photopeaWorkspace").hidden = name !== "photopea";
    $("photopeaWorkspace").classList.toggle("active", name === "photopea");

    if (posterMode) setFormat(name);
    if (name === "train") window.TrainEditor?.activate();
    if (name === "top10") window.Top10Editor?.activate();
    if (name === "photopea" && $("photopeaFrame").src === "about:blank") $("photopeaFrame").src = $("photopeaFrame").dataset.src;
  }

  function removePosterLogo() {
    const s = current();
    if (!s.logo || s.logoLocked) return;
    s.logo = null;
    s.logoName = "";
    s.logoAssetId = null;
    s.logoX = 50;
    s.logoY = 50;
    s.logoScale = 100;
    s.logoRotation = 0;
    s.logoLocked = false;
    if (state.selectedLayer === "logo") state.selectedLayer = "poster";
    renderPoster();
    scheduleAutosave();
    showToast("Логотип удалён.", "ok");
  }

  async function setImageLayer(layer, src, name = "", options = {}) {
    const s = current();
    if(options.respectLock && s[layer+"Locked"]) throw new Error("Сначала откройте замок слоя.");
    if(layer!=="logo") src=await EditorCore.trimPoster(src);
    await loadImage(src);
    s.photopeaMasterId = null;
    if (layer === "logo") {
      if(!options.keepAiOriginal) {s.aiOriginal=src;s.aiResults=[];s.aiSelected=null;}
      s.logo = src; s.logoName = name; s.logoAssetId = options.assetId || null;
      s.logoX = 50; s.logoY = 50; s.logoScale = 100; s.logoRotation = 0;
    } else {
      s.poster = src; s.posterName = name; s.posterAssetId = options.assetId || null;
      s.posterX = 50; s.posterY = 50; s.posterScale = 100; s.posterRotation = 0; s.posterMode = "cover";
    }
    state.selectedLayer = layer;
    if(s===current()) { renderPoster(); syncAiPanel(); }
    scheduleAutosave();
  }

  async function applyPhotopeaComposite(format, src, name = "Photopea result", assetId = null, masterId = null) {
    if (!formats[format]) throw new Error("Неизвестный формат постера.");
    const next = makePosterState();
    next.poster = src;
    next.posterName = name;
    next.posterAssetId = assetId;
    next.posterMode = "exact";
    next.posterLocked = false;
    next.photopeaMasterId = masterId;
    state.posters[format] = next;
    if (state.activeFormat === format) {
      state.selectedLayer = "poster";
      renderPoster();
    }
    await saveAutosave();
  }

  function getPhotopeaMasterId(format = state.activeFormat) {
    return state.posters[format]?.photopeaMasterId || null;
  }

  function changePosterLayerOrder(delta) {
    const s = current();
    if(s[state.selectedLayer+"Locked"]) return;
    const order = Array.isArray(s.order) ? [...s.order] : ["poster", "logo"];
    const index = order.indexOf(state.selectedLayer);
    if (index < 0) return;
    const target = Math.max(0, Math.min(order.length - 1, index + delta));
    if (target === index) return;
    order.splice(index, 1);
    order.splice(target, 0, state.selectedLayer);
    s.order = order;
    renderPoster();
    scheduleAutosave();
  }

  function resetSelectedLayer() {
    const s = current();
    const p = state.selectedLayer;
    if(s[p+"Locked"]) return;
    s[p + "X"] = 50;
    s[p + "Y"] = 50;
    s[p + "Scale"] = 100;
    s[p + "Rotation"] = 0;
    renderPoster();
    scheduleAutosave();
  }

  async function checkServer() {
    state.backgroundProviders.local = localBackgroundReady();
    if (!apiBase && location.protocol === "file:") {
      state.aiProviders = { cloudflare: false, xai: false, openai: false };
      state.backgroundProviders = { local: localBackgroundReady(), carve: false, removal: false };
      $("aiServerBadge").textContent = "не настроен";
      $("aiServerBadge").className = "error";
      updateAiAvailability();
      updateBgAvailability();
      return;
    }
    try {
      let response = await fetch(apiBase + "/api/health", { cache: "no-store", signal: AbortSignal.timeout(15000) });
      if (response.status === 404 || response.status === 405) {
        response = await fetch(apiBase + "/api/status", { cache: "no-store", signal: AbortSignal.timeout(15000) });
      }
      if (!response.ok) throw new Error("HTTP " + response.status);
      const data = await response.json();
      state.workerVersion = data.apiVersion || "legacy";
      state.imageProviders = data.images || {};
      state.aiProviderDetails = data.providerDetails || data.services?.ai?.providers || {};
      if (state.workerVersion !== EXPECTED_API_VERSION) {
        state.aiProviders = { cloudflare: false, xai: false, openai: false };
        state.backgroundProviders = { local: localBackgroundReady(), carve: false, removal: false };
        $("aiServerBadge").textContent = "нужен deploy";
        $("aiServerBadge").className = "error";
        $("bgProviderBadge").textContent = state.backgroundProviders.local ? "local online" : "нужен deploy";
        $("bgProviderBadge").className = state.backgroundProviders.local ? "ok" : "error";
        setAiStatus("На Cloudflare работает старая версия Worker. Нужен повторный deploy.", "error");
        updateAiAvailability();
        updateBgAvailability();
        return;
      }
      state.aiProviders = {
        cloudflare: !!data.providers?.cloudflare,
        xai: !!data.providers?.xai,
        openai: !!data.providers?.openai
      };
      state.backgroundProviders = {
        local: localBackgroundReady(),
        carve: !!data.background?.carve,
        removal: !!data.background?.removal
      };
      const aiCount = Object.values(state.aiProviders).filter(Boolean).length;
      const bgCount = Object.values(state.backgroundProviders).filter(Boolean).length;
      $("aiServerBadge").textContent = aiCount ? aiCount + "/3 настроено" : "не настроен";
      $("aiServerBadge").className = aiCount ? "ok" : "error";
      $("bgProviderBadge").textContent = bgCount ? bgCount + "/3 настроено" : "не настроен";
      $("bgProviderBadge").className = bgCount ? "ok" : "error";
      updateAiAvailability();
      updateBgAvailability();
    } catch (error) {
      state.aiProviders = { cloudflare: false, xai: false, openai: false };
      state.backgroundProviders = { local: localBackgroundReady(), carve: false, removal: false };
      $("aiServerBadge").textContent = "worker offline";
      $("aiServerBadge").className = "error";
      $("bgProviderBadge").textContent = state.backgroundProviders.local ? "local online" : "offline";
      $("bgProviderBadge").className = state.backgroundProviders.local ? "ok" : "error";
      setAiStatus("Worker недоступен: " + (error.message || "ошибка сети") + ".", "error");
      updateBgAvailability();
    }
  }

  function updateAiAvailability() {
    const provider = $("aiProvider").value;
    const ready = !!state.aiProviders[provider];
    $("generateBtn").disabled = !ready;
    if (ready) {
      const message = provider === "cloudflare"
        ? "Workers AI FLUX.2 Klein готов. Использует дневную free allocation Cloudflare, затем действуют тарифы аккаунта."
        : "Провайдер настроен на сервере. Генерация платная; доступность проверяется при запросе.";
      setAiStatus(message, "ok");
    } else {
      setAiStatus(providerStatusMessage(state.aiProviderDetails?.[provider]), "error");
    }
  }

  function updateBgAvailability() {
    state.backgroundProviders.local = localBackgroundReady();
    const provider = $("bgProviderSelect").value;
    const ready = provider === "auto"
      ? Object.values(state.backgroundProviders).some(Boolean)
      : !!state.backgroundProviders[provider];
    $("removeBackgroundBtn").disabled = !ready;
    if (!ready) {
      setBgStatus(provider === "auto" ? "Ни один способ удаления фона недоступен." : "Выбранный провайдер не настроен.", "error");
    } else if (provider === "local" || (provider === "auto" && state.backgroundProviders.local)) {
      setBgStatus("Локальное удаление фона готово. Первый запуск загрузит модель и сохранит её в кэше браузера.", "ok");
    } else {
      setBgStatus("Удаление фона готово через серверный API.", "ok");
    }
  }

  const creditMessage="На аккаунте Puter/Grok закончились доступные кредиты или исчерпан лимит генерации. Попробуйте другой AI-провайдер или повторите позже";
  function aiError(error) {
    const message=String(error?.message||error||"");
    if(/insufficient.*(credit|balance|fund)|not.*enough.*(credit|balance|fund)|doesn.t have enough|quota.*exceed|low.balance/i.test(message)) return creditMessage;
    if(error?.name==="TimeoutError" || error?.name==="AbortError") return "AI-сервис не ответил вовремя. Попробуйте позже.";
    return message||"Не удалось получить результат AI.";
  }
  function buildLogoPrompt(title,language,extra="") {
    return `Используй загруженный PNG-логотип как строгий визуальный референс. Замени только оригинальный текст на точное название: "${title}". Язык текста: ${language}.
Сохрани исходную форму логотипа, композицию, количество строк, расположение элементов, пропорции, перспективу, контуры, толщину обводки, цветовую палитру, градиенты, текстуры, потёртости, объём, тени, свечение и общий характер дизайна.
Используй шрифт, максимально близкий к исходному по начертанию, ширине, наклону, толщине и декоративным особенностям. Новый текст должен быть грамматически правильным, полностью читаемым и написан точно так: "${title}".
Не изменяй смысл и визуальную идентичность логотипа. Не добавляй новые слова, случайные буквы, транслитерацию, подписи, водяные знаки, рамки, изображения, персонажей, предметы или фон.
Не растягивай, не сжимай, не переворачивай, не дублируй и не обрезай буквы. Не создавай повторяющийся текст. Не допускай наложения букв друг на друга. Не заменяй кириллицу латиницей.
Сохрани исходное соотношение сторон логотипа. Оставь безопасные поля вокруг изображения. Результат должен содержать только один готовый логотип, без мокапа и без размещения на постере.
Выведи профессиональный PNG с прозрачным фоном в максимально доступном разрешении.
Дополнительные пожелания: ${extra}`;
  }
  function syncAiPanel() {
    const s=current();
    $("aiTitle").value=s.aiTitle||"";$("aiLanguage").value=s.aiLanguage||"kk";
    $("aiTitleLabel").textContent=s.aiLanguage==="ru"?"Название на русском":"Название на казахском";
    $("aiTitle").placeholder=s.aiLanguage==="ru"?"Точное русское название":"Жекпе-жек чемпиондары";
    $("aiOriginalPreview").hidden=!s.aiOriginal;
    if(s.aiOriginal) $("aiOriginalPreview").src=s.aiOriginal;
    renderAiResults(s.aiResults||[],s.aiSelected);
  }
  async function generateAi() {
    const provider=$("aiProvider").value, s=current(), source=s.aiOriginal||s.logo;
    const title=$("aiTitle").value.trim(), language=$("aiLanguage").value==="kk"?"казахский":"русский";
    if(!title) return setAiStatus(language==="казахский"?"Введите точное название на казахском языке":"Введите точное название на русском языке","error");
    if(!source) return setAiStatus("Сначала добавьте логотип.","error");
    if(!state.aiProviders[provider]) return updateAiAvailability();
    const button=$("generateBtn"); button.disabled=true;
    s.aiOriginal=source;s.aiTitle=title;s.aiLanguage=$("aiLanguage").value;
    setAiStatus("Генерация трёх вариантов...");
    try {
      const image=provider==="cloudflare"?await resizeDataUrlForAi(source,510):await sourceToDataUrl(source);
      const prompt=buildLogoPrompt(title,language,$("aiPrompt").value.trim());
      const response=await fetch(apiBase+"/api/generate",{
        method:"POST",headers:{"Content-Type":"application/json"},signal:AbortSignal.timeout(120000),
        body:JSON.stringify({provider,prompt,image,count:3})
      });
      const data=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(typeof data.error==="string"?data.error:data.message||data.error?.message||"Ошибка AI (HTTP "+response.status+").");
      if(!Array.isArray(data.images)||!data.images.length) throw new Error("API не вернул изображения.");
      s.aiResults=data.images; s.aiSelected=data.images[0];
      if(s===current()) { syncAiPanel(); setAiStatus("Готово. Выберите вариант и нажмите «Переместить на постер».","ok"); }
      scheduleAutosave(false);
    } catch(error) {setAiStatus(aiError(error),"error");}
    finally {button.disabled=!state.aiProviders[$("aiProvider").value];}
  }

  function renderAiResults(images,selected=images[0]) {
    $("moveResultBtn").disabled=!images.length;$("downloadResultBtn").disabled=!images.length;
    $("aiResultPreview").hidden=!images.length;
    if(selected) $("aiResultPreview").src=selected;
    $("aiResultLabel").textContent=$("aiProvider").value==="xai"?"Результат Grok":$("aiProvider").value==="openai"?"Результат GPT":"Результат AI";
    const root = $("results");
    root.innerHTML = "";
    state.selectedAiResult = null;
    images.forEach((src, index) => {
      const button = document.createElement("button");
      button.className = "result-card" + (src === selected ? " active" : "");
      const img = document.createElement("img");
      img.src = src;
      img.alt = "AI вариант " + (index + 1);
      button.appendChild(img);
      button.addEventListener("click", () => {
        root.querySelectorAll(".result-card").forEach(x => x.classList.remove("active"));
        button.classList.add("active");
        state.selectedAiResult = src;
        current().aiSelected=src; $("aiResultPreview").src=src;
        $("moveResultBtn").disabled = false;
        $("downloadResultBtn").disabled = false;
      });
      root.appendChild(button);
      if (src === selected) {
        state.selectedAiResult = src;
        current().aiSelected=src; $("aiResultPreview").src=src;
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
      const requested = $("bgProviderSelect").value;
      const provider = requested === "auto"
        ? (state.backgroundProviders.local ? "local" : state.backgroundProviders.carve ? "carve" : state.backgroundProviders.removal ? "removal" : null)
        : requested;
      if (!provider) throw new Error("Нет доступного провайдера удаления фона.");

      let data;
      if (provider === "local") {
        if (!localBackgroundReady()) throw new Error("Локальная модель недоступна в этом браузере.");
        const resultBlob = await LocalBackgroundRemoval.remove(image, message => setBgStatus(message));
        data = {
          image: await blobToDataUrl(resultBlob),
          provider: "Local @imgly/background-removal"
        };
      } else {
        const response = await fetch(apiBase + "/api/remove-background", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider, image })
        });
        data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Не удалось удалить фон.");
      }

      if (!data.image) throw new Error("Провайдер не вернул прозрачное изображение.");
      s[layer] = data.image;
      if (window.AssetManager) {
        const key = layer + "AssetId";
        try {
          let asset = s[key] ? await AssetManager.get(s[key]) : null;
          if (asset) {
            asset = await AssetManager.updateEdited(asset.id, data.image, asset.filters || null, {
              source: asset.source || "background-removal"
            });
          } else {
            asset = await AssetManager.fromDataUrl(data.image, {
              source: "background-removal",
              sourceId: (s[layer + "Name"] || layer) + "-no-bg",
              title: s[layer + "Name"] || "Background removed",
              imageType: layer === "logo" ? "logo" : "poster"
            });
          }
          s[key] = asset.id;
        } catch (assetError) {
          console.warn("Asset Manager background removal update failed", assetError);
        }
      }
      renderPoster();
      scheduleAutosave();
      setBgStatus("Фон удалён через " + (data.provider || provider) + ". Оригинал сохранён в Asset Manager. Положение и трансформация сохранены.", "ok");
    } catch (error) {
      setBgStatus(error.message || "Ошибка удаления фона.", "error");
    } finally {
      const selectedProvider = $("bgProviderSelect").value;
      $("removeBackgroundBtn").disabled = selectedProvider === "auto"
        ? !Object.values(state.backgroundProviders).some(Boolean)
        : !state.backgroundProviders[selectedProvider];
    }
  }

  function loadImage(src) {
    if(decodedImages.has(src)) return Promise.resolve(decodedImages.get(src));
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => {decodedImages.set(src,image);resolve(image);};
      image.onerror = () => reject(new Error("Не удалось загрузить изображение для экспорта."));
      image.src = src;
    });
  }

  function posterGeometry(s,f,image) {
    return EditorCore.cover(image.naturalWidth,image.naturalHeight,f.w,f.h,Math.max(1,s.posterScale/100),s.posterRotation||0,f.w*s.posterX/100,f.h*s.posterY/100);
  }

  async function photopeaAssetSource(assetId, fallbackSrc) {
    if (!assetId) return { dataUrl:fallbackSrc, assetId:null, filtered:false };
    try {
      const asset=await AssetManager.get(assetId);
      if (!asset) return { dataUrl:fallbackSrc, assetId, filtered:false };
      const filtered=!!asset.editedAsset && !!asset.filters && Object.values(asset.filters).some(value=>Number(value)!==0);
      return {
        dataUrl:fallbackSrc || await AssetManager.dataUrl(asset,true),
        assetId:asset.id,
        filtered,
        filters:asset.filters||null,
        originalDataUrl:await AssetManager.dataUrl(asset,false)
      };
    } catch(error) {
      console.warn("Photopea asset fallback",error);
      return { dataUrl:fallbackSrc, assetId, filtered:false };
    }
  }

  async function buildPhotopeaModel(format=state.activeFormat) {
    const f=formats[format],s=state.posters[format];
    if(!f||!s) throw new Error("Неизвестный формат постера.");
    const layers=[{
      id:"canvas-background",name:"Background",type:"background",color:s.background||"#000000",
      x:f.w/2,y:f.h/2,width:f.w,height:f.h,scaleX:1,scaleY:1,rotation:0,opacity:1,visible:true,locked:true,zIndex:0
    }];
    const defs=[];
    if(s.poster){
      const source=await photopeaAssetSource(s.posterAssetId,s.poster);
      const image=await loadImage(source.dataUrl);
      const rect=posterGeometry(s,f,image);
      defs.push({
        id:"poster",name:"Постер",type:"image",role:"poster",
        assetId:s.posterAssetId||null,sourceDataUrl:source.dataUrl,originalDataUrl:source.originalDataUrl||source.dataUrl,
        filters:source.filters||null,sourceWidth:image.naturalWidth,sourceHeight:image.naturalHeight,
        x:rect.x,y:rect.y,width:rect.w,height:rect.h,
        scaleX:1,scaleY:1,rotation:s.posterRotation||0,opacity:s.posterOpacity??1,visible:s.posterVisible!==false,locked:!!s.posterLocked,
        crop:{mode:"cover",boxWidth:f.w,boxHeight:f.h},zIndex:0
      });
    }
    if(s.logo){
      const source=await photopeaAssetSource(s.logoAssetId,s.logo);
      const image=await loadImage(source.dataUrl);
      const baseW=f.w*.35,baseH=baseW*image.naturalHeight/image.naturalWidth;
      defs.push({
        id:"logo",name:"Логотип",type:"image",role:"logo",assetId:s.logoAssetId||null,
        sourceDataUrl:source.dataUrl,originalDataUrl:source.originalDataUrl||source.dataUrl,
        sourceWidth:image.naturalWidth,sourceHeight:image.naturalHeight,
        x:f.w*s.logoX/100,y:f.h*s.logoY/100,width:baseW*s.logoScale/100,height:baseH*s.logoScale/100,
        scaleX:1,scaleY:1,rotation:s.logoRotation||0,opacity:s.logoOpacity??1,visible:s.logoVisible!==false,locked:!!s.logoLocked,zIndex:0
      });
    }
    const order=Array.isArray(s.order)?s.order:["poster","logo"];
    for(const key of order){const layer=defs.find(item=>item.id===key);if(layer){layer.zIndex=layers.length;layers.push(layer);}}
    for(const layer of defs){if(!layers.includes(layer)){layer.zIndex=layers.length;layers.push(layer);}}
    return {version:1,workspace:format,document:{name:format==="vertical"?"VERTICAL POSTER":"HORIZONTAL POSTER",width:f.w,height:f.h,background:s.background||"#000000"},layers};
  }

  async function renderPosterBlob(format) {
    const f = formats[format];
    const s = structuredClone(state.posters[format]);
    const canvas = document.createElement("canvas");
    canvas.width = f.w; canvas.height = f.h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = s.background || "#000";
    ctx.fillRect(0, 0, f.w, f.h);

    async function drawPosterLayer() {
      if(!s.poster || s.posterVisible===false) return;
      const image=await loadImage(s.poster);
      EditorCore.draw(ctx,image,posterGeometry(s,f,image),s.posterOpacity??1);
    }

    async function drawLogoLayer() {
      if (!s.logo || s.logoVisible===false) return;
      const image = await loadImage(s.logo);
      const baseW = f.w * 0.35;
      const baseH = baseW * image.naturalHeight / image.naturalWidth;
      ctx.save();
      ctx.globalAlpha=s.logoOpacity??1;
      ctx.translate(f.w * s.logoX / 100, f.h * s.logoY / 100);
      ctx.rotate(s.logoRotation * Math.PI / 180);
      ctx.scale(s.logoScale / 100, s.logoScale / 100);
      ctx.drawImage(image, -baseW / 2, -baseH / 2, baseW, baseH);
      ctx.restore();
    }

    const drawOrder = Array.isArray(s.order) ? s.order : ["poster", "logo"];
    for (const layer of drawOrder) {
      if (layer === "poster") await drawPosterLayer();
      if (layer === "logo") await drawLogoLayer();
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
      await window.WorkArchive?.captureWorkspace?.(format,"download-poster");
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
      await window.WorkArchive?.captureWorkspace?.("vertical","download-all");
      await window.WorkArchive?.captureWorkspace?.("horizontal","download-all");
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function resetWorkspace(format) {
    if (!formats[format]) throw new Error("Неизвестный формат постера.");
    state.posters[format] = makePosterState();
    if (state.activeFormat === format) { state.selectedLayer = "poster"; renderPoster(); }
    await saveAutosave();
    showToast((format === "vertical" ? "Вертикальный" : "Горизонтальный") + " постер сброшен.", "ok");
  }

  async function restoreWorkspace(format, snapshot) {
    if (!formats[format]) throw new Error("Неизвестный формат постера.");
    state.posters[format] = { ...makePosterState(), ...(snapshot || {}) };
    if (state.activeFormat === format) {
      state.selectedLayer = state.posters[format].poster ? "poster" : (state.posters[format].logo ? "logo" : "poster");
      renderPoster();
    }
    await saveAutosave();
  }

  function plainProject() {
    return {
      version: 4,
      type: "poster-editor-project",
      title: $("projectTitle")?.value.trim()||"",
      updatedAt: Date.now(),
      posters: JSON.parse(JSON.stringify(state.posters)),
      train: window.TrainEditor?.serialize?.() || null,
      top10: window.Top10Editor?.serialize?.() || null
    };
  }

  async function saveAutosave() {
    if (!window.SkoomaStore) return;
    try {
      const project = plainProject();
      project.id = "poster-editor-autosave";
      await SkoomaStore.saveProject(project);
    } catch (error) {
      showToast("Автосохранение не удалось. Скачайте проект, чтобы сохранить работу.","error");
    }
  }

  async function saveProject() {
    const project = plainProject();
    project.id = "poster-editor-autosave";
    try { await SkoomaStore?.saveProject(project); } catch {}
    project.assets=[];project.photopeaMasters=[];
    const workspaces={...project.posters,train:project.train,top10:project.top10};
    for(const [workspace,snapshot] of Object.entries(workspaces)) {
      if(!snapshot) continue;
      project.assets.push(...(await window.WorkArchive?.bundleAssets?.(workspace,snapshot)||[]));
      if(snapshot.photopeaMasterId) {
        const master=await SkoomaStore.getPhotopeaMaster(snapshot.photopeaMasterId);
        if(master?.blob) project.photopeaMasters.push({...master,blob:undefined,dataUrl:await blobToDataUrl(master.blob)});
      }
    }
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    downloadBlob(blob, "poster-project.json");
    await window.WorkArchive?.captureAll?.("save-project");
    showToast("Проект сохранён локально, в JSON и Архив работ.", "ok");
  }

  async function restoreProject(project) {
    if (!project || project.type !== "poster-editor-project" || !project.posters) throw new Error("Это не проект Poster Editor.");
    await window.WorkArchive?.restoreBundledAssets?.(project.assets||[]);
    for(const master of project.photopeaMasters||[]) if(master.masterId && master.dataUrl) await SkoomaStore.savePhotopeaMaster({...master,dataUrl:undefined,blob:await AssetManager.dataUrlToBlob(master.dataUrl)});
    state.posters.vertical = { ...makePosterState(), ...(project.posters.vertical || {}) };
    state.posters.horizontal = { ...makePosterState(), ...(project.posters.horizontal || {}) };
    renderPoster();
    if (project.train) {
      if (window.TrainEditor?.restore) await window.TrainEditor.restore(project.train);
      else window.__pendingTrainProject = project.train;
    }
    if (window.Top10Editor?.restore) await window.Top10Editor.restore(project.top10 || null);
    else window.__pendingTop10Project = project.top10 || null;
    if($("projectTitle")) $("projectTitle").value=project.title||"";
    window.WorkHistory?.reset();
    syncAiPanel();
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

  function layerLocked(layer, s = current()) {
    return layer === "poster" ? !!s.posterLocked : !!s.logoLocked;
  }

  function beginDrag(layer, event) {
    const s = current();
    if (layerLocked(layer, s)) return;
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
    if (moveHandleTransform(event)) return;
    if (!state.drag || state.drag.pointerId !== event.pointerId) return;
    const d = state.drag;
    const s = current();
    s[d.layer + "X"] = Math.max(-50, Math.min(150, d.originX + (event.clientX - d.startX) / d.stageW * 100));
    s[d.layer + "Y"] = Math.max(-50, Math.min(150, d.originY + (event.clientY - d.startY) / d.stageH * 100));
    renderPoster();
  }

  function endDrag(event) {
    if (endHandleTransform(event)) return;
    if (!state.drag || (event.pointerId != null && state.drag.pointerId !== event.pointerId)) return;
    posterImage.classList.remove("dragging");
    logoImage.classList.remove("dragging");
    state.drag = null;
    scheduleAutosave();
  }

  function scaleWithWheel(event) {
    const targetLayer = event.target === logoImage ? "logo" : event.target === posterImage ? "poster" : state.selectedLayer;
    const s = current();
    if (!s[targetLayer] || layerLocked(targetLayer, s)) return;
    event.preventDefault();
    selectLayer(targetLayer);
    const key = targetLayer + "Scale";
    const min = targetLayer === "poster" ? 100 : 10;
    const max = 300;
    const direction = event.deltaY < 0 ? 1 : -1;
    const step = event.shiftKey ? 1 : 4;
    s[key] = Math.max(min, Math.min(max, Math.round(s[key] + direction * step)));
    renderPoster();
    scheduleAutosave();
  }

  function getSelectedImageContext() {
    const s = current();
    const layer = state.selectedLayer;
    return {
      format: state.activeFormat,
      layer,
      src: s[layer],
      name: s[layer + "Name"] || "",
      assetId: s[layer + "AssetId"] || null
    };
  }

  function attachAssetId(layer, assetId) {
    const key = (layer === "logo" ? "logo" : "poster") + "AssetId";
    current()[key] = assetId || null;
    scheduleAutosave();
  }

  document.querySelectorAll(".workspace-tab").forEach(btn => btn.addEventListener("click", () => switchWorkspace(btn.dataset.workspace)));
  $("posterFileInput").addEventListener("change", async e => {
    try {
      const file = e.target.files?.[0];
      if (file) {
        const asset = window.AssetManager ? await AssetManager.fromFile(file, { imageType: "poster" }) : null;
        const src = asset ? await AssetManager.dataUrl(asset, true) : await readFile(file);
        await setImageLayer("poster", src, file.name, { assetId: asset?.id || null });
      }
    } catch (error) { showToast(error.message, "error"); }
    e.target.value = "";
  });
  $("removePosterLogoBtn").addEventListener("click", removePosterLogo);
  $("logoFileInput").addEventListener("change", async e => {
    try {
      const file = e.target.files?.[0];
      if (file) {
        const asset = window.AssetManager ? await AssetManager.fromFile(file, { imageType: "logo" }) : null;
        const src = asset ? await AssetManager.dataUrl(asset, true) : await readFile(file);
        await setImageLayer("logo", src, file.name, { assetId: asset?.id || null });
      }
    } catch (error) { showToast(error.message, "error"); }
    e.target.value = "";
  });
  // Unified source browser owns posterSearchBtn / posterSearchInput.
  $("posterLayerSelect").addEventListener("change", e => selectLayer(e.target.value));
  $("layerScaleInput").addEventListener("input", e => {
    if(current()[state.selectedLayer+"Locked"]) return;
    const min = state.selectedLayer === "poster" ? 100 : 10;
    current()[state.selectedLayer + "Scale"] = Math.max(min, +e.target.value);
    renderPoster(); scheduleAutosave();
  });
  $("layerRotationInput").addEventListener("input", e => { if(current()[state.selectedLayer+"Locked"]) return; current()[state.selectedLayer + "Rotation"] = +e.target.value; renderPoster(); scheduleAutosave(); });
  $("centerLayerBtn").addEventListener("click", () => { if(current()[state.selectedLayer+"Locked"]) return; current()[state.selectedLayer + "X"] = 50; current()[state.selectedLayer + "Y"] = 50; renderPoster(); scheduleAutosave(); });
  $("resetLayerBtn").addEventListener("click", resetSelectedLayer);
  $("posterLayerUpBtn").addEventListener("click", () => changePosterLayerOrder(1));
  $("posterLayerDownBtn").addEventListener("click", () => changePosterLayerOrder(-1));
  $("posterLockInput").addEventListener("change", e => { current().posterLocked = e.target.checked; state.drag=null;state.handleTransform=null;syncLayerControls();updateTransformOverlay();scheduleAutosave(); });
  $("logoLockInput").addEventListener("change", e => { current().logoLocked = e.target.checked; state.drag=null;state.handleTransform=null;syncLayerControls();updateTransformOverlay();scheduleAutosave(); });
  $("posterBgInput").addEventListener("input", e => { current().background = e.target.value; renderPoster(); scheduleAutosave(); });
  $("aiTitle").addEventListener("input",e=>{current().aiTitle=e.target.value;scheduleAutosave(false);});
  $("aiLanguage").addEventListener("change",e=>{current().aiLanguage=e.target.value;syncAiPanel();scheduleAutosave(false);});
  $("layerOpacityInput").addEventListener("input",e=>{if(current()[state.selectedLayer+"Locked"]) return;current()[state.selectedLayer+"Opacity"]=+e.target.value/100;renderPoster();scheduleAutosave();});
  $("layerVisibleInput").addEventListener("change",e=>{if(current()[state.selectedLayer+"Locked"]) return;current()[state.selectedLayer+"Visible"]=e.target.checked;renderPoster();scheduleAutosave();});
  $("layerPositionInput").addEventListener("change",e=>{
    const s=current(),p=state.selectedLayer,v=e.target.value;if(s[p+"Locked"]) return;
    s[p+"X"]=v==="center"?50:v.endsWith("l")?0:100;
    s[p+"Y"]=v==="center"?50:v.startsWith("t")?0:100;
    if(p==="logo") {const im=decodedImages.get(s.logo),f=formats[state.activeFormat];if(im){const halfW=17.5*s.logoScale/100,halfH=f.w*.35*s.logoScale/100*im.naturalHeight/im.naturalWidth/f.h*50;s.logoX=Math.max(halfW,Math.min(100-halfW,s.logoX));s.logoY=Math.max(halfH,Math.min(100-halfH,s.logoY));}}
    renderPoster();scheduleAutosave();
  });
  $("aiProvider").addEventListener("change", updateAiAvailability);
  $("generateBtn").addEventListener("click", generateAi);
  $("moveResultBtn").addEventListener("click", async () => {
    if (!state.selectedAiResult) return;
    try {
      let asset = null;
      if (window.AssetManager) {
        asset = await AssetManager.fromDataUrl(state.selectedAiResult, {
          source: "ai",
          sourceId: "ai-logo-" + Date.now(),
          title: "AI logo",
          imageType: "logo"
        });
      }
      await setImageLayer("logo", state.selectedAiResult, "AI logo", { assetId: asset?.id || null, keepAiOriginal:true, respectLock:true });
    } catch (error) {
      showToast(error.message || "Не удалось добавить AI-результат.", "error");
    }
  });
  $("downloadResultBtn").addEventListener("click", async () => {
    if (!state.selectedAiResult) return;
    try {
      const im=await loadImage(state.selectedAiResult), out=EditorCore.canvas(im.naturalWidth,im.naturalHeight);
      out.getContext("2d").drawImage(im,0,0);downloadBlob(await EditorCore.png(out),"adapted-logo.png");
      await window.WorkArchive?.captureWorkspace?.(state.activeFormat,"download-ai-result");
    } catch(error) { showToast(error.message||"Не удалось скачать PNG.","error"); }
  });
  $("copyAiPromptBtn").addEventListener("click",async()=>{
    const title=$("aiTitle").value.trim();
    if(!title)return setAiStatus("Введите точное название на выбранном языке","error");
    const prompt=buildLogoPrompt(title,$("aiLanguage").value==="kk"?"казахский":"русский",$("aiPrompt").value);
    try {await navigator.clipboard.writeText(prompt);setAiStatus("Промпт скопирован.","ok");}
    catch {downloadBlob(new Blob([prompt],{type:"text/plain;charset=utf-8"}),"logo-prompt.txt");setAiStatus("Промпт сохранён в текстовый файл.","ok");}
  });
  $("downloadAiSourceBtn").addEventListener("click",async()=>{
    try {const src=current().aiOriginal||current().logo;if(!src)throw new Error("Сначала загрузите логотип.");
      downloadBlob(await AssetManager.dataUrlToBlob(src),"logo-source.png");
    }catch(e){setAiStatus(e.message,"error");}
  });
  $("manualAiResult").addEventListener("change",async e=>{
    const file=e.target.files?.[0];if(!file)return;const target=current();
    try {const src=await AssetManager.blobToDataUrl(file);const im=await loadImage(src);
      const c=EditorCore.canvas(im.naturalWidth,im.naturalHeight);c.getContext("2d").drawImage(im,0,0);
      const result=c.toDataURL("image/png");target.aiResults=[...(target.aiResults||[]),result];target.aiSelected=result;
      if(target===current()){syncAiPanel();setAiStatus("Результат загружен. Примените его кнопкой «Переместить на постер».","ok");}
      scheduleAutosave(false);
    }catch(error){setAiStatus(error.message,"error");}finally{e.target.value="";}
  });
  $("bgProviderSelect").addEventListener("change", updateBgAvailability);
  $("removeBackgroundBtn").addEventListener("click", removeBackground);
  $("filterSelectedBtn").addEventListener("click", () => window.FilterStudio?.openSelected?.().catch(error => showToast(error.message, "error")));
  $("editSelectedPhotopeaBtn").addEventListener("click", () => window.PhotopeaBridge?.editSelected?.().catch(error => showToast(error.message, "error")));
  $("editPosterPhotopeaBtn").addEventListener("click", () => window.PhotopeaBridge?.editCurrentPoster?.().catch(error => showToast(error.message, "error")));
  $("downloadVerticalBtn").addEventListener("click", () => downloadPoster("vertical"));
  $("downloadHorizontalBtn").addEventListener("click", () => downloadPoster("horizontal"));
  $("downloadPostersZipBtn").addEventListener("click", downloadBothPosters);
  $("saveProjectBtn").addEventListener("click",()=>saveProject().catch(error=>showToast(error.message||"Не удалось сохранить проект.","error")));
  $("projectFileInput").addEventListener("change", e => openProjectFile(e.target.files?.[0]));

  transformOverlay.querySelectorAll("[data-transform-action]").forEach(handle=>handle.addEventListener("pointerdown",startHandleTransform));
    posterImage.addEventListener("pointerdown", e => beginDrag("poster", e));
  logoImage.addEventListener("pointerdown", e => beginDrag("logo", e));
  stage.addEventListener("pointermove", moveDrag);
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);
  stage.addEventListener("wheel", scaleWithWheel, { passive: false });
  posterImage.addEventListener("click", () => selectLayer("poster"));
  logoImage.addEventListener("click", () => selectLayer("logo"));

  window.PosterApp = {
    switchWorkspace,
    setFormat,
    setImageLayer,
    attachAssetId,
    serialize: plainProject,
    restore: restoreProject,
    renderPosterBlob,
    buildLogoPrompt,
    aiError,
    buildPhotopeaModel,
    applyPhotopeaComposite,
    getPhotopeaMasterId,
    renderCurrentPosterBlob: () => renderPosterBlob(state.activeFormat),
    getState: () => JSON.parse(JSON.stringify(state.posters)),
    resetWorkspace,
    restoreWorkspace,
    getSelectedImageContext,
    getActiveFormat: () => state.activeFormat,
    getSelectedLayer: () => state.selectedLayer,
    getImageProviders: () => JSON.parse(JSON.stringify(state.imageProviders)),
    downloadBlob,
    formats
  };

  window.addEventListener("resize",()=>requestAnimationFrame(updateTransformOverlay));

  switchWorkspace("vertical");
  renderPoster();
  checkServer();
  setTimeout(restoreAutosave, 0);
})();
