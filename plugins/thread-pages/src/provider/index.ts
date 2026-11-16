// createAliaProvider(VesnALIA, deps): ProviderHost over the VesnALIA SDK (DESIGN §B), plus what the composition root needs
// beside the contract: the role registry the CLI dispatches into and the per-session memo eviction.
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import type { ProviderHost } from "../../core/src/host/index.ts";
import { createAttachmentStore, createAliaAttachments } from "./attachments.ts";
import { createAliaCommand, type CommandHandler } from "./command.ts";
import { createAliaContributors } from "./contributors.ts";
import { createAliaFiles } from "./files.ts";
import { createAliaInstruction } from "./instruction.ts";
import { createAliaKv } from "./kv.ts";
import { createAliaProviders } from "./providers.ts";
import { createAliaSessions, createStorageLocator } from "./sessions.ts";
import { createAliaVoice } from "./voice.ts";
import { createAliaWorkspaces } from "./workspaces.ts";

export interface AliaProviderDeps {
  instructionEnabled(): boolean;
  now?: () => number;
}

export interface AliaProvider {
  provider: ProviderHost;
  handlers: ReadonlyMap<string, CommandHandler>;
  /** `thread.deleted`: drop what this adapter memoised for the session. */
  forget(session: string): void;
}

export function createAliaProvider(alia: AliaPluginApi, deps: AliaProviderDeps): AliaProvider {
  const locator = createStorageLocator(alia);
  const attachments = createAttachmentStore(deps.now ? { now: deps.now } : {});
  const command = createAliaCommand();
  const instruction = createAliaInstruction(alia, { enabled: deps.instructionEnabled, log: alia.log });
  const provider: ProviderHost = {
    sessions: createAliaSessions(alia, { locator, attachments }),
    workspaces: createAliaWorkspaces(alia),
    kv: createAliaKv(alia),
    files: createAliaFiles(alia, locator.locate, deps.now),
    instruction: instruction.instruction,
    command: command.command,
    log: alia.log,
    providers: createAliaProviders(alia),
    contributors: createAliaContributors(alia, { log: alia.log }),
    voice: createAliaVoice(alia),
    attachments: createAliaAttachments(alia, attachments),
  };
  return { provider, handlers: command.handlers, forget: (session) => locator.evict(session) };
}
