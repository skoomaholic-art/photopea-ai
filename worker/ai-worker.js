const json = (data, status = 200, origin = "*") => new Response(JSON.stringify(data), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Cache-Control": "no-store"
  }
});

function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin") || "*";
  if (origin === "*") return "*";
  const allowed = new Set([
    "https://skoomaholic-art.github.io",
    "http://127.0.0.1:4173",
    "http://localhost:4173",
    ...(env.ALLOWED_ORIGINS || "").split(",").map(x => x.trim()).filter(Boolean)
  ]);
  return allowed.has(origin) ? origin : "null";
}

function parseDataUrl(value) {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(value || "");
  if (!match) throw new Error("Нужен PNG/JPG/WEBP в data URL формате.");
  const bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
  return { type: match[1], bytes };
}

function bytesToBase64(bytes) {
  let out = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(out);
}

async function responseToDataUrl(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Не удалось получить результат (${response.status}).`);
  const type = response.headers.get("content-type") || "image/png";
  const bytes = new Uint8Array(await response.arrayBuffer());
  return `data:${type};base64,${bytesToBase64(bytes)}`;
}

async function callOpenAI(env, prompt, imageDataUrl, count) {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY не настроен на сервере.");
  const { type, bytes } = parseDataUrl(imageDataUrl);
  const form = new FormData();
  form.append("model", "gpt-image-1-mini");
  form.append("prompt", prompt);
  form.append("image", new Blob([bytes], { type }), "logo.png");
  form.append("n", String(count));
  form.append("size", "1024x1024");
  form.append("quality", "low");
  form.append("background", "transparent");
  form.append("output_format", "png");
  const response = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: form });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `OpenAI API ${response.status}`);
  const images = (data.data || []).map(item => item.b64_json ? `data:image/png;base64,${item.b64_json}` : item.url).filter(Boolean);
  if (!images.length) throw new Error("OpenAI не вернул изображение.");
  return images;
}

async function callXAI(env, prompt, imageDataUrl, count) {
  if (!env.XAI_API_KEY) throw new Error("XAI_API_KEY не настроен на сервере.");
  const jobs = Array.from({ length: count }, async () => {
    const response = await fetch("https://api.x.ai/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.XAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "grok-imagine-image-2.0",
        prompt,
        image: { url: imageDataUrl, type: "image_url" },
        response_format: "url",
        aspect_ratio: "1:1",
        quality: "low"
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || data.error || `xAI API ${response.status}`);
    const url = data.data?.[0]?.url;
    if (!url) throw new Error("xAI не вернул URL изображения.");
    return responseToDataUrl(url);
  });
  return Promise.all(jobs);
}

export default {
  async fetch(request, env) {
    const origin = allowedOrigin(request, env);
    if (origin === "null") return json({ error: "Origin not allowed" }, 403, "null");
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" } });

    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/status") {
      return json({ ok: true, providers: { xai: !!env.XAI_API_KEY, openai: !!env.OPENAI_API_KEY } }, 200, origin);
    }

    if (request.method === "POST" && url.pathname === "/api/generate") {
      try {
        const body = await request.json();
        const provider = body.provider;
        const prompt = String(body.prompt || "").trim();
        const image = String(body.image || "");
        const count = Math.max(1, Math.min(3, Number(body.count) || 1));
        if (!prompt || prompt.length > 32000) throw new Error("Некорректный промпт.");
        if (!image.startsWith("data:image/")) throw new Error("Некорректный файл изображения.");
        if (image.length > 12_000_000) throw new Error("Изображение слишком большое. Максимум примерно 8 МБ.");
        let images;
        if (provider === "openai") images = await callOpenAI(env, prompt, image, count);
        else if (provider === "xai") images = await callXAI(env, prompt, image, count);
        else throw new Error("Неизвестный AI-провайдер.");
        return json({ images }, 200, origin);
      } catch (error) {
        return json({ error: error.message || "AI request failed" }, 400, origin);
      }
    }

    return json({ ok: true, service: "Poster Markup AI proxy" }, 200, origin);
  }
};
