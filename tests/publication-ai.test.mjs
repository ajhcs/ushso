// Register these suites through the existing root test:worker entrypoint.
// The historical package/lock/CI attestation remains immutable.
import { readdir } from "node:fs/promises";

for (const directory of [
  "source-selection",
  "source-selection-ai",
  "source-selection-approval",
  "source-selection-evidence",
]) {
  const root = new URL(`./${directory}/`, import.meta.url);
  const files = (await readdir(root))
    .filter((name) => name.endsWith(".test.mjs"))
    .sort();
  if (!files.length)
    throw new Error(`Missing publication qualification suite: ${directory}`);
  for (const file of files) await import(new URL(file, root));
}
