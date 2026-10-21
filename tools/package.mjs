/**
 * dg-ops.zip for release: the module only (no tests, no pack sources, no tooling).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const { version } = JSON.parse(readFileSync(join(ROOT, "module.json"), "utf8"));
const zip = join(ROOT, "dg-ops.zip");
rmSync(zip, { force: true });
execFileSync("zip", ["-qr", zip, "module.json", "LICENSE", "README.md", "CHANGELOG.md", "assets", "scripts", "styles", "packs", "-x", "packs/_source/*"], { cwd: ROOT, stdio: "inherit" });
console.log(`dg-ops.zip (v${version})`);
