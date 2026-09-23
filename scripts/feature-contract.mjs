import fs from "node:fs";

const read = file => fs.readFileSync(file, "utf8");
const html = read("index.html");
const app = read("poster-app.js");
const localBackground = read("local-background-removal.js");
const train = read("train-editor.js");
const worker = read("worker/ai-worker.js");
const sources = read("worker/image-sources.js");
const assets = read("asset-manager.js");
const filters = read("image-filters.js");
const filterStudio = read("filter-studio.js");
const sourceBrowser = read("source-browser.js");
const photopea = read("photopea-bridge.js");
const storage = read("storage.js");
const envExample = read(".env.example");
const zip = read("zip-store.js");
const icon = read("app-icon.svg");

function requireAll(label, haystack, needles) {
  const missing = needles.filter(item => !haystack.includes(item));
  if (missing.length) throw new Error(label + " missing: " + missing.join(", "));
}

requireAll("workspace UI", html, [
  'data-workspace="vertical"',
  'data-workspace="horizontal"',
  'data-workspace="train"',
  'data-workspace="top10"',
  "Найти исходник",
  "ПОСТЕРЫ",
  "ГОРИЗОНТАЛЬНЫЕ",
  "КАДРЫ",
  "TEXTLESS",
  "ЛОГОТИПЫ",
  "Фильтры",
  "Редактировать в Photopea",
  "В вертикальный",
  "В горизонтальный",
  "В паровозик",
  ">Авто<",
  "Удалить фон выбранного изображения",
  "Скачать вертикальный постер",
  "Скачать горизонтальный постер",
  "Скачать всё",
  "Скачать выбранный размер",
  "Скачать все размеры"
]);

requireAll("poster state", app, [
  "posters: { vertical: makePosterState(), horizontal: makePosterState() }",
  "renderPosterBlob",
  "downloadBothPosters",
  "/api/remove-background",
  "saveAutosave",
  "restoreProject",
  "POSTER_BLEED = 0.035",
  'EXPECTED_API_VERSION = "2026-09-23-runtime-v4"',
  "posterAssetId",
  "logoAssetId",
  "getSelectedImageContext",
  "attachAssetId",
  "scaleWithWheel",
  "formats"
]);

requireAll("asset manager", assets, [
  "sourceId","sourceUrl","originalUrl","thumbnailUrl","imageType","aspectRatio","isTextless",
  "originalAsset","editedAsset","filters","createdAt","updatedAt",
  "importRemote","updateEdited","ensureContextAsset"
]);

requireAll("indexeddb assets", storage, [
  'createObjectStore("assets"',
  "saveAsset","getAsset","listAssets","getCache","setCache"
]);

for (const preset of [
  "Original","B&W","High Contrast","Cinematic","Cold","Warm","Faded","Vintage","Sepia",
  "Desaturated","Teal & Orange","Dark","Bright","Dramatic","Soft","Sharpen","Grain","Vignette"
]) {
  if (!filters.includes('"' + preset + '"')) throw new Error("Filter preset missing: " + preset);
}

for (const control of [
  "brightness","contrast","exposure","saturation","temperature","tint","highlights","shadows",
  "whites","blacks","hue","blur","sharpen","grain","vignette"
]) {
  if (!filters.includes('"' + control + '"')) throw new Error("Manual filter missing: " + control);
}

requireAll("filter processing", filters, [
  "getImageData","putImageData","ctx.filter","createRadialGradient","renderBlob","image/png"
]);

requireAll("filter studio", filterStudio, [
  "renderPreview","Применяю фильтры в полном разрешении","updateEdited","setImageLayer"
]);

requireAll("source browser", sourceBrowser, [
  "/api/images/search","AssetManager.importRemote","FilterStudio.openAsset","PhotopeaBridge.openAsset",
  "sourceLoadMoreBtn","data-image-tab","resolutionFilter","languageFilter"
]);

requireAll("modular sources", sources, [
  "class ImageSourceAdapter","class TMDBSource","class FanartSource","class WikimediaSource","class TVmazeSource",
  "searchUnifiedImages","referenceSources","secureImageProxy","imageProviderStatus",
  "image.tmdb.org","assets.fanart.tv","upload.wikimedia.org","static.tvmaze.com",
  "MAX_IMAGE_BYTES","PROXY_TIMEOUT_MS","ssrf_blocked","bad_content_type","Cache-Control",
  "FANART_API_KEY"
]);

requireAll("worker routes", worker, [
  '"/api/images/search"','"/api/images/proxy"',
  "searchUnifiedImages","secureImageProxy","imageProviderStatus",
  'apiVersion: "2026-09-23-runtime-v4"',
  "env.OPENROUTER_API_KEY","env.AI.run","cloudflareImageModel","/api/health","env.CARVE_API_KEY","env.REMOVAL_AI_KEY"
]);

requireAll("Photopea round trip", photopea, [
  'PP_ORIGIN="https://www.photopea.com"',
  "ArrayBuffer",
  'saveToOE("png")',
  "classifyDimensions","routeBlob","sendPhotopeaVerticalBtn","sendPhotopeaHorizontalBtn","sendPhotopeaTrainBtn","sendPhotopeaAutoBtn","Photopea не ответил",
  "setBackgroundFromDataUrl","setImageLayer","difference<=0.03"
]);

requireAll("train", train, [
  "const MASTER_W = 2952","const MASTER_H = 366","const SEG_W = 492","const SEG_H = 366",
  "createSegmentBlob","exportAllSizes","canvas.toJSON","canvas.loadFromJSON","object:moving","object:scaling",
  "applyCrop","STICKER_ASSETS","buildStickerAsset","stickerAsset",
  "renderMasterBlob","setBackgroundFromDataUrl","cssOnly: true"
]);

for (const sticker of [
  "Без стикера","Премьера","Новые серии","Жаңа сериялар","Новый сезон","Жаңа маусым",
  "Все серии","Барлық сериалдар","Новинка","Жаңа","Эксклюзив","Скоро...","Жуырда...",
  "Скоро уйдёт","Көріп үлгер"
]) {
  if (!html.includes(sticker)) throw new Error("Sticker missing: " + sticker);
}

for (const asset of [
  "premiere.svg","new-series-ru.svg","new-series-kz.svg","new-season-ru.svg","new-season-kz.svg",
  "all-series-ru.svg","all-series-kz.svg","new-ru.svg","new-kz.svg","exclusive.svg",
  "soon-ru.svg","soon-kz.svg","leaving-soon-ru.svg","leaving-soon-kz.svg"
]) {
  if (!fs.existsSync("assets/stickers/" + asset)) throw new Error("Sticker asset missing: " + asset);
}

for (const folder of ["1 - 164x122","2 - 246x183","3 - 328x244","4 - 492x366"]) {
  if (!train.includes(folder)) throw new Error("Train export folder missing: " + folder);
}

requireAll("env example", envExample, [
  "TMDB_ACCESS_TOKEN=","TMDB_API_KEY=",
  "FANART_API_KEY=","FANART_CLIENT_KEY=","OPENROUTER_API_KEY=","CARVE_API_KEY=","REMOVAL_AI_KEY="
]);

requireAll("local background removal", localBackground, [
  "@imgly/background-removal@1.7.0","model: \"small\"","image/png","progress","LocalBackgroundRemoval"
]);

if (html.includes("trainBadgeSelect")) throw new Error("Duplicate train badge selector must stay removed.");
if (html.includes("Use POST")) throw new Error("Debug placeholder Use POST must not be visible.");

requireAll("zip", zip, ["0x04034b50","0x02014b50","0x06054b50","crc32","application/zip"]);
requireAll("icon", icon, ["<svg","#8cf06b","aria-label"]);

const clientBundle = [html,app,train,sourceBrowser,assets,filters,filterStudio,photopea].join("\n");
for (const forbidden of [
  "TMDB_ACCESS_TOKEN=","TMDB_API_KEY=","FANART_API_KEY=","FANART_CLIENT_KEY=",
  "OPENROUTER_API_KEY=","CARVE_API_KEY=","REMOVAL_AI_KEY=","Rm-Token","sk-proj-","sk-or-v1-"
]) {
  if (clientBundle.includes(forbidden)) throw new Error("Client bundle contains secret marker: " + forbidden);
}

console.log("Feature contract passed.");
console.log("Unified image sources, filters, Asset Manager and Photopea round trip are present.");


const top10 = read("top10-editor.js");
requireAll("TOP10 editor", top10, [
  "const MASTER_W = 800",
  "const MASTER_H = 1400",
  "BACKGROUND_IMAGE",
  "BOTTOM_DARKENING",
  "TOP_NUMBER",
  "renderBlob",
  "openFilters",
  "darkeningIntensity",
  "numberStrokeWidth",
  "logoAboveDarkening"
]);
requireAll("logo close controls", html, [
  "removePosterLogoBtn",
  "removeTrainLogoBtn",
  "removeTop10LogoBtn"
]);

requireAll("TOP10 Photopea routing", read("photopea-bridge.js"), [
  "editTop10",
  'id:"top10"',
  "sendPhotopeaTop10Btn",
  "routeBlob"
]);


if (/data-workspace="photopea"/.test(read("index.html"))) {
  throw new Error("Top Photopea tab must stay removed while embedded Photopea dock/workspace is available");
}
