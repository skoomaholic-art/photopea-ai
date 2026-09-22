import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();
const read = p => fs.readFileSync(path.join(root,p),"utf8");

const required = [
  "index.html",
  "poster-app.css",
  "poster-app.js",
  "THIRD_PARTY_LICENSES.md",
  "docs/CANVAS_ENGINE_DECISION.md"
];

for (const file of required) {
  if (!fs.existsSync(path.join(root,file))) {
    throw new Error("Missing required file: " + file);
  }
}

const html = read("index.html");
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
if (duplicates.length) {
  throw new Error("Duplicate DOM ids: " + [...new Set(duplicates)].join(", "));
}

const idSet = new Set(ids);
const localScripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)]
  .map(m => m[1])
  .filter(src => !/^https?:\/\//.test(src));
const jsFiles = localScripts;
const missingIds = new Set();

for (const file of jsFiles) {
  const code = read(file);
  new vm.Script(code, { filename: file });
  for (const match of code.matchAll(/\$\("([^"]+)"\)/g)) {
    if (!idSet.has(match[1])) missingIds.add(match[1]);
  }
}

if (missingIds.size) {
  throw new Error("JavaScript references missing DOM ids: " + [...missingIds].join(", "));
}

for (const src of localScripts) {
  if (!fs.existsSync(path.join(root,src))) {
    throw new Error("Missing local script referenced by index.html: " + src);
  }
}

console.log("Static smoke check passed.");
console.log("DOM ids:", ids.length);
console.log("Local scripts:", localScripts.join(", "));
