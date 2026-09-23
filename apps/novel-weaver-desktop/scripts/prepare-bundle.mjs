// 生产打包准备：把 local-core 打成单文件 CJS，原生依赖外置并复制进 Tauri resources。
// 产物：src-tauri/resources/{novel-weaver-local-core.cjs, migrations/, node_modules/<native pkgs>}
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { checkPrivateCore } from "../../../scripts/private-core.mjs";
import { collectLicenses } from "../../../scripts/collect-licenses.mjs";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, realpathSync, rmSync, lstatSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const privateCore = checkPrivateCore();
const require = createRequire(import.meta.url);
const resourcesDir = resolve(import.meta.dirname, "../src-tauri/resources");
const resolveBase = resolve(import.meta.dirname, "../../../packages/novel-weaver-core");

// Native modules must be built with the same Node ABI and target architecture.
if (Number(process.versions.node.split(".")[0]) !== 22 || Number(process.versions.node.split(".")[1]) < 18) {
  throw new Error("生产打包需要 Node 22.18+（22.x），请先切换 Node 并重新安装原生依赖。");
}
if (process.env.TAURI_ENV_ARCH && process.env.TAURI_ENV_ARCH !== process.arch &&
    !(process.env.TAURI_ENV_ARCH === "aarch64" && process.arch === "arm64") &&
    !(process.env.TAURI_ENV_ARCH === "x86_64" && process.arch === "x64")) {
  throw new Error("请在目标架构上打包，不能复制主机 Node 和原生模块用于交叉编译。");
}
if (process.platform === "darwin") {
  const links = execFileSync("/usr/bin/otool", ["-L", process.execPath], { encoding: "utf8" }).split("\n").slice(1).filter((line) => line.trim());
  if (links.some((line) => !/^\s+\/(System\/Library|usr\/lib)\//.test(line))) {
    throw new Error("Node 依赖本机动态库，请使用 nodejs.org 官方独立发行版打包。");
  }
}
// 官方发行版的 LICENSE：unix/macOS 在可执行文件上一级，Windows 与 node.exe 同级。
const nodeDir = dirname(process.execPath);
const nodeLicense = [join(nodeDir, "../LICENSE"), join(nodeDir, "LICENSE")].find((p) => existsSync(p));
if (!nodeLicense) throw new Error("Node 发行版缺少 LICENSE，请使用官方发行版打包。");

rmSync(resourcesDir, { recursive: true, force: true });
mkdirSync(join(resourcesDir, "node_modules"), { recursive: true });
const runtimeDir = join(resourcesDir, "runtime");
mkdirSync(runtimeDir, { recursive: true });
const bundledNode = join(runtimeDir, process.platform === "win32" ? "node.exe" : "node");
cpSync(process.execPath, bundledNode);
cpSync(nodeLicense, join(runtimeDir, "NODE-LICENSE.txt"));

await build({
  entryPoints: [resolve(import.meta.dirname, "../local-core/cli.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: false,
  outfile: join(resourcesDir, "novel-weaver-local-core.cjs"),
  // 原生模块不可打包，随 resources/node_modules 分发。
  external: ["better-sqlite3", "@zvec/zvec"],
});

// 迁移 SQL：CJS 包内 import.meta 不可用，桌面壳经 NOVEL_WEAVER_MIGRATIONS_DIR 指到这里。
cpSync(
  resolve(import.meta.dirname, "../../../packages/novel-weaver-core/src/storage/migrations"),
  join(resourcesDir, "migrations"),
  { recursive: true },
);

/** 定位 pnpm 虚拟商店中该包所属的 node_modules（内含包本体与全部传递依赖）。 */
function vendorNodeModulesOf(name) {
  const entry = require.resolve(name, { paths: [resolveBase] });
  let cursor = realpathSync(findPkgRoot(dirname(entry)));
  while (basename(cursor) !== "node_modules") {
    const parent = dirname(cursor);
    if (parent === cursor) throw new Error(`在 ${entry} 上方找不到 node_modules`);
    cursor = parent;
  }
  return cursor;
}

function findPkgRoot(dir) {
  let cursor = dir;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(cursor, "package.json"))) return cursor;
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  throw new Error(`找不到 ${dir} 的包根`);
}

for (const name of ["better-sqlite3", "@zvec/zvec"]) {
  try {
    const vendor = vendorNodeModulesOf(name);
    cpSync(vendor, join(resourcesDir, "node_modules"), { recursive: true, dereference: true });
  } catch (error) {
    if (name === "better-sqlite3") throw error;
    console.log(`${name} 复制失败（可选依赖可忽略）：${error.message}`);
  }
}

/** 把残留的符号链接替换为真实文件副本；悬空链接（可选依赖）直接移除。 */
function materializeSymlinks(root) {
  for (const entryName of readdirSync(root)) {
    const path = join(root, entryName);
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) {
      let real;
      try {
        real = realpathSync(path);
      } catch {
        // 悬空链接：可选依赖未安装，直接移除。
        console.log(`移除悬空符号链接：${path}`);
        rmSync(path);
        continue;
      }
      rmSync(path);
      cpSync(real, path, { recursive: true });
    } else if (stats.isDirectory()) {
      materializeSymlinks(path);
    }
  }
}
materializeSymlinks(join(resourcesDir, "node_modules"));

// Verify the packaged runtime + mandatory native dependency without the user's PATH.
execFileSync(bundledNode, ["-e", "const Database = require('better-sqlite3'); const db = new Database(':memory:'); db.exec('SELECT 1'); db.close();"], {
  cwd: resourcesDir, env: { ...process.env, PATH: "", NODE_PATH: join(resourcesDir, "node_modules") },
  stdio: "inherit",
});

writeFileSync(join(resourcesDir, "core-build.json"), JSON.stringify({
  version: privateCore.version,
  sourceSha256: privateCore.sourceSha256,
  bundleSha256: createHash("sha256").update(readFileSync(join(resourcesDir, "novel-weaver-local-core.cjs"))).digest("hex"),
  nodeVersion: process.version,
  platform: process.platform,
  arch: process.arch,
}, null, 2) + "\n");

console.log(`resources 就绪：${resourcesDir}`);
collectLicenses(resolve(import.meta.dirname, "../../.."));
