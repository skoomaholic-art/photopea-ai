(() => {
  const $ = id => document.getElementById(id);
  const TARGET_LABELS = {
    poster: "Poster Markup",
    train: "Паровозик",
    top10: "ТОП10"
  };
  let activeTarget = "poster";
  let cachedItems = [];
  let migrationPromise = null;

  function setStatus(message, kind = "") {
    const node = $("logoArchiveStatus");
    if (!node) return;
    node.textContent = message;
    node.className = "mini-status " + kind;
  }

  function notify(message, kind = "") {
    const toast = $("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.className = "toast " + kind;
    toast.hidden = false;
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => { toast.hidden = true; }, 3600);
  }

  function pngName(value) {
    const base = String(value || "Логотип").trim().replace(/\.(?:png|jpe?g|webp|svg|gif|avif)$/i, "") || "Логотип";
    return base + ".png";
  }

  async function isPng(blob) {
    if (String(blob?.type || "").toLowerCase() === "image/png") return true;
    if (!blob?.slice) return false;
    const bytes = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
    return bytes.length === 8 && bytes.every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index]);
  }

  async function imageFromBlob(blob) {
    if (typeof createImageBitmap === "function") {
      try { return await createImageBitmap(blob); } catch {}
    }
    const url = URL.createObjectURL(blob);
    try {
      return await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Не удалось прочитать изображение логотипа."));
        image.src = url;
      });
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  }

  async function toPng(blob) {
    if (!blob?.arrayBuffer) throw new Error("Файл логотипа повреждён.");
    if (await isPng(blob)) return new Blob([await blob.arrayBuffer()], { type: "image/png" });
    if (!String(blob.type || "").startsWith("image/")) throw new Error("Архив принимает только изображения логотипов.");
    const image = await imageFromBlob(blob);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) throw new Error("Не удалось определить размер логотипа.");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true });
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    image.close?.();
    return new Promise((resolve, reject) => canvas.toBlob(
      result => result ? resolve(result) : reject(new Error("Не удалось создать PNG-копию логотипа.")),
      "image/png"
    ));
  }

  async function fingerprint(blob) {
    const bytes = await blob.arrayBuffer();
    if (globalThis.crypto?.subtle?.digest) {
      const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
      return [...digest].map(value => value.toString(16).padStart(2, "0")).join("");
    }
    let hash = 2166136261;
    for (const value of new Uint8Array(bytes)) hash = Math.imul(hash ^ value, 16777619);
    return "fallback-" + (hash >>> 0).toString(16).padStart(8, "0") + "-" + bytes.byteLength;
  }

  async function rawLogoAssets() {
    if (!window.AssetManager?.list) return [];
    return (await AssetManager.list()).filter(item => item?.imageType === "logo" && item.originalAsset);
  }

  async function rememberBlob(blob, options = {}) {
    if (!window.AssetManager) throw new Error("Локальное хранилище логотипов недоступно.");
    const png = await toPng(blob);
    const hash = await fingerprint(png);
    const assets = await rawLogoAssets();
    let match = assets.find(item => item.archiveKind === "logo" && item.fingerprint === hash) || null;

    if (!match) {
      for (const item of assets) {
        if (item.archiveKind !== "logo" || item.fingerprint || !item.originalAsset) continue;
        try {
          if (await fingerprint(await toPng(item.originalAsset)) === hash) { match = item; break; }
        } catch {}
      }
    }

    if (!match && options.sourceAssetId) {
      const source = await AssetManager.get(options.sourceAssetId);
      if (source?.imageType === "logo") match = source;
    }

    const time = Date.now();
    const item = await AssetManager.save({
      ...(match || {}),
      id: match?.id || "asset-logo-archive-" + hash.slice(0, 32),
      source: match?.source || options.source || "logo-archive",
      sourceId: match?.sourceId || options.sourceId || null,
      title: pngName(options.countUse === false && match?.title ? match.title : options.title || match?.title),
      imageType: "logo",
      mimeType: "image/png",
      originalAsset: png,
      archiveKind: "logo",
      fingerprint: hash,
      lastUsedAt: options.countUse === false ? (match?.lastUsedAt || time) : time,
      useCount: Math.max(0, Number(match?.useCount) || 0) + (options.countUse === false ? 0 : 1),
      createdAt: match?.createdAt || time
    });
    window.dispatchEvent(new CustomEvent("logo-archive-changed", { detail: { id: item.id } }));
    return item;
  }

  async function rememberDataUrl(dataUrl, options = {}) {
    if (!window.AssetManager?.dataUrlToBlob) throw new Error("Локальное хранилище логотипов недоступно.");
    return rememberBlob(await AssetManager.dataUrlToBlob(dataUrl), options);
  }

  async function rememberFile(file, options = {}) {
    return rememberBlob(file, { ...options, title: options.title || file?.name });
  }

  async function migrateExisting() {
    if (migrationPromise) return migrationPromise;
    migrationPromise = (async () => {
      const assets = await rawLogoAssets();
      for (const item of assets) {
        if (item.archiveKind === "logo" && item.fingerprint && item.mimeType === "image/png") continue;
        try {
          await rememberBlob(item.editedAsset || item.originalAsset, {
            sourceAssetId: item.id,
            title: item.title,
            source: item.source,
            sourceId: item.sourceId,
            countUse: false
          });
        } catch {}
      }
    })();
    return migrationPromise;
  }

  async function captureCurrentEditorLogos() {
    const current = [];
    try {
      const posters = window.PosterApp?.getState?.() || {};
      for (const [format, state] of Object.entries(posters)) {
        if (state?.logo) current.push({ src: state.logo, title: state.logoName, assetId: state.logoAssetId, source: "poster-" + format });
      }
    } catch {}
    try {
      const state = window.Top10Editor?.getState?.();
      if (state?.logo) current.push({ src: state.logo, title: state.logoName, assetId: state.logoAssetId, source: "top10" });
    } catch {}
    try {
      const objects = window.TrainEditor?.serialize?.()?.canvas?.objects || [];
      for (const object of objects) {
        if (object?.kind === "logo" && object.src) current.push({ src: object.src, title: object.name, assetId: object.archiveAssetId, source: "train" });
      }
    } catch {}
    for (const item of current) {
      try {
        await rememberDataUrl(item.src, {
          title: item.title,
          source: item.source,
          sourceAssetId: item.assetId || null,
          countUse: false
        });
      } catch {}
    }
  }

  async function list() {
    await migrateExisting();
    await captureCurrentEditorLogos();
    const assets = await rawLogoAssets();
    return assets
      .filter(item => item.archiveKind === "logo" && item.mimeType === "image/png")
      .sort((a, b) => (b.lastUsedAt || b.updatedAt || b.createdAt || 0) - (a.lastUsedAt || a.updatedAt || a.createdAt || 0));
  }

  function formatDate(value) {
    if (!value) return "";
    try { return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
    catch { return ""; }
  }

  async function download(item) {
    const blob = item.originalAsset;
    if (!blob) throw new Error("PNG-файл в архиве недоступен.");
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = pngName(item.title);
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function use(item) {
    const src = await AssetManager.blobToDataUrl(item.originalAsset);
    const title = pngName(item.title);
    setStatus("Добавляю логотип в «" + TARGET_LABELS[activeTarget] + "»...");
    if (activeTarget === "poster") {
      await PosterApp.setImageLayer("logo", src, title, { assetId: item.id });
    } else if (activeTarget === "top10") {
      await Top10Editor.setLogoFromDataUrl(src, title, { assetId: item.id });
    } else if (activeTarget === "train") {
      await TrainEditor.addImageFromFile(new File([item.originalAsset], title, { type: "image/png" }), "logo", { assetId: item.id });
    } else {
      throw new Error("Неизвестное рабочее пространство.");
    }
    close();
    notify("Логотип добавлен из архива.", "ok");
  }

  async function render() {
    const listNode = $("logoArchiveList");
    if (!listNode) return;
    const query = String($("logoArchiveSearch")?.value || "").trim().toLowerCase();
    const visible = cachedItems.filter(item => !query || String(item.title || "").toLowerCase().includes(query));
    listNode.replaceChildren();
    $("logoArchiveCount").textContent = cachedItems.length + " PNG";

    if (!visible.length) {
      const empty = document.createElement("div");
      empty.className = "logo-archive-empty";
      empty.textContent = cachedItems.length ? "По этому запросу ничего не найдено." : "Архив пока пуст. Загрузите или используйте первый логотип.";
      listNode.append(empty);
      return;
    }

    for (const item of visible) {
      const card = document.createElement("article");
      card.className = "logo-archive-item";
      const preview = document.createElement("div");
      preview.className = "logo-archive-preview";
      const image = document.createElement("img");
      image.alt = item.title || "Логотип";
      image.src = await AssetManager.blobToDataUrl(item.originalAsset);
      preview.append(image);
      const body = document.createElement("div");
      body.className = "logo-archive-item-body";
      const title = document.createElement("strong");
      title.textContent = item.title || "Логотип.png";
      title.title = title.textContent;
      const meta = document.createElement("small");
      const used = Number(item.useCount) || 0;
      meta.textContent = "PNG" + (used ? " · использован: " + used : "") + (item.lastUsedAt ? " · " + formatDate(item.lastUsedAt) : "");
      const actions = document.createElement("div");
      actions.className = "logo-archive-actions";
      const useButton = document.createElement("button");
      useButton.type = "button";
      useButton.className = "primary";
      useButton.textContent = "Использовать";
      useButton.addEventListener("click", async () => {
        useButton.disabled = true;
        try { await use(item); }
        catch (error) { setStatus(error.message || "Не удалось добавить логотип.", "error"); useButton.disabled = false; }
      });
      const downloadButton = document.createElement("button");
      downloadButton.type = "button";
      downloadButton.textContent = "Скачать PNG";
      downloadButton.addEventListener("click", () => download(item).catch(error => setStatus(error.message, "error")));
      actions.append(useButton, downloadButton);
      body.append(title, meta, actions);
      card.append(preview, body);
      listNode.append(card);
    }
  }

  async function open(target = "poster") {
    activeTarget = TARGET_LABELS[target] ? target : "poster";
    const modal = $("logoArchiveModal");
    modal.hidden = false;
    document.body.classList.add("modal-open");
    $("logoArchiveSearch").value = "";
    $("logoArchiveTitle").textContent = "Архив логотипов · " + TARGET_LABELS[activeTarget];
    setStatus("Загрузка архива...");
    try {
      cachedItems = await list();
      setStatus(cachedItems.length ? "Выберите PNG-логотип." : "Архив пока пуст.", cachedItems.length ? "ok" : "");
      await render();
    } catch (error) {
      cachedItems = [];
      await render();
      setStatus(error.message || "Не удалось открыть архив логотипов.", "error");
    }
  }

  function close() {
    $("logoArchiveModal").hidden = true;
    document.body.classList.remove("modal-open");
  }

  document.querySelectorAll("[data-logo-archive-target]").forEach(button => {
    button.addEventListener("click", () => open(button.dataset.logoArchiveTarget));
  });
  $("logoArchiveCloseBtn")?.addEventListener("click", close);
  $("logoArchiveModal")?.addEventListener("click", event => { if (event.target === $("logoArchiveModal")) close(); });
  $("logoArchiveSearch")?.addEventListener("input", () => { void render(); });
  window.LogoArchive = {
    open,
    close,
    list,
    rememberBlob,
    rememberDataUrl,
    rememberFile,
    captureCurrentEditorLogos,
    toPng
  };
})();
