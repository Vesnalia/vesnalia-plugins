import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { decide } from "../server.ts";

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "cll-"));
  await writeFile(path.join(dir, "run.command"), "#!/bin/sh\necho hi\n");
  await writeFile(path.join(dir, "real.pdf"), "%PDF-1.4\n");
  await mkdir(path.join(dir, "Q3.2026"));
  await mkdir(path.join(dir, "Fake.app", "Contents", "MacOS"), { recursive: true });
  await mkdir(path.join(dir, "hidden-app", "Contents"), { recursive: true });
  await writeFile(path.join(dir, "hidden-app", "Contents", "Info.plist"), "<plist/>");
  await symlink(path.join(dir, "run.command"), path.join(dir, "report.pdf"));
  await symlink(path.join(dir, "Fake.app"), path.join(dir, "folder.pdf"));
  return dir;
}

test("documents open, scripts and apps are only revealed", async () => {
  const dir = await fixture();
  assert.equal((await decide(path.join(dir, "real.pdf"), false)).action, "open");
  assert.equal((await decide(path.join(dir, "run.command"), false)).action, "reveal");
  assert.equal((await decide(path.join(dir, "Fake.app"), false)).action, "reveal");
  assert.equal((await decide(path.join(dir, "hidden-app"), false)).action, "reveal");
});

test("a symlink disguised as a document is judged by its target", async () => {
  const dir = await fixture();
  const toScript = await decide(path.join(dir, "report.pdf"), false);
  assert.equal(toScript.action, "reveal");
  assert.ok(toScript.path.endsWith("run.command"));
  assert.equal((await decide(path.join(dir, "folder.pdf"), false)).action, "reveal");
});

test("plain folders open, including names with a dot", async () => {
  const dir = await fixture();
  assert.equal((await decide(path.join(dir, "Q3.2026"), false)).action, "open");
  assert.equal((await decide(dir, false)).action, "open");
});

test("reveal flag always reveals; a missing path throws", async () => {
  const dir = await fixture();
  assert.equal((await decide(path.join(dir, "real.pdf"), true)).action, "reveal");
  await assert.rejects(decide(path.join(dir, "missing.pdf"), false));
});
