#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { validateFoundation } from "./foundation-validation.mjs";
import { repositoryRoot, stableJson } from "./paths.mjs";

function main() {
  const root = repositoryRoot(import.meta.url);
  process.stdout.write(stableJson(validateFoundation(root)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
