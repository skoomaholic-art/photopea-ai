const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const PROXY_TIMEOUT_MS = 12_000;
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/";
const CACHE_ORIGIN = "https://poster-editor-cache.local";
const ALLOWED_IMAGE_HOSTS = new Set([
  "image.tmdb.org",
  "assets.fanart.tv",
  "static.tvmaze.com",
  "upload.wikimedia.org"
]);

export class ImageSourceError extends Error {
  constructor(message, status = 400, code = "image_source_error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const clean = value => String(value ?? "").trim();
const yearOf = value => clean(value).slice(0, 4);
const proxyUrl = (request, url) => {
  const out = new URL(request.url);
  out.pathname = "/api/images/proxy";
  out.search = "?url=" + encodeURIComponent(url);
  return out.toString();
};

function stripHtml(value) {
  return clean(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeLanguage(value) {
  const lang = clean(value).toLowerCase();
  if (!lang || lang === "00" || lang === "null") return null;
  return lang;
}

function imageShape(width, height) {
  const ratio = width && height ? width / height : 0;
  if (!ratio) return "unknown";
  if (ratio < 0.9) return "vertical";
  if (ratio > 1.2) return "horizontal";
  return "square";
}

function resolutionClass(width, height) {
  const max = Math.max(Number(width) || 0, Number(height) || 0);
  if (max >= 3840) return "4k";
  if (max >= 2560) return "2k";
  if (max >= 1920) return "fhd";
  return "standard";
}

function sourceErrorMessage(source, response, data) {
  if (response.status === 401 || response.status === 403) {
    return new ImageSourceError(source + ": API key не настроен или не имеет доступа.", 503, "not_configured");
  }
  if (response.status === 429) {
    return new ImageSourceError(source + ": превышен лимит API.", 429, "rate_limit");
  }
  const message = data?.status_message || data?.error || data?.message || source + " временно недоступен.";
  return new ImageSourceError(String(message), response.status >= 500 ? 502 : 400, "provider_error");
}

async function cachedJson(key, ttlSeconds, loader) {
  const cache = globalThis.caches?.default;
  const cacheRequest = new Request(CACHE_ORIGIN + "/" + encodeURIComponent(key));
  if (cache) {
    const hit = await cache.match(cacheRequest);
    if (hit) return hit.json();
  }
  const value = await loader();
  if (cache) {
    const response = new Response(JSON.stringify(value), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=" + ttlSeconds
      }
    });
    await cache.put(cacheRequest, response);
  }
  return value;
}

function tmdbConfigured(env) {
  return !!(env.TMDB_ACCESS_TOKEN || env.TMDB_BEARER_TOKEN || env.TMDB_API_KEY);
}

async function tmdbJson(env, path, params = {}, ttlSeconds = 600) {
  if (!tmdbConfigured(env)) {
    throw new ImageSourceError("TMDB API key не настроен.", 503, "not_configured");
  }
  const url = new URL("https://api.themoviedb.org/3" + path);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const headers = { Accept: "application/json" };
  const bearer = env.TMDB_ACCESS_TOKEN || env.TMDB_BEARER_TOKEN;
  if (bearer) headers.Authorization = "Bearer " + bearer;
  else url.searchParams.set("api_key", env.TMDB_API_KEY);

  const key = "tmdb:" + url.pathname + "?" + [...url.searchParams.entries()].filter(([k]) => k !== "api_key").map(([k,v]) => k + "=" + v).join("&");
  return cachedJson(key, ttlSeconds, async () => {
    const response = await fetch(url, { headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw sourceErrorMessage("TMDB", response, data);
    return data;
  });
}

async function searchTmdbCandidates(env, query, year) {
  const q = clean(query);
  const [movies, tv] = await Promise.all([
    tmdbJson(env, "/search/movie", {
      query: q,
      include_adult: "false",
      language: "ru-RU",
      year: year || undefined,
      page: 1
    }),
    tmdbJson(env, "/search/tv", {
      query: q,
      include_adult: "false",
      language: "ru-RU",
      first_air_date_year: year || undefined,
      page: 1
    })
  ]);

  const normalized = q.toLowerCase();
  return [
    ...(movies.results || []).map(item => ({ ...item, media_type: "movie", titleText: item.title, originalTitle: item.original_title, date: item.release_date })),
    ...(tv.results || []).map(item => ({ ...item, media_type: "tv", titleText: item.name, originalTitle: item.original_name, date: item.first_air_date }))
  ].map(item => {
    const candidateTitle = clean(item.titleText).toLowerCase();
    const originalTitle = clean(item.originalTitle).toLowerCase();
    const candidateYear = yearOf(item.date);
    let score = Number(item.popularity) || 0;
    if (candidateTitle === normalized || originalTitle === normalized) score += 10_000;
    else if (candidateTitle.includes(normalized) || normalized.includes(candidateTitle) || originalTitle.includes(normalized) || normalized.includes(originalTitle)) score += 2_000;
    if (year && candidateYear === String(year)) score += 8_000;
    return {
      tmdbId: item.id,
      mediaType: item.media_type,
      title: item.titleText,
      originalTitle: item.originalTitle || "",
      year: candidateYear,
      overview: item.overview || "",
      posterPath: item.poster_path || null,
      popularity: Number(item.popularity) || 0,
      score
    };
  }).sort((a, b) => b.score - a.score).slice(0, 12);
}

async function resolveTmdbIdentity(env, query, year, forcedTmdbId = null, forcedMediaType = null) {
  const candidates = await searchTmdbCandidates(env, query, year);
  const forcedId = forcedTmdbId ? Number(forcedTmdbId) : null;
  const forcedType = forcedMediaType === "movie" || forcedMediaType === "tv" ? forcedMediaType : null;
  const best = forcedId && forcedType
    ? candidates.find(item => item.tmdbId === forcedId && item.mediaType === forcedType)
    : candidates[0];
  if (!best) return { identity: null, candidates };
  return {
    identity: {
      tmdbId: best.tmdbId,
      mediaType: best.mediaType,
      title: best.title,
      originalTitle: best.originalTitle,
      year: best.year,
      overview: best.overview,
      imdbId: null
    },
    candidates
  };
}

function baseAsset(request, identity, source, sourceId, type, originalUrl, thumbnailUrl, metadata = {}) {
  const width = Number(metadata.width) || null;
  const height = Number(metadata.height) || null;
  const language = normalizeLanguage(metadata.language);
  const isTextless = metadata.isTextless === null || metadata.isTextless === undefined
    ? (language === null && type !== "logo" ? true : null)
    : !!metadata.isTextless;
  return {
    id: source.toLowerCase().replace(/\W+/g, "-") + "-" + sourceId,
    source,
    sourceId: String(sourceId),
    sourceUrl: metadata.sourceUrl || null,
    originalUrl,
    proxyUrl: proxyUrl(request, originalUrl),
    thumbnailUrl: thumbnailUrl ? proxyUrl(request, thumbnailUrl) : proxyUrl(request, originalUrl),
    title: identity?.title || metadata.title || "",
    year: identity?.year || metadata.year || "",
    mediaType: identity?.mediaType || metadata.mediaType || null,
    tmdbId: identity?.tmdbId || metadata.tmdbId || null,
    imageType: type,
    width,
    height,
    aspectRatio: width && height ? width / height : Number(metadata.aspectRatio) || null,
    shape: imageShape(width, height),
    resolutionClass: resolutionClass(width, height),
    language,
    isTextless,
    voteAverage: metadata.voteAverage ?? null,
    fileSize: metadata.fileSize ?? null,
    mimeType: metadata.mimeType || null,
    license: metadata.license || null,
    attribution: metadata.attribution || null
  };
}

export class ImageSourceAdapter {
  constructor(env, request) {
    this.env = env;
    this.request = request;
  }
  status() {
    return { enabled: true };
  }
  async search() {
    return [];
  }
}

export class TMDBSource extends ImageSourceAdapter {
  status() {
    if (!tmdbConfigured(this.env)) return { enabled: false, reason: "TMDB API key не настроен" };
    return { enabled: true };
  }

  async resolve(query, year, forcedTmdbId = null, forcedMediaType = null) {
    return resolveTmdbIdentity(this.env, query, year, forcedTmdbId, forcedMediaType);
  }

  async search(identity) {
    if (!identity) return [];
    const data = await tmdbJson(this.env, "/" + identity.mediaType + "/" + identity.tmdbId + "/images", {
      include_image_language: "en,ru,kk,null"
    }, 900);

    const sourceUrl = "https://www.themoviedb.org/" + identity.mediaType + "/" + identity.tmdbId;
    const rows = [
      ...((data.posters || []).map(item => ({ type: "poster", item }))),
      ...((data.backdrops || []).map(item => ({ type: "backdrop", item }))),
      ...((data.logos || []).map(item => ({ type: "logo", item })))
    ];

    return rows.map(({ type, item }) => {
      const original = TMDB_IMAGE_BASE + "original" + item.file_path;
      const previewSize = type === "poster" ? "w342" : type === "logo" ? "w300" : "w780";
      const preview = TMDB_IMAGE_BASE + previewSize + item.file_path;
      return baseAsset(
        this.request,
        identity,
        "TMDB",
        identity.mediaType + "-" + identity.tmdbId + "-" + item.file_path.replace(/\W+/g, ""),
        type,
        original,
        preview,
        {
          width: item.width,
          height: item.height,
          language: item.iso_639_1,
          voteAverage: item.vote_average,
          sourceUrl,
          mimeType: /\.png$/i.test(item.file_path) ? "image/png" : "image/jpeg",
          isTextless: item.iso_639_1 == null && type !== "logo"
        }
      );
    });
  }

  async externalIds(identity) {
    if (!identity) return {};
    return tmdbJson(this.env, "/" + identity.mediaType + "/" + identity.tmdbId + "/external_ids", {}, 86_400);
  }
}

function fanartType(key) {
  const k = key.toLowerCase();
  if (k.includes("logo")) return "logo";
  if (k.includes("poster")) return "poster";
  if (k.includes("background") || k.includes("fanart") || k.includes("banner")) return "backdrop";
  if (k.includes("character") || k.includes("clearart") || k.includes("thumb")) return "still";
  return null;
}

export class FanartSource extends ImageSourceAdapter {
  constructor(env, request, tmdb) {
    super(env, request);
    this.tmdb = tmdb;
  }

  status() {
    return (this.env.FANART_API_KEY || this.env.FANART_CLIENT_KEY)
      ? { enabled: true }
      : { enabled: false, reason: "Fanart.tv API key не настроен" };
  }

  async search(identity) {
    if (!identity) return [];
    if (!this.env.FANART_API_KEY && !this.env.FANART_CLIENT_KEY) {
      throw new ImageSourceError("Fanart.tv API key не настроен.", 503, "not_configured");
    }

    let endpoint;
    let sourceUrl = "https://fanart.tv/";
    if (identity.mediaType === "movie") {
      endpoint = "https://webservice.fanart.tv/v3.2/movies/" + identity.tmdbId;
      sourceUrl = "https://fanart.tv/movie/" + identity.tmdbId + "/";
    } else {
      const external = await this.tmdb.externalIds(identity);
      const tvdbId = external.tvdb_id;
      if (!tvdbId) throw new ImageSourceError("Fanart.tv: для сериала не найден TheTVDB ID.", 404, "missing_external_id");
      endpoint = "https://webservice.fanart.tv/v3.2/tv/" + tvdbId;
      sourceUrl = "https://fanart.tv/series/" + tvdbId + "/";
    }

    const headers = { Accept: "application/json" };
    if (this.env.FANART_API_KEY) headers["api-key"] = this.env.FANART_API_KEY;
    if (this.env.FANART_CLIENT_KEY) headers["client-key"] = this.env.FANART_CLIENT_KEY;
    const cacheKey = "fanart:" + endpoint;
    const data = await cachedJson(cacheKey, 1800, async () => {
      const response = await fetch(endpoint, { headers });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw sourceErrorMessage("Fanart.tv", response, body);
      return body;
    });

    const assets = [];
    for (const [key, value] of Object.entries(data || {})) {
      if (!Array.isArray(value)) continue;
      const type = fanartType(key);
      if (!type) continue;
      for (const item of value) {
        if (!item?.url) continue;
        const width = Number(item.width) || null;
        const height = Number(item.height) || null;
        const original = String(item.url).replace(/^http:/, "https:");
        const preview = original + "/preview";
        assets.push(baseAsset(
          this.request,
          identity,
          "Fanart.tv",
          key + "-" + (item.id || assets.length),
          type,
          original,
          preview,
          {
            width,
            height,
            language: item.lang,
            voteAverage: Number(item.likes) || null,
            sourceUrl,
            mimeType: /\.png(\?|$)/i.test(original) ? "image/png" : "image/jpeg",
            isTextless: item.lang === "00"
          }
        ));
      }
    }
    return assets;
  }
}

export class WikimediaSource extends ImageSourceAdapter {
  async search(identity, query, year) {
    const search = [query, year, "film"].filter(Boolean).join(" ");
    const url = new URL("https://commons.wikimedia.org/w/api.php");
    Object.entries({
      action: "query",
      generator: "search",
      gsrsearch: search,
      gsrnamespace: "6",
      gsrlimit: "18",
      prop: "imageinfo",
      iiprop: "url|size|mime|extmetadata",
      iiurlwidth: "640",
      format: "json",
      origin: "*"
    }).forEach(([k,v]) => url.searchParams.set(k, v));

    const data = await cachedJson("commons:" + search.toLowerCase(), 900, async () => {
      const response = await fetch(url, { headers: { "User-Agent": "Freedom-Poster-Editor/1.0 (Wikimedia Commons source adapter)" } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw sourceErrorMessage("Wikimedia Commons", response, body);
      return body;
    });

    const pages = Object.values(data?.query?.pages || {});
    return pages.flatMap(page => {
      const info = page.imageinfo?.[0];
      if (!info?.url || !/^image\/(jpeg|png|webp|gif)$/i.test(info.mime || "")) return [];
      const meta = info.extmetadata || {};
      const license = stripHtml(meta.LicenseShortName?.value || meta.UsageTerms?.value || "");
      const attribution = stripHtml(meta.Credit?.value || meta.Artist?.value || "");
      return [baseAsset(
        this.request,
        identity,
        "Wikimedia Commons",
        page.pageid,
        "still",
        String(info.url).replace(/^http:/, "https:"),
        String(info.thumburl || info.url).replace(/^http:/, "https:"),
        {
          title: clean(page.title).replace(/^File:/i, ""),
          width: info.width,
          height: info.height,
          sourceUrl: info.descriptionurl || "https://commons.wikimedia.org/wiki/" + encodeURIComponent(page.title),
          mimeType: info.mime,
          license,
          attribution,
          isTextless: null
        }
      )];
    });
  }
}

export class TVmazeSource extends ImageSourceAdapter {
  async search(identity, query) {
    const q = clean(query);
    const data = await cachedJson("tvmaze:" + q.toLowerCase(), 600, async () => {
      const response = await fetch("https://api.tvmaze.com/search/shows?q=" + encodeURIComponent(q), {
        headers: { "User-Agent": "Freedom-Poster-Editor/1.0" }
      });
      const body = await response.json().catch(() => []);
      if (response.status === 429) throw new ImageSourceError("TVmaze: превышен лимит API.", 429, "rate_limit");
      if (!response.ok) throw new ImageSourceError("TVmaze временно недоступен.", 502, "provider_error");
      return body;
    });

    return (data || []).slice(0, 10).flatMap(({ show }) => {
      const original = show?.image?.original || show?.image?.medium;
      if (!original) return [];
      const itemIdentity = identity || {
        title: show.name,
        year: yearOf(show.premiered),
        mediaType: "tv",
        tmdbId: null
      };
      return [baseAsset(
        this.request,
        itemIdentity,
        "TVmaze",
        show.id,
        "poster",
        String(original).replace(/^http:/, "https:"),
        String(show.image?.medium || original).replace(/^http:/, "https:"),
        {
          sourceUrl: show.url,
          title: show.name,
          year: yearOf(show.premiered),
          mimeType: "image/jpeg",
          isTextless: null
        }
      )];
    });
  }
}

export function referenceSources(query, year) {
  const term = [clean(query), clean(year)].filter(Boolean).join(" ");
  const q = encodeURIComponent(term);
  return [
    {
      id: "kinorium",
      name: "Kinorium",
      mode: "external",
      url: "https://ru.kinorium.com/search/?q=" + q,
      reason: "Публичный официальный API изображений не используется; авторизацию и anti-bot не обходим."
    },
    {
      id: "cinematerial",
      name: "CineMaterial",
      mode: "external",
      url: "https://www.cinematerial.com/search?q=" + q,
      reason: "Оригиналы могут требовать кредиты; новые бесплатные API keys сейчас не выдаются."
    },
    {
      id: "moviestillsdb",
      name: "MovieStillsDB",
      mode: "external",
      url: "https://www.moviestillsdb.com/search?query=" + q,
      reason: "Публичный документированный API для текущей интеграции не найден."
    },
    {
      id: "shotdeck",
      name: "ShotDeck",
      mode: "external",
      url: "https://shotdeck.com/",
      reason: "Reference-поиск; подписку и скачивание не автоматизируем."
    },
    {
      id: "theposterdb",
      name: "The Poster Database",
      mode: "external",
      url: "https://theposterdb.com/search?term=" + q,
      reason: "Используется как внешний источник, пока нет подтверждённого API для этой интеграции."
    },
    {
      id: "imdb",
      name: "IMDb",
      mode: "external",
      url: "https://www.imdb.com/find/?q=" + q,
      reason: "Официальный IMDb API является отдельным лицензируемым продуктом; публичные datasets не дают media gallery."
    },
    {
      id: "impawards",
      name: "IMP Awards",
      mode: "external",
      url: "https://www.impawards.com/",
      reason: "Внешняя reference-база; scraping не используется."
    },
    {
      id: "wikimedia",
      name: "Wikimedia Commons",
      mode: "automatic",
      url: "https://commons.wikimedia.org/w/index.php?search=" + q + "&title=Special:MediaSearch&type=image",
      reason: "Автоматический поиск идёт через официальный MediaWiki API и сохраняет license/attribution metadata."
    }
  ];
}

export function imageProviderStatus(env) {
  const tmdb = tmdbConfigured(env);
  return {
    tmdb: {
      enabled: tmdb,
      configured: tmdb,
      reason: tmdb ? null : "TMDB API key не настроен"
    },
    fanart: {
      enabled: !!(env.FANART_API_KEY || env.FANART_CLIENT_KEY),
      configured: !!(env.FANART_API_KEY || env.FANART_CLIENT_KEY),
      reason: (env.FANART_API_KEY || env.FANART_CLIENT_KEY) ? null : "Fanart.tv API key не настроен"
    },
    wikimedia: { enabled: true, configured: true, reason: null },
    tvmaze: { enabled: true, configured: true, reason: null }
  };
}

export async function searchUnifiedImages(request, env, { query, year = "", source = "all", tmdbId = "", mediaType = "" }) {
  const q = clean(query);
  if (q.length < 2) throw new ImageSourceError("Запрос должен содержать минимум 2 символа.", 400, "bad_query");
  if (year && !/^\d{4}$/.test(String(year))) throw new ImageSourceError("Год должен содержать 4 цифры.", 400, "bad_year");

  const tmdb = new TMDBSource(env, request);
  const fanart = new FanartSource(env, request, tmdb);
  const wikimedia = new WikimediaSource(env, request);
  const tvmaze = new TVmazeSource(env, request);
  const requested = source === "all" ? new Set(["tmdb","fanart","wikimedia","tvmaze"]) : new Set([source]);
  const errors = [];
  let identity = null;
  let candidates = [];

  if (requested.has("tmdb") || requested.has("fanart")) {
    const status = tmdb.status();
    if (status.enabled) {
      try {
        const resolved = await tmdb.resolve(q, year, tmdbId, mediaType);
        identity = resolved.identity;
        candidates = resolved.candidates || [];
        if (!identity) errors.push({ source: "TMDB", code: "not_found", message: "TMDB: фильм или сериал не найден." });
      } catch (error) {
        errors.push({ source: "TMDB", code: error.code || "provider_error", message: error.message });
      }
    } else {
      errors.push({ source: "TMDB", code: "not_configured", message: status.reason + "." });
    }
  }

  const jobs = [];
  if (requested.has("tmdb")) {
    if (identity) jobs.push(tmdb.search(identity).catch(error => { errors.push({ source: "TMDB", code: error.code || "provider_error", message: error.message }); return []; }));
  }
  if (requested.has("fanart")) {
    const status = fanart.status();
    if (!status.enabled) errors.push({ source: "Fanart.tv", code: "not_configured", message: status.reason + "." });
    else if (!identity) errors.push({ source: "Fanart.tv", code: "missing_tmdb_identity", message: "Fanart.tv: нужен TMDB ID, но фильм/сериал не удалось определить." });
    else jobs.push(fanart.search(identity).catch(error => { errors.push({ source: "Fanart.tv", code: error.code || "provider_error", message: error.message }); return []; }));
  }
  if (requested.has("wikimedia")) {
    jobs.push(wikimedia.search(identity, q, year).catch(error => { errors.push({ source: "Wikimedia Commons", code: error.code || "provider_error", message: error.message }); return []; }));
  }
  if (requested.has("tvmaze")) {
    jobs.push(tvmaze.search(identity, q).catch(error => { errors.push({ source: "TVmaze", code: error.code || "provider_error", message: error.message }); return []; }));
  }

  const groups = await Promise.all(jobs);
  const seen = new Set();
  const priority = { "TMDB": 0, "Fanart.tv": 1, "Wikimedia Commons": 2, "TVmaze": 3 };
  const results = groups.flat().filter(item => {
    if (!item?.originalUrl || seen.has(item.originalUrl)) return false;
    seen.add(item.originalUrl);
    return true;
  }).sort((a,b) => {
    const pa = priority[a.source] ?? 9, pb = priority[b.source] ?? 9;
    if (pa !== pb) return pa - pb;
    const va = Number(a.voteAverage) || 0, vb = Number(b.voteAverage) || 0;
    return vb - va;
  }).slice(0, 240);

  return {
    identity,
    candidates,
    results,
    references: referenceSources(q, year),
    providers: imageProviderStatus(env),
    errors
  };
}

function assertSafeImageUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new ImageSourceError("Некорректный URL изображения.", 400, "bad_url"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new ImageSourceError("Разрешены только HTTPS URL без credentials и нестандартного порта.", 403, "forbidden_source");
  }
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":")) {
    throw new ImageSourceError("Private / IP hosts запрещены.", 403, "ssrf_blocked");
  }
  if (!ALLOWED_IMAGE_HOSTS.has(host)) {
    throw new ImageSourceError("Источник изображения не входит в allowlist.", 403, "forbidden_source");
  }
  return url;
}

async function fetchImageFollowingAllowedRedirects(url, signal) {
  let current = assertSafeImageUrl(url.toString());
  for (let i = 0; i < 4; i++) {
    const response = await fetch(current.toString(), {
      redirect: "manual",
      signal,
      headers: {
        "User-Agent": "Freedom-Poster-Editor/1.0",
        Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif"
      }
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new ImageSourceError("Источник вернул redirect без Location.", 502, "bad_redirect");
      current = assertSafeImageUrl(new URL(location, current).toString());
      continue;
    }
    return response;
  }
  throw new ImageSourceError("Слишком много redirects.", 502, "redirect_loop");
}

export async function secureImageProxy(request, urlString) {
  const url = assertSafeImageUrl(urlString);
  const cache = globalThis.caches?.default;
  const cacheKey = new Request(url.toString(), { method: "GET" });
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set("Access-Control-Allow-Origin", "*");
      return new Response(cached.body, { status: cached.status, headers });
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), PROXY_TIMEOUT_MS);
  try {
    const response = await fetchImageFollowingAllowedRedirects(url, controller.signal);
    if (!response.ok) throw new ImageSourceError("Не удалось получить оригинал изображения (" + response.status + ").", 502, "image_fetch_failed");
    const type = clean(response.headers.get("content-type")).split(";")[0].toLowerCase();
    if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(type)) {
      throw new ImageSourceError("Источник вернул не изображение.", 415, "bad_content_type");
    }
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > MAX_IMAGE_BYTES) throw new ImageSourceError("Изображение больше 25 МБ.", 413, "image_too_large");
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw new ImageSourceError("Изображение больше 25 МБ.", 413, "image_too_large");

    const headers = new Headers({
      "Content-Type": type,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff"
    });
    const out = new Response(bytes, { status: 200, headers });
    if (cache) await cache.put(cacheKey, out.clone());
    return out;
  } catch (error) {
    if (error?.name === "AbortError" || String(error).includes("timeout")) {
      throw new ImageSourceError("Источник изображения не ответил вовремя.", 504, "timeout");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
