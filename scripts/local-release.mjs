import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { checkPrivateCore, coreBuildFiles, repositoryRoot } from "./private-core.mjs";
import { exportPublicSource, verifyPublicSource } from "./public-source.mjs";

const APP = "apps/novel-weaver-desktop";
const STATE = ".private/local-release.json";
const BUILD = ".private/local-build.json";
const MANIFEST = "release-manifest.json";
const CHECKSUMS = "SHA256SUMS.txt";
const LEGAL_FILES = ["LICENSE", "CORE-LICENSE.txt", "LICENSING.md"];
const THIRD_PARTY_FILES = ["THIRD-PARTY-NOTICES.txt", "licenses.zip"];
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const save = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();

export function sha256(path) {
  const hash = createHash("sha256");
  const fd = openSync(path, "r");
  const buffer = Buffer.alloc(64 * 1024);
  try {
    let count;
    while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count));
    return hash.digest("hex");
  } finally { closeSync(fd); }
}

function regularFile(path) {
  const info = lstatSync(path);
  if (info.isSymbolicLink() || !info.isFile() || info.size === 0) throw new Error(`Expected nonempty regular file: ${path}`);
}

function inside(root, path) {
  const part = relative(root, path);
  return part !== "" && part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part);
}

function newDirectoryOutside(root, destination) {
  if (existsSync(destination)) throw new Error("Output already exists; use a new directory. Nothing is overwritten.");
  const canonical = join(realpathSync(dirname(destination)), destination.split(sep).at(-1));
  if (canonical === realpathSync(root) || inside(realpathSync(root), canonical)) throw new Error("Output must be outside the source/build directory.");
  return canonical;
}

export function releaseVersion(root, tag) {
  const match = /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/.exec(tag);
  if (!match) throw new Error("Expected an explicit version tag vX.Y.Z; branch names and empty tags are not accepted.");
  const version = match[1];
  const cargo = readFileSync(join(root, APP, "src-tauri/Cargo.toml"), "utf8");
  const packageSection = cargo.match(/^\[package\]\s*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1];
  const cargoVersion = packageSection?.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  const versions = [json(join(root, "package.json")).version, json(join(root, APP, "package.json")).version,
    json(join(root, APP, "src-tauri/tauri.conf.json")).version, cargoVersion];
  if (versions.some((value) => value !== version)) throw new Error("Tag, root package, desktop package, Cargo and Tauri versions must match.");
  return version;
}

function sourceHash(root) {
  const records = verifyPublicSource(root).slice().sort().map((file) => [file, sha256(join(root, file))]);
  return createHash("sha256").update(JSON.stringify(records)).digest("hex");
}

export function prepareLocalRelease(root, core, destination, tag) {
  root = resolve(root); core = resolve(core); destination = resolve(destination);
  const canonicalOutput = newDirectoryOutside(root, destination);
  if (inside(realpathSync(core), canonicalOutput) || canonicalOutput === realpathSync(core)) throw new Error("Output must not be inside the private core.");
  if (realpathSync(git(root, "rev-parse", "--show-toplevel")) !== realpathSync(root)) throw new Error("Use the standalone public Git repository.");
  if (git(root, "status", "--porcelain", "--untracked-files=all")) throw new Error("Commit or resolve public working-tree changes before preparing a fixed release.");
  const version = releaseVersion(root, tag);
  const checked = checkPrivateCore(root, core);
  const coreFiles = coreBuildFiles(checked.corePath);
  const record = {
    schemaVersion: 1, tag, version, shellCommit: git(root, "rev-parse", "HEAD"),
    publicSourceSha256: sourceHash(root), core: json(join(root, "private-core.lock.json")),
    platform: process.platform, arch: process.arch,
  };
  exportPublicSource(root, destination);
  const targetCore = join(destination, "packages/novel-weaver-core");
  for (const file of coreFiles) {
    const target = join(targetCore, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(checked.corePath, file), target);
  }
  checkPrivateCore(destination);
  if (sourceHash(destination) !== record.publicSourceSha256) throw new Error("Public snapshot changed while being copied.");
  mkdirSync(join(destination, ".private"));
  save(join(destination, STATE), record);
  return record;
}

function fixedInputs(root) {
  const record = json(join(root, STATE));
  if (record.schemaVersion !== 1 || record.publicSourceSha256 !== sourceHash(root)) throw new Error("Public source changed after preparation; prepare a new release directory.");
  releaseVersion(root, record.tag);
  checkPrivateCore(root);
  if (JSON.stringify(record.core) !== JSON.stringify(json(join(root, "private-core.lock.json")))) throw new Error("Private core lock changed.");
  return record;
}

export function buildLocalRelease(root) {
  const record = fixedInputs(root);
  if (process.platform !== "darwin" || process.arch !== "arm64" || record.platform !== process.platform || record.arch !== process.arch) {
    throw new Error("The current local build command supports macOS arm64 only. Windows credentials and other targets still require validation.");
  }
  if (process.version !== "v22.20.0") throw new Error("Use official standalone Node 22.20.0 for this release workflow.");
  const pnpm = execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim();
  const rust = execFileSync("rustc", ["--version"], { encoding: "utf8" }).trim();
  if (pnpm !== "10.33.2" || !rust.startsWith("rustc 1.93.1 ")) throw new Error("Use pnpm 10.33.2 and Rust 1.93.1 for this release workflow.");
  const bundle = join(root, APP, "src-tauri/target/release/bundle");
  if (existsSync(bundle) || existsSync(join(root, BUILD))) throw new Error("Build outputs already exist; prepare a new directory to avoid collecting stale installers.");
  const previewEnvironment = { ...process.env };
  for (const name of Object.keys(previewEnvironment)) if (name.startsWith("APPLE_")) delete previewEnvironment[name];
  previewEnvironment.APPLE_SIGNING_IDENTITY = "-";
  const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: "inherit", env: previewEnvironment });
  run("pnpm", ["install", "--frozen-lockfile"]);
  run("pnpm", ["test"]);
  run("pnpm", ["--filter", "novel-weaver-desktop", "test:ui:static"]);
  run("pnpm", ["--filter", "novel-weaver-desktop", "tauri", "build", "--bundles", "app,dmg", "--config", "src-tauri/tauri.preview.conf.json"]);
  const resources = join(bundle, "macos/Novel Weaver.app/Contents/Resources/resources");
  run(process.execPath, [join(APP, "scripts/verify-bundle.mjs"), resources]);
  fixedInputs(root);
  const installerNames = readdirSync(join(bundle, "dmg")).filter((name) => name.endsWith(".dmg"));
  if (installerNames.length !== 1) throw new Error("Expected exactly one DMG from this build.");
  const installer = join(bundle, "dmg", installerNames[0]);
  regularFile(installer);
  const receipt = {
    schemaVersion: 1, tag: record.tag, publicSourceSha256: record.publicSourceSha256,
    installer: relative(root, installer).split(sep).join("/"), installerSha256: sha256(installer),
    tools: { node: process.version, pnpm, rust }, bundleRuntimeVerified: true, signingMode: "ad-hoc-preview",
  };
  save(join(root, BUILD), receipt);
  return receipt;
}

export function collectLocalRelease(root, destination, noticesDirectory) {
  root = resolve(root); destination = resolve(destination);
  newDirectoryOutside(root, destination);
  const record = fixedInputs(root);
  const receipt = json(join(root, BUILD));
  if (receipt.schemaVersion !== 1 || receipt.tag !== record.tag || receipt.publicSourceSha256 !== record.publicSourceSha256 || receipt.bundleRuntimeVerified !== true) throw new Error("Missing or mismatched build receipt.");
  const installer = resolve(root, receipt.installer);
  const bundle = realpathSync(join(root, APP, "src-tauri/target/release/bundle/dmg"));
  regularFile(installer);
  if (!inside(bundle, realpathSync(installer)) || !installer.endsWith(".dmg") || sha256(installer) !== receipt.installerSha256) throw new Error("Installer is outside the build directory or changed after verification.");
  if (record.platform !== "darwin" || record.arch !== "arm64") throw new Error("Unsupported installer target.");
  verifyDmgTrailer(installer);
  const installerName = `Novel-Weaver_${record.version}_macos_arm64.dmg`;
  const sources = [[installerName, installer], ...LEGAL_FILES.map((file) => [file, join(root, file)])];
  if (noticesDirectory) sources.push(...THIRD_PARTY_FILES.map((file) => [file, join(resolve(noticesDirectory), file)]));
  for (const [, path] of sources) regularFile(path);
  mkdirSync(destination);
  const assets = sources.map(([name, path]) => {
    copyFileSync(path, join(destination, name));
    return { name, sha256: sha256(join(destination, name)) };
  });
  const manifest = {
    schemaVersion: 1, tag: record.tag, version: record.version, shellCommit: record.shellCommit,
    core: record.core, platform: record.platform, arch: record.arch,
    tools: receipt.tools, bundleRuntimeVerified: true, assets,
  };
  save(join(destination, MANIFEST), manifest);
  const sums = [...assets, { name: MANIFEST, sha256: sha256(join(destination, MANIFEST)) }];
  writeFileSync(join(destination, CHECKSUMS), sums.map((asset) => `${asset.sha256}  ${asset.name}\n`).join(""));
  // Human acceptance remains local and is bound to this exact attachment manifest.
  save(join(root, ".private/release-review.template.json"), {
    tag: record.tag, manifestSha256: sha256(join(destination, MANIFEST)),
    cleanInstallVerified: false, coreFeaturesVerified: false, bundledLicensesVerified: false,
    thirdPartyLicensesReviewed: false, signingStatus: "unverified", signingPolicyApproved: false,
  });
  checkReleaseAssets(destination);
  return manifest;
}

function verifyDmgTrailer(path) {
  const size = lstatSync(path).size;
  if (size < 512) throw new Error("Invalid DMG trailer.");
  const fd = openSync(path, "r");
  const trailer = Buffer.alloc(4);
  try { readSync(fd, trailer, 0, 4, size - 512); } finally { closeSync(fd); }
  if (trailer.toString("ascii") !== "koly") throw new Error("Invalid DMG trailer.");
}

export function checkReleaseAssets(directory, reviewPath) {
  directory = resolve(directory);
  regularFile(join(directory, MANIFEST));
  regularFile(join(directory, CHECKSUMS));
  const manifest = json(join(directory, MANIFEST));
  if (manifest.schemaVersion !== 1 || !/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(manifest.tag) || manifest.tag !== `v${manifest.version}` || !/^[0-9a-f]{40}$/.test(manifest.shellCommit) || !Array.isArray(manifest.assets)) throw new Error("Invalid release manifest.");
  if (manifest.platform !== "darwin" || manifest.arch !== "arm64" || manifest.bundleRuntimeVerified !== true) throw new Error("Unsupported or unverified bundle target.");
  const installer = `Novel-Weaver_${manifest.version}_macos_arm64.dmg`;
  const allowed = new Set([installer, ...LEGAL_FILES, ...THIRD_PARTY_FILES]);
  const names = new Set();
  for (const asset of manifest.assets) {
    if (!allowed.has(asset.name) || names.has(asset.name) || !/^[0-9a-f]{64}$/.test(asset.sha256)) throw new Error("Unexpected or duplicate release attachment.");
    names.add(asset.name);
    regularFile(join(directory, asset.name));
    if (sha256(join(directory, asset.name)) !== asset.sha256) throw new Error(`Attachment checksum mismatch: ${asset.name}`);
  }
  if ([installer, ...LEGAL_FILES].some((name) => !names.has(name))) throw new Error("Missing installer or first-party license.");
  verifyDmgTrailer(join(directory, installer));
  const expectedNames = new Set([...names, MANIFEST, CHECKSUMS]);
  if (readdirSync(directory).some((name) => !expectedNames.has(name))) throw new Error("Unexpected file in release directory; never upload the whole build workspace.");
  const sums = [...manifest.assets, { name: MANIFEST, sha256: sha256(join(directory, MANIFEST)) }];
  if (readFileSync(join(directory, CHECKSUMS), "utf8") !== sums.map((asset) => `${asset.sha256}  ${asset.name}\n`).join("")) throw new Error("SHA256SUMS does not match the complete attachment set.");
  if (reviewPath) {
    const review = json(resolve(reviewPath));
    if (THIRD_PARTY_FILES.some((name) => !names.has(name))) throw new Error("Third-party notices and license archive are required before upload.");
    if (review.tag !== manifest.tag || review.manifestSha256 !== sha256(join(directory, MANIFEST))) throw new Error("Acceptance record belongs to a different release manifest.");
    const required = ["cleanInstallVerified", "coreFeaturesVerified", "bundledLicensesVerified", "thirdPartyLicensesReviewed", "signingPolicyApproved"];
    if (required.some((key) => review[key] !== true) || !["notarized", "ad-hoc-preview"].includes(review.signingStatus)) throw new Error("Installation, licenses and signing acceptance are incomplete.");
  }
  return { tag: manifest.tag, files: [...expectedNames].sort(), uploadReviewPassed: Boolean(reviewPath) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [command, ...args] = process.argv.slice(2);
    let result;
    if (command === "prepare" && args.length === 3) result = prepareLocalRelease(repositoryRoot, args[1], args[2], args[0]);
    else if (command === "build" && args.length === 0) result = buildLocalRelease(repositoryRoot);
    else if (command === "collect" && args.length >= 1 && args.length <= 2) result = collectLocalRelease(repositoryRoot, args[0], args[1]);
    else if (command === "check" && args.length >= 1 && args.length <= 2) result = checkReleaseAssets(args[0], args[1]);
    else throw new Error("Usage: local-release.mjs prepare <vX.Y.Z> <local-core> <new-workspace> | build | collect <new-assets-dir> [notices-dir] | check <assets-dir> [local-review.json]");
    console.log(JSON.stringify(result, null, 2));
    console.log("Local operation only. No GitHub upload or Release publication performed.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
