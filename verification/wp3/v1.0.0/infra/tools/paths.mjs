import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function repositoryRoot(fromUrl = import.meta.url) {
  let cursor = path.dirname(fileURLToPath(fromUrl));
  while (cursor !== path.dirname(cursor)) {
    if (
      fs.existsSync(path.join(cursor, "docs", "RESEARCH_NAVIGATOR_IMPLEMENTATION_PLAN.md")) &&
      fs.existsSync(path.join(cursor, "package.json"))
    ) {
      return cursor;
    }
    cursor = path.dirname(cursor);
  }
  throw new Error("could not resolve repository root");
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
