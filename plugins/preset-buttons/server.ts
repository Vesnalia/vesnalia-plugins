// bb-plugin-preset-buttons — backend entry.
//
// This plugin adds a row of preset buttons beside the project picker on the
// New thread screen. Each button applies one stored provider / model /
// reasoning / service-tier / permission combination to the composer.
//
// The split of responsibility is deliberate:
//
//   * THIS FILE owns configuration. The active preset set is a plugin setting
//     (a dropdown in BB's settings UI, or `bb plugin config`), so swapping
//     which four buttons appear is a config change, never a code change.
//     It also serves the active presets over RPC and a realtime signal.
//
//   * app.tsx owns application. `experimental_setSelection` is only reachable
//     from inside a composer's React context, so the frontend — not the
//     backend — is what actually writes the selection.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  BUILT_IN_SETS,
  parsePresets,
  resolvedPresetSchema,
  resolvePresetSet,
  type Preset,
} from "./lib/presets";

/** The dropdown entry that means "read the JSON in the customPresets setting". */
const CUSTOM_SET_LABEL = "Custom — defined in this plugin's settings";

/** Realtime channel app.tsx listens on; the payload is the active set label. */
const PRESETS_CHANGED = "presets-changed";

/**
 * The wire shape: ids and icons already resolved, so no client has to fill in
 * defaults. `parsePresets` and the built-in sets (which carry explicit ids)
 * are what produce values matching this.
 */
const presetListSchema = z.array(resolvedPresetSchema).min(1).max(8);

/** Descriptors for the dropdown: every built-in set, then the custom escape. */
function presetSetOptions(): string[] {
  const labels = BUILT_IN_SETS.map((set) => set.label);
  // A duplicate would make the dropdown ambiguous; dedupe rather than trust
  // the data file to be right forever.
  return [...new Set(labels), CUSTOM_SET_LABEL];
}

/** Parse the customPresets JSON, or null when it is absent or malformed. */
function parseCustomPresets(raw: string): Preset[] | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  return parsePresets(parsed);
}

export const rpcContract = defineRpcContract({
  /**
   * The presets the button row must render, resolved from current settings.
   * `warning` is set when the configured set could not be honoured, so the UI
   * can say so instead of silently showing something else.
   */
  presets_get: {
    input: z.null(),
    output: z.object({
      setName: z.string(),
      isCustom: z.boolean(),
      presets: presetListSchema,
      warning: z.string().nullable(),
    }),
  },
  /** Switch the active set by its dropdown label. */
  presets_set: {
    input: z.object({ label: z.string().min(1) }),
    output: z.object({
      setName: z.string(),
      isCustom: z.boolean(),
      presets: presetListSchema,
      warning: z.string().nullable(),
    }),
  },
  /** Persist an interactively edited custom set and make it active. */
  presets_save_custom: {
    input: z.object({ presets: presetListSchema }),
    output: z.object({
      setName: z.string(),
      isCustom: z.boolean(),
      presets: presetListSchema,
      warning: z.string().nullable(),
    }),
  },
});

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  const settings = bb.settings.define({
    presetSet: {
      type: "select",
      label: "Preset set",
      description:
        "Which four buttons appear beside the project picker on the New thread screen. Pick a built-in set below, or choose the custom entry to use the JSON set defined in the setting underneath.",
      options: presetSetOptions(),
      default: BUILT_IN_SETS[0]!.label,
    },
    customPresets: {
      type: "string",
      label: "Custom preset set (JSON)",
      description:
        'Used when "Preset set" is the custom entry. A JSON array of 1-8 objects: { "label": "Fast", "icon": "Zap", "providerId": "codex", "model": "gpt-5.5", "reasoningLevel": "low" }. Optional per preset: reasoningLevel, serviceTier, permissionMode, icon.',
      experimental_multiline: true,
      experimental_schema: z.string().refine((value) => {
        if (value.trim() === "") return true;
        try {
          return parsePresets(JSON.parse(value)) !== null;
        } catch {
          return false;
        }
      }, "Must be empty, or a JSON array of 1-8 preset objects."),
      default: "",
    },
  });

  /** Resolve the active presets, reporting rather than hiding a bad config. */
  async function activePresets(): Promise<{
    setName: string;
    isCustom: boolean;
    presets: Preset[];
    warning: string | null;
  }> {
    const { presetSet, customPresets } = await settings.get();
    if (presetSet === CUSTOM_SET_LABEL) {
      const custom = parseCustomPresets(customPresets);
      if (custom !== null) {
        return {
          setName: CUSTOM_SET_LABEL,
          isCustom: true,
          presets: custom,
          warning: null,
        };
      }
      const fallbackSet = BUILT_IN_SETS[0]!;
      const warning =
        customPresets.trim() === ""
          ? `"${CUSTOM_SET_LABEL}" is selected but the custom JSON set is empty. Showing "${fallbackSet.label}" instead.`
          : `"${CUSTOM_SET_LABEL}" is selected but the custom JSON set is invalid. Showing "${fallbackSet.label}" instead.`;
      bb.log.warn(warning);
      return {
        setName: fallbackSet.label,
        isCustom: false,
        presets: fallbackSet.presets,
        warning,
      };
    }
    const set = resolvePresetSet(
      BUILT_IN_SETS.find((candidate) => candidate.label === presetSet)?.id,
    );
    return {
      setName: set.label,
      isCustom: false,
      presets: set.presets,
      warning: null,
    };
  }

  bb.rpc.register(rpcContract, {
    presets_get: async () => {
      // Detect built-in drift the first time anything asks for presets, which
      // is also the first moment `bb.sdk` is safely readable.
      await reportCatalogDrift();
      return activePresets();
    },
    presets_set: async ({ label }) => {
      const next = await settings.experimental_set({ presetSet: label });
      bb.log.info(`preset set switched to ${next.presetSet}`);
      await reportCatalogDrift();
      return activePresets();
    },
    presets_save_custom: async ({ presets }) => {
      // Run through the same parser as hand-written JSON so ids are unique and
      // every stored value has exactly the shape the composer consumes.
      const normalized = parsePresets(presets);
      if (normalized === null) {
        throw new Error("Custom presets must contain between 1 and 8 valid buttons.");
      }
      await settings.experimental_set({
        customPresets: JSON.stringify(normalized, null, 2),
        presetSet: CUSTOM_SET_LABEL,
      });
      bb.log.info(`saved ${normalized.length} custom preset buttons`);
      return activePresets();
    },
  });

  /**
   * Report built-in presets that name a model the live catalogue lacks.
   *
   * A stale built-in still functions — the composer reconciles it and the UI
   * says so — but the first person to learn about it is whoever presses the
   * button. Providers rename models, so a shipped set WILL drift. This turns
   * that into a log line instead of a click-by-click discovery.
   *
   * Lives here rather than in the factory because `bb.sdk` is bind-gated:
   * reading it before the server listens throws, so it runs from the first
   * handler to ask for presets and memoises. Best effort throughout — a
   * provider whose catalogue cannot be read is skipped, never guessed at.
   */
  let driftReported: Promise<void> | null = null;
  function reportCatalogDrift(): Promise<void> {
    driftReported ??= (async () => {
      const providerIds = [
        ...new Set(
          BUILT_IN_SETS.flatMap((set) => set.presets.map((p) => p.providerId)),
        ),
      ];
      const modelsByProvider: Record<string, readonly string[] | undefined> = {};
      await Promise.all(
        providerIds.map(async (providerId) => {
          try {
            const { models } = await bb.sdk.providers.models({ providerId });
            modelsByProvider[providerId] = models.map((model) => model.id);
          } catch {
            // No catalogue right now (offline, signed out); skip this provider.
          }
        }),
      );

      const stale: string[] = [];
      for (const set of BUILT_IN_SETS) {
        for (const preset of set.presets) {
          const available = modelsByProvider[preset.providerId];
          if (available === undefined || available.includes(preset.model)) {
            continue;
          }
          stale.push(
            `${set.id}/${preset.id}: ${preset.providerId} lists no model "${preset.model}"`,
          );
        }
      }
      if (stale.length > 0) {
        bb.log.warn(
          `built-in presets name models the live catalogue does not list:\n  ${stale.join("\n  ")}`,
        );
      }
    })();
    return driftReported;
  }

  // A settings write from anywhere — the settings UI, `bb plugin config`,
  // or this plugin's own CLI — republishes so open composers re-render with
  // the new four buttons without a reload.
  settings.onChange(async () => {
    const { setName } = await activePresets();
    bb.realtime.publish(PRESETS_CHANGED, { setName });
  });

  const usage = [
    "Usage:",
    "  bb preset-buttons list [--json]",
    "  bb preset-buttons sets [--json]",
    "  bb preset-buttons use <set-id|set-label> [--json]",
  ].join("\n");

  bb.cli.register({
    name: "preset-buttons",
    summary: "Inspect and switch the New thread preset buttons",
    commands: [
      {
        name: "list",
        summary: "Show the presets the buttons currently apply",
        usage: "bb preset-buttons list [--json]",
      },
      {
        name: "sets",
        summary: "List every selectable preset set",
        usage: "bb preset-buttons sets [--json]",
      },
      {
        name: "use",
        summary: "Switch the active preset set",
        usage: "bb preset-buttons use <set-id|set-label> [--json]",
      },
    ],
    async run(argv) {
      const json = argv.includes("--json");
      const [command, ...args] = argv.filter((arg) => arg !== "--json");
      const reply = (value: unknown, text: string) => ({
        exitCode: 0,
        stdout: json ? JSON.stringify(value) : text,
      });
      const describePreset = (preset: Preset) =>
        `  ${preset.label.padEnd(10)} ${preset.providerId} · ${preset.model}` +
        (preset.reasoningLevel ? ` · ${preset.reasoningLevel}` : "") +
        (preset.serviceTier ? ` · ${preset.serviceTier}` : "") +
        (preset.permissionMode ? ` · ${preset.permissionMode}` : "");

      switch (command) {
        case undefined:
        case "help":
        case "--help":
          return { exitCode: 0, stdout: usage };
        case "list": {
          const active = await activePresets();
          const lines = [`${active.setName} (${active.presets.length} buttons)`];
          if (active.warning !== null) lines.push(`Warning: ${active.warning}`);
          lines.push(...active.presets.map(describePreset));
          return reply(active, lines.join("\n"));
        }
        case "sets": {
          const sets = [
            ...BUILT_IN_SETS.map((set) => ({
              id: set.id,
              label: set.label,
              presets: set.presets.length,
            })),
            { id: "custom", label: CUSTOM_SET_LABEL, presets: -1 },
          ];
          return reply(
            sets,
            sets
              .map(
                (set) =>
                  `  ${set.id.padEnd(10)} ${set.label}` +
                  (set.presets < 0 ? "" : ` (${set.presets} buttons)`),
              )
              .join("\n"),
          );
        }
        case "use": {
          const wanted = args.join(" ").trim();
          if (wanted === "") break;
          const match = BUILT_IN_SETS.find(
            (set) => set.id === wanted || set.label === wanted,
          );
          const targetLabel =
            wanted === "custom" ? CUSTOM_SET_LABEL : match?.label;
          if (targetLabel === undefined) break;
          const next = await settings.experimental_set({
            presetSet: targetLabel,
          });
          const active = await activePresets();
          return reply(
            { presetSet: next.presetSet, ...active },
            `Preset set: ${active.setName}` +
              (active.warning === null ? "" : `\nWarning: ${active.warning}`),
          );
        }
      }
      return { exitCode: 1, stderr: usage };
    },
  });

  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}
