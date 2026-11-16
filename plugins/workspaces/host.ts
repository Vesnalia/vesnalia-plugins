import { homedir } from "node:os";
import { join } from "node:path";
import { experimental_defineHostEntry } from "@vesnalia/plugin-sdk/host";
import { hostContract } from "./src/host-contract";
import {
  addRepository,
  cleanupSession,
  ensureAnchor,
  prepareSession,
  readRepositoryBases,
  readRepositoryStatus,
  readSessionManifest,
  resolveSessionDataRoot,
} from "./src/worktrees";

// VesnALIA refuses thread workspaces inside its plugin data dirs, so session worktrees live outside VesnALIA storage.
const SESSIONS_DATA_ROOT = join(homedir(), ".alia-workspaces");

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    prepare_session: (input) => prepareSession({
      dataRoot: SESSIONS_DATA_ROOT,
      ...input,
    }),
    ensure_anchor: (_input, context) => ensureAnchor(context.experimental_paths.dataDir),
    read_session: (input, context) => readSessionManifest(
      resolveSessionDataRoot(context.experimental_paths.dataDir, SESSIONS_DATA_ROOT, input.sessionId),
      input.sessionId,
    ),
    add_repository: (input, context) => addRepository({
      dataRoot: resolveSessionDataRoot(context.experimental_paths.dataDir, SESSIONS_DATA_ROOT, input.sessionId),
      ...input,
    }),
    cleanup_session: async (input, context) => {
      await cleanupSession({
        dataRoot: resolveSessionDataRoot(context.experimental_paths.dataDir, SESSIONS_DATA_ROOT, input.sessionId),
        ...input,
      });
      return { cleaned: true as const };
    },
    repository_status: ({ worktreePath, baseCommit }) =>
      readRepositoryStatus(worktreePath, baseCommit),
    repository_bases: async (input) => ({ repositories: await readRepositoryBases(input) }),
  },
});
