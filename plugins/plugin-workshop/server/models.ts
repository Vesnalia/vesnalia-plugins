// Models of the work's agents. The owner picks them before the start — per stage group, the reviewers (model and count 0–2),
// the autopilot orchestrator and the Implementation subagents; the choice is stored in the work (`works.models`, JSON) and does not change after the start.
// Reviewers are two slots, "fable" and "astra" (their threads and review files are named so); the slot's model comes from the work's choice.
import { GROUP_TITLE as TITLES } from "../agent-models";
import { workModelsSchema, type AgentChoice, type WorkModels } from "../contract";
import type { StageNo, Who } from "./stages";

const choice = (providerId: string, model: string, label: string): AgentChoice => ({ providerId, model, effort: null, label });
/** As it was before the choice existed: agents — Claude Opus 5.5, reviewers — Fable 5.1 and GPT-6-Astra, Implementation subagents — Sonnet 5.5. */
export const DEFAULT_MODELS: WorkModels = {
  docs: choice("claude-code", "claude-opus-5-5", "Opus 5.5"),
  build: choice("claude-code", "claude-opus-5-5", "Opus 5.5"),
  check: choice("claude-code", "claude-opus-5-5", "Opus 5.5"),
  pilot: choice("claude-code", "claude-opus-5-5", "Opus 5.5"),
  subagents: choice("claude-code", "claude-sonnet-5-5", "Sonnet 5.5"),
  reviewers: [choice("claude-code", "claude-fable-5-1", "Fable 5.1"), choice("codex", "gpt-6-astra", "GPT-6-Astra")],
};

/** The work's choice; works from before model choice (null) and a corrupted record get the defaults. */
export function modelsOf(raw: string | null | undefined): WorkModels {
  if (!raw) return DEFAULT_MODELS;
  try {
    const r = workModelsSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : DEFAULT_MODELS;
  } catch {
    return DEFAULT_MODELS;
  }
}

export type StageGroup = "docs" | "build" | "check";
export const GROUP_OF_STAGE: Record<StageNo, StageGroup> = { 1: "docs", 2: "docs", 3: "docs", 7: "docs", 4: "build", 5: "check", 6: "check" };
/** Titles of the agent-model rows — shared with the frontend (agent-models.ts). */
export const GROUP_TITLE: Record<StageGroup | "pilot" | "subagents", string> = TITLES;
/** Reviewer slots in order. */
export const REVIEW_SLOTS: readonly Who[] = ["fable", "astra"];

/** The work's reviewers: the first N slots, by the number chosen. */
export function reviewersOf(m: WorkModels): Who[] {
  return REVIEW_SLOTS.slice(0, m.reviewers.length) as Who[];
}

/** The agent of a work thread: a reviewer — by slot, a stage agent — by stage group. */
export function agentOf(m: WorkModels, role: "stage" | "review", stage: StageNo, who: Who): AgentChoice {
  if (role === "review") {
    const i = REVIEW_SLOTS.indexOf(who);
    return m.reviewers[i] ?? m.reviewers[0] ?? DEFAULT_MODELS.reviewers[i === 1 ? 1 : 0]!;
  }
  return m[GROUP_OF_STAGE[stage]];
}

/** Agent label: model and reasoning effort ("Opus 5.5 · high"). */
export const choiceLabel = (c: AgentChoice) => `${c.label || c.model}${c.effort ? ` · ${c.effort}` : ""}`;

/** The thread agent's label; two reviewers with the same label are told apart by number ("Opus 5.5 · #2"). */
export function labelFor(m: WorkModels, role: "stage" | "review", stage: StageNo, who: Who): string {
  const base = choiceLabel(agentOf(m, role, stage, who));
  if (role !== "review" || m.reviewers.length < 2 || choiceLabel(m.reviewers[0]!) !== choiceLabel(m.reviewers[1]!)) return base;
  return `${base} · #${REVIEW_SLOTS.indexOf(who) + 1}`;
}

/** Model name for the `model` parameter of a Claude Code subagent; not Claude — null (subagents then run on the thread's model). */
export function subagentAlias(c: AgentChoice): "opus" | "sonnet" | "haiku" | "fable" | null {
  if (c.providerId !== "claude-code") return null;
  const m = /claude-(opus|sonnet|haiku|fable)/.exec(c.model);
  return m ? (m[1] as "opus" | "sonnet" | "haiku" | "fable") : null;
}

type Catalog = { providers: Array<{ id: string; models: Array<{ id: string; label: string; efforts: string[] }>; error?: string | null }> };
const same = (a: AgentChoice, b: AgentChoice | undefined) => !!b && a.providerId === b.providerId && a.model === b.model && a.effort === b.effort;

/**
 * Checks the choice when the work starts. Provider, model and effort — against the VesnALIA list; labels come from it too (not from the form). A choice
 * equal to the default passes even when its provider is not responding right now (login expired, timeout): the work depends on it no more
 * than before model choice existed. If the list did not arrive at all — only the defaults are allowed.
 */
export function checkModels(m: WorkModels, catalog: Catalog | null): { problems: string[]; models: WorkModels } {
  const problems: string[] = [];
  if (subagentAlias(m.subagents) === null) problems.push("Implementation subagents — Claude models only (Opus, Sonnet, Haiku, Fable)");
  const fix = (what: string, c: AgentChoice, def: AgentChoice | undefined): AgentChoice => {
    if (!catalog) {
      if (!same(c, def)) problems.push(`${what}: the VesnALIA model list did not arrive — only the default is allowed right now`);
      return def ?? c;
    }
    const p = catalog.providers.find((x) => x.id === c.providerId);
    const model = p?.models.find((x) => x.id === c.model);
    if (!model) {
      if (same(c, def)) return def!;
      problems.push(!p ? `${what}: VesnALIA has no provider ${c.providerId}` : p.error ? `${what}: ${p.id} is not returning models right now (${p.error})` : `${what}: ${c.providerId} has no model ${c.model}`);
      return c;
    }
    if (c.effort !== null && !model.efforts.includes(c.effort)) problems.push(`${what}: ${c.model} has no effort level ${c.effort}`);
    return { ...c, label: model.label };
  };
  const models: WorkModels = {
    docs: fix(GROUP_TITLE.docs, m.docs, DEFAULT_MODELS.docs),
    build: fix(GROUP_TITLE.build, m.build, DEFAULT_MODELS.build),
    check: fix(GROUP_TITLE.check, m.check, DEFAULT_MODELS.check),
    pilot: fix(GROUP_TITLE.pilot, m.pilot, DEFAULT_MODELS.pilot),
    subagents: fix(GROUP_TITLE.subagents, m.subagents, DEFAULT_MODELS.subagents),
    reviewers: m.reviewers.map((r, i) => fix(`Reviewer ${i + 1}`, r, DEFAULT_MODELS.reviewers[i])),
  };
  return { problems, models };
}
