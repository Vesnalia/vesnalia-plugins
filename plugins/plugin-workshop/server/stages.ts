// Stages and board columns of the Plugin Workshop. What a stage is about is its regulation in regulations.ts;
// here is only what the engine and the board need. The interface bundle imports this module too: no Node imports here.

/**
 * Seven stages of a work; each has its own agent. There is no Inbox and no «Done»: a work opens right at Context, the outcome is a separate field.
 * The number is the stage's name in the database, not its place: «Mockup» (7) stands between Spec (3) and Implementation (4) — it was added
 * later, and the numbers of running works did not change.
 * Order — only via `pos`/`before`/`nextStage`, never by comparing numbers.
 */
export type StageNo = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type StageKey = "context" | "tech" | "tz" | "mockup" | "build" | "verify" | "enter";
/** Board column. Implementation and Verification share «Building»; Rollout is «In production»; «Retired» — for plugins without a work. */
export type Column = "context" | "tech" | "tz" | "mockup" | "build" | "live" | "off";

export const COLUMNS: readonly { key: Column; title: string }[] = [
  { key: "context", title: "Context" },
  { key: "tech", title: "Feasibility" },
  { key: "tz", title: "Spec" },
  { key: "mockup", title: "Mockup" },
  { key: "build", title: "Building" },
  { key: "live", title: "In production" },
  { key: "off", title: "Retired" },
];

export interface Stage {
  no: StageNo;
  key: StageKey;
  title: string;
  column: Column;
  /** The stage has an agent (the stage thread). */
  agent: boolean;
  /** The stage is reviewed (by the work's reviewers; Fable and Astra by default): the review starts on its own, «Send to review» runs another round by hand. */
  reviewed: boolean;
  /** A new thread for every round (the verifier), not a continuation of the previous one. */
  freshEachRound: boolean;
  /** What the owner looks at before pressing the button. */
  ownerCheck: string;
  /** The tracker task status while the work is at this stage. */
  taskStatus: "in_progress" | "in_review";
}

export const STAGES: readonly Stage[] = [
  { no: 1, key: "context", title: "Context", column: "context", agent: true, reviewed: false, freshEachRound: false, ownerCheck: "context.md: what you want to get, what you will see, what we are not doing. «Next» — when it adds up.", taskStatus: "in_progress" },
  { no: 2, key: "tech", title: "Feasibility", column: "tech", agent: true, reviewed: false, freshEachRound: false, ownerCheck: "tech.md and its verdict: possible, possible with caveats, or impossible. «Next» or «Send back to Context».", taskStatus: "in_progress" },
  { no: 3, key: "tz", title: "Spec", column: "tz", agent: true, reviewed: true, freshEachRound: false, ownerCheck: "tz.md and the outcome of the reviews (they start on their own when the agent has finished the spec), the «Post-rollout check», the MIGRATIONS line and what is needed from you before implementation. «Next» or «Send back to Context».", taskStatus: "in_progress" },
  { no: 7, key: "mockup", title: "Mockup", column: "mockup", agent: true, reviewed: false, freshEachRound: false, ownerCheck: "The mockup of the plugin's section: screens, buttons, states, sample data. Ask for changes in words in the chat with the agent; «Approve mockup» — when everything suits you: the plugin is then built to it.", taskStatus: "in_progress" },
  { no: 4, key: "build", title: "Implementation", column: "build", agent: true, reviewed: false, freshEachRound: false, ownerCheck: "The implementation ledger: all spec tasks done. «To verification» or send it back.", taskStatus: "in_progress" },
  { no: 5, key: "verify", title: "Verification", column: "build", agent: true, reviewed: true, freshEachRound: true, ownerCheck: "The verification report: the verifier and the reviewers look at the branch together, and the verifier confirms the review findings against the code. «Roll out» or «Send back to Implementation per report».", taskStatus: "in_progress" },
  { no: 6, key: "enter", title: "Rollout", column: "live", agent: true, reviewed: false, freshEachRound: true, ownerCheck: "The plugin is installed; the live check report. «Accept», «Roll back» or send it back to the implementer.", taskStatus: "in_review" },
];

/** The forward button of each stage — on the work page and in the autopilot pause reason («the owner pressed …»). */
export const FORWARD_BUTTON: Record<StageNo, string> = { 1: "Next", 2: "Next", 3: "Next", 7: "Approve mockup", 4: "To verification", 5: "Roll out", 6: "Accept" };

/** Stages in work order (numbers are names, see `StageNo`). */
export const STAGE_ORDER: readonly StageNo[] = STAGES.map((s) => s.no);
/** The stage's place in work order; an unknown number throws. */
export function pos(no: number): number {
  const i = STAGE_ORDER.indexOf(no as StageNo);
  if (i < 0) throw new Error(`no stage ${no}`);
  return i;
}
/** Stage a comes before stage b. */
export const before = (a: number, b: number): boolean => pos(a) < pos(b);
/** Stage a comes at or after stage b. */
export const atOrAfter = (a: number, b: number): boolean => pos(a) >= pos(b);
/** The next stage; with «Mockup» switched off in the settings, Implementation follows Spec right away (a work already at «Mockup» goes on from it). */
export function nextStage(no: StageNo, mockup: boolean): StageNo {
  if (no === 7) return 4;
  const order = mockup ? STAGE_ORDER : STAGE_ORDER.filter((s) => s !== 7);
  const i = order.indexOf(no);
  if (i < 0 || i === order.length - 1) throw new Error(`nothing to hand over to after stage ${no}`);
  return order[i + 1]!;
}
/** Code stages: the hand-over and the results are tied to a commit. */
export const isCodeStage = (no: number): boolean => no === 4 || no === 5 || no === 6;
/** Document stages: they can be «reconfirmed» without restarting the agents. */
export const isDocStage = (no: number): boolean => no === 1 || no === 2 || no === 3 || no === 7;

export function stageOf(no: number): Stage {
  const s = STAGES.find((x) => x.no === no);
  if (!s) throw new Error(`no stage ${no}`);
  return s;
}

export type Who = "claude" | "fable" | "astra";
export const AGENTS: Record<Who, { providerId: string; model: string; label: string }> = {
  claude: { providerId: "claude-code", model: "claude-opus-5-5", label: "Claude" },
  fable: { providerId: "claude-code", model: "claude-fable-5-1", label: "Fable" },
  astra: { providerId: "codex", model: "gpt-6-astra", label: "Astra" },
};
export const REVIEWERS: readonly Who[] = ["fable", "astra"];
/** Spec review rounds the Workshop starts on its own per iteration: the second one only when blocking findings remain. */
export const AUTO_REVIEW_ROUNDS = 2;

/** Latin slug: transliterated, lowercase, dashes, ≤ 40 chars. */
export function slugify(title: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
    н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch",
    ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  const latin = [...title.toLowerCase()].map((c) => map[c] ?? c).join("");
  const slug = latin.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  return slug || "work";
}

/** Id of this plugin. */
export const SELF_ID = "plugin-workshop";
/**
 * Folder of the plugins' working copies (`<root>/alia-plugin-<id>`; the working copy of a plugin is `pluginDir(id)`): setting
 * `pluginsRoot`, default `~/plugins`. Set once at plugin startup (`setPluginsRoot`, the default — from `os.homedir()` in wiring); a
 * change takes effect after a plugin restart, with no open works. Until then — `$HOME/plugins` (the interface never uses it).
 */
export let PLUGINS_ROOT = `${(typeof process !== "undefined" ? (process.env.HOME ?? "") : "").replace(/\/+$/, "")}/plugins`;
export function setPluginsRoot(p: string): void {
  PLUGINS_ROOT = p.replace(/\/+$/, "");
}
export const pluginDir = (id: string) => `${PLUGINS_ROOT}/alia-plugin-${id}`;

/** The work's documents live in the plugin repository, in the work branch: they stay in the history next to the code. */
export const docsDir = (key: string) => `docs/workshop/${key}`;
export function docPaths(key: string): { context: string; tech: string; tz: string } {
  const dir = docsDir(key);
  return { context: `${dir}/context.md`, tech: `${dir}/tech.md`, tz: `${dir}/tz.md` };
}
/**
 * What is needed from the owner before implementation (keys, accounts, paid plans, decisions) — a `- [ ]` checklist. Feasibility writes it,
 * agents of the following stages check off what is done. It is not part of the work version: checking an item makes nothing stale.
 */
export const ownerPath = (key: string) => `${docsDir(key)}/owner.md`;
/** Iteration add-ons after a send-back to Implementation: new tasks go here, not into the spec — so the spec does not become stale. */
export const iterationPath = (key: string, iteration: number) => `${docsDir(key)}/iteration-${iteration}.md`;
export function isIterationPath(key: string, path: string): boolean {
  const pre = `${docsDir(key)}/iteration-`;
  return path.startsWith(pre) && /^\d+\.md$/.test(path.slice(pre.length));
}
/** The section mockup: `index.html` and screenshots — a work document, in git, like the spec. */
export const mockupDir = (key: string) => `${docsDir(key)}/mockup`;
/** The work's working folder (not in git): reviews, reports, screenshots, probe scripts. */
export const workDir = (key: string) => `.superpowers/workshop/${key}`;
export const reviewPath = (key: string, stageKey: StageKey, who: Who, round: number) => `${workDir(key)}/review-${who}-${stageKey}-r${round}.md`;
export const verifyPath = (key: string, round: number) => `${workDir(key)}/verify-r${round}.md`;
export const livePath = (key: string, round: number) => `${workDir(key)}/live-r${round}.md`;
/** The implementation ledger: the subagent-driven-development skill puts it next to the plan file's name. */
export function ledgerPath(tzPath: string): string {
  const name = tzPath.split("/").pop()!.replace(/\.md$/, "");
  return `.superpowers/sdd/${name}/progress.md`;
}
