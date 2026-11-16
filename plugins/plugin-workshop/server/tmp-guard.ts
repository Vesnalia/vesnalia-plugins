// Shared vitest setup (`globalSetup`): tests clean up after themselves. Anything with the `workshop-` prefix that appeared in the temp
// folder during the run and is still there afterwards is a test failure, not disk litter.
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";

const PREFIX = "workshop-";
const ours = (): Set<string> => new Set(readdirSync(tmpdir()).filter((n) => n.startsWith(PREFIX)));

export default function setup(): () => void {
  const before = ours();
  return () => {
    const left = [...ours()].filter((n) => !before.has(n)).sort();
    if (left.length === 0) return;
    // vitest only prints a teardown error ("error during close") and exits with 0 — so we set the exit code ourselves.
    process.exitCode = 1;
    throw new Error(`tests left files in the temp folder ${tmpdir()}: ${left.join(", ")} — remove them in afterEach/afterAll`);
  };
}
