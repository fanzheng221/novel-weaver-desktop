import { checkPrivateCore } from "./private-core.mjs";

try {
  const core = checkPrivateCore();
  console.log(`Private core ${core.version}: locked build inputs verified.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
