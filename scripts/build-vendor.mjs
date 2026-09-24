import { build } from "esbuild";
import fs from "node:fs";
await build({
  stdin: {
    contents: 'export { writePsd, readPsd } from "ag-psd";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: "iife",
  globalName: "PSD",
  outfile: "assets/psd.js",
  minify: true,
  legalComments: "eof",
  platform: "browser",
});
fs.writeFileSync(
  "assets/PSD-LICENSES.txt",
  ["ag-psd", "base64-js", "pako"]
    .map(
      (name) =>
        `${name}\n${fs.readFileSync("node_modules/" + name + "/LICENSE", "utf8")}`,
    )
    .join("\n\n"),
);

fs.copyFileSync("node_modules/fabric/dist/index.min.js", "assets/fabric.js");
fs.copyFileSync("node_modules/fabric/LICENSE", "assets/FABRIC-LICENSE.txt");
