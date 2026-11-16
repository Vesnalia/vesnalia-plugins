// The preset catalogue: one file of plain data, so adding or editing a preset
// set is a data edit, never a change to the UI or the RPC surface.
//
// Every shipped value is drawn from the live provider catalogue on this host
// (see `alia provider list` / `alia provider models <id>`). A wrong value is not
// fatal — `experimental_setSelection` reconciles against the provider's real
// catalogue — but an incoherent preset makes a button that lies about what it
// does, so keep these honest.
import { z } from "zod";

/** Reasoning levels the host accepts, union across every registered provider. */
export const REASONING_LEVELS = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
  "ultracode",
] as const;

/** Service tiers the host accepts; ignored by providers that declare none. */
export const SERVICE_TIERS = ["default", "fast"] as const;

/** Permission modes the host accepts. */
export const PERMISSION_MODES = ["accept-edits", "auto", "full"] as const;

/**
 * One preset button. `label` is the button's text — short enough to sit beside
 * the project picker on a phone — and `icon` is a VesnALIA icon name resolved by the
 * host, falling back to the generic `Zap` when unknown.
 *
 * `id` is optional in what a user writes: a hand-written set should not have to
 * invent stable identifiers, so a missing one is derived from the label. It
 * must be unique within a set, because it keys both the React list and the
 * pressed button.
 */
export const presetSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  label: z.string().min(1).max(24),
  icon: z.string().min(1).max(64).default("pb-Zap"),
  providerId: z.string().min(1),
  model: z.string().min(1),
  reasoningLevel: z.enum(REASONING_LEVELS).optional(),
  serviceTier: z.enum(SERVICE_TIERS).optional(),
  permissionMode: z.enum(PERMISSION_MODES).optional(),
});

/**
 * A preset with a resolved `id` and an explicit `icon` — the shape that goes
 * over the wire and keys the rendered buttons. Distinct from `presetSchema`
 * because the wire contract must promise what the parser normalises: an author
 * may omit both, but a client never has to cope with their absence.
 */
export const resolvedPresetSchema = presetSchema.extend({
  id: z.string().min(1).max(64),
  icon: z.string().min(1).max(64),
});

export type Preset = z.output<typeof resolvedPresetSchema>;

/**
 * Parse a set of presets, assigning each a stable `id` derived from its label
 * when the author did not supply one. Duplicates within a set are suffixed, so
 * two buttons labelled the same still key distinctly.
 */
export function parsePresets(value: unknown): Preset[] | null {
  const items = z.array(presetSchema).min(1).max(8).safeParse(value);
  if (!items.success) return null;
  const seen = new Set<string>();
  return items.data.map((preset, index) => {
    const slug = preset.label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    // An author id wins; otherwise the label slugs; otherwise its position.
    const base = preset.id ?? (slug === "" ? `preset-${index + 1}` : slug);
    let id = base;
    let suffix = 2;
    while (seen.has(id)) id = `${base}-${suffix++}`;
    seen.add(id);
    return { ...preset, id };
  });
}

export interface PresetSet {
  id: string;
  /** Shown in the settings dropdown. */
  label: string;
  description: string;
  presets: Preset[];
}

/**
 * The sets the settings dropdown offers. Order matters: the first entry is the
 * default, and the dropdown lists them in this order.
 */
export const BUILT_IN_SETS: readonly PresetSet[] = [
  {
    id: "everyday",
    label: "Everyday — one provider per job",
    description:
      "A cheap cloud draft, a balanced Claude, a deep Claude, and Codex. The default spread across what you actually reach for.",
    presets: [
      {
        id: "fast",
        label: "Fast",
        icon: "pb-Zap",
        providerId: "ollama",
        model: "deepseek-v4.1-flash:cloud",
        reasoningLevel: "low",
      },
      {
        id: "balanced",
        label: "Balanced",
        icon: "pb-Layers",
        providerId: "claude-code",
        model: "claude-sonnet-5",
        reasoningLevel: "medium",
      },
      {
        id: "deep",
        label: "Deep",
        icon: "pb-Brain",
        providerId: "claude-code",
        model: "claude-opus-5-5",
        reasoningLevel: "high",
      },
      {
        id: "code",
        label: "Code",
        icon: "pb-Code",
        providerId: "codex",
        model: "gpt-5.5",
        reasoningLevel: "medium",
      },
    ],
  },
  {
    id: "claude",
    label: "Claude only — one ladder, four rungs",
    description:
      "Haiku, Sonnet, Opus at high, Opus at max. Pick the rung, not the vendor.",
    presets: [
      {
        id: "quick",
        label: "Quick",
        icon: "pb-Zap",
        providerId: "claude-code",
        model: "claude-haiku-4-5-20251001",
        reasoningLevel: "low",
      },
      {
        id: "standard",
        label: "Standard",
        icon: "pb-Layers",
        providerId: "claude-code",
        model: "claude-sonnet-5",
        reasoningLevel: "medium",
      },
      {
        id: "deep",
        label: "Deep",
        icon: "pb-Brain",
        providerId: "claude-code",
        model: "claude-opus-5-5",
        reasoningLevel: "high",
      },
      {
        id: "max",
        label: "Max",
        icon: "pb-AiBrain01",
        providerId: "claude-code",
        model: "claude-opus-5-5",
        reasoningLevel: "max",
      },
    ],
  },
  {
    id: "codex",
    label: "Codex only — the GPT ladder",
    description:
      "GPT-5.5 on the fast tier, then Sol, Terra, and Astra as reasoning climbs.",
    presets: [
      {
        id: "spark",
        label: "Spark",
        icon: "pb-Zap",
        providerId: "codex",
        model: "gpt-5.5",
        reasoningLevel: "low",
        serviceTier: "fast",
      },
      {
        id: "sol",
        label: "Sol",
        icon: "pb-Layers",
        providerId: "codex",
        model: "gpt-5.6-sol",
        reasoningLevel: "medium",
      },
      {
        id: "terra",
        label: "Terra",
        icon: "pb-Target",
        providerId: "codex",
        model: "gpt-5.6-terra",
        reasoningLevel: "high",
      },
      {
        id: "astra",
        label: "Astra",
        icon: "pb-Brain",
        providerId: "codex",
        model: "gpt-6-astra",
        reasoningLevel: "xhigh",
      },
    ],
  },
  {
    id: "local",
    label: "Local — Ollama models",
    description:
      "Off the local Ollama catalogue: a small local model up to Kimi K3, no frontier lab in the loop.",
    presets: [
      {
        id: "nano",
        label: "Nano",
        icon: "pb-Zap",
        providerId: "ollama",
        model: "qwen2.5:3b",
        reasoningLevel: "low",
      },
      {
        id: "flash",
        label: "Flash",
        icon: "pb-Cloud",
        providerId: "ollama",
        model: "deepseek-v4.1-flash:cloud",
        reasoningLevel: "low",
      },
      {
        id: "glm",
        label: "GLM",
        icon: "pb-Beaker",
        providerId: "ollama",
        model: "glm-5.3:cloud",
        reasoningLevel: "medium",
      },
      {
        id: "kimi",
        label: "Kimi",
        icon: "pb-Brain",
        providerId: "ollama",
        model: "kimi-k3:cloud",
        reasoningLevel: "high",
      },
    ],
  },
];

/** The set a stored setting value resolves to, tolerating a stale or bad id. */
export function resolvePresetSet(id: string | undefined): PresetSet {
  const fallback = BUILT_IN_SETS[0]!;
  if (id === undefined) return fallback;
  return BUILT_IN_SETS.find((candidate) => candidate.id === id) ?? fallback;
}
