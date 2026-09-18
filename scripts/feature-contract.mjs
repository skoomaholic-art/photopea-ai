import fs from "node:fs";

const read = file => fs.readFileSync(file, "utf8");
const html = read("index.html");
const studio = read("studio.js");
const media = read("media.js");
const app = read("app.js");
const storage = read("storage.js");

function requireAll(label, haystack, needles) {
  const missing = needles.filter(item => !haystack.includes(item));
  if (missing.length) throw new Error(label + " missing: " + missing.join(", "));
}

requireAll("tools", html, [
  'data-tool="move"',
  'data-tool="marquee"',
  'data-tool="lasso"',
  'data-tool="wand"',
  'data-tool="crop"',
  'data-tool="brush"',
  'data-tool="pencil"',
  'data-tool="eraser"',
  'data-tool="fill"',
  'data-tool="eyedropper"',
  'data-tool="text"',
  'data-tool="rect"',
  'data-tool="ellipse"',
  'data-tool="line"',
  'data-tool="pen"',
  'data-tool="node"',
  'data-tool="image"',
  'data-tool="hand"',
  'data-tool="zoom"'
]);

requireAll("editor features", studio, [
  "function startLasso",
  "function magicWandAt",
  "function applyCrop",
  "function applyEraserStroke",
  "function groupSelected",
  "function ungroupSelected",
  "function mergeSelected",
  "function flattenCanvas",
  "function snapObject",
  "function updateRulers",
  "function applyImageFilters",
  "function generateAi",
  "function exportProjectJson",
  "function importProjectJson",
  "function enterNodeEdit"
]);

requireAll("AI models", html, [
  'value="gpt-image-1-mini"',
  'value="grok-imagine-image"'
]);

requireAll("media providers", media, [
  "tvmaze:",
  "omdb:",
  "tmdb:",
  "wikidata:",
  "fanart.tv"
]);

requireAll("external fallbacks", app, [
  'jampea: { name: "Jampea"',
  "externalFallback"
]);

requireAll("storage", storage, [
  '"projects"',
  '"assets"',
  '"cache"',
  "listProjects",
  "listAssets"
]);

requireAll("asset browser", html, [
  'data-kind="recent"',
  'data-kind="media"',
  'id="assetSearch"'
]);

console.log("Feature contract passed.");
