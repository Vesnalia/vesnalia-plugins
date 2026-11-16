import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import os from "node:os";
import path from "node:path";
import { parsePathList, discoverSkillRoots } from "./src/scanner.ts";
import { syncWorkspaceSkills } from "./src/config-sync.ts";

export default async function plugin(alia: AliaPluginApi) {
  alia.log.info("alia-plugin-workspace-skills loading...");

  const settings = alia.settings.define({
    scanPaths: {
      type: "string" as const,
      label: "Skill Scan Paths",
      description:
        "Newline- or comma-separated filesystem paths (relative to ~ or absolute) to scan for project skills.",
      default: "",
      experimental_multiline: true,
    },
    autoDiscover: {
      type: "boolean" as const,
      label: "Auto-discover category folders",
      description:
        "Automatically scan category subdirectories (e.g. .agents/skills/research) for skill packages.",
      default: true,
    },
  });

  async function runSync(trigger: string) {
    const current = await settings.get();
    const rawPaths = parsePathList(current.scanPaths);
    const homeDir = os.homedir();
    const { roots, invalidPaths } = await discoverSkillRoots(rawPaths, {
      homeDir,
      autoDiscover: current.autoDiscover,
    });

    if (invalidPaths.length > 0) {
      alia.log.warn(`[workspace-skills] Invalid or inaccessible paths skipped: ${invalidPaths.join(", ")}`);
    }

    const configPath = path.join(homeDir, ".vesnalia", "config.json");
    const report = await syncWorkspaceSkills({
      configPath,
      discoveredRoots: roots,
      reloadConfigFn: async () => {
        try {
          await alia.sdk.system.reloadConfig();
        } catch (err) {
          alia.log.error(`[workspace-skills] Failed to trigger system.reloadConfig: ${err}`);
        }
      },
    });

    alia.log.info(
      `[workspace-skills] Sync (${trigger}): found ${roots.length} roots across ${rawPaths.length} paths (changed: ${report.changed})`
    );

    return { ...report, invalidPaths, rawPaths };
  }

  // Initial scan on plugin load
  await runSync("initial-load");

  // Re-scan whenever settings change through UI or CLI
  settings.onChange(async () => {
    alia.log.info("[workspace-skills] Settings modified, rescanning paths...");
    await runSync("settings-change");
  });

  // CLI Command Registration
  alia.cli.register({
    name: "workspace-skills",
    summary: "Manage configurable workspace and external skill roots in VesnALIA",
    commands: [
      {
        name: "status",
        summary: "Show active skill paths, discovered roots, and registration state",
        usage: "alia workspace-skills status",
      },
      {
        name: "sync",
        summary: "Force a rescan of configured paths and reload VesnALIA skills",
        usage: "alia workspace-skills sync",
      },
      {
        name: "add",
        summary: "Add a directory path to the scanPaths setting",
        usage: "alia workspace-skills add <path>",
      },
    ],
    async run(argv) {
      const sub = argv[0] || "status";

      if (sub === "status") {
        const current = await settings.get();
        const rawPaths = parsePathList(current.scanPaths);
        const homeDir = os.homedir();
        const { roots, invalidPaths } = await discoverSkillRoots(rawPaths, {
          homeDir,
          autoDiscover: current.autoDiscover,
        });

        const lines = [
          "=== VesnALIA Workspace Skills ===",
          `Configured Paths (${rawPaths.length}):`,
          ...rawPaths.map((p) => `  • ${p}`),
          "",
          `Auto-discover category folders: ${current.autoDiscover ? "enabled" : "disabled"}`,
          "",
          `Discovered Skill Roots (${roots.length}):`,
          ...roots.map((r) => `  ✓ ~/${r}`),
        ];

        if (invalidPaths.length > 0) {
          lines.push("", `Invalid / Inaccessible Paths (${invalidPaths.length}):`);
          for (const inv of invalidPaths) {
            lines.push(`  ✗ ${inv}`);
          }
        }

        return { exitCode: 0, stdout: lines.join("\n") + "\n" };
      }

      if (sub === "sync") {
        const report = await runSync("cli-sync");
        const msg = `Rescan complete: ${report.rootsCount} skill roots registered in VesnALIA (changed: ${report.changed}).\n`;
        return { exitCode: 0, stdout: msg };
      }

      if (sub === "add") {
        const newPath = argv[1];
        if (!newPath) {
          return { exitCode: 1, stderr: "Usage: VesnALIA workspace-skills add <path>\n" };
        }

        const current = await settings.get();
        const rawPaths = parsePathList(current.scanPaths);
        if (rawPaths.includes(newPath)) {
          return { exitCode: 0, stdout: `Path '${newPath}' is already in scanPaths.\n` };
        }

        rawPaths.push(newPath);
        const nextScanPaths = rawPaths.join("\n");

        if (typeof (settings as any).experimental_set === "function") {
          await (settings as any).experimental_set({ scanPaths: nextScanPaths });
        }
        await runSync("cli-add");
        return { exitCode: 0, stdout: `Added '${newPath}' to scanPaths and refreshed skills.\n` };
      }

      return {
        exitCode: 1,
        stderr: `Unknown subcommand '${sub}'. Available subcommands: status, sync, add.\n`,
      };
    },
  });

  alia.onDispose(() => {
    alia.log.info("alia-plugin-workspace-skills disposed");
  });
}
