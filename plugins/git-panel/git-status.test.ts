// node --experimental-strip-types --test git-status.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { fileParts, parseNumstat, statusOf, summaryOf } from "./lib/git-status.ts";

test("status letters and tones follow VS Code", () => {
  assert.deepEqual(statusOf("M"), { letter: "M", label: "Modified", tone: "modified" });
  assert.equal(statusOf("?").letter, "U");
  assert.equal(statusOf("D").tone, "deleted");
  assert.equal(statusOf("U").letter, "!");
  assert.deepEqual(statusOf(" "), { letter: "•", label: "Changed", tone: "modified" });
});

test("paths split into name and folder; renames and untracked folders", () => {
  assert.deepEqual(fileParts("src/app/page.tsx"), { name: "page.tsx", dir: "src/app" });
  assert.deepEqual(fileParts("README.md"), { name: "README.md", dir: "" });
  assert.deepEqual(fileParts("old/a.ts -> new/b.ts"), { name: "b.ts", dir: "new" });
  assert.deepEqual(fileParts("drafts/"), { name: "drafts", dir: "" });
});

test("numstat: plain entries, renames keep the new path, binaries are null", () => {
  const counts = parseNumstat("53\t46\tapps/page.tsx\0" + "4\t0\t\0old/a.ts\0new/b.ts\0" + "-\t-\tlogo.png\0");
  assert.deepEqual(counts.get("apps/page.tsx"), { added: 53, removed: 46 });
  assert.deepEqual(counts.get("new/b.ts"), { added: 4, removed: 0 });
  assert.equal(counts.has("old/a.ts"), false);
  assert.deepEqual(counts.get("logo.png"), { added: null, removed: null });
  assert.equal(parseNumstat("").size, 0);
});

test("summary picks one next action in priority order", () => {
  const base = { staged: 0, changed: 0, ahead: 0, behind: 0, upstream: "origin/main" };
  assert.deepEqual(summaryOf({ ...base, ahead: 1, behind: 2 }), { tone: "warning", label: "1 ahead · 2 behind", action: "sync" });
  assert.equal(summaryOf({ ...base, staged: 3, ahead: 2 }).action, "commit");
  assert.deepEqual(summaryOf({ ...base, behind: 1 }), { tone: "warning", label: "1 commit to pull", action: "pull" });
  assert.deepEqual(summaryOf({ ...base, ahead: 2 }), { tone: "accent", label: "2 commits to push", action: "push" });
  assert.deepEqual(summaryOf({ ...base, changed: 14 }), { tone: "muted", label: "14 unstaged changes", action: "stage-all" });
  assert.deepEqual(summaryOf({ ...base, upstream: null }), { tone: "muted", label: "No upstream", action: null });
  assert.deepEqual(summaryOf(base), { tone: "success", label: "No new changes", action: null });
});
