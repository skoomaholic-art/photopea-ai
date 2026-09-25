import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFUlEQVR4nGP8z8DwnwEJMDGgAcICAIPRAgYCkO9YAAAAAElFTkSuQmCC", "base64");
const PNG_DATA = "data:image/png;base64," + PNG.toString("base64");
const API = "https://skoomaholic.alexandr-petrossov.workers.dev";

async function mockStatus(page, extra = {}) {
  await page.route("**/api/health", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      apiVersion: "2026-09-23-runtime-v4",
      providers: { cloudflare: true, xai: true, openai: true },
      background: { local: true, carve: true, removal: true },
      posters: { tvmaze: true, tmdb: true },
      images: {
        tmdb: { enabled: true, configured: true },
        fanart: { enabled: true, configured: true },
        wikimedia: { enabled: true, configured: true },
        tvmaze: { enabled: true, configured: true }
      },
      ...extra
    })
  }));
}

function remoteItem(overrides = {}) {
  return {
    id: "tmdb-movie-238-poster",
    source: "TMDB",
    sourceId: "movie-238-poster",
    sourceUrl: "https://www.themoviedb.org/movie/238",
    originalUrl: "https://image.tmdb.org/t/p/original/test.jpg",
    proxyUrl: API + "/api/images/proxy?url=" + encodeURIComponent("https://image.tmdb.org/t/p/original/test.jpg"),
    thumbnailUrl: API + "/api/images/proxy?url=" + encodeURIComponent("https://image.tmdb.org/t/p/w342/test.jpg"),
    title: "The Godfather",
    year: "1972",
    mediaType: "movie",
    tmdbId: 238,
    imageType: "poster",
    width: 2000,
    height: 3000,
    aspectRatio: 2 / 3,
    shape: "vertical",
    resolutionClass: "2k",
    language: null,
    isTextless: true,
    voteAverage: 5.4,
    mimeType: "image/jpeg",
    ...overrides
  };
}

async function mockUnifiedSearch(page, items, errors = []) {
  await page.route("**/api/images/search?*", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      identity: { tmdbId: 238, mediaType: "movie", title: "The Godfather", year: "1972" },
      results: items,
      references: [
        { id: "shotdeck", name: "ShotDeck", mode: "external", url: "https://shotdeck.com/", reason: "reference only" }
      ],
      providers: {},
      errors
    })
  }));
  await page.route("**/api/images/proxy?*", route => route.fulfill({
    status: 200,
    contentType: "image/png",
    body: PNG
  }));
}

async function mockPhotopea(page) {
  const psd=await readFile(new URL('../assets/psd.js',import.meta.url),'utf8');
  const fake = '<!doctype html><html><body><script>'+psd+'<\/script><script>' +
    'let docW=800,docH=1200,layerCount=0,layerNames=[];'  +
    'function size(buffer){try{const b=new Uint8Array(buffer);if(b.length>24&&b[0]===137&&b[1]===80&&b[2]===78&&b[3]===71){const v=new DataView(buffer);return [v.getUint32(16),v.getUint32(20)];}}catch(e){}return [800,1200];}' +
    'addEventListener("message",async event=>{' +
      'if(event.data instanceof ArrayBuffer){const b=new Uint8Array(event.data);if(b[0]===56&&b[1]===66){const d=PSD.readPsd(event.data,{skipLayerImageData:true,skipCompositeImageData:true});docW=d.width;docH=d.height;layerNames=d.children.map(l=>l.name);}else [docW,docH]=size(event.data);parent.postMessage("done","*");return;}' +
      'if(typeof event.data==="string"){' +
        'const m=event.data.match(/POSTER_LAYERED_MODEL:([^*]+)\\*\\//);if(m){try{const meta=JSON.parse(decodeURIComponent(m[1]));docW=meta.width;docH=meta.height;layerCount=meta.layers.length;layerNames=meta.layers.map(l=>l.name);parent.postMessage("POSTER_LAYERED_READY:"+meta.workspace+":"+docW+"x"+docH+":"+layerCount,"*");}catch(e){}}' +
        'if(event.data.includes("psd:true")){const b=PSD.writePsd({width:docW,height:docH,children:layerNames.map(name=>({name}))});parent.postMessage(b,"*",[b]);parent.postMessage("done","*");return;}' +
        'if(event.data.includes("saveToOE")){' +
          'const c=document.createElement("canvas");c.width=docW;c.height=docH;const x=c.getContext("2d");x.fillStyle="#173823";x.fillRect(0,0,docW,docH);x.fillStyle="#fff";x.fillRect(0,0,Math.min(40,docW),Math.min(40,docH));' +
          'c.toBlob(async blob=>{const buffer=await blob.arrayBuffer();parent.postMessage(buffer,"*",[buffer]);parent.postMessage("done","*");},"image/png");return;' +
        '}' +
        'parent.postMessage("done","*");return;' +
      '}' +
    '});parent.postMessage("done","*");' +
    '<\/script></body></html>';

  await page.route("https://www.photopea.com/**", route => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: fake
  }));
}


function pngSize(buffer) {
  if (buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("Not a PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function zipEntries(buffer) {
  const entries = [];
  let offset = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const dataStart = nameStart + nameLength + extraLength;
    entries.push({ name, data: buffer.subarray(dataStart, dataStart + compressedSize) });
    offset = dataStart + compressedSize;
  }
  return entries;
}

async function openSearch(page, title = "The Godfather", year = "1972") {
  await page.locator("#posterSearchInput").fill(title);
  await page.locator("#posterSearchYear").fill(year);
  await page.locator("#posterSearchBtn").click();
  await expect(page.locator("#sourceBrowserModal")).toBeVisible();
}

test("boots existing four-workspace Poster Editor with unified tools", async ({ page }) => {
  await mockStatus(page);
  await page.goto("/");
  await expect(page.locator(".brand strong")).toHaveText("Poster Editor");
  await expect(page.locator(".workspace-tab")).toHaveCount(5);
  await expect(page.locator('[data-workspace="photopea"]')).toHaveCount(1);
  await expect(page.locator("#posterWorkspace")).toBeVisible();
  await expect(page.locator("#posterSearchBtn")).toHaveText("Показать постеры");
  await expect(page.locator("#filterSelectedBtn")).toHaveText("Фильтры");
  await expect(page.locator("#editSelectedPhotopeaBtn")).toContainText("Photopea");
  await expect(page.locator("#generateBtn")).toBeEnabled();
  await expect(page.locator("#removeBackgroundBtn")).toBeEnabled();
});

test("TEST 1 TMDB movie poster to Vertical through proxy", async ({ page }) => {
  await mockStatus(page);
  await mockUnifiedSearch(page, [remoteItem()]);
  let proxyRequests = 0;
  page.on("request", request => {
    if (request.url().includes("/api/images/proxy")) proxyRequests++;
  });
  await page.goto("/");
  await openSearch(page);
  await expect(page.locator(".source-card")).toHaveCount(1);
  await page.locator(".source-card").getByRole("button", { name: "Использовать" }).click();
  await expect(page.locator("#sourceBrowserModal")).toBeHidden();
  await expect(page.locator("#posterImage")).toBeVisible();
  const state = await page.evaluate(() => window.PosterApp.getState().vertical);
  expect(state.posterAssetId).toBeTruthy();
  expect(state.posterName).toBe("The Godfather");
  expect(proxyRequests).toBeGreaterThan(0);
});

test("TEST 2 TMDB backdrop to Horizontal", async ({ page }) => {
  await mockStatus(page);
  await mockUnifiedSearch(page, [remoteItem({
    id: "tmdb-backdrop",
    sourceId: "backdrop",
    imageType: "backdrop",
    width: 3840,
    height: 2160,
    aspectRatio: 16 / 9,
    shape: "horizontal",
    resolutionClass: "4k",
    originalUrl: "https://image.tmdb.org/t/p/original/backdrop.jpg",
    proxyUrl: API + "/api/images/proxy?url=x",
    thumbnailUrl: API + "/api/images/proxy?url=y"
  })]);
  await page.goto("/");
  await page.locator('[data-workspace="horizontal"]').click();
  await openSearch(page);
  await page.getByRole("button", { name: "ГОРИЗОНТАЛЬНЫЕ" }).click();
  await expect(page.locator(".source-card")).toHaveCount(1);
  await page.locator(".source-card").getByRole("button", { name: "Использовать" }).click();
  await expect(page.locator("#sourceBrowserModal")).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.PosterApp.getState().horizontal.posterAssetId)).toBeTruthy();
  await expect(page.locator("#stageMeta")).toContainText("1920 × 1080");
});

test("TEST 3 Fanart textless artwork to Horizontal", async ({ page }) => {
  await mockStatus(page);
  await mockUnifiedSearch(page, [remoteItem({
    id: "fanart-bg",
    source: "Fanart.tv",
    sourceId: "moviebackground-1",
    imageType: "backdrop",
    width: 3000,
    height: 1688,
    aspectRatio: 1.777,
    shape: "horizontal",
    language: null,
    isTextless: true,
    originalUrl: "https://assets.fanart.tv/fanart/test.jpg",
    proxyUrl: API + "/api/images/proxy?url=fanart-original",
    thumbnailUrl: API + "/api/images/proxy?url=fanart-preview"
  })]);
  await page.goto("/");
  await page.locator('[data-workspace="horizontal"]').click();
  await openSearch(page);
  await page.getByRole("button", { name: "TEXTLESS" }).click();
  await expect(page.locator(".source-card")).toHaveCount(1);
  await expect(page.locator(".source-card")).toContainText("Fanart.tv");
  await page.locator(".source-card").getByRole("button", { name: "Использовать" }).click();
  await expect(page.locator("#sourceBrowserModal")).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.PosterApp.getState().horizontal.posterAssetId)).toBeTruthy();
});

test("multiple TMDB matches are selectable before choosing artwork", async ({ page }) => {
  await mockStatus(page);
  const candidates = [
    { tmdbId: 238, mediaType: "movie", title: "Крёстный отец", originalTitle: "The Godfather", year: "1972" },
    { tmdbId: 999, mediaType: "tv", title: "Крёстный отец: сериал", originalTitle: "The Godfather Series", year: "1972" }
  ];
  let selectedRequest = false;
  await page.route("**/api/images/search?*", route => {
    const url = new URL(route.request().url());
    const selected = url.searchParams.get("tmdbId") === "999";
    if (selected) selectedRequest = true;
    const identity = selected ? candidates[1] : candidates[0];
    const item = remoteItem({
      id: selected ? "tmdb-tv-999-poster" : "tmdb-movie-238-poster",
      sourceId: selected ? "tv-999-poster" : "movie-238-poster",
      title: identity.title,
      mediaType: identity.mediaType,
      tmdbId: identity.tmdbId
    });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ identity, candidates, results: [item], references: [], providers: {}, errors: [] })
    });
  });
  await page.route("**/api/images/proxy?*", route => route.fulfill({ status: 200, contentType: "image/png", body: PNG }));

  await page.goto("/");
  await openSearch(page, "Крестный отец", "1972");
  await expect(page.locator("#sourceCandidates")).toBeVisible();
  await expect(page.locator(".source-candidate")).toHaveCount(2);
  await page.locator(".source-candidate").filter({ hasText: "сериал" }).click();
  await expect.poll(() => selectedRequest).toBe(true);
  await expect(page.locator("#sourceSearchStatus")).toContainText("Крёстный отец: сериал");
  await expect(page.locator(".source-candidate.active")).toContainText("сериал");
});

test("TEST 4 filters Cinematic plus manual Contrast survive export", async ({ page }) => {
  await mockStatus(page);
  await page.goto("/");
  await page.locator("#posterFileInput").setInputFiles({ name: "filter.png", mimeType: "image/png", buffer: PNG });
  const before = await page.evaluate(() => window.PosterApp.getState().vertical.poster);
  await page.locator("#filterSelectedBtn").click();
  await expect(page.locator("#filterModal")).toBeVisible();
  await page.getByRole("button", { name: "Cinematic", exact: true }).click();
  await page.locator('[data-filter-range="contrast"]').evaluate(el => {
    el.value = "31";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator('[data-filter-number="contrast"]')).toHaveValue("31");
  await page.locator("#filterApplyBtn").click();
  await expect(page.locator("#filterModal")).toBeHidden();
  const after = await page.evaluate(() => window.PosterApp.getState().vertical.poster);
  expect(after).toMatch(/^data:image\/png;base64,/);
  expect(after).not.toBe(before);

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#downloadVerticalBtn").click();
  const download = await downloadPromise;
  expect(pngSize(await readFile(await download.path()))).toEqual({ width: 800, height: 1200 });
});

test("vertical and horizontal states stay independent", async ({ page }) => {
  await mockStatus(page);
  await page.goto("/");
  await page.locator("#posterFileInput").setInputFiles({ name: "vertical.png", mimeType: "image/png", buffer: PNG });
  await page.locator("#posterLockInput").uncheck();
  await page.locator("#layerScaleInput").fill("135");
  await page.locator("#layerRotationInput").fill("17");
  await page.locator("#posterLayerUpBtn").click();

  await page.locator('[data-workspace="horizontal"]').click();
  await page.locator("#posterFileInput").setInputFiles({ name: "horizontal.png", mimeType: "image/png", buffer: PNG });
  await page.locator("#posterLockInput").uncheck();
  await page.locator("#layerScaleInput").fill("165");
  await page.locator("#layerRotationInput").fill("-8");

  const states = await page.evaluate(() => window.PosterApp.getState());
  expect(states.vertical.posterName).toBe("vertical.png");
  expect(states.vertical.posterScale).toBe(135);
  expect(states.vertical.posterRotation).toBe(17);
  expect(states.vertical.order).toEqual(["logo", "poster"]);
  expect(states.horizontal.posterName).toBe("horizontal.png");
  expect(states.horizontal.posterScale).toBe(165);
  expect(states.horizontal.posterRotation).toBe(-8);
  expect(states.vertical.posterAssetId).toBeTruthy();
  expect(states.horizontal.posterAssetId).toBeTruthy();
});

test("background removal preserves transform", async ({ page }) => {
  await mockStatus(page);
  await page.route("**/api/remove-background", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ image: PNG_DATA, provider: "Carve.Photos" })
  }));
  await page.goto("/");
  await page.locator("#posterFileInput").setInputFiles({ name: "safe.png", mimeType: "image/png", buffer: PNG });
  await page.locator("#posterLockInput").uncheck();
  await page.locator("#layerScaleInput").fill("145");
  await page.locator("#layerRotationInput").fill("11");
  await page.locator("#bgProviderSelect").selectOption("carve");
  await page.locator("#removeBackgroundBtn").click();
  await expect(page.locator("#bgRemoveStatus")).toContainText("Положение и трансформация сохранены");
  const state = await page.evaluate(() => window.PosterApp.getState().vertical);
  expect(state.posterScale).toBe(145);
  expect(state.posterRotation).toBe(11);
});

test("TEST 5 Vertical Photopea return routes automatically Vertical", async ({ page }) => {
  await mockStatus(page);
  await mockPhotopea(page);
  await page.goto("/");
  await page.locator("#posterFileInput").setInputFiles({ name: "vertical.png", mimeType: "image/png", buffer: PNG });
  await page.locator("#posterLockInput").uncheck();
  await page.locator("#editPosterPhotopeaBtn").click();
  await expect(page.locator("#photopeaWorkspace")).toBeVisible();
  await expect(page.locator("#photopeaStatus")).toContainText(/Photopea готов|Документ передан|Многослойный документ открыт/);
  await expect(page.locator("#sendPhotopeaVerticalBtn")).toBeVisible();
  await expect(page.locator("#sendPhotopeaHorizontalBtn")).toBeVisible();
  await expect(page.locator("#sendPhotopeaTrainBtn")).toBeVisible();
  await expect(page.locator("#sendPhotopeaAutoBtn")).toBeVisible();
  await page.locator("#sendPhotopeaVerticalBtn").click();
  await expect(page.locator("#posterWorkspace")).toBeVisible();
  await expect(page.locator('[data-workspace="vertical"]')).toHaveClass(/active/);
  expect((await page.evaluate(() => window.PosterApp.getState().vertical)).poster).toMatch(/^data:image\/png;base64,/);
});

test("TEST 6 Horizontal Photopea return routes automatically Horizontal", async ({ page }) => {
  await mockStatus(page);
  await mockPhotopea(page);
  await page.goto("/");
  await page.locator('[data-workspace="horizontal"]').click();
  await page.locator("#posterFileInput").setInputFiles({ name: "horizontal.png", mimeType: "image/png", buffer: PNG });
  await page.locator("#posterLockInput").uncheck();
  await page.locator("#editPosterPhotopeaBtn").click();
  await expect(page.locator("#photopeaWorkspace")).toBeVisible();
  await page.locator("#sendPhotopeaHorizontalBtn").click();
  await expect(page.locator('[data-workspace="horizontal"]')).toHaveClass(/active/);
  expect((await page.evaluate(() => window.PosterApp.getState().horizontal)).poster).toMatch(/^data:image\/png;base64,/);
});

test("TEST 7 Parovozik Photopea return routes automatically train", async ({ page }) => {
  await mockStatus(page);
  await mockPhotopea(page);
  await page.goto("/");
  await page.locator('[data-workspace="train"]').click();
  await page.waitForFunction(() => !!window.TrainEditor);
  await expect(page.locator("#trainBadgeSelect")).toHaveCount(0);
  await page.locator("#trainEditPhotopeaBtn").click();
  await expect(page.locator("#photopeaWorkspace")).toBeVisible();
  await page.locator("#sendPhotopeaTrainBtn").click();
  await expect(page.locator("#trainWorkspace")).toBeVisible();
  const inspect = await page.evaluate(() => window.TrainEditor.inspect());
  expect(inspect.masterSize).toEqual({ width: 2952, height: 366 });
  expect(inspect.objectCount).toBeGreaterThan(0);
});

test("TEST 8 nonstandard Photopea ratio asks destination", async ({ page }) => {
  await mockStatus(page);
  await page.goto("/");
  expect(await page.evaluate(() => window.PhotopeaBridge.classifyDimensions(1000, 1000))).toBeNull();

  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 100; canvas.height = 100;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0,0,100,100);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    window.__routePromise = window.PhotopeaBridge.routeBlob(blob, { width: 1000, height: 1000 });
  });
  await expect(page.locator("#routeModal")).toBeVisible();
  await page.locator('[data-route-target="vertical"]').click();
  await expect.poll(() => page.evaluate(async () => window.__routePromise ? await window.__routePromise : null)).toBe("vertical");
  await expect(page.locator('[data-workspace="vertical"]')).toHaveClass(/active/);
});

test("TEST 9 missing keys do not crash and are surfaced", async ({ page }) => {
  await mockStatus(page, {
    providers: { cloudflare: false, xai: false, openai: false },
    providerDetails: {
      cloudflare: { status: "not_configured" },
      xai: { status: "not_configured" },
      openai: { status: "not_configured" }
    },
    background: { local: true, carve: false, removal: false },
    images: {
      tmdb: { enabled: false, configured: false, reason: "TMDB API key не настроен" },
      fanart: { enabled: false, configured: false, reason: "Fanart.tv API key не настроен" },
      wikimedia: { enabled: true, configured: true },
      tvmaze: { enabled: true, configured: true }
    }
  });
  await mockUnifiedSearch(page, [remoteItem({ source: "TVmaze", id: "tvmaze-1" })], [
    { source: "TMDB", code: "not_configured", message: "TMDB API key не настроен." },
    { source: "Fanart.tv", code: "not_configured", message: "Fanart.tv API key не настроен." }
  ]);
  await page.goto("/");
  await expect(page.locator("#generateBtn")).toBeDisabled();
  await expect(page.locator("#removeBackgroundBtn")).toBeEnabled();
  await expect(page.locator("#bgRemoveStatus")).toContainText("Локальное удаление фона готово");
  await openSearch(page, "Test Show", "2026");
  await expect(page.locator("#sourceSearchStatus")).toContainText("TMDB API key не настроен");
  await expect(page.locator(".source-card")).toHaveCount(1);
});

test("TEST 10 remote CORS image is imported through backend proxy", async ({ page }) => {
  await mockStatus(page);
  const item = remoteItem({
    originalUrl: "https://image.tmdb.org/t/p/original/cors-test.jpg",
    proxyUrl: API + "/api/images/proxy?url=" + encodeURIComponent("https://image.tmdb.org/t/p/original/cors-test.jpg"),
    thumbnailUrl: API + "/api/images/proxy?url=" + encodeURIComponent("https://image.tmdb.org/t/p/w342/cors-test.jpg")
  });
  let importedOriginal = false;
  await page.route("**/api/images/search?*", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ identity: null, results: [item], references: [], providers: {}, errors: [] })
  }));
  await page.route("**/api/images/proxy?*", route => {
    if (decodeURIComponent(route.request().url()).includes("original/cors-test.jpg")) importedOriginal = true;
    return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
  });
  await page.goto("/");
  await openSearch(page, "CORS Test", "2026");
  await page.locator(".source-card").getByRole("button", { name: "Использовать" }).click();
  await expect(page.locator("#sourceBrowserModal")).toBeHidden();
  await expect(page.locator("#posterImage")).toBeVisible();
  expect(importedOriginal).toBe(true);
});

test("TEST 11 repeated Poster Photopea Poster cycle remains PNG and usable", async ({ page }) => {
  await mockStatus(page);
  await mockPhotopea(page);
  await page.goto("/");
  await page.locator("#posterFileInput").setInputFiles({ name: "cycle.png", mimeType: "image/png", buffer: PNG });

  for (let i = 0; i < 2; i++) {
    await page.locator("#editPosterPhotopeaBtn").click();
    await expect(page.locator("#photopeaWorkspace")).toBeVisible();
    await page.locator("#sendPhotopeaVerticalBtn").click();
    await expect(page.locator("#posterWorkspace")).toBeVisible();
  }

  const state = await page.evaluate(() => window.PosterApp.getState().vertical);
  expect(state.poster).toMatch(/^data:image\/png;base64,/);
  expect(state.posterAssetId).toBeTruthy();
});

test("SVG stickers still work and Parovozik exports exact 24 PNG", async ({ page }) => {
  await mockStatus(page);
  await page.goto("/");
  await page.locator('[data-workspace="train"]').click();
  await page.waitForFunction(() => !!window.TrainEditor);

  await page.locator("#stickerSummary").click();
  await page.getByRole("button", {name:"Премьера",exact:true}).click();
  await expect.poll(() => page.evaluate(() => window.TrainEditor.inspect().sticker?.text)).toBe("Премьера");
  const inspect = await page.evaluate(() => window.TrainEditor.inspect());
  expect(inspect.sticker.asset).toContain("assets/stickers/premiere.svg");
  expect(inspect.sticker.left + inspect.sticker.width).toBeLessThanOrEqual(492.5);
  expect(inspect.sticker.top + inspect.sticker.height).toBeLessThanOrEqual(366.5);

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#trainDownloadAllBtn").click();
  const download = await downloadPromise;
  const entries = zipEntries(await readFile(await download.path()));
  expect(entries).toHaveLength(24);
  const expected = [];
  const folders = ["1 - 164x122", "2 - 246x183", "3 - 328x244", "4 - 492x366"];
  for (const folder of folders) for (let part = 1; part <= 6; part++) expected.push(folder + "/part_" + part + ".png");
  expect(entries.map(x => x.name)).toEqual(expected);
});

test("autosave survives reload with asset-backed poster and sticker", async ({ page }) => {
  await mockStatus(page);
  await page.goto("/");
  await page.locator("#posterFileInput").setInputFiles({ name: "remember.png", mimeType: "image/png", buffer: PNG });
  await page.locator('[data-workspace="train"]').click();
  await page.locator("#stickerSummary").click();
  await page.getByRole("button", {name:"Жаңа маусым",exact:true}).click();
  await page.waitForTimeout(1200);

  await page.reload();
  await page.waitForFunction(() => !!window.PosterApp && !!window.TrainEditor);
  await page.waitForTimeout(500);
  const posterState = await page.evaluate(() => window.PosterApp.getState());
  expect(posterState.vertical.posterName).toBe("remember.png");
  expect(posterState.vertical.posterAssetId).toBeTruthy();
  await page.locator('[data-workspace="train"]').click();
  expect((await page.evaluate(() => window.TrainEditor.inspect())).sticker?.text).toBe("Жаңа маусым");
});


test("logo close buttons remove logos in poster, train and TOP10 without breaking Photopea access", async ({ page }) => {
  await mockStatus(page);
  await mockPhotopea(page);
  await page.goto("/");

  await page.locator("#logoFileInput").setInputFiles({ name:"poster-logo.png", mimeType:"image/png", buffer:PNG });
  await expect(page.locator("#logoImage")).toBeVisible();
  await expect(page.locator("#removePosterLogoBtn")).toBeEnabled();
  await page.locator("#removePosterLogoBtn").click();
  await expect(page.locator("#logoImage")).toBeHidden();
  expect((await page.evaluate(() => window.PosterApp.getState().vertical.logo))).toBeNull();

  await page.locator('[data-workspace="horizontal"]').click();
  await page.locator("#logoFileInput").setInputFiles({ name:"horizontal-logo.png", mimeType:"image/png", buffer:PNG });
  await page.locator("#removePosterLogoBtn").click();
  expect((await page.evaluate(() => window.PosterApp.getState().horizontal.logo))).toBeNull();

  await page.locator('[data-workspace="train"]').click();
  await page.locator("#trainLogoInput").setInputFiles({ name:"train-logo.png", mimeType:"image/png", buffer:PNG });
  await expect(page.locator("#removeTrainLogoBtn")).toBeEnabled();
  await page.locator("#removeTrainLogoBtn").click();
  await expect(page.locator("#removeTrainLogoBtn")).toBeDisabled();

  await page.locator('[data-workspace="top10"]').click();
  await page.locator("#top10LogoInput").setInputFiles({ name:"top10-logo.png", mimeType:"image/png", buffer:PNG });
  await expect(page.locator("#removeTop10LogoBtn")).toBeEnabled();
  await page.locator("#removeTop10LogoBtn").click();
  expect((await page.evaluate(() => window.Top10Editor.getState().logo))).toBeNull();

  await page.locator('[data-workspace="vertical"]').click();
  await page.locator("#posterFileInput").setInputFiles({ name:"poster.png", mimeType:"image/png", buffer:PNG });
  await page.locator("#editPosterPhotopeaBtn").click();
  await expect(page.locator("#photopeaWorkspace")).toBeVisible();
  await expect(page.locator("#sendPhotopeaVerticalBtn")).toBeVisible();
});

test("TOP10 master canvas, locked template, filters, export, Photopea routing and persistence work", async ({ page }) => {
  await mockStatus(page);
  await mockPhotopea(page);
  await page.goto("/");
  await page.locator('[data-workspace="top10"]').click();
  await page.waitForFunction(() => !!window.Top10Editor);

  const initial = await page.evaluate(() => window.Top10Editor.inspect());
  expect(initial.masterSize).toEqual({ width: 800, height: 1400 });
  expect(initial.backingSize).toEqual({ width: 800, height: 1400 });
  expect(initial.layers).toEqual(["TOP_NUMBER","LOGO","BOTTOM_DARKENING","BACKGROUND_IMAGE"]);
  expect(initial.darkening.locked).toBe(true);
  expect(initial.darkening.selectable).toBe(false);
  expect(initial.number.locked).toBe(true);
  expect(initial.number.selectable).toBe(false);

  const jpgBase64 = await page.evaluate(() => {
    const c=document.createElement("canvas"); c.width=80; c.height=140;
    const ctx=c.getContext("2d"); ctx.fillStyle="#456789"; ctx.fillRect(0,0,c.width,c.height);
    return c.toDataURL("image/jpeg",0.9).split(",")[1];
  });
  await page.locator("#top10BackgroundInput").setInputFiles({
    name:"top10.jpg", mimeType:"image/jpeg", buffer:Buffer.from(jpgBase64,"base64")
  });
  await expect.poll(() => page.evaluate(() => !!window.Top10Editor.getState().background)).toBe(true);

  await page.locator("#top10LogoInput").setInputFiles({ name:"logo.png", mimeType:"image/png", buffer:PNG });
  await expect.poll(() => page.evaluate(() => !!window.Top10Editor.getState().logo)).toBe(true);

  await page.locator(".top10-layer-row").filter({hasText:"TOP10 Number"}).click();
  await page.locator("#top10PositionSelect").selectOption("2");
  let inspect = await page.evaluate(() => window.Top10Editor.inspect());
  expect(inspect.state.ranking).toBe("2");
  expect(inspect.number.bounds.top).toBeGreaterThanOrEqual(900);
  expect(inspect.number.bounds.bottom).toBeLessThanOrEqual(1400);

  await page.locator("#top10PositionSelect").selectOption("10");
  inspect = await page.evaluate(() => window.Top10Editor.inspect());
  expect(inspect.state.ranking).toBe("10");
  expect(inspect.number.bounds.left).toBeGreaterThanOrEqual(0);
  expect(inspect.number.bounds.left + inspect.number.bounds.width).toBeLessThanOrEqual(800);

  await page.locator(".top10-layer-row").filter({hasText:"Bottom Darkening"}).click();
  const darkBefore = await page.evaluate(() => window.Top10Editor.inspect().darkening);
  await page.mouse.move(400,700); await page.mouse.down(); await page.mouse.move(500,800); await page.mouse.up();
  const darkAfter = await page.evaluate(() => window.Top10Editor.inspect().darkening);
  expect({left:darkAfter.left,top:darkAfter.top}).toEqual({left:darkBefore.left,top:darkBefore.top});
  await page.locator("#top10DarkColor").fill("#112233");
  await expect.poll(() => page.evaluate(() => window.Top10Editor.getState().darkeningColor)).toBe("#112233");

  await page.locator(".top10-layer-row").filter({hasText:"TOP10 Number"}).click();
  await page.locator("#top10PositionSelect").selectOption("7");
  await expect.poll(() => page.evaluate(() => window.Top10Editor.inspect().number.asset)).toContain("assets/top10/numbers/7.svg");
  await page.locator("#top10PositionSelect").selectOption("10");
  await expect.poll(() => page.evaluate(() => window.Top10Editor.inspect().number.asset)).toContain("assets/top10/numbers/10.svg");

  await page.locator(".top10-layer-row").filter({hasText:"Background Image"}).click();
  const unaffectedBefore = await page.evaluate(() => {
    const s=window.Top10Editor.getState();
    return {logo:s.logo,ranking:s.ranking,darkeningColor:s.darkeningColor};
  });
  await page.locator("#top10FilterBtn").click();
  await expect(page.locator("#filterModal")).toBeVisible();
  await page.locator('[data-filter-number="contrast"]').fill("25");
  await page.locator('[data-filter-number="temperature"]').fill("-20");
  await page.locator("#filterApplyBtn").click();
  await expect(page.locator("#filterModal")).toBeHidden();
  const afterFilter = await page.evaluate(() => window.Top10Editor.getState());
  expect(afterFilter.backgroundFilters.contrast).toBe(25);
  expect(afterFilter.backgroundFilters.temperature).toBe(-20);
  expect({logo:afterFilter.logo,ranking:afterFilter.ranking,darkeningColor:afterFilter.darkeningColor}).toEqual(unaffectedBefore);

  const dlPromise = page.waitForEvent("download");
  await page.locator("#top10DownloadBtn").click();
  const dl = await dlPromise;
  expect(dl.suggestedFilename()).toBe("top10.png");
  expect(pngSize(await readFile(await dl.path()))).toEqual({ width:800, height:1400 });

  expect((await page.evaluate(() => window.PhotopeaBridge.classifyDimensions(800,1400))).target).toBe("top10");
  await page.evaluate(async () => {
    const c=document.createElement("canvas"); c.width=800; c.height=1400;
    c.getContext("2d").fillRect(0,0,800,1400);
    const blob=await new Promise(resolve=>c.toBlob(resolve,"image/png"));
    await window.PhotopeaBridge.routeBlob(blob,{width:800,height:1400},"top10");
  });
  await expect(page.locator("#top10Workspace")).toBeVisible();

  await page.locator("#top10EditPhotopeaBtn").click();
  await expect(page.locator("#photopeaWorkspace")).toBeVisible();
  await expect(page.locator("#sendPhotopeaTop10Btn")).toBeVisible();
  await page.locator("#sendPhotopeaTop10Btn").click();
  await expect(page.locator("#top10Workspace")).toBeVisible();
  await expect(page.locator('[data-workspace="top10"]')).toHaveClass(/active/);
  await expect(page.locator("#photopeaStatus")).toContainText("800×1400");
  expect((await page.evaluate(() => window.Top10Editor.getState().background))).toMatch(/^data:image\/png;base64,/);
  if (await page.evaluate(() => window.Top10Editor.getState().photopeaComposite)) {
    await page.locator("#top10ResetClassicBtn").click();
    await page.locator("#resetConfirmOkBtn").click();
  }

  await page.locator(".top10-layer-row").filter({hasText:"TOP10 Number"}).click();
  await page.locator("#top10PositionSelect").selectOption("7");
  await page.locator(".top10-layer-row").filter({hasText:"Bottom Darkening"}).click();
  await page.locator("#top10DarkIntensity").fill("81");
  await page.waitForTimeout(900);
  await page.reload();
  await page.waitForFunction(() => !!window.Top10Editor && !!window.PosterApp);
  await page.locator('[data-workspace="top10"]').click();
  const restored = await page.evaluate(() => window.Top10Editor.getState());
  expect(restored.ranking).toBe("7");
  expect(restored.darkeningIntensity).toBe(81);
});


test("numeric range inputs stay synchronized and clamp values", async ({ page }) => {
  await mockStatus(page);
  await page.goto("/");
  await page.locator("#posterFileInput").setInputFiles({ name: "scale.png", mimeType: "image/png", buffer: PNG });
  await page.locator("#posterLockInput").uncheck();
  const number = page.locator('[data-range-number-for="layerScaleInput"]');
  await expect(number).toBeVisible();
  await page.locator("#layerScaleInput").fill("120");
  await expect(number).toHaveValue("120");
  await number.fill("150");
  await expect(page.locator("#layerScaleInput")).toHaveValue("150");
  await number.fill("9999");
  await expect(page.locator("#layerScaleInput")).toHaveValue("300");
  await page.locator('[data-workspace="top10"]').click();
  const darkNumber=page.locator('[data-range-number-for="top10DarkIntensity"]');
  await expect(darkNumber).toHaveValue("94");
  await darkNumber.fill("71");
  await expect(page.locator("#top10DarkIntensity")).toHaveValue("71");
});

test("Work Archive creates immutable versions and restores bundled poster assets and transforms", async ({ page }) => {
  await mockStatus(page);
  await page.goto("/");
  await page.locator("#posterFileInput").setInputFiles({ name:"archive-source.png", mimeType:"image/png", buffer:PNG });
  await page.locator("#posterLockInput").uncheck();

  const scaleNumber=page.locator('[data-range-number-for="layerScaleInput"]');
  await scaleNumber.fill("125");
  const d1=page.waitForEvent("download");
  await page.locator("#downloadVerticalBtn").click();
  await d1;
  await expect.poll(() => page.evaluate(async()=> (await WorkArchive.list("vertical")).length)).toBe(1);

  await scaleNumber.fill("175");
  const d2=page.waitForEvent("download");
  await page.locator("#downloadVerticalBtn").click();
  await d2;
  await expect.poll(() => page.evaluate(async()=> (await WorkArchive.list("vertical")).length)).toBe(2);

  const versions=await page.evaluate(async()=>{
    const items=await WorkArchive.list("vertical");
    return items.map(x=>({id:x.archiveId,scale:x.projectState.posterScale,assetCount:x.assets?.length||0}));
  });
  expect(versions.map(x=>x.scale).sort((a,b)=>a-b)).toEqual([125,175]);
  expect(versions.every(x=>x.assetCount>=1)).toBe(true);

  const firstId=versions.find(x=>x.scale===125).id;
  await page.evaluate(async id=>{
    const entry=await SkoomaStore.getArchiveEntry(id);
    await WorkArchive.restoreEntry(entry);
  },firstId);
  await expect.poll(()=>page.evaluate(()=>PosterApp.getState().vertical.posterScale)).toBe(125);
  expect(await page.evaluate(()=>!!PosterApp.getState().vertical.poster)).toBe(true);
});

test("workspace reset is confirmed and does not delete archive versions", async ({ page }) => {
  await mockStatus(page);
  await page.goto("/");
  await page.locator("#posterFileInput").setInputFiles({ name:"archive.png", mimeType:"image/png", buffer:PNG });
  const downloadPromise=page.waitForEvent("download");
  await page.locator("#downloadVerticalBtn").click();
  await downloadPromise;
  await expect.poll(() => page.evaluate(async () => (await window.WorkArchive.list("vertical")).length)).toBeGreaterThan(0);
  await page.locator("#posterResetWorkspaceBtn").click();
  await expect(page.locator("#resetConfirmModal")).toBeVisible();
  await page.locator("#resetConfirmCancelBtn").click();
  expect((await page.evaluate(() => window.PosterApp.getState().vertical.poster))).toBeTruthy();
  await page.locator("#posterResetWorkspaceBtn").click();
  await page.locator("#resetConfirmOkBtn").click();
  await expect.poll(() => page.evaluate(() => window.PosterApp.getState().vertical.poster)).toBeNull();
  expect(await page.evaluate(async () => (await window.WorkArchive.list("vertical")).length)).toBeGreaterThan(0);
  await page.locator("#posterArchiveBtn").click();
  await expect(page.locator("#archiveModal")).toBeVisible();
  await expect(page.locator(".archive-item")).toHaveCount(1);
});

test("Parovozik selected object exposes Scale and Rotation sliders with numeric precision", async ({ page }) => {
  await mockStatus(page);
  await page.goto("/");
  await page.locator('[data-workspace="train"]').click();
  await page.locator("#trainImageInput").setInputFiles({ name:"scale.png", mimeType:"image/png", buffer:PNG });
  await expect(page.locator("#trainScaleInput")).toBeEnabled();
  const scaleNumber=page.locator('[data-range-number-for="trainScaleInput"]');
  const rotationNumber=page.locator('[data-range-number-for="trainRotationInput"]');
  await expect(scaleNumber).toBeVisible();
  await expect(rotationNumber).toBeVisible();
  await scaleNumber.fill("150");
  await expect(page.locator("#trainScaleInput")).toHaveValue("150");
  await rotationNumber.fill("22");
  await expect(page.locator("#trainRotationInput")).toHaveValue("22");
});

test("Train and TOP10 reset buttons restore default state after confirmation", async ({ page }) => {
  await mockStatus(page);
  await page.goto("/");
  await page.locator('[data-workspace="train"]').click();
  await page.locator("#trainImageInput").setInputFiles({ name:"train.png", mimeType:"image/png", buffer:PNG });
  await expect.poll(() => page.evaluate(() => window.TrainEditor.inspect().objectCount)).toBeGreaterThan(0);
  await page.locator("#trainResetWorkspaceBtn").click();
  await page.locator("#resetConfirmOkBtn").click();
  await expect.poll(() => page.evaluate(() => window.TrainEditor.inspect().objectCount)).toBe(0);
  await page.locator('[data-workspace="top10"]').click();
  await page.locator("#top10PositionSelect").selectOption("9");
  await page.locator("#top10DarkIntensity").fill("53");
  await page.locator("#top10ResetClassicBtn").click();
  await page.locator("#resetConfirmOkBtn").click();
  await expect.poll(() => page.evaluate(() => window.Top10Editor.getState().ranking)).toBe("2");
  expect((await page.evaluate(() => window.Top10Editor.getState().darkeningIntensity))).toBe(94);
});


test("TOP10 positions 1 through 10 use separate traced vector assets", async ({ page }) => {
  await mockStatus(page);
  await page.goto("/");
  await page.locator('[data-workspace="top10"]').click();
  await page.waitForFunction(() => !!window.Top10Editor);
  for (let value=1; value<=10; value++) {
    await page.locator("#top10PositionSelect").selectOption(String(value));
    await expect.poll(() => page.evaluate(() => window.Top10Editor.inspect().number.asset)).toContain("/"+value+".svg");
    const number=await page.evaluate(() => window.Top10Editor.inspect().number);
    expect(number.locked).toBe(true);
    expect(number.value).toBe(String(value));
    expect(number.bounds.left).toBeGreaterThanOrEqual(0);
    expect(number.bounds.left+number.bounds.width).toBeLessThanOrEqual(800);
    expect(number.bounds.bottom).toBeLessThanOrEqual(1400);
  }
});


test("Photopea main edit uses layered Vertical and Horizontal models", async ({ page }) => {
  await mockStatus(page); await mockPhotopea(page); await page.goto("/");
  await page.locator("#posterFileInput").setInputFiles({name:"poster.png",mimeType:"image/png",buffer:PNG});
  await page.locator("#logoFileInput").setInputFiles({name:"logo.png",mimeType:"image/png",buffer:PNG});
  await page.locator("#editPosterPhotopeaBtn").click();
  await expect(page.locator("#photopeaWorkspace")).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.PhotopeaBridge.getContext()?.layeredReady)).toBeTruthy();
  let ctx=await page.evaluate(()=>window.PhotopeaBridge.getContext());
  expect(ctx.layeredModel.document).toMatchObject({width:800,height:1200});
  expect(ctx.layeredModel.layers.map(x=>x.name)).toEqual(expect.arrayContaining(["Background","Постер","Логотип"]));
  expect(ctx.layeredModel.layers.length).toBeGreaterThanOrEqual(3);
  expect(ctx.composite).toBe(false);
  await page.locator("#sendPhotopeaVerticalBtn").click();
  await expect(page.locator("#posterWorkspace")).toBeVisible();

  await page.locator('[data-workspace="horizontal"]').click();
  await page.locator("#posterFileInput").setInputFiles({name:"h.png",mimeType:"image/png",buffer:PNG});
  await page.locator("#editPosterPhotopeaBtn").click();
  await expect.poll(() => page.evaluate(() => window.PhotopeaBridge.getContext()?.layeredModel?.document?.width)).toBe(1920);
  ctx=await page.evaluate(()=>window.PhotopeaBridge.getContext());
  expect(ctx.layeredModel.document).toMatchObject({width:1920,height:1080});
});

test("Photopea layered script places raster assets as Smart Objects in the master document", async ({ page }) => {
  await mockStatus(page);
  await page.goto("/");
  const script=await page.evaluate(() => window.PhotopeaBridge.buildLayeredScript({
    workspace:"vertical",
    document:{name:"TEST",width:800,height:1200},
    layers:[
      {id:"bg",name:"Background",type:"background",color:"#000000",x:400,y:600,width:800,height:1200,zIndex:0},
      {id:"poster",name:"Poster",type:"image",sourceDataUrl:"data:image/png;base64,AAAA",x:400,y:600,width:800,height:1200,zIndex:1}
    ]
  }));
  expect(script).toContain("app.activeDocument=doc");
  expect(script).toContain("app.open(");
  expect(script).toContain(",null,true);");
  expect(script).toContain("var ly=doc.activeLayer");
  expect(script).not.toContain("__sourceDoc.close(");
});

test("Photopea layered Train keeps images logos and stickers independent", async ({ page }) => {
  await mockStatus(page); await mockPhotopea(page); await page.goto("/");
  await page.locator('[data-workspace="train"]').click();
  await page.locator("#trainImageInput").setInputFiles({name:"image.png",mimeType:"image/png",buffer:PNG});
  await page.locator("#trainLogoInput").setInputFiles({name:"logo.png",mimeType:"image/png",buffer:PNG});
  await page.locator("#stickerSummary").click();
  await page.getByRole("button", {name:"Премьера",exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.TrainEditor.inspect().sticker?.text)).toBe("Премьера");
  await page.locator("#trainEditPhotopeaBtn").click();
  await expect.poll(()=>page.evaluate(()=>window.PhotopeaBridge.getContext()?.layeredReady)).toBeTruthy();
  const ctx=await page.evaluate(()=>window.PhotopeaBridge.getContext());
  expect(ctx.layeredModel.document).toMatchObject({width:2952,height:366});
  const names=ctx.layeredModel.layers.map(x=>x.name);
  expect(names.some(x=>x.startsWith("Image - Segment"))).toBe(true);
  expect(names.some(x=>x.startsWith("Logo - Segment"))).toBe(true);
  expect(names.some(x=>x.startsWith("Sticker - "))).toBe(true);
});

test("Photopea layered TOP10 keeps number logo darkening and background separate", async ({ page }) => {
  await mockStatus(page); await mockPhotopea(page); await page.goto("/");
  await page.locator('[data-workspace="top10"]').click();
  await page.locator("#top10BackgroundInput").setInputFiles({name:"bg.png",mimeType:"image/png",buffer:PNG});
  await page.locator("#top10LogoInput").setInputFiles({name:"logo.png",mimeType:"image/png",buffer:PNG});
  await page.locator("#top10PositionSelect").selectOption("7");
  await page.locator("#top10EditPhotopeaBtn").click();
  await expect.poll(() => page.evaluate(() => !!window.PhotopeaBridge.getContext()?.layeredModel)).toBe(true);
  await expect.poll(()=>page.evaluate(()=>window.PhotopeaBridge.getContext()?.layeredReady)).toBeTruthy();
  const ctx=await page.evaluate(()=>window.PhotopeaBridge.getContext());
  expect(ctx.layeredModel.document).toMatchObject({width:800,height:1400});
  const names=ctx.layeredModel.layers.map(x=>x.name);
  expect(names).toEqual(expect.arrayContaining(["Canvas Background","Background Image","Bottom Darkening","Logo","TOP10 Number"]));
  const number=ctx.layeredModel.layers.find(x=>x.name==="TOP10 Number");
  expect(number.sourceDataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
  expect(Buffer.from(number.sourceDataUrl.split(",")[1], "base64").toString("utf8")).toContain('aria-label="7"');
  expect(number.locked).toBe(true);
  expect(ctx.layeredModel.layers.find(x=>x.name==="Bottom Darkening").locked).toBe(true);
});

test("Photopea return replaces old poster composition and reopens saved layered PSD", async ({ page }) => {
  await mockStatus(page); await mockPhotopea(page); await page.goto("/");
  await page.locator("#posterFileInput").setInputFiles({name:"poster.png",mimeType:"image/png",buffer:PNG});
  await page.locator("#logoFileInput").setInputFiles({name:"logo.png",mimeType:"image/png",buffer:PNG});
  await page.locator("#editPosterPhotopeaBtn").click();
  await page.locator("#sendPhotopeaVerticalBtn").click();
  await expect(page.locator("#posterWorkspace")).toBeVisible();
  const state=await page.evaluate(()=>PosterApp.getState().vertical);
  expect(state.logo).toBeNull();
  expect(state.posterMode).toBe("exact");
  expect(state.photopeaMasterId).toBeTruthy();

  await page.locator("#editPosterPhotopeaBtn").click();
  await expect(page.locator("#photopeaWorkspace")).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>PhotopeaBridge.getContext()?.restoredLayeredMaster===true)).toBe(true);
});

test("Photopea Train and TOP10 returns clear pre-existing editor overlays", async ({ page }) => {
  await mockStatus(page); await mockPhotopea(page); await page.goto("/");

  await page.locator('[data-workspace="train"]').click();
  await page.locator("#trainImageInput").setInputFiles({name:"image.png",mimeType:"image/png",buffer:PNG});
  await page.locator("#trainLogoInput").setInputFiles({name:"logo.png",mimeType:"image/png",buffer:PNG});
  await page.locator("#trainEditPhotopeaBtn").click();
  await page.locator("#sendPhotopeaTrainBtn").click();
  await expect(page.locator("#trainWorkspace")).toBeVisible();
  expect(await page.evaluate(()=>TrainEditor.inspect().objectCount)).toBe(1);
  expect(await page.evaluate(()=>!!TrainEditor.getPhotopeaMasterId())).toBe(true);

  await page.locator('[data-workspace="top10"]').click();
  await page.locator("#top10BackgroundInput").setInputFiles({name:"bg.png",mimeType:"image/png",buffer:PNG});
  await page.locator("#top10LogoInput").setInputFiles({name:"logo.png",mimeType:"image/png",buffer:PNG});
  await page.locator("#top10EditPhotopeaBtn").click();
  await page.locator("#sendPhotopeaTop10Btn").click();
  await expect(page.locator("#top10Workspace")).toBeVisible();
  const top=await page.evaluate(()=>Top10Editor.getState());
  expect(top.photopeaComposite).toBe(true);
  expect(top.logo).toBeNull();
  expect(top.photopeaMasterId).toBeTruthy();
  expect(await page.evaluate(()=>Top10Editor.inspect().layers)).toEqual(["PHOTOPEA_RESULT"]);
});

test("editing after Photopea return invalidates the stale layered master reference", async ({ page }) => {
  await mockStatus(page); await mockPhotopea(page); await page.goto("/");
  await page.locator("#posterFileInput").setInputFiles({name:"poster.png",mimeType:"image/png",buffer:PNG});
  await page.locator("#editPosterPhotopeaBtn").click();
  await page.locator("#sendPhotopeaVerticalBtn").click();
  await expect.poll(()=>page.evaluate(()=>!!PosterApp.getState().vertical.photopeaMasterId)).toBe(true);
  await page.locator("#posterBgInput").fill("#123456");
  await expect.poll(()=>page.evaluate(()=>PosterApp.getState().vertical.photopeaMasterId)).toBeNull();
});

test("Photopea return saves a layered master reference", async ({ page }) => {
  await mockStatus(page); await mockPhotopea(page); await page.goto("/");
  await page.locator("#posterFileInput").setInputFiles({name:"poster.png",mimeType:"image/png",buffer:PNG});
  await page.locator("#editPosterPhotopeaBtn").click();
  await page.locator("#sendPhotopeaVerticalBtn").click();
  await expect(page.locator("#posterWorkspace")).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.PhotopeaBridge.getLayeredMasterId("vertical"))).not.toBeNull();
  const id=await page.evaluate(()=>window.PhotopeaBridge.getLayeredMasterId("vertical"));
  expect(await page.evaluate(async id=>!!(await window.SkoomaStore.getPhotopeaMaster(id)),id)).toBe(true);
});


test("Vertical and Horizontal expose Fabric-style transform handles and persist drag transforms", async ({ page }) => {
  await mockStatus(page); await page.goto("/");
  await page.locator("#posterFileInput").setInputFiles({name:"poster.png",mimeType:"image/png",buffer:PNG});
  await expect(page.locator("#posterTransformOverlay")).toBeVisible();
  await expect(page.locator("#posterTransformOverlay")).toHaveClass(/locked/);
  await page.locator("#posterLockInput").uncheck();
  await expect(page.locator("#posterTransformOverlay .br")).toBeVisible();

  const before=await page.evaluate(()=>window.PosterApp.getState().vertical.posterX);
  const box=await page.locator("#posterImage").boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await page.mouse.down(); await page.mouse.move(box.x+box.width/2+30,box.y+box.height/2+20); await page.mouse.up();
  await expect.poll(()=>page.evaluate(()=>window.PosterApp.getState().vertical.posterX)).not.toBe(before);

  await page.locator('[data-workspace="horizontal"]').click();
  await page.locator("#logoFileInput").setInputFiles({name:"logo.png",mimeType:"image/png",buffer:PNG});
  await page.locator("#posterLayerSelect").selectOption("logo");
  await expect(page.locator("#posterTransformOverlay .br")).toBeVisible();
});
