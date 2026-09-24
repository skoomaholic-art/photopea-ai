import fs from "node:fs";
import path from "node:path";
export const runtimeFiles = [
  "index.html", "app-icon.svg", "editor-core.js", "storage.js", "zip-store.js", "asset-manager.js",
  "local-background-removal.js", "image-filters.js", "poster-app.js", "train-editor.js", "top10-editor.js",
  "filter-studio.js", "source-browser.js", "photopea-bridge.js", "range-number-sync.js", "workspace-tools.js",
  "poster-app.css", "poster-overrides.css", "train-app.css",
  // Compatibility files retained for existing bookmarks; the application loads the editor modules above.
  "train-app.js", "top10-app.js",
];
export function publicFiles(root) {
  return [...runtimeFiles, ...fs.readdirSync(path.join(root,"assets"), {recursive:true})
    .filter(name=>/\.(?:js|json|svg|png|txt)$/.test(name) && fs.statSync(path.join(root,"assets",name)).isFile())
    .map(name=>"assets/"+name.replaceAll(path.sep,"/"))];
}
