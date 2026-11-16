import assert from "node:assert/strict";
import { test } from "node:test";
import { appendEntry, MAX_ENTRIES, replyToAgent, type GateEntry } from "../lib/journal.ts";

const entry = (over: Partial<GateEntry> = {}): GateEntry => ({ id: "1", threadId: "t", at: "2026-11-01", decision: "approved", comment: "", what: "w", where: "p", rollback: "r", commands: [], ...over });

test("only an approval allows the change", () => {
  assert.match(replyToAgent(entry()), /^Approved/);
  assert.match(replyToAgent(entry({ decision: "declined" })), /Do not make this change/);
  assert.match(replyToAgent(entry({ decision: "dismissed" })), /Do not make this change/);
});

test("the comment reaches the agent", () => {
  assert.match(replyToAgent(entry({ comment: " only staging " })), /only staging$/);
});

test("the journal keeps the newest entries", () => {
  let journal: GateEntry[] = [];
  for (let i = 0; i < MAX_ENTRIES + 5; i += 1) journal = appendEntry(journal, entry({ id: String(i) }));
  assert.equal(journal.length, MAX_ENTRIES);
  assert.equal(journal[0]?.id, String(MAX_ENTRIES + 4));
});
