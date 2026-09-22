import fs from "node:fs";

const read = file => fs.readFileSync(file, "utf8");
const html = read("index.html");
const app = read("poster-app.js");
const worker = read("worker/ai-worker.js");

function requireAll(label, haystack, needles) {
  const missing = needles.filter(item => !haystack.includes(item));
  if (missing.length) throw new Error(label + " missing: " + missing.join(", "));
}

requireAll("poster editor UI", html, [
  "Poster Markup",
  "Photopea",
  "photopeaFrame",
  "GROK / GPT",
  "posterFileInput",
  "logoFileInput",
  "posterLockInput",
  "positionSelect",
  "downloadBtn",
  "generateBtn",
  "moveResultBtn",
  "downloadResultBtn"
]);

requireAll("poster editor behavior", app, [
  "switchWorkspace",
  "setFormat",
  "exportPoster",
  "checkAiServer",
  "/api/status",
  "/api/generate",
  "pointerdown"
]);

requireAll("secure AI worker", worker, [
  "env.XAI_API_KEY",
  "env.OPENAI_API_KEY",
  "grok-imagine-image-2.0",
  "gpt-image-1-mini",
  "https://api.x.ai/v1/images/edits",
  "https://api.openai.com/v1/images/edits"
]);

for (const forbidden of ["js.puter.com", "XAI_API_KEY", "OPENAI_API_KEY", "sk-"]) {
  if (html.includes(forbidden) || app.includes(forbidden)) throw new Error("Client bundle contains forbidden secret/provider marker: " + forbidden);
}

console.log("Feature contract passed.");
