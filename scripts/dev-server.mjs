import http from "node:http";
import {publicFiles} from "./runtime-files.mjs";
import {searchUnifiedImages, secureImageProxy, imageProviderStatus} from "../worker/image-sources.js";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mime = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};
const CREDIT_ERROR_MESSAGE =
  "На аккаунте Puter/Grok закончились доступные кредиты или исчерпан лимит генерации. Попробуйте другой AI-провайдер или повторите позже";
class ApiError extends Error {
  constructor(status, message, code = "api_error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}
function readDotEnv() {
  const values = {};
  try {
    for (const line of fs
      .readFileSync(path.join(root, ".env"), "utf8")
      .split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && !m[2].startsWith("#"))
        values[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    }
  } catch {}
  return { ...values, ...process.env };
}

export function createAppServer({
  env = readDotEnv(),
  fetchImpl = fetch,
  publicRoot = root,
} = {}) {
  const permittedFiles = new Set(publicFiles(root));
  const tmdbToken=env.TMDB_READ_ACCESS_TOKEN||env.TMDB_ACCESS_TOKEN||env.TMDB_BEARER_TOKEN;
  env={...env,TMDB_READ_ACCESS_TOKEN:tmdbToken,TMDB_ACCESS_TOKEN:tmdbToken};
  const timeoutMs = Number(env.API_TIMEOUT_MS) || 90000;
  const allowed = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const buckets = new Map();
  function json(res, status, body) {
    res.writeHead(status, {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify(body));
  }
  function credits(message) {
    return /insufficient.*(fund|credit|balance)|not.*enough.*(credit|balance|fund)|doesn.t have enough|quota.*exceed|low.balance|credit.limit/i.test(
      message,
    );
  }
  async function remote(url, options = {}) {
    try {
      const r = await fetchImpl(url, {
          ...options,
          signal: AbortSignal.timeout(timeoutMs),
        }),
        text = await r.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new ApiError(
          502,
          "Сервис вернул неверный ответ",
          "invalid_response",
        );
      }
      if (!r.ok) {
        const message = String(
          data.error?.message || data.message || data.status_message || "",
        );
        if (credits(message))
          throw new ApiError(402, CREDIT_ERROR_MESSAGE, "credits_exhausted");
        const messages = {
          400: "Сервис отклонил параметры запроса. Проверьте модель и формат изображения.",
          401: "Ключ API отсутствует или недействителен.",
          403: "Доступ к сервису запрещён для этого аккаунта.",
          404: "Модель или API-маршрут не найдены. Проверьте настройки сервера.",
          429: "Превышен лимит запросов API. Повторите позже.",
        };
        throw new ApiError(
          r.status >= 500 ? 502 : r.status,
          messages[r.status] || "Внешний сервис временно недоступен.",
          "upstream_error",
        );
      }
      return data;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(
        e.name === "TimeoutError" || e.name === "AbortError" ? 504 : 502,
        e.name === "TimeoutError" || e.name === "AbortError"
          ? "Сервис не ответил вовремя. Повторите позже."
          : "Ошибка сети при обращении к внешнему сервису.",
        "network_error",
      );
    }
  }
  async function body(req) {
    let size = 0;
    const chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > 20 * 1024 * 1024)
        throw new ApiError(
          413,
          "Изображение слишком большое (не более 20 МБ).",
        );
      chunks.push(c);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new ApiError(400, "Некорректный JSON-запрос");
    }
  }
  function imageData(value) {
    const m =
      typeof value === "string" &&
      value.match(
        /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/,
      );
    if (!m)
      throw new ApiError(400, "Нужен PNG, JPEG или WebP в формате data URL");
    return { type: m[1], buffer: Buffer.from(m[2], "base64") };
  }
  async function generate(req, res) {
    const b = await body(req);
    b.provider=({xai:"grok",openai:"gpt"})[b.provider]||b.provider;
    b.inputImage=b.inputImage||b.image; b.n=b.n||b.count;
    if (!["grok", "gpt"].includes(b.provider))
      throw new ApiError(400, "Неизвестный AI-провайдер");
    if (
      typeof b.prompt !== "string" ||
      !b.prompt.trim() ||
      b.prompt.length > 18000
    )
      throw new ApiError(400, "Нужен промпт длиной до 18000 символов");
    const source = imageData(b.inputImage),
      key = b.provider === "gpt" ? "OPENAI_API_KEY" : "XAI_API_KEY";
    if (!env[key])
      throw new ApiError(
        503,
        "API не настроен: добавьте " + key + " в серверное окружение",
        "missing_key",
      );
    if (env.AI_REQUESTS_ENABLED !== "true")
      throw new ApiError(
        403,
        "Платная генерация выключена. Включите AI_REQUESTS_ENABLED=true только после проверки тарифа.",
        "ai_disabled",
      );
    const ip = req.socket.remoteAddress,
      now = Date.now(),
      recent = (buckets.get(ip) || []).filter((t) => now - t < 60000);
    if (recent.length >= 5)
      throw new ApiError(
        429,
        "Не более 5 генераций в минуту. Повторите позже.",
      );
    buckets.set(ip, [...recent, now]);
    if (buckets.size > 1000) buckets.clear();
    const n = Math.min(3, Math.max(1, Math.trunc(Number(b.n) || 3)));
    let result;
    if (b.provider === "gpt") {
      const model = env.OPENAI_IMAGE_MODEL || "gpt-image-2";
      if (!["gpt-image-2", "gpt-image-2-2026-04-21"].includes(model))
        throw new ApiError(
          400,
          "Неподдерживаемая OPENAI_IMAGE_MODEL. Проверьте модель на сервере.",
          "invalid_model",
        );
      const form = new FormData();
      form.set("model", model);
      form.set("prompt", b.prompt);
      form.set("n", String(n));
      form.set("background", "transparent");
      form.set("output_format", "png");
      form.set(
        "image",
        new Blob([source.buffer], { type: source.type }),
        "source.png",
      );
      result = await remote("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { Authorization: "Bearer " + env.OPENAI_API_KEY },
        body: form,
      });
    } else {
      const model = env.XAI_IMAGE_MODEL || "grok-imagine-image-2.0";
      if (model !== "grok-imagine-image-2.0")
        throw new ApiError(
          400,
          "Неподдерживаемая XAI_IMAGE_MODEL. Проверьте модель на сервере.",
          "invalid_model",
        );
      result = await remote("https://api.x.ai/v1/images/edits", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + env.XAI_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          prompt: b.prompt,
          image: { url: b.inputImage },
          n,
          response_format: "b64_json",
          quality: "low",
        }),
      });
    }
    const images = (result.data || [])
      .map((i) => (i.b64_json ? "data:image/png;base64," + i.b64_json : null))
      .filter(Boolean);
    if (!images.length) throw new ApiError(502, "AI не вернул изображения");
    json(res, 200, { images });
  }
  function auth() {
    if (env.TMDB_READ_ACCESS_TOKEN)
      return { Authorization: "Bearer " + env.TMDB_READ_ACCESS_TOKEN };
    if (env.TMDB_API_KEY) return {};
    throw new ApiError(
      503,
      "Поиск постеров не настроен: добавьте TMDB_READ_ACCESS_TOKEN или TMDB_API_KEY на сервере",
      "missing_key",
    );
  }
  async function search(url, res) {
    const query = url.searchParams.get("query")?.trim(),
      year = url.searchParams.get("year");
    if (!query) throw new ApiError(400, "Введите название тайтла");
    if (year && !/^\d{4}$/.test(year))
      throw new ApiError(400, "Год должен состоять из четырёх цифр");
    const headers = auth(),
      type = ["movie", "tv"].includes(url.searchParams.get("type"))
        ? url.searchParams.get("type")
        : "multi";
    const types = type === "multi" ? ["movie", "tv"] : [type],
      results = [];
    for (const t of types) {
      const u = new URL("https://api.themoviedb.org/3/search/" + t);
      u.searchParams.set("query", query);
      u.searchParams.set("language", "ru-RU");
      u.searchParams.set("include_adult", "false");
      if (year)
        u.searchParams.set(
          t === "movie" ? "primary_release_year" : "first_air_date_year",
          year,
        );
      if (env.TMDB_API_KEY) u.searchParams.set("api_key", env.TMDB_API_KEY);
      const data = await remote(u, { headers });
      for (const item of data.results || []) {
        if (!item.poster_path) continue;
        results.push({
          id: item.id,
          type: t,
          title: item.title || item.name || "Без названия",
          originalTitle: item.original_title || item.original_name || "",
          year: (item.release_date || item.first_air_date || "").slice(0, 4),
          previewUrl:
            "/api/tmdb-image?path=" +
            encodeURIComponent(item.poster_path) +
            "&size=w342",
          imageUrl:
            "/api/tmdb-image?path=" +
            encodeURIComponent(item.poster_path) +
            "&size=original",
        });
      }
    }
    json(res, 200, {
      results: results.slice(0, 24),
      attribution:
        "This product uses the TMDB API but is not endorsed or certified by TMDB.",
    });
  }
  async function posterVariants(url, res) {
    const id = url.searchParams.get("id"),
      type = url.searchParams.get("type");
    if (!/^\d+$/.test(id || "") || !["movie", "tv"].includes(type))
      throw new ApiError(400, "Некорректный тайтл");
    const headers = auth(),
      u = new URL(`https://api.themoviedb.org/3/${type}/${id}/images`);
    if (env.TMDB_API_KEY) u.searchParams.set("api_key", env.TMDB_API_KEY);
    const data = await remote(u, { headers }),
      seen = new Set();
    const results = (data.posters || [])
      .filter(
        (p) => p.file_path && !seen.has(p.file_path) && seen.add(p.file_path),
      )
      .sort((a, b) => (b.width || 0) - (a.width || 0))
      .slice(0, 48)
      .map((p) => ({
        previewUrl:
          "/api/tmdb-image?path=" +
          encodeURIComponent(p.file_path) +
          "&size=w342",
        imageUrl:
          "/api/tmdb-image?path=" +
          encodeURIComponent(p.file_path) +
          "&size=original",
        quality: `${p.width} × ${p.height}`,
        language: p.iso_639_1 || "без текста",
      }));
    json(res, 200, { results });
  }
  async function tmdbImage(url, res) {
    const p = url.searchParams.get("path") || "",
      size = ["w342", "w500", "w780", "original"].includes(
        url.searchParams.get("size"),
      )
        ? url.searchParams.get("size")
        : "w500";
    if (!/^\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$/i.test(p))
      throw new ApiError(400, "Некорректный путь постера");
    let r;
    try {
      r = await fetchImpl("https://image.tmdb.org/t/p/" + size + p, {
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new ApiError(504, "Не удалось загрузить изображение TMDB");
    }
    if (!r.ok) throw new ApiError(r.status, "Изображение TMDB недоступно");
    const bytes = Buffer.from(await r.arrayBuffer());
    if (bytes.length > 25 * 1024 * 1024)
      throw new ApiError(413, "Изображение слишком большое");
    res.writeHead(200, {
      "Content-Type": r.headers.get("content-type") || "image/jpeg",
      "Cache-Control": "public, max-age=3600",
    });
    res.end(bytes);
  }
  const capabilities = () => ({
    apiVersion:"2026-09-23-runtime-v4",
    providers:{cloudflare:false,xai:!!env.XAI_API_KEY && env.AI_REQUESTS_ENABLED==="true",openai:!!env.OPENAI_API_KEY && env.AI_REQUESTS_ENABLED==="true"},
    providerDetails:{cloudflare:{status:"not_configured"},xai:{status:!env.XAI_API_KEY?"not_configured":env.AI_REQUESTS_ENABLED!=="true"?"disabled":"configured"},openai:{status:!env.OPENAI_API_KEY?"not_configured":env.AI_REQUESTS_ENABLED!=="true"?"disabled":"configured"}},
    background:{local:true,carve:false,removal:false},images:imageProviderStatus(env),
    tmdbConfigured: Boolean(env.TMDB_READ_ACCESS_TOKEN || env.TMDB_API_KEY),
    xaiConfigured: Boolean(env.XAI_API_KEY),
    openaiConfigured: Boolean(env.OPENAI_API_KEY),
    aiEnabled: env.AI_REQUESTS_ENABLED === "true",
    backgroundRemovalMode: "local-imgly",
    models: {
      grok: env.XAI_IMAGE_MODEL || "grok-imagine-image-2.0",
      gpt: env.OPENAI_IMAGE_MODEL || "gpt-image-2",
    },
    upstreamChecked: false,
  });
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(
        req.url || "/",
        "http://" + (req.headers.host || "localhost"),
      );
      if (env.APP_ACCESS_PASSWORD) {
        const value = Buffer.from(
          (req.headers.authorization || "").replace(/^Basic /, ""),
          "base64",
        )
          .toString()
          .split(":")
          .slice(1)
          .join(":");
        const a = Buffer.from(value),
          b = Buffer.from(env.APP_ACCESS_PASSWORD);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          res.writeHead(401, {
            "WWW-Authenticate": 'Basic realm="Poster Markup"',
          });
          return res.end("Authentication required");
        }
      }
      const origin = req.headers.origin,
        same = [
          "http://" + req.headers.host,
          "https://" + req.headers.host,
        ].includes(origin);
      if (origin && !same && !allowed.includes(origin))
        throw new ApiError(403, "Источник запроса не разрешён");
      if (origin && allowed.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
        res.setHeader(
          "Access-Control-Allow-Headers",
          "Content-Type,Authorization",
        );
      }
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        return res.end();
      }
      if (url.pathname.startsWith("/api/")) {
        if (req.method === "GET" && url.pathname === "/api/config")
          return json(res, 200, capabilities());
        if (req.method === "GET" && ["/api/health","/api/status"].includes(url.pathname))
          return json(res, 200, {
            ok: true,
            service: "poster-markup",
            ...capabilities(),
          });
        if (req.method === "GET" && url.pathname === "/api/posters")
          return await search(url, res);
        if (req.method === "GET" && url.pathname === "/api/posters/images")
          return await posterVariants(url, res);
        if (req.method === "GET" && url.pathname === "/api/tmdb-image")
          return await tmdbImage(url, res);
        if (req.method === "POST" && ["/api/ai/generate","/api/generate"].includes(url.pathname))
          return await generate(req, res);
        if(req.method==="GET" && url.pathname==="/api/images/search") {
          const response=await searchUnifiedImages(new Request(url),env,{query:url.searchParams.get("q")||"",year:url.searchParams.get("year")||"",source:url.searchParams.get("source")||"all",tmdbId:url.searchParams.get("tmdbId")||"",mediaType:url.searchParams.get("mediaType")||""});
          return json(res,200,response);
        }
        if(req.method==="GET" && url.pathname==="/api/images/proxy") {
          const response=await secureImageProxy(new Request(url),url.searchParams.get("url")||"");
          res.writeHead(response.status,Object.fromEntries(response.headers));return res.end(Buffer.from(await response.arrayBuffer()));
        }
        if(req.method==="POST" && url.pathname==="/api/remove-background") throw new ApiError(503,"Удаление фона на этом сервере работает локально в браузере. Выберите «Локально (без API)».");
        throw new ApiError(404, "API-маршрут не найден");
      }
      if (!["GET", "HEAD"].includes(req.method))
        throw new ApiError(405, "Метод не поддерживается");
      const pathname = decodeURIComponent(
        url.pathname === "/" ? "/index.html" : url.pathname,
      );
      const file = path.resolve(publicRoot, "." + pathname);
      const topFile = permittedFiles.has(pathname.slice(1));
      if (
        !file.startsWith(publicRoot + path.sep) ||
        !topFile ||
        pathname.split("/").some((x) => x.startsWith("."))
      )
        throw new ApiError(404, "Файл не найден");
      if (
        !fs.existsSync(file) ||
        !fs.statSync(file).isFile() ||
        !fs.realpathSync(file).startsWith(publicRoot + path.sep)
      )
        throw new ApiError(404, "Файл не найден");
      res.writeHead(200, {
        "Content-Type": mime[path.extname(file)] || "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      if (req.method === "HEAD") return res.end();
      if(pathname==="/index.html") {
        // Development never sends requests to a production Worker by accident.
        const html=fs.readFileSync(file,"utf8").replace(/(<meta name="poster-api" content=")[^"]*(")/,"$1$2");
        return res.end(html);
      }
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      if (!res.headersSent)
        json(res, e.status || 500, {
          message: e instanceof ApiError || e.name==="ImageSourceError" ? e.message : "Внутренняя ошибка сервера",
          error: e instanceof ApiError || e.name==="ImageSourceError" ? e.message : "Внутренняя ошибка сервера",
          code: e.code || "internal_error",
        });
      else res.end();
    }
  });
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2),
    arg = (n, f) => (args.includes(n) ? args[args.indexOf(n) + 1] : f),
    host = arg("--host", "127.0.0.1"),
    port = Number(arg("--port", "4173")),
    env = readDotEnv();
  if (
    env.AI_REQUESTS_ENABLED === "true" &&
    !["127.0.0.1", "localhost", "::1"].includes(host) &&
    !env.APP_ACCESS_PASSWORD
  )
    throw new Error(
      "Для публичного платного API задайте APP_ACCESS_PASSWORD или используйте loopback за защищённым reverse proxy.",
    );
  const server = createAppServer({ env });
  server.on("error", (e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
  server.listen(port, host, () =>
    console.log("Poster Markup: http://" + host + ":" + port),
  );
}
