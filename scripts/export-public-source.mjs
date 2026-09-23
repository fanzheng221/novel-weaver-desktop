import { resolve } from "node:path";
import { exportPublicSource } from "./public-source.mjs";

try {
  if (!process.argv[2]) throw new Error("Usage: node scripts/export-public-source.mjs <new-directory-outside-workspace>");
  const count = exportPublicSource(resolve(import.meta.dirname, ".."), process.argv[2]);
  console.log(`Exported ${count} allowlisted public files. No private core copied.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
