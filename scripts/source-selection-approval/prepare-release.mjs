import { writeFile, realpath } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { loadAndValidateHandoff } from "../../packages/source-selection-approval/load-handoff.mjs";
export { loadAndValidateHandoff };
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [inputsPath, outputPath] = process.argv.slice(2);
  if (!outputPath)
    throw new Error(
      "usage: prepare-release.mjs private-handoff-inputs.json /workspace/private-review/handoff.json",
    );
  const manifest = await loadAndValidateHandoff(inputsPath);
  const out = resolve(outputPath);
  if (
    !out.startsWith("/workspace/") ||
    !(await realpath(dirname(out))).startsWith("/workspace/")
  )
    throw new Error("workspace_required");
  await writeFile(out, JSON.stringify(manifest, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(
    JSON.stringify(
      { status: "approved_handoff_written", path: out, ...manifest },
      null,
      2,
    ),
  );
}
