import { describe, expect, it } from "vitest";

import { newTerminalId } from "./terminal-id";

describe("newTerminalId", () => {
  it("makes ids VesnALIA's terminals.create accepts", () => {
    // VesnALIA 0.48.1's terminalSessionIdSchema.
    const aliaPattern = /^term_[23456789abcdefghijkmnpqrstuvwxyz]{10}$/u;
    const ids = new Set(Array.from({ length: 200 }, () => newTerminalId()));
    for (const id of ids) expect(id).toMatch(aliaPattern);
    expect(ids.size).toBe(200);
  });
});
