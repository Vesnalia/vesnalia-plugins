// alia-plugin-jira-dc — the backend.
//
// Jira Data Center issues in VesnALIA: search, read, create, edit, transition, comment,
// assign, and delete — from the panel and from agents.
//
// Writes are split by who is acting:
//   - In the panel, the user's own click is the intent. Only delete confirms.
//   - An agent's write goes through `authorizeAgentWrite`, which honors the
//     per-action policy in settings ("Ask every time" / "Always allow"). Asking
//     blocks on `alia.ui.requestInput`; the approval card can also flip that
//     action to "Always allow" for next time.
// Every agent write tool must call `authorizeAgentWrite` before touching Jira.
//
// Project links: a VesnALIA project can be linked to Jira projects. In that
// project's threads, jira_dc_search_issues, @-mentions, and the side panel only
// show the linked projects' issues; jira_dc_search_all_issues searches everything.
import {
  PluginCliError,
  cliCommand,
  defineCli,
  defineRpcContract,
  type AliaPluginApi,
} from "@vesnalia/plugin-sdk";
import { z } from "zod";
import {
  ACTION_LABELS,
  JiraClient,
  PERMISSION_ALWAYS,
  PERMISSION_ASK,
  PERMISSION_OPTIONS,
  WRITE_ACTIONS,
  buildViewJql,
  describeUser,
  encodeCreateFieldValue,
  isIssueKey,
  isProjectKey,
  needsConfiguration,
  normalizeIssueKey,
  normalizeSiteUrl,
  requiresApproval,
  scopeJql,
  type JiraComment,
  type JiraIssue,
  type JiraIssueSummary,
  type JiraUser,
  type WriteAction,
} from "./jira.js";

const APPROVAL_RENDERER_ID = "jira-approve-write";
const ISSUE_CHANGED = "issue-changed";
const SETTINGS_CHANGED = "settings-changed";
const LINKS_CHANGED = "links-changed";
/** kv: Record<aliaProjectId, jiraProjectKey[]> */
const LINKS_KEY = "project-links";
const AGENT_SEARCH_MAX = 50;

const CONFIG_HINT =
  "Set your Jira Data Center base URL and a Personal Access Token (Profile → Personal Access Tokens) in the Jira Data Center plugin settings.";

export type {
  JiraComment,
  JiraCreateField,
  JiraIssue,
  JiraIssueSummary,
  JiraIssueType,
  JiraProject,
  JiraStatusOption,
  JiraTransition,
  JiraUser,
  StatusCategory,
  WriteAction,
} from "./jira.js";

// ---------------------------------------------------------------------------
// rpc contract. Outputs are passed through as-is: they are built by the
// normalizers in jira.ts, which already fix their shape.
// ---------------------------------------------------------------------------

const issueKeyInput = z
  .string()
  .transform(normalizeIssueKey)
  .refine(isIssueKey, "Expected an issue key such as PROJ-123");

const projectKeyInput = z
  .string()
  .transform((value) => value.trim().toUpperCase())
  .refine(isProjectKey, "Expected a project key such as PROJ");

const anyOutput = <T>() => z.custom<T>(() => true);

const permissionsSchema = z.record(z.string(), z.enum(["ask", "always"]));

export interface JiraStatus {
  configured: boolean;
  ready: boolean;
  siteUrl: string;
  user: JiraUser | null;
  error: string | null;
  permissions: Record<WriteAction, "ask" | "always">;
}

export interface JiraIssueDetail {
  issue: JiraIssue;
  comments: JiraComment[];
  commentTotal: number;
  transitions: import("./jira.js").JiraTransition[];
  threads: ThreadLink[];
}

export interface ProjectLinkRow {
  aliaProjectId: string;
  name: string;
  jiraProjectKeys: string[];
}

/** A machine (VesnALIA daemon) holding a checkout of one VesnALIA project. */
export interface AgentHost {
  hostId: string;
  name: string;
  /** The daemon is online now. A disconnected one cannot start the thread. */
  connected: boolean;
  /** The project's default checkout, which the thread uses when none is picked. */
  isDefault: boolean;
}

/** One VesnALIA project the thread can start in, with the machines that have it. */
export interface AgentProject {
  aliaProjectId: string;
  name: string;
  /** Machines with a checkout of this project; a picker only for two or more. */
  hosts: AgentHost[];
}

/** Where "Send to agent" can start a thread for one issue. */
export interface AgentTargets {
  jiraProjectKey: string;
  /** VesnALIA projects linked to the issue's Jira project, by name. */
  linked: AgentProject[];
  /** Every VesnALIA project, by name, for when none (or another) is wanted. */
  all: AgentProject[];
}

export interface ThreadLink {
  threadId: string;
  createdAt: string;
}

export const jiraRpcContract = defineRpcContract({
  status: { input: z.null(), output: anyOutput<JiraStatus>() },
  search: {
    input: z
      .object({
        view: z.enum(["assigned", "reported", "recent", "all"]),
        projectKey: z.string().default(""),
        /**
         * Restrict to these Jira projects (a linked VesnALIA project's scope). Applies
         * to both the view query and custom JQL; `projectKey` narrows further.
         */
        scopeKeys: z.array(projectKeyInput).max(50).default([]),
        text: z.string().max(500).default(""),
        includeDone: z.boolean().default(false),
        assignees: z.array(z.string().min(1).max(128)).max(50).default([]),
        unassigned: z.boolean().default(false),
        /** When set, replaces the view-built query entirely. */
        jql: z.string().max(4000).default(""),
        nextPageToken: z.string().optional(),
      })
      .strict(),
    output: anyOutput<{
      issues: JiraIssueSummary[];
      nextPageToken: string | null;
      jql: string;
    }>(),
  },
  getIssue: {
    input: z.object({ key: issueKeyInput }).strict(),
    output: anyOutput<JiraIssueDetail>(),
  },
  listProjects: {
    input: z.null(),
    output: anyOutput<import("./jira.js").JiraProject[]>(),
  },
  createOptions: {
    input: z.object({ projectKey: projectKeyInput }).strict(),
    output: anyOutput<{
      issueTypes: import("./jira.js").JiraIssueType[];
      priorities: string[];
    }>(),
  },
  createFields: {
    input: z.object({ projectKey: projectKeyInput, issueTypeId: z.string().min(1) }).strict(),
    output: anyOutput<{ fields: import("./jira.js").JiraCreateField[] }>(),
  },
  listProjectLinks: {
    input: z.null(),
    output: anyOutput<ProjectLinkRow[]>(),
  },
  /** The Jira projects one VesnALIA project is linked to; [] when unlinked. */
  projectLink: {
    input: z.object({ aliaProjectId: z.string().min(1) }).strict(),
    output: z.object({ jiraProjectKeys: z.array(z.string()) }),
  },
  setProjectLink: {
    input: z
      .object({ aliaProjectId: z.string().min(1), jiraProjectKeys: z.array(projectKeyInput).max(50) })
      .strict(),
    output: z.object({ ok: z.literal(true) }),
  },
  projectStatuses: {
    input: z.object({ projectKey: projectKeyInput }).strict(),
    output: anyOutput<import("./jira.js").JiraStatusOption[]>(),
  },
  findUsers: {
    input: z
      .object({
        issueKey: z.string().default(""),
        projectKey: z.string().default(""),
        query: z.string().max(200).default(""),
      })
      .strict(),
    output: anyOutput<JiraUser[]>(),
  },
  createIssue: {
    input: z
      .object({
        projectKey: projectKeyInput,
        issueType: z.string().min(1),
        summary: z.string().trim().min(1).max(255),
        description: z.string().max(32_000).default(""),
        priority: z.string().default(""),
        assigneeAccountId: z.string().default(""),
        /** Raw createmeta values (string or list of ids/labels); encoded server-side. */
        fields: z.record(z.string(), z.union([z.string(), z.array(z.string())])).default({}),
      })
      .strict(),
    output: z.object({ key: z.string() }),
  },
  updateIssue: {
    input: z
      .object({
        key: issueKeyInput,
        summary: z.string().trim().min(1).max(255).optional(),
        description: z.string().max(32_000).optional(),
        priority: z.string().min(1).optional(),
        labels: z.array(z.string().min(1)).optional(),
      })
      .strict(),
    output: z.object({ ok: z.literal(true) }),
  },
  transitionIssue: {
    input: z.object({ key: issueKeyInput, transitionId: z.string().min(1) }).strict(),
    output: z.object({ ok: z.literal(true) }),
  },
  /** The board's drop: find the transition into a status by name and take it. */
  moveIssue: {
    input: z.object({ key: issueKeyInput, toStatus: z.string().min(1) }).strict(),
    output: z.object({ ok: z.literal(true) }),
  },
  addComment: {
    input: z.object({ key: issueKeyInput, body: z.string().trim().min(1).max(32_000) }).strict(),
    output: anyOutput<JiraComment>(),
  },
  assignIssue: {
    input: z.object({ key: issueKeyInput, accountId: z.string().min(1).nullable() }).strict(),
    output: z.object({ ok: z.literal(true) }),
  },
  deleteIssue: {
    input: z.object({ key: issueKeyInput, deleteSubtasks: z.boolean().default(false) }).strict(),
    output: z.object({ ok: z.literal(true) }),
  },
  setPermissions: {
    input: z.object({ permissions: permissionsSchema }).strict(),
    output: z.object({ ok: z.literal(true) }),
  },
  agentTargets: {
    input: z.object({ key: issueKeyInput }).strict(),
    output: anyOutput<AgentTargets>(),
  },
  sendToAgent: {
    input: z
      .object({
        key: issueKeyInput,
        /** The VesnALIA project whose chat the thread starts in. */
        aliaProjectId: z.string().min(1),
        note: z.string().max(4000).default(""),
        /** Also link the issue's Jira project to that VesnALIA project. */
        linkProject: z.boolean().default(false),
        /** Work in a fresh worktree instead of the project's checkout. */
        worktree: z.boolean().default(false),
        /** The machine to run on; empty means the project's default checkout. */
        hostId: z.string().default(""),
        /** Agent provider (e.g. codex, claude-code). Empty keeps project default. */
        providerId: z.string().default(""),
        /** Model id for that provider. Empty keeps project default. */
        model: z.string().default(""),
        reasoningLevel: z
          .enum(["none", "low", "medium", "high", "xhigh", "max", "ultra", "ultracode"])
          .optional(),
        serviceTier: z.enum(["default", "fast"]).optional(),
      })
      .strict(),
    output: z.object({ threadId: z.string() }),
  },
});

// ---------------------------------------------------------------------------
// Pure helpers — exported for tests.
// ---------------------------------------------------------------------------

type ThreadEnvironment = Parameters<AliaPluginApi["sdk"]["threads"]["spawn"]>[0]["environment"];

/**
 * Where the thread runs. Two independent choices: which machine holds the
 * checkout, and whether to work in it or in a fresh worktree branched from its
 * default base. Neither choice picked leaves the project's own default
 * environment to VesnALIA, exactly as before.
 *
 * A worktree always needs an explicit host — VesnALIA rejects `{ type: "host" }`
 * without `hostId` unless the workspace is personal. When the UI left the
 * machine as "Default", resolve it to the project's default checkout host.
 */
export function threadEnvironment(
  project: AgentProject,
  hostId: string,
  worktree: boolean,
): ThreadEnvironment {
  const workspace = worktree
    ? ({ type: "managed-worktree", baseBranch: { kind: "default" } } as const)
    : ({ type: "unmanaged", path: null } as const);

  let resolvedHostId = hostId.trim();
  if (resolvedHostId.length === 0) {
    if (!worktree) return { type: "project-default" };
    resolvedHostId =
      project.hosts.find((host) => host.isDefault)?.hostId ?? project.hosts[0]?.hostId ?? "";
    if (resolvedHostId.length === 0) {
      throw new Error("No enrolled machine is available for that project.");
    }
  }
  if (!project.hosts.some((host) => host.hostId === resolvedHostId)) {
    throw new Error(`${project.name} is not checked out on that machine.`);
  }
  return { type: "host", hostId: resolvedHostId, workspace };
}

export function formatIssueRow(issue: JiraIssueSummary): string {
  return [
    issue.key,
    issue.issueType,
    issue.status,
    issue.priority || "-",
    describeUser(issue.assignee),
    issue.summary,
  ].join("\t");
}

export function formatIssue(
  issue: JiraIssue,
  comments: JiraComment[],
  commentTotal: number,
): string {
  const lines = [
    `${issue.key}: ${issue.summary}`,
    `URL: ${issue.url}`,
    `Type: ${issue.issueType}`,
    `Status: ${issue.status}`,
    `Priority: ${issue.priority || "-"}`,
    `Assignee: ${describeUser(issue.assignee)}`,
    `Reporter: ${describeUser(issue.reporter)}`,
    issue.labels.length > 0 ? `Labels: ${issue.labels.join(", ")}` : "",
    issue.parent === null ? "" : `Parent: ${issue.parent.key} ${issue.parent.summary}`,
    `Created: ${issue.created}`,
    `Updated: ${issue.updated}`,
    "",
    "Description:",
    issue.description.length > 0 ? issue.description : "(empty)",
  ];
  if (comments.length > 0) {
    lines.push(
      "",
      commentTotal > comments.length
        ? `Comments (latest ${comments.length} of ${commentTotal}):`
        : `Comments (${comments.length}):`,
    );
    for (const comment of comments) {
      lines.push(`--- ${describeUser(comment.author)} at ${comment.created}`, comment.body);
    }
  }
  return lines.filter((line, index) => line !== "" || lines[index - 1] !== "").join("\n");
}

/** Picks one user for a free-form assignee reference, or explains why not. */
export function matchUser(
  candidates: JiraUser[],
  reference: string,
): { user: JiraUser } | { error: string } {
  const needle = reference.trim().toLowerCase();
  const exact = candidates.filter(
    (user) =>
      user.accountId === reference.trim() ||
      user.email.toLowerCase() === needle ||
      user.displayName.toLowerCase() === needle,
  );
  const pool = exact.length > 0 ? exact : candidates;
  const [first] = pool;
  if (pool.length === 1 && first !== undefined) return { user: first };
  if (pool.length === 0) {
    return { error: `No assignable Jira user matches "${reference}".` };
  }
  return {
    error: `"${reference}" matches several users: ${pool
      .slice(0, 10)
      .map((user) => `${user.displayName}${user.email ? ` <${user.email}>` : ""}`)
      .join(", ")}. Use a more specific name or the email address.`,
  };
}

export function matchTransition<T extends { id: string; name: string; toStatus: string }>(
  transitions: T[],
  target: string,
): { transition: T } | { error: string } {
  const needle = target.trim().toLowerCase();
  const found =
    transitions.find((transition) => transition.id === target.trim()) ??
    transitions.find((transition) => transition.name.toLowerCase() === needle) ??
    transitions.find((transition) => transition.toStatus.toLowerCase() === needle);
  if (found !== undefined) return { transition: found };
  return {
    error:
      transitions.length === 0
        ? "This issue has no transitions available to the current user."
        : `No transition matches "${target}". Available: ${transitions
            .map((transition) => `${transition.name} → ${transition.toStatus}`)
            .join(", ")}.`,
  };
}

// ---------------------------------------------------------------------------

type ToolResult = string | { content: Array<{ type: "text"; text: string }>; isError: true };

function toolError(error: unknown): ToolResult {
  return {
    content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
    isError: true,
  };
}

export default async function plugin(alia: AliaPluginApi) {
  const settings = alia.settings.define({
    siteUrl: {
      type: "string",
      label: "Jira base URL",
      description: "Your Jira Data Center URL, e.g. https://jira.company.com.",
      default: "",
    },
    pat: {
      type: "string",
      label: "Personal Access Token",
      description: "Create one in Jira: Profile → Personal Access Tokens (Jira 8.14+).",
      secret: true,
    },
    allow_create: {
      type: "select",
      label: "Agents: create issues",
      options: PERMISSION_OPTIONS,
      default: PERMISSION_ASK,
    },
    allow_update: {
      type: "select",
      label: "Agents: edit issue fields",
      options: PERMISSION_OPTIONS,
      default: PERMISSION_ASK,
    },
    allow_transition: {
      type: "select",
      label: "Agents: change status",
      options: PERMISSION_OPTIONS,
      default: PERMISSION_ASK,
    },
    allow_comment: {
      type: "select",
      label: "Agents: add comments",
      options: PERMISSION_OPTIONS,
      default: PERMISSION_ASK,
    },
    allow_assign: {
      type: "select",
      label: "Agents: change assignee",
      options: PERMISSION_OPTIONS,
      default: PERMISSION_ASK,
    },
    allow_delete: {
      type: "select",
      label: "Agents: delete issues",
      options: PERMISSION_OPTIONS,
      default: PERMISSION_ASK,
    },
  });

  async function client(): Promise<JiraClient> {
    const values = await settings.get();
    const siteUrl = normalizeSiteUrl(values.siteUrl);
    const pat = values.pat?.trim() ?? "";
    if (siteUrl === null) throw needsConfiguration(`No Jira base URL is set. ${CONFIG_HINT}`);
    if (pat.length === 0) {
      throw needsConfiguration(`No Personal Access Token is set. ${CONFIG_HINT}`);
    }
    return new JiraClient({ siteUrl, pat });
  }

  async function permissions(): Promise<Record<WriteAction, "ask" | "always">> {
    const values = await settings.get();
    const result = {} as Record<WriteAction, "ask" | "always">;
    for (const action of WRITE_ACTIONS) {
      result[action] = requiresApproval(values[`allow_${action}`]) ? "ask" : "always";
    }
    return result;
  }

  async function setPermission(action: WriteAction, policy: "ask" | "always"): Promise<void> {
    await settings.experimental_set({
      [`allow_${action}`]: policy === "always" ? PERMISSION_ALWAYS : PERMISSION_ASK,
    });
  }

  settings.onChange(() => {
    alia.realtime.publish(SETTINGS_CHANGED, {});
  });

  // ------------------------------------------------------------------
  // VesnALIA project ↔ Jira project links. Mirrored in memory because
  // contributeInstructions must answer synchronously.
  // ------------------------------------------------------------------

  const links = new Map<string, string[]>(
    Object.entries((await alia.storage.kv.get<Record<string, string[]>>(LINKS_KEY)) ?? {}),
  );

  async function saveLink(aliaProjectId: string, jiraProjectKeys: string[]): Promise<void> {
    const keys = [...new Set(jiraProjectKeys)];
    if (keys.length === 0) links.delete(aliaProjectId);
    else links.set(aliaProjectId, keys);
    await alia.storage.kv.set(LINKS_KEY, Object.fromEntries(links));
    alia.realtime.publish(LINKS_CHANGED, { aliaProjectId, jiraProjectKeys: keys });
  }

  function linkedKeys(aliaProjectId: string | null | undefined): string[] {
    return aliaProjectId ? (links.get(aliaProjectId) ?? []) : [];
  }

  function published(key: string, deleted = false): void {
    alia.realtime.publish(ISSUE_CHANGED, { key, deleted });
  }

  // ------------------------------------------------------------------
  // Agent write gate.
  // ------------------------------------------------------------------

  interface WriteRequest {
    action: WriteAction;
    /** One line naming exactly what will change. */
    summary: string;
    issueKey: string;
    details: Array<{ label: string; value: string }>;
  }

  /** Returns null when the write may proceed, or a refusal for the model. */
  async function authorizeAgentWrite(
    request: WriteRequest,
    ctx: { threadId: string; signal: AbortSignal },
  ): Promise<string | null> {
    if (!requiresApproval((await settings.get())[`allow_${request.action}`])) return null;
    let result;
    try {
      result = await alia.ui.requestInput(
        {
          threadId: ctx.threadId,
          rendererId: APPROVAL_RENDERER_ID,
          title: `Allow the agent to ${ACTION_LABELS[request.action].toLowerCase()}?`,
          payload: {
            action: request.action,
            actionLabel: ACTION_LABELS[request.action],
            summary: request.summary,
            issueKey: request.issueKey,
            details: request.details,
          },
        },
        { signal: ctx.signal },
      );
    } catch (error) {
      return `The approval prompt could not be shown (${
        error instanceof Error ? error.message : String(error)
      }). Nothing was sent to Jira. Retry after any other pending prompt resolves.`;
    }
    if (result.outcome === "cancelled") {
      return result.reason === "timeout"
        ? "The approval timed out, so nothing was sent to Jira."
        : "The user declined, so nothing was sent to Jira.";
    }
    if (result.value === "always") {
      await setPermission(request.action, "always");
      alia.log.info(`agent writes of kind "${request.action}" set to always allow`);
      return null;
    }
    return result.value === "once" ? null : "The user declined, so nothing was sent to Jira.";
  }

  // ------------------------------------------------------------------
  // Shared operations.
  // ------------------------------------------------------------------

  async function resolveAssignee(
    jira: JiraClient,
    issueKey: string,
    reference: string,
  ): Promise<{ user: JiraUser | null } | { error: string }> {
    const value = reference.trim();
    const lower = value.toLowerCase();
    if (lower === "" || lower === "none" || lower === "unassigned") return { user: null };
    if (lower === "me") return { user: await jira.myself() };
    return matchUser(await jira.findAssignableUsers({ issueKey }, value), value);
  }

  async function loadIssueDetail(key: string): Promise<JiraIssueDetail> {
    const jira = await client();
    const [issue, comments, transitions] = await Promise.all([
      jira.getIssue(key),
      jira.listComments(key),
      jira.listTransitions(key),
    ]);
    return {
      issue,
      comments: comments.comments,
      commentTotal: comments.total,
      transitions,
      threads: (await alia.storage.kv.get<ThreadLink[]>(`threads:${key}`)) ?? [],
    };
  }

  /**
   * The machines a thread can run on. One VesnALIA install can have several daemons
   * enrolled, and a project is only checked out on some of them, so the
   * machines on offer are the project's own sources — named, and marked with
   * whether the daemon is online right now.
   */
  async function listHosts(): Promise<Map<string, { name: string; connected: boolean }>> {
    const hosts = new Map<string, { name: string; connected: boolean }>();
    try {
      for (const host of await alia.sdk.hosts.list()) {
        hosts.set(host.id, { name: host.name, connected: host.status === "connected" });
      }
    } catch (error) {
      // Without the machine list the send still works on the default checkout.
      alia.log.warn(`could not list machines: ${error instanceof Error ? error.message : String(error)}`);
    }
    return hosts;
  }

  async function listAliaProjects(): Promise<AgentProject[]> {
    const projects = (await alia.sdk.projects.list()) as unknown as Array<{
      id: string;
      name: string;
      sources?: Array<{ hostId: string; isDefault: boolean }>;
    }>;
    const hosts = await listHosts();
    return projects
      .map((project) => ({
        aliaProjectId: project.id,
        name: project.name,
        hosts: (project.sources ?? [])
          .filter((source) => hosts.has(source.hostId))
          .map((source) => ({
            hostId: source.hostId,
            name: hosts.get(source.hostId)?.name ?? source.hostId,
            connected: hosts.get(source.hostId)?.connected ?? false,
            isDefault: source.isDefault,
          }))
          // The default checkout first, then online machines, then by name.
          .sort(
            (left, right) =>
              Number(right.isDefault) - Number(left.isDefault) ||
              Number(right.connected) - Number(left.connected) ||
              left.name.localeCompare(right.name),
          ),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async function agentTargets(key: string): Promise<AgentTargets> {
    const jiraProjectKey = key.slice(0, key.lastIndexOf("-"));
    const all = await listAliaProjects();
    return {
      jiraProjectKey,
      linked: all.filter((project) => linkedKeys(project.aliaProjectId).includes(jiraProjectKey)),
      all,
    };
  }

  async function sendToAgent(args: {
    key: string;
    aliaProjectId: string;
    note: string;
    linkProject: boolean;
    worktree: boolean;
    hostId: string;
    providerId?: string;
    model?: string;
    reasoningLevel?: "none" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra" | "ultracode";
    serviceTier?: "default" | "fast";
  }): Promise<string> {
    const { key, note } = args;
    const projectId = args.aliaProjectId;
    // The panel only offers real projects, but the id still crosses the wire.
    const target = (await listAliaProjects()).find((project) => project.aliaProjectId === projectId);
    if (target === undefined) {
      throw new Error("That VesnALIA project no longer exists.");
    }
    const environment = threadEnvironment(target, args.hostId, args.worktree);
    const jira = await client();
    const [issue, comments] = await Promise.all([jira.getIssue(key), jira.listComments(key)]);
    if (args.linkProject && !linkedKeys(projectId).includes(issue.projectKey)) {
      await saveLink(projectId, [...linkedKeys(projectId), issue.projectKey]);
    }
    const prompt = [
      `Work on Jira issue ${issue.key}.`,
      note.trim().length > 0 ? `\nInstructions from the user:\n${note.trim()}\n` : "",
      "```text",
      formatIssue(issue, comments.comments, comments.total),
      "```",
      "",
      "Use the jira_dc_* tools to read or update this issue as the work progresses.",
    ]
      .filter((line) => line !== "")
      .join("\n");
    const providerId = args.providerId?.trim() ?? "";
    const model = args.model?.trim() ?? "";
    const thread = (await alia.sdk.threads.spawn({
      projectId,
      environment,
      title: `${issue.key}: ${issue.summary}`.slice(0, 120),
      prompt,
      pluginMetadata: { issueKey: issue.key, jiraBaseUrl: jira.siteUrl },
      ...(providerId.length > 0 && model.length > 0
        ? {
            providerId,
            model,
            ...(args.reasoningLevel !== undefined ? { reasoningLevel: args.reasoningLevel } : {}),
            ...(args.serviceTier !== undefined ? { serviceTier: args.serviceTier } : {}),
            // Without explicit provenance VesnALIA drops provider/model and re-derives
            // them from the project's remembered defaults.
            executionInputSources: {
              providerId: "explicit" as const,
              model: "explicit" as const,
              ...(args.reasoningLevel !== undefined
                ? { reasoningLevel: "explicit" as const }
                : {}),
              ...(args.serviceTier !== undefined ? { serviceTier: "explicit" as const } : {}),
            },
          }
        : {}),
    })) as unknown as { id: string };
    const links = (await alia.storage.kv.get<ThreadLink[]>(`threads:${key}`)) ?? [];
    await alia.storage.kv.set(`threads:${key}`, [
      ...links,
      { threadId: thread.id, createdAt: new Date().toISOString() },
    ]);
    published(key);
    return thread.id;
  }

  // Report an unconfigured install up front instead of on first use.
  try {
    await (await client()).myself();
  } catch (error) {
    if (error instanceof Error && error.name === "NeedsConfigurationError") {
      alia.status.needsConfiguration(error.message);
    } else {
      alia.log.warn(`Jira check failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ------------------------------------------------------------------
  // rpc — the panel. These are the user's own actions, so they do not pass
  // through the agent gate; the panel confirms delete itself.
  // ------------------------------------------------------------------

  alia.rpc.register(jiraRpcContract, {
    async status() {
      const values = await settings.get();
      const siteUrl = normalizeSiteUrl(values.siteUrl) ?? "";
      const base = { siteUrl, permissions: await permissions() };
      try {
        const user = await (await client()).myself();
        return { ...base, configured: true, ready: true, user, error: null };
      } catch (error) {
        return {
          ...base,
          configured: !(error instanceof Error && error.name === "NeedsConfigurationError"),
          ready: false,
          user: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async search({ view, projectKey, scopeKeys, text, includeDone, assignees, unassigned, jql, nextPageToken }) {
      const narrowed = projectKey.trim().toUpperCase();
      // A project picked inside a linked scope must stay inside it.
      const keys = narrowed.length > 0 && (scopeKeys.length === 0 || scopeKeys.includes(narrowed)) ? [narrowed] : scopeKeys;
      const query =
        jql.trim().length > 0
          ? scopeJql(jql, keys)
          : buildViewJql({ view, projectKey: "", projectKeys: keys, text, includeDone, assignees, unassigned });
      const page = await (await client()).search(query, {
        ...(nextPageToken === undefined ? {} : { nextPageToken }),
      });
      return { ...page, jql: query };
    },

    getIssue: ({ key }) => loadIssueDetail(key),

    listProjects: async () => (await client()).listProjects(),

    async createOptions({ projectKey }) {
      const jira = await client();
      const [issueTypes, priorities] = await Promise.all([
        jira.listIssueTypes(projectKey),
        jira.listPriorities().catch(() => []),
      ]);
      return { issueTypes, priorities };
    },

    async createFields({ projectKey, issueTypeId }) {
      const fields = await (await client()).listCreateFields(projectKey, issueTypeId);
      return { fields };
    },

    async listProjectLinks() {
      const projects = (await alia.sdk.projects.list()) as unknown as Array<{ id: string; name: string }>;
      const rows = projects.map((project) => ({
        aliaProjectId: project.id,
        name: project.name,
        jiraProjectKeys: links.get(project.id) ?? [],
      }));
      // Linked projects first, so the ones in use are not buried.
      return rows.sort(
        (left, right) =>
          Number(right.jiraProjectKeys.length > 0) - Number(left.jiraProjectKeys.length > 0) ||
          left.name.localeCompare(right.name),
      );
    },

    projectLink: async ({ aliaProjectId }) => ({ jiraProjectKeys: links.get(aliaProjectId) ?? [] }),

    async setProjectLink({ aliaProjectId, jiraProjectKeys }) {
      await saveLink(aliaProjectId, jiraProjectKeys);
      return { ok: true as const };
    },

    projectStatuses: async ({ projectKey }) => (await client()).listProjectStatuses(projectKey),

    async findUsers({ issueKey, projectKey, query }) {
      const jira = await client();
      const key = normalizeIssueKey(issueKey);
      if (isIssueKey(key)) return jira.findAssignableUsers({ issueKey: key }, query);
      const project = projectKey.trim().toUpperCase();
      if (isProjectKey(project)) return jira.findAssignableUsers({ projectKey: project }, query);
      return jira.searchUsers(query);
    },

    async createIssue(input) {
      const jira = await client();
      const meta =
        Object.keys(input.fields).length > 0
          ? await jira.listCreateFields(input.projectKey, input.issueType).catch(() => [])
          : [];
      const byKey = new Map(meta.map((field) => [field.key, field]));
      const extraFields: Record<string, unknown> = {};
      for (const [key, raw] of Object.entries(input.fields)) {
        const field = byKey.get(key);
        if (field === undefined || field.builtIn !== undefined) continue;
        const value = encodeCreateFieldValue(field, raw);
        if (value !== undefined) extraFields[key] = value;
      }
      const created = await jira.createIssue({
        projectKey: input.projectKey,
        issueType: input.issueType,
        summary: input.summary,
        ...(input.description.trim().length > 0 ? { description: input.description } : {}),
        ...(input.priority.length > 0 ? { priority: input.priority } : {}),
        ...(input.assigneeAccountId.length > 0
          ? { assigneeAccountId: input.assigneeAccountId }
          : {}),
        ...(Object.keys(extraFields).length > 0 ? { extraFields } : {}),
      });
      published(created.key);
      return created;
    },

    async updateIssue({ key, ...fields }) {
      await (await client()).updateIssue(key, fields);
      published(key);
      return { ok: true as const };
    },

    async transitionIssue({ key, transitionId }) {
      await (await client()).transitionIssue(key, transitionId);
      published(key);
      return { ok: true as const };
    },

    async moveIssue({ key, toStatus }) {
      const jira = await client();
      const matched = matchTransition(
        (await jira.listTransitions(key)).filter(
          (transition) => transition.toStatus.toLowerCase() === toStatus.toLowerCase(),
        ),
        toStatus,
      );
      if ("error" in matched) {
        throw new Error(`${key} can't move to ${toStatus} from its current status in this workflow.`);
      }
      await jira.transitionIssue(key, matched.transition.id);
      published(key);
      return { ok: true as const };
    },

    async addComment({ key, body }) {
      const comment = await (await client()).addComment(key, body);
      published(key);
      return comment;
    },

    async assignIssue({ key, accountId }) {
      await (await client()).assignIssue(key, accountId);
      published(key);
      return { ok: true as const };
    },

    async deleteIssue({ key, deleteSubtasks }) {
      await (await client()).deleteIssue(key, deleteSubtasks);
      await alia.storage.kv.delete(`threads:${key}`);
      published(key, true);
      return { ok: true as const };
    },

    async setPermissions({ permissions: next }) {
      for (const action of WRITE_ACTIONS) {
        const policy = next[action];
        if (policy !== undefined) await setPermission(action, policy);
      }
      return { ok: true as const };
    },

    agentTargets: ({ key }) => agentTargets(key),

    sendToAgent: async (input) => ({ threadId: await sendToAgent(input) }),
  });

  // ------------------------------------------------------------------
  // Agent tools.
  // ------------------------------------------------------------------

  const keyParam = z.string().min(1).describe("Issue key, e.g. PROJ-123.");

  const searchParameters = z.object({
    jql: z
      .string()
      .min(1)
      .describe('JQL, e.g. assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC.'),
    maxResults: z.number().int().min(1).max(AGENT_SEARCH_MAX).default(20),
  });

  async function runSearch(jql: string, maxResults: number, scope: string): Promise<ToolResult> {
    try {
      const { issues, nextPageToken } = await (await client()).search(jql, { maxResults });
      return [
        scope,
        issues.length === 0 ? "No issues matched." : "KEY\tTYPE\tSTATUS\tPRIORITY\tASSIGNEE\tSUMMARY",
        ...issues.map(formatIssueRow),
        nextPageToken === null ? "" : "(more results exist; narrow the JQL or raise maxResults)",
      ]
        .filter((line) => line !== "")
        .join("\n");
    } catch (error) {
      return toolError(error);
    }
  }

  function parseKey(raw: string): string {
    const key = normalizeIssueKey(raw);
    if (!isIssueKey(key)) throw new Error(`"${raw}" is not a Jira issue key such as PROJ-123.`);
    return key;
  }

  alia.agents.registerTool({
    name: "jira_dc_search_issues",
    description:
      "Search Jira issues with JQL, limited to the Jira projects linked to this thread's VesnALIA project (unlimited when none are linked). Returns key, type, status, priority, assignee, and summary per issue. Read-only.",
    instructions:
      "Use jira_dc_search_issues to find issues before asking the user for keys; use jira_dc_get_issue for the description and comments. It only searches the Jira projects linked to this VesnALIA project — use jira_dc_search_all_issues only when the user asks about issues outside them. Jira writes may pause for the user's approval.",
    presentation: { label: { pending: "Searching Jira", completed: "Searched Jira" } },
    parameters: searchParameters,
    async execute({ jql, maxResults }, ctx) {
      const keys = linkedKeys(ctx.projectId);
      return runSearch(scopeJql(jql, keys), maxResults, keys.length > 0 ? `Scope: linked Jira project(s) ${keys.join(", ")}.` : "Scope: all Jira projects (this VesnALIA project is not linked to any).");
    },
  });

  alia.agents.registerTool({
    name: "jira_dc_search_all_issues",
    description:
      "Search Jira issues with JQL across every Jira project, ignoring this VesnALIA project's linked Jira projects. Read-only.",
    presentation: { label: { pending: "Searching all of Jira", completed: "Searched all of Jira" } },
    parameters: searchParameters,
    async execute({ jql, maxResults }) {
      return runSearch(jql.trim(), maxResults, "Scope: all Jira projects.");
    },
  });

  alia.agents.registerTool({
    name: "jira_dc_get_issue",
    description:
      "Read one Jira issue: fields, description (Markdown), the latest comments, and the status transitions available now. Read-only.",
    presentation: { label: { pending: "Reading Jira issue", completed: "Read Jira issue" } },
    parameters: z.object({ key: keyParam }),
    async execute({ key }) {
      try {
        const detail = await loadIssueDetail(parseKey(key));
        return [
          formatIssue(detail.issue, detail.comments, detail.commentTotal),
          "",
          `Available transitions: ${
            detail.transitions.length === 0
              ? "none"
              : detail.transitions.map((t) => `${t.name} → ${t.toStatus}`).join(", ")
          }`,
        ].join("\n");
      } catch (error) {
        return toolError(error);
      }
    },
  });

  alia.agents.registerTool({
    name: "jira_dc_create_issue",
    description:
      "Create a Jira issue. Description is Markdown. May pause for the user's approval depending on the plugin's permission settings.",
    presentation: { label: { pending: "Creating Jira issue", completed: "Created Jira issue" } },
    parameters: z.object({
      projectKey: z
        .string()
        .default("")
        .describe("Project key, e.g. PROJ. Blank uses the Jira project linked to this VesnALIA project."),
      issueType: z.string().min(1).describe("Issue type name, e.g. Task, Bug, Story."),
      summary: z.string().min(1).max(255),
      description: z.string().default("").describe("Markdown body."),
      priority: z.string().default("").describe("Priority name, e.g. High. Blank keeps the default."),
      assignee: z
        .string()
        .default("")
        .describe('"me", a display name, or an email. Blank leaves it unassigned.'),
      parentKey: z.string().default("").describe("Parent issue key for a sub-task or child issue."),
    }),
    async execute(input, ctx) {
      try {
        const linked = linkedKeys(ctx.projectId);
        let projectKey = input.projectKey.trim().toUpperCase();
        if (projectKey.length === 0) {
          if (linked.length !== 1) {
            return toolError(
              linked.length === 0
                ? "Pass projectKey: this VesnALIA project is not linked to a Jira project."
                : `Pass projectKey: this VesnALIA project is linked to several Jira projects (${linked.join(", ")}).`,
            );
          }
          projectKey = linked[0] ?? "";
        }
        if (!isProjectKey(projectKey)) throw new Error(`"${input.projectKey}" is not a project key.`);
        const parentKey = input.parentKey.trim().length > 0 ? parseKey(input.parentKey) : "";
        const jira = await client();
        let assignee: JiraUser | null = null;
        if (input.assignee.trim().length > 0) {
          const lower = input.assignee.trim().toLowerCase();
          const resolved =
            lower === "me"
              ? { user: await jira.myself() }
              : matchUser(
                  await jira.findAssignableUsers({ projectKey }, input.assignee.trim()),
                  input.assignee,
                );
          if ("error" in resolved) return toolError(resolved.error);
          assignee = resolved.user;
        }
        const refusal = await authorizeAgentWrite(
          {
            action: "create",
            issueKey: projectKey,
            summary: `Create a ${input.issueType} in ${projectKey}: "${input.summary}"`,
            details: [
              { label: "Project", value: projectKey },
              { label: "Type", value: input.issueType },
              { label: "Summary", value: input.summary },
              ...(input.priority ? [{ label: "Priority", value: input.priority }] : []),
              ...(assignee ? [{ label: "Assignee", value: assignee.displayName }] : []),
              ...(parentKey ? [{ label: "Parent", value: parentKey }] : []),
              ...(input.description ? [{ label: "Description", value: input.description }] : []),
            ],
          },
          ctx,
        );
        if (refusal !== null) return toolError(refusal);
        const created = await jira.createIssue({
          projectKey,
          issueType: input.issueType,
          summary: input.summary,
          ...(input.description.trim() ? { description: input.description } : {}),
          ...(input.priority ? { priority: input.priority } : {}),
          ...(assignee ? { assigneeAccountId: assignee.accountId } : {}),
          ...(parentKey ? { parentKey } : {}),
        });
        published(created.key);
        return `Created ${created.key}: ${jira.siteUrl}/browse/${created.key}`;
      } catch (error) {
        return toolError(error);
      }
    },
  });

  alia.agents.registerTool({
    name: "jira_dc_update_issue",
    description:
      "Edit a Jira issue's summary, description (Markdown, replaces the whole description), priority, or labels (replaces the whole set). Use jira_dc_transition_issue for status and jira_dc_assign_issue for assignee. May pause for approval.",
    presentation: { label: { pending: "Editing Jira issue", completed: "Edited Jira issue" } },
    parameters: z.object({
      key: keyParam,
      summary: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      priority: z.string().min(1).optional(),
      labels: z.array(z.string().min(1)).optional(),
    }),
    async execute({ key: rawKey, ...fields }, ctx) {
      try {
        const key = parseKey(rawKey);
        const details = [
          ...(fields.summary !== undefined ? [{ label: "Summary", value: fields.summary }] : []),
          ...(fields.priority !== undefined ? [{ label: "Priority", value: fields.priority }] : []),
          ...(fields.labels !== undefined
            ? [{ label: "Labels", value: fields.labels.join(", ") || "(none)" }]
            : []),
          ...(fields.description !== undefined
            ? [{ label: "Description", value: fields.description || "(cleared)" }]
            : []),
        ];
        if (details.length === 0) return toolError("Nothing to change: pass at least one field.");
        const refusal = await authorizeAgentWrite(
          {
            action: "update",
            issueKey: key,
            summary: `Edit ${key}: ${details.map((detail) => detail.label.toLowerCase()).join(", ")}`,
            details,
          },
          ctx,
        );
        if (refusal !== null) return toolError(refusal);
        await (await client()).updateIssue(key, fields);
        published(key);
        return `Updated ${key}.`;
      } catch (error) {
        return toolError(error);
      }
    },
  });

  alia.agents.registerTool({
    name: "jira_dc_transition_issue",
    description:
      "Move a Jira issue through its workflow, by transition name or target status name (e.g. \"In Progress\", \"Done\"). May pause for approval.",
    presentation: {
      label: { pending: "Changing Jira issue status", completed: "Changed Jira issue status" },
    },
    parameters: z.object({
      key: keyParam,
      to: z.string().min(1).describe("Transition name or target status name."),
    }),
    async execute({ key: rawKey, to }, ctx) {
      try {
        const key = parseKey(rawKey);
        const jira = await client();
        const [issue, transitions] = await Promise.all([
          jira.getIssue(key),
          jira.listTransitions(key),
        ]);
        const matched = matchTransition(transitions, to);
        if ("error" in matched) return toolError(matched.error);
        const refusal = await authorizeAgentWrite(
          {
            action: "transition",
            issueKey: key,
            summary: `Move ${key} from ${issue.status} to ${matched.transition.toStatus}`,
            details: [
              { label: "Issue", value: `${key} ${issue.summary}` },
              { label: "From", value: issue.status },
              { label: "To", value: matched.transition.toStatus },
            ],
          },
          ctx,
        );
        if (refusal !== null) return toolError(refusal);
        await jira.transitionIssue(key, matched.transition.id);
        published(key);
        return `Moved ${key} to ${matched.transition.toStatus}.`;
      } catch (error) {
        return toolError(error);
      }
    },
  });

  alia.agents.registerTool({
    name: "jira_dc_add_comment",
    description: "Add a Markdown comment to a Jira issue. May pause for approval.",
    presentation: { label: { pending: "Commenting on Jira issue", completed: "Commented on Jira issue" } },
    parameters: z.object({ key: keyParam, body: z.string().min(1).describe("Markdown body.") }),
    async execute({ key: rawKey, body }, ctx) {
      try {
        const key = parseKey(rawKey);
        const refusal = await authorizeAgentWrite(
          {
            action: "comment",
            issueKey: key,
            summary: `Comment on ${key}`,
            details: [{ label: "Comment", value: body }],
          },
          ctx,
        );
        if (refusal !== null) return toolError(refusal);
        await (await client()).addComment(key, body);
        published(key);
        return `Commented on ${key}.`;
      } catch (error) {
        return toolError(error);
      }
    },
  });

  alia.agents.registerTool({
    name: "jira_dc_assign_issue",
    description:
      'Assign a Jira issue to "me", a display name, or an email — or "unassigned" to clear it. May pause for approval.',
    presentation: { label: { pending: "Assigning Jira issue", completed: "Assigned Jira issue" } },
    parameters: z.object({
      key: keyParam,
      assignee: z.string().min(1).describe('"me", "unassigned", a display name, or an email.'),
    }),
    async execute({ key: rawKey, assignee }, ctx) {
      try {
        const key = parseKey(rawKey);
        const jira = await client();
        const resolved = await resolveAssignee(jira, key, assignee);
        if ("error" in resolved) return toolError(resolved.error);
        const issue = await jira.getIssue(key);
        const refusal = await authorizeAgentWrite(
          {
            action: "assign",
            issueKey: key,
            summary: `Assign ${key} to ${describeUser(resolved.user)}`,
            details: [
              { label: "Issue", value: `${key} ${issue.summary}` },
              { label: "From", value: describeUser(issue.assignee) },
              { label: "To", value: describeUser(resolved.user) },
            ],
          },
          ctx,
        );
        if (refusal !== null) return toolError(refusal);
        await jira.assignIssue(key, resolved.user?.accountId ?? null);
        published(key);
        return `Assigned ${key} to ${describeUser(resolved.user)}.`;
      } catch (error) {
        return toolError(error);
      }
    },
  });

  alia.agents.registerTool({
    name: "jira_dc_delete_issue",
    description:
      "Permanently delete a Jira issue. This cannot be undone. May pause for approval.",
    instructions:
      "Only call jira_dc_delete_issue when the user explicitly asked for the issue to be deleted; prefer a transition such as Done or Won't Do otherwise.",
    presentation: { label: { pending: "Deleting Jira issue", completed: "Deleted Jira issue" } },
    parameters: z.object({
      key: keyParam,
      deleteSubtasks: z.boolean().default(false).describe("Also delete its sub-tasks."),
    }),
    async execute({ key: rawKey, deleteSubtasks }, ctx) {
      try {
        const key = parseKey(rawKey);
        const jira = await client();
        const issue = await jira.getIssue(key);
        const refusal = await authorizeAgentWrite(
          {
            action: "delete",
            issueKey: key,
            summary: `Permanently delete ${key}${deleteSubtasks ? " and its sub-tasks" : ""}`,
            details: [
              { label: "Issue", value: `${key} ${issue.summary}` },
              { label: "Type", value: issue.issueType },
              { label: "Status", value: issue.status },
            ],
          },
          ctx,
        );
        if (refusal !== null) return toolError(refusal);
        await jira.deleteIssue(key, deleteSubtasks);
        await alia.storage.kv.delete(`threads:${key}`);
        published(key, true);
        return `Deleted ${key}.`;
      } catch (error) {
        return toolError(error);
      }
    },
  });

  alia.agents.contributeInstructions(({ projectId }) => {
    const keys = linkedKeys(projectId);
    if (keys.length === 0) return null;
    return `This VesnALIA project is linked to Jira project${keys.length === 1 ? "" : "s"} ${keys.join(", ")}. jira_dc_search_issues and new issues default to ${keys.length === 1 ? "it" : "them"}; use jira_dc_search_all_issues only when the user asks about other Jira projects.`;
  });

  // ------------------------------------------------------------------
  // @-mentions: attach an issue's current state to a message.
  // ------------------------------------------------------------------

  alia.ui.registerMentionProvider({
    id: "jira-dc-issue",
    label: "Jira DC issues",
    async search({ query, projectId }) {
      try {
        const jira = await client();
        const keys = linkedKeys(projectId);
        if (keys.length > 0) {
          const { issues } = await jira.search(
            buildViewJql({ view: "all", projectKey: "", projectKeys: keys, text: query, includeDone: true }),
            { maxResults: 20 },
          );
          return issues.map((issue) => ({ id: issue.key, title: issue.key, subtitle: issue.summary }));
        }
        const picked = await jira.pickIssues(query);
        return picked.slice(0, 20).map((issue) => ({
          id: issue.key,
          title: issue.key,
          subtitle: issue.summary,
        }));
      } catch {
        return [];
      }
    },
    async resolve(itemId) {
      const jira = await client();
      const key = parseKey(itemId);
      const [issue, comments] = await Promise.all([jira.getIssue(key), jira.listComments(key)]);
      return { context: formatIssue(issue, comments.comments, comments.total) };
    },
  });

  // ------------------------------------------------------------------
  // CLI — VesnALIA jira-dc …
  // ------------------------------------------------------------------

  function cliJson(value: unknown): { exitCode: number; stdout: string } {
    return { exitCode: 0, stdout: `${JSON.stringify(value, null, 2)}\n` };
  }

  alia.cli.register(
    defineCli({
      name: "jira-dc",
      summary: "Jira Data Center issues, links, comments, and transitions",
      commands: {
        status: cliCommand({
          summary: "Show connection status and the current Jira user",
          options: { json: { type: "boolean", description: "Emit JSON" } },
          async run(input) {
            const values = await settings.get();
            const siteUrl = normalizeSiteUrl(values.siteUrl) ?? "";
            try {
              const user = await (await client()).myself();
              const payload = { ready: true, siteUrl, user };
              if (input.options.json) return cliJson(payload);
              return {
                exitCode: 0,
                stdout: `Connected to ${siteUrl} as ${user.displayName} (${user.accountId})\n`,
              };
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              if (input.options.json) {
                return cliJson({ ready: false, siteUrl, error: message });
              }
              throw new PluginCliError(message, { code: "invalid_value", hint: CONFIG_HINT });
            }
          },
        }),
        link: cliCommand({
          summary: "Link this VesnALIA project to one or more Jira project keys",
          positionals: [
            {
              name: "keys",
              description: "Jira project keys (space-separated)",
              required: true,
              variadic: true,
            },
          ],
          options: {
            project: {
              type: "string",
              description: "VesnALIA project id (defaults to the current thread's project)",
            },
            json: { type: "boolean", description: "Emit JSON" },
          },
          async run(input, ctx) {
            const aliaProjectId = input.options.project?.trim() || ctx.projectId;
            if (!aliaProjectId) {
              throw new PluginCliError("No VesnALIA project id", {
                code: "missing_required",
                hint: "Pass --project proj_… or run inside a project thread.",
              });
            }
            const keys = input.positionals.keys
              .map((key) => key.trim().toUpperCase())
              .filter(Boolean);
            for (const key of keys) {
              if (!isProjectKey(key)) {
                throw new PluginCliError(`"${key}" is not a project key`, {
                  code: "invalid_value",
                });
              }
            }
            await saveLink(aliaProjectId, [...linkedKeys(aliaProjectId), ...keys]);
            const linked = linkedKeys(aliaProjectId);
            if (input.options.json) return cliJson({ aliaProjectId, jiraProjectKeys: linked });
            return {
              exitCode: 0,
              stdout: `Linked ${aliaProjectId} → ${linked.join(", ") || "(none)"}\n`,
            };
          },
        }),
        unlink: cliCommand({
          summary: "Remove Jira project links from a VesnALIA project",
          options: {
            project: {
              type: "string",
              description: "VesnALIA project id (defaults to the current thread's project)",
            },
            all: { type: "boolean", description: "Clear every linked Jira project" },
            json: { type: "boolean", description: "Emit JSON" },
          },
          positionals: [
            {
              name: "keys",
              description: "Jira project keys to unlink (omit with --all)",
              required: false,
              variadic: true,
            },
          ],
          async run(input, ctx) {
            const aliaProjectId = input.options.project?.trim() || ctx.projectId;
            if (!aliaProjectId) {
              throw new PluginCliError("No VesnALIA project id", {
                code: "missing_required",
                hint: "Pass --project proj_… or run inside a project thread.",
              });
            }
            if (input.options.all) {
              await saveLink(aliaProjectId, []);
            } else {
              const remove = new Set(
                (input.positionals.keys ?? []).map((key) => key.trim().toUpperCase()),
              );
              if (remove.size === 0) {
                throw new PluginCliError("Pass project keys or --all", {
                  code: "missing_required",
                });
              }
              await saveLink(
                aliaProjectId,
                linkedKeys(aliaProjectId).filter((key) => !remove.has(key)),
              );
            }
            const linked = linkedKeys(aliaProjectId);
            if (input.options.json) return cliJson({ aliaProjectId, jiraProjectKeys: linked });
            return {
              exitCode: 0,
              stdout: `Linked ${aliaProjectId} → ${linked.join(", ") || "(none)"}\n`,
            };
          },
        }),
        search: cliCommand({
          summary: "Search issues with JQL (scoped to linked projects when set)",
          positionals: [
            { name: "jql", description: "JQL query", required: true },
          ],
          options: {
            project: {
              type: "string",
              description: "VesnALIA project id for link scoping",
            },
            all: {
              type: "boolean",
              description: "Ignore project links and search all of Jira",
            },
            limit: {
              type: "integer",
              default: 20,
              min: 1,
              max: 50,
              description: "Max results (1-50)",
            },
            json: { type: "boolean", description: "Emit JSON" },
          },
          async run(input, ctx) {
            const limit = input.options.limit;
            const aliaProjectId = input.options.project?.trim() || ctx.projectId;
            const keys = input.options.all ? [] : linkedKeys(aliaProjectId);
            const jql = scopeJql(input.positionals.jql, keys);
            const page = await (await client()).search(jql, { maxResults: limit });
            if (input.options.json) return cliJson({ jql, ...page });
            const lines = [
              `JQL: ${jql}`,
              "KEY\tTYPE\tSTATUS\tPRIORITY\tASSIGNEE\tSUMMARY",
              ...page.issues.map(formatIssueRow),
            ];
            return { exitCode: 0, stdout: `${lines.join("\n")}\n` };
          },
        }),
        get: cliCommand({
          summary: "Show one issue with comments and available transitions",
          positionals: [{ name: "key", description: "Issue key", required: true }],
          options: { json: { type: "boolean", description: "Emit JSON" } },
          async run(input) {
            const detail = await loadIssueDetail(parseKey(input.positionals.key));
            if (input.options.json) return cliJson(detail);
            return {
              exitCode: 0,
              stdout: `${formatIssue(detail.issue, detail.comments, detail.commentTotal)}\n\nAvailable transitions: ${
                detail.transitions.length === 0
                  ? "none"
                  : detail.transitions.map((t) => `${t.name} → ${t.toStatus}`).join(", ")
              }\n`,
            };
          },
        }),
        comment: cliCommand({
          summary: "Add a Markdown comment to an issue",
          positionals: [
            { name: "key", description: "Issue key", required: true },
            { name: "body", description: "Comment body (Markdown)", required: true },
          ],
          options: { json: { type: "boolean", description: "Emit JSON" } },
          async run(input) {
            const key = parseKey(input.positionals.key);
            const comment = await (await client()).addComment(key, input.positionals.body);
            published(key);
            if (input.options.json) return cliJson(comment);
            return { exitCode: 0, stdout: `Commented on ${key}\n` };
          },
        }),
        transition: cliCommand({
          summary: "Move an issue through a workflow transition",
          positionals: [
            { name: "key", description: "Issue key", required: true },
            {
              name: "to",
              description: "Transition name or target status",
              required: true,
            },
          ],
          options: { json: { type: "boolean", description: "Emit JSON" } },
          async run(input) {
            const key = parseKey(input.positionals.key);
            const jira = await client();
            const matched = matchTransition(await jira.listTransitions(key), input.positionals.to);
            if ("error" in matched) {
              throw new PluginCliError(matched.error, { code: "invalid_value" });
            }
            await jira.transitionIssue(key, matched.transition.id);
            published(key);
            const payload = {
              key,
              transition: matched.transition.name,
              toStatus: matched.transition.toStatus,
            };
            if (input.options.json) return cliJson(payload);
            return {
              exitCode: 0,
              stdout: `Transitioned ${key} via ${matched.transition.name} → ${matched.transition.toStatus}\n`,
            };
          },
        }),
        spawn: cliCommand({
          summary: "Create a VesnALIA thread from a Jira issue",
          positionals: [{ name: "key", description: "Issue key", required: true }],
          options: {
            project: {
              type: "string",
              description: "VesnALIA project id (defaults to the current thread's project)",
            },
            note: {
              type: "string",
              default: "",
              description: "Extra instructions for the agent",
            },
            worktree: {
              type: "boolean",
              description: "Run in a new worktree when the project supports it",
            },
            json: { type: "boolean", description: "Emit JSON" },
          },
          async run(input, ctx) {
            const aliaProjectId = input.options.project?.trim() || ctx.projectId;
            if (!aliaProjectId) {
              throw new PluginCliError("No VesnALIA project id", {
                code: "missing_required",
                hint: "Pass --project proj_… or run inside a project thread.",
              });
            }
            const target = (await listAliaProjects()).find(
              (project) => project.aliaProjectId === aliaProjectId,
            );
            if (target === undefined) {
              throw new PluginCliError("That VesnALIA project no longer exists.", {
                code: "invalid_value",
              });
            }
            const hostId =
              target.sources.find((source) => source.isDefault)?.hostId ??
              target.sources[0]?.hostId;
            if (!hostId) {
              throw new PluginCliError("No enrolled machine is available for that project.", {
                code: "invalid_value",
              });
            }
            const threadId = await sendToAgent({
              key: parseKey(input.positionals.key),
              aliaProjectId,
              note: input.options.note,
              linkProject: true,
              worktree: input.options.worktree === true,
              hostId,
            });
            if (input.options.json) return cliJson({ threadId });
            return { exitCode: 0, stdout: `Spawned ${threadId}\n` };
          },
        }),
      },
    }),
  );
}
