/* Shared geometry and storage. All coordinates are master-document pixels. */
(() => {
  const cache = new Map();
  const clone = (value) => structuredClone(value);
  const clamp = (n, low, high) => Math.max(low, Math.min(high, Number(n) || 0));
  const canvas = (w, h) =>
    Object.assign(document.createElement("canvas"), { width: w, height: h });
  const image = (src) => {
    if (!cache.has(src))
      cache.set(
        src,
        new Promise((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => resolve(img);
          img.onerror = () => {
            cache.delete(src);
            reject(new Error("Не удалось загрузить изображение"));
          };
          img.src = src;
        }),
      );
    return cache.get(src);
  };
  const dataURL = (blob) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error("Не удалось прочитать файл"));
      r.readAsDataURL(blob);
    });
  const png = (c) =>
    new Promise((resolve, reject) =>
      c.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Не удалось создать PNG"))),
        "image/png",
      ),
    );
  function download(blob, name) {
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  function cover(iw, ih, w, h, scale = 1, rotation = 0, x = w / 2, y = h / 2) {
    const a = (rotation * Math.PI) / 180,
      c = Math.cos(a),
      s = Math.sin(a);
    const vw = Math.abs(c) * w + Math.abs(s) * h,
      vh = Math.abs(s) * w + Math.abs(c) * h;
    const k = Math.max(vw / iw, vh / ih) * Math.max(1, scale),
      rw = iw * k,
      rh = ih * k;
    const dx = x - w / 2,
      dy = y - h / 2;
    const lx = clamp(c * dx + s * dy, -(rw - vw) / 2, (rw - vw) / 2),
      ly = clamp(-s * dx + c * dy, -(rh - vh) / 2, (rh - vh) / 2);
    return {
      x: w / 2 + c * lx - s * ly,
      y: h / 2 + s * lx + c * ly,
      w: rw,
      h: rh,
      rotation,
    };
  }
  function draw(ctx, img, rect, opacity = 1, filter = "none") {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.filter = filter;
    ctx.translate(rect.x, rect.y);
    ctx.rotate(((rect.rotation || 0) * Math.PI) / 180);
    ctx.drawImage(img, -rect.w / 2, -rect.h / 2, rect.w, rect.h);
    ctx.restore();
  }
  async function trimPoster(src) {
    const img = await image(src),
      c = canvas(img.naturalWidth, img.naturalHeight),
      ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const { width: w, height: h } = c,
      p = ctx.getImageData(0, 0, w, h).data;
    // Trim only uniformly transparent/semitransparent outer rows and columns.
    let l = 0,
      r = w - 1,
      t = 0,
      b = h - 1;
    const row = (y) => {
      for (let x = l; x <= r; x++)
        if (p[(y * w + x) * 4 + 3] === 255) return true;
      return false;
    };
    const col = (x) => {
      for (let y = t; y <= b; y++)
        if (p[(y * w + x) * 4 + 3] === 255) return true;
      return false;
    };
    while (t < b && !row(t)) t++;
    while (b > t && !row(b)) b--;
    while (l < r && !col(l)) l++;
    while (r > l && !col(r)) r--;
    if (l === 0 && t === 0 && r === w - 1 && b === h - 1) return src;
    if (r - l < 1 || b - t < 1)
      throw new Error(
        "Постер не содержит непрозрачного изображения. Выберите другой фон.",
      );
    const out = canvas(r - l + 1, b - t + 1);
    out
      .getContext("2d")
      .drawImage(c, l, t, out.width, out.height, 0, 0, out.width, out.height);
    return out.toDataURL("image/png");
  }
  let dbPromise;
  function db() {
    return (dbPromise ||= new Promise((resolve, reject) => {
      const req = indexedDB.open("poster-markup-projects", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("projects");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  }
  async function save(key, value) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction("projects", "readwrite");
      tx.objectStore("projects").put(clone(value), key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }
  async function read(key) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const req = d.transaction("projects").objectStore("projects").get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function autosaver(key, get, status) {
    let timer;
    return () => {
      clearTimeout(timer);
      const value = clone(get());
      timer = setTimeout(
        () =>
          save(key, value)
            .then(() => status?.("Автосохранено"))
            .catch(() =>
              status?.("Автосохранение недоступно. Сохраните проект в файл."),
            ),
        350,
      );
    };
  }
  async function fetchJSON(url, options = {}, timeout = 30000) {
    let response;
    try {
      response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(timeout),
      });
    } catch (e) {
      throw new Error(
        e.name === "TimeoutError"
          ? "Сервис не ответил вовремя. Повторите позже."
          : "Ошибка сети. Проверьте подключение и адрес API.",
      );
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(
        body.message ||
          {
            401: "Ключ API недействителен",
            403: "Доступ к API запрещён",
            404: "API не найден. Настройте сервер, GitHub Pages не исполняет API.",
            429: "Превышен лимит API. Повторите позже.",
            500: "Ошибка сервера",
            504: "Сервис не ответил вовремя",
          }[response.status] ||
          `HTTP ${response.status}`,
      );
    return body;
  }
  function api(path) {
    const base = document
      .querySelector('meta[name="api-base"]')
      ?.content?.replace(/\/$/, "");
    return base ? base + path : new URL("." + path, document.baseURI).href;
  }
  const modules = {};
  let active = "poster",
    lastEditor = "poster";
  const register = (name, adapter) => (modules[name] = adapter);
  function activate(name) {
    active = name;
    if (name !== "photopea") lastEditor = name;
    document.querySelectorAll("[data-workspace]").forEach((t) => {
      t.classList.toggle("active", t.dataset.workspace === name);
      t.setAttribute("aria-selected", String(t.dataset.workspace === name));
    });
    for (const key of ["poster", "photopea", "train", "top10"]) {
      const el = document.getElementById(key + "Workspace");
      if (el) el.hidden = key !== name;
    }
    document.getElementById("posterFooter").hidden = name !== "poster";
    modules[name]?.activate?.();
  }
  function jsonDownload(value, name) {
    download(
      new Blob([JSON.stringify(value)], { type: "application/json" }),
      name,
    );
  }
  function withTimeout(
    promise,
    ms,
    message = "Сервис не ответил вовремя. Повторите позже.",
  ) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]).finally(() => clearTimeout(timer));
  }
  async function removeBackground(src) {
    return withTimeout(
      removeBackgroundLocal(src),
      120000,
      "Локальная модель не ответила за 2 минуты. Проверьте доступ к CDN и попробуйте изображение меньшего размера.",
    );
  }
  async function removeBackgroundLocal(src) {
    const m =
      await import("https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm");
    return dataURL(
      await m.removeBackground(src, {
        publicPath:
          "https://static.img.ly/packages/imgly/background-removal-data/1.7.0/dist/",
      }),
    );
  }
  window.EditorCore = {
    clone,
    clamp,
    canvas,
    image,
    dataURL,
    png,
    download,
    cover,
    draw,
    trimPoster,
    save,
    read,
    autosaver,
    fetchJSON,
    api,
    modules,
    register,
    activate,
    jsonDownload,
    removeBackground,
    withTimeout,
    get active() {
      return active;
    },
    get lastEditor() {
      return lastEditor;
    },
  };
})();
