// alia-plugin-skill-manager — backend entry.
//
// One hub directory (default ~/.agents/skills) holds the canonical copy of
// every skill, and `skills-lock.json` beside it records where each came
// from. Coding agents get a symlink or copy in their own skills directory.
//
// This file only wires things together:
//   context.ts   settings and cached state
//   service.ts   the operations, built on ../core
//   rpc.ts       handlers for the Skills page
//   cli/         `alia skill-manager …`
//
// File I/O runs on the machine that hosts the VesnALIA server and targets its
// home directory; enrolled remote machines are out of scope.
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { registerCli } from "./cli";
import { Context, defineSettings } from "./context";
import { registerRpc } from "./rpc";
import { SkillService } from "./service";

export { SKILLS_CHANGED } from "../shared/events";
export { rpcContract } from "./contract";
export type * from "./contract";

export default async function plugin(alia: AliaPluginApi): Promise<void> {
  const settings = defineSettings(alia);
  const context = new Context(alia, settings);
  const service = new SkillService(alia, context);

  registerRpc(alia, service);
  registerCli(alia, service);

  alia.onDispose(() => {
    alia.log.info("disposed");
  });
}
