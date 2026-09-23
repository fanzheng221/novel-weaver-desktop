import { resolve } from "node:path";
import { verifyPublicSource } from "./public-source.mjs";

try {
  const files = verifyPublicSource(resolve(import.meta.dirname, ".."));
  console.log(`PASS: ${files.length} public source files; private core and build resources excluded.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
