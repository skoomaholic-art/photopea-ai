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

  // Deleted logos stay hidden even if an open editor still references their pixels.
  // Keep the tombstone in the same IndexedDB database as the archive.
  const deletedId = hash => "asset-logo-archive-deleted-" + hash;
  async function isDeleted(hash) {
    return Boolean(hash && await window.SkoomaStore?.getAsset?.(deletedId(hash)));
  }

  async function localLogoAssets() {
    if (!window.AssetManager?.list) return [];
    return (await AssetManager.list()).filter(item => item?.imageType === "logo" && item.originalAsset);
  }
  async function rawLogoAssets() {
    if (window.ServerLibrary?.listLogos) return ServerLibrary.listLogos();
    return localLogoAssets();
  }

  async function rememberBlob(blob, options = {}) {
    if (!window.AssetManager) throw new Error("Локальное хранилище логотипов недоступно.");
    const png = await toPng(blob);
    const hash = await fingerprint(png);
    // Local tombstones only apply to the legacy browser archive.
    if (!window.ServerLibrary && options.countUse === false && await isDeleted(hash)) return null;
    if (!window.ServerLibrary && options.countUse !== false && await isDeleted(hash)) {
      await window.SkoomaStore.deleteAsset(deletedId(hash));
    }
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

    // A passive autosave already represented in the archive must not write back
    // stale filenames or override an in-flight manual rename.
    if (options.countUse === false && match?.archiveKind === "logo"
      && match.fingerprint === hash && match.mimeType === "image/png") return match;

    if (!match && options.sourceAssetId) {
      const source = await AssetManager.get(options.sourceAssetId);
      if (source?.imageType === "logo") match = source;
    }

    const time = Date.now();
    const payload = {
      ...(match || {}),
      id: match?.id || "asset-logo-archive-" + hash.slice(0, 32),
      source: match?.source || options.source || "logo-archive",
      sourceId: match?.sourceId || options.sourceId || null,
      title: match?.archiveTitleLocked
        ? match.title
        : pngName(options.countUse === false && match?.title ? match.title : options.title || match?.title),
      archiveTitleLocked: Boolean(match?.archiveTitleLocked),
      imageType: "logo",
      mimeType: "image/png",
      originalAsset: png,
      archiveKind: "logo",
      fingerprint: hash,
      lastUsedAt: options.countUse === false ? (match?.lastUsedAt || time) : time,
      useCount: Math.max(0, Number(match?.useCount) || 0) + (options.countUse === false ? 0 : 1),
      createdAt: match?.createdAt || time
    };
    const item = window.ServerLibrary?.saveLogo
      ? await ServerLibrary.saveLogo(payload)
      : await AssetManager.save(payload);
    window.dispatchEvent(new CustomEvent("logo-archive-changed", { detail: { id: item.id, server: Boolean(window.ServerLibrary) } }));
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
      if (window.ServerLibrary?.migrationDone?.("logos")) return;
      const assets = await localLogoAssets();
      for (const item of assets) {
        if (item.archiveKind !== "logo" || !item.originalAsset) continue;
        try {
          const png = await toPng(item.editedAsset || item.originalAsset);
          const hash = item.fingerprint || await fingerprint(png);
          await ServerLibrary.saveLogo({
            ...item,
            id:item.id || "asset-logo-archive-" + hash.slice(0,32),
            title:pngName(item.title),
            imageType:"logo",mimeType:"image/png",archiveKind:"logo",fingerprint:hash,
            originalAsset:png
          });
        } catch(error) { console.warn("Logo server migration failed",error); }
      }
      if(window.ServerLibrary?.markMigrated) ServerLibrary.markMigrated("logos");
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
    const archive = await Promise.all(assets
      .filter(item => item.archiveKind === "logo" && item.mimeType === "image/png")
      .map(async item => await isDeleted(item.fingerprint) ? null : item));
    return archive.filter(Boolean)
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

  async function rename(id, value) {
    const base = String(value ?? "").trim().replace(/\.png$/i, "").trim();
    if (!base || base.length > 100 || /[<>:"|?*\u0000-\u001f]/.test(base) || base.includes("/") || base.includes("\\")) {
      throw new Error("Введите название до 100 символов без запрещённых знаков.");
    }
    const item = (await rawLogoAssets()).find(entry=>entry.id===id);
    if (!item || item.archiveKind !== "logo" || (!window.ServerLibrary && await isDeleted(item.fingerprint))) {
      throw new Error("Логотип не найден в архиве.");
    }
    const updated = window.ServerLibrary?.renameLogo
      ? await ServerLibrary.renameLogo(id, base + ".png")
      : await AssetManager.save({ ...item, title: base + ".png", archiveTitleLocked: true });
    cachedItems = cachedItems.map(entry => entry.id === id ? updated : entry);
    await render();
    setStatus("Логотип переименован.", "ok");
    return updated;
  }

  async function remove(id, confirmDelete = true) {
    const item = (await rawLogoAssets()).find(entry=>entry.id===id);
    if (!item || item.archiveKind !== "logo") throw new Error("Логотип не найден в архиве.");
    if (confirmDelete && !window.confirm("Удалить «" + item.title + "» из архива? Это не удалит логотип из открытых макетов.")) return false;
    if (window.ServerLibrary?.deleteLogo) {
      await ServerLibrary.deleteLogo(id);
    } else {
      if (!window.SkoomaStore?.saveAsset || !window.SkoomaStore?.deleteAsset) throw new Error("Хранилище архива недоступно.");
      const hash = item.fingerprint || await fingerprint(await toPng(item.originalAsset));
      await window.SkoomaStore.saveAsset({id:deletedId(hash),imageType:"logo-deletion-marker",fingerprint:hash,createdAt:Date.now()});
      const assets = await rawLogoAssets();
      for (const entry of assets) if (entry.archiveKind === "logo" && (entry.id === id || entry.fingerprint === hash)) await window.SkoomaStore.deleteAsset(entry.id);
    }
    cachedItems = cachedItems.filter(entry => entry.id !== id && entry.fingerprint !== hash);
    window.dispatchEvent(new CustomEvent("logo-archive-changed", { detail: { id, deleted: true } }));
    await render();
    setStatus("Логотип удалён из архива.", "ok");
    return true;
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
      const renameButton = document.createElement("button");
      renameButton.type = "button";
      renameButton.className = "logo-archive-rename-button";
      renameButton.textContent = "Переименовать";
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "logo-archive-delete-button";
      deleteButton.textContent = "Удалить";
      deleteButton.addEventListener("click", async () => {
        deleteButton.disabled = true;
        try { await remove(item.id); }
        catch (error) { setStatus(error.message || "Не удалось удалить логотип.", "error"); }
        finally { deleteButton.disabled = false; }
      });
      const edit = document.createElement("form");
      edit.className = "logo-archive-edit";
      edit.hidden = true;
      const input = document.createElement("input");
      input.type = "text";
      input.maxLength = 100;
      input.required = true;
      input.setAttribute("aria-label", "Новое название PNG-логотипа");
      input.value = String(item.title || "").replace(/\.png$/i, "");
      const saveButton = document.createElement("button");
      saveButton.type = "submit";
      saveButton.textContent = "Сохранить";
      const cancelButton = document.createElement("button");
      cancelButton.type = "button";
      cancelButton.textContent = "Отмена";
      function cancelEdit() {
        edit.hidden = true;
        title.hidden = false;
        renameButton.hidden = false;
      }
      renameButton.addEventListener("click", () => {
        edit.hidden = false;
        title.hidden = true;
        renameButton.hidden = true;
        input.focus();
        input.select();
      });
      cancelButton.addEventListener("click", cancelEdit);
      input.addEventListener("keydown", event => { if (event.key === "Escape") cancelEdit(); });
      edit.addEventListener("submit", async event => {
        event.preventDefault();
        saveButton.disabled = true;
        try { await rename(item.id, input.value); }
        catch (error) { setStatus(error.message || "Не удалось переименовать логотип.", "error"); }
        finally { saveButton.disabled = false; }
      });
      edit.append(input, saveButton, cancelButton);
      actions.append(useButton, downloadButton, renameButton, deleteButton);
      body.append(title, edit, meta, actions);
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
    rename,
    remove,
    captureCurrentEditorLogos,
    toPng
  };
})();
