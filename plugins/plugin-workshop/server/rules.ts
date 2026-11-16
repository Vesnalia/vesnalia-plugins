// bb plugin rules and per-stage agent knowledge. These are data and texts: edit them without touching the mechanics.
// Every Plugin Workshop agent gets the rules — in the first message of its stage (kickoff) and in the thread instructions (identity).
import { homedir } from "node:os";
import { join, posix } from "node:path";
import { PLUGINS_ROOT, SELF_ID, type StageNo } from "./stages";

/**
 * Why a path setting (`pluginsRoot`, `buildLock`) cannot be used; null — it can. The path goes into argv (`flock`, `git -C`) and into shell
 * examples for agents, so it must be absolute (it then never starts with `-` and cannot be read as an option), normalized (no `//`, `.` or
 * `..` segments, no trailing `/`, not `/` itself) and made of letters, digits and `. _ / @ + -` only.
 */
export function pathSettingProblem(p: string): string | null {
  if (!p.startsWith("/")) return "not an absolute path";
  if (p === "/" || p.endsWith("/") || posix.normalize(p) !== p) return "not a normalized path (no `//`, `.` or `..` segments, no trailing `/`, not `/` itself)";
  if (!/^[A-Za-z0-9._/@+-]+$/.test(p)) return "only letters, digits and `. _ / @ + -` are allowed";
  return null;
}

/** A value inside a shell example for agents: single-quoted (a `'` inside becomes `'\''`). Defaults come from the home folder and are quoted too. */
export const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * Folder with the Workshop guides (`mockup-guide.md`, `nav-badge.md`, `browser-recipe.md`): the `docs/` of the installed plugin. Set at
 * startup from the plugin's install folder (`setDocsRoot`); until then — a description agents can still follow.
 */
export let DOCS_ROOT = `the docs/ folder of the ${SELF_ID} plugin package`;
export function setDocsRoot(p: string): void {
  DOCS_ROOT = p.replace(/\/+$/, "");
}
/** Shared build lock: every heavy command goes through it (setting `buildLock`, default `~/.bb/locks/build.lock`). */
export let BUILD_LOCK = join(homedir(), ".bb", "locks", "build.lock");
export function setBuildLock(p: string): void {
  BUILD_LOCK = p;
}
/** How to draw a plugin section mockup in bb's look (stage «Mockup»). */
export const mockupGuidePath = () => `${DOCS_ROOT}/mockup-guide.md`;
/** Navigation badge template and the `NAV` lines of the spec. */
export const navGuidePath = () => `${DOCS_ROOT}/nav-badge.md`;
/** How to open a plugin section in bb's browser and take screenshots. */
export const browserRecipePath = () => `${DOCS_ROOT}/browser-recipe.md`;

/** The rules every Workshop agent follows. */
export function rulesText(): string {
  return [
    "## bb plugin rules",
    `- A plugin lives in \`${PLUGINS_ROOT}/bb-plugin-<id>\` with its own git repository. Commit after every working state (verifiers and reviewers commit nothing). You work in the worktree of the work branch. Do not change the plugin's working copy: bb builds the running plugin from it, and only the Workshop code moves its main branch on rollout and rollback.`,
    "- Only the Workshop code installs, enables and disables plugins, on the owner's buttons — an agent never does: no `bb plugin install`, `enable`, `disable`, `reload`, `remove`. Do not push and do not open pull requests (the Workshop pushes the work branch itself when GitHub is configured). `bb plugin reload` does not rebuild the bundle — only `install` does; say «install», not «reload», in specs and reports.",
    "- Pin `@get-bb/plugin-sdk` in `package.json` to the host's SDK version or lower (`bb plugin types --check <folder>` prints «host is …»); npm-latest can be newer than the host — do not pin to it. After changing dependencies — `bb plugin types --check <folder>`; if it differs — `bb plugin types <folder>` and `npm install --ignore-scripts`.",
    "- The manifest is the `bb` section of `package.json`: `server`, `app`, `skills`. `bb.branding.icon` is always required, even without an interface: without it `bb plugin install` refuses. bb does not build native dependencies.",
    "- A plugin without an interface has no `bb.app` in the manifest and no interface files.",
    "- Plugin data is SQLite via `bb.storage.database()`. Migrations are append-only: never edit or reorder released ones; keep them compatible with the old code where possible. Rollback restores code only; data stays.",
    `- Heavy commands — \`npm install\`/\`ci\`, \`tsc\` (\`npm run typecheck\`), tests, \`bb plugin build\` — only through the shared lock: \`flock ${shq(BUILD_LOCK)} <command>\`, one at a time, never in parallel and never without the lock (parallel builds can exhaust the server's memory). \`node_modules\` take 50–180 MB — do not make extra copies.`,
    "- Dependencies are installed without their install scripts: `npm ci --ignore-scripts` (no `package-lock.json` — `npm install --ignore-scripts`), the same way the Workshop installs them on rollout. If tests need a native binding (for example `better-sqlite3`), build just that package after looking at what it runs: `npm rebuild <package> --ignore-scripts=false` (also under the lock; without the flag an `ignore-scripts=true` npm config skips the build).",
    `- A section in the navigation bar is part of the work, not «to do outside the plugin»: the plugin registers its badge itself in its \`app.tsx\` (\`app.experimental_icons.register\` under the icon name from \`navPanel({ icon })\`); its place on the bar is the line \`NAV: <id>/<section> after <neighbour>\` in the spec, applied by the Workshop on rollout. Template and rules — \`${navGuidePath()}\`. Do not touch bb settings.`,
    "- Plugin skills live in its `skills/`. A `description` with a colon and a space needs a block scalar (`>-`): otherwise the frontmatter breaks and the skill is rejected.",
    "- Secrets go into plugin settings or bb's env store — never into files or git. Listen only on `127.0.0.1` (or a private network address).",
    "- If a key or password is needed, do not ask for it in chat: the owner enters it with bb's built-in `secrets` skill (an `.env` file in the work folder whose values you do not see). Never write keys into documents, reports or git.",
    "- After an install, check `bb plugin logs <id>`: a plugin that failed to load does not complain — it just does not work.",
  ].join("\n");
}

/** What a stage agent knows: skills (installed in bb or built into it) and references — where to look. */
export interface StageKnowledge {
  skills: string[];
  sources: string[];
}

/** bb's built-in skills: the agent invokes them as built-in skills (the Skill tool). Others are used only if installed. */
export const BUILTIN_SKILLS: ReadonlySet<string> = new Set(["bb-plugin-authoring", "browser-automation", "secrets", "inline-vis"]);

const SOURCE_README = "the plugin's `README.md` — at the root of the plugin repository: what it does, commands, settings";
const SOURCE_SDK =
  "`node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk.d.ts` — SDK types, which APIs exist (interface — `bb-plugin-sdk-app.d.ts`, host part — `bb-plugin-sdk-host.d.ts`). Check that `node_modules/@get-bb/plugin-sdk/package.json` matches the host's SDK version (`bb plugin types --check <folder>` prints «host is …») and trust only types of the matching version: older SDK types lie about the host APIs. A fresh worktree has no `node_modules` — install them under the build lock first";
const SOURCE_HELP = "`bb plugin --help` — bb commands for plugins";
const SOURCE_LIST = "`bb plugin list` — which plugins are installed and in what state";
const SOURCE_LOGS = "`bb plugin logs <id>` — the plugin log (`<id>` — the plugin of this work)";

/** Knowledge per stage. Tune a stage by editing these lists; leave the regulations and the mechanics alone. */
export function stageKnowledge(): Record<StageNo, StageKnowledge> {
  const browser = `\`${browserRecipePath()}\` — how to open the plugin section in bb's browser and take screenshots (recipe)`;
  const nav = `\`${navGuidePath()}\` — the navigation bar section: the badge inside the plugin (template) and the \`NAV\` line in the spec`;
  const mockup = `\`${mockupGuidePath()}\` — how to draw the section mockup in bb's look: colours, fonts, sizes, a markup sample`;
  const common = [SOURCE_README, SOURCE_SDK, SOURCE_HELP, nav];
  return {
    1: { skills: ["brainstorming"], sources: [...common] },
    2: { skills: ["bb-plugin-authoring", "secrets"], sources: [...common, SOURCE_LIST, SOURCE_LOGS] },
    3: { skills: ["writing-plans"], sources: [...common] },
    7: { skills: ["frontend-design", "browser-automation", "inline-vis"], sources: [...common, mockup, browser] },
    4: { skills: ["subagent-driven-development", "test-driven-development", "secrets"], sources: [...common] },
    5: { skills: ["verification-before-completion"], sources: [...common, SOURCE_LIST, SOURCE_LOGS] },
    6: { skills: ["verification-before-completion", "browser-automation"], sources: [...common, browser] },
  };
}
