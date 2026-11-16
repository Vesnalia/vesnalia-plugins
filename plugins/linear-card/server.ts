// alia-plugin-linear-card — the Linear issue behind each thread.
//
// A thread's card is the issue linked explicitly (stored in this plugin's
// thread metadata namespace) or, failing that, the issue named by the
// environment's git branch (Linear branch names look like
// `daniel/tra-123-some-title`). The explorer lists the viewer's assigned issues,
// scoped to a Linear team remembered per VesnALIA project. Long titles get a short
// AI label for the header chip (Claude Haiku through the Account Pooler), and
// `GET /upload` proxies Linear's login-only attachments with the API key.
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { defineRpcContract, type AliaPluginApi } from "@vesnalia/plugin-sdk";
import { z } from "zod";
import { CARD_CHANGED, ENABLED_PROJECTS_CHANGED } from "./shared";

const LINEAR_API = "https://api.linear.app/graphql";
const LINEAR_UPLOADS_HOST = "uploads.linear.app";
const MAX_EXPLORER_ISSUES = 500;
const TEAMS_TTL_MS = 10 * 60_000;
/** Titles longer than this get an AI short label in the header chip. */
const SHORT_TITLE_MIN_CHARS = 40;
const SHORT_TITLE_MODEL = "claude-haiku-4-5";
const SHORT_TITLE_PROMPT = `Rewrite the Linear issue title you are given as a short ticket label of at most 6 words and 40 characters.
Keep the specific feature, screen, or error it is about. Plain words, no quotes, no issue id, no trailing period.
Reply with only the label.`;

const stateSchema = z.object({ name: z.string(), type: z.string(), color: z.string() });
const issueSummarySchema = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  url: z.string(),
  priority: z.number(),
  priorityLabel: z.string(),
  updatedAt: z.string(),
  state: stateSchema,
  team: z.object({ key: z.string() }),
  project: z.object({ name: z.string() }).nullable(),
});
const issueDetailSchema = issueSummarySchema.extend({
  description: z.string().nullable(),
  branchName: z.string(),
  assignee: z.object({ name: z.string() }).nullable(),
  labels: z.object({ nodes: z.array(z.object({ name: z.string(), color: z.string() })) }),
});
const teamSchema = z.object({ key: z.string(), name: z.string() });
export type IssueSummary = z.infer<typeof issueSummarySchema>;
export type IssueDetail = z.infer<typeof issueDetailSchema>;
export type Team = z.infer<typeof teamSchema>;

const identifierSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[A-Z][A-Z0-9]{0,9}-\d{1,7}$/u, "Expected an issue id like TRA-123"));

/** This plugin's namespace in thread metadata; untrusted, so parsed on read. */
const threadMetadataSchema = z.object({
  identifier: identifierSchema.optional().catch(undefined),
  unlinked: z.boolean().optional().catch(undefined),
});

const threadCardSchema = z.discriminatedUnion("status", [
  // The thread's project is not switched on in the plugin settings.
  z.object({ status: z.literal("disabled") }),
  z.object({ status: z.literal("unconfigured") }),
  z.object({ status: z.literal("none"), branchName: z.string().nullable() }),
  z.object({
    status: z.literal("card"),
    source: z.enum(["linked", "branch"]),
    branchName: z.string().nullable(),
    issue: issueDetailSchema,
    /** AI label for long titles; null when the title is short or not summarized yet. */
    shortTitle: z.string().nullable(),
  }),
  // A linked identifier that Linear no longer resolves (deleted, no access).
  z.object({ status: z.literal("missing"), identifier: z.string() }),
]);
export type ThreadCard = z.infer<typeof threadCardSchema>;

export const rpcContract = defineRpcContract({
  thread_card: {
    input: z.object({ threadId: z.string().min(1), projectId: z.string().min(1) }),
    output: threadCardSchema,
  },
  link_card: {
    input: z.object({ threadId: z.string().min(1), identifier: identifierSchema }),
    output: z.object({ ok: z.literal(true) }),
  },
  settings_projects: {
    input: z.null(),
    output: z.object({
      projects: z.array(z.object({ id: z.string(), name: z.string() })),
    }),
  },
  enabled_projects: {
    input: z.null(),
    output: z.object({ projectIds: z.array(z.string()) }),
  },
  set_project_enabled: {
    input: z.object({ projectId: z.string().min(1), enabled: z.boolean() }),
    output: z.object({ projectIds: z.array(z.string()) }),
  },
  unlink_card: {
    input: z.object({ threadId: z.string().min(1) }),
    output: z.object({ ok: z.literal(true) }),
  },
  issue_detail: {
    input: z.object({ identifier: identifierSchema }),
    output: z.object({ issue: issueDetailSchema.nullable() }),
  },
  explorer: {
    // teamKey: undefined = use the project's saved scope; null = all teams.
    input: z.object({
      projectId: z.string().min(1),
      teamKey: z.string().nullable().optional(),
      includeDone: z.boolean(),
    }),
    output: z.discriminatedUnion("status", [
      z.object({ status: z.literal("unconfigured") }),
      z.object({
        status: z.literal("ok"),
        teams: z.array(teamSchema),
        teamKey: z.string().nullable(),
        issues: z.array(issueSummarySchema),
      }),
    ]),
  },
});

const ISSUE_SUMMARY_FIELDS = `id identifier title url priority priorityLabel updatedAt
  state { name type color } team { key } project { name }`;
const ISSUE_DETAIL_FIELDS = `${ISSUE_SUMMARY_FIELDS} description branchName
  assignee { name } labels { nodes { name color } }`;

const graphqlResponseSchema = z.object({
  data: z.unknown().optional(),
  errors: z.array(z.object({ message: z.string() })).optional(),
});
const messageResponseSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
});
/** Account Pooler machine token, written by the account-pool plugin. */
const hubTokenSchema = z.object({ value: z.string().min(32) });
const shortTitleCacheSchema = z.object({ title: z.string(), short: z.string() });

class LinearNotConfiguredError extends Error {}

export default async function plugin(alia: AliaPluginApi) {
  const settings = alia.settings.define({
    apiKey: {
      type: "string",
      label: "Linear API key",
      description: "Personal API key from Linear → Settings → Security & access.",
      secret: true,
    },
  });

  async function linear(query: string, variables: Record<string, unknown>): Promise<unknown> {
    const { apiKey } = await settings.get();
    if (typeof apiKey !== "string" || apiKey === "") throw new LinearNotConfiguredError();
    const res = await fetch(LINEAR_API, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: apiKey },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = graphqlResponseSchema.parse(await res.json());
    if (body.errors?.length) throw new Error(`Linear: ${body.errors[0]!.message}`);
    if (!res.ok) throw new Error(`Linear HTTP ${res.status}`);
    return body.data;
  }

  let teamsCache: { at: number; teams: Team[] } | null = null;
  async function teams(): Promise<Team[]> {
    if (teamsCache && Date.now() - teamsCache.at < TEAMS_TTL_MS) return teamsCache.teams;
    const data = z
      .object({ teams: z.object({ nodes: z.array(teamSchema) }) })
      .parse(await linear(`{ teams(first: 100) { nodes { key name } } }`, {}));
    teamsCache = { at: Date.now(), teams: data.teams.nodes };
    return teamsCache.teams;
  }

  async function issue(identifier: string): Promise<IssueDetail | null> {
    try {
      const data = z
        .object({ issue: issueDetailSchema })
        .parse(await linear(`query($id: String!) { issue(id: $id) { ${ISSUE_DETAIL_FIELDS} } }`, { id: identifier }));
      return data.issue;
    } catch (error) {
      // Linear reports an unknown identifier as an "Entity not found" error.
      if (error instanceof Error && /not found/iu.test(error.message)) return null;
      throw error;
    }
  }

  /** First `KEY-123` in the branch whose KEY is a real team key. */
  async function identifierFromBranch(branchName: string): Promise<string | null> {
    const keys = new Set((await teams()).map((team) => team.key));
    for (const match of branchName.matchAll(/(?:^|[^A-Za-z0-9])([A-Za-z][A-Za-z0-9]{0,9})-(\d{1,7})(?![0-9])/gu)) {
      const key = match[1]!.toUpperCase();
      if (keys.has(key)) return `${key}-${match[2]}`;
    }
    return null;
  }

  async function threadBranch(threadId: string): Promise<string | null> {
    const thread = await alia.sdk.threads.get({ threadId });
    if (!thread.environmentId) return null;
    const environment = await alia.sdk.environments.get({ environmentId: thread.environmentId });
    return environment.branchName ?? null;
  }

  async function threadMetadata(threadId: string) {
    const raw = await alia.sdk.threads.getPluginMetadata({ threadId });
    const parsed = threadMetadataSchema.safeParse(raw);
    return parsed.success ? parsed.data : {};
  }

  async function poolerToken(): Promise<string> {
    const dir = join(homedir(), ".vesnalia/plugins/account-pool/secrets/accounts");
    const file = (await readdir(dir)).find((name) => name.startsWith("hub-token-"));
    if (!file) throw new Error("No Account Pooler hub token on this machine.");
    return hubTokenSchema.parse(JSON.parse(await readFile(join(dir, file), "utf8"))).value;
  }

  async function summarizeTitle(title: string): Promise<string> {
    const res = await fetch(`${alia.server.loopbackBaseUrl}/api/v1/plugins/account-pool/http/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-alia-account-pool-token": await poolerToken(),
      },
      body: JSON.stringify({
        model: SHORT_TITLE_MODEL,
        max_tokens: 40,
        system: SHORT_TITLE_PROMPT,
        messages: [{ role: "user", content: title }],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`summarizer HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = messageResponseSchema.parse(await res.json());
    const short = data.content.map((part) => part.text ?? "").join("").trim().replace(/^["']|["'.]$/gu, "");
    if (!short) throw new Error("summarizer returned no text");
    return short;
  }

  // One summary per issue title at a time; failures are not retried until reload.
  const pendingShortTitles = new Map<string, Promise<boolean>>();
  const failedShortTitles = new Set<string>();

  /** Cached short label, or null while one is generated in the background. */
  async function shortTitle(threadId: string, issue: IssueDetail): Promise<string | null> {
    if (issue.title.length <= SHORT_TITLE_MIN_CHARS) return null;
    const cacheKey = `short-title:${issue.id}`;
    const cached = shortTitleCacheSchema.safeParse(await alia.storage.kv.get(cacheKey));
    if (cached.success && cached.data.title === issue.title) return cached.data.short;
    const jobKey = `${issue.id}\n${issue.title}`;
    if (failedShortTitles.has(jobKey)) return null;
    let job = pendingShortTitles.get(jobKey);
    if (!job) {
      job = summarizeTitle(issue.title)
        .then(async (short) => {
          await alia.storage.kv.set(cacheKey, { title: issue.title, short });
          return true;
        })
        .catch((error: unknown) => {
          failedShortTitles.add(jobKey);
          alia.log.warn(`short title for ${issue.identifier} failed: ${error instanceof Error ? error.message : String(error)}`);
          return false;
        })
        .finally(() => pendingShortTitles.delete(jobKey));
      pendingShortTitles.set(jobKey, job);
    }
    // Every thread showing this issue refetches once the label is stored.
    void job.then((stored) => stored && alia.realtime.publish(CARD_CHANGED, { threadId }));
    return null;
  }

  async function threadCard(threadId: string, projectId: string): Promise<ThreadCard> {
    // Checked here, not in a separate call, so a header costs one request.
    if (!(await enabledProjects()).includes(projectId)) return { status: "disabled" };
    try {
      const metadata = await threadMetadata(threadId);
      if (metadata.identifier) {
        const linked = await issue(metadata.identifier);
        if (!linked) return { status: "missing", identifier: metadata.identifier };
        const short = await shortTitle(threadId, linked);
        return { status: "card", source: "linked", branchName: null, issue: linked, shortTitle: short };
      }
      const branchName = await threadBranch(threadId);
      if (metadata.unlinked || !branchName) return { status: "none", branchName };
      const identifier = await identifierFromBranch(branchName);
      const detected = identifier ? await issue(identifier) : null;
      if (!detected) return { status: "none", branchName };
      const short = await shortTitle(threadId, detected);
      return { status: "card", source: "branch", branchName, issue: detected, shortTitle: short };
    } catch (error) {
      if (error instanceof LinearNotConfiguredError) return { status: "unconfigured" };
      throw error;
    }
  }

  // Linear attachments (uploads.linear.app) answer 401 without the API key, so
  // the card dialog loads them through this route. Only that host is proxied,
  // and the CSP sandbox keeps an uploaded HTML/SVG file from running on VesnALIA's origin.
  alia.http.route("GET", "/upload", async (c) => {
    let url: URL;
    try {
      url = new URL(c.req.query("u") ?? "");
    } catch {
      return c.text("Expected ?u=<Linear upload URL>", 400);
    }
    if (url.protocol !== "https:" || url.hostname !== LINEAR_UPLOADS_HOST) {
      return c.text("Only Linear upload URLs are proxied", 400);
    }
    const { apiKey } = await settings.get();
    if (typeof apiKey !== "string" || apiKey === "") return c.text("Linear API key is not set", 503);
    const upstream = await fetch(url, { headers: { authorization: apiKey }, signal: AbortSignal.timeout(120_000) });
    const headers = new Headers({
      "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "private, max-age=3600",
      "content-security-policy": "sandbox; default-src 'none'; img-src 'self'; media-src 'self'",
      "x-content-type-options": "nosniff",
    });
    const length = upstream.headers.get("content-length");
    if (length) headers.set("content-length", length);
    return new Response(upstream.body, { status: upstream.status, headers });
  });

  async function assignedIssues(teamKey: string | null, includeDone: boolean): Promise<IssueSummary[]> {
    const filter: Record<string, unknown> = {};
    if (teamKey) filter.team = { key: { eq: teamKey } };
    if (!includeDone) filter.state = { type: { nin: ["completed", "canceled"] } };
    const pageSchema = z.object({
      viewer: z.object({
        assignedIssues: z.object({
          nodes: z.array(issueSummarySchema),
          pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
        }),
      }),
    });
    const issues: IssueSummary[] = [];
    let after: string | null = null;
    while (issues.length < MAX_EXPLORER_ISSUES) {
      const page: z.infer<typeof pageSchema>["viewer"]["assignedIssues"] = pageSchema.parse(
        await linear(
          `query($filter: IssueFilter, $after: String) {
            viewer { assignedIssues(first: 100, after: $after, filter: $filter, orderBy: updatedAt) {
              nodes { ${ISSUE_SUMMARY_FIELDS} } pageInfo { hasNextPage endCursor } } } }`,
          { filter, after },
        ),
      ).viewer.assignedIssues;
      issues.push(...page.nodes);
      if (!page.pageInfo.hasNextPage) break;
      after = page.pageInfo.endCursor;
    }
    return issues.slice(0, MAX_EXPLORER_ISSUES);
  }

  /** The project's saved team scope; one-team workspaces default to that team. */
  async function projectTeam(projectId: string, allTeams: Team[]): Promise<string | null> {
    const saved = await alia.storage.kv.get<{ teamKey: string | null }>(`project-team:${projectId}`);
    if (saved && (saved.teamKey === null || allTeams.some((team) => team.key === saved.teamKey))) {
      return saved.teamKey;
    }
    return allTeams.length === 1 ? allTeams[0]!.key : null;
  }

  // Projects where the header chip shows; edited from the plugin's settings page.
  const ENABLED_PROJECTS_KEY = "enabled-projects";
  async function enabledProjects(): Promise<string[]> {
    const parsed = z.array(z.string()).safeParse(await alia.storage.kv.get(ENABLED_PROJECTS_KEY));
    return parsed.success ? parsed.data : [];
  }

  alia.rpc.register(rpcContract, {
    thread_card: ({ threadId, projectId }) => threadCard(threadId, projectId),
    enabled_projects: async () => ({ projectIds: await enabledProjects() }),
    async settings_projects() {
      const projects = await alia.sdk.projects.list({ includePersonal: true });
      return { projects: projects.map((project) => ({ id: project.id, name: project.name })) };
    },
    async set_project_enabled({ projectId, enabled }) {
      const rest = (await enabledProjects()).filter((id) => id !== projectId);
      const projectIds = enabled ? [...rest, projectId] : rest;
      await alia.storage.kv.set(ENABLED_PROJECTS_KEY, projectIds);
      alia.realtime.publish(ENABLED_PROJECTS_CHANGED, { projectIds });
      return { projectIds };
    },
    async link_card({ threadId, identifier }) {
      if (!(await issue(identifier))) throw new Error(`Linear has no issue ${identifier}`);
      await alia.sdk.threads.updatePluginMetadata({ threadId, set: { identifier }, remove: ["unlinked"] });
      alia.realtime.publish(CARD_CHANGED, { threadId });
      return { ok: true as const };
    },
    async unlink_card({ threadId }) {
      // `unlinked` also stops the branch name from re-attaching a card.
      await alia.sdk.threads.updatePluginMetadata({ threadId, set: { unlinked: true }, remove: ["identifier"] });
      alia.realtime.publish(CARD_CHANGED, { threadId });
      return { ok: true as const };
    },
    issue_detail: async ({ identifier }) => ({ issue: await issue(identifier) }),
    async explorer({ projectId, teamKey, includeDone }) {
      try {
        const allTeams = await teams();
        let scope: string | null;
        if (teamKey === undefined) {
          scope = await projectTeam(projectId, allTeams);
        } else {
          scope = teamKey;
          await alia.storage.kv.set(`project-team:${projectId}`, { teamKey: scope });
        }
        return { status: "ok" as const, teams: allTeams, teamKey: scope, issues: await assignedIssues(scope, includeDone) };
      } catch (error) {
        if (error instanceof LinearNotConfiguredError) return { status: "unconfigured" as const };
        throw error;
      }
    },
  });
}
