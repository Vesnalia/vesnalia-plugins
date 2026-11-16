// Which ACP provider id gets which mark.
//
// bb has no per-model icon: every model row in the picker inherits its
// provider's logo (`availableModelSchema` carries no icon field), so the
// finest granularity bb can render is one mark per provider id.
//
// Built-in defaults cover the ACP agents bb ships without a logo. bb's own
// provider-acp plugin resolves a logo only for its 41 registry agents and for
// the four agents it ships (cursor, opencode, grok, hermes-agent); every other
// custom agent falls back to the generic "Toolbox" glyph, which is why custom
// agents look identical in the picker.
//
// Users override the default for any provider with
// `bb model-favicons set <provider-id> <mark>`, stored in bb.storage.kv and
// read by the app over RPC. An override always wins over the default.

import type { Mark } from "./marks";
import {
  ClaudeIcon,
  CodexIcon,
  GeminiIcon,
  GenericAgentIcon,
  GlmIcon,
  KimiIcon,
  MinimaxCodeIcon,
  OpenCodeIcon,
  QwenCodeIcon,
} from "./marks";

/** The marks this plugin can draw. */
export const MARKS = {
  /** Z.ai / GLM — the official ACP registry mark. */
  glm: GlmIcon,
  /** Kimi — the official ACP registry mark. */
  kimi: KimiIcon,
  /** MiniMax Code — the official ACP registry mark. */
  "minimax-code": MinimaxCodeIcon,
  /** OpenCode — the official ACP registry mark. */
  opencode: OpenCodeIcon,
  /** Qwen Code — the official ACP registry mark. */
  "qwen-code": QwenCodeIcon,
  /** Claude — the official ACP registry mark. */
  claude: ClaudeIcon,
  /** Codex — the official ACP registry mark. */
  codex: CodexIcon,
  /** Gemini — the official ACP registry mark. */
  gemini: GeminiIcon,
  /** A neutral agent mark, for a custom agent with no vendor logo. */
  agent: GenericAgentIcon,
} as const satisfies Record<string, Mark>;

export type MarkId = keyof typeof MARKS;

export const MARK_IDS = Object.keys(MARKS) as MarkId[];

export function isMarkId(value: string): value is MarkId {
  return Object.prototype.hasOwnProperty.call(MARKS, value);
}

/**
 * Default marks, keyed by the provider id bb knows the agent by.
 *
 * `acp-` is the provider-id prefix the provider-acp plugin gives every agent
 * (`formatCustomAcpProviderId`). An agent registered as `zcode` is therefore
 * the provider `acp-zcode`.
 *
 * bb ships a logo for its 41 registry agents and for cursor, opencode, grok
 * and hermes-agent. Every other agent — the ones a user registers with
 * `bb acp add` or the ACP plugin's `customAgents` setting — falls back to the
 * generic "Toolbox" glyph, which is why custom agents look identical.
 *
 * The defaults below give the common custom agents their real mark. A user
 * override always wins over these.
 */
export const DEFAULT_MARKS: Record<string, MarkId> = {
  "acp-zcode": "glm",
  "acp-kimi-code": "kimi",
  "acp-minimax-code": "minimax-code",
  "acp-opencode": "opencode",
  // Registry agent ids, so a custom agent registered under a registry name
  // still looks like its registry sibling.
  "acp-glm-acp-agent": "glm",
  "acp-kimi": "kimi",
  "acp-qwen-code": "qwen-code",
  "acp-claude-acp": "claude",
  "acp-codex-acp": "codex",
  "acp-gemini": "gemini",
};
