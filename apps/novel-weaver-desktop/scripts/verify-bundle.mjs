import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// A real standalone copy cannot accidentally resolve dependencies from the workspace.
const resources = process.argv[2] ? resolve(process.argv[2]) : resolve(import.meta.dirname, "../src-tauri/resources");
const sandbox = mkdtempSync(join(tmpdir(), "novel-base-bundle-"));
try {
  cpSync(resources, sandbox, {
    recursive: true,
    filter: (path) => !path.includes(`${process.platform === "win32" ? "\\" : "/"}@zvec`),
  });
  assert.equal(existsSync(join(sandbox, "node_modules", "@zvec")), false);
  const expectedCore = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../private-core.lock.json"), "utf8"));
  const builtCore = JSON.parse(readFileSync(join(sandbox, "core-build.json"), "utf8"));
  assert.equal(builtCore.sourceSha256, expectedCore.sourceSha256, "Wrong private core revision in bundle");
  assert.equal(builtCore.bundleSha256, createHash("sha256").update(readFileSync(join(sandbox, "novel-weaver-local-core.cjs"))).digest("hex"), "Core bundle checksum mismatch");
  for (const file of ["LICENSE", "CORE-LICENSE.txt", "LICENSING.md", "THIRD-PARTY-NOTICES.txt", "license-manifest.json", "licenses.zip"]) {
    assert.equal(existsSync(join(sandbox, file)), true, `Missing bundled license material: ${file}`);
  }
  const licenseManifest = JSON.parse(readFileSync(join(sandbox, "license-manifest.json"), "utf8"));
  assert.ok(licenseManifest.records.length > 0, "Missing component license inventory");
  for (const component of licenseManifest.records) {
    for (const file of component.files) {
      assert.match(file.file, /^licenses\//);
      assert.equal(file.file.split("/").includes(".."), false);
      assert.equal(createHash("sha256").update(readFileSync(join(sandbox, file.file))).digest("hex"), file.sha256, `Wrong license text for ${component.id}`);
    }
  }
  const node = join(sandbox, "runtime", process.platform === "win32" ? "node.exe" : "node");
  const request = (method, params) => {
    const output = execFileSync(node, [join(sandbox, "novel-weaver-local-core.cjs")], {
      cwd: sandbox,
      input: `${JSON.stringify({ cwd: join(sandbox, "book"), request: { method, params } })}\n`,
      encoding: "utf8",
      timeout: 15_000,
      env: {
        ...process.env, PATH: "", NODE_PATH: join(sandbox, "node_modules"),
        NOVEL_WEAVER_EXTENSION_DIR: join(sandbox, "extension"),
        NOVEL_WEAVER_MIGRATIONS_DIR: join(sandbox, "migrations"),
        // Invalid optional settings must not affect startup in the base edition.
        NOVEL_WEAVER_EMBEDDING_DIMENSION: "not-a-number",
      },
    });
    const response = JSON.parse(output);
    assert.equal(response.ok, true, output);
    return response.data;
  };
  assert.equal(request("core_version", {}).rpcVersion, expectedCore.rpcVersion);
  assert.equal(request("initialize_project", { name: "基础版验证", primaryLanguage: "zh-CN" }).name, "基础版验证");
  const result = request("search_evidence", { query: "关键词", beforeStoryOrder: 10 });
  assert.equal(result.engine, "sqlite");
  assert.equal(result.degradedReason, "semantic_disabled");
  assert.equal(request("project_status", {}).name, "基础版验证");
  console.log("PASS: bundled Node, empty PATH, no vector module, no model configuration, new project + search + reopen.");
} finally { rmSync(sandbox, { recursive: true, force: true }); }
