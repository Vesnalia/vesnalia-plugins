import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import type { ReferenceService } from "../services/reference-service.ts";
import { handleCliCommand } from "./commands.ts";

export function registerCli(alia: AliaPluginApi, service: ReferenceService): void {
  alia.cli.register({
    name: "references",
    summary: "Visual references and moodboards for VesnALIA projects",
    commands: [
      {
        name: "list",
        summary: "List project references",
        usage: "alia references list [--project <id>] [--tag <tag>] [--search <query>] [--json]",
      },
      {
        name: "add",
        summary: "Add a reference image (URL or local file)",
        usage: "alia references add <url_or_path> [--title <title>] [--tags <t1,t2>] [--prompt <prompt>] [--open] [--json]",
      },
      {
        name: "pin",
        summary: "Pin a reference as active aesthetic anchor",
        usage: "alia references pin <id> [--project <id>] [--json]",
      },
      {
        name: "unpin",
        summary: "Unpin a reference from active anchor",
        usage: "alia references unpin <id> [--project <id>] [--json]",
      },
      {
        name: "remove",
        summary: "Remove a reference by ID",
        usage: "alia references remove <id> [--project <id>] [--json]",
      },
      {
        name: "open",
        summary: "Open the references panel in VesnALIA IDE",
        usage: "alia references open [--project <id>] [--id <ref-id>]",
      },
      {
        name: "tags",
        summary: "List unique tags and counts",
        usage: "alia references tags [--project <id>] [--json]",
      },
    ],
    async run(argv) {
      return handleCliCommand(
        argv,
        service,
        (ch, payload) => alia.realtime.publish(ch, payload),
        process.env.ALIA_PROJECT_ID || "default"
      );
    },
  });
}
