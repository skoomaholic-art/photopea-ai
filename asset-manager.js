(() => {
  const now = () => Date.now();
  const uid = () => globalThis.crypto?.randomUUID?.() || ("asset-" + now() + "-" + Math.random().toString(36).slice(2));
  const slug = value => String(value || "local").toLowerCase().replace(/[^a-z0-9а-яёқғүұіәөһ_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80);

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error("Не удалось прочитать asset."));
      reader.readAsDataURL(blob);
    });
  }

  async function dataUrlToBlob(dataUrl) {
    const response = await fetch(dataUrl);
    if (!response.ok) throw new Error("Не удалось преобразовать изображение.");
    return response.blob();
  }

  async function fetchImageBlob(url) {
    const response = await fetch(url, { cache: "force-cache" });
    if (!response.ok) {
      let message = "Оригинал изображения недоступен.";
      try {
        const data = await response.json();
        if (data?.error) message = data.error;
      } catch {}
      throw new Error(message);
    }
    const type = response.headers.get("content-type") || "";
    if (!type.startsWith("image/")) throw new Error("Источник вернул не изображение.");
    return response.blob();
  }

  function normalize(meta = {}) {
    const width = Number(meta.width) || null;
    const height = Number(meta.height) || null;
    return {
      id: meta.id || uid(),
      source: meta.source || "local",
      sourceId: meta.sourceId || null,
      sourceUrl: meta.sourceUrl || null,
      originalUrl: meta.originalUrl || null,
      proxyUrl: meta.proxyUrl || null,
      thumbnailUrl: meta.thumbnailUrl || null,
      title: meta.title || "",
      year: meta.year || "",
      mediaType: meta.mediaType || null,
      imageType: meta.imageType || "image",
      width,
      height,
      aspectRatio: meta.aspectRatio || (width && height ? width / height : null),
      language: meta.language ?? null,
      isTextless: meta.isTextless ?? null,
      mimeType: meta.mimeType || null,
      originalAsset: meta.originalAsset || null,
      editedAsset: meta.editedAsset || null,
      filters: meta.filters || null,
      license: meta.license || null,
      attribution: meta.attribution || null,
      createdAt: meta.createdAt || now(),
      updatedAt: now()
    };
  }

  async function save(asset) {
    const item = normalize(asset);
    await window.SkoomaStore?.saveAsset(item);
    return item;
  }

  async function get(id) {
    return id ? (await window.SkoomaStore?.getAsset?.(id)) || null : null;
  }

  async function fromFile(file, meta = {}) {
    if (!file?.type?.startsWith("image/")) throw new Error("Выберите JPG, PNG или WebP.");
    const item = normalize({
      ...meta,
      source: meta.source || "local",
      sourceId: meta.sourceId || file.name,
      title: meta.title || file.name,
      mimeType: file.type,
      originalAsset: file,
      id: meta.id || "asset-local-" + uid()
    });
    return save(item);
  }

  async function fromDataUrl(dataUrl, meta = {}) {
    const blob = await dataUrlToBlob(dataUrl);
    return save(normalize({
      ...meta,
      mimeType: meta.mimeType || blob.type || "image/png",
      originalAsset: blob
    }));
  }

  async function fromBlob(blob, meta = {}) {
    return save(normalize({
      ...meta,
      mimeType: meta.mimeType || blob.type || "image/png",
      originalAsset: blob
    }));
  }

  async function importRemote(meta) {
    if (!meta?.proxyUrl) throw new Error("У источника нет доступного оригинала.");
    const stableId = meta.sourceId
      ? "asset-remote-" + slug(meta.source) + "-" + slug(meta.sourceId)
      : "asset-remote-" + uid();
    const existing = await get(stableId);
    if (existing?.originalAsset) return existing;

    const blob = await fetchImageBlob(meta.proxyUrl);
    return save(normalize({
      ...meta,
      id: stableId,
      mimeType: meta.mimeType || blob.type,
      originalAsset: blob
    }));
  }

  async function dataUrl(assetOrId, preferEdited = true) {
    const asset = typeof assetOrId === "string" ? await get(assetOrId) : assetOrId;
    if (!asset) throw new Error("Asset не найден.");
    const blob = preferEdited && asset.editedAsset ? asset.editedAsset : asset.originalAsset;
    if (!blob) {
      if (asset.proxyUrl) return blobToDataUrl(await fetchImageBlob(asset.proxyUrl));
      throw new Error("В asset отсутствует изображение.");
    }
    return blobToDataUrl(blob);
  }

  async function updateEdited(id, blobOrDataUrl, filters = null, extra = {}) {
    const asset = await get(id);
    if (!asset) throw new Error("Asset не найден.");
    const blob = typeof blobOrDataUrl === "string" ? await dataUrlToBlob(blobOrDataUrl) : blobOrDataUrl;
    const next = {
      ...asset,
      ...extra,
      editedAsset: blob,
      filters,
      mimeType: blob?.type || asset.mimeType,
      updatedAt: now()
    };
    await window.SkoomaStore?.saveAsset(next);
    return next;
  }

  async function resetEdited(id) {
    const asset = await get(id);
    if (!asset) return null;
    const next = { ...asset, editedAsset: null, filters: null, updatedAt: now() };
    await window.SkoomaStore?.saveAsset(next);
    return next;
  }

  async function ensureContextAsset(context) {
    if (context?.assetId) {
      const existing = await get(context.assetId);
      if (existing) return existing;
    }
    if (!context?.src) throw new Error("Изображение не выбрано.");
    return fromDataUrl(context.src, {
      source: "editor",
      sourceId: context.name || uid(),
      title: context.name || "Poster Editor asset",
      imageType: context.layer === "logo" ? "logo" : "poster"
    });
  }

  window.AssetManager = {
    normalize,
    save,
    get,
    fromFile,
    fromDataUrl,
    fromBlob,
    importRemote,
    dataUrl,
    updateEdited,
    resetEdited,
    ensureContextAsset,
    blobToDataUrl,
    dataUrlToBlob,
    fetchImageBlob,
    list: () => window.SkoomaStore?.listAssets?.() || Promise.resolve([])
  };
})();
