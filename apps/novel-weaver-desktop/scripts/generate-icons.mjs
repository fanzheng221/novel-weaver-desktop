import { execFileSync } from "node:child_process";
import { copyFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = join(root, "public/app-icon.svg");
const output = join(root, "src-tauri/icons");
// Regenerate every existing platform variant from the same brand source.
execFileSync(
  process.execPath,
  [join(root, "node_modules/@tauri-apps/cli/tauri.js"), "icon", source, "--output", output],
  { cwd: root, stdio: "inherit" },
);
await copyFile(source, join(output, "app-icon.svg"));
console.log("Application icons synchronized from public/app-icon.svg");
