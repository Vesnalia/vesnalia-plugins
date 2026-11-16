// GitHub as the source of truth: the repository and the work branch, the key check before a push, the PR, the rollout blocker, main after «Accept»,
// the catalog reconcile and pulling changes from GitHub in «Adopt as rolled out».
import { describe, expect, test, vi } from "vitest";
import { Catalog, githubLabels, reworkBlockers } from "./catalog";
import { Engine, GITHUB_RETRY_MS } from "./engine";
import { Rollout } from "./rollout";
import { livePath, pluginDir, verifyPath } from "./stages";
import { commitWork, idleStage, moveTo, reviewed, setup, started, versionOf, type Setup, type Started } from "./test-utils";
import { GITHUB_TOKEN, OPENAI_KEY, SLACK_TOKEN } from "./test-tokens";

/** The catalog as wired: main reaches GitHub only through the engine's publication gate. */
const catalogOf = (s: Setup) => new Catalog(s.store, s.ports, (dir, sha, branch) => s.engine.publish(dir, sha, branch));

const REPO = "https://github.com/acme/bb-plugin-hello.git";

async function ready(s?: Started) {
  const r = s ?? (await started());
  idleStage(r);
  r.ports.files.set(`${r.env}:${r.docs.tz}`, "### Task 1: A\nMIGRATIONS: no\nNAV: none\n");
  await moveTo(r, 5);
  r.ports.files.set(`${r.env}:${verifyPath(r.key, 1)}`, "all good\nVERDICT: PASS");
  reviewed(r, 5, "verify", await versionOf(r));
  r.ports.plugins.add({ id: "hello" });
  const catalog = catalogOf(r);
  await catalog.sync();
  return { ...r, catalog, rollout: new Rollout(r.store, r.ports, r.engine, catalog, { cancelSupported: true }) };
}
type Rig = Awaited<ReturnType<typeof ready>>;
async function enterDone(r: Rig): Promise<string> {
  expect(await r.rollout.enter(r.id, { expectedVersion: await versionOf(r), force: false })).toMatchObject({ ok: true });
  for (const j of await r.ports.plugins.jobs()) if (["queued", "running"].includes(j.state)) r.ports.plugins.setJob(j.id, "succeeded");
  const a = r.store.currentAttempt("hello")!.id;
  await r.rollout.advance(a);
  idleStage(r, 6);
  return a;
}

describe("the work branch on GitHub", () => {
  test("no origin: a private repo, main is sent; the work branch goes with its exact commit; a PR opens from Implementation, once", async () => {
    const s = await started();
    idleStage(s);
    await s.engine.reconcile(s.id);
    expect(s.ports.github.repos.has("acme/alia-plugin-hello")).toBe(true);
    expect(await s.ports.github.remote(s.dir)).toBe(REPO);
    expect(await s.ports.github.remoteSha(s.dir, "main")).toBe((await s.ports.git.facts(s.dir)).head);
    expect(await s.ports.github.remoteSha(s.dir, `alia/${s.env}`)).toBe("h1");
    expect(s.store.work(s.id)).toMatchObject({ pushed_sha: "h1", pushed_branch: `alia/${s.env}`, pr_url: null });
    // Only main and the work branch — nothing «all at once».
    expect(s.ports.calls.filter((c) => c.effect === "github.push").flatMap((c) => c.args[1] as string[]).some((x) => x.includes("*"))).toBe(false);
    expect(s.ports.github.prs).toHaveLength(0);

    commitWork(s, "h2");
    await moveTo(s, 4);
    await s.engine.reconcile(s.id);
    expect(await s.ports.github.remoteSha(s.dir, `alia/${s.env}`)).toBe("h2");
    expect(s.ports.github.prs).toHaveLength(1);
    expect(s.ports.github.prs[0]).toMatchObject({ branch: `alia/${s.env}`, title: `${s.key}: ${s.w.title}` });
    expect(s.store.work(s.id)!.pr_url).toBe("https://github.com/acme/bb-plugin-hello/pull/1");
    expect([...s.ports.taskRows.values()].flatMap((t) => t.comments).some((c) => c.includes("PR on GitHub: https://github.com/acme/bb-plugin-hello/pull/1"))).toBe(true);
    await s.engine.reconcile(s.id);
    expect(s.ports.github.prs).toHaveLength(1);
  });

  test("something like a key in the new commits: not sent, said once in the journal and to the autopilot", async () => {
    const s = await started();
    idleStage(s);
    await s.engine.reconcile(s.id);
    commitWork(s, "h3");
    s.ports.git.commitFiles.set("h3", { "server.ts": `const key = '${OPENAI_KEY}';\n` });
    await s.engine.reconcile(s.id);
    await s.engine.reconcile(s.id);
    expect(await s.ports.github.remoteSha(s.dir, `alia/${s.env}`)).toBe("h1");
    expect(s.engine.githubProblem(s.id)).toContain("the work branch looks like it contains keys — not pushed to GitHub: server.ts: sk-");
    expect(s.store.events(s.id).filter((e) => e.text.includes("looks like it contains keys")).length).toBe(1);
    expect(JSON.stringify(s.store.events(s.id))).not.toContain(OPENAI_KEY);
  });

  test("a key added in one commit and removed in the next is still found: every outgoing commit is scanned, not the tree", async () => {
    const s = await started();
    idleStage(s);
    await s.engine.reconcile(s.id);
    commitWork(s, "h2");
    commitWork(s, "h3");
    s.ports.git.commitFiles.set("h2", { "config.ts": `export const t = "${GITHUB_TOKEN}";\n` });
    s.ports.git.commitFiles.set("h3", { "config.ts": "export const t = process.env.T;\n" });
    await s.engine.reconcile(s.id);
    expect(await s.ports.github.remoteSha(s.dir, `alia/${s.env}`)).toBe("h1");
    expect(s.engine.githubProblem(s.id)).toContain("config.ts: ghp_");
  });

  test("test files are not exempt; a key file by name and a key in a commit message are findings; synthetic values are not", async () => {
    const s = await started();
    idleStage(s);
    await s.engine.reconcile(s.id);
    commitWork(s, "h2");
    s.ports.git.commitFiles.set("h2", { "server.test.ts": `const fake = "ghp_${"FAKE".repeat(9)}";\nconst real = "${SLACK_TOKEN}";\n`, "dir with space/prod.env": "PASSWORD=hunter2\n" });
    s.ports.git.commitMessages.set("h2", `add config\n\ntoken: ${OPENAI_KEY}`);
    await s.engine.reconcile(s.id);
    const problem = s.engine.githubProblem(s.id)!;
    expect(problem).toContain("dir with space/prod.env: key file by name");
    expect(problem).toContain("server.test.ts: xoxb-");
    expect(problem).toContain("commit h2 message: sk-");
    expect(problem).not.toContain("ghp_");
    expect(await s.ports.github.remoteSha(s.dir, `alia/${s.env}`)).toBe("h1");
  });

  test("a work branch with only synthetic values is published", async () => {
    const s = await started();
    idleStage(s);
    await s.engine.reconcile(s.id);
    commitWork(s, "h2");
    s.ports.git.commitFiles.set("h2", { "server.test.ts": `const t = "ghp_${"FAKE".repeat(9)}";\nconst z = "sk-${"0".repeat(30)}";\n` });
    await s.engine.reconcile(s.id);
    expect(await s.ports.github.remoteSha(s.dir, `alia/${s.env}`)).toBe("h2");
    expect(s.engine.githubProblem(s.id)).toBeNull();
  });

  test("an incomplete scan refuses the push (fail-closed), and says why", async () => {
    const s = await started();
    idleStage(s);
    await s.engine.reconcile(s.id);
    commitWork(s, "h2");
    s.ports.github.logFails = "more than 64 MB of changes";
    await s.engine.reconcile(s.id);
    expect(await s.ports.github.remoteSha(s.dir, `alia/${s.env}`)).toBe("h1");
    expect(s.engine.githubProblem(s.id)).toContain("the publication scan did not complete: more than 64 MB of changes — nothing is pushed");
    // Output the scan does not understand is a failed scan too, not a clean one.
    s.ports.github.logFails = null;
    commitWork(s, "h3");
    s.ports.git.commitLogs.set("h3", "\0commit h3\nmsg\n\0end\n\ndiff --git a/x b/x\n+no hunk header\n");
    await s.engine.reconcile(s.id);
    expect(await s.ports.github.remoteSha(s.dir, `alia/${s.env}`)).toBe("h1");
    expect(s.engine.githubProblem(s.id)).toContain("the publication scan did not complete: unexpected git log output");
  });

  test("the first push of main scans its whole history: a key deleted long ago still stops it — neither main nor the branch is sent", async () => {
    const s = await started();
    idleStage(s);
    const main = (await s.ports.git.facts(s.dir)).head!;
    s.ports.git.commitFiles.set(main, { "old.ts": `const t = "${OPENAI_KEY}";\n` });
    await s.engine.reconcile(s.id);
    expect(await s.ports.github.remoteSha(s.dir, "main")).toBeNull();
    expect(await s.ports.github.remoteSha(s.dir, `alia/${s.env}`)).toBeNull();
    expect(s.engine.githubProblem(s.id)).toContain("main looks like it contains keys — not pushed to GitHub: old.ts: sk-");
    expect(s.ports.count("github.push")).toBe(0);
  });

  test("a GitHub failure does not hold the work; it is retried after a pause or with a new commit, not every minute", async () => {
    const s = await started();
    idleStage(s);
    s.ports.failAt("github.push");
    await s.engine.reconcile(s.id);
    expect(s.store.work(s.id)!.state).toBe("owner");
    expect(s.engine.githubProblem(s.id)).toContain("failure before github.push");
    s.ports.failAt(null);
    const pushes = s.ports.count("github.push");
    await s.engine.reconcile(s.id);
    expect(s.ports.count("github.push")).toBe(pushes);
    s.ports.t += GITHUB_RETRY_MS + 1;
    await s.engine.reconcile(s.id);
    expect(await s.ports.github.remoteSha(s.dir, `alia/${s.env}`)).toBe("h1");
    expect(s.engine.githubProblem(s.id)).toBeNull();
  });
});

describe("rollout and acceptance", () => {
  test("«Roll out» is closed while GitHub main has commits the work branch lacks", async () => {
    const r = await ready();
    const before = (await r.ports.git.facts(r.dir)).head!;
    const theirs = r.ports.git.sha();
    r.ports.git.link(theirs, before);
    r.ports.github.setBranch(r.dir, "main", theirs);
    const res = await r.rollout.enter(r.id, { expectedVersion: await versionOf(r), force: true });
    expect(res.ok).toBe(false);
    expect(res.blockers.join(" ")).toContain("main on GitHub has commits that are not in the work branch");
  });

  test("after «Accept» the rolled-out main is on GitHub and the work branch is deleted there", async () => {
    const r = await ready();
    await r.engine.reconcile(r.id);
    expect(await r.ports.github.remoteSha(r.dir, `alia/${r.env}`)).toBe("h1");
    const a = await enterDone(r);
    // Until accepted, main does not go to GitHub: a rollback could leave the rejected code there.
    expect(await r.ports.github.remoteSha(r.dir, "main")).not.toBe("h1");
    // The catalog reconcile during the live check does not push main either: the work is open.
    await r.catalog.githubOne("hello");
    expect(await r.ports.github.remoteSha(r.dir, "main")).not.toBe("h1");
    r.ports.files.set(`${r.env}:${livePath(r.key, 1)}`, "works\nVERDICT: PASS");
    // GitHub marked the PR merged — the branch can be deleted (otherwise deleting it would close the PR unmerged).
    r.ports.github.merged.add(`${r.dir}#alia/${r.env}`);
    expect(await r.rollout.accept(r.id, { expectedVersion: await versionOf(r), attemptId: a, force: false, note: "" })).toMatchObject({ ok: true });
    expect(await r.ports.github.remoteSha(r.dir, "main")).toBe("h1");
    expect(await r.ports.github.remoteSha(r.dir, `alia/${r.env}`)).toBeNull();
    expect(r.store.plugin("hello")).toMatchObject({ gh_remote: REPO, gh_ahead: 0, gh_behind: 0, gh_error: null });
  });
});

describe("the branch after acceptance", () => {
  test("GitHub has not marked the PR merged yet — the branch stays; the next GitHub pass deletes it once merged", async () => {
    const r = await ready();
    await r.engine.reconcile(r.id);
    const a = await enterDone(r);
    r.ports.files.set(`${r.env}:${livePath(r.key, 1)}`, "works\nVERDICT: PASS");
    expect(await r.rollout.accept(r.id, { expectedVersion: await versionOf(r), attemptId: a, force: false, note: "" })).toMatchObject({ ok: true });
    expect(await r.ports.github.remoteSha(r.dir, `alia/${r.env}`)).toBe("h1");
    expect(r.store.work(r.id)!.pushed_branch).toBe(`alia/${r.env}`);
    await r.rollout.githubOne("hello");
    expect(await r.ports.github.remoteSha(r.dir, `alia/${r.env}`)).toBe("h1");
    r.ports.github.merged.add(`${r.dir}#alia/${r.env}`);
    await r.rollout.githubOne("hello");
    expect(await r.ports.github.remoteSha(r.dir, `alia/${r.env}`)).toBeNull();
    expect(r.store.work(r.id)!.pushed_branch).toBeNull();
  });
});

describe("rollback after acceptance", () => {
  test("the rolled-back commit left on GitHub is not pulled back: a label, «Rework» open, «Roll out» warns instead of blocking", async () => {
    const r = await ready();
    await r.engine.reconcile(r.id);
    const a = await enterDone(r);
    r.ports.files.set(`${r.env}:${livePath(r.key, 1)}`, "works\nVERDICT: PASS");
    expect(await r.rollout.accept(r.id, { expectedVersion: await versionOf(r), attemptId: a, force: false, note: "" })).toMatchObject({ ok: true });
    expect(await r.ports.github.remoteSha(r.dir, "main")).toBe("h1");
    await r.rollout.rollback("hello", "broke after acceptance");
    for (const j of await r.ports.plugins.jobs()) if (["queued", "running"].includes(j.state)) r.ports.plugins.setJob(j.id, "succeeded");
    await r.rollout.advance(r.store.currentAttempt("hello")!.id);
    expect(r.store.currentAttempt("hello")).toMatchObject({ kind: "rollback", status: "done" });
    await r.catalog.githubOne("hello");
    const f = (await r.catalog.one("hello"))!;
    expect(githubLabels(f)).toEqual(["a rolled-back commit remains on GitHub — revert it on GitHub (manually)"]);
    expect(reworkBlockers(f).some((b) => b.includes("GitHub"))).toBe(false);
    expect((await r.rollout.availability("hello")).adopt).toBe("the main branch is at the rolled-out commit — nothing to adopt");
  });
});

describe("catalog reconcile with GitHub", () => {
  async function plain() {
    const s = setup();
    const dir = pluginDir("mail");
    s.ports.fs.put(dir);
    s.ports.git.setRepo(dir, {});
    s.ports.plugins.add({ id: "mail" });
    const catalog = catalogOf(s);
    await catalog.sync();
    return { ...s, catalog, dir, rollout: new Rollout(s.store, s.ports, s.engine, catalog, { cancelSupported: true }) };
  }
  const labels = async (c: Catalog) => githubLabels((await c.one("mail"))!);

  test("no repo, rolled-out main pushed, GitHub newer and diverged — each said on the card; nothing pulled by the sync", async () => {
    const s = await plain();
    await s.catalog.githubOne("mail");
    expect(await labels(s.catalog)).toEqual(["no repository on GitHub"]);
    await s.ports.github.setRemote(s.dir, "https://github.com/acme/bb-plugin-mail.git");
    const head = (await s.ports.git.facts(s.dir)).head!;
    s.store.setInstalled("mail", head);
    await s.catalog.githubOne("mail");
    expect(await s.ports.github.remoteSha(s.dir, "main")).toBe(head);
    expect(await labels(s.catalog)).toEqual([]);
    // A local commit that is not rolled out is not pushed: GitHub holds what is rolled out.
    s.ports.git.commit(s.dir);
    await s.catalog.githubOne("mail");
    expect(await labels(s.catalog)).toEqual(["GitHub is behind by 1"]);
    // GitHub got its own commit on top of the rolled-out one — they diverged.
    const theirs = s.ports.git.sha();
    s.ports.git.link(theirs, head);
    s.ports.github.setBranch(s.dir, "main", theirs);
    await s.catalog.githubOne("mail");
    expect(await labels(s.catalog)).toEqual(["main diverged from GitHub"]);
    expect(reworkBlockers((await s.catalog.one("mail"))!)).toContain("main diverged from GitHub — needs sorting out");
  });

  test("GitHub newer: «Rework» waits; «Adopt as rolled out» pulls it fast-forward and installs it", async () => {
    const s = await plain();
    await s.ports.github.setRemote(s.dir, "https://github.com/acme/bb-plugin-mail.git");
    const head = (await s.ports.git.facts(s.dir)).head!;
    s.store.setInstalled("mail", head);
    await s.catalog.githubOne("mail");
    const theirs = s.ports.git.sha();
    s.ports.git.link(theirs, head);
    s.ports.github.setBranch(s.dir, "main", theirs);
    await s.catalog.githubOne("mail");
    expect(await labels(s.catalog)).toEqual(["GitHub is ahead by 1"]);
    expect(reworkBlockers((await s.catalog.one("mail"))!)).toContain("GitHub is ahead — first «Adopt as rolled out» (pulls from GitHub)");
    expect((await s.rollout.availability("mail")).adopt).toBeNull();
    await s.rollout.adopt("mail", "a change made on GitHub");
    expect((await s.ports.git.facts(s.dir)).head).toBe(theirs);
    const a = s.store.currentAttempt("mail")!;
    expect(a).toMatchObject({ kind: "enter", work_id: null, before_sha: head, target_sha: theirs });
  });
});

describe("the destination", () => {
  test("an existing public origin: nothing is pushed, the reason is where GitHub errors are shown; its visibility is not touched", async () => {
    const s = await started();
    await s.ports.github.setRemote(s.dir, "https://github.com/acme/bb-plugin-hello.git");
    s.ports.github.repoInfos.set("acme/alia-plugin-hello", { visibility: "PUBLIC", owner: "acme", nameWithOwner: "acme/alia-plugin-hello" });
    idleStage(s);
    await s.engine.reconcile(s.id);
    expect(s.ports.count("github.push")).toBe(0);
    expect(s.ports.count("github.ensureRepo")).toBe(0);
    expect(s.engine.githubProblem(s.id)).toContain("acme/alia-plugin-hello is public — the Workshop publishes only to private repositories");
    expect(s.store.events(s.id).some((e) => e.text.includes("is public"))).toBe(true);
    // A refused destination is the commit's verdict too: `failed` with the reason — a warning for the owner, a hard stop for the autopilot.
    expect(JSON.parse(s.store.work(s.id)!.gh_scan!)).toMatchObject({ sha: "h1", state: "failed", text: expect.stringContaining("is public") });
  });

  test("a repository of another owner, several push URLs, a URL that is not GitHub, a repository GitHub does not show — all refused", async () => {
    const cases: Array<[(s: Started) => void, string]> = [
      [(s) => s.ports.github.repoInfos.set("acme/alia-plugin-hello", { visibility: "PRIVATE", owner: "someone", nameWithOwner: "someone/alia-plugin-hello" }), "belongs to someone, not to acme"],
      [(s) => s.ports.github.pushUrlsOf.set(s.dir, ["https://github.com/acme/bb-plugin-hello.git", "https://github.com/acme/mirror.git"]), "origin has 2 push URLs"],
      [(s) => s.ports.github.pushUrlsOf.set(s.dir, ["https://gitlab.example.com/acme/bb-plugin-hello.git"]), "is not a GitHub repository"],
      [(s) => s.ports.github.repoInfos.set("acme/alia-plugin-hello", null), "GitHub does not show the repository acme/alia-plugin-hello"],
    ];
    for (const [arrange, why] of cases) {
      const s = await started();
      await s.ports.github.setRemote(s.dir, "https://github.com/acme/bb-plugin-hello.git");
      arrange(s);
      idleStage(s);
      await s.engine.reconcile(s.id);
      expect(s.ports.count("github.push")).toBe(0);
      expect(s.engine.githubProblem(s.id)).toContain(why);
    }
  });

  test("«Allow public repositories» is the only way to publish to a public or foreign repository", async () => {
    const s0 = await started();
    const s = { ...s0, engine: new Engine(s0.store, s0.ports, () => ({ maxBuilding: 2, minFreeDiskGb: 2, autoReview: false, mockup: false, githubOwner: "acme", allowPublicRepos: true })) };
    await s.ports.github.setRemote(s.dir, "https://github.com/acme/bb-plugin-hello.git");
    s.ports.github.repoInfos.set("acme/alia-plugin-hello", { visibility: "PUBLIC", owner: "other", nameWithOwner: "other/alia-plugin-hello" });
    idleStage(s);
    await s.engine.reconcile(s.id);
    expect(await s.ports.github.remoteSha(s.dir, `alia/${s.env}`)).toBe("h1");
  });
});

describe("a key on the work branch holds the work", () => {
  test("«To verification» and «Roll out» are blocked by a finding — force does not lift it; an incomplete scan is only a warning", async () => {
    const r = await ready();
    commitWork(r, "h2");
    r.ports.git.commitFiles.set("h2", { "server.ts": `const t = "${OPENAI_KEY}";\n` });
    await r.engine.reconcile(r.id);
    expect(r.store.work(r.id)!.gh_scan).toContain('"state":"findings"');
    const res = await r.rollout.enter(r.id, { expectedVersion: await versionOf(r), force: true });
    expect(res.ok).toBe(false);
    expect(res.blockers.join(" ")).toContain("the work branch looks like it contains keys — not published, rolled out or accepted until it is removed from the branch history: server.ts: sk-");
    expect(r.store.currentAttempt("hello")).toBeNull();
    // Back to Implementation: «To verification» with force is refused too.
    await moveTo(r, 4);
    const fwd = await r.engine.handOver(r.id, { expectedStage: 4, expectedVersion: await versionOf(r), note: "", force: true });
    expect(fwd.ok).toBe(false);
    expect(fwd.blockers.join(" ")).toContain("looks like it contains keys");
    // The key is removed from the history (the branch is back without it): the verdict is about another commit, nothing holds the work.
    r.ports.heads.set(r.env, "h1");
    r.ports.t += GITHUB_RETRY_MS + 1;
    await r.engine.reconcile(r.id);
    expect((await r.engine.view(r.id)).blockers.join(" ")).not.toContain("keys");
    // An incomplete scan: a warning, not a blocker.
    commitWork(r, "h4");
    r.ports.github.logFails = "git log: exit 128";
    await r.engine.reconcile(r.id);
    const view = await r.engine.view(r.id);
    expect(view.blockers.join(" ")).not.toContain("keys");
    expect(view.warnings.join(" ")).toContain("the work branch is not on GitHub: the publication scan did not complete");
  });
});

describe("the publication verdict at the gates", () => {
  test("«To verification» without a verdict for the current commit runs the check first (scan only): a finding is a blocker, nothing is pushed", async () => {
    const r = await started();
    idleStage(r);
    await r.engine.reconcile(r.id);
    await moveTo(r, 4);
    r.ports.files.set(`${r.env}:${r.docs.tz}`, "### Task 1: A\nMIGRATIONS: no\nNAV: none\n");
    r.ports.files.set(`${r.env}:.superpowers/sdd/tz/progress.md`, "Task 1: complete\n");
    // A new commit the reconcile has not seen: no verdict for it — the page says so, as a warning.
    commitWork(r, "h5");
    r.ports.git.commitFiles.set("h5", { "src/x.ts": `const k = "${GITHUB_TOKEN}";\n` });
    expect((await r.engine.view(r.id)).warnings).toContain("the work branch's current commit has not been checked for publication yet");
    const pushes = r.ports.count("github.push");
    const res = await r.engine.handOver(r.id, { expectedStage: 4, expectedVersion: await versionOf(r), note: "", force: true });
    expect(res.ok).toBe(false);
    expect(res.blockers.join(" ")).toContain("src/x.ts: ghp_");
    expect(JSON.parse(r.store.work(r.id)!.gh_scan!)).toMatchObject({ sha: "h5", state: "findings" });
    expect(r.ports.count("github.push")).toBe(pushes);
    // A clean commit: checked at the button and handed over.
    commitWork(r, "h6");
    r.ports.git.commitFiles.set("h5", {});
    expect(await r.engine.handOver(r.id, { expectedStage: 4, expectedVersion: await versionOf(r), note: "", force: false })).toMatchObject({ ok: true });
    expect(JSON.parse(r.store.work(r.id)!.gh_scan!)).toMatchObject({ sha: "h6", state: "clean" });
    expect(r.ports.count("github.push")).toBe(pushes);
  });

  test("«Roll out» without a verdict runs the check; a request that fails on the way is a failed check — a warning the owner may force", async () => {
    const r = await ready();
    r.store.setScan(r.id, null);
    vi.spyOn(r.ports.github, "remoteHeads").mockRejectedValue(new Error("git ls-remote: could not read from remote repository"));
    const res = await r.rollout.enter(r.id, { expectedVersion: await versionOf(r), force: false });
    expect(res).toMatchObject({ ok: false, blockers: [] });
    expect(res.warnings.join(" ")).toContain("the work branch is not on GitHub: the publication check did not complete: git ls-remote: could not read from remote repository");
    expect(JSON.parse(r.store.work(r.id)!.gh_scan!)).toMatchObject({ sha: "h1", state: "failed" });
    expect(await r.rollout.enter(r.id, { expectedVersion: await versionOf(r), force: true })).toMatchObject({ ok: true });
  });

  test("a verdict is tied to its commit, destination and policy: another policy or push URL reads as not checked", async () => {
    const s0 = await started();
    idleStage(s0);
    await s0.engine.reconcile(s0.id);
    expect(JSON.parse(s0.store.work(s0.id)!.gh_scan!)).toMatchObject({ sha: "h1", state: "clean", dest: REPO, policy: "acme|private" });
    const v = await versionOf(s0);
    expect(await s0.engine.publicationOf(s0.w, v)).toEqual({ state: "clean", text: "1 new commit checked" });
    const open = new Engine(s0.store, s0.ports, () => ({ maxBuilding: 2, minFreeDiskGb: 2, autoReview: false, mockup: false, githubOwner: "acme", allowPublicRepos: true }));
    expect(await open.publicationOf(s0.w, v)).toEqual({ state: "unscanned", text: "" });
    s0.ports.github.pushUrlsOf.set(s0.dir, ["https://github.com/acme/elsewhere.git"]);
    expect(await s0.engine.publicationOf(s0.w, v)).toEqual({ state: "unscanned", text: "" });
    // A record in an older shape is no verdict either.
    s0.ports.github.pushUrlsOf.delete(s0.dir);
    s0.store.setScan(s0.id, JSON.stringify({ sha: "h1", kind: "secrets", text: "x" }));
    expect(await s0.engine.publicationOf(s0.w, v)).toEqual({ state: "unscanned", text: "" });
    // Already pushed, but no current verdict: the reconcile checks it again (scan only).
    s0.ports.t += GITHUB_RETRY_MS + 1;
    await s0.engine.reconcile(s0.id);
    expect(await s0.engine.publicationOf(s0.w, v)).toMatchObject({ state: "clean" });
  });

  test("a failed check of a pushed commit is checked again after the retry pause; a later failure does not undo a completed check", async () => {
    const s = await started();
    idleStage(s);
    await s.engine.reconcile(s.id);
    expect(JSON.parse(s.store.work(s.id)!.gh_scan!)).toMatchObject({ sha: "h1", state: "clean" });
    // A failure on the way to GitHub after the check has completed for this commit, destination and policy: the verdict stays.
    vi.spyOn(s.ports.github, "remote").mockRejectedValueOnce(new Error("git remote get-url: I/O error"));
    await s.engine.reconcile(s.id);
    expect(s.engine.githubProblem(s.id)).toContain("I/O error");
    expect(JSON.parse(s.store.work(s.id)!.gh_scan!)).toMatchObject({ sha: "h1", state: "clean" });
    // A check that failed for the pushed commit is not final: after the pause the reconcile runs it again.
    vi.spyOn(s.ports.github, "remoteHeads").mockRejectedValueOnce(new Error("git ls-remote: timed out"));
    expect(await s.engine.scanNow(s.store.work(s.id)!, "h1")).toMatchObject({ state: "failed", text: expect.stringContaining("timed out") });
    s.ports.t += GITHUB_RETRY_MS + 1;
    await s.engine.reconcile(s.id);
    expect(JSON.parse(s.store.work(s.id)!.gh_scan!)).toMatchObject({ sha: "h1", state: "clean" });
  });

  test("with GitHub off none of it applies: no verdict, no check, no warning", async () => {
    const base = setup();
    const r = await started({ ...base, engine: new Engine(base.store, base.ports, () => ({ maxBuilding: 2, minFreeDiskGb: 2, autoReview: false, mockup: false, githubOwner: "" })) });
    idleStage(r);
    await moveTo(r, 4);
    commitWork(r, "h5");
    r.ports.git.commitFiles.set("h5", { "src/x.ts": `const k = "${GITHUB_TOKEN}";\n` });
    r.ports.files.set(`${r.env}:${r.docs.tz}`, "### Task 1: A\nMIGRATIONS: no\nNAV: none\n");
    r.ports.files.set(`${r.env}:.superpowers/sdd/tz/progress.md`, "Task 1: complete\n");
    expect(await r.engine.publicationOf(r.w, await versionOf(r))).toBeNull();
    expect(await r.engine.handOver(r.id, { expectedStage: 4, expectedVersion: await versionOf(r), note: "", force: false })).toMatchObject({ ok: true });
    expect(r.store.work(r.id)!.gh_scan).toBeNull();
  });
});

describe("main reaches GitHub only through the gate", () => {
  test("accepted main with a key in a commit GitHub does not have: not pushed, the card shows why", async () => {
    const s = setup();
    const dir = pluginDir("mail");
    s.ports.fs.put(dir);
    s.ports.git.setRepo(dir, {});
    s.ports.plugins.add({ id: "mail" });
    const catalog = catalogOf(s);
    await catalog.sync();
    await s.ports.github.setRemote(dir, "https://github.com/acme/bb-plugin-mail.git");
    const base = (await s.ports.git.facts(dir)).head!;
    s.ports.github.setBranch(dir, "main", base);
    // A change made in the working copy bypassing the Workshop, then adopted: main moved ahead with a key in it.
    const head = s.ports.git.commit(dir);
    s.ports.git.commitFiles.set(head, { "lib/client.ts": `const key = "${GITHUB_TOKEN}";\n` });
    s.store.setInstalled("mail", head);
    await catalog.githubOne("mail");
    expect(await s.ports.github.remoteSha(dir, "main")).toBe(base);
    expect(s.store.plugin("mail")!.gh_error).toContain("main looks like it contains keys — not pushed to GitHub: lib/client.ts: ghp_");
    expect(githubLabels((await catalog.one("mail"))!)[0]).toMatch(/^GitHub check failed: main looks like it contains keys/);
    // Without the gate the catalog never pushes at all.
    s.ports.git.commitFiles.delete(head);
    await new Catalog(s.store, s.ports).githubOne("mail");
    expect(await s.ports.github.remoteSha(dir, "main")).toBe(base);
    await catalog.githubOne("mail");
    expect(await s.ports.github.remoteSha(dir, "main")).toBe(head);
  });

  test("the low-level push refuses anything that is not a fresh gate clearance for the same folder", async () => {
    const s = await started();
    await s.ports.github.setRemote(s.dir, "https://github.com/acme/bb-plugin-hello.git");
    const forged = Object.freeze({ dir: s.dir, sha: "h1", url: "https://github.com/acme/bb-plugin-hello.git", repo: "acme/alia-plugin-hello" });
    await expect(s.ports.github.push(s.dir, forged, "main")).rejects.toThrow(/no publication gate result/);
    const { publicationGate } = await import("./publish");
    const g = await publicationGate(s.ports.github, s.dir, "h1", s.engine.publishPolicy());
    if (!g.ok) throw new Error(g.reason);
    await expect(s.ports.github.push("/elsewhere", g.clearance, "main")).rejects.toThrow(/no publication gate result/);
    await s.ports.github.push(s.dir, g.clearance, "x");
    await expect(s.ports.github.push(s.dir, g.clearance, "y")).rejects.toThrow(/no publication gate result/);
    expect(await s.ports.github.remoteSha(s.dir, "x")).toBe("h1");
    expect(await s.ports.github.remoteSha(s.dir, "y")).toBeNull();
  });
});

describe("the PR address", () => {
  test("an answer that is not a PR of exactly the checked repository is neither stored nor shown", async () => {
    for (const answer of ["https://evil.example/acme/bb-plugin-hello/pull/1", "https://github.com/other/repo/pull/1", "javascript:alert(1)", "Created!\n"]) {
      const s = await started();
      idleStage(s);
      s.ports.github.prAnswer = answer;
      await moveTo(s, 4);
      await s.engine.reconcile(s.id);
      expect(s.store.work(s.id)!.pr_url).toBeNull();
      expect(s.engine.githubProblem(s.id)).toContain("not a PR of acme/alia-plugin-hello");
    }
  });
});

describe("remove from board", () => {
  test("only a gone plugin is hidden; the board skips it; it comes back when seen again", async () => {
    const { Api } = await import("./api");
    const s = setup();
    s.ports.fs.put(pluginDir("mail"));
    s.ports.git.setRepo(pluginDir("mail"), {});
    s.ports.plugins.add({ id: "mail" });
    const catalog = new Catalog(s.store, s.ports);
    await catalog.sync();
    const api = new Api({ store: s.store, catalog, engine: s.engine, rollout: new Rollout(s.store, s.ports, s.engine, catalog, { cancelSupported: true }) });
    expect(s.store.hidePlugin("mail", 1)).toBe(false);
    s.store.markGone("mail", "plugin not installed, no folder", 2);
    expect(s.store.hidePlugin("mail", 3)).toBe(true);
    expect((await api.board()).plugins.map((p) => p.id)).not.toContain("mail");
    s.store.upsertSeen({ id: "mail", name: "mail", dir: pluginDir("mail"), source: null }, 4);
    expect(s.store.plugin("mail")!.hidden_at).toBeNull();
    expect((await api.board()).plugins.map((p) => p.id)).toContain("mail");
  });
});
