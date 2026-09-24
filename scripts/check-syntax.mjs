import fs from "node:fs";
import { spawnSync } from "node:child_process";
const files = [".", "scripts", "tests", "worker"].flatMap((dir) =>
  fs
    .readdirSync(dir)
    .filter((n) => /\.(js|mjs)$/.test(n))
    .map((n) => dir + "/" + n),
);
for (const file of files) {
  const r = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
  });
  if (r.status !== 0) {
    process.stderr.write(r.stderr);
    process.exit(1);
  }
}
console.log(`Syntax check passed: ${files.length} files.`);
