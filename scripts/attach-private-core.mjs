import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { checkPrivateCore, coreBuildFiles, repositoryRoot } from "./private-core.mjs";

try {
  if (!process.argv[2]) throw new Error("用法：node scripts/attach-private-core.mjs <私有核心目录>");
  const source = resolve(process.argv[2]);
  const destination = join(repositoryRoot, "packages/novel-weaver-core");
  if (existsSync(destination)) throw new Error("私有核心目录已存在；不会覆盖或删除现有文件。请使用新的构建工作目录。");
  checkPrivateCore(repositoryRoot, source);
  // Copy only locked runtime inputs; no author databases, dependencies or tests.
  for (const file of coreBuildFiles(source)) {
    const target = join(destination, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(source, file), target);
  }
  checkPrivateCore();
  console.log("私有核心已接入被 Git 忽略的构建目录。接下来运行 pnpm install --frozen-lockfile。");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
