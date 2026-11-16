/**
 * The plugin's files live in the VesnALIA data folder that runs it.
 *
 * VesnALIA hands every plugin a database at `<VesnALIA data dir>/plugins/<id>/data.db`,
 * and the folder around it is the plugin's own. The build tracker used to
 * guess that folder as `~/.vesnalia/plugins/<id>` instead, so a dev or test VesnALIA, or
 * one started with `ALIA_DATA_DIR`, wrote its result bundles and installed its
 * shim into the main VesnALIA's folder. VesnALIA's SDK documents exactly this guess as the
 * mistake to avoid. Both halves now derive the folder from the database
 * handle (`dataDirOf`), and this keeps a guess from coming back.
 */

import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if ([".ts", ".tsx", ".mjs"].includes(extname(entry.name))) files.push(path);
  }
  return files;
}

const PRODUCTION_FILES = [
  ...sourceFiles(join(ROOT, "src")),
  join(ROOT, "server.ts"),
  join(ROOT, "sim-host.mjs"),
  join(ROOT, "sim-host-stream.mjs"),
];

describe("the plugin data folder", () => {
  it("is never derived from the home directory", () => {
    // A `".vesnalia"` path segment next to the home directory is the guess. Comments
    // that mention `~/.vesnalia` (for example VesnALIA's own worktree layout) are fine.
    const guess = /homedir\(\)[^;\n]*["']\.alia["']/;
    const offenders = PRODUCTION_FILES.filter((file) => guess.test(readFileSync(file, "utf8"))).map(
      (file) => relative(ROOT, file),
    );
    expect(offenders).toEqual([]);
  });
});
