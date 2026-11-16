// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, renameSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { imageDiff, worktreeImage } from "../../src/host/images";
import { IMAGE_MAX_BYTES, imagePairSchema } from "../../src/shared/images";

const roots: string[] = [];
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=", "base64");
function git(root: string, ...args: string[]) { return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim(); }
function repo() {
  const root = mkdtempSync(join(tmpdir(), "diff-tree-images-")); roots.push(root);
  git(root, "init", "-b", "main"); git(root, "config", "user.name", "Image Test"); git(root, "config", "user.email", "test@example.invalid"); return root;
}
function commit(root: string) { git(root, "add", "-A"); git(root, "commit", "-m", "Image change"); return git(root, "rev-parse", "HEAD"); }
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { force: true, recursive: true })));

it("compares HEAD or a pinned base with the working-copy bytes", async () => {
  const root = repo(); writeFileSync(join(root, "image.png"), png); const base = commit(root);
  const changed = Buffer.concat([png, Buffer.from([0, 255, 128])]); writeFileSync(join(root, "image.png"), changed);
  for (const target of [{ type: "uncommitted" as const }, { type: "all" as const, mergeBaseRef: base }]) {
    const result = await imageDiff(root, { target, path: "image.png", previousPath: null });
    expect(result.old).toMatchObject({ kind: "image", mimeType: "image/png", content: png.toString("base64") });
    expect(result.next).toMatchObject({ kind: "image", content: changed.toString("base64") });
  }
});
it("reads both immutable revisions including literal rename paths, excluding dirty bytes", async () => {
  const root = repo(), oldPath = "[old]* image.png", path = "new image.png";
  writeFileSync(join(root, oldPath), png); const from = commit(root);
  renameSync(join(root, oldPath), join(root, path)); const to = commit(root);
  writeFileSync(join(root, path), "dirty working copy"); writeFileSync(join(root, oldPath), "reused name");
  const result = await imageDiff(root, { target: { type: "range", from, to }, path, previousPath: oldPath });
  expect(result.old).toMatchObject({ kind: "image", content: png.toString("base64") });
  expect(result.next).toEqual(result.old);
});
it("handles unborn, added and deleted images without losing the available side", async () => {
  const root = repo(); writeFileSync(join(root, "image.png"), png);
  expect(await imageDiff(root, { target: { type: "uncommitted" }, path: "image.png", previousPath: null })).toMatchObject({ old: { kind: "missing" }, next: { kind: "image" } });
  const added = commit(root), empty = git(root, "hash-object", "-t", "tree", "--stdin");
  expect(await imageDiff(root, { target: { type: "range", from: empty, to: added }, path: "image.png", previousPath: null })).toMatchObject({ old: { kind: "missing" }, next: { kind: "image" } });
  rmSync(join(root, "image.png"));
  expect(await imageDiff(root, { target: { type: "uncommitted" }, path: "image.png", previousPath: null })).toMatchObject({ old: { kind: "image" }, next: { kind: "missing" } });
  const removed = commit(root);
  expect(await imageDiff(root, { target: { type: "range", from: added, to: removed }, path: "image.png", previousPath: null })).toMatchObject({ old: { kind: "image" }, next: { kind: "missing" } });
});
it("keeps an oversized side unavailable and bounds the full two-image wire response", async () => {
  const root = repo(); writeFileSync(join(root, "image.png"), png); commit(root);
  const maximum = Buffer.concat([png, Buffer.alloc(IMAGE_MAX_BYTES - png.length)]);
  writeFileSync(join(root, "image.png"), maximum); const from = commit(root);
  const pair = await imageDiff(root, { target: { type: "all", mergeBaseRef: from }, path: "image.png", previousPath: null });
  expect(imagePairSchema.safeParse(pair).success).toBe(true);
  expect(Buffer.byteLength(JSON.stringify(pair))).toBeLessThan(8 * 1024 * 1024);
  writeFileSync(join(root, "image.png"), Buffer.alloc(IMAGE_MAX_BYTES + 1));
  const tooLarge = await imageDiff(root, { target: { type: "all", mergeBaseRef: from }, path: "image.png", previousPath: null });
  expect(tooLarge).toMatchObject({ old: { kind: "image" }, next: { kind: "unavailable", message: expect.stringContaining("2 MiB") } });
});
it("confines live reads, rejects binary impersonation and serializes SVG only as image bytes", async () => {
  const root = repo(), outside = root + "-outside.png"; writeFileSync(outside, png);
  try {
    symlinkSync(outside, join(root, "escape.png"));
    expect(await worktreeImage(root, "escape.png")).toMatchObject({ kind: "unavailable", message: expect.stringContaining("outside") });
    expect(await worktreeImage(root, "../outside.png")).toMatchObject({ kind: "unavailable" });
    writeFileSync(join(root, "fake.png"), "<html>Not an image</html>");
    expect(await worktreeImage(root, "fake.png")).toMatchObject({ kind: "unavailable" });
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
    writeFileSync(join(root, "icon.svg"), svg);
    expect(await worktreeImage(root, "icon.svg")).toEqual({ kind: "image", mimeType: "image/svg+xml", content: Buffer.from(svg).toString("base64"), sizeBytes: Buffer.byteLength(svg) });
    const signal = new AbortController(); signal.abort(); await expect(worktreeImage(root, "icon.svg", signal.signal)).rejects.toThrow();
  } finally { rmSync(outside, { force: true }); }
});
