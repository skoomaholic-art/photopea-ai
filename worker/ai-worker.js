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

const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENAI_IMAGE_MODEL = "openai/gpt-image-1";
const DEFAULT_XAI_IMAGE_MODEL = "x-ai/grok-imagine-image-2.0";

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

function openRouterHeaders(env) {
  if (!env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY не настроен на сервере.");
  const headers = {
    Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
    "Content-Type": "application/json"
  };
  if (env.OPENROUTER_SITE_URL) headers["HTTP-Referer"] = env.OPENROUTER_SITE_URL;
  if (env.OPENROUTER_APP_TITLE) headers["X-OpenRouter-Title"] = env.OPENROUTER_APP_TITLE;
  return headers;
}

function imageModel(env, provider) {
  if (provider === "openai") {
    return env.OPENROUTER_OPENAI_IMAGE_MODEL || DEFAULT_OPENAI_IMAGE_MODEL;
  }
  if (provider === "xai") {
    return env.OPENROUTER_XAI_IMAGE_MODEL || DEFAULT_XAI_IMAGE_MODEL;
  }
  throw new Error("Неизвестный AI-провайдер.");
}

function extractOpenRouterImages(data) {
  return (data?.data || [])
    .map(item => {
      if (item?.b64_json) {
        const mediaType = item.media_type || "image/png";
        return `data:${mediaType};base64,${item.b64_json}`;
      }
      return item?.url || null;
    })
    .filter(Boolean);
}

async function requestOpenRouterImage(env, payload) {
  const baseUrl = String(env.OPENROUTER_BASE_URL || DEFAULT_OPENROUTER_BASE_URL).replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/images`, {
    method: "POST",
    headers: openRouterHeaders(env),
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || data?.message || `OpenRouter API ${response.status}`;
    throw new Error(message);
  }

  const images = extractOpenRouterImages(data);
  if (!images.length) throw new Error("OpenRouter не вернул изображение.");
  return images;
}

async function callOpenRouter(env, provider, prompt, imageDataUrl, count) {
  const model = imageModel(env, provider);
  const common = {
    model,
    prompt,
    input_references: [
      {
        type: "image_url",
        image_url: { url: imageDataUrl }
      }
    ],
    aspect_ratio: "1:1"
  };

  if (provider === "openai") {
    return requestOpenRouterImage(env, {
      ...common,
      n: count,
      quality: "low",
      background: "transparent"
    });
  }

  // Current Grok image endpoints generate one edited image per request.
  const jobs = Array.from({ length: count }, async () => {
    const images = await requestOpenRouterImage(env, {
      ...common,
      n: 1
    });
    return images[0];
  });
  return Promise.all(jobs);
}

export default {
  async fetch(request, env) {
    const origin = allowedOrigin(request, env);
    if (origin === "null") return json({ error: "Origin not allowed" }, 403, "null");
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
        }
      });
    }

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/status") {
      const ready = Boolean(env.OPENROUTER_API_KEY);
      return json({
        ok: true,
        provider: "openrouter",
        providers: { xai: ready, openai: ready },
        models: {
          xai: imageModel(env, "xai"),
          openai: imageModel(env, "openai")
        }
      }, 200, origin);
    }

    if (request.method === "POST" && url.pathname === "/api/generate") {
      try {
        const body = await request.json();
        const provider = String(body.provider || "");
        const prompt = String(body.prompt || "").trim();
        const image = String(body.image || "");
        const count = Math.max(1, Math.min(3, Number(body.count) || 1));

        if (!env.OPENROUTER_API_KEY) {
          throw new Error("OPENROUTER_API_KEY не настроен на сервере.");
        }
        if (!prompt || prompt.length > 32000) throw new Error("Некорректный промпт.");
        if (!image.startsWith("data:image/")) throw new Error("Некорректный файл изображения.");
        if (image.length > 12_000_000) throw new Error("Изображение слишком большое. Максимум примерно 8 МБ.");

        const images = await callOpenRouter(env, provider, prompt, image, count);
        return json({ images, provider: "openrouter", model: imageModel(env, provider) }, 200, origin);
      } catch (error) {
        return json({ error: error.message || "AI request failed" }, 400, origin);
      }
    }

    return json({ ok: true, service: "Poster Markup AI proxy", provider: "openrouter" }, 200, origin);
  }
};
