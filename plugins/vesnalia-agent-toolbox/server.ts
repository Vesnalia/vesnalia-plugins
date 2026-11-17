// Exposes VesnALIA SDK surfaces (threads, workspace, terminals) to any provider's agent sessions as agent tools.
// Shared memory is not here on purpose; the built-in Memory plugin already covers it.
import { type AliaPluginApi } from "@vesnalia/plugin-sdk";
import { type Flags, makeRegistrar, type ToolGroup } from "./src/lib/toolkit";
import { registerThreadTools } from "./src/tools/threads";
import { registerWorkspaceTools } from "./src/tools/workspace";
import { registerTerminalTools } from "./src/tools/terminals";
import { registerInfraTools } from "./src/tools/infra";
import { registerBrowserTools } from "./src/tools/browser";

const GROUP_BLURBS: Record<ToolGroup, string> = {
  threads:
    "inspect, message, create, wait for, retry, stop, archive, and read other VesnALIA threads directly to coordinate, delegate, or hand off work",
  workspace: "orient across projects and read/write workspace files",
  terminals: "run and drive VesnALIA terminal sessions the user can watch live",
  machines: "list enrolled machines and a project's workspaces (environments)",
  browser: "open, list, close, and capture tabs in VesnALIA's desktop browser (tabs belong to the current thread)",
};

const GROUP_FLAGS: Record<ToolGroup, keyof Flags> = {
  threads: "enableThreads",
  workspace: "enableWorkspace",
  terminals: "enableTerminals",
  machines: "enableMachines",
  browser: "enableBrowser",
};

export default async function plugin(alia: AliaPluginApi) {
  alia.log.info("loaded");

  // Group toggles control what agents can touch; enableInteractionRespond (default off) gates approvals.
  const settings = alia.settings.define({
    enableThreads: {
      type: "boolean",
      label: "Expose thread coordination tools to agents",
      default: true,
    },
    enableWorkspace: {
      type: "boolean",
      label: "Expose workspace tools to agents",
      default: true,
    },
    enableTerminals: {
      type: "boolean",
      label: "Expose terminal tools to agents",
      default: true,
    },
    enableMachines: {
      type: "boolean",
      label: "Expose machine/environment listing tools to agents",
      default: true,
    },
    enableBrowser: {
      type: "boolean",
      label: "Expose desktop browser tools to agents",
      default: true,
    },
    enableInteractionRespond: {
      type: "boolean",
      label: "Allow agents to respond to other threads' interactions (approvals and questions)",
      default: false,
    },
  });
  const flags: Flags = {
    enableThreads: true,
    enableWorkspace: true,
    enableTerminals: true,
    enableMachines: true,
    enableBrowser: true,
    enableInteractionRespond: false,
  };
  void settings.get().then((values) => Object.assign(flags, values));
  settings.onChange((next) => Object.assign(flags, next));

  // Register tools; the registrar gates on the live flag, catches errors, and truncates output.
  const { register, registry } = makeRegistrar(alia, flags, GROUP_FLAGS);
  registerThreadTools(alia, flags, register);
  registerWorkspaceTools(alia, register);
  registerTerminalTools(alia, register);
  registerInfraTools(alia, register);
  registerBrowserTools(alia, register);

  // Instructions appended to thread sessions; reads live flags, so it follows settings changes.
  alia.agents.contributeInstructions(() => {
    const lines: string[] = ["You have VesnALIA integration tools available:"];
    for (const group of ["threads", "workspace", "terminals", "machines", "browser"] as ToolGroup[]) {
      const names = registry.filter((t) => t.group === group && flags[GROUP_FLAGS[group]]).map((t) => t.name);
      if (names.length === 0) continue;
      lines.push(`- ${names.join(" / ")}: ${GROUP_BLURBS[group]}.`);
    }
    if (flags.enableThreads && !flags.enableInteractionRespond) {
      lines.push(
        "- aliatools_thread_interaction_respond is disabled by the enableInteractionRespond plugin setting; you can list other threads' pending interactions but not answer them.",
      );
    }
    lines.push(
      "After spawning or messaging another thread, prefer aliatools_thread_wait over repeated aliatools_thread_get polling.",
    );
    lines.push(
      "Prefer these over guessing when you need cross-thread state or VesnALIA project context.",
    );
    return lines.join("\n");
  });

  // CLI to inspect the tool groups and their enabled state.
  alia.cli.register({
    name: "alia-agent-toolbox",
    summary: "Inspect the VesnALIA Agent Toolbox plugin's tool groups",
    commands: [
      {
        name: "status",
        summary: "Show the plugin's tool groups and their enabled state",
        usage: "alia alia-agent-toolbox status [--json]",
      },
    ],
    async run(argv) {
      const json = argv.includes("--json");
      const groups: ToolGroup[] = ["threads", "workspace", "terminals", "machines", "browser"];
      const tools = registry.filter((t) => flags[GROUP_FLAGS[t.group]]).map((t) => t.name);
      const enabledGroups = groups.filter((g) => flags[GROUP_FLAGS[g]]);
      const summary = Object.fromEntries(enabledGroups.map((g) => [g, true]));
      const text = [
        ...groups.map((g) => `${g.padEnd(10)} ${flags[GROUP_FLAGS[g]] ? "on" : "off"}`),
        `respond to interactions: ${flags.enableInteractionRespond ? "on" : "off"}`,
        `tools (${tools.length}): ${tools.join(", ")}`,
      ].join("\n");
      return {
        exitCode: 0,
        stdout: json ? JSON.stringify({ ...summary, enableInteractionRespond: flags.enableInteractionRespond, tools }) : text,
        stderr: "",
      };
    },
  });
}
