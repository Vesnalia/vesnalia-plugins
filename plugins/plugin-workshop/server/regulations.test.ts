import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, test } from "vitest";
import { DEFAULT_MODELS } from "./models";
import { identity, inputsChanged, kickoff, liveCheckPrompt, regulationOf, returnPacket, reviewerPrompt, reviewsReady, threadTitle } from "./regulations";
import { BUILD_LOCK, BUILTIN_SKILLS, browserRecipePath, DOCS_ROOT, navGuidePath, pathSettingProblem, rulesText, setBuildLock, setDocsRoot, shq, stageKnowledge } from "./rules";
import { pluginDir, STAGES, stageOf, type StageNo } from "./stages";
import type { AttemptRow, WorkRow } from "./store";

function fakeWork(o: Partial<WorkRow> = {}): WorkRow {
  return {
    id: "w_1", plugin_id: "hello", kind: "rework", created: 1, task_id: "t1", task_key: "TEST-12", tasks_project_id: "tp1", project_id: "p1", host_id: "h1",
    title: "Export", request: "Make a CSV export", stage: 1, iteration: 1, environment_id: "env_1", base_branch: "main", queued: 0, entry: null, base_ahead: 0,
    state: "agent", state_reason: "", stale: 0, task_synced: null, cleanup_done: 1, created_at: 1, updated_at: 1, finished_at: null, outcome: null, pushed_sha: null, pr_url: null, pushed_branch: null, models: null, gh_scan: null, ...o,
  };
}
function attempt(o: Partial<AttemptRow> = {}): AttemptRow {
  return {
    id: "a_1", plugin_id: "hello", work_id: "w_1", kind: "enter", before_sha: "0000000aaaa", target_sha: "abc1234def", migrations: 0, was_installed: 1, was_enabled: 1,
    want_enabled: 1, step: "checked", status: "done", known_job_ids: null, foreign_job_id: null, job_id: "7", error: null, lock_token: null, lock_held: 0,
    started_at: 1, updated_at: 1, resolved_at: null, origin_id: null, note: null, job_state: "succeeded", from_sha: null, ...o,
  };
}

const w = fakeWork();
const ALL = [1, 2, 3, 7, 4, 5, 6] as StageNo[];
/** Skills the stage knowledge may name besides VesnALIA's built-in ones (a typical skill library), without calling VesnALIA. VesnALIA's built-in skills are not in it. */
const LIBRARY = ["brainstorming", "writing-plans", "subagent-driven-development", "test-driven-development", "verification-before-completion", "finishing-a-development-branch", "executing-plans", "systematic-debugging", "frontend-design", "ai-interface-design"];

describe("regulations", () => {
  test("every kickoff carries the rules and its output", () => {
    for (const s of STAGES.filter((x) => x.agent)) {
      const t = kickoff(w, s, 1);
      expect(t).toContain(rulesText());
      expect(t).toContain(pluginDir("hello"));
    }
    expect(kickoff(w, stageOf(1), 1)).toContain("docs/workshop/TEST-12/context.md");
    expect(kickoff(w, stageOf(2), 1)).toContain("docs/workshop/TEST-12/tech.md");
    expect(kickoff(w, stageOf(2), 1)).toContain("VERDICT: OK_WITH_CAVEATS");
    expect(kickoff(w, stageOf(2), 1)).toContain("VERDICT: IMPOSSIBLE");
    expect(kickoff(w, stageOf(3), 1)).toContain("docs/workshop/TEST-12/tz.md");
    expect(kickoff(w, stageOf(3), 1)).toContain("MIGRATIONS: yes");
    expect(kickoff(w, stageOf(3), 1)).toContain("MIGRATIONS: no");
    expect(kickoff(w, stageOf(3), 1)).toContain("Post-rollout check");
    expect(kickoff(w, stageOf(5), 2)).toContain(".superpowers/workshop/TEST-12/verify-r2.md");
    expect(kickoff(w, stageOf(5), 1)).toContain("VERDICT: PASS");
    expect(kickoff(w, stageOf(5), 1)).toContain("VERDICT: FAIL");
    expect(kickoff(w, stageOf(5), 1)).toContain("MIGRATIONS");
  });

  test("the kickoff names the work, the plugin, the request and the iteration", () => {
    const t = kickoff(fakeWork({ iteration: 3 }), stageOf(1), 1);
    expect(t).toContain("TEST-12");
    expect(t).toContain("Make a CSV export");
    expect(t).toContain("Iteration 3");
    expect(t).toContain("`hello`");
  });

  test("skill steps the stages cancel", () => {
    expect(kickoff(w, stageOf(1), 1)).toContain("Builder check");
    expect(kickoff(w, stageOf(2), 1)).toContain("VesnALIA's built-in skill `alia-plugin-authoring`");
    for (const s of ["final review", "deleting the ledger folder", "finishing-a-development-branch"]) expect(kickoff(w, stageOf(4), 1)).toContain(s);
    expect(kickoff(w, stageOf(3), 1)).toContain("choosing the execution approach");
    expect(kickoff(w, stageOf(1), 1)).toContain("Cancelled from the skill");
  });

  test("stage knowledge drives the kickoff", () => {
    for (const no of ALL) {
      const k = stageKnowledge()[no];
      const t = kickoff(w, stageOf(no), 1);
      for (const x of [...k.skills, ...k.sources]) expect(t).toContain(x);
    }
    expect(stageKnowledge()[1].skills).toContain("brainstorming");
    expect(stageKnowledge()[2].skills).toEqual(["alia-plugin-authoring", "secrets"]);
    expect(stageKnowledge()[3].skills).toEqual(["writing-plans"]);
    expect(stageKnowledge()[4].skills).toEqual(["subagent-driven-development", "test-driven-development", "secrets"]);
    expect(kickoff(w, stageOf(2), 1)).toContain("VesnALIA's built-in skill `secrets`");
    expect(stageKnowledge()[5].skills).toEqual(["verification-before-completion"]);
    expect(stageKnowledge()[6].skills).toEqual(["verification-before-completion", "browser-automation"]);
    // A non-built-in skill is used if it is installed; a built-in one is invoked as built-in.
    expect(kickoff(w, stageOf(1), 1)).toContain("`brainstorming` — if such a skill is installed");
    expect(kickoff(w, stageOf(2), 1)).not.toContain("`alia-plugin-authoring` — if such a skill is installed");
    expect(kickoff(w, stageOf(6), 1)).toContain("VesnALIA's built-in skill `browser-automation`");
    expect(kickoff(w, stageOf(6), 1)).toContain("`verification-before-completion` — if such a skill is installed");
    for (const no of ALL) {
      expect(stageKnowledge()[no].sources).toContain("`alia plugin --help` — VesnALIA commands for plugins");
      expect(stageKnowledge()[no].sources.some((s) => s.includes("README.md"))).toBe(true);
      expect(stageKnowledge()[no].sources.some((s) => s.includes("node_modules/@vesnalia/plugin-sdk/bundled-types/alia-plugin-sdk.d.ts"))).toBe(true);
    }
    for (const no of [2, 5] as StageNo[]) expect(stageKnowledge()[no].sources.some((s) => s.includes("alia plugin logs <id>"))).toBe(true);
    for (const no of [2, 5] as StageNo[]) expect(stageKnowledge()[no].sources.some((s) => s.includes("alia plugin list"))).toBe(true);
    expect(stageKnowledge()[6].sources.some((s) => s.includes(browserRecipePath()))).toBe(true);
  });

  test("the browser recipe lives in the plugin's own docs folder, not in a thread's worktree", () => {
    const was = DOCS_ROOT;
    setDocsRoot("/opt/alia/plugins/plugin-workshop/docs/");
    try {
      expect(browserRecipePath()).toBe("/opt/alia/plugins/plugin-workshop/docs/browser-recipe.md");
    } finally {
      setDocsRoot(was);
    }
    expect(browserRecipePath()).not.toContain("worktrees/thr_");
    // The file is in this repository: the path above points at the plugin's install folder, which VesnALIA builds it from.
    const local = fileURLToPath(new URL("../docs/browser-recipe.md", import.meta.url));
    expect(existsSync(local)).toBe(true);
    const recipe = readFileSync(local, "utf8");
    expect(recipe).toContain("alia browser-automation open");
    expect(recipe).toContain("zoom");
    expect(recipe).toContain("alia browser-automation close");
    for (const no of ALL) for (const s of stageKnowledge()[no].sources) expect(s).not.toContain("worktrees/thr_");
  });

  test("every skill of the stage knowledge is from the library or built into VesnALIA", () => {
    for (const no of ALL) {
      for (const skill of stageKnowledge()[no].skills) expect(LIBRARY.includes(skill) || BUILTIN_SKILLS.has(skill), `${skill} (stage ${no})`).toBe(true);
    }
    for (const builtin of BUILTIN_SKILLS) expect(LIBRARY).not.toContain(builtin); // a built-in skill is invoked, not read from a library
  });

  test("a skill that is not built into VesnALIA is used only if installed; a built-in one is invoked as built-in", () => {
    for (const no of ALL) {
      const t = kickoff(w, stageOf(no), 1);
      for (const s of stageKnowledge()[no].skills) {
        expect(t).toContain(BUILTIN_SKILLS.has(s) ? `VesnALIA's built-in skill \`${s}\` — invoke it as a built-in skill` : `\`${s}\` — if such a skill is installed`);
      }
    }
  });

  test("stage 2 may read and spike, but never install, enable or touch copies", () => {
    const t = kickoff(w, stageOf(2), 1);
    expect(t).toContain(".superpowers/workshop/TEST-12/spike/");
    for (const s of ["install, enable and disable plugins", "change working copies", "write to external services"]) expect(t).toContain(s);
    expect(t).toMatch(/reread[^\n]*tech\.md[^\n]*context\.md/);
    expect(t).not.toContain("Self-check");
  });

  test("stage 2 checks the SDK version of the types against the host", () => {
    const t = kickoff(w, stageOf(2), 1);
    expect(t).toContain("compare the version in `node_modules/@vesnalia/plugin-sdk/package.json` with the host's SDK version (`alia plugin types --check .` prints «host is …» and writes nothing)");
    expect(t).toContain("only of the matching version");
    expect(t).not.toMatch(/alia 0\.\d+\.\d+ = SDK/); // no version pairs of a particular VesnALIA install
    // The fallback is one command from the worktree root: the folder, its own package.json (npm init writes to the current folder, ignores --prefix), the install under the lock.
    expect(t).toContain(
      `mkdir -p .superpowers/workshop/TEST-12/spike && (cd .superpowers/workshop/TEST-12/spike && npm init -y) && flock '${BUILD_LOCK}' npm install --ignore-scripts --prefix .superpowers/workshop/TEST-12/spike @vesnalia/plugin-sdk@<host SDK version>`,
    );
    expect(t).toContain("Without its own `package.json` in `spike/` npm climbs up to the `package.json` of the worktree root");
    expect(t).toContain("`npm init` writes to the current folder");
    expect(t.indexOf("mkdir -p .superpowers/workshop/TEST-12/spike")).toBeLessThan(t.indexOf("npm install --ignore-scripts --prefix")); // the folder comes before the install
    expect(t).not.toContain("first `npm init -y` in that folder"); // a bare `npm init -y` without cd would rewrite the plugin's package.json
    expect(t).toContain("do not run `alia plugin types` without `--check` in the plugin");
    // The source shared by all stages says the same — types of another version lie.
    expect(stageKnowledge()[2].sources.join("\n")).toContain("Check that `node_modules/@vesnalia/plugin-sdk/package.json` matches the host");
  });

  test("no stage source points at a file outside the plugin and its worktree", () => {
    for (const no of ALL) for (const s of stageKnowledge()[no].sources) expect(s).not.toMatch(/\/workspaces\/|CLAUDE\.md/);
  });

  test("stage 3 asks the migrations line, the live-check section and a stop on contradictions", () => {
    const t = kickoff(w, stageOf(3), 1);
    expect(t).toContain("### Task N");
    expect(t).toContain("alia plugin logs <id>");
    expect(t).toMatch(/at the start of `docs\/workshop\/TEST-12\/tz\.md`/);
    expect(t).toContain("## Review");
  });

  test("stage 3 makes the agent limits mandatory in Global Constraints; stage 4 hands them to every subagent", () => {
    const limits = `do not install, enable, disable or reload plugins, push nothing; heavy commands only under \`flock '${BUILD_LOCK}' <command>\`, one at a time; work only in this worktree, do not touch the working copy or other plugins`;
    const t3 = kickoff(w, stageOf(3), 1);
    expect(t3).toContain("Mandatory in «Global Constraints» (the implementer passes them to every subagent): " + limits);
    const t4 = kickoff(w, stageOf(4), 1);
    expect(t4).toContain("include in every subagent's brief — " + limits);
  });

  test("stage 3 for a new plugin lets the spec decide about the interface and the scaffold", () => {
    const n = fakeWork({ kind: "new", plugin_id: "hello" });
    expect(kickoff(n, stageOf(3), 1)).toContain("the spec decides whether it needs an interface and which parts of the");
    expect(kickoff(w, stageOf(3), 1)).not.toContain("which parts of the");
  });

  test("stage 4 works in the worktree, in the ledger, and does not ship", () => {
    const t = kickoff(w, stageOf(4), 1);
    expect(t).toContain(".superpowers/sdd/tz/progress.md");
    expect(t).toMatch(/Do not push/);
    expect(t).toMatch(/do not install, enable, disable/i);
    expect(t).toContain(`flock '${BUILD_LOCK}'`);
  });

  test("new plugin: stage 4 removes scaffold examples, stage 5 fails on the example skill", () => {
    const n = fakeWork({ task_key: "TEST-13", plugin_id: "hello", kind: "new" });
    const t4 = kickoff(n, stageOf(4), 1);
    expect(t4).toContain("remove the scaffold samples the spec does not use");
    for (const s of ["skills/example-todos", "alia.skills", "Example todos", "showDone", "alia hello", "skills/example-skill", "alia plugin new"]) expect(t4).toContain(s);
    expect(t4).toContain("`alia.app`");
    expect(kickoff(w, stageOf(4), 1)).not.toContain("remove the scaffold samples"); // a rework — without this item
    expect(kickoff(w, stageOf(4), 1)).not.toContain("Example todos");
    for (const x of [n, w]) {
      expect(kickoff(x, stageOf(5), 1)).toContain("`VERDICT: FAIL` if the branch still has `skills/example-todos` or its entry in the manifest's `alia.skills`");
    }
    // The same skill under another name — by the scaffold's description.
    expect(kickoff(w, stageOf(5), 1)).toContain("skills/example-skill");
  });

  test("stage 5 verifies by commands under the lock and against MIGRATIONS", () => {
    const t = kickoff(w, stageOf(5), 1);
    for (const s of ["npm test", "npm run typecheck", "alia plugin build", "alia plugin types --check", "git diff main...HEAD"]) expect(t).toContain(s);
    expect(t).toContain(`flock '${BUILD_LOCK}'`);
    expect(t).toMatch(/[Mm]igrations[^\n]*`MIGRATIONS: no`[^\n]*FAIL/);
    expect(t).toMatch(/Do not change or commit code/);
    expect(t).toContain("look at `git status` in the worktree: it must be clean");
    expect(t).toMatch(/junk[^\n]*name it in the report/);
  });

  test("rules", () => {
    expect(rulesText()).toContain(`flock '${BUILD_LOCK}'`);
    expect(rulesText()).toMatch(/Only the Workshop code installs, enables and disables plugins/);
    expect(rulesText()).toContain("@vesnalia/plugin-sdk");
    expect(rulesText()).toContain("alia plugin types --check");
    expect(rulesText()).toContain("alia plugin reload");
    // The section on the bar is part of the work: the badge in the plugin itself, the place by a NAV line, set by the Workshop.
    expect(rulesText()).toContain("app.experimental_icons.register");
    expect(rulesText()).toContain("NAV: <id>/<section> after <neighbour>");
    expect(rulesText()).toContain(navGuidePath());
    expect(rulesText()).toContain(">-");
    expect(rulesText()).toContain("127.0.0.1");
    expect(rulesText()).toContain("private network address");
    expect(rulesText()).toMatch(/append-only/);
    expect(rulesText()).toContain("alia.app");
    expect(rulesText()).toContain("only the Workshop code moves its main branch on rollout and rollback");
  });

  test("dependencies are installed without install scripts; a native binding is rebuilt explicitly", () => {
    for (const t of [kickoff(w, stageOf(4), 1), kickoff(w, stageOf(5), 1)]) {
      expect(t).toContain(`flock '${BUILD_LOCK}' npm ci --ignore-scripts`);
      expect(t).toContain(`flock '${BUILD_LOCK}' npm install --ignore-scripts`);
      expect(t).toContain("npm rebuild <package> --ignore-scripts=false");
    }
    expect(rulesText()).toContain("`npm ci --ignore-scripts`");
    expect(rulesText()).toContain("`npm install --ignore-scripts`");
    expect(rulesText()).not.toContain("`npm install` does not run the install script");
    // Every install command in the generated texts carries --ignore-scripts; «`npm install`/`ci`» in the lists of heavy commands is a name, not a command.
    const all = [rulesText(), ...ALL.map((no) => kickoff(w, stageOf(no), 1))].join("\n");
    expect(all.match(/npm (?:ci|install)(?! --ignore-scripts)(?!`\/`ci)/g)).toBeNull();
  });

  test("paths in shell examples are single-quoted", () => {
    expect(shq("/srv/plugins")).toBe("'/srv/plugins'");
    expect(shq("/srv/it's here")).toBe("'/srv/it'\\''s here'");
    const before = BUILD_LOCK;
    try {
      setBuildLock("/srv/odd dir/build.lock");
      expect(rulesText()).toContain("`flock '/srv/odd dir/build.lock' <command>`");
      expect(kickoff(w, stageOf(5), 1)).toContain("`flock '/srv/odd dir/build.lock' <command>`");
    } finally {
      setBuildLock(before);
    }
    expect(kickoff(w, stageOf(6), 1)).toContain(`git -C ${shq(pluginDir("hello"))} rev-parse HEAD`);
  });

  test("path settings: absolute, normalized and plain, or they are ignored", () => {
    for (const ok of ["/srv/plugins", "/srv/alia/.vesnalia/locks/build.lock", "/a/b@c/d+e/f-g_h.i"]) expect(pathSettingProblem(ok), ok).toBeNull();
    expect(pathSettingProblem("plugins")).toBe("not an absolute path");
    expect(pathSettingProblem("-w0")).toBe("not an absolute path");
    expect(pathSettingProblem("~/plugins")).toBe("not an absolute path");
    for (const bad of ["/", "/srv//plugins", "/srv/./plugins", "/srv/../plugins", "/srv/plugins/"]) expect(pathSettingProblem(bad), bad).toMatch(/^not a normalized path/);
    for (const bad of ["/srv/my plugins", "/srv/$(id)", "/srv/a;b", "/srv/'x'", "/srv/a\nb", "/srv/ä"]) expect(pathSettingProblem(bad), bad).toMatch(/^only letters, digits/);
  });

  test("reviewer prompts end with exact verdicts", () => {
    const p3 = reviewerPrompt(w, stageOf(3), "astra", 1);
    expect(p3).toContain("VERDICT: BLOCKING");
    expect(p3).toContain("VERDICT: CLEAR");
    expect(p3).toContain(".superpowers/workshop/TEST-12/review-astra-tz-r1.md");
    expect(p3).toContain("docs/workshop/TEST-12/tz.md");
    expect(p3).toContain("docs/workshop/TEST-12/context.md");
    expect(p3).toContain("except your review file");
    expect(p3).toContain("nothing after it");
    const p5 = reviewerPrompt(w, stageOf(5), "fable", 2);
    expect(p5).toContain("review-fable-verify-r2.md");
    expect(p5).toContain("git diff main...HEAD");
    expect(p5).toContain("docs/workshop/TEST-12/tz.md");
    expect(reviewerPrompt(fakeWork({ base_branch: null }), stageOf(5), "fable", 1)).toContain("git diff main...HEAD");
    expect(() => reviewerPrompt(w, stageOf(1), "fable", 1)).toThrow();
    expect(() => reviewerPrompt(w, stageOf(4), "fable", 1)).toThrow();
  });

  test("live check names the installed commit and the report", () => {
    const t = liveCheckPrompt(w, 1, attempt({ target_sha: "abc1234" }));
    expect(t).toContain("live-r1.md");
    expect(t).toContain("abc1234");
    expect(t).toContain(".superpowers/workshop/TEST-12/live-r1.md");
    expect(t).toContain("Post-rollout check");
    expect(t).toContain("docs/workshop/TEST-12/tz.md");
    expect(t).toContain("alia plugin logs hello");
    expect(t).toContain("VERDICT: FAIL"); // if the wrong commit is installed
    expect(t).toContain(browserRecipePath());
    expect(t).not.toContain("worktrees/thr_");
    expect(t).toMatch(/do not install/i);
    expect(liveCheckPrompt(w, 1, attempt({ kind: "reinstall" }))).toContain("repeated install");
    expect(liveCheckPrompt(w, 1, attempt({ migrations: 1 }))).toContain("data migrations");
    expect(liveCheckPrompt(w, 1, attempt({ migrations: 0 }))).not.toContain("data migrations");
  });

  test("stage 6 kickoff alone carries the report path and the verdict contract", () => {
    // The engine calls kickoff with other packets too (a restart, entering the stage): the report and the verdict do not depend on liveCheckPrompt.
    for (const packet of [undefined, "The commit accepted at sign-off: abc. Roll out exactly that one."]) {
      const t = kickoff(w, stageOf(6), 2, packet);
      expect(t).toContain(".superpowers/workshop/TEST-12/live-r2.md");
      expect(t).toContain("VERDICT: PASS");
      expect(t).toContain("VERDICT: FAIL");
      expect(t).toContain("nothing after it");
      expect(t).toContain("docs/workshop/TEST-12/tz.md");
      expect(t).toContain("alia plugin logs hello");
    }
    expect(kickoff(w, stageOf(6), 2)).toContain("`VERDICT: PASS`");
  });

  test("stage 6 thread prompt is the kickoff plus the live-check packet", () => {
    const a = attempt({ target_sha: "abc1234" });
    const t = kickoff(w, stageOf(6), 2, liveCheckPrompt(w, 2, a));
    expect(t).toContain(rulesText());
    expect(t).toContain("abc1234");
    expect(t).toContain("live-r2.md");
    expect(t).toContain("VesnALIA's built-in skill `browser-automation`");
    expect(t.indexOf("abc1234")).toBeGreaterThan(t.indexOf(rulesText())); // the packet comes last
  });

  test("regulationOf covers every stage, both work kinds, and the stage knowledge", () => {
    for (const no of ALL) expect(regulationOf(no).length).toBeGreaterThan(100);
    expect(regulationOf(4)).toContain("remove the scaffold samples");
    expect(regulationOf(2)).toContain("alia-plugin-authoring");
    expect(regulationOf(1)).not.toBe(regulationOf(2));
    expect(() => regulationOf(8 as StageNo)).toThrow();
  });

  test("a work without a task key has no agent", () => {
    expect(() => kickoff(fakeWork({ task_key: null }), stageOf(1), 1)).toThrow("no task key");
  });

  it("writes return, inputs-changed and reviews-ready packets", () => {
    const back = returnPacket(w, stageOf(3), stageOf(5), "the button has the wrong colour", 2);
    expect(back).toContain("the button has the wrong colour");
    expect(back).toContain("iteration 2");
    expect(back).toContain("docs/workshop/TEST-12/tz.md");
    const fromLive = returnPacket(w, stageOf(4), stageOf(6), "x", 3);
    expect(fromLive).toContain("If the plugin is installed — fix forward");
    expect(fromLive).toContain("after a rollback it runs the previous version");
    expect(fromLive).not.toContain("The plugin is already installed");
    expect(returnPacket(w, stageOf(3), stageOf(5), "x", 2)).not.toContain("fix forward");
    expect(inputsChanged(w, stageOf(3))).toContain("iteration 1");
    expect(inputsChanged(w, stageOf(3))).toContain("docs/workshop/TEST-12/");
    const ready = reviewsReady(w, ["a.md", "b.md"]);
    expect(ready).toContain("## Review");
    expect(ready).toContain("docs/workshop/TEST-12/tz.md");
    expect(ready).toContain("`a.md`");
  });

  it("a send-back to Spec names the work's reviewers, or says the work has no reviews", () => {
    const back = returnPacket(w, stageOf(3), stageOf(5), "x", 2);
    expect(back).toContain("The spec review (Fable 5.1, GPT-6-Astra) starts on its own");
    const none = returnPacket(fakeWork({ models: JSON.stringify({ ...DEFAULT_MODELS, reviewers: [] }) }), stageOf(3), stageOf(5), "x", 2);
    expect(none).toContain("This work has no reviews");
    expect(none).toContain("MIGRATIONS line");
    expect(none).not.toContain("starts on its own");
    expect(none).not.toContain("review (");
  });

  test("the Spec regulation does not promise «Mockup»: the stage can be switched off", () => {
    const t = kickoff(w, stageOf(3), 1);
    expect(t).toContain("The next stage is «Mockup» if it is enabled");
    expect(t).toContain("otherwise «Implementation»");
    expect(t).not.toContain("The next stage is «Mockup»:");
  });

  it("identity names the role, the work and carries the rules", () => {
    for (const [no, role, word] of [[1, "stage", "you are the agent"], [5, "stage", "you are the verifier"], [6, "stage", "you are the live-check verifier"], [3, "review", "you are the reviewer"]] as const) {
      const t = identity(w, stageOf(no), role);
      expect(t).toContain("TEST-12");
      expect(t).toContain(word);
      expect(t).toContain(rulesText());
      expect(t).toContain("hello");
    }
  });

  it("identity fits the SDK limit of thread instructions (4096) for every stage and role, with the longest form values", () => {
    // The name is up to 80 characters, the id up to 40 (the «New plugin» form); the task key with room to spare.
    const longest = fakeWork({ title: `New plugin «${"W".repeat(80)}»`, plugin_id: `p${"-x".repeat(19)}y`, task_key: "TEST-99999" });
    expect(longest.plugin_id.length).toBe(40);
    for (const no of ALL) {
      for (const role of ["stage", "review"] as const) {
        const t = identity(longest, stageOf(no), role);
        expect(t.length, `stage ${no}, ${role}`).toBeLessThan(4096);
      }
    }
  });

  it("titles threads by work, stage and round", () => {
    expect(threadTitle(w, stageOf(3), "review", "fable", 2)).toBe("TEST-12 · review Fable 5.1 · Spec · r2");
    expect(threadTitle(w, stageOf(5), "stage", "claude", 3)).toBe("TEST-12 · Verification · r3");
    expect(threadTitle(w, stageOf(6), "stage", "claude", 1)).toBe("TEST-12 · Rollout · r1");
    expect(threadTitle(w, stageOf(1), "stage", "claude", 1)).toBe("TEST-12 · Context");
  });
});
