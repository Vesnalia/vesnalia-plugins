// GitHub Board — the server entry.
//
// Runs `gh` on the VesnALIA server's machine, with the user's own `gh` login, and
// matches cards to VesnALIA projects. What each handler does lives in
// server/service.ts; this file wires it to VesnALIA: settings, storage, realtime,
// projects and thread creation. See AGENTS.md.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { AliaPluginApi, ExperimentalPluginRpcHandlerContext } from "@vesnalia/plugin-sdk";

import type { PromptSettings } from "./shared/board";
import { rpcContract } from "./shared/contract";
import {
  DISPLAY_PREFS_CHANGED,
  ITEM_PATCHED,
  PROMPTS_CHANGED,
  type DisplayPrefs,
  type ItemPatch,
  launchSeedsFor,
  type LaunchDefaults,
} from "./shared/schemas";
import { workspaceTitle } from "./shared/launch";
import { remoteIdsOf } from "./shared/remotes";
import { DEFAULT_PROMPTS, normalizePrompts } from "./shared/settings";
import { describeGhFailure, ghGraphql, ghRunner, ghToken, isGhMissing } from "./server/gh";
import type { GitHubApi } from "./server/github";
import { buildProjectIndex, type ProjectIndex, type ProjectRecord } from "./server/projects";
import { CACHE_TTL_MS, createBoardService } from "./server/service";

export type { RpcContract } from "./shared/contract";

const execFileAsync = promisify(execFile);

const GH_HINT =
  "Install the GitHub CLI (`brew install gh`) and run `gh auth login` on the machine running VesnALIA. The board finds it on its next refresh; `alia plugin reload github-board` clears this notice.";

const DISPLAY_KEY = "display";
const PROMPTS_KEY = "prompts";
const LAUNCH_KEY = "launch";

const DEFAULT_DISPLAY: DisplayPrefs = { hiddenRepositories: [], detailWidthFraction: null };

type SpawnArgs = Parameters<AliaPluginApi["sdk"]["threads"]["spawn"]>[0];

/**
 * The RPC caller's signal. Typed as always there, but VesnALIA before 0.48.1 passes
 * a context without it.
 */
function callerSignal(ctx: ExperimentalPluginRpcHandlerContext | undefined): AbortSignal | undefined {
  return ctx?.experimental_signal;
}

/** Every remote of the checkout at `path`; nothing for a directory that is not one, or is gone. */
async function localRemotes(path: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", path, "remote", "-v"], { timeout: 10_000 });
    return remoteIdsOf(stdout);
  } catch {
    return [];
  }
}

export default async function plugin(alia: AliaPluginApi) {
  const settings = alia.settings.define({
    login: {
      type: "string",
      label: "GitHub login",
      description:
        "Whose work the board shows. Leave blank for the account the GitHub CLI is signed in as.",
      default: "",
    },
  });

  // `gh` is found through VesnALIA's host toolchain on every call, so one installed
  // after the plugin loaded works without a reload. A check at load marks the
  // plugin as needing configuration when `gh` is missing or signed out, rather
  // than failing the load; that mark lasts until the next load, and every call
  // meanwhile reports its own failure. Nothing is latched: a check run before
  // the network was up must not keep the board failing until a reload.
  const gh = ghRunner();
  try {
    await gh(["auth", "status", "--hostname", "github.com"]);
  } catch (error) {
    const message = describeGhFailure(error);
    if (isGhMissing(error)) {
      alia.status.needsConfiguration(`GitHub CLI (gh) was not found. ${GH_HINT}`);
    } else if (/not authenticated|not logged in|gh auth login/i.test(message)) {
      alia.status.needsConfiguration(`GitHub CLI is not signed in. ${GH_HINT}`);
    } else {
      // Probably transient (the network); every call reports its own failure.
      alia.log.warn(`gh auth status failed: ${message}`);
    }
  }

  const api: GitHubApi = {
    graphql: (query, variables, signal) => ghGraphql(gh, query, variables, signal),
    warn: (message) => alia.log.warn(message),
  };

  let cachedIndex: { index: ProjectIndex; storedAt: number } | null = null;
  async function projectIndex(force: boolean): Promise<ProjectIndex> {
    if (!force && cachedIndex !== null && Date.now() - cachedIndex.storedAt < CACHE_TTL_MS) {
      return cachedIndex.index;
    }
    const projects: readonly ProjectRecord[] = await alia.sdk.projects.list();
    const index = await buildProjectIndex(projects, await localHostId(), localRemotes);
    cachedIndex = { index, storedAt: Date.now() };
    return index;
  }

  async function localHostId(): Promise<string | null> {
    return (await alia.sdk.system.config()).primaryHostId;
  }

  const service = createBoardService({
    api,
    token: (signal) => ghToken(gh, signal),
    configuredLogin: async () => (await settings.get()).login,
    projectIndex,
    localHostId,
    now: () => Date.now(),
  });

  function publishPatch(patch: ItemPatch): void {
    alia.realtime.publish(ITEM_PATCHED, patch);
  }

  let displayWrites: Promise<unknown> = Promise.resolve();

  async function displayPrefs(): Promise<DisplayPrefs> {
    return { ...DEFAULT_DISPLAY, ...((await alia.storage.kv.get<DisplayPrefs>(DISPLAY_KEY)) ?? {}) };
  }

  async function prompts(): Promise<PromptSettings> {
    const stored = await alia.storage.kv.get<PromptSettings>(PROMPTS_KEY);
    return stored === undefined
      ? { byType: { ...DEFAULT_PROMPTS }, byProject: {} }
      : normalizePrompts({ byType: { ...DEFAULT_PROMPTS, ...stored.byType }, byProject: stored.byProject ?? {} });
  }

  alia.rpc.register(rpcContract, {
    // VesnALIA 0.48.1 aborts `experimental_signal` when the caller stops waiting or
    // this copy of the plugin goes; older VesnALIA passes none, and the load runs on.
    loadBoard: (input, ctx) => service.loadBoard(input, callerSignal(ctx)),
    loadItem: (input, ctx) => service.loadItem(input, callerSignal(ctx)),
    loadComments: (input, ctx) => service.loadComments(input, callerSignal(ctx)),
    loadImage: (input, ctx) => service.loadImage(input, callerSignal(ctx)),
    listLabels: (input) => service.listLabels(input),
    toggleLabel: async (input) => {
      const result = await service.toggleLabel(input);
      publishPatch({ itemId: input.itemId, patch: { labels: result.labels } });
      return result;
    },
    updateBranch: async (input) => {
      const result = await service.updateBranch(input);
      publishPatch({ itemId: input.id, patch: { branch: result.branch } });
      return result;
    },
    getDisplayPrefs: () => displayPrefs(),
    setDisplayPrefs: (patch) => {
      // One write at a time: two read-modify-writes in flight together, a
      // filter toggle and a width commit say, would drop one of them.
      const write = displayWrites.then(async () => {
        const next = { ...(await displayPrefs()), ...patch };
        await alia.storage.kv.set(DISPLAY_KEY, next);
        alia.realtime.publish(DISPLAY_PREFS_CHANGED, next);
        return next;
      });
      displayWrites = write.catch(() => undefined);
      return write;
    },
    getPrompts: () => prompts(),
    savePrompts: async (value) => {
      const next = normalizePrompts(value);
      await alia.storage.kv.set(PROMPTS_KEY, next);
      alia.realtime.publish(PROMPTS_CHANGED, next);
      return next;
    },
    sendOptions: async ({ repository, url }) => {
      const [{ project, candidates }, launch] = await Promise.all([
        service.projectsForCard({ repository, url }),
        alia.storage.kv.get<LaunchDefaults>(LAUNCH_KEY),
      ]);
      const choice = (ref: { id: string; name: string }) => ({ id: ref.id, name: ref.name });
      return {
        project: project === null ? null : choice(project),
        candidates: candidates.map(choice),
        launch: launch === undefined ? null : launchSeedsFor(launch, project?.id ?? null),
      };
    },
    send: async ({ card, request }) => {
      // The composer's request goes to VesnALIA as it built it; VesnALIA validates it.
      // The card rides along as this plugin's metadata on the thread, since
      // no plugin API can add a row of its own to a thread's timeline.
      const thread = await alia.sdk.threads.spawn({
        ...(request as unknown as SpawnArgs),
        title: workspaceTitle(card.repository, card.number, card.title),
        pluginMetadata: { card },
      });
      // Saved only once the thread exists, so a selection VesnALIA refused is not
      // what the next card opens on.
      const launch: LaunchDefaults = {
        projectId: request.projectId,
        providerId: request.providerId,
        model: request.model,
        reasoningLevel: request.reasoningLevel,
        permissionMode: request.permissionMode,
        ...(request.serviceTier === undefined ? {} : { serviceTier: request.serviceTier }),
        environment: request.environment,
      };
      await alia.storage.kv.set(LAUNCH_KEY, launch);
      alia.log.info(`started thread ${thread.id} on ${card.repository}#${card.number}`);
      return { threadId: thread.id };
    },
  });
}
