// `alia skill-manager` registration: maps command names to handlers and
// declares the help metadata VesnALIA renders into the plugin-commands skill.
import type { AliaPluginApi, PluginCliCommandInfo } from "@vesnalia/plugin-sdk";
import { errorMessage } from "../../core";
import type { SkillService } from "../service";
import { parseArgs } from "./args";
import * as deploy from "./commands/deploy";
import * as inspect from "./commands/inspect";
import * as organize from "./commands/organize";
import * as provenance from "./commands/provenance";
import * as registry from "./commands/registry";
import type { CommandHandler } from "./commands/types";
import { USAGE, fail } from "./render";

const HANDLERS: Record<string, CommandHandler> = {
  status: inspect.status,
  agents: inspect.agents,
  show: inspect.show,
  diff: inspect.diff,
  doctor: inspect.doctor,
  files: inspect.files,
  cat: inspect.cat,
  tag: organize.tag,
  untag: organize.untag,
  tags: organize.tags,
  sync: deploy.sync,
  remove: deploy.remove,
  adopt: deploy.adopt,
  install: provenance.install,
  "list-source": provenance.listSourceCommand,
  source: provenance.source,
  "resolve-sources": provenance.resolveSources,
  check: provenance.check,
  update: provenance.update,
  search: registry.search,
  preview: registry.preview,
};

const COMMANDS: PluginCliCommandInfo[] = [
  { name: "status", summary: "Skill × agent matrix with sources", usage: "alia skill-manager status [--json]" },
  { name: "agents", summary: "List agent targets", usage: "alia skill-manager agents [--json]" },
  { name: "show", summary: "Inspect one skill", usage: "alia skill-manager show <skill> [--json]" },
  { name: "diff", summary: "Compare an agent copy with the hub", usage: "alia skill-manager diff <skill> <agent>" },
  { name: "sync", summary: "Install hub skills into agents (link by default)", usage: "alia skill-manager sync <skill>|--all [--to a,b] [--copy|--link] [--force]" },
  { name: "remove", summary: "Remove a skill from agents", usage: "alia skill-manager remove <skill> --from <a,b> [--force]" },
  { name: "adopt", summary: "Copy an agent's skill into the hub", usage: "alia skill-manager adopt <skill> --from <agent> [--force] [--link]" },
  { name: "install", summary: "Install a skill from GitHub, a Git URL, or a folder into the hub", usage: "alia skill-manager install <source> [--to a,b|--all-agents] [--force]" },
  { name: "list-source", summary: "List the skills a source offers", usage: "alia skill-manager list-source <source>" },
  { name: "source", summary: "Record where an existing hub skill came from", usage: "alia skill-manager source <skill> <source>" },
  { name: "resolve-sources", summary: "Find sources for untracked hub skills on skills.sh and record confident matches", usage: "alia skill-manager resolve-sources [--force]" },
  { name: "check", summary: "Compare tracked skills with upstream", usage: "alia skill-manager check [skill...] [--json]" },
  { name: "update", summary: "Fetch newer versions into the hub", usage: "alia skill-manager update [skill...] [--force]" },
  { name: "search", summary: "Search the skills.sh registry", usage: "alia skill-manager search [query] [--page n] [--json]" },
  { name: "preview", summary: "Print a registry skill's SKILL.md", usage: "alia skill-manager preview <registry-id>" },
  { name: "cat", summary: "Print a skill's SKILL.md or another file", usage: "alia skill-manager cat <skill> [file] [--from agent]" },
  { name: "files", summary: "List a skill's files", usage: "alia skill-manager files <skill> [--from agent]" },
  { name: "tag", summary: "Add tags to a skill", usage: "alia skill-manager tag <skill> <tag...>" },
  { name: "untag", summary: "Remove tags from a skill", usage: "alia skill-manager untag <skill> <tag...>" },
  { name: "tags", summary: "List tags, or the skills with one tag", usage: "alia skill-manager tags [tag]" },
  { name: "doctor", summary: "List problems with fixes", usage: "alia skill-manager doctor [--json]" },
];

export function registerCli(alia: AliaPluginApi, service: SkillService): void {
  alia.cli.register({
    name: "skill-manager",
    summary: "Manage agent skills across Claude Code, Codex, Pi, OpenCode, Gemini and more",
    commands: COMMANDS,
    async run(argv) {
      const args = parseArgs(argv);
      if (args.command === undefined || args.command === "help" || args.command === "--help") {
        return { exitCode: 0, stdout: USAGE };
      }
      const handler = HANDLERS[args.command];
      if (handler === undefined) return fail(`Unknown command "${args.command}".\n\n${USAGE}`);
      try {
        return await handler({
          service,
          args,
          json: args.flags.has("--json"),
          force: args.flags.has("--force"),
        });
      } catch (cause) {
        return fail(errorMessage(cause));
      }
    },
  });
}
