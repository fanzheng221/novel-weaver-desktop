import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { coreSourceHash } from "../private-core.mjs";
import { checkReleaseAssets, collectLocalRelease, prepareLocalRelease, releaseVersion, sha256 } from "../local-release.mjs";

const APP = "apps/novel-weaver-desktop";
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
function put(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === "object" && !Buffer.isBuffer(content) ? JSON.stringify(content) : content);
}
function fixture(t) {
  const parent = mkdtempSync(join(tmpdir(), "nw-local-release-"));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, "public");
  const core = join(parent, "private-core");
  put(join(core, "package.json"), { name: "novel-weaver-core", version: "0.1.0" });
  put(join(core, "src/index.ts"), "export const core = 'PRIVATE_SOURCE_CANARY';\n");
  put(join(core, "tests/secret.test.ts"), "PRIVATE_TEST_CANARY\n");
  const files = {
    "package.json": { version: "0.1.0" },
    [`${APP}/package.json`]: { version: "0.1.0" },
    [`${APP}/src-tauri/tauri.conf.json`]: { version: "0.1.0" },
    [`${APP}/src-tauri/Cargo.toml`]: '[package]\nversion = "0.1.0"\n[dependencies]\n',
    "private-core.lock.json": { version: "0.1.0", rpcVersion: 16, sourceSha256: coreSourceHash(core) },
    ".gitignore": "/packages/\n/.private/\n",
    "LICENSE": "Apache license fixture\n",
    "CORE-LICENSE.txt": "Core license fixture\n",
    "LICENSING.md": "Scope fixture\n",
  };
  for (const [name, data] of Object.entries(files)) put(join(root, name), data);
  put(join(root, "public-files.json"), { files: [...Object.keys(files), "public-files.json"].sort() });
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "-c", "user.name=Release test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "test: release fixture"]);
  return { root, core, parent, work: join(parent, "build"), output: join(parent, "assets") };
}
function builtFixture(t) {
  const f = fixture(t);
  const record = prepareLocalRelease(f.root, f.core, f.work, "v0.1.0");
  // Synthetic artifact fixtures validate file boundaries; they are not real installers.
  record.platform = "darwin"; record.arch = "arm64";
  put(join(f.work, ".private/local-release.json"), record);
  const installerRelative = `${APP}/src-tauri/target/release/bundle/dmg/example.dmg`;
  const dmg = Buffer.alloc(1024);
  dmg.write("koly", 512);
  const installer = join(f.work, installerRelative);
  put(installer, dmg);
  put(join(f.work, ".private/local-build.json"), {
    schemaVersion: 1, tag: record.tag, publicSourceSha256: record.publicSourceSha256,
    installer: installerRelative, installerSha256: sha256(installer),
    tools: { node: "v22.20.0", pnpm: "10.33.2", rust: "rustc 1.93.1" }, bundleRuntimeVerified: true,
  });
  return { ...f, installer };
}

test("release versions reject branch names and inconsistent desktop versions", (t) => {
  const f = fixture(t);
  assert.equal(releaseVersion(f.root, "v0.1.0"), "0.1.0");
  for (const tag of ["", "main", "v01.1.0", "v0.1.0/../../core"]) assert.throws(() => releaseVersion(f.root, tag), /explicit version/);
  put(join(f.root, APP, "src-tauri/tauri.conf.json"), { version: "0.2.0" });
  assert.throws(() => releaseVersion(f.root, "v0.1.0"), /versions must match/);
});

test("prepare pins the public commit and copies only locked private runtime inputs locally", (t) => {
  const f = fixture(t);
  const result = prepareLocalRelease(f.root, f.core, f.work, "v0.1.0");
  assert.match(result.shellCommit, /^[0-9a-f]{40}$/);
  assert.equal(existsSync(join(f.work, ".git")), false);
  assert.equal(existsSync(join(f.work, "packages/novel-weaver-core/tests")), false);
  assert.match(readFileSync(join(f.work, "packages/novel-weaver-core/src/index.ts"), "utf8"), /PRIVATE_SOURCE_CANARY/);
  assert.equal(JSON.stringify(result).includes(f.parent), false);
  assert.throws(() => prepareLocalRelease(f.root, f.core, f.work, "v0.1.0"), /already exists/);
});

test("prepare rejects dirty public files, changed core and symlink output into private input", (t) => {
  const f = fixture(t);
  put(join(f.root, "unreviewed.txt"), "uncommitted");
  assert.throws(() => prepareLocalRelease(f.root, f.core, f.work, "v0.1.0"), /working-tree/);
  rmSync(join(f.root, "unreviewed.txt"));
  const alias = join(f.parent, "core-alias");
  symlinkSync(f.core, alias, "dir");
  assert.throws(() => prepareLocalRelease(f.root, f.core, join(alias, "new-output"), "v0.1.0"), /inside the private core/);
  assert.equal(existsSync(join(f.core, "new-output")), false);
  put(join(f.core, "src/index.ts"), "changed");
  assert.throws(() => prepareLocalRelease(f.root, f.core, f.work, "v0.1.0"), /指纹/);
  assert.equal(existsSync(f.work), false);
});

test("collection exports only explicit attachments and does not confer upload acceptance", (t) => {
  const f = builtFixture(t);
  put(join(f.work, ".private/credentials.txt"), "PRIVATE_CREDENTIAL_CANARY");
  collectLocalRelease(f.work, f.output);
  const checked = checkReleaseAssets(f.output);
  assert.equal(checked.uploadReviewPassed, false);
  assert.equal(checked.files.length, 6);
  assert.equal(readdirSync(f.output).includes("packages"), false);
  for (const name of readdirSync(f.output)) assert.doesNotMatch(readFileSync(join(f.output, name), "utf8"), /PRIVATE_SOURCE_CANARY|PRIVATE_CREDENTIAL_CANARY|PRIVATE_TEST_CANARY/);
  assert.throws(() => checkReleaseAssets(f.output, join(f.work, ".private/release-review.template.json")), /Third-party/);
});

test("collection rejects changed public inputs and stale or replaced installers", (t) => {
  const f = builtFixture(t);
  put(join(f.work, "LICENSE"), "changed license");
  assert.throws(() => collectLocalRelease(f.work, f.output), /Public source changed/);
  put(join(f.work, "LICENSE"), "Apache license fixture\n");
  put(f.installer, "a replaced installer");
  assert.throws(() => collectLocalRelease(f.work, f.output), /changed after verification/);
});

test("upload checks reject extra files, changed bytes and substituted symlinks", (t) => {
  const f = builtFixture(t);
  collectLocalRelease(f.work, f.output);
  put(join(f.output, "private-core.ts"), "PRIVATE_SOURCE_CANARY");
  assert.throws(() => checkReleaseAssets(f.output), /Unexpected file/);
  rmSync(join(f.output, "private-core.ts"));
  put(join(f.output, "LICENSE"), "tampered");
  assert.throws(() => checkReleaseAssets(f.output), /checksum mismatch/);
  rmSync(join(f.output, "LICENSE"));
  symlinkSync(join(f.root, "LICENSE"), join(f.output, "LICENSE"));
  assert.throws(() => checkReleaseAssets(f.output), /regular file/);
});

test("human acceptance requires all checks and binds to the exact manifest", (t) => {
  const f = builtFixture(t);
  const notices = join(f.parent, "notices");
  put(join(notices, "THIRD-PARTY-NOTICES.txt"), "Synthetic notices for boundary tests\n");
  put(join(notices, "licenses.zip"), "Synthetic license archive for boundary tests\n");
  collectLocalRelease(f.work, f.output, notices);
  const reviewPath = join(f.work, ".private/release-review.template.json");
  const review = readJson(reviewPath);
  assert.throws(() => checkReleaseAssets(f.output, reviewPath), /acceptance are incomplete/);
  Object.assign(review, { cleanInstallVerified: true, coreFeaturesVerified: true, bundledLicensesVerified: true, thirdPartyLicensesReviewed: true, signingPolicyApproved: true, signingStatus: "ad-hoc-preview" });
  put(reviewPath, review);
  assert.equal(checkReleaseAssets(f.output, reviewPath).uploadReviewPassed, true);
  review.manifestSha256 = "0".repeat(64);
  put(reviewPath, review);
  assert.throws(() => checkReleaseAssets(f.output, reviewPath), /different release manifest/);
});
