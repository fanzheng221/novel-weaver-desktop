import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { checkPrivateCore, coreSourceHash } from "../private-core.mjs";
import { exportPublicSource, publicFiles, verifyPublicSource } from "../public-source.mjs";

function workspace(t) {
  const parent = mkdtempSync(join(tmpdir(), "nw-public-boundary-"));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, "work");
  mkdirSync(root);
  writeFileSync(join(root, "README.md"), "Public desktop shell\n");
  writeFileSync(join(root, "public-files.json"), JSON.stringify({ files: ["README.md", "public-files.json"] }));
  return { root, parent };
}

test("export excludes private core and generated resources even when present locally", (t) => {
  const { root, parent } = workspace(t);
  const privatePath = join(root, "packages/novel-weaver-core/src");
  mkdirSync(privatePath, { recursive: true });
  writeFileSync(join(privatePath, "secret.ts"), "PRIVATE_SOURCE_CANARY");
  mkdirSync(join(root, "apps/desktop/src-tauri/resources"), { recursive: true });
  writeFileSync(join(root, "apps/desktop/src-tauri/resources/core.cjs"), "PRIVATE_BUNDLE_CANARY");
  const output = join(parent, "export");
  assert.equal(exportPublicSource(root, output), 2);
  assert.equal(existsSync(join(output, "packages")), false);
  assert.equal(existsSync(join(output, "apps")), false);
  assert.equal(readFileSync(join(output, "README.md"), "utf8"), "Public desktop shell\n");
  assert.throws(() => exportPublicSource(root, output), /already exists/);
  assert.throws(() => exportPublicSource(root, join(root, "..hidden")), /outside/);
});

test("allowlist rejects private files, generated output and path traversal", (t) => {
  const { root } = workspace(t);
  for (const file of ["packages/novel-weaver-core/src/a.ts", "plugins/a.ts", "../private.ts", ".env", "core.cjs.map", "book.sqlite3-wal", "apps/a/src-tauri/resources/core.cjs"]) {
    writeFileSync(join(root, "public-files.json"), JSON.stringify({ files: ["public-files.json", file] }));
    assert.throws(() => publicFiles(root), /non-public path/);
  }
});

test("an allowlisted symlink cannot export private content", (t) => {
  const { root, parent } = workspace(t);
  writeFileSync(join(parent, "private.txt"), "PRIVATE_CONTENT_CANARY");
  symlinkSync(join(parent, "private.txt"), join(root, "public.txt"));
  writeFileSync(join(root, "public-files.json"), JSON.stringify({ files: ["public-files.json", "public.txt"] }));
  assert.throws(() => publicFiles(root), /symlink/);
});

test("forced private files in the Git index are rejected", (t) => {
  const { root } = workspace(t);
  execFileSync("git", ["init", "-q", root]);
  const path = join(root, "packages/novel-weaver-core");
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "secret.ts"), "PRIVATE_SOURCE_CANARY");
  execFileSync("git", ["-C", root, "add", "-f", "packages/novel-weaver-core/secret.ts"]);
  assert.throws(() => verifyPublicSource(root), /Non-public file in Git index/);
});

test("missing, wrong-version and modified private cores stop the build", (t) => {
  const { root } = workspace(t);
  const path = join(root, "packages/novel-weaver-core");
  const lock = join(root, "private-core.lock.json");
  writeFileSync(lock, JSON.stringify({ version: "0.1.0", sourceSha256: "pending" }));
  assert.throws(() => checkPrivateCore(root), /缺少私有核心/);
  mkdirSync(join(path, "src"), { recursive: true });
  writeFileSync(join(path, "package.json"), JSON.stringify({ name: "novel-weaver-core", version: "0.1.0" }));
  writeFileSync(join(path, "src/index.ts"), "export const sample = 1;\n");
  writeFileSync(lock, JSON.stringify({ version: "0.1.0", sourceSha256: coreSourceHash(path) }));
  assert.equal(checkPrivateCore(root).version, "0.1.0");
  writeFileSync(join(path, "src/index.ts"), "export const sample = 2;\n");
  assert.throws(() => checkPrivateCore(root), /指纹不匹配/);
  writeFileSync(join(path, "package.json"), JSON.stringify({ name: "novel-weaver-core", version: "0.2.0" }));
  assert.throws(() => checkPrivateCore(root), /版本/);
});
