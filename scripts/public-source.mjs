import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export function isPublicPath(file) {
  if (!file || isAbsolute(file) || file.includes("\\") || file.split("/").some((part) => part === ".." || part === "." || !part)) return false;
  if (/^(packages|plugins|private|\.private)\//.test(file)) return false;
  if (/(^|\/)(\.git|\.novel|\.novel-weaver|node_modules|dist|target|resources|gen|test-results|playwright-report)(\/|$)/.test(file)) return false;
  const name = file.split("/").at(-1);
  if (name === ".env.example") return true;
  if (name === ".env" || name.startsWith(".env.")) return false;
  return !/\.(map|sqlite3?|db|pem|key|p12|pfx|dmg|exe|msi|zip|tgz)(?:-(?:wal|shm))?$/i.test(name);
}

export function publicFiles(root) {
  const manifest = JSON.parse(readFileSync(join(root, "public-files.json"), "utf8"));
  if (!Array.isArray(manifest.files) || !manifest.files.includes("public-files.json")) throw new Error("Invalid public file allowlist.");
  const files = manifest.files;
  if (new Set(files).size !== files.length) throw new Error("Duplicate public paths.");
  for (const file of files) {
    if (typeof file !== "string" || !isPublicPath(file)) throw new Error(`Refusing non-public path: ${file}`);
    let path = root;
    for (const segment of file.split("/")) {
      path = join(path, segment);
      if (lstatSync(path).isSymbolicLink()) throw new Error(`Refusing symlink: ${file}`);
    }
    if (!lstatSync(path).isFile()) throw new Error(`Missing public file: ${file}`);
  }
  return files;
}

export function verifyPublicSource(root) {
  const files = publicFiles(root);
  // A nested preparation folder must not accidentally inspect its parent's index.
  if (existsSync(join(root, ".git"))) {
    const tracked = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
    const allowed = new Set(files);
    for (const file of tracked) {
      if (!allowed.has(file) || !isPublicPath(file)) throw new Error(`Non-public file in Git index: ${file}`);
    }
  }
  return files;
}

export function exportPublicSource(root, destination) {
  root = resolve(root);
  destination = resolve(destination);
  const pathFromRoot = relative(root, destination);
  const outside = pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot);
  if (!outside) throw new Error("Export destination must be outside the build workspace.");
  if (existsSync(destination)) throw new Error("Export destination already exists; refusing to overwrite.");
  const files = verifyPublicSource(root);
  for (const file of files) {
    const target = join(destination, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(root, file), target);
  }
  return files.length;
}
