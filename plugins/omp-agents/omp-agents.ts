// Pure helpers for discovering OMP task agents and turning them into
// composer @-mention rows. No VesnALIA API here, so every rule is unit-testable.
import * as os from "node:os";
import * as path from "node:path";

/** OMP's own task-agent name rule (`TASK_AGENT_NAME_PATTERN` in omp). */
const AGENT_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

export type AgentScope = "project" | "user" | "extra";

export interface OmpAgent {
  name: string;
  description: string;
  tools: string[];
  model: string[];
  spawns: string[];
  scope: AgentScope;
  /** Absolute path of the definition file. */
  filePath: string;
}

const DESCRIPTION_MAX = 600;

/** Expand a leading `~` against `home`; leave other paths untouched. */
export function expandHome(value: string, home: string = os.homedir()): string {
  const trimmed = value.trim();
  if (trimmed === "~") return home;
  if (trimmed.startsWith("~/")) return path.join(home, trimmed.slice(2));
  return trimmed;
}

/**
 * User-scope agent roots, mirroring omp's own resolution
 * (`getConfigDirs("agents", { project: false })`):
 * `PI_CODING_AGENT_DIR/agents` first, then `<config-root>/agent/agents`, or
 * `<config-root>/profiles/<profile>/agent/agents` when a profile is active.
 */
export function userAgentRoots(
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): string[] {
  const roots: string[] = [];

  const codingAgentDir = env.PI_CODING_AGENT_DIR?.trim();
  if (codingAgentDir) {
    roots.push(path.join(expandHome(codingAgentDir, home), "agents"));
  }

  const configDirName = env.PI_CONFIG_DIR?.trim() || ".omp";
  const configRoot = path.isAbsolute(configDirName)
    ? configDirName
    : path.join(home, configDirName);
  const profile = env.OMP_PROFILE?.trim() || env.PI_PROFILE?.trim();
  roots.push(
    profile
      ? path.join(configRoot, "profiles", profile, "agent", "agents")
      : path.join(configRoot, "agent", "agents"),
  );

  return [...new Set(roots)];
}

/** Strip one layer of matching quotes from a scalar. */
function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    if ((first === '"' || first === "'") && value.endsWith(first)) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/**
 * Parse the YAML frontmatter block of an OMP agent definition.
 *
 * Deliberately a small reader, not a YAML engine: agent frontmatter is a flat
 * map of scalars, `- item` lists, and `>`/`|` block scalars, which is all omp
 * itself needs. Nested mappings (for example a reviewer's `output:` schema)
 * are ignored rather than mis-parsed.
 */
function parseFrontmatter(content: string): Record<string, string | string[]> {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return {};

  let end = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "---") {
      end = index;
      break;
    }
  }
  if (end === -1) return {};

  const fields: Record<string, string | string[]> = {};
  for (let index = 1; index < end; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const match = /^([A-Za-z0-9_-]+):(.*)$/.exec(line);
    if (match === null) continue;
    const key = match[1] as string;
    const rest = match[2]!.trim();

    // Block scalar: `description: >-`, `|`, `>-2`, ...
    if (/^[|>][+-]?\d*$/.test(rest)) {
      const folded = rest.startsWith(">");
      const block: string[] = [];
      let cursor = index + 1;
      for (; cursor < end; cursor += 1) {
        const blockLine = lines[cursor]!;
        if (blockLine.trim() === "") {
          block.push("");
          continue;
        }
        if (!/^\s/.test(blockLine)) break;
        block.push(blockLine.trim());
      }
      index = cursor - 1;
      fields[key] = folded
        ? block.join(" ").replace(/\s+/g, " ").trim()
        : block.join("\n").trim();
      continue;
    }

    // Empty scalar: either an indented `- item` list or a nested mapping.
    if (rest === "") {
      const items: string[] = [];
      const nested: string[] = [];
      let cursor = index + 1;
      for (; cursor < end; cursor += 1) {
        const nestedLine = lines[cursor]!;
        if (nestedLine.trim() === "") continue;
        if (!/^\s/.test(nestedLine)) break;
        const item = /^\s*-\s+(.*)$/.exec(nestedLine);
        if (item !== null) items.push(unquote(item[1]!.trim()));
        else nested.push(nestedLine.trim());
      }
      index = cursor - 1;
      if (items.length > 0) fields[key] = items;
      else if (nested.length > 0) fields[key] = nested.join(" ");
      continue;
    }

    fields[key] = unquote(rest);
  }

  return fields;
}

/** Normalize a frontmatter value into a string list (CSV scalars included). */
function toStringList(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  const raw = Array.isArray(value) ? value : value.split(",");
  return raw.map((entry) => entry.trim()).filter((entry) => entry !== "");
}

/** Build an agent record from one definition file, or null when unusable. */
export function parseAgentMarkdown(
  filePath: string,
  content: string,
  scope: AgentScope,
): OmpAgent | null {
  const fields = parseFrontmatter(content);
  const name = typeof fields.name === "string" ? fields.name.trim() : "";
  const description =
    typeof fields.description === "string" ? fields.description.trim() : "";
  if (name === "" || description === "") return null;
  // The host composes wire item ids as "<providerId>:<itemId>", so a name with
  // a colon (or any character omp itself rejects) cannot be a mention id.
  if (!AGENT_NAME_PATTERN.test(name)) return null;

  return {
    name,
    description,
    tools: toStringList(fields.tools),
    model: toStringList(fields.model),
    spawns: toStringList(fields.spawns),
    scope,
    filePath,
  };
}

function byName(left: OmpAgent, right: OmpAgent): number {
  return left.name.localeCompare(right.name);
}

/**
 * Merge scopes with omp's precedence — a project definition shadows the user
 * one of the same name — preserving the given order for equal names.
 */
export function mergeAgents(...groups: OmpAgent[][]): OmpAgent[] {
  const seen = new Set<string>();
  const merged: OmpAgent[] = [];
  for (const group of groups) {
    for (const agent of group) {
      if (seen.has(agent.name)) continue;
      seen.add(agent.name);
      merged.push(agent);
    }
  }
  return merged;
}

function isSubsequence(needle: string, haystack: string): boolean {
  let cursor = 0;
  for (const character of haystack) {
    if (character === needle[cursor]) cursor += 1;
    if (cursor === needle.length) return true;
  }
  return needle.length === 0;
}

/** Relevance score for one agent; 0 means "no match". */
function scoreAgent(agent: OmpAgent, query: string): number {
  const name = agent.name.toLowerCase();
  const description = agent.description.toLowerCase();
  const tokens = query.split(/\s+/).filter((token) => token !== "");

  let score = 0;
  if (name === query) score = 1000;
  else if (name.startsWith(query)) score = 900 - name.length;
  else if (name.includes(query)) score = 700 - name.indexOf(query);
  else if (isSubsequence(query, name)) score = 500 - name.length;

  const descriptionIndex = description.indexOf(query);
  if (descriptionIndex !== -1) {
    score = Math.max(score, 300 - Math.min(200, descriptionIndex));
  }
  if (
    tokens.length > 1 &&
    tokens.every((token) => name.includes(token) || description.includes(token))
  ) {
    score = Math.max(score, 250);
  }
  return score;
}

/** Rank agents for a composer query, best match first. */
export function rankAgents(agents: OmpAgent[], query: string): OmpAgent[] {
  const normalized = query.trim().toLowerCase();
  if (normalized === "") return [...agents].sort(byName);
  return agents
    .map((agent) => ({ agent, score: scoreAgent(agent, normalized) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || byName(left.agent, right.agent))
    .map((entry) => entry.agent);
}

function truncate(value: string, max: number): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1).trimEnd()}…`;
}

/** One-line menu subtitle: scope plus the agent's own description. */
export function mentionSubtitle(agent: OmpAgent): string {
  return `${agent.scope} · ${truncate(agent.description, 120)}`;
}

/**
 * Agent-visible context attached when the mention is sent. It carries the
 * specialization and how to delegate to it, not the agent's whole system
 * prompt (bounded output; the definition path is there for a full read).
 *
 * The delegation paragraph names OMP explicitly and tells the model what to do
 * when it is NOT running under OMP. A thread on another provider receives this
 * same text, and several providers ship their own `task` tool with different
 * semantics, so an unqualified "call the task tool" would read as an
 * instruction to use the wrong one. `message.dispatch` also rejects such a
 * send, but a user's explicit Send-now bypasses that hook by design, so the
 * text has to be safe on its own.
 */
export function renderMentionContext(agent: OmpAgent): string {
  const tools = agent.tools.length > 0 ? agent.tools.join(", ") : "inherits defaults";
  const model = agent.model.length > 0 ? agent.model.join(", ") : "inherits defaults";
  return [
    `The user referenced the OMP subagent "${agent.name}" (${agent.scope} scope).`,
    "",
    `Specialization: ${truncate(agent.description, DESCRIPTION_MAX)}`,
    `Tools: ${tools}`,
    `Model: ${model}`,
    `Definition: ${agent.filePath}`,
    "",
    "This subagent exists only inside OMP. If you are an OMP session, delegate to",
    "it with OMP's `task` tool:",
    `  task({ agent: "${agent.name}", task: "<the user's request>", solutionSpace: "<how open the problem is>" })`,
    "Batch independent items into one `tasks[]` call; keep dependencies sequential.",
    "",
    "If you are NOT an OMP session, you cannot spawn it — do not call a `task`",
    "tool of your own with this name, and do not pretend the work was delegated.",
    `Say that "${agent.name}" needs an OMP thread, then either do the work`,
    "yourself or read the definition file and follow its instructions.",
  ].join("\n");
}
