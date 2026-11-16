// Regulations of the Plugin Workshop stages: what the stage agent, the reviewers and the live check are told.
// Short imperative lines; the lines about the last-line verdicts are exact formats (parse.ts reads them).
// The stage's skills and references are not listed here: kickoff takes them from stageKnowledge() (rules.ts) —
// they are tuned as data, without touching the regulation text. The regulation version (sha256) is recorded in stage_runs.
import { BUILD_LOCK, BUILTIN_SKILLS, browserRecipePath, mockupGuidePath, navGuidePath, rulesText, shq, stageKnowledge } from "./rules";
import { labelFor, modelsOf, reviewersOf, subagentAlias } from "./models";
import { AUTO_REVIEW_ROUNDS, docPaths, docsDir, iterationPath, ledgerPath, livePath, mockupDir, ownerPath, pluginDir, reviewPath, verifyPath, workDir, type Stage, type StageNo, type Who } from "./stages";
import type { AttemptRow, Role, WorkKind, WorkRow } from "./store";

/** Everything the regulation fills in about the work. */
interface Ctx {
  id: string;
  key: string;
  kind: WorkKind;
  /** The plugin's working copy — bb builds the running plugin from it. */
  dir: string;
  docs: { context: string; tech: string; tz: string };
  /** The checklist «what is needed from the owner before implementation». */
  owner: string;
  /** The add-ons file of the current iteration (a send-back to Implementation) and the pattern of all such files. */
  iterationFile: string;
  iterationFiles: string;
  /** Model of the Implementation task-implementer subagents: opus / sonnet / haiku / fable; null — the thread's model (Implementation is not on Claude). */
  subagents: string | null;
  /** The work's reviewers (labels); empty — the work has no reviews. */
  reviewers: string[];
  /** The mockup folder. */
  mockup: string;
  work: string;
  base: string;
  round: number;
}

function ctxOf(w: WorkRow, round: number): Ctx {
  if (!w.task_key) throw new Error("the work has no task key — there can be no stage agent yet");
  return {
    id: w.plugin_id, key: w.task_key, kind: w.kind, dir: pluginDir(w.plugin_id), docs: docPaths(w.task_key), owner: ownerPath(w.task_key),
    iterationFile: iterationPath(w.task_key, w.iteration), iterationFiles: `${docsDir(w.task_key)}/iteration-*.md`, mockup: mockupDir(w.task_key), work: workDir(w.task_key), base: w.base_branch ?? "main", round,
    subagents: modelsOf(w.models).build.providerId === "claude-code" ? subagentAlias(modelsOf(w.models).subagents) : null,
    reviewers: reviewersOf(modelsOf(w.models)).map((who) => labelFor(modelsOf(w.models), "review", 3, who)),
  };
}

/** A heavy command under the shared build lock; the lock path is single-quoted (it comes from a setting or the home folder). */
const flock = (cmd: string) => `flock ${shq(BUILD_LOCK)} ${cmd}`;
const needDeps = () =>
  `A fresh worktree has no dependencies: \`${flock("npm ci --ignore-scripts")}\` (no \`package-lock.json\` — \`${flock("npm install --ignore-scripts")}\`); dependency install scripts do not run, a native binding a test needs is built with \`${flock("npm rebuild <package> --ignore-scripts=false")}\`; do not commit \`node_modules\`.`;

/** What every stage 4 implementer must know, subagents included: the spec writes it into «Global Constraints», the implementer into every subagent's brief. */
const agentLimits = () => `do not install, enable, disable or reload plugins, push nothing; heavy commands only under \`${flock("<command>")}\`, one at a time; work only in this worktree, do not touch the working copy or other plugins`;

/** The skill of the `bb plugin new` scaffold: it reaches the instructions of every bb thread as soon as the plugin is installed. */
const scaffoldSkills = "`skills/example-todos`; likewise `skills/example-skill` and any skill whose `description` says it was created by `bb plugin new`";

const REGULATIONS: Record<StageNo, (c: Ctx) => string> = {
  1: (c) =>
    [
      "Talk with the owner in this thread, one question at a time.",
      c.kind === "new"
        ? "The plugin is new: its working copy holds only the `bb plugin new` scaffold with a sample todo list — that is not what the owner wants; do not ask about the sample."
        : "The plugin already works: read its `README.md` and code, so that you ask about what changes, not about what already exists.",
      `The stage output is \`${c.docs.context}\` (create the folder if it does not exist); commit it to the current branch. The document answers: a new plugin or a change to an existing one; what the owner wants to get and why; what they will see (a section in bb, a CLI command, a button, agent behaviour); what we are not doing; known links to other plugins and services.`,
      "If the plugin will have a section in bb's navigation — ask for and record its badge code on the bar (three Latin letters) and the badge colour (if the owner groups sections on the bar by colour — the colour of its group): the badge and its place on the bar are made by this same work.",
      "Do not check feasibility or the technical base and do not write the spec — those are the next stages; mark what you are unsure of in the document with a question.",
      "Cancelled from the skill: the «Builder check» and the move to writing-plans.",
    ].join("\n"),
  2: (c) =>
    [
      `Input: \`${c.docs.context}\`. The stage output is \`${c.docs.tech}\`; commit it to the current branch.`,
      "Check context.md against reality: the needed APIs exist in the SDK of the version installed in bb (with references to the declarations in the SDK types, not from memory); the RPCs of other plugins exist; external services, secrets and machines are reachable; there are no conflicts (plugin id, CLI command name, icon name, ports); there is enough memory and disk; what is risky and what must be proven first.",
      ...(c.kind === "rework" ? ["The plugin already works: as a separate item — which of its behaviour and data the change affects."] : []),
      `SDK types: compare the version in \`node_modules/@get-bb/plugin-sdk/package.json\` with the host's SDK version (\`bb plugin types --check .\` prints «host is …» and writes nothing) and take types only of the matching version — plugins written for an older bb keep an older SDK in \`node_modules\`, and its types are out of date. If the matching version is not at hand — install it only in \`spike/\`, with one command from the worktree root: \`mkdir -p ${c.work}/spike && (cd ${c.work}/spike && npm init -y) && ${flock(`npm install --ignore-scripts --prefix ${c.work}/spike @get-bb/plugin-sdk@<host SDK version>`)}\`. Without its own \`package.json\` in \`spike/\` npm climbs up to the \`package.json\` of the worktree root and rewrites the plugin's \`package.json\`, \`package-lock.json\` and \`node_modules\` in the work branch — and this stage changes nothing in the plugin; \`npm init\` writes to the current folder (it ignores \`--prefix\`), so the \`cd\` is required. For the same reason do not run \`bb plugin types\` without \`--check\` in the plugin (it edits \`package.json\`).`,
      `Allowed: read any code and run probe scripts — only in \`${c.work}/spike/\` (the folder is created by the command above or by \`mkdir -p\`; it is outside git). Not allowed: install, enable and disable plugins, change working copies, write to external services. Heavy work only under the lock: \`${flock("<command>")}\`.`,
      "In tech.md: what was checked and how (references to type declarations, command output), what does not add up, the risks and what to prove first.",
      `What is needed from the owner before implementation goes to a separate file \`${c.owner}\` (commit it together with tech.md): a checklist, every item a line \`- [ ] …\`. Collect everything at once, so the owner can do it in one go rather than item by item in chat: keys and passwords (the owner enters them with the \`secrets\` skill — name the variables), accounts and connections in external services, paid plans and money, decisions that cannot be made for the owner. What already exists and works — check it and mark it \`- [x] … — checked: <how>\`. Nothing needed — a single line \`- nothing\`.`,
      "Before you finish, reread tech.md against context.md: every context item is closed by a check or named as unchecked.",
      "The last line of tech.md is exactly `VERDICT: OK` (possible as is), `VERDICT: OK_WITH_CAVEATS` (possible, with caveats — they are above in the file) or `VERDICT: IMPOSSIBLE` (it cannot be done this way — why, above; the owner decides whether to send it back to «Context»): no formatting or quotes, nothing after it.",
      "Cancelled from the skill: writing and installing the plugin code — this stage only checks; the skill is a reference on how plugins and the SDK work.",
    ].join("\n"),
  3: (c) =>
    [
      `Inputs: \`${c.docs.context}\` (what the owner wants) and \`${c.docs.tech}\` (what is possible). The stage output is \`${c.docs.tz}\`: an implementation plan per the skill; commit it to the current branch.`,
      "Plan tasks are `### Task N: …` headings: the plugin counts implementation progress by them. In the plan's «Global Constraints» — the bb plugin rules that concern this plugin (from the «bb plugin rules» block below), the document paths and the feasibility verdict with its caveats.",
      `Mandatory in «Global Constraints» (the implementer passes them to every subagent): ${agentLimits()}.`,
      ...(c.kind === "new"
        ? ["The plugin is new: the spec decides whether it needs an interface and which parts of the `bb plugin new` scaffold are used; the «Implementation» stage removes the rest of the scaffold."]
        : []),
      "Describe the interface so that a mockup can be drawn from the spec: screens and tabs, what is on each (fields, tables, buttons and what they do), states — empty, loading, error, confirmation. The next stage is «Mockup» if it is enabled (the owner sees and approves the look before development), otherwise «Implementation».",
      "Mandatory sections on top of the skill:",
      "- «## Post-rollout check» — what to check live after the install: CLI commands with the expected output, the section in bb (where to open it), what to look for in `bb plugin logs <id>`, which settings the plugin needs. The live check reads this section — it knows nothing else.",
      "- a line `MIGRATIONS: yes` or `MIGRATIONS: no` — on its own line, no formatting or quotes: whether the work adds data migrations. Without it the stage does not pass the gate.",
      `- \`NAV:\` lines — one per plugin section in the navigation: \`NAV: <plugin id>/<section id> after <neighbour section>\` (the neighbour — the section it should follow on the bar now, e.g. the last section of its group; see \`bb settings ui list\`); no section — a single line \`NAV: none\`. The plan makes the section badge a task in the plugin itself, per the template \`${navGuidePath()}\` (code and colour — from context.md); the Workshop puts the section in its place on the bar from the NAV line on rollout. This is part of the work, not «outside the plugin». Without NAV lines the stage does not pass the gate.`,
      `If context.md or tech.md do not match what is possible — write that at the start of \`${c.docs.tz}\` and end your turn: the owner decides whether to send it back to «Context».`,
      c.reviewers.length === 0
        ? `This work has no reviews (the owner chose so): the MIGRATIONS line in \`${c.docs.tz}\` means «spec ready» — the owner decides from there. If you need an answer from the owner without which the spec is not ready — ask and do not write the MIGRATIONS line until you have it.`
        : `The review (${c.reviewers.join(", ")}) starts on its own when you finish your turn and \`${c.docs.tz}\` has a MIGRATIONS line: that line means «spec ready». If you need an answer from the owner without which the spec is not ready — ask and do not write the MIGRATIONS line until you have it. When the review files are ready, they are sent to you — close every item in the «## Review» section of \`${c.docs.tz}\`: «accepted — what changed» or «rejected — why». If blocking findings remain, the Workshop starts another round on its own (up to ${AUTO_REVIEW_ROUNDS} per iteration in total).`,
      `\`${c.owner}\` — what is needed from the owner before implementation. Items the owner has done — check them (with a read-only request, a command) and mark them \`- [x] … — checked: <how>\`; anything new found while working on the spec — add it there too, not only in chat. The owner sees the unchecked items when handing the work over to Implementation.`,
      "Cancelled from the skill: choosing the execution approach at the end — the next stage runs the implementation.",
    ].join("\n"),
  7: (c) =>
    [
      `Inputs: \`${c.docs.context}\` (what the owner wants), \`${c.docs.tech}\`, \`${c.docs.tz}\` (the approved spec), \`${c.owner}\`. The stage output is the mockup of the plugin's section: \`${c.mockup}/index.html\`; commit it to the current branch.`,
      "Why: the owner wants to see what the plugin will look like before it is built, and to correct it in words. The approved mockup is a commitment: Implementation builds the interface to it, Verification and the live check compare against it.",
      `What the mockup holds: the section as the owner will see it in bb — the navigation bar with the section badge (code and colour — from the spec and the context), the panel header, all screens, tabs and dialogs from the spec; states: empty, loading, error, action confirmation; plausible sample data (no real personal data, no keys) marked «Mockup — sample data». At the top of the mockup — a screen switcher and a «Desktop / Phone» switcher (phone — 390px wide); in a window narrower than 720px (the preview in bb's chat) the mockup opens in the «Phone» view by itself. The look is bb's: rules and a sample — \`${mockupGuidePath()}\`.`,
      "A plugin without a navigation section (`NAV: none` in the spec): the mockup shows what the replies of its CLI commands look like and what agents will see — in the same file.",
      `One self-contained HTML file: styles and scripts inside the file, images and fonts as \`data:\` URLs, no external fonts, libraries or network requests — the Workshop's preview blocks them (a Content Security Policy) and stops showing a mockup that navigates its own page away. Extra pages — next to it in \`${c.mockup}/\`.`,
      `Screenshots: open the mockup in a browser (the built-in skill \`browser-automation\`, address \`file://\` + the full path to \`${c.mockup}/index.html\` in this worktree; recipe — \`${browserRecipePath()}\`) and save \`${c.mockup}/desktop.png\` and \`${c.mockup}/phone.png\`; commit. If you cannot take them — tell the owner so; the mockup matters more than the screenshots.`,
      `Showing it to the owner: end your turn with a message listing the screens and the directive of the built-in skill \`inline-vis\` — sample: \`::inline-vis{file="${c.mockup}/index.html" height="900"}\`. In your message write it on a line of its own and without backticks (in backticks or a code block it stays text). Ask about anything the spec leaves undefined for the look.`,
      `The owner's corrections come to this thread: you edit the mockup, commit, retake the screenshots and show it again. You do not write plugin code. You do not change \`${c.docs.tz}\`: if the mockup shows that the spec must change — tell the owner, they will send the work back to Spec.`,
      "The owner hands over with the «Approve mockup» button.",
    ].join("\n"),
  4: (c) =>
    [
      `Execute \`${c.docs.tz}\` per the skill: the controller runs the tasks, subagents do them. The ledger is where the skill puts it: \`${ledgerPath(c.docs.tz)}\`; a finished task is a line \`Task N: complete\` (that is how the plugin counts progress).`,
      "You work in this worktree, in the work branch. Everything done is committed; after every task `npm run typecheck` and the tests are clean.",
      `The interface follows the approved mockup \`${c.mockup}/\` (if there is one): the mockup's screens, tabs, buttons, texts and states. A deviation from the mockup — only with a reason in the ledger and in the message to the owner.`,
      needDeps(),
      `The rules do not reach subagents by themselves: include in every subagent's brief — ${agentLimits()}.`,
      c.subagents
        ? `The owner chose the subagent models: task implementers — \`${c.subagents}\` (the \`model\` parameter when launching a subagent), reviewing subagents (spec compliance, code quality) — this thread's model. The skill may suggest others — the owner's choice wins.`
        : "Run subagents on this thread's model (the owner's choice).",
      "Do not install, enable, disable or reload plugins; do not touch the working copy or other plugins; push nothing. The section badge on the bar lives in the plugin itself, per the template; the Workshop puts the section in its place on the bar from the spec's NAV line — neither is «outside the plugin». What still has to be done outside the plugin (for example, notes in project docs) — write a line «outside the plugin: …» in the ledger and tell the owner in your message.",
      "If the spec changes the plugin's commands, settings or behaviour — update its `README.md`: agents of later works read it.",
      "Do not silently resolve a mismatch with the spec or something in it that is impossible: write it in the ledger and tell the owner at the end of your turn.",
      `A send-back from Verification or Rollout (iteration 2 and later): do not change \`${c.docs.tz}\` — editing the spec after it was approved blocks the hand-over, and the work goes round through the Spec stage. New tasks of the iteration go to \`${c.iterationFile}\` as \`### Task N: …\` headings, numbering continues the spec; the ledger is the same. A fix without new tasks needs no iteration file.`,
      `\`${c.owner}\`: an item without which a task cannot proceed (a key, an account, a decision) — note it in the ledger and tell the owner at the end of your turn; what is done — mark it \`- [x]\`.`,
      ...(c.kind === "new"
        ? [
            "The plugin is new, its working copy is the `bb plugin new` scaffold with a sample todo list. The scaffold's skill reaches the instructions of every bb thread as soon as the plugin is installed, so on top of the spec tasks — remove the scaffold samples the spec does not use:",
            `- the skill ${scaffoldSkills} (bb picks up the \`skills/\` folder even without a manifest entry; if the manifest's \`bb.skills\` has an entry for it — remove that too);`,
            "- the «Example todos» demo panel: `app.tsx`, the todo contract and the `todos` storage in `server.ts`, the `showDone` setting;",
            `- the sample command \`bb ${c.id}\` with the todo list.`,
            "If the spec decided the plugin has no interface — remove `bb.app` from the manifest and the interface files (`app.tsx`, `components/`, `components.json`, `hooks/`, `lib/` of the scaffold, if nothing uses them).",
            "The scaffold's `README.md` describes the sample — rewrite it for the plugin: what it does, commands, settings.",
          ]
        : [`Verification sends the branch back if the scaffold skill (${scaffoldSkills}) or its entry in \`bb.skills\` is left in it: if it is there — remove it.`]),
      "Cancelled from the skill: the final review of the whole branch, deleting the ledger folder and finishing-a-development-branch — the next stages run verification and rollout.",
    ].join("\n"),
  5: (c) =>
    [
      `Round ${c.round}. Do not change or commit code: you write only the report.`,
      `Check the work branch — \`git diff ${c.base}...HEAD\` — against \`${c.docs.tz}\`, the iteration files \`${c.iterationFiles}\` (if any) and \`${c.docs.context}\` (\`${c.docs.tech}\` — for reference).`,
      "Go through the spec's «## Review Focus» section (if any) item by item: for each — what you checked and how (a test, a run, a place in the code).",
      `Compare the interface with the approved mockup \`${c.mockup}/index.html\` (if there is one): every screen, tab, button and state of the mockup exists in the plugin's interface; a deviation without a reason in the implementation ledger — FAIL.`,
      c.reviewers.length === 0
        ? "This work has no reviewers (the owner chose so): no «## Reviews» section is needed, the verdict is based on your check."
        : `The reviewers (${c.reviewers.join(", ")}) look at the branch at the same time as you. Write the report with a verdict without waiting for them. When their files are ready, they are sent to you: confirm or refute every blocking and important finding against the code (read it, run it if possible), add a «## Reviews» section to the report and set the final verdict — a confirmed blocking finding means FAIL.`,
      needDeps(),
      `Run one at a time, under the lock (\`${flock("<command>")}\`): \`npm test\`; \`npm run typecheck\`; \`bb plugin build\` (builds \`dist/\`, does not install the plugin); \`bb plugin types --check .\`.`,
      `Migrations: compare the diff with the \`MIGRATIONS\` line in \`${c.docs.tz}\` — new or changed SQLite schema migrations, changes to the data format in \`bb.storage\`. There are migrations but the spec says \`MIGRATIONS: no\` — FAIL. Released migrations edited or reordered — FAIL. It says \`MIGRATIONS: yes\` but there are no migrations — not a FAIL, but note it in the report: rollback becomes unavailable for nothing.`,
      "Check against the «bb plugin rules» below: the SDK pin is not newer than bb, no secrets in files or in git, ports — `127.0.0.1` or a private network address, no native dependencies, `bb.branding.icon` is in place, a plugin without an interface has no `bb.app`. A violation — FAIL.",
      "The navigation section: every `navPanel` in `app.tsx` has its own `NAV:` line in the spec (or in an iteration file) and its own badge registered in the plugin (`app.experimental_icons.register` under the section's icon name, not a built-in bb name); a plugin without a section — `NAV: none`. A missing badge or NAV line — FAIL.",
      "`VERDICT: FAIL` if the branch still has `skills/example-todos` or its entry in the manifest's `bb.skills`. The same for `skills/example-skill` and any skill whose `description` says it was created by `bb plugin new` (that is the scaffold, not the plugin's skill).",
      "At the end look at `git status` in the worktree: it must be clean (git ignores `dist/` and `node_modules/`), the verifier edits nothing. If junk appeared (a changed `package-lock.json`, a lock file, anything else) — do not commit or remove it, name it in the report.",
      "What cannot be checked without an install (the section in bb, the running plugin's log, the «Post-rollout check») — do not pretend: say so in the report; the «Rollout» stage checks it.",
      `The report is \`${verifyPath(c.key, c.round)}\` (create the folder if it does not exist): what you ran, the output, mismatches with the spec, what was not checked and why. FAIL — if something failed, did not build, does not match the spec, the rules are broken, or a substantial part of what can be checked without an install stayed unchecked. The last line of the report is exactly \`VERDICT: PASS\` or \`VERDICT: FAIL\`: no formatting or quotes, nothing after it.`,
    ].join("\n"),
  6: (c) =>
    [
      `Round ${c.round}. The plugin is already installed by the Workshop code: do not install, enable, disable or roll back anything. Do not change or commit code: you write only the report.`,
      "Work read-only. Commands that change the plugin's data — only if the spec's «Post-rollout check» names them; write nothing to external systems.",
      `Go through the «Post-rollout check» section in \`${c.docs.tz}\` (and in the iteration files \`${c.iterationFiles}\`, if any) in order and look at \`bb plugin list\` and \`bb plugin logs ${c.id}\`. The installed commit and the details of this install are in the packet at the end of the message; no packet — \`git -C ${shq(c.dir)} rev-parse HEAD\` gives the commit (read-only).`,
      `The report is \`${livePath(c.key, c.round)}\` (create the folder if it does not exist): the installed commit on the first line, then item by item of the «Post-rollout check» — what you ran and what you got; the log; the path to a screenshot, if you took one; what was not checked and why. FAIL — if any item failed, the log has load errors, the plugin did not come up, or a substantial part stayed unchecked. The last line of the report is exactly \`VERDICT: PASS\` or \`VERDICT: FAIL\`: no formatting or quotes, nothing after it.`,
    ].join("\n"),
};

/** The stage's skills and references — from stageKnowledge(). */
function knowledgeBlock(no: StageNo): string {
  const k = stageKnowledge()[no];
  const lines: string[] = [];
  if (k.skills.length > 0) {
    lines.push("Skills of the stage — read them before you start:");
    for (const s of k.skills) {
      lines.push(BUILTIN_SKILLS.has(s) ? `- bb's built-in skill \`${s}\` — invoke it as a built-in skill` : `- \`${s}\` — if such a skill is installed (among the thread's skills), use it`);
    }
  }
  if (k.sources.length > 0) {
    lines.push("References — open them when needed:");
    for (const s of k.sources) lines.push(`- ${s}`);
  }
  return lines.join("\n");
}

const roleWord = (stage: Stage, role: Role) => (role === "review" ? "reviewer" : stage.no === 5 ? "verifier" : stage.no === 6 ? "live-check verifier" : "agent");

function stageText(no: number, c: Ctx): string {
  const rule = REGULATIONS[no as StageNo];
  if (!rule) throw new Error(`stage ${no} has no agent`);
  return rule(c);
}

export function regulationOf(no: StageNo): string {
  // The text without the work's values — for the regulation version; both work kinds, the stage knowledge and the rules are part of it too.
  const blank = (kind: WorkKind): Ctx => ({
    id: "<id>", key: "<KEY>", kind, dir: pluginDir("<id>"), docs: docPaths("<KEY>"), owner: ownerPath("<KEY>"), iterationFile: iterationPath("<KEY>", 0),
    iterationFiles: `${docsDir("<KEY>")}/iteration-*.md`, mockup: mockupDir("<KEY>"), work: workDir("<KEY>"), base: "main", round: 0, subagents: "<model>", reviewers: ["<reviewer>"],
  });
  const variants = [...new Set((["rework", "new"] as const).map((kind) => stageText(no, blank(kind))))];
  return [variants.join("\n--\n"), knowledgeBlock(no), rulesText()].join("\n\n");
}

export function kickoff(w: WorkRow, stage: Stage, round: number, packet?: string): string {
  const c = ctxOf(w, round);
  return [
    `You are the ${roleWord(stage, "stage")} of the «${stage.title}» stage in the Plugin Workshop plugin. Work ${c.key} «${w.title}». Iteration ${w.iteration}.`,
    "",
    "The owner's request:",
    w.request,
    "",
    `Plugin: \`${c.id}\` — ${c.kind === "new" ? "new (its working copy holds the bb scaffold so far)" : "a rework of an existing plugin"}. The plugin's working copy: \`${c.dir}\`. You work in your own worktree of the work branch — the current folder.`,
    `Work documents (in git, in the work branch): \`${c.docs.context}\`, \`${c.docs.tech}\`, \`${c.docs.tz}\`, the mockup — \`${c.mockup}/\`, what is needed from the owner — \`${c.owner}\`, iteration add-ons — \`${c.iterationFiles}\`. The work folder (not in git): \`${c.work}/\`.`,
    "",
    stageText(stage.no, c),
    "",
    knowledgeBlock(stage.no),
    "",
    rulesText(),
    "",
    "Common rules: only the owner hands over, with a button in the «Plugin Workshop» panel. Do not push, do not merge, do not create PRs or bb threads. Do not install, enable, disable or reload plugins. Do not touch the working copy or other plugins.",
    `Heavy commands (\`npm install\`/\`ci\`, \`tsc\`, tests, \`bb plugin build\`) — only \`${flock("<command>")}\`, one at a time.`,
    "When you have finished the stage, end your turn with a short message to the owner: what was done and what they should look at.",
    ...(packet ? ["", packet] : []),
  ].join("\n");
}

/** Review — stages 3 and 5. The reviewer sees only files. */
export function reviewerPrompt(w: WorkRow, stage: Stage, who: Who, round: number): string {
  if (stage.no !== 3 && stage.no !== 5) throw new Error(`the «${stage.title}» stage has no review`);
  const c = ctxOf(w, round);
  const what =
    stage.no === 3
      ? `the spec \`${c.docs.tz}\` — against \`${c.docs.context}\` (what the owner wants) and \`${c.docs.tech}\` (what is possible)`
      : `the whole branch against the base — \`git diff ${c.base}...HEAD\` — against the spec \`${c.docs.tz}\`, the iteration files \`${c.iterationFiles}\` (if any) and the context \`${c.docs.context}\``;
  const look =
    stage.no === 3
      ? `What to look at: is all of \`context.md\` covered; is there a «Post-rollout check» section and a \`MIGRATIONS: yes|no\` line, and do they match the plan; does the plan break the «bb plugin rules» from your instructions; can the plan be carried out task by task; is everything needed from the owner before implementation (keys, accounts, paid plans, decisions) in \`${c.owner}\`; are there \`NAV\` lines and a task for the section badge in the plugin itself (the section on the bar is part of the work).`
      : `What to look at: does the code match the spec and the context; does the interface match the approved mockup \`${c.mockup}/\` (if there is one); does \`MIGRATIONS\` in the spec match the diff; does every navigation section have a badge in the plugin and a \`NAV\` line in the spec; are the «bb plugin rules» from your instructions broken (secrets, the SDK pin, edits to released migrations, ports, scaffold leftovers — \`skills/example-todos\`).`;
  return [
    `You are a reviewer (${labelFor(modelsOf(w.models), "review", stage.no, who)}) of the «${stage.title}» stage, round ${round}. Work ${c.key} «${w.title}», plugin \`${c.id}\`.`,
    `What to review: ${what}.`,
    look,
    "Do not open the stages' conversations — files only. Change nothing except your review file; do not commit, do not create threads.",
    `The answer goes to the file \`${reviewPath(c.key, stage.key, who, round)}\` (create the folder if it does not exist): findings by severity (blocking / important / minor), each with what is wrong, what it risks and what you propose.`,
    "The last line of the file is exactly `VERDICT: BLOCKING` if there is at least one blocking finding, otherwise exactly `VERDICT: CLEAR`: no formatting or quotes, nothing after it.",
  ].join("\n");
}

/** Stage 3: the reviews are ready — the agent closes the items. */
export function reviewsReady(w: WorkRow, files: string[]): string {
  const c = ctxOf(w, 0);
  return [
    `Reviews ready: ${files.map((f) => `\`${f}\``).join(", ")}.`,
    `Close every item in the «## Review» section of \`${c.docs.tz}\`: «accepted — what changed» or «rejected — why». Commit and end your turn with a message to the owner.`,
  ].join("\n");
}

/** Stage 5: the reviews are ready — the verifier confirms or refutes their items against the code and sets the final verdict. */
export function reviewsForVerifier(w: WorkRow, files: string[], round: number): string {
  return [
    `Branch reviews ready: ${files.map((f) => `\`${f}\``).join(", ")}.`,
    `Confirm or refute every blocking and important finding against the code (read it, run it if possible). Add a «## Reviews» section to the report \`${verifyPath(ctxOf(w, round).key, round)}\`: per item — «confirmed — how» or «refuted — how». A confirmed blocking finding — \`VERDICT: FAIL\`. Do not change code; the last line of the report is still the verdict. End your turn with a message to the owner.`,
  ].join("\n");
}

/**
 * Stage 6: the facts of the install for the live-check thread — the commit, the report, what to look at.
 * The thread gets `kickoff(w, stageOf(6), round, liveCheckPrompt(...))`: rules and knowledge come with the kickoff, the facts — here.
 */
export function liveCheckPrompt(w: WorkRow, round: number, attempt: AttemptRow, o: { needsConfiguration?: boolean } = {}): string {
  const c = ctxOf(w, round);
  const sha = attempt.target_sha ?? "unknown";
  let n = 2;
  return [
    `Live check, round ${round}. Plugin \`${c.id}\` is installed${attempt.kind === "reinstall" ? " (a repeated install of the same copy)" : ""} from the working copy \`${c.dir}\`; the installed commit is \`${sha}\`.`,
    `Cross-check: \`git -C ${shq(c.dir)} rev-parse HEAD\` (read-only) must give the same commit. If it differs — what was installed is not what was verified: \`VERDICT: FAIL\`, name both commits.`,
    `1. Read the «Post-rollout check» section in \`${c.docs.tz}\` and go through its items in order: CLI commands with the expected output, the section in bb, settings.`,
    `2. \`bb plugin list\` and \`bb plugin logs ${c.id}\`: the plugin came up (\`running\`; \`needs-configuration\` — only if the spec names those settings: that is a remark, not a failure), the log has no load errors. A plugin that failed to load does not complain — it just does not work: read the log to the end.`,
    // An install that ended in `needs-configuration` is a successful rollout; which settings it waits for, the verifier names itself.
    ...(o.needsConfiguration
      ? [`${++n}. After the install the plugin came up in the \`needs-configuration\` state — it needs configuration. In the report, as a separate item «Needs configuration», name which settings it is waiting for (\`statusDetail\` in \`bb plugin list\`, the log), whether the spec has them and what was checked without them. Configure nothing yourself.`]
      : []),
    ...(attempt.migrations ? [`${++n}. The work added data migrations: check that the plugin came up on the new schema and the previous data are in place (a command or a section from the spec).`] : []),
    `${++n}. If the plugin has a section in the interface — open it in bb's browser and take a screenshot (the built-in skill \`browser-automation\`): the direct address \`/plugins/${c.id}/<path>\` (\`path\` — from \`navPanel\` in \`app.tsx\`); wait for the data by polling the page text in a loop; do not use \`setViewport\` and \`waitForFunction\` — they stopped the session; set the width with the page's CSS \`zoom\`. The first load after an install may fail with «bb hit an error» — open the page again in short steps or start a new session. Close the browser session at the end. A recipe with commands — \`${browserRecipePath()}\`.`,
    `${++n}. If the work has an approved mockup (\`${c.mockup}/\`): compare the captured section with it (the screenshots \`${c.mockup}/desktop.png\`, \`phone.png\`, the \`index.html\` itself) — screens, tabs, buttons, layout. A noticeable deviation — FAIL, list each one.`,
    `${++n}. The section on the navigation bar (the \`NAV\` lines in the spec): the Workshop put it in place on rollout — in \`bb settings ui list\` it is in \`sidebar.visiblePluginPanels\` and stands in \`sidebar.pluginPanelOrder\` after the neighbour from the NAV line; its coloured badge is visible in a screenshot of the bar. Otherwise — FAIL. \`NAV: none\` — skip this item.`,
    "Do not install, enable, disable or roll back anything; do not change code. Commands that change the plugin's data — only if the «Post-rollout check» names them; write nothing to external systems.",
    `The report is \`${livePath(c.key, round)}\`; what goes in it and its last line — in the stage rules above.`,
  ].join("\n");
}

export function returnPacket(w: WorkRow, to: Stage, from: Stage, reason: string, iteration: number): string {
  const c = ctxOf(w, 0);
  return [
    `Sent back from the «${from.title}» stage to «${to.title}», iteration ${iteration}.`,
    `The owner's reason: ${reason.trim()}`,
    ...(from.no === 6
      ? ["If the plugin is installed — fix forward: new commits in the work branch; after a rollback it runs the previous version. Roll back or reinstall nothing yourself: the Workshop code does that on the owner's buttons."]
      : []),
    ...(to.no === 4
      ? [`Do not change \`${c.docs.tz}\`. New tasks of this iteration go to \`${iterationPath(c.key, iteration)}\` (\`### Task N: …\`, numbering continues the spec); a fix without new tasks needs no such file.`]
      : []),
    ...(to.no === 3
      ? [
          c.reviewers.length === 0
            ? "This work has no reviews (the owner chose so): the changed spec with the MIGRATIONS line means «spec ready» — the owner decides from there. If you need the owner's answer before the spec is ready — remove the MIGRATIONS line for that time."
            : `The spec review (${c.reviewers.join(", ")}) starts on its own as soon as you finish your turn with the changed spec and the MIGRATIONS line. If you need the owner's answer before the spec is ready — remove the MIGRATIONS line for that time.`,
        ]
      : []),
    ...(to.no === 2 ? [ownerLine(c)] : []),
    ...(to.no === 7 ? [mockupLine(c)] : []),
    `Reread the current files (\`${c.docs.context}\`, \`${c.docs.tech}\`, \`${c.docs.tz}\`, the reports in \`${c.work}/\`) and complete the stage again. When done — a message to the owner.`,
  ].join("\n");
}

export function inputsChanged(w: WorkRow, stage: Stage): string {
  const c = ctxOf(w, 0);
  const text = `The work is at the «${stage.title}» stage again (iteration ${w.iteration}). The input files may have changed — reread them (\`${c.docs.context}\`, \`${c.docs.tech}\`, \`${c.docs.tz}\`, the reports in \`${c.work}/\`), complete the stage and end your turn with a message to the owner. If this message arrives again, it brings nothing beyond what you have already taken into account.`;
  if (stage.no === 2) return `${text}\n${ownerLine(c)}`;
  if (stage.no === 7) return `${text}\n${mockupLine(c)}`;
  return text;
}

/** Back at «Mockup»: what to do with the mockup. */
function mockupLine(c: Ctx): string {
  return `Edit the mockup \`${c.mockup}/index.html\` for the reason above, retake \`${c.mockup}/desktop.png\` and \`phone.png\`, commit and show it to the owner with the directive \`::inline-vis{file="${c.mockup}/index.html" height="900"}\` — in the message on a line of its own and without backticks.`;
}

/** Feasibility back on a send-back or changed inputs: without the owner checklist the stage does not pass the gate. */
function ownerLine(c: Ctx): string {
  return `What is needed from the owner before implementation — \`${c.owner}\`: a checklist of \`- [ ] …\` lines (keys — the owner enters them with the \`secrets\` skill; accounts, paid plans, decisions); nothing needed — \`- nothing\`. Without this file the stage does not pass the gate.`;
}

export function identity(w: WorkRow, stage: Stage, role: Role): string {
  const c = ctxOf(w, 0);
  return [
    `Plugin Workshop: you are the ${roleWord(stage, role)} of the «${stage.title}» stage of work ${c.key} «${w.title}» on the plugin \`${c.id}\`. The work folder is ${c.work}/. Only the owner hands over, with a button in the «Plugin Workshop» panel.`,
    "",
    rulesText(),
  ].join("\n");
}

export function threadTitle(w: WorkRow, stage: Stage, role: Role, who: Who, round: number): string {
  const key = ctxOf(w, round).key;
  if (role === "review") return `${key} · review ${labelFor(modelsOf(w.models), "review", stage.no, who)} · ${stage.title} · r${round}`;
  return stage.freshEachRound ? `${key} · ${stage.title} · r${round}` : `${key} · ${stage.title}`;
}
