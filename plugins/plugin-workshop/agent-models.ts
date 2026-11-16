/**
 * Agent-model constants shared by the frontend and the server. No imports on purpose: the frontend bundle uses this module, while
 * `contract.ts` and `server/models.ts` pull the server SDK and may be imported by the frontend only with `import type`
 * (`frontend-imports.test.ts` checks it).
 */

/** Reasoning levels accepted when starting a bb thread (`reasoningLevel`). */
export const EFFORTS = ["none", "low", "medium", "high", "xhigh", "max", "ultra", "ultracode"] as const;

/** Titles of the agent-model rows: in the «Agent models» form and in the checks' messages. */
export const GROUP_TITLE = {
  docs: "Documents (Context, Feasibility, Spec, Mockup)",
  build: "Implementation",
  check: "Verification and Rollout",
  pilot: "Autopilot orchestrator",
  subagents: "Implementation subagents (task implementers)",
} as const;
