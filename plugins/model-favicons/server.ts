// bb-plugin-model-favicons — a BB plugin backend entry.
//
// bb renders one icon per provider (never per model), so this plugin stores a
// provider id -> mark id mapping and the frontend draws the matching inline
// SVG for each provider.
//
// One store in bb.storage.kv serves three surfaces:
//   - the Model Favicons page (app.tsx, over RPC),
//   - the `bb model-favicons` CLI command (below),
//   - the skill in skills/model-favicons/SKILL.md that tells agents how to use
//     that command.
// A write from any surface publishes a realtime signal so every open page
// refetches.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

/** The mark ids the plugin can draw. Kept in sync with lib/provider-marks.ts. */
const MARK_IDS = [
  "glm",
  "kimi",
  "minimax-code",
  "opencode",
  "qwen-code",
  "claude",
  "codex",
  "gemini",
  "agent",
] as const;

/** provider id -> mark id. Values are validated against MARK_IDS on write. */
const overridesSchema = z.record(z.string(), z.enum(MARK_IDS));
export type Overrides = z.infer<typeof overridesSchema>;

export const rpcContract = defineRpcContract({
  icons_list: {
    input: z.null(),
    output: z.object({ overrides: overridesSchema }),
  },
  icons_set: {
    input: z.object({ providerId: z.string().trim().min(1).max(120), mark: z.enum(MARK_IDS) }),
    output: overridesSchema,
  },
  icons_reset: {
    input: z.object({ providerId: z.string().trim().min(1).max(120) }),
    output: overridesSchema,
  },
});

/** Realtime channel app.tsx listens on; the payload is the new override map. */
const ICONS_CHANGED = "icons-changed";

const STORAGE_KEY = "icon-overrides";

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  async function readOverrides(): Promise<Overrides> {
    return (await bb.storage.kv.get<Overrides>(STORAGE_KEY)) ?? {};
  }
  async function writeOverrides(overrides: Overrides): Promise<void> {
    await bb.storage.kv.set(STORAGE_KEY, overrides);
    // Ephemeral broadcast to every connected client; nothing is persisted.
    bb.realtime.publish(ICONS_CHANGED, overrides);
  }

  async function setOverride(providerId: string, mark: (typeof MARK_IDS)[number]): Promise<Overrides> {
    const overrides = await readOverrides();
    const next = { ...overrides, [providerId]: mark };
    await writeOverrides(next);
    return next;
  }
  async function resetOverride(providerId: string): Promise<Overrides> {
    const overrides = await readOverrides();
    if (!(providerId in overrides)) return overrides;
    const next = { ...overrides };
    delete next[providerId];
    await writeOverrides(next);
    return next;
  }

  bb.rpc.register(rpcContract, {
    icons_list: async () => ({ overrides: await readOverrides() }),
    icons_set: async ({ providerId, mark }) => setOverride(providerId, mark),
    icons_reset: async ({ providerId }) => resetOverride(providerId),
  });

  // The `bb model-favicons` command: what agents (and you) use from a shell.
  // Parsing argv is plugin-owned; `commands` is metadata BB renders into help
  // and the generated plugin-commands skill without running plugin code.
  const usage = [
    "Usage:",
    "  bb model-favicons list [--json]",
    "  bb model-favicons set <provider-id> <mark> [--json]",
    "  bb model-favicons reset <provider-id> [--json]",
    "",
    "Marks:",
    ...MARK_IDS.map((mark) => `  ${mark}`),
  ].join("\n");

  bb.cli.register({
    name: "model-favicons",
    summary: "Manage custom provider icons for bb",
    commands: [
      { name: "list", summary: "List the icon overrides", usage: "bb model-favicons list [--json]" },
      {
        name: "set",
        summary: "Set the icon for a provider",
        usage: "bb model-favicons set <provider-id> <mark> [--json]",
      },
      {
        name: "reset",
        summary: "Drop a provider's icon override",
        usage: "bb model-favicons reset <provider-id> [--json]",
      },
    ],
    async run(argv) {
      const json = argv.includes("--json");
      const [command, ...args] = argv.filter((arg) => arg !== "--json");
      const reply = (value: unknown, text: string) => ({
        exitCode: 0,
        stdout: json ? JSON.stringify(value) : text,
      });

      switch (command) {
        case undefined:
        case "help":
        case "--help":
          return { exitCode: 0, stdout: usage };
        case "list": {
          const overrides = await readOverrides();
          const text =
            Object.keys(overrides).length === 0
              ? "No overrides. bb's own logos are in use."
              : Object.entries(overrides)
                  .map(([providerId, mark]) => `${providerId}  ${mark}`)
                  .join("\n");
          return reply(overrides, text);
        }
        case "set": {
          const [providerId, mark] = args;
          if (providerId === undefined || mark === undefined) break;
          if (!(MARK_IDS as readonly string[]).includes(mark)) {
            return {
              exitCode: 1,
              stderr: `Unknown mark "${mark}". Available marks: ${MARK_IDS.join(", ")}.`,
            };
          }
          const overrides = await setOverride(providerId, mark as (typeof MARK_IDS)[number]);
          return reply(overrides, `Set ${providerId} -> ${mark}`);
        }
        case "reset": {
          const [providerId] = args;
          if (providerId === undefined) break;
          const overrides = await resetOverride(providerId);
          return reply(overrides, `Reset ${providerId}`);
        }
      }
      return { exitCode: 1, stderr: usage };
    },
  });

  // Cleanup on reload/disable/shutdown; hooks run LIFO. The sanctioned place
  // to clear timers and close connections.
  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}
