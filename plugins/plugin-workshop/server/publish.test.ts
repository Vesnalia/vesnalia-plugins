// The publication gate's parts: GitHub URLs, PR addresses, the destination policy, the `git log` reader — and this repository itself
// against its own scanner.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, test } from "vitest";
import { FakePorts } from "./fake-ports";
import { checkDestination, githubRepo, LogScan, prUrlOf, publicationGate, publish, ScanError, scanPublication, shownPrUrl } from "./publish";
import { secretFileName, secretFindings } from "./secrets";
import { OPENAI_KEY, SLACK_TOKEN } from "./test-tokens";

describe("githubRepo", () => {
  it("reads https, scp-like ssh and ssh:// GitHub URLs, with or without .git", () => {
    expect(githubRepo("https://github.com/acme/demo.git")).toEqual({ owner: "acme", name: "demo" });
    expect(githubRepo("https://github.com/acme/demo")).toEqual({ owner: "acme", name: "demo" });
    expect(githubRepo("git@github.com:acme/demo.git")).toEqual({ owner: "acme", name: "demo" });
    expect(githubRepo("ssh://git@github.com/acme/my.repo_1.git")).toEqual({ owner: "acme", name: "my.repo_1" });
  });
  it("refuses other hosts, credentials, ports, extra segments and invalid names", () => {
    for (const url of [
      "https://gitlab.com/acme/demo.git", "https://user:pw@github.com/acme/demo.git", "https://github.com:443/acme/demo.git", "https://github.com/acme/demo/extra",
      "http://github.com/acme/demo.git", "https://github.com/-acme/demo.git", "https://github.com/acme/..", "https://github.com.evil.example/acme/demo.git",
      "/srv/git/demo.git", "file:///srv/git/demo.git", "--upload-pack=x",
    ])
      expect(githubRepo(url), url).toBeNull();
  });
});

describe("PR addresses", () => {
  it("only a PR of exactly the checked repository is kept; owner and name compare case-insensitively", () => {
    expect(prUrlOf("https://github.com/acme/demo/pull/7\n", "acme/demo")).toBe("https://github.com/acme/demo/pull/7");
    expect(prUrlOf("https://github.com/Acme/Demo/pull/7", "acme/demo")).toBe("https://github.com/Acme/Demo/pull/7");
    for (const url of ["https://github.com/acme/other/pull/7", "https://github.com/acme/demo/pull/0", "https://github.com/acme/demo/issues/7", "https://evil.example/acme/demo/pull/7", "javascript:alert(1)//https://github.com/acme/demo/pull/7"])
      expect(prUrlOf(url, "acme/demo"), url).toBeNull();
  });
  it("a stored address is shown only while it has the exact PR shape", () => {
    expect(shownPrUrl("https://github.com/acme/demo/pull/3")).toBe("https://github.com/acme/demo/pull/3");
    expect(shownPrUrl("javascript:alert(1)")).toBeNull();
    expect(shownPrUrl("https://github.com/acme/demo/pull/3?x=1")).toBeNull();
    expect(shownPrUrl(null)).toBeNull();
  });
});

describe("checkDestination", () => {
  const rig = (info?: { visibility: string; owner: string; nameWithOwner: string } | null) => {
    const ports = new FakePorts();
    void ports.github.setRemote("/d", "git@github.com:Acme/demo.git");
    if (info !== undefined) ports.github.repoInfos.set("Acme/demo", info);
    return ports;
  };
  const policy = { owner: "acme", allowPublic: false };
  it("a private or internal repository of the owner passes (the owner compares case-insensitively)", async () => {
    expect(await checkDestination(rig().github, "/d", policy)).toEqual({ ok: true, dest: { url: "git@github.com:Acme/demo.git", repo: "Acme/demo" } });
    expect((await checkDestination(rig({ visibility: "INTERNAL", owner: "Acme", nameWithOwner: "Acme/demo" }).github, "/d", policy)).ok).toBe(true);
  });
  it("GitHub off, no origin, public, foreign — refused with a reason; allowPublic lifts public and foreign only", async () => {
    expect(await checkDestination(rig().github, "/d", { owner: "", allowPublic: false })).toMatchObject({ ok: false, kind: "destination", reason: expect.stringContaining("GitHub is off") });
    expect(await checkDestination(new FakePorts().github, "/d", policy)).toMatchObject({ ok: false, reason: expect.stringContaining("no origin") });
    const pub = rig({ visibility: "PUBLIC", owner: "Acme", nameWithOwner: "Acme/demo" });
    expect(await checkDestination(pub.github, "/d", policy)).toMatchObject({ ok: false, reason: expect.stringContaining("Acme/demo is public") });
    expect((await checkDestination(pub.github, "/d", { owner: "acme", allowPublic: true })).ok).toBe(true);
    const foreign = rig({ visibility: "PRIVATE", owner: "other", nameWithOwner: "other/demo" });
    expect(await checkDestination(foreign.github, "/d", policy)).toMatchObject({ ok: false, reason: expect.stringContaining("belongs to other") });
    expect(await checkDestination(rig(null).github, "/d", policy)).toMatchObject({ ok: false, reason: expect.stringContaining("does not show") });
  });
});

describe("publish", () => {
  it("the destination is checked before anything is read: a refused destination scans nothing and pushes nothing", async () => {
    const ports = new FakePorts();
    ports.git.setRepo("/d", {});
    await ports.github.setRemote("/d", "https://github.com/acme/demo.git");
    ports.github.repoInfos.set("acme/demo", { visibility: "PUBLIC", owner: "acme", nameWithOwner: "acme/demo" });
    const head = (await ports.git.facts("/d")).head!;
    ports.git.commitFiles.set(head, { "a.ts": `x = "${OPENAI_KEY}"\n` });
    const r = await publish(ports.github, "/d", head, "main", { owner: "acme", allowPublic: false });
    expect(r).toMatchObject({ ok: false, kind: "destination", findings: [] });
    expect(ports.count("github.push")).toBe(0);
  });
  it("what the destination already has is not scanned again; a new commit on top is", async () => {
    const ports = new FakePorts();
    ports.git.setRepo("/d", {});
    await ports.github.setRemote("/d", "https://github.com/acme/demo.git");
    const old = (await ports.git.facts("/d")).head!;
    ports.git.commitFiles.set(old, { "legacy.ts": `x = "${OPENAI_KEY}"\n` });
    ports.github.setBranch("/d", "main", old);
    const next = ports.git.commit("/d");
    ports.git.commitFiles.set(next, { "b.ts": "ok\n" });
    expect(await publish(ports.github, "/d", next, "main", { owner: "acme", allowPublic: false })).toMatchObject({ ok: true, commits: 1 });
    const again = ports.git.commit("/d");
    ports.git.commitFiles.set(again, { "c.ts": `y = "${SLACK_TOKEN}"\n` });
    expect(await publish(ports.github, "/d", again, "main", { owner: "acme", allowPublic: false })).toMatchObject({ ok: false, kind: "secrets", findings: ["c.ts: xoxb-"] });
    expect(await ports.github.remoteSha("/d", "main")).toBe(next);
  });
  it("a shallow working copy is refused: its history is cut off, so what a push sends cannot be shown to be checked", async () => {
    const ports = new FakePorts();
    ports.git.setRepo("/d", {});
    await ports.github.setRemote("/d", "https://github.com/acme/demo.git");
    const head = (await ports.git.facts("/d")).head!;
    ports.github.shallowDirs.add("/d");
    expect(await publish(ports.github, "/d", head, "main", { owner: "acme", allowPublic: false })).toMatchObject({ ok: false, kind: "scan", reason: expect.stringContaining("shallow clone") });
    expect(ports.count("github.push")).toBe(0);
  });
  it("scanPublication is the same check without a clearance: a clean result cannot be pushed with", async () => {
    const ports = new FakePorts();
    ports.git.setRepo("/d", {});
    await ports.github.setRemote("/d", "https://github.com/acme/demo.git");
    const head = (await ports.git.facts("/d")).head!;
    const r = await scanPublication(ports.github, "/d", head, { owner: "acme", allowPublic: false });
    expect(r).toEqual({ ok: true, dest: { url: "https://github.com/acme/demo.git", repo: "acme/demo" }, commits: 1 });
    expect("clearance" in r).toBe(false);
    ports.git.commitFiles.set(head, { "a.ts": `x = "${OPENAI_KEY}"\n` });
    expect(await scanPublication(ports.github, "/d", head, { owner: "acme", allowPublic: false })).toMatchObject({ ok: false, kind: "secrets", findings: ["a.ts: sk-"] });
  });
  it("a commit the scan did not see makes the scan incomplete", async () => {
    const ports = new FakePorts();
    ports.git.setRepo("/d", {});
    await ports.github.setRemote("/d", "https://github.com/acme/demo.git");
    const head = (await ports.git.facts("/d")).head!;
    ports.git.commitLogs.set(head, "");
    const g = await publicationGate(ports.github, "/d", head, { owner: "acme", allowPublic: false });
    expect(g).toMatchObject({ ok: false, kind: "scan", reason: expect.stringContaining("did not show 1 of the 1 new commits") });
  });
});

describe("LogScan", () => {
  /** Lines as the port hands them over: split on newlines, without the empty piece after the final one. */
  const feed = (text: string) => {
    const s = new LogScan();
    const lines = text.split("\n");
    if (lines.at(-1) === "") lines.pop();
    for (const l of lines) s.line(l);
    s.end();
    return s;
  };
  const head = (sha: string, msg = "m") => `\0commit ${sha}\n${msg}\n\0end\n`;
  const counted = (lines: string[], skip: string) => lines.filter((l) => !l.startsWith(skip) && !l.startsWith("\\")).length;
  const hunk = (path: string, ...lines: string[]) =>
    `diff --git a/${path} b/${path}\nindex 1..2 100644\n--- a/${path}\n+++ b/${path}\n@@ -1,${counted(lines, "+")} +1,${counted(lines, "-")} @@ ctx\n${lines.join("\n")}\n`;

  it("scans added lines and messages only: removed and context lines are already where they are going", () => {
    const s = feed(head("a1", `fix\n\nsee ${SLACK_TOKEN}`) + "\n" + hunk("x.ts", `-old ${OPENAI_KEY}`, ` ctx ${OPENAI_KEY}`, "+new line"));
    expect([...s.findings]).toEqual(["commit a1 message: xoxb-"]);
    expect([...s.commits]).toEqual(["a1"]);
  });
  it("a merge shown per parent, an empty commit, «no newline» markers and empty context lines are understood", () => {
    const text =
      head("m1") + "\n" + hunk("f.txt", "-a", `+${OPENAI_KEY}`) + head("m1") + "\n" + hunk("f.txt", "-b", `+${OPENAI_KEY}`, "\\ No newline at end of file") +
      head("e1", "empty") + head("c1") + "\n" + hunk("g.txt", " one", "", "-two", "+three");
    const s = feed(text);
    expect([...s.findings]).toEqual(["f.txt: sk-"]);
    expect([...s.commits]).toEqual(["m1", "e1", "c1"]);
  });
  it("a content line that looks like a header is content: hunks are followed by their counts", () => {
    const s = feed(head("a1") + "\n" + hunk("x.ts", "+diff --git a/y b/y", "+\0commit zz", `+${OPENAI_KEY}`));
    expect([...s.findings]).toEqual(["x.ts: sk-"]);
    expect([...s.commits]).toEqual(["a1"]);
  });
  it("anything it does not expect is a scan error — binary patches, combined diffs, stray lines, cut-off streams", () => {
    const bad = [
      head("a1") + "\ndiff --git a/b.bin b/b.bin\nindex 1..2 100644\nBinary files a/b.bin and b/b.bin differ\n",
      head("a1") + "\ndiff --git a/b.bin b/b.bin\nindex 1..2 100644\nGIT binary patch\nliteral 5\n",
      head("a1") + "\ndiff --cc f.txt\n@@@ -1,1 -1,1 +1,1 @@@\n",
      head("a1") + "\nsomething else\n",
      head("a1") + "\n" + hunk("x.ts", "+a").replace("@@ -1,0 +1,1 @@", "@@ -1,0 +1,3 @@"),
      "\0commit a1\nmessage without an end",
      "not a header\n",
      head("a1") + "\n" + hunk("x.ts", "+a") + "*stray\n",
    ];
    for (const text of bad) expect(() => feed(text), JSON.stringify(text.slice(0, 40))).toThrow(ScanError);
  });
  it("its error never quotes the line: it may be file content", () => {
    try {
      feed(head("a1") + `\nstray ${OPENAI_KEY}\n`);
      throw new Error("no error");
    } catch (e) {
      expect(String(e)).not.toContain(OPENAI_KEY);
      expect(String(e)).toContain("between commits");
    }
  });
});

test("this repository passes its own scanner: no tracked file has a finding or a key-file name", () => {
  const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
  let files: string[];
  try {
    files = execFileSync("git", ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" }).split("\0").filter(Boolean);
  } catch {
    return; // not a git checkout (an unpacked release): nothing to compare against
  }
  const found: string[] = [];
  for (const f of files) {
    if (secretFileName(f)) found.push(`${f}: key file by name`);
    for (const label of secretFindings(readFileSync(join(root, f), "latin1"))) found.push(`${f}: ${label}`);
  }
  expect(found).toEqual([]);
});
