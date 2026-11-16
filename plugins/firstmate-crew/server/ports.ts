/**
 * The narrow slices of VesnALIA the server needs, so the first mate's lifecycle, the fleet and the crew
 * actions can be tested against plain in-memory fakes (`testing/fakes.ts`). `alia-ports.ts` implements
 * them over `alia.sdk`; nothing else in `server/` touches the SDK's thread or project areas.
 */
import type { ParentNotifications, ThreadStatus } from "../shared/types";

/** What the plugin reads of one VesnALIA thread. Times are epoch milliseconds. */
export interface ThreadInfo {
  id: string;
  title: string | null;
  status: ThreadStatus;
  parentThreadId: string | null;
  /** Which of its outcomes VesnALIA tells its parent about (the thread menu's Notify parent). */
  parentNotifications: ParentNotifications;
  projectId: string;
  environmentId: string | null;
  updatedAt: number;
  archivedAt: number | null;
}

/** What says whether a thread is truly at rest, beyond its status: everything that would wake it. */
export interface RestState {
  status: ThreadStatus;
  /** Whose child it is now, so a caller can check it still belongs where it was found. */
  parentThreadId: string | null;
  /**
   * `status` refined by VesnALIA with the machine's state: "waiting-for-host" or "provisioning" while the
   * thread's machine is not ready. Anything but "idle" is not at rest.
   */
  runtimeStatus: string;
  /** Messages queued for the thread, waiting to be sent. */
  queuedMessages: number;
  /** Permissions, questions and plans waiting on someone. */
  pendingInteractions: number;
  /** Background agents the thread started that are still running, though its turn has ended. */
  backgroundAgents: number;
}

/** Where a thread's event log stands at the end of a turn. `at` is epoch milliseconds. */
export interface TurnEnd {
  seq: number;
  at: number;
}

/** How much of its context window a thread's conversation fills, as VesnALIA last measured it. */
export interface ContextUsage {
  usedTokens: number;
  /** VesnALIA marks the figure as an estimate rather than the provider's own count. */
  estimated: boolean;
  /**
   * When the provider's prompt cache for the conversation expires, in epoch milliseconds, as VesnALIA works it
   * out (VesnALIA 0.47's `compactionOfferAt`). Null when VesnALIA does not say: a provider that reports no cache
   * lifetime, a context under VesnALIA's own 100,000-token floor, or VesnALIA's `compactExpiredCache` experiment off.
   */
  cacheExpiresAt: number | null;
}

/** Where a thread's work is, for telling the first mate which thread a request comes from. */
export interface ThreadOrigin {
  /** Null when VesnALIA no longer has the project. */
  projectName: string | null;
  /** Null when the thread has no environment, or its environment no branch. */
  branchName: string | null;
}

/**
 * How a send meets a running turn. `auto` for the captain's words (joins the turn if the provider
 * can steer, queues otherwise), `steer` for the captain's note to a crewmate, `queue-if-active` for
 * watch output. None of them interrupts.
 */
/**
 * How a message joins the thread's work. `compact-first` is VesnALIA 0.47's `compactFirst`: VesnALIA compacts the
 * idle thread and then delivers the message, queued as `queue-if-active` (`server/compact-first.ts`).
 */
export type SendMode = "auto" | "steer" | "queue-if-active" | "compact-first";

/**
 * VesnALIA answered a `compact-first` send with a refusal, before it queued anything: nothing was compacted for
 * it and nothing was delivered. Any other failure of such a send leaves both unknown.
 */
export class CompactFirstRefused extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CompactFirstRefused";
  }
}

/** Where a spawned thread works: a new worktree of its project, another thread's environment, or a plain directory. */
export type SpawnEnvironment = { kind: "worktree" } | { kind: "reuse"; environmentId: string } | { kind: "path"; path: string };

/**
 * A message the captain sees as one line, `shown`, ending in a chip that opens `file` — a path inside the
 * thread's workspace — while the agent reads `hidden` as well.
 */
export interface ShortenedMessage {
  shown: string;
  file: { path: string; label: string };
  hidden: string;
}

export interface SpawnArgs {
  projectId: string;
  title: string;
  prompt: string;
  parentThreadId?: string;
  /** Which of the child's outcomes VesnALIA tells the parent about; absent leaves VesnALIA's default. */
  parentNotifications?: ParentNotifications;
  environment: SpawnEnvironment;
  /** Empty or absent leaves VesnALIA's default. */
  providerId?: string;
  model?: string;
  reasoningLevel?: string;
  /** The provider's own agent options for the model, by option id (VesnALIA 0.46.1); absent sends none. */
  sessionOptions?: Record<string, string | boolean>;
  /** Seeded into the plugin's own metadata namespace on the thread. */
  metadata: Record<string, string>;
  /** Created already pinned in the sidebar, in the same request (VesnALIA 0.45+). */
  pinned?: boolean;
}

export interface ThreadsPort {
  /** Null when the thread is missing, deleted or archived. */
  get(id: string, signal?: AbortSignal): Promise<ThreadInfo | null>;
  /** The thread's non-archived children. */
  children(parentId: string, signal?: AbortSignal): Promise<ThreadInfo[]>;
  /** The thread's metadata in this plugin's namespace. */
  metadata(id: string): Promise<Record<string, unknown>>;
  /**
   * The metadata of many threads in this plugin's namespace, read in as few requests as VesnALIA allows. A
   * thread with none is left out of the map.
   */
  metadataOf(ids: readonly string[]): Promise<Map<string, Record<string, unknown>>>;
  /** How many interactions (questions, permissions, plans) wait on the thread. */
  pendingInteractions(id: string): Promise<number>;
  /** The thread's latest assistant text, or null when it has none. */
  lastText(id: string): Promise<string | null>;
  /** The directory the environment works in, when it is on the VesnALIA server's machine; null otherwise. */
  workspacePath(environmentId: string): Promise<string | null>;
  /** The thread's project and branch, archived or not; null when VesnALIA has no such thread. */
  origin(id: string): Promise<ThreadOrigin | null>;
  spawn(args: SpawnArgs): Promise<ThreadInfo>;
  send(id: string, text: string, mode: SendMode): Promise<"sent" | "queued">;
  sendShortened(id: string, message: ShortenedMessage, mode: SendMode): Promise<"sent" | "queued">;
  stop(id: string): Promise<void>;
  archive(id: string): Promise<void>;
  clearContext(id: string): Promise<void>;
  /** Asks VesnALIA for the same structured `/compact` turn its composer sends. */
  compact(id: string): Promise<void>;
  /** Null when the thread is missing, deleted or archived. */
  restState(id: string, signal?: AbortSignal): Promise<RestState | null>;
  /** The thread's latest `turn/completed` event, or null when no turn has ended yet. */
  lastTurnEnd(id: string, signal?: AbortSignal): Promise<TurnEnd | null>;
  /** How many turns have started since the event `afterSeq`, counting no further than `limit`. */
  turnsStartedAfter(id: string, afterSeq: number, limit: number, signal?: AbortSignal): Promise<number>;
  /** The thread's context usage, or null when VesnALIA has no figure for it. */
  contextUsage(id: string, signal?: AbortSignal): Promise<ContextUsage | null>;
}

export interface ProjectsPort {
  /** The project with a source at this directory on the VesnALIA server's machine, compared by real path. */
  findByPath(path: string): Promise<{ id: string } | null>;
  /** Registers the directory as a new project on the VesnALIA server's machine. */
  create(name: string, path: string): Promise<{ id: string }>;
  /** Every project's id and name, for resolving what the captain or the first mate typed. */
  list(): Promise<{ id: string; name: string }[]>;
}
