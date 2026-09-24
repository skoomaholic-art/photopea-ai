import fs from "node:fs";
import path from "node:path";
import {publicFiles} from "./runtime-files.mjs";

// Ship only runtime assets. Never publish the whole repository or server files.
const files = publicFiles(process.cwd());
const allowed = new Set([...files, ".nojekyll"]);
if (fs.existsSync("dist"))
  for (const name of fs.readdirSync("dist", { recursive: true }))
    if (
      fs.statSync(path.join("dist", name)).isFile() &&
      !allowed.has(name.replaceAll(path.sep, "/"))
    )
      throw new Error(
        "Unexpected file in dist: " + name + ". Review it before building.",
      );
for (const file of files) {
  fs.mkdirSync(path.dirname(path.join("dist", file)), { recursive: true });
  fs.copyFileSync(file, path.join("dist", file));
}
fs.writeFileSync("dist/.nojekyll", "");
console.log(
  `Static build: ${files.length + 1} allowlisted files in dist. No API server or secrets included.`,
);
