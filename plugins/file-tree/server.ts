import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import { rpcContract } from "./contract";
import { hostContract, hostSignals } from "./host-contract";
import type { PathProbe } from "./src/reveal";
import { createBlankMarkdown } from "./src/blank-markdown";
import { deleteFile } from "./src/delete-file";
import { invalidateListings, listDir } from "./src/listing";
import { copyFileToClipboard, revealInFinder } from "./src/os-actions";
import { resolveRoot } from "./src/roots";
import {
  makeSearchRootsGetter,
  resolveInRoot,
  resolveFileAnchors,
  resolveInWorkspace,
  resolvePaths,
  searchFiles,
  searchFilesInRoot,
} from "./src/reveal";
import { listRootChoices, workspaceForProject, workspaceForThread } from "./src/workspace";

export { rpcContract } from "./contract";

export default async function plugin(alia: AliaPluginApi): Promise<void> {
  alia.log.info("loaded");
  const host = alia.hosts.experimental_client({ contract: hostContract, experimental_signals: hostSignals });
  const offWatch = host.experimental_onSignal("directoriesChanged", ({ hostId, payload }) => {
    if (resolveRoot(payload.rootId)?.hostId !== hostId) return;
    invalidateListings(payload.rootId);
    alia.realtime.publish("directoriesChanged", payload);
  });
  alia.onDispose(offWatch);
  const probe: PathProbe = (hostId, rootPath, relativePath) =>
    host.call("statPath", { rootPath, relativePath }, { hostId });
  const onThisComputer = async (rootId: string): Promise<boolean> => {
    const root = resolveRoot(rootId);
    if (root === undefined) throw new Error("File tree root expired. Choose the folder again.");
    const config = await alia.sdk.system.config();
    return root.hostId === config.primaryHostId;
  };

  const settings = alia.settings.define({
    openByDefault: {
      type: "boolean",
      label: "Show the pinned file tree when VesnALIA opens",
      default: true,
    },
    showSkipped: {
      type: "boolean",
      label: "Show hidden and ignored folders (.claude, node_modules, .git, …)",
      default: false,
    },
    treeRoot: {
      type: "string",
      label: "Root folder for personal threads",
      description:
        "Absolute path or ~/ path used only for VesnALIA personal threads. Project threads always show their project workspace.",
      default: "",
    },
    searchRoots: {
      type: "string",
      label: "Folders to search for paths mentioned in chat (one per line)",
      description:
        "Each folder and its immediate subfolders can host a revealed path, so an unregistered folder like ~/Documents/Agent-Harness still resolves.",
      default: "~/Documents",
    },
  });

  const getSearchRoots = makeSearchRootsGetter(async () => {
    const values = await settings.get();
    return typeof values.searchRoots === "string" ? values.searchRoots : undefined;
  });

  const getTreeRoot = async (): Promise<string | undefined> => {
    const values = await settings.get();
    const root = typeof values.treeRoot === "string" ? values.treeRoot.trim() : "";
    return root === "" ? undefined : root;
  };

  alia.rpc.register(rpcContract, {
    statPath: async ({ rootId, relativePath }) => {
      const root = resolveRoot(rootId);
      if (!root) throw new Error("File tree root expired. Choose the folder again.");
      return probe(root.hostId, root.rootPath, relativePath);
    },
    syncDirectoryWatch: async (input) => {
      const root = resolveRoot(input.rootId);
      if (!root) throw new Error("File tree root expired. Choose the folder again.");
      return host.call("syncDirectoryWatch", { ...input, rootPath: root.rootPath }, { hostId: root.hostId });
    },
    listRootChoices: async (input) => ({
      choices: await listRootChoices(alia, input, await getTreeRoot()),
    }),
    resolveInRoot: (input) => resolveInRoot(alia, input, getSearchRoots, probe),
    searchFilesInRoot: (input) => searchFilesInRoot(alia, input, getSearchRoots),
    workspaceForThread: async ({ threadId }) =>
      workspaceForThread(alia, threadId, await getTreeRoot()),
    workspaceForProject: async ({ projectId }) =>
      workspaceForProject(alia, projectId, await getTreeRoot()),
    resolveInWorkspace: async (input) => {
      const result = await resolveInWorkspace(alia, input, getSearchRoots, probe);
      alia.log.info(
        `reveal ${JSON.stringify(input.path)} -> ${
          result.ok ? `${result.relativePath} (root ${result.root?.rootName ?? "thread"})` : result.message
        }`,
      );
      return result;
    },
    clientLog: ({ message }) => {
      alia.log.info(`client: ${message}`);
      return { ok: true };
    },
    resolvePaths: async (input) => {
      const result = await resolvePaths(alia, input, getSearchRoots, probe);
      alia.log.info(
        `resolvePaths: ${input.paths.length} candidates -> ${result.known.length} known`,
      );
      return result;
    },
    searchFiles: async (input) => {
      const result = await searchFiles(alia, input, getSearchRoots);
      alia.log.info(
        `searchFiles ${JSON.stringify(input.query)} -> ${result.hits.length} hits`,
      );
      return result;
    },
    resolveFileAnchors: async (input) => {
      const result = await resolveFileAnchors(alia, input, getSearchRoots, probe);
      for (const fix of result.fixes) {
        alia.log.info(`anchor fix ${JSON.stringify(fix.text)}: ${fix.href} -> ${fix.absolutePath}`);
      }
      return result;
    },
    listDir: (input) => listDir(input, ({ hostId, ...request }) =>
      host.call("listDirectory", request, { hostId })),
    revealInFinder: async (input) => {
      if (!await onThisComputer(input.rootId)) return { ok: false, message: "This file is on another computer." };
      return revealInFinder(input);
    },
    copyFileToClipboard: async (input) => {
      if (!await onThisComputer(input.rootId)) return { ok: false, message: "This file is on another computer." };
      return copyFileToClipboard(input);
    },
    createBlankMarkdown: async (input) => {
      const result = await createBlankMarkdown(alia, input);
      if (result.ok) invalidateListings(input.rootId);
      return result;
    },
    deleteFile: async (input) => {
      const result = await deleteFile(alia, input);
      if (result.ok) invalidateListings(input.rootId);
      return result;
    },
  });

  alia.onDispose(() => {
    alia.log.info("disposed");
  });
}
