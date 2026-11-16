import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/declaration.js";
import { FRAGMENT } from "../src/text/fragment.js";

/**
 * On VesnALIA the fragments ride in their own instruction slot (`contributeInstructions`): one text that VesnALIA cuts at its
 * cap (4,096 characters today), each fragment under `## From <id>` and then its own `## <id> <version>`, joined
 * with a blank line in registration order (07 R6.29, U35; alia-pages `joinFragments`). What is left for this
 * fragment is the cap less everything joined before it. `alia pages status` prints each fragment's placement, in
 * that order; this test reads it from the VesnALIA on this machine and measures this code's fragment against it. The
 * protocol's own 2,048-byte cap is held in declaration.test.ts on every machine. Skipped without a VesnALIA with
 * alia-pages, or without syns among its contributors (SYNS_SKIP_ALIA=1 skips it too).
 */
/** Room the fragment must keep below the cut, so that a small edit before it is noticed here first. */
const MARGIN = 50;
const FRAGMENT_LINE = /^fragment (\S+)(?: (\S+))? → slot "([^"]+)": (\d+) characters of (\d+), /;

interface Placement { id: string; chars: number; cap: number }

/** `alia pages status`, or null when there is no alia-pages to ask. */
function liveStatus(): string | null {
  if (process.env.SYNS_SKIP_ALIA === "1") return null;
  try {
    return execFileSync("alia", ["pages", "status"], { encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null; // no VesnALIA, or no alia-pages on it
  }
}

const status = liveStatus();
const fragmentLines = (status ?? "").split("\n").filter((line) => line.startsWith("fragment "));
const placements: Placement[] = fragmentLines.flatMap((line) => {
  const m = FRAGMENT_LINE.exec(line);
  return m ? [{ id: m[1]!, chars: Number(m[4]), cap: Number(m[5]) }] : [];
});

it.skipIf(status === null)("alia pages status prints every fragment's placement in the form this test reads", () => {
  expect(placements.length, fragmentLines.join("\n")).toBe(fragmentLines.length);
});

describe.skipIf(!placements.some((p) => p.id === "syns"))("the fragment against this machine's alia-pages slot (U35, S4.6)", () => {
  it("fits whole below VesnALIA's cut, with room to spare, after every fragment joined before it", () => {
    const at = placements.findIndex((p) => p.id === "syns");
    const heading = (id: string): number => `## From ${id}\n\n`.length;
    // A placement's chars count its own `## <id> <version>` heading; the `## From <id>` heading and the blank line between fragments are alia-pages'.
    const before = placements.slice(0, at).reduce((sum, p) => sum + heading(p.id) + p.chars + 2, 0) + heading("syns");
    const ours = `## syns ${VERSION}\n\n`.length + FRAGMENT.trim().length;
    const cap = placements[at]!.cap;
    expect(before + ours + MARGIN, `${cap - before} characters are left for the fragment and its heading`).toBeLessThanOrEqual(cap);
  });
});
