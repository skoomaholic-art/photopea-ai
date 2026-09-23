import assert from "node:assert/strict";
import {
  searchUnifiedImages,
  secureImageProxy,
  imageProviderStatus,
  referenceSources
} from "../worker/image-sources.js";

const originalFetch = globalThis.fetch;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

globalThis.fetch = async input => {
  const rawUrl = input instanceof URL ? input.href : (typeof input === "string" ? input : input.url);
  const url = new URL(rawUrl);

  if (url.hostname === "api.themoviedb.org" && url.pathname === "/3/search/movie") {
    return json({ results: [{
      id: 238,
      title: "The Godfather",
      release_date: "1972-03-14",
      popularity: 100,
      overview: "Test"
    }] });
  }
  if (url.hostname === "api.themoviedb.org" && url.pathname === "/3/search/tv") {
    return json({ results: [] });
  }
  if (url.hostname === "api.themoviedb.org" && url.pathname === "/3/movie/238/images") {
    return json({
      posters: [{
        file_path: "/poster.jpg",
        width: 2000,
        height: 3000,
        iso_639_1: null,
        vote_average: 5.5
      }],
      backdrops: [{
        file_path: "/backdrop.jpg",
        width: 3840,
        height: 2160,
        iso_639_1: null,
        vote_average: 5
      }],
      logos: [{
        file_path: "/logo.png",
        width: 1200,
        height: 400,
        iso_639_1: "en",
        vote_average: 4
      }]
    });
  }
  if (url.hostname === "webservice.fanart.tv" && url.pathname === "/v3.2/movies/238") {
    return json({
      movieposter: [{
        id: "11",
        url: "https://assets.fanart.tv/fanart/poster.jpg",
        lang: "en",
        likes: "4",
        width: 1000,
        height: 1500
      }],
      moviebackground: [{
        id: "12",
        url: "https://assets.fanart.tv/fanart/background.jpg",
        lang: "00",
        likes: "12",
        width: 1920,
        height: 1080
      }],
      hdmovielogo: [{
        id: "13",
        url: "https://assets.fanart.tv/fanart/logo.png",
        lang: "en",
        likes: "3",
        width: 800,
        height: 310
      }]
    });
  }
  if (url.hostname === "commons.wikimedia.org") {
    return json({
      query: {
        pages: {
          1: {
            pageid: 1,
            title: "File:Godfather publicity.jpg",
            imageinfo: [{
              url: "https://upload.wikimedia.org/test/original.jpg",
              thumburl: "https://upload.wikimedia.org/test/thumb.jpg",
              descriptionurl: "https://commons.wikimedia.org/wiki/File:Godfather_publicity.jpg",
              width: 2400,
              height: 1600,
              mime: "image/jpeg",
              extmetadata: {
                LicenseShortName: { value: "CC BY-SA 4.0" },
                Artist: { value: "Studio archive" }
              }
            }]
          }
        }
      }
    });
  }
  if (url.hostname === "api.tvmaze.com") {
    return json([{
      show: {
        id: 99,
        name: "The Godfather Saga",
        premiered: "1977-11-12",
        url: "https://www.tvmaze.com/shows/99/test",
        image: {
          medium: "https://static.tvmaze.com/uploads/images/medium_portrait/test.jpg",
          original: "https://static.tvmaze.com/uploads/images/original_untouched/test.jpg"
        }
      }
    }]);
  }

  if (url.hostname === "image.tmdb.org") {
    return new Response(new Uint8Array([137,80,78,71,13,10,26,10]), {
      status: 200,
      headers: { "Content-Type": "image/png", "Content-Length": "8" }
    });
  }

  throw new Error("Unexpected fetch in source test: " + url);
};

try {
  const env = {
    TMDB_ACCESS_TOKEN: "test-token",
    TMDB_COMMERCIAL_APPROVED: "true",
    FANART_API_KEY: "test-fanart"
  };
  const request = new Request("https://example.test/api/images/search?q=The%20Godfather");

  const status = imageProviderStatus(env);
  assert.equal(status.tmdb.enabled, true);
  assert.equal(status.fanart.enabled, true);
  assert.equal(status.wikimedia.enabled, true);
  assert.equal(status.tvmaze.enabled, true);

  const result = await searchUnifiedImages(request, env, {
    query: "The Godfather",
    year: "1972",
    source: "all"
  });

  assert.equal(result.identity.tmdbId, 238);
  assert.equal(result.identity.mediaType, "movie");
  assert.ok(result.results.some(item => item.source === "TMDB" && item.imageType === "poster"));
  assert.ok(result.results.some(item => item.source === "TMDB" && item.imageType === "backdrop" && item.width === 3840));
  assert.ok(result.results.some(item => item.source === "Fanart.tv" && item.isTextless === true));
  assert.ok(result.results.some(item => item.source === "Wikimedia Commons" && item.license === "CC BY-SA 4.0"));
  assert.ok(result.results.some(item => item.source === "TVmaze"));
  assert.ok(result.results.every(item => item.proxyUrl.includes("/api/images/proxy?url=")));

  const refs = referenceSources("The Godfather", "1972");
  for (const source of ["Kinorium","CineMaterial","MovieStillsDB","ShotDeck","The Poster Database","IMDb","IMP Awards"]) {
    assert.ok(refs.some(item => item.name === source), "Missing reference source " + source);
  }

  await assert.rejects(
    () => secureImageProxy(new Request("https://example.test/api/images/proxy"), "http://image.tmdb.org/test.jpg"),
    error => error.code === "forbidden_source"
  );
  await assert.rejects(
    () => secureImageProxy(new Request("https://example.test/api/images/proxy"), "https://127.0.0.1/test.jpg"),
    error => error.code === "ssrf_blocked"
  );
  await assert.rejects(
    () => secureImageProxy(new Request("https://example.test/api/images/proxy"), "https://evil.example/test.jpg"),
    error => error.code === "forbidden_source"
  );

  const proxied = await secureImageProxy(
    new Request("https://example.test/api/images/proxy"),
    "https://image.tmdb.org/t/p/original/test.jpg"
  );
  assert.equal(proxied.status, 200);
  assert.equal(proxied.headers.get("Content-Type"), "image/png");
  assert.equal(proxied.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal((await proxied.arrayBuffer()).byteLength, 8);

  console.log("Image source adapters and secure proxy tests passed.");
} finally {
  globalThis.fetch = originalFetch;
}
