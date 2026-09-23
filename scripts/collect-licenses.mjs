import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const legalName = /^(licen[sc]e|copying|notice|copyright|unlicense|ofl)(?:[._-]|$)/i;
const codeExtension = /\.(?:[cm]?[jt]sx?|rs|[ch](?:pp|xx)?|cc|go|py|json|toml|wasm|node)$/i;
const excludedDirectory = new Set(["node_modules", ".git", "target", "test", "tests"]);
const safeName = (name) => name.replace(/[^A-Za-z0-9._-]/g, "_");
export const escapeHtml = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export function licenseFiles(directory, depth = 0) {
  if (depth > 5) return [];
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isFile() && legalName.test(entry.name) && !codeExtension.test(entry.name)) result.push(path);
    else if (entry.isDirectory() && !excludedDirectory.has(entry.name)) result.push(...licenseFiles(path, depth + 1));
  }
  return result;
}

function packageDirectory(name, from) {
  const lookup = createRequire(join(from, "package.json")).resolve.paths(name) ?? [];
  for (const directory of lookup) {
    const manifest = join(directory, name, "package.json");
    if (existsSync(manifest)) return dirname(realpathSync(manifest));
  }
  throw new Error(`Cannot locate installed dependency ${name}`);
}

export function productionPackages(startDirectories) {
  const packages = new Map();
  const visited = new Set();
  function visit(directory, own = false) {
    directory = realpathSync(directory);
    if (visited.has(directory)) return;
    visited.add(directory);
    const pkg = json(join(directory, "package.json"));
    if (!own && pkg.name !== "novel-weaver-core") packages.set(`${pkg.name}@${pkg.version}`, { pkg, directory });
    const optional = pkg.optionalDependencies ?? {};
    const peers = pkg.peerDependencies ?? {};
    for (const name of Object.keys({ ...pkg.dependencies, ...optional, ...peers }).sort()) {
      const mayBeAbsent = name in optional || pkg.peerDependenciesMeta?.[name]?.optional === true;
      let path;
      try { path = packageDirectory(name, directory); }
      catch (error) { if (mayBeAbsent) continue; throw error; }
      visit(path);
    }
  }
  for (const directory of startDirectories) visit(directory, true);
  return [...packages.values()].sort((a, b) => a.pkg.name.localeCompare(b.pkg.name) || a.pkg.version.localeCompare(b.pkg.version));
}

export function collectLicenses(root) {
  const app = join(root, "apps/novel-weaver-desktop");
  const resources = join(app, "src-tauri/resources");
  const licenses = join(resources, "licenses");
  const overrides = json(join(root, "scripts/license-overrides.json"));
  const records = [];
  mkdirSync(licenses, { recursive: true });

  function add(id, license, source, files, notes = "") {
    const directory = join(licenses, safeName(id));
    mkdirSync(directory, { recursive: true });
    const entries = files.map((file, index) => {
      const bytes = file.bytes ?? readFileSync(file.path);
      const name = `${index + 1}-${safeName(file.name ?? basename(file.path))}`;
      const target = join(directory, name);
      writeFileSync(target, bytes);
      return { file: relative(resources, target).split("\\").join("/"), sha256: digest(bytes), source: file.source ?? source };
    });
    if (!entries.length) throw new Error(`Missing actual license text for ${id}; do not distribute an SPDX identifier alone.`);
    records.push({ id, license, source, notes, files: entries });
  }

  function supplements(id) {
    return (overrides.packages[id] ?? []).map((item) => {
      if (!/^scripts\/license-texts\/[A-Za-z0-9._/-]+$/.test(item.file) || item.file.split("/").includes("..")) throw new Error(`Invalid license override path: ${item.file}`);
      const path = join(root, item.file);
      if (lstatSync(path).isSymbolicLink() || digest(readFileSync(path)) !== item.sha256) throw new Error(`License override checksum mismatch: ${item.file}`);
      return { path, source: item.source };
    });
  }

  for (const name of ["LICENSE", "CORE-LICENSE.txt", "LICENSING.md"]) {
    copyFileSync(join(root, name), join(resources, name));
  }

  for (const { pkg, directory } of productionPackages([app, join(root, "packages/novel-weaver-core")])) {
    const id = `npm:${pkg.name}@${pkg.version}`;
    const files = [...licenseFiles(directory).map((path) => ({ path })), ...supplements(id)];
    if (pkg.name === "better-sqlite3") {
      const header = join(directory, "deps/sqlite3/sqlite3.h");
      const text = readFileSync(header, "utf8").split("*/", 1)[0] + "*/\n";
      if (!text.includes("author disclaims copyright")) throw new Error("SQLite attribution header changed; review it before release.");
      files.push({ name: "SQLite-NOTICE.txt", bytes: Buffer.from(text), source: `https://github.com/WiseLibs/better-sqlite3/tree/v${pkg.version}/deps` });
    }
    add(id, pkg.license ?? "UNKNOWN", `https://www.npmjs.com/package/${pkg.name}/v/${pkg.version}`, files,
      pkg.name === "lxgw-wenkai-webfont" ? "The wrapper is MIT; font files use OFL-1.1. Both texts and font notices apply." : "");
  }

  const target = process.platform === "darwin" && process.arch === "arm64" ? "aarch64-apple-darwin" : null;
  if (!target) throw new Error("License assembly currently supports macOS arm64 only.");
  const metadata = JSON.parse(execFileSync("cargo", ["metadata", "--format-version", "1", "--locked", "--filter-platform", target, "--manifest-path", join(app, "src-tauri/Cargo.toml")], { encoding: "utf8", maxBuffer: 30 * 1024 * 1024 }));
  const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const reachable = new Set();
  function visit(id) {
    if (reachable.has(id)) return;
    reachable.add(id);
    for (const dependency of nodes.get(id)?.deps ?? []) visit(dependency.pkg);
  }
  visit(metadata.resolve.root);
  for (const pkg of metadata.packages.filter((item) => item.source && reachable.has(item.id)).sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))) {
    const id = `cargo:${pkg.name}@${pkg.version}`;
    const directory = dirname(pkg.manifest_path);
    const files = [...licenseFiles(directory).map((path) => ({ path })), ...supplements(id)];
    const source = `https://crates.io/api/v1/crates/${pkg.name}/${pkg.version}/download`;
    let note = "Conservative dependency inventory includes build-time dependencies. No upstream source modifications were made.";
    if (pkg.authors?.length) note += ` Package authors (upstream metadata): ${pkg.authors.join("; ")}.`;
    if (pkg.license?.includes("MPL-2.0")) {
      const registry = dirname(dirname(directory));
      const archive = join(dirname(registry), "cache", basename(dirname(directory)), `${pkg.name}-${pkg.version}.crate`);
      if (!existsSync(archive)) throw new Error(`Missing exact MPL source archive: ${pkg.name}`);
      files.push({ path: archive, source });
      note += " Corresponding unmodified source is included as a .crate archive alongside these notices, and is available at the source URL.";
    }
    add(id, pkg.license ?? "UNKNOWN", source, files, note);
  }

  add(`runtime:node@${process.versions.node}`, "Node and bundled component licenses", `https://nodejs.org/dist/${process.version}/`, [
    { path: join(resources, "runtime/NODE-LICENSE.txt") },
  ]);
  const sysroot = execFileSync("rustc", ["--print", "sysroot"], { encoding: "utf8" }).trim();
  const rustVersion = execFileSync("rustc", ["--version"], { encoding: "utf8" }).trim();
  const rustDocs = join(sysroot, "share/doc/rust");
  add(`runtime:${rustVersion.split(" ").slice(0, 2).join("-")}`, "Rust standard library and included component licenses", "https://www.rust-lang.org/policies/licenses", [
    { path: join(rustDocs, "COPYRIGHT-library.html") }, ...readdirSync(join(rustDocs, "licenses")).filter((name) => lstatSync(join(rustDocs, "licenses", name)).isFile()).map((name) => ({ path: join(rustDocs, "licenses", name) })),
  ]);

  const manifest = { schemaVersion: 1, platform: target, inventoryScope: "Installed npm production/peer/optional dependencies, Cargo reachable dependency superset, Node and Rust runtime notices", records, notes: overrides.notes ?? [] };
  writeFileSync(join(resources, "license-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const notices = ["Novel Weaver third-party notices", "First-party shell and core licenses are provided separately.", "MPL source archives included under licenses/ contain third-party code only.", ...overrides.notes ?? [], "", ...records.flatMap((record) => [record.id, `License: ${record.license}`, `Source: ${record.source}`, record.notes, ...record.files.map((file) => `  ${file.file} (SHA256 ${file.sha256})${file.source !== record.source ? ` — ${file.source}` : ""}`), ""])].join("\n");
  writeFileSync(join(resources, "THIRD-PARTY-NOTICES.txt"), notices);
  const publicLegal = join(app, "public/legal");
  mkdirSync(publicLegal, { recursive: true });
  const pre = (text) => `<pre>${escapeHtml(text)}</pre>`;
  const firstParty = ["LICENSING.md", "LICENSE", "CORE-LICENSE.txt"].map((file) => `<details><summary>${escapeHtml(file)}</summary>${pre(readFileSync(join(root, file), "utf8"))}</details>`).join("");
  const thirdParty = records.map((record) => `<details><summary>${escapeHtml(record.id)} · ${escapeHtml(record.license)}</summary><p>${escapeHtml(record.notes)}</p><p>来源：${escapeHtml(record.source)}</p>${record.files.filter((file) => !file.file.endsWith(".crate")).map((file) => `<h3>${escapeHtml(basename(file.file))}</h3>${pre(readFileSync(join(resources, file.file), "utf8"))}`).join("")}</details>`).join("");
  writeFileSync(join(publicLegal, "index.html"), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Novel Weaver 许可证</title><style>body{font:14px/1.65 system-ui,sans-serif;max-width:960px;margin:32px auto;padding:0 24px;color:#24211e;background:#faf8f4}h1{font-size:25px}details{margin:10px 0;border:1px solid #d9d3c9;border-radius:6px;padding:12px}summary{cursor:pointer;font-weight:600}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.65 ui-monospace,monospace}h3{font-size:13px}</style><h1>许可证与第三方声明</h1><p>Copyright 2026 哈迪工作室。桌面外层采用 Apache-2.0；核心按独立条款免费提供个人与企业使用。第三方组件保留各自许可。</p><h2>项目许可</h2>${firstParty}<h2>第三方组件</h2><p>下列清单包含构建期依赖的保守超集。MPL 组件的对应源码归档随安装包 licenses 目录提供。</p>${(overrides.notes ?? []).map((note) => `<p>${escapeHtml(note)}</p>`).join("")}${thirdParty}</html>`);
  execFileSync("/usr/bin/ditto", ["-c", "-k", "--norsrc", "--keepParent", licenses, join(resources, "licenses.zip")]);
  console.log(`License materials: ${records.length} components, all with original text; exact MPL sources included.`);
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) collectLicenses(resolve(import.meta.dirname, ".."));
