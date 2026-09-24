(() => {
  "use strict";
  const C = window.EditorCore,
    $ = (id) => document.getElementById(id),
    W = 800,
    H = 1400;
  const names = [
    "Canvas Background",
    "Background Image",
    "Bottom Darkening",
    "Logo",
    "TOP10 Number",
  ];
  function defaults() {
    return {
      type: "poster-markup-top10",
      version: 1,
      width: W,
      height: H,
      number: 2,
      numberColor: "#ffffff",
      canvasColor: "#101d16",
      darkColor: "#000000",
      intensity: 90,
      start: 57,
      brightness: 100,
      contrast: 100,
      saturation: 100,
      selected: 4,
      layers: names.map((name, i) => ({
        name,
        x: 400,
        y: i === 4 ? 1170 : i === 3 ? 990 : 700,
        scale: 100,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: i === 0 || i === 2 || i === 4,
        src: null,
        fileName: "",
      })),
    };
  }
  let state = defaults(),
    ready = false,
    drag = null;
  const images = new Map(),
    canvas = $("topCanvas");
  const status = (s, error = false) => {
    $("topStatus").textContent = s;
    $("topStatus").className = "inline-status" + (error ? " error" : "");
  };
  const persist = C.autosaver("top10-v1", () => state, status);
  const save = () => {
    if (ready) persist();
  };
  function rect(layer, index) {
    if (index === 1 && images.has(layer.src)) {
      const im = images.get(layer.src);
      return C.cover(
        im.naturalWidth,
        im.naturalHeight,
        W,
        H,
        Math.max(1, layer.scale / 100),
        layer.rotation,
        layer.x,
        layer.y,
      );
    }
    let w = W,
      h = H;
    if (index === 3) {
      const im = images.get(layer.src);
      if (im) {
        const k = Math.min(650 / im.naturalWidth, 280 / im.naturalHeight);
        w = im.naturalWidth * k;
        h = im.naturalHeight * k;
      }
    }
    if (index === 4) {
      w = state.number === 10 ? 500 : 330;
      h = 400;
    }
    return {
      x: layer.x,
      y: layer.y,
      w: (w * layer.scale) / 100,
      h: (h * layer.scale) / 100,
      rotation: layer.rotation,
    };
  }
  function sourceLayer(i) {
    if (i === 2)
      return {
        source: {
          src: darkeningCanvas().toDataURL(),
          rect: rect(state.layers[2], 2),
        },
      };
    const l = state.layers[i],
      im = images.get(l.src);
    if (!im) return {};
    const c = C.canvas(im.naturalWidth, im.naturalHeight),
      x = c.getContext("2d");
    if (i === 1)
      x.filter = `brightness(${state.brightness}%) contrast(${state.contrast}%) saturate(${state.saturation}%)`;
    x.drawImage(im, 0, 0);
    return { source: { src: c.toDataURL(), rect: rect(l, i) } };
  }
  function darkeningCanvas() {
    const g = C.canvas(W, H),
      gc = g.getContext("2d"),
      start = Math.min(H - 1, (H * state.start) / 100),
      grad = gc.createLinearGradient(0, start, 0, H);
    grad.addColorStop(0, state.darkColor + "00");
    grad.addColorStop(
      1,
      state.darkColor +
        Math.round((state.intensity / 100) * 255)
          .toString(16)
          .padStart(2, "0"),
    );
    gc.fillStyle = grad;
    gc.fillRect(0, 0, W, H);
    return g;
  }
  function layerCanvas(index) {
    const l = state.layers[index],
      out = C.canvas(W, H),
      ctx = out.getContext("2d"),
      r = rect(l, index);
    if (l.src && images.has(l.src)) {
      C.draw(
        ctx,
        images.get(l.src),
        r,
        1,
        index === 1
          ? `brightness(${state.brightness}%) contrast(${state.contrast}%) saturate(${state.saturation}%)`
          : "none",
      );
      return out;
    }
    if (index === 0) {
      ctx.fillStyle = state.canvasColor;
      ctx.fillRect(0, 0, W, H);
    }
    if (index === 2) C.draw(ctx, darkeningCanvas(), r);
    if (index === 4) {
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.rotate((l.rotation * Math.PI) / 180);
      ctx.font = `900 ${(360 * l.scale) / 100}px Arial, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = state.numberColor;
      ctx.fillText(String(state.number), 0, (125 * l.scale) / 100);
      ctx.restore();
    }
    return out;
  }
  function render(target = canvas) {
    const ctx = target.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    state.layers.forEach((l, i) => {
      if (l.visible) {
        ctx.globalAlpha = l.opacity;
        ctx.drawImage(layerCanvas(i), 0, 0);
      }
    });
    ctx.globalAlpha = 1;
  }
  function ui() {
    $("topNumberSelect").value = String(state.number);
    $("topNumberColor").value = state.numberColor;
    $("topCanvasColor").value = state.canvasColor;
    for (const [id, key] of [
      ["topDarkColor", "darkColor"],
      ["topDarkIntensity", "intensity"],
      ["topDarkStart", "start"],
      ["topBrightness", "brightness"],
      ["topContrast", "contrast"],
      ["topSaturation", "saturation"],
    ])
      $(id).value = state[key];
    $("topBackgroundName").textContent =
      state.layers[1].fileName || "Файл не выбран";
    $("topLogoName").textContent = state.layers[3].fileName || "Файл не выбран";
    const list = $("topLayerList");
    list.replaceChildren();
    [4, 3, 2, 1, 0].forEach((index) => {
      const l = state.layers[index],
        b = document.createElement("button");
      b.type = "button";
      b.className =
        "train-layer-item" + (state.selected === index ? " active" : "");
      b.textContent = (l.locked ? "🔒 " : "") + l.name;
      b.addEventListener("click", () => {
        state.selected = index;
        ui();
      });
      list.append(b);
    });
    const l = state.layers[state.selected];
    $("topSelectedName").textContent = l.name;
    $("topLayerLock").checked = l.locked;
    $("topLayerLockLabel").textContent = l.locked ? "Заблокирован" : "Открыт";
    for (const [id, key] of [
      ["topLayerX", "x"],
      ["topLayerY", "y"],
      ["topLayerScale", "scale"],
      ["topLayerRotation", "rotation"],
    ]) {
      $(id).value = l[key];
      $(id).disabled = l.locked;
    }
    $("topLayerOpacity").value = l.opacity * 100;
    $("topLayerVisible").checked = l.visible;
    $("topLayerOpacity").disabled = false;
    $("topLayerVisible").disabled = state.selected === 2;
    $("topCenterBtn").disabled = $("topResetBtn").disabled = l.locked;
    $("topRemoveBgBtn").disabled =
      ![1, 3].includes(state.selected) || !l.src || l.locked;
  }
  const changed = () => {
    render();
    ui();
    save();
  };
  async function load(src, index, fileName) {
    await C.image(src).then((im) => images.set(src, im));
    const l = state.layers[index];
    Object.assign(l, {
      src,
      fileName,
      x: 400,
      y: index === 1 ? 700 : 990,
      scale: 100,
      rotation: 0,
      visible: true,
      opacity: 1,
    });
    state.selected = index;
    changed();
  }
  async function restore(data) {
    if (
      data.type !== "poster-markup-top10" ||
      data.width !== W ||
      data.height !== H ||
      data.layers?.length !== 5
    )
      throw new Error("Нужен проект ТОП10 800 × 1400 с пятью слоями");
    const next = { ...defaults(), ...C.clone(data) };
    next.selected = Math.trunc(C.clamp(next.selected, 0, 4));
    next.number = Math.trunc(C.clamp(next.number, 1, 10));
    for (const key of ["intensity", "start"])
      next[key] = C.clamp(next[key], 0, 100);
    for (const key of ["brightness", "contrast", "saturation"])
      next[key] = C.clamp(next[key], 0, 200);
    for (const key of ["numberColor", "canvasColor", "darkColor"])
      if (!/^#[a-f\d]{6}$/i.test(next[key]))
        throw new Error("Некорректный цвет в проекте ТОП10");
    for (let i = 0; i < 5; i++) {
      const l = next.layers[i];
      l.name = names[i];
      if (
        ![l.x, l.y, l.scale, l.rotation, l.opacity].every(Number.isFinite) ||
        l.scale <= 0 ||
        l.opacity < 0 ||
        l.opacity > 1
      )
        throw new Error("Некорректные параметры слоя");
      if (l.src) images.set(l.src, await C.image(l.src));
    }
    next.layers[2].visible = true;
    state = next;
    changed();
  }
  for (const [id, index] of [
    ["topBackgroundInput", 1],
    ["topLogoInput", 3],
  ])
    $(id).addEventListener("change", async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      status("Загружаю изображение...");
      try {
        let src = await C.dataURL(f);
        if (index === 1) src = await C.trimPoster(src);
        await load(src, index, f.name);
        status("Изображение загружено");
      } catch (e) {
        status(e.message, true);
      }
    });
  for (const [id, key] of [
    ["topNumberSelect", "number"],
    ["topNumberColor", "numberColor"],
    ["topDarkColor", "darkColor"],
    ["topDarkIntensity", "intensity"],
    ["topDarkStart", "start"],
    ["topCanvasColor", "canvasColor"],
    ["topBrightness", "brightness"],
    ["topContrast", "contrast"],
    ["topSaturation", "saturation"],
  ])
    $(id).addEventListener("input", (e) => {
      state[key] =
        e.target.type === "color" ? e.target.value : Number(e.target.value);
      if (key === "number") state.layers[4].src = null;
      changed();
    });
  $("topLayerLock").addEventListener("change", (e) => {
    state.layers[state.selected].locked = e.target.checked;
    drag = null;
    changed();
  });
  for (const [id, key] of [
    ["topLayerX", "x"],
    ["topLayerY", "y"],
    ["topLayerScale", "scale"],
    ["topLayerRotation", "rotation"],
  ])
    $(id).addEventListener("input", (e) => {
      const l = state.layers[state.selected];
      if (l.locked) return;
      l[key] = Number(e.target.value);
      changed();
    });
  $("topLayerOpacity").addEventListener("input", (e) => {
    state.layers[state.selected].opacity = Number(e.target.value) / 100;
    changed();
  });
  $("topLayerVisible").addEventListener("change", (e) => {
    if (state.selected !== 2)
      state.layers[state.selected].visible = e.target.checked;
    changed();
  });
  $("topCenterBtn").addEventListener("click", () => {
    const l = state.layers[state.selected];
    if (l.locked) return;
    l.x = 400;
    l.y = 700;
    changed();
  });
  $("topResetBtn").addEventListener("click", () => {
    const i = state.selected,
      l = state.layers[i];
    if (l.locked) return;
    Object.assign(l, {
      x: 400,
      y: defaults().layers[i].y,
      scale: 100,
      rotation: 0,
    });
    changed();
  });
  const point = (e) => {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * W) / r.width,
      y: ((e.clientY - r.top) * H) / r.height,
    };
  };
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button && e.pointerType === "mouse") return;
    const p = point(e);
    let index = -1;
    for (let i = 4; i >= 0; i--) {
      const l = state.layers[i];
      if (l.locked || !l.visible || ([1, 3].includes(i) && !l.src)) continue;
      const r = rect(l, i),
        a = (-r.rotation * Math.PI) / 180,
        dx = p.x - r.x,
        dy = p.y - r.y;
      if (
        Math.abs(dx * Math.cos(a) - dy * Math.sin(a)) <= r.w / 2 &&
        Math.abs(dx * Math.sin(a) + dy * Math.cos(a)) <= r.h / 2
      ) {
        index = i;
        break;
      }
    }
    if (index < 0) return;
    state.selected = index;
    const l = state.layers[index];
    drag = { x: p.x, y: p.y, lx: l.x, ly: l.y, index };
    canvas.setPointerCapture(e.pointerId);
    ui();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const l = state.layers[drag.index];
    if (l.locked) return;
    const p = point(e);
    l.x = drag.lx + p.x - drag.x;
    l.y = drag.ly + p.y - drag.y;
    render();
    ui();
  });
  for (const ev of ["pointerup", "pointercancel", "lostpointercapture"])
    canvas.addEventListener(ev, () => {
      if (drag) {
        drag = null;
        save();
      }
    });
  canvas.addEventListener(
    "wheel",
    (e) => {
      const l = state.layers[state.selected];
      if (l.locked) return;
      e.preventDefault();
      l.scale = C.clamp(l.scale + (e.deltaY < 0 ? 5 : -5), 10, 300);
      changed();
    },
    { passive: false },
  );
  $("topRemoveBgBtn").addEventListener("click", async () => {
    const l = state.layers[state.selected];
    if (l.locked || !l.src) return;
    const original = l.src;
    $("topRemoveBgBtn").disabled = true;
    status("Удаляю фон локально...");
    try {
      const src = await C.removeBackground(original);
      images.set(src, await C.image(src));
      if (l.src !== original)
        throw new Error("Исходник изменён во время удаления фона");
      l.src = src;
      changed();
      status("Фон удалён. Положение и поворот сохранены.");
    } catch (e) {
      status(e.message, true);
    } finally {
      ui();
    }
  });
  $("topSaveBtn").addEventListener("click", () =>
    C.jsonDownload(state, "TOP10-project.json"),
  );
  $("topOpenInput").addEventListener("change", async (e) => {
    try {
      await restore(JSON.parse(await e.target.files[0].text()));
      status("Проект открыт");
    } catch (e) {
      status(e.message, true);
    }
  });
  $("topExportBtn").addEventListener("click", async () => {
    const b = $("topExportBtn");
    b.disabled = true;
    try {
      const out = C.canvas(W, H);
      render(out);
      C.download(await C.png(out), "top10-800x1400.png");
      status("PNG 800 × 1400 подготовлен");
    } catch (e) {
      status(e.message, true);
    } finally {
      b.disabled = false;
    }
  });
  C.register("top10", {
    savedPsd: () => state.photopeaPsd,
    activate: () => {
      render();
      ui();
    },
    getState: () => C.clone(state),
    async addPoster(src, name) {
      await load(await C.trimPoster(src), 1, name);
    },
    async document() {
      return {
        width: W,
        height: H,
        name: "ТОП10",
        children: state.layers.map((l, i) => ({
          name: l.name,
          canvas: layerCanvas(i),
          ...sourceLayer(i),
          hidden: !l.visible,
          opacity: l.opacity,
          protected: { position: l.locked },
          ...(i === 4 && !l.src
            ? {
                text: {
                  text: String(state.number),
                  transform: [
                    Math.cos((l.rotation * Math.PI) / 180),
                    Math.sin((l.rotation * Math.PI) / 180),
                    -Math.sin((l.rotation * Math.PI) / 180),
                    Math.cos((l.rotation * Math.PI) / 180),
                    l.x -
                      (Math.sin((l.rotation * Math.PI) / 180) * 125 * l.scale) /
                        100,
                    l.y +
                      (Math.cos((l.rotation * Math.PI) / 180) * 125 * l.scale) /
                        100,
                  ],
                  style: {
                    font: { name: "Arial-BoldMT" },
                    fontSize: (360 * l.scale) / 100,
                    fillColor: {
                      r: parseInt(state.numberColor.slice(1, 3), 16),
                      g: parseInt(state.numberColor.slice(3, 5), 16),
                      b: parseInt(state.numberColor.slice(5, 7), 16),
                    },
                  },
                  paragraphStyle: { justification: "center" },
                },
              }
            : {}),
        })),
      };
    },
    async receive(src, meta) {
      state.photopeaPsd = meta.psd;
      await load(src, 1, "Photopea · результат");
      state.layers[3].visible = false;
      state.layers[4].visible = false;
      state.intensity = 0;
      state.brightness = state.contrast = state.saturation = 100;
      changed();
    },
  });
  window.Top10Editor = { getState: () => C.clone(state), render, restore };
  C.read("top10-v1")
    .then(async (s) => {
      if (s) await restore(s);
    })
    .catch((e) => status("Автосохранение недоступно: " + e.message, true))
    .finally(() => {
      ready = true;
      render();
      ui();
    });
})();
