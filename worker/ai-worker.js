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

class ApiError extends Error {
  constructor(message, status = 400, code = "api_error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

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
  if (!match) throw new ApiError("Нужно изображение в data URL формате.", 400, "bad_image");
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
  if (!response.ok) throw new ApiError(`Не удалось получить изображение результата (${response.status}).`, 502, "result_fetch_failed");
  const type = response.headers.get("content-type") || "image/png";
  const bytes = new Uint8Array(await response.arrayBuffer());
  return `data:${type};base64,${bytesToBase64(bytes)}`;
}

function providerError(provider, response, data) {
  const message = data?.error?.message || data?.error || data?.message || `${provider} API ${response.status}`;
  if (response.status === 401 || response.status === 403) return new ApiError(`${provider}: неверный или недоступный API-ключ.`, 401, "auth_error");
  if (response.status === 402) return new ApiError(`${provider}: закончился оплаченный баланс/кредиты.`, 402, "quota_exhausted");
  if (response.status === 429) return new ApiError(`${provider}: превышен лимит запросов. Повторите позже.`, 429, "rate_limit");
  return new ApiError(String(message), response.status >= 500 ? 502 : 400, "provider_error");
}

function openRouterHeaders(env) {
  if (!env.OPENROUTER_API_KEY) {
    throw new ApiError("OPENROUTER_API_KEY не настроен на сервере.", 503, "not_configured");
  }
  const headers = {
    Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
    "Content-Type": "application/json"
  };
  if (env.OPENROUTER_SITE_URL) headers["HTTP-Referer"] = env.OPENROUTER_SITE_URL;
  if (env.OPENROUTER_APP_TITLE) headers["X-OpenRouter-Title"] = env.OPENROUTER_APP_TITLE;
  return headers;
}

function openRouterImageModel(env, provider) {
  if (provider === "openai") {
    return env.OPENROUTER_OPENAI_IMAGE_MODEL || "openai/gpt-image-1";
  }
  if (provider === "xai") {
    return env.OPENROUTER_XAI_IMAGE_MODEL || "x-ai/grok-imagine-image-2.0";
  }
  throw new ApiError("Неизвестный AI-провайдер.", 400, "bad_provider");
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
  const baseUrl = String(env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/images`, {
    method: "POST",
    headers: openRouterHeaders(env),
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw providerError("OpenRouter", response, data);

  const images = extractOpenRouterImages(data);
  if (!images.length) throw new ApiError("OpenRouter не вернул изображение.", 502, "empty_result");
  return images;
}

async function callOpenAI(env, prompt, imageDataUrl, count) {
  const payload = {
    model: openRouterImageModel(env, "openai"),
    prompt,
    input_references: [
      { type: "image_url", image_url: { url: imageDataUrl } }
    ],
    n: count,
    aspect_ratio: "1:1",
    quality: "low",
    background: "transparent"
  };
  return requestOpenRouterImage(env, payload);
}

async function callXAI(env, prompt, imageDataUrl, count) {
  const common = {
    model: openRouterImageModel(env, "xai"),
    prompt,
    input_references: [
      { type: "image_url", image_url: { url: imageDataUrl } }
    ],
    n: 1,
    aspect_ratio: "1:1"
  };
  const jobs = Array.from({ length: count }, async () => {
    const images = await requestOpenRouterImage(env, common);
    return images[0];
  });
  return Promise.all(jobs);
}

function makeProxyUrl(request, originalUrl) {
  const base = new URL(request.url);
  base.pathname = "/api/image";
  base.search = "?url=" + encodeURIComponent(originalUrl);
  return base.toString();
}

async function searchTVmaze(query, request) {
  const response = await fetch("https://api.tvmaze.com/search/shows?q=" + encodeURIComponent(query), {
    headers: { "User-Agent": "Freedom-Poster-Editor/1.0" }
  });
  if (response.status === 429) throw new ApiError("TVmaze: превышен лимит 20 запросов за 10 секунд.", 429, "rate_limit");
  if (!response.ok) throw new ApiError("TVmaze временно недоступен.", 502, "provider_error");
  const rows = await response.json();
  return (rows || []).slice(0, 12).map(({ show }) => {
    const original = show?.image?.original || show?.image?.medium || null;
    return {
      id: "tvmaze-" + show.id,
      title: show.name,
      year: (show.premiered || "").slice(0, 4),
      type: "TV",
      source: "TVmaze",
      sourceUrl: show.url,
      quality: original ? (show.image?.original ? "original" : "medium") : "",
      image: original ? makeProxyUrl(request, original) : null
    };
  }).filter(item => item.image);
}

async function searchTMDB(query, request, env) {
  if (!env.TMDB_BEARER_TOKEN || env.TMDB_COMMERCIAL_APPROVED !== "true") return [];
  const response = await fetch("https://api.themoviedb.org/3/search/multi?include_adult=false&language=ru-RU&query=" + encodeURIComponent(query), {
    headers: {
      Authorization: `Bearer ${env.TMDB_BEARER_TOKEN}`,
      Accept: "application/json"
    }
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 429) throw new ApiError("TMDB: превышен лимит API.", 429, "rate_limit");
  if (!response.ok) throw providerError("TMDB", response, data);
  return (data.results || [])
    .filter(item => (item.media_type === "movie" || item.media_type === "tv") && item.poster_path)
    .slice(0, 12)
    .map(item => {
      const original = "https://image.tmdb.org/t/p/w780" + item.poster_path;
      return {
        id: "tmdb-" + item.media_type + "-" + item.id,
        title: item.title || item.name,
        year: String(item.release_date || item.first_air_date || "").slice(0, 4),
        type: item.media_type === "movie" ? "Movie" : "TV",
        source: "TMDB",
        sourceUrl: `https://www.themoviedb.org/${item.media_type}/${item.id}`,
        quality: "w780",
        image: makeProxyUrl(request, original)
      };
    });
}

async function proxyImage(urlString) {
  let url;
  try { url = new URL(urlString); } catch { throw new ApiError("Некорректный URL изображения.", 400, "bad_url"); }
  const allowedHosts = new Set(["static.tvmaze.com", "image.tmdb.org"]);
  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname)) throw new ApiError("Источник изображения не разрешён.", 403, "forbidden_source");
  const response = await fetch(url.toString(), { headers: { "User-Agent": "Freedom-Poster-Editor/1.0" } });
  if (!response.ok) throw new ApiError("Не удалось получить постер.", 502, "image_fetch_failed");
  const headers = new Headers();
  headers.set("Content-Type", response.headers.get("content-type") || "image/jpeg");
  headers.set("Cache-Control", "public, max-age=86400");
  headers.set("Access-Control-Allow-Origin", "*");
  return new Response(response.body, { status: 200, headers });
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function callCarve(env, imageDataUrl) {
  if (!env.CARVE_API_KEY) throw new ApiError("CARVE_API_KEY не настроен на сервере.", 503, "not_configured");
  const { type, bytes } = parseDataUrl(imageDataUrl);
  const form = new FormData();
  form.append("image", new Blob([bytes], { type }), "image.png");
  form.append("format", "png");
  form.append("size", "auto");
  const create = await fetch("https://api.carve.photos/api/v1/images/remove_bg", {
    method: "POST",
    headers: { "X-API-Key": env.CARVE_API_KEY },
    body: form
  });
  const created = await create.json().catch(() => ({}));
  if (create.status !== 202) throw providerError("Carve.Photos", create, created);
  const imageId = created.image_id;
  if (!imageId) throw new ApiError("Carve.Photos не вернул image_id.", 502, "empty_result");

  for (let attempt = 0; attempt < 36; attempt++) {
    await sleep(1500);
    const status = await fetch(`https://api.carve.photos/api/v1/images/images/${encodeURIComponent(imageId)}`, {
      headers: { "X-API-Key": env.CARVE_API_KEY }
    });
    if (status.status === 200) {
      const data = await status.json();
      if (!data.image_url) throw new ApiError("Carve.Photos не вернул URL результата.", 502, "empty_result");
      return responseToDataUrl(data.image_url);
    }
    if (status.status !== 201 && status.status !== 202) {
      const data = await status.json().catch(() => ({}));
      throw providerError("Carve.Photos", status, data);
    }
  }
  throw new ApiError("Carve.Photos: превышено время ожидания обработки.", 504, "timeout");
}

function findRemovalOutput(value) {
  const queue = [value];
  let rawBase64 = null;
  while (queue.length) {
    const current = queue.shift();
    if (typeof current === "string") {
      if (/^data:image\//i.test(current)) return { type: "data", value: current };
      if (/^https:\/\//i.test(current) && /\.(png|webp|jpe?g)(\?|$)/i.test(current)) return { type: "url", value: current };
      if (!rawBase64 && current.length > 1000 && /^[A-Za-z0-9+/=\s]+$/.test(current)) rawBase64 = current.replace(/\s/g, "");
      continue;
    }
    if (Array.isArray(current)) queue.push(...current);
    else if (current && typeof current === "object") {
      const preferred = ["high_resolution", "image_base64", "base64", "image_url", "url", "preview"];
      for (const key of preferred) if (key in current) queue.unshift(current[key]);
      for (const [key, val] of Object.entries(current)) if (!preferred.includes(key)) queue.push(val);
    }
  }
  return rawBase64 ? { type: "data", value: "data:image/png;base64," + rawBase64 } : null;
}

async function callRemovalAI(env, imageDataUrl) {
  if (!env.REMOVAL_AI_KEY) throw new ApiError("REMOVAL_AI_KEY не настроен на сервере.", 503, "not_configured");
  const { type, bytes } = parseDataUrl(imageDataUrl);
  const form = new FormData();
  form.append("image_file", new Blob([bytes], { type }), "image.png");
  form.append("get_base64", "1");
  form.append("crop", "0");
  const response = await fetch("https://api.removal.ai/3.0/remove", {
    method: "POST",
    headers: { "Rm-Token": env.REMOVAL_AI_KEY },
    body: form
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw providerError("Removal.AI", response, data);
  const output = findRemovalOutput(data);
  if (!output) throw new ApiError("Removal.AI не вернул изображение результата.", 502, "empty_result");
  return output.type === "url" ? responseToDataUrl(output.value) : output.value;
}

async function removeBackground(env, provider, image) {
  const available = {
    carve: !!env.CARVE_API_KEY,
    removal: !!env.REMOVAL_AI_KEY
  };
  const selected = provider === "auto"
    ? (available.carve ? "carve" : available.removal ? "removal" : null)
    : provider;
  if (!selected || !available[selected]) throw new ApiError("Выбранный API удаления фона не настроен.", 503, "not_configured");
  if (selected === "carve") return { image: await callCarve(env, image), provider: "Carve.Photos" };
  if (selected === "removal") return { image: await callRemovalAI(env, image), provider: "Removal.AI" };
  throw new ApiError("Неизвестный провайдер удаления фона.", 400, "bad_provider");
}

export default {
  async fetch(request, env) {
    const origin = allowedOrigin(request, env);
    if (origin === "null") return json({ error: "Origin not allowed", code: "origin_denied" }, 403, "null");
    if (request.method === "OPTIONS") return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
      }
    });

    try {
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/api/status") {
        return json({
          ok: true,
          providers: { xai: !!env.OPENROUTER_API_KEY, openai: !!env.OPENROUTER_API_KEY },
          aiProvider: "openrouter",
          aiModels: {
            xai: openRouterImageModel(env, "xai"),
            openai: openRouterImageModel(env, "openai")
          },
          background: { carve: !!env.CARVE_API_KEY, removal: !!env.REMOVAL_AI_KEY },
          posters: {
            tvmaze: true,
            tmdb: !!env.TMDB_BEARER_TOKEN && env.TMDB_COMMERCIAL_APPROVED === "true"
          }
        }, 200, origin);
      }

      if (request.method === "GET" && url.pathname === "/api/posters") {
        const q = (url.searchParams.get("q") || "").trim();
        if (q.length < 2) throw new ApiError("Запрос должен содержать минимум 2 символа.", 400, "bad_query");
        const tvmaze = await searchTVmaze(q, request);
        const tmdb = await searchTMDB(q, request, env);
        const results = [...tmdb, ...tvmaze].slice(0, 24);
        return json({ results, providers: { tvmaze: true, tmdb: tmdb.length > 0 || (!!env.TMDB_BEARER_TOKEN && env.TMDB_COMMERCIAL_APPROVED === "true") } }, 200, origin);
      }

      if (request.method === "GET" && url.pathname === "/api/image") {
        return proxyImage(url.searchParams.get("url") || "");
      }

      if (request.method === "POST" && url.pathname === "/api/generate") {
        const body = await request.json();
        const provider = body.provider;
        const prompt = String(body.prompt || "").trim();
        const image = String(body.image || "");
        const count = Math.max(1, Math.min(3, Number(body.count) || 1));
        if (!prompt || prompt.length > 32000) throw new ApiError("Некорректный промпт.", 400, "bad_prompt");
        if (!image.startsWith("data:image/")) throw new ApiError("Некорректный файл изображения.", 400, "bad_image");
        if (image.length > 12_000_000) throw new ApiError("Изображение слишком большое. Максимум примерно 8 МБ.", 413, "image_too_large");

        let images;
        if (provider === "openai") images = await callOpenAI(env, prompt, image, count);
        else if (provider === "xai") images = await callXAI(env, prompt, image, count);
        else throw new ApiError("Неизвестный AI-провайдер.", 400, "bad_provider");
        return json({ images, provider: "openrouter", model: openRouterImageModel(env, provider) }, 200, origin);
      }

      if (request.method === "POST" && url.pathname === "/api/remove-background") {
        const body = await request.json();
        const image = String(body.image || "");
        if (!image.startsWith("data:image/")) throw new ApiError("Некорректное изображение.", 400, "bad_image");
        if (image.length > 36_000_000) throw new ApiError("Изображение слишком большое для прокси.", 413, "image_too_large");
        const result = await removeBackground(env, String(body.provider || "auto"), image);
        return json(result, 200, origin);
      }

      return json({ ok: true, service: "Poster Editor API" }, 200, origin);
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 500;
      const code = error instanceof ApiError ? error.code : "internal_error";
      return json({ error: error.message || "Unexpected server error", code }, status, origin);
    }
  }
};
