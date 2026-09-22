import fs from "node:fs";

const read = file => fs.readFileSync(file, "utf8");
const html = read("index.html");
const app = read("poster-app.js");

function requireAll(label, haystack, needles) {
  const missing = needles.filter(item => !haystack.includes(item));
  if (missing.length) throw new Error(label + " missing: " + missing.join(", "));
}

requireAll("poster editor UI", html, [
  "Poster Markup",
  "Открыть Photopea",
  "GROK / GPT",
  "posterFileInput",
  "logoFileInput",
  "positionSelect",
  "downloadBtn",
  "generateBtn",
  "moveResultBtn",
  "downloadResultBtn"
]);

requireAll("poster editor behavior", app, [
  "setFormat",
  "exportPoster",
  "generate",
  "pointerdown",
  "grok-imagine-image",
  "gpt-image-1-mini"
]);

console.log("Feature contract passed.");
