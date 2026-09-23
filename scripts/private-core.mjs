import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

export const repositoryRoot = resolve(import.meta.dirname, "..");

export function coreBuildFiles(corePath) {
  const files = ["package.json"];
  function visit(directory) {
    for (const entry of readdirSync(directory).sort()) {
      const path = join(directory, entry);
      const stats = lstatSync(path);
      if (stats.isSymbolicLink()) throw new Error("Private core build inputs must not contain symlinks.");
      if (stats.isDirectory()) visit(path);
      else if (stats.isFile()) files.push(relative(corePath, path).split(sep).join("/"));
    }
  }
  if (lstatSync(join(corePath, "package.json")).isSymbolicLink() || lstatSync(join(corePath, "src")).isSymbolicLink()) {
    throw new Error("Private core build inputs must not contain symlinks.");
  }
  visit(join(corePath, "src"));
  return files.sort();
}

export function coreSourceHash(corePath) {
  const hash = createHash("sha256");
  for (const file of coreBuildFiles(corePath)) {
    const bytes = readFileSync(join(corePath, file));
    hash.update(file).update("\0").update(String(bytes.length)).update("\0").update(bytes);
  }
  return hash.digest("hex");
}

export function checkPrivateCore(root = repositoryRoot, corePath = join(root, "packages/novel-weaver-core")) {
  const lock = JSON.parse(readFileSync(join(root, "private-core.lock.json"), "utf8"));
  if (!existsSync(join(corePath, "package.json"))) {
    throw new Error("缺少私有核心。维护者请先运行 node scripts/attach-private-core.mjs <私有核心目录>；公开仓库不包含核心源码。");
  }
  const pkg = JSON.parse(readFileSync(join(corePath, "package.json"), "utf8"));
  if (pkg.name !== "novel-weaver-core" || pkg.version !== lock.version) {
    throw new Error("私有核心名称或版本与 private-core.lock.json 不匹配。");
  }
  if (coreSourceHash(corePath) !== lock.sourceSha256) {
    throw new Error("私有核心内容与锁定指纹不匹配；请使用此桌面版本对应的核心，不会继续打包。");
  }
  return { corePath, version: lock.version, sourceSha256: lock.sourceSha256 };
}
