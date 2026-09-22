import fs from "node:fs";

const read = file => fs.readFileSync(file, "utf8");
const html = read("index.html");
const app = read("poster-app.js");
const train = read("train-editor.js");
const worker = read("worker/ai-worker.js");
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
  'data-workspace="photopea"',
  "Показать постеры",
  "Удалить фон выбранного изображения",
  "Скачать вертикальный постер",
  "Скачать горизонтальный постер",
  "Скачать всё",
  "Скачать выбранный размер",
  "Скачать все размеры"
]);

requireAll("poster independent state", app, [
  "posters: { vertical: makePosterState(), horizontal: makePosterState() }",
  "renderPosterBlob",
  "downloadBothPosters",
  "/api/posters?q=",
  "/api/remove-background",
  "saveAutosave",
  "restoreProject"
]);

requireAll("train master canvas", train, [
  "const MASTER_W = 2952",
  "const MASTER_H = 366",
  "const SEG_W = 492",
  "const SEG_H = 366",
  "createSegmentBlob",
  "exportAllSizes",
  "canvas.toJSON",
  "canvas.loadFromJSON",
  "object:moving",
  "object:scaling",
  "applyCrop"
]);

for (const sticker of [
  "Без стикера","Премьера","Новые серии","Жаңа сериялар","Новый сезон","Жаңа маусым",
  "Все серии","Барлық сериялар","Новинка","Жаңа","Эксклюзив","Скоро…","Жуырда…",
  "Скоро уйдёт","Көріп үлгер"
]) {
  if (!html.includes(sticker)) throw new Error("Sticker missing: " + sticker);
}

for (const folder of ["1 - 164x122","2 - 246x183","3 - 328x244","4 - 492x366"]) {
  if (!train.includes(folder)) throw new Error("Train export folder missing: " + folder);
}

requireAll("secure worker", worker, [
  "env.XAI_API_KEY",
  "env.OPENAI_API_KEY",
  "env.CARVE_API_KEY",
  "env.REMOVAL_AI_KEY",
  "env.TMDB_BEARER_TOKEN",
  'env.TMDB_COMMERCIAL_APPROVED === "true"',
  "https://api.x.ai/v1/images/edits",
  "https://api.openai.com/v1/images/edits",
  "https://api.tvmaze.com/search/shows",
  "https://api.carve.photos/api/v1/images/remove_bg",
  "https://api.removal.ai/3.0/remove"
]);

requireAll("zip store", zip, [
  "0x04034b50",
  "0x02014b50",
  "0x06054b50",
  "crc32",
  "application/zip"
]);

requireAll("app icon", icon, ["<svg", "#8cf06b", "aria-label"]);

for (const forbidden of ["XAI_API_KEY", "OPENAI_API_KEY", "CARVE_API_KEY", "REMOVAL_AI_KEY", "TMDB_BEARER_TOKEN", "Rm-Token", "sk-"]) {
  if (html.includes(forbidden) || app.includes(forbidden) || train.includes(forbidden)) {
    throw new Error("Client bundle contains forbidden secret marker: " + forbidden);
  }
}

console.log("Feature contract passed.");
