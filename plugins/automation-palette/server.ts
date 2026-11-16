// alia-plugin-automation-palette — backend entry.
//
// Two RPC methods over the `VesnALIA` CLI: what automations exist, and run one. The
// palette rows themselves are a frontend concern (app.tsx), because VesnALIA collects
// them from the app bundle; this side only answers questions and starts runs.
//
// Automations live in VesnALIA's own automations plugin and the SDK exposes no API
// for them, so the CLI is the seam. palette/cli.ts owns the spawn and
// palette/automations.ts owns the parsing, which leaves this file as the wire
// contract.
import { existsSync } from "node:fs";
import { defineRpcContract, type AliaPluginApi } from "@vesnalia/plugin-sdk";
import { z } from "zod";
import { parseAutomations, parseProjects, type AutomationSummary } from "./palette/automations";
import { AliaUnavailableError, createAliaRunner, resolveAliaPath, type AliaRunner } from "./palette/cli";

const automationSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  projectName: z.string(),
  enabled: z.boolean(),
});

/** `auto_...` and `proj_...`; bounded so a hostile client cannot send an essay. */
const idSchema = z.string().trim().min(1).max(200);

export const rpcContract = defineRpcContract({
  automations_list: {
    input: z.null(),
    output: z.object({
      automations: z.array(automationSchema),
      /**
       * Why the list is empty or short, when that is not the answer. The
       * content script logs it: an empty palette with nothing in the console
       * is the failure that wastes an afternoon.
       */
      error: z.string().nullable(),
    }),
  },
  automations_run: {
    input: z.object({ automationId: idSchema, projectId: idSchema }).strict(),
    output: z.object({
      started: z.boolean(),
      /** The CLI's own words, trimmed — shown in the console, not the UI. */
      message: z.string(),
    }),
  },
});

/**
 * Every project's automations, in one list, each carrying its project's name.
 *
 * Every project, not the current one: a palette row is registered once for the
 * whole app and listed everywhere, so the frontend needs the full set up front
 * and never has to learn which project it is in. The project name comes from
 * `alia project list`, since `alia automation list` reports only the id, and the
 * row's title is where it is needed. `--include-personal` because that command
 * leaves out the Personal project otherwise, and automations live there too.
 */
export async function fetchAutomations(alia: AliaRunner): Promise<AutomationSummary[]> {
  const projects = parseProjects(await alia.run(["project", "list", "--include-personal", "--json"]));
  const automations: AutomationSummary[] = [];
  for (const project of projects) {
    const stdout = await alia.run(["automation", "list", "--project", project.id, "--json"]);
    for (const automation of parseAutomations(stdout)) {
      automations.push({ ...automation, projectName: project.name });
    }
  }
  return automations;
}

/**
 * Test seam. The real host calls the factory with the plugin API alone; a test
 * passes a runner instead of letting the plugin spawn the CLI it found.
 */
export interface PluginDeps {
  runner?: AliaRunner;
}

export default async function plugin(alia: AliaPluginApi, deps: PluginDeps = {}) {
  alia.log.info("loaded");

  const settings = alia.settings.define({
    aliaPath: {
      type: "string",
      label: "Path to the VesnALIA CLI",
      description:
        "Left empty, the plugin uses the path VesnALIA injects, then PATH, then the usual install locations.",
      default: "",
    },
  });
  const { aliaPath: configured } = await settings.get();

  const aliaPath = resolveAliaPath({
    configured: typeof configured === "string" ? configured : undefined,
    envPath: process.env.ALIA_CLI,
    exists: existsSync,
  });
  const runner = deps.runner ?? createAliaRunner(aliaPath);
  if (deps.runner === undefined) alia.log.info(`using VesnALIA CLI at ${aliaPath}`);

  /**
   * A CLI failure is reported, never latched.
   *
   * `alia.status.needsConfiguration` is one-way — the SDK offers no runtime way
   * back — and this plugin's whole surface is a set of palette rows. Losing
   * them over one timed-out `VesnALIA` call would be worse than an error in the
   * console.
   */
  function describe(error: unknown): string {
    if (error instanceof AliaUnavailableError) return error.message;
    return error instanceof Error ? error.message : String(error);
  }

  alia.rpc.register(rpcContract, {
    automations_list: async () => {
      try {
        return { automations: await fetchAutomations(runner), error: null };
      } catch (error) {
        const message = describe(error);
        alia.log.warn(`listing automations failed: ${message}`);
        return { automations: [], error: message };
      }
    },
    automations_run: async ({ automationId, projectId }) => {
      try {
        const stdout = await runner.run([
          "automation",
          "run",
          automationId,
          "--project",
          projectId,
        ]);
        alia.log.info(`ran automation ${automationId}`);
        return { started: true, message: stdout.trim() };
      } catch (error) {
        const message = describe(error);
        alia.log.warn(`running automation ${automationId} failed: ${message}`);
        return { started: false, message };
      }
    },
  });

  alia.onDispose(() => {
    alia.log.info("disposed");
  });
}
