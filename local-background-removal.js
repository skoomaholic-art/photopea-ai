(() => {
  const MODULE_URL = "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm";
  let modulePromise = null;

  function loadModule() {
    if (!modulePromise) {
      modulePromise = import(MODULE_URL).catch(error => {
        modulePromise = null;
        throw new Error("Не удалось загрузить локальную модель удаления фона: " + (error?.message || error));
      });
    }
    return modulePromise;
  }

  async function remove(dataUrl, onProgress = () => {}) {
    if (!dataUrl?.startsWith?.("data:image/")) throw new Error("Для локального удаления фона требуется изображение.");
    onProgress("Загрузка локальной модели...", 0);
    const [mod, input] = await Promise.all([
      loadModule(),
      window.AssetManager.dataUrlToBlob(dataUrl)
    ]);
    const fn = mod.removeBackground || mod.default;
    if (typeof fn !== "function") throw new Error("Локальный модуль удаления фона несовместим.");
    const result = await fn(input, {
      model: "small",
      output: { format: "image/png", quality: 1 },
      progress: (key, current, total) => {
        const ratio = total ? Math.max(0, Math.min(1, current / total)) : 0;
        const stage = String(key || "").replace("fetch:", "").replace("compute:", "");
        onProgress("Локально: " + stage + " " + Math.round(ratio * 100) + "%", ratio);
      }
    });
    if (!(result instanceof Blob) || !result.type.startsWith("image/")) throw new Error("Локальная модель не вернула PNG.");
    onProgress("Локально: готово", 1);
    return result;
  }

  window.LocalBackgroundRemoval = {
    remove,
    preload: async onProgress => {
      const mod = await loadModule();
      if (typeof mod.preload === "function") {
        await mod.preload({
          model: "small",
          output: { format: "image/png", quality: 1 },
          progress: (key, current, total) => onProgress?.(key, current, total)
        });
      }
    },
    isAvailable: () => !!(globalThis.WebAssembly && globalThis.fetch && globalThis.Blob)
  };
})();