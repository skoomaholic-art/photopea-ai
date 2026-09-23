(() => {
  const DEFAULTS = Object.freeze({
    brightness: 0, contrast: 0, exposure: 0, saturation: 0, temperature: 0, tint: 0,
    highlights: 0, shadows: 0, whites: 0, blacks: 0, hue: 0, blur: 0,
    sharpen: 0, grain: 0, vignette: 0
  });

  const CONTROLS = [
    ["brightness","Brightness",-100,100,1],
    ["contrast","Contrast",-100,100,1],
    ["exposure","Exposure",-3,3,0.1],
    ["saturation","Saturation",-100,100,1],
    ["temperature","Temperature",-100,100,1],
    ["tint","Tint",-100,100,1],
    ["highlights","Highlights",-100,100,1],
    ["shadows","Shadows",-100,100,1],
    ["whites","Whites",-100,100,1],
    ["blacks","Blacks",-100,100,1],
    ["hue","Hue",-180,180,1],
    ["blur","Blur",0,20,0.5],
    ["sharpen","Sharpen",0,100,1],
    ["grain","Grain",0,100,1],
    ["vignette","Vignette",0,100,1]
  ].map(([key,label,min,max,step]) => ({key,label,min,max,step}));

  const P = values => ({ ...DEFAULTS, ...values });
  const PRESETS = {
    "Original": P({}),
    "B&W": P({ saturation: -100, contrast: 8 }),
    "High Contrast": P({ contrast: 38, blacks: -12, whites: 12 }),
    "Cinematic": P({ contrast: 18, saturation: -8, temperature: -8, highlights: -14, shadows: -8, vignette: 22, sharpen: 12 }),
    "Cold": P({ temperature: -34, saturation: -4, contrast: 5 }),
    "Warm": P({ temperature: 34, saturation: 6, highlights: 5 }),
    "Faded": P({ contrast: -18, blacks: 22, saturation: -14, highlights: -8 }),
    "Vintage": P({ temperature: 24, saturation: -24, contrast: -8, blacks: 14, grain: 22, vignette: 18 }),
    "Sepia": P({ saturation: -58, temperature: 52, tint: 16, contrast: 4 }),
    "Desaturated": P({ saturation: -55, contrast: 8 }),
    "Teal & Orange": P({ temperature: 16, tint: -18, contrast: 18, saturation: 14, shadows: -12, highlights: 8 }),
    "Dark": P({ brightness: -24, shadows: -18, blacks: -12, contrast: 12 }),
    "Bright": P({ brightness: 20, exposure: 0.35, shadows: 10 }),
    "Dramatic": P({ contrast: 34, saturation: -10, blacks: -22, highlights: -18, sharpen: 24, vignette: 30 }),
    "Soft": P({ contrast: -12, highlights: -8, blur: 0.8, saturation: -4 }),
    "Sharpen": P({ sharpen: 42, contrast: 6 }),
    "Grain": P({ grain: 34, contrast: 6 }),
    "Vignette": P({ vignette: 52, contrast: 5 })
  };

  const clamp = value => Math.max(0, Math.min(255, value));

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Не удалось загрузить изображение для фильтров."));
      image.src = src;
    });
  }

  function adjustPixels(imageData, s) {
    const data = imageData.data;
    const exposure = Math.pow(2, Number(s.exposure) || 0);
    const temp = (Number(s.temperature) || 0) * 0.55;
    const tint = (Number(s.tint) || 0) * 0.35;
    const shadows = (Number(s.shadows) || 0) / 100;
    const highlights = (Number(s.highlights) || 0) / 100;
    const whites = (Number(s.whites) || 0) / 100;
    const blacks = (Number(s.blacks) || 0) / 100;
    const grain = (Number(s.grain) || 0) / 100;

    for (let i = 0; i < data.length; i += 4) {
      let r = data[i] * exposure;
      let g = data[i + 1] * exposure;
      let b = data[i + 2] * exposure;
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const shadowWeight = Math.pow(1 - Math.min(1, lum), 2);
      const highlightWeight = Math.pow(Math.min(1, lum), 2);
      const blackWeight = Math.max(0, 1 - lum * 4);
      const whiteWeight = Math.max(0, (lum - 0.75) * 4);
      const delta =
        shadows * 80 * shadowWeight +
        highlights * 80 * highlightWeight +
        blacks * 70 * blackWeight +
        whites * 70 * whiteWeight;

      r += delta + temp + tint;
      g += delta - tint * 0.55;
      b += delta - temp + tint;

      if (grain > 0) {
        const hash = ((i * 1103515245 + 12345) >>> 16) & 255;
        const noise = (hash - 127.5) * grain * 0.32;
        r += noise; g += noise; b += noise;
      }

      data[i] = clamp(r);
      data[i + 1] = clamp(g);
      data[i + 2] = clamp(b);
    }
    return imageData;
  }

  function sharpen(ctx, width, height, amount) {
    const strength = Math.max(0, Math.min(1, amount / 100));
    if (!strength) return;
    const src = ctx.getImageData(0, 0, width, height);
    const out = ctx.createImageData(width, height);
    const s = src.data, d = out.data;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (!x || !y || x === width - 1 || y === height - 1) {
          d[i]=s[i]; d[i+1]=s[i+1]; d[i+2]=s[i+2]; d[i+3]=s[i+3];
          continue;
        }
        const left=i-4, right=i+4, up=i-width*4, down=i+width*4;
        for (let c=0;c<3;c++) {
          const sharp = 5*s[i+c]-s[left+c]-s[right+c]-s[up+c]-s[down+c];
          d[i+c]=clamp(s[i+c]*(1-strength)+sharp*strength);
        }
        d[i+3]=s[i+3];
      }
    }
    ctx.putImageData(out,0,0);
  }

  function vignette(ctx, width, height, amount) {
    const strength = Math.max(0, Math.min(1, amount / 100));
    if (!strength) return;
    const radius = Math.sqrt(width * width + height * height) * 0.56;
    const gradient = ctx.createRadialGradient(width/2,height/2,Math.min(width,height)*0.18,width/2,height/2,radius);
    gradient.addColorStop(0,"rgba(0,0,0,0)");
    gradient.addColorStop(0.62,"rgba(0,0,0,0)");
    gradient.addColorStop(1,"rgba(0,0,0," + (0.82*strength) + ")");
    ctx.save();
    ctx.fillStyle=gradient;
    ctx.fillRect(0,0,width,height);
    ctx.restore();
  }

  async function renderToCanvas(src, settings = DEFAULTS, maxDimension = null) {
    const image = await loadImage(src);
    const scale = maxDimension ? Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight)) : 1;
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width=width; canvas.height=height;
    const ctx=canvas.getContext("2d",{willReadFrequently:true});
    const s={...DEFAULTS,...settings};

    const brightness = Math.max(0, 100 + Number(s.brightness || 0));
    const contrast = Math.max(0, 100 + Number(s.contrast || 0));
    const saturation = Math.max(0, 100 + Number(s.saturation || 0));
    const hue = Number(s.hue || 0);
    const blur = Math.max(0, Number(s.blur || 0)) * scale;
    ctx.filter="brightness(" + brightness + "%) contrast(" + contrast + "%) saturate(" + saturation + "%) hue-rotate(" + hue + "deg) blur(" + blur + "px)";
    ctx.drawImage(image,0,0,width,height);
    ctx.filter="none";

    const pixelSettings = ["exposure","temperature","tint","highlights","shadows","whites","blacks","grain"];
    if (pixelSettings.some(key => Number(s[key]) !== 0)) {
      const pixels=ctx.getImageData(0,0,width,height);
      ctx.putImageData(adjustPixels(pixels,s),0,0);
    }
    if (Number(s.sharpen)>0) sharpen(ctx,width,height,Number(s.sharpen));
    if (Number(s.vignette)>0) vignette(ctx,width,height,Number(s.vignette));
    return canvas;
  }

  async function renderBlob(src, settings = DEFAULTS) {
    const canvas=await renderToCanvas(src,settings,null);
    return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error("Не удалось применить фильтры.")),"image/png"));
  }

  window.ImageFilters = {
    DEFAULTS,
    CONTROLS,
    PRESETS,
    cloneDefaults: () => ({...DEFAULTS}),
    renderToCanvas,
    renderBlob
  };
})();
