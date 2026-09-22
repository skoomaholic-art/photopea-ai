(() => {
  const $ = id => document.getElementById(id);
  const formats = { vertical: { w: 800, h: 1200, label: "Вертикальный" }, horizontal: { w: 1920, h: 1080, label: "Горизонтальный" } };
  const positions = { center: [50, 50], "top-left": [18, 18], "top-center": [50, 18], "top-right": [82, 18], "middle-left": [18, 50], "middle-right": [82, 50], "bottom-left": [18, 82], "bottom-center": [50, 82], "bottom-right": [82, 82] };
  const posterPositions = { center: [50, 50], top: [50, 35], bottom: [50, 65], left: [35, 50], right: [65, 50] };
  const aiApiBase = (document.querySelector('meta[name="poster-ai-api"]')?.content || "").replace(/\/$/, "");
  const state = { format: "vertical", poster: null, logo: null, x: 50, y: 50, scale: 100, posterX: 50, posterY: 50, posterScale: 100, posterLocked: true, drag: null, grabX: 0, grabY: 0, selectedResult: null, aiProviders: { xai: false, openai: false } };
  const stage = $("stage"), posterImage = $("posterImage"), logo = $("logoImage"), removeLogo = $("removeLogoBtn");
  const setStatus = (text, kind = "") => { $("status").innerHTML = "<i></i>" + text; $("status").className = "status " + kind; };
  const setAiStatus = (text, kind = "") => { $("aiStatus").textContent = text; $("aiStatus").className = kind; };

  function switchWorkspace(name) {
    document.querySelectorAll("[data-workspace-panel]").forEach(panel => {
      const active = panel.dataset.workspacePanel === name;
      panel.hidden = !active;
      panel.classList.toggle("active", active);
    });
    document.querySelectorAll(".workspace-tab").forEach(button => {
      const active = button.dataset.workspace === name;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    if (name === "photopea" && $("photopeaFrame").src === "about:blank") $("photopeaFrame").src = $("photopeaFrame").dataset.src;
  }

  function setFormat(name) {
    const f = formats[name] || formats.vertical;
    state.format = name;
    stage.style.setProperty("--ratio", f.w / f.h);
    document.querySelectorAll(".format-card").forEach(b => b.classList.toggle("active", b.dataset.format === name));
    $("stageMeta").textContent = `${f.label} · ${f.w} × ${f.h}`;
    $("formatFooter").textContent = `PNG · ${f.w} × ${f.h}`;
    requestAnimationFrame(() => { applyPoster(); applyLogo(); });
  }

  function updateEmpty() {
    $("empty").hidden = !!(state.poster && state.logo);
    setStatus(state.poster && state.logo ? "Слой логотипа активен" : "Готов к работе");
  }

  function clampLogo() {
    if (logo.hidden) return;
    const sr = stage.getBoundingClientRect(), lr = logo.getBoundingClientRect();
    if (!sr.width || !lr.width) return;
    const hw = lr.width / sr.width * 50, hh = lr.height / sr.height * 50;
    state.x = Math.max(hw, Math.min(100 - hw, state.x));
    state.y = Math.max(hh, Math.min(100 - hh, state.y));
  }

  function updateRemoveButton() {
    if (logo.hidden) { removeLogo.classList.remove("visible"); return; }
    const sr = stage.getBoundingClientRect(), lr = logo.getBoundingClientRect();
    removeLogo.style.left = `${lr.right - sr.left - 15}px`;
    removeLogo.style.top = `${lr.top - sr.top - 15}px`;
    removeLogo.classList.add("visible");
  }

  function applyLogo() {
    logo.style.left = state.x + "%";
    logo.style.top = state.y + "%";
    logo.style.transform = `translate(-50%,-50%) scale(${state.scale / 100})`;
    clampLogo();
    logo.style.left = state.x + "%";
    logo.style.top = state.y + "%";
    $("scaleValue").value = state.scale + "%";
    $("scaleValue").textContent = state.scale + "%";
    updateRemoveButton();
    updateEmpty();
  }

  function applyPoster() {
    posterImage.style.left = state.posterX + "%";
    posterImage.style.top = state.posterY + "%";
    posterImage.style.transform = `translate(-50%,-50%) scale(${state.posterScale / 100})`;
    $("posterScaleInput").value = state.posterScale;
    $("posterScaleValue").textContent = state.posterScale + "%";
  }

  function updatePosterLock() {
    state.posterLocked = $("posterLockInput").checked;
    $("posterLockLabel").textContent = state.posterLocked ? "Заблокирован" : "Разблокирован";
    $("posterScaleInput").disabled = state.posterLocked;
    $("posterPositionSelect").disabled = state.posterLocked;
    $("resetPosterBtn").disabled = state.posterLocked;
    $("posterScaleInput").closest("section").classList.toggle("poster-controls-locked", state.posterLocked);
    if (state.posterLocked) { state.drag = state.drag === "poster" ? null : state.drag; posterImage.classList.remove("dragging"); }
  }

  function setLogoPosition(name) { const p = positions[name] || positions.center; state.x = p[0]; state.y = p[1]; applyLogo(); }
  function setPosterPosition(name) { const p = posterPositions[name] || posterPositions.center; state.posterX = p[0]; state.posterY = p[1]; applyPoster(); }

  function readFile(file, target, kind) {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = event => {
      target.src = event.target.result;
      target.hidden = false;
      state[kind] = event.target.result;
      $(kind === "poster" ? "posterFileName" : "logoFileName").textContent = file.name;
      if (kind === "logo") { state.scale = 100; $("scaleInput").value = 100; setLogoPosition("center"); }
      if (kind === "poster") { state.posterScale = 100; state.posterX = 50; state.posterY = 50; applyPoster(); }
      updateEmpty();
    };
    reader.readAsDataURL(file);
  }

  function removeUploadedLogo() {
    state.logo = null;
    state.selectedResult = null;
    logo.src = "";
    logo.hidden = true;
    $("logoFileInput").value = "";
    $("aiLogoInput").value = "";
    $("logoFileName").textContent = "Файл не выбран";
    removeLogo.classList.remove("visible");
    $("moveResultBtn").disabled = true;
    $("downloadResultBtn").disabled = true;
    updateEmpty();
  }

  function downloadBlob(blob, name) { const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = name; a.style.display = "none"; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000); }

  function drawCover(ctx, image, rect, stageRect, canvasWidth, canvasHeight) {
    const targetRatio = rect.width / rect.height, imageRatio = image.width / image.height;
    let sx = 0, sy = 0, sw = image.width, sh = image.height;
    if (imageRatio > targetRatio) { sw = image.height * targetRatio; sx = (image.width - sw) / 2; } else { sh = image.width / targetRatio; sy = (image.height - sh) / 2; }
    const x = (rect.left - stageRect.left) / stageRect.width * canvasWidth;
    const y = (rect.top - stageRect.top) / stageRect.height * canvasHeight;
    const w = rect.width / stageRect.width * canvasWidth;
    const h = rect.height / stageRect.height * canvasHeight;
    ctx.drawImage(image, sx, sy, sw, sh, x, y, w, h);
  }

  function exportPoster() {
    if (!state.poster || !state.logo) { setStatus("Сначала загрузите постер и логотип.", "error"); return; }
    const f = formats[state.format], poster = new Image(), logoImage = new Image();
    poster.onload = () => logoImage.onload = () => {
      const canvas = document.createElement("canvas"); canvas.width = f.w; canvas.height = f.h;
      const ctx = canvas.getContext("2d"), sr = stage.getBoundingClientRect();
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, f.w, f.h); ctx.clip();
      drawCover(ctx, poster, posterImage.getBoundingClientRect(), sr, f.w, f.h); ctx.restore();
      const lr = logo.getBoundingClientRect(), lw = lr.width / sr.width * f.w, lh = lr.height / sr.height * f.h;
      const lx = (lr.left + lr.width / 2 - sr.left) / sr.width * f.w - lw / 2, ly = (lr.top + lr.height / 2 - sr.top) / sr.height * f.h - lh / 2;
      ctx.drawImage(logoImage, lx, ly, lw, lh);
      canvas.toBlob(blob => blob ? downloadBlob(blob, `poster-${state.format}.png`) : setStatus("Не удалось подготовить PNG.", "error"), "image/png");
    };
    poster.src = state.poster; logoImage.src = state.logo;
  }

  function renderResults(items) {
    const root = $("results"); root.innerHTML = "";
    items.forEach((src, i) => { const card = document.createElement("button"); card.className = "result-card" + (i === 0 ? " active" : ""); const img = document.createElement("img"); img.src = src; img.alt = `Вариант ${i + 1}`; card.appendChild(img); card.onclick = () => selectResult(card, src); root.appendChild(card); });
    if (items[0]) selectResult(root.firstElementChild, items[0]);
  }

  function selectResult(card, src) { document.querySelectorAll(".result-card").forEach(x => x.classList.remove("active")); card.classList.add("active"); state.selectedResult = src; $("moveResultBtn").disabled = false; $("downloadResultBtn").disabled = false; }

  function updateAiAvailability() {
    const provider = $("aiProvider").value;
    const ready = !!state.aiProviders[provider];
    $("generateBtn").disabled = !ready;
    if (!ready) setAiStatus(provider === "xai" ? "Ключ xAI не настроен на сервере" : "Ключ OpenAI не настроен на сервере", "error");
    else if (!state.logo) setAiStatus("AI готов · загрузите PNG-логотип", "ok");
    else setAiStatus("AI готов к генерации", "ok");
  }

  async function checkAiServer() {
    if (!aiApiBase) { $("aiServerBadge").textContent = "не настроен"; $("aiServerBadge").className = "error"; setAiStatus("Не указан адрес AI-сервера", "error"); return; }
    try {
      const response = await fetch(`${aiApiBase}/api/status`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      state.aiProviders = { xai: !!data.providers?.xai, openai: !!data.providers?.openai };
      const count = Object.values(state.aiProviders).filter(Boolean).length;
      $("aiServerBadge").textContent = count ? `${count}/2 online` : "ключи не заданы";
      $("aiServerBadge").className = count ? "ok" : "error";
      updateAiAvailability();
    } catch (error) {
      state.aiProviders = { xai: false, openai: false };
      $("aiServerBadge").textContent = "offline";
      $("aiServerBadge").className = "error";
      $("generateBtn").disabled = true;
      setAiStatus("AI-сервер недоступен. Проверьте Cloudflare Worker.", "error");
    }
  }

  async function generate() {
    const source = state.logo;
    const provider = $("aiProvider").value;
    if (!source) { setAiStatus("Сначала загрузите PNG-логотип.", "error"); return; }
    if (!state.aiProviders[provider]) { updateAiAvailability(); return; }
    const button = $("generateBtn"), old = button.textContent; button.disabled = true; button.textContent = "Генерирую..."; setAiStatus("Создаю 3 варианта...");
    const lang = $("aiLanguage").value === "kk" ? "казахский" : "русский";
    const prompt = `${$("aiPrompt").value.trim()} Язык результата: ${lang}. Сохрани прозрачный фон и верни чистый PNG-логотип без мокапа, рамки и дополнительного фона.`;
    try {
      const response = await fetch(`${aiApiBase}/api/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, prompt, image: source, count: 3 }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      if (!Array.isArray(data.images) || !data.images.length) throw new Error("Сервер не вернул изображения.");
      renderResults(data.images); setAiStatus(`Готово · ${data.images.length} варианта`, "ok");
    } catch (error) { setAiStatus("Ошибка: " + (error.message || error), "error"); }
    finally { button.disabled = !state.aiProviders[provider]; button.textContent = old; }
  }

  document.querySelectorAll(".workspace-tab").forEach(button => button.onclick = () => switchWorkspace(button.dataset.workspace));
  $("openPhotopeaBtn").onclick = () => window.open("https://www.photopea.com/", "_blank", "noopener");
  document.querySelectorAll(".format-card").forEach(b => b.onclick = () => setFormat(b.dataset.format));
  $("posterFileInput").onchange = e => readFile(e.target.files?.[0], posterImage, "poster");
  $("logoFileInput").onchange = e => readFile(e.target.files?.[0], logo, "logo");
  $("positionSelect").onchange = e => setLogoPosition(e.target.value);
  $("scaleInput").oninput = e => { state.scale = +e.target.value; applyLogo(); };
  $("centerBtn").onclick = () => setLogoPosition("center");
  $("resetBtn").onclick = () => { state.scale = 100; $("scaleInput").value = 100; $("positionSelect").value = "center"; setLogoPosition("center"); };
  $("posterLockInput").onchange = updatePosterLock;
  $("posterScaleInput").oninput = e => { if (state.posterLocked) return; state.posterScale = +e.target.value; applyPoster(); };
  $("posterPositionSelect").onchange = e => { if (!state.posterLocked) setPosterPosition(e.target.value); };
  $("resetPosterBtn").onclick = () => { if (state.posterLocked) return; state.posterScale = 100; state.posterX = 50; state.posterY = 50; $("posterPositionSelect").value = "center"; applyPoster(); };
  $("removeLogoBtn").onclick = removeUploadedLogo;
  $("downloadBtn").onclick = exportPoster;
  $("generateBtn").onclick = generate;
  $("aiProvider").onchange = updateAiAvailability;
  $("aiLogoInput").onchange = e => { const file = e.target.files?.[0]; if (file) { readFile(file, logo, "logo"); setAiStatus("PNG-логотип загружен", "ok"); } };
  $("moveResultBtn").onclick = () => { if (!state.selectedResult) return; state.logo = state.selectedResult; logo.src = state.selectedResult; logo.hidden = false; $("logoFileName").textContent = "Адаптированный результат"; setLogoPosition("center"); setAiStatus("Вариант перемещён на постер", "ok"); };
  $("downloadResultBtn").onclick = () => { if (!state.selectedResult) return; fetch(state.selectedResult).then(r => r.blob()).then(b => downloadBlob(b, "adapted-logo.png")).catch(() => window.open(state.selectedResult, "_blank", "noopener")); };

  logo.addEventListener("pointerdown", e => { if (logo.hidden || e.button !== 0) return; const r = logo.getBoundingClientRect(); state.drag = "logo"; state.grabX = e.clientX - (r.left + r.width / 2); state.grabY = e.clientY - (r.top + r.height / 2); logo.classList.add("dragging", "selected"); logo.setPointerCapture(e.pointerId); e.preventDefault(); });
  posterImage.addEventListener("pointerdown", e => { if (state.posterLocked || posterImage.hidden || e.button !== 0) return; const r = posterImage.getBoundingClientRect(); state.drag = "poster"; state.grabX = e.clientX - (r.left + r.width / 2); state.grabY = e.clientY - (r.top + r.height / 2); posterImage.classList.add("dragging"); posterImage.setPointerCapture(e.pointerId); e.preventDefault(); });
  stage.addEventListener("pointermove", e => { if (!state.drag) return; const r = stage.getBoundingClientRect(); if (state.drag === "logo") { state.x = (e.clientX - state.grabX - r.left) / r.width * 100; state.y = (e.clientY - state.grabY - r.top) / r.height * 100; applyLogo(); } else { state.posterX = (e.clientX - state.grabX - r.left) / r.width * 100; state.posterY = (e.clientY - state.grabY - r.top) / r.height * 100; applyPoster(); } });
  ["pointerup", "pointercancel"].forEach(type => stage.addEventListener(type, () => { state.drag = null; logo.classList.remove("dragging"); posterImage.classList.remove("dragging"); }));
  logo.addEventListener("wheel", e => { e.preventDefault(); state.scale = Math.max(10, Math.min(300, state.scale + (e.deltaY < 0 ? 5 : -5))); $("scaleInput").value = state.scale; applyLogo(); }, { passive: false });
  posterImage.addEventListener("wheel", e => { if (state.posterLocked) return; e.preventDefault(); state.posterScale = Math.max(100, Math.min(180, state.posterScale + (e.deltaY < 0 ? 5 : -5))); applyPoster(); }, { passive: false });
  window.addEventListener("resize", updateRemoveButton);
  document.addEventListener("keydown", e => { if (e.key.toLowerCase() === "r" && !/input|textarea|select/i.test(e.target.tagName)) setLogoPosition("center"); });

  switchWorkspace("poster"); setFormat("vertical"); updatePosterLock(); updateEmpty(); checkAiServer();
})();
