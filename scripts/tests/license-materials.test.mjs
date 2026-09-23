import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { escapeHtml, licenseFiles, productionPackages } from "../collect-licenses.mjs";

test("license discovery preserves nested notices and font OFL without copying implementation or links", (t) => {
  const root = mkdtempSync(join(tmpdir(), "nw-license-files-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "vendor"));
  mkdirSync(join(root, "node_modules"));
  for (const file of ["LICENSE", "OFL.txt", "vendor/NOTICE.md", "implementation.ts", "copying.rs", "COPYRIGHT.js", "node_modules/LICENSE"]) writeFileSync(join(root, file), file);
  symlinkSync(join(root, "implementation.ts"), join(root, "LICENSE-secret"));
  assert.deepEqual(licenseFiles(root).map((path) => path.slice(root.length + 1)).sort(), ["LICENSE", "OFL.txt", "vendor/NOTICE.md"]);
});

test("license inventory includes runtime transitive and peer packages, omitting development-only inputs", (t) => {
  const root = mkdtempSync(join(tmpdir(), "nw-license-tree-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (name, pkg) => {
    const directory = name === "app" ? root : join(root, "node_modules", name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "package.json"), JSON.stringify({ name, version: "1.0.0", ...pkg }));
  };
  put("app", { dependencies: { renderer: "1", "novel-weaver-core": "1" }, devDependencies: { secretTool: "1" } });
  put("renderer", { peerDependencies: { react: "1" }, optionalDependencies: { absentNative: "1" } });
  put("react", {});
  put("novel-weaver-core", { dependencies: { sqlite: "1" } });
  put("sqlite", {});
  put("secretTool", {});
  assert.deepEqual(productionPackages([root]).map(({ pkg }) => pkg.name).sort(), ["react", "renderer", "sqlite"]);
});

test("upstream license content is escaped before embedding in the offline viewer", () => {
  assert.equal(escapeHtml('<script a="x">&</script>'), "&lt;script a=&quot;x&quot;&gt;&amp;&lt;/script&gt;");
});
