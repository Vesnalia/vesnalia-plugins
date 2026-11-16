// alia-plugin-omp-agents — list the OMP task agents visible to a workspace and
// offer them to VesnALIA's composer as searchable `@agent…` mentions.
//
// Discovery is server-side because the definition files live on the machines
// VesnALIA runs, not in the browser. Every read goes through `alia.sdk`, so it inherits
// VesnALIA's host selection instead of the plugin opening the filesystem itself.
import { homedir } from "node:os";
import { defineRpcContract, type AliaPluginApi } from "@vesnalia/plugin-sdk";
import { z } from "zod";
import {
  expandHome,
  mergeAgents,
  parseAgentMarkdown,
  rankAgents,
  renderMentionContext,
  mentionSubtitle,
  userAgentRoots,
  type AgentScope,
  type OmpAgent,
} from "./omp-agents.ts";

const agentSchema = z.object({
  name: z.string(),
  description: z.string(),
  tools: z.array(z.string()),
  model: z.array(z.string()),
  spawns: z.array(z.string()),
  scope: z.enum(["project", "user", "extra"]),
  filePath: z.string(),
});

const agentListSchema = z.object({
  agents: z.array(agentSchema),
  /** Directories inspected, in precedence order (for diagnostics). */
  searchedDirs: z.array(z.string()),
  /** Provider this surface would run on; null when nothing is selected yet. */
  providerId: z.string().nullable(),
  /** Whether that provider can spawn an OMP subagent at all. */
  canSpawn: z.boolean(),
  /**
   * Every provider id this server actually has, and the ones the setting names.
   * A setting naming none of the known ids is a typo or an uninstalled
   * provider, and the panel says so instead of silently offering nothing.
   */
  knownProviderIds: z.array(z.string()),
  configuredProviderIds: z.array(z.string()),
});

/** Payload of `agents_list`; app.tsx imports the type, not the schema. */
export type AgentList = z.infer<typeof agentListSchema>;

export const rpcContract = defineRpcContract({
  agents_list: {
    input: z.object({
      threadId: z.string().trim().min(1).nullable(),
      projectId: z.string().trim().min(1).nullable(),
    }),
    output: agentListSchema,
  },
});

const MENTION_PROVIDER_ID = "omp-agent";
const DEFAULT_MENTION_LIMIT = 40;
const MAX_MENTION_LIMIT = 200;
const MAX_EXTRA_DIRS = 8;
const DISCOVERY_TTL_MS = 60_000;

/**
 * Providers whose threads can actually spawn an OMP subagent. Only the ACP
 * entry qualifies on a stock install: it launches `omp acp`. The Pi provider is
 * a different tool (its own `pi` binary and `.pi/agent` roots), so a Pi thread
 * reads none of these definitions. Overridable because a custom ACP agent can
 * register omp under another id.
 */
const DEFAULT_OMP_PROVIDER_IDS = "acp-omp";

/** The provider a surface would run on: the thread's own, else the user default. */
async function surfaceProviderId(alia: AliaPluginApi, threadId: string | null): Promise<string | null> {
  if (threadId !== null) {
    try {
      const thread = await alia.sdk.threads.get({ threadId });
      return thread.providerId;
    } catch {
      return null;
    }
  }
  try {
    const { generalSettings } = await alia.sdk.system.config();
    return generalSettings.defaultProviderId;
  } catch {
    return null;
  }
}

/**
 * Whether the composer's selected provider can spawn OMP agents.
 *
 * Mention search carries no provider, so this reads the provider the surface
 * would start or continue with: a thread's own provider, or the user's
 * configured default provider for a surface that has no thread yet. An
 * unknown thread or a null default resolves to "not OMP" — the menu stays
 * empty rather than offering a mention that cannot be spawned.
 */
async function canSpawnOmpAgents(
  alia: AliaPluginApi,
  threadId: string | null,
  providerIds: string,
): Promise<boolean> {
  const providerId = await surfaceProviderId(alia, threadId);
  return providerId !== null && parseProviderIds(providerIds).includes(providerId);
}

/** Split the comma-separated provider-id setting into a trimmed list. */
function parseProviderIds(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

/** One local definition file, tagged with its scope and owning machine. */
interface Definition {
  hostId: string;
  path: string;
  scope: AgentScope;
}

/** The workspace a search should read project agents from, and its machine. */
interface Workspace {
  hostId: string;
  path: string;
}

/** A workspace-rooted, agent-scoped answer from the backend. */
type Discovery = { agents: OmpAgent[]; searchedDirs: string[] };

/**
 * A workspace-scoped search query. `search()` runs without one when the
 * composer has no thread yet, so project agents are simply absent then.
 */
interface DiscoveryQuery {
  workspace: Workspace | null;
  extraDirs: string[];
  primaryHostId: string;
  home: string;
}

/** Decode a `alia.sdk.files.read` payload, which may be UTF-8 or base64. */
function decodeContent(content: string, contentEncoding: string | undefined): string {
  return contentEncoding === "base64" ? Buffer.from(content, "base64").toString("utf8") : content;
}

/**
 * List `*.md` files directly inside a directory, or [] when it is missing or
 * unreadable. `hosts.directory` is used rather than `files.list` because it
 * resolves symlinked agent directories (the usual `~/.omp/agent/agents ->
 * ../agents` layout) instead of rejecting them.
 */
async function listMarkdownFiles(
  alia: AliaPluginApi,
  hostId: string,
  dir: string,
): Promise<{ directory: string; files: string[] } | null> {
  try {
    const listing = await alia.sdk.hosts.directory({ hostId, path: dir });
    const files = listing.entries
      .filter((entry) => entry.kind === "file" && entry.name.endsWith(".md"))
      .map((entry) => entry.path)
      .sort((left, right) => left.localeCompare(right));
    return { directory: listing.directory, files };
  } catch {
    return null;
  }
}

async function readDefinition(alia: AliaPluginApi, definition: Definition): Promise<OmpAgent | null> {
  try {
    const file = await alia.sdk.files.read({ hostId: definition.hostId, path: definition.path });
    const content = decodeContent(file.content, file.contentEncoding);
    return parseAgentMarkdown(definition.path, content, definition.scope);
  } catch {
    return null;
  }
}

/**
 * The project scope is a walk-up from the workspace, matching how OMP resolves
 * project config: the nearest `.omp/agents` wins and no further ancestor is
 * consulted for it.
 */
async function findProjectAgentsDir(alia: AliaPluginApi, workspace: Workspace): Promise<string | null> {
  const segments = workspace.path.split("/").filter((segment) => segment !== "");
  for (let depth = segments.length; depth >= 1; depth -= 1) {
    const candidate = `/${segments.slice(0, depth).join("/")}/.omp/agents`;
    try {
      const listing = await alia.sdk.hosts.directory({ hostId: workspace.hostId, path: candidate });
      if (listing.entries.length > 0) return listing.directory;
    } catch {
      // Keep walking up: an absent directory is the normal case.
    }
  }
  return null;
}

/**
 * Every agent visible to one workspace: project scope first (it shadows the
 * user scope on a name collision, as OMP does), then user, then the extras
 * configured on the plugin.
 */
async function discoverAgents(alia: AliaPluginApi, query: DiscoveryQuery): Promise<Discovery> {
  const definitions: Definition[] = [];
  const searchedDirs: string[] = [];

  if (query.workspace !== null) {
    const projectDir = await findProjectAgentsDir(alia, query.workspace);
    if (projectDir !== null) {
      searchedDirs.push(projectDir);
      const listing = await listMarkdownFiles(alia, query.workspace.hostId, projectDir);
      for (const path of listing?.files ?? []) {
        definitions.push({ hostId: query.workspace.hostId, path, scope: "project" });
      }
    }
  }

  // User-scope roots resolve on the machine running VesnALIA, which is where the
  // plugin's own OMP configuration lives. A `~`-relative root expands against
  // that machine's home; any other host gets absolute paths only.
  for (const root of userAgentRoots()) {
    const dir = expandHome(root, query.home);
    if (!dir.startsWith("/")) continue;
    searchedDirs.push(dir);
    const listing = await listMarkdownFiles(alia, query.primaryHostId, dir);
    for (const path of listing?.files ?? []) {
      definitions.push({ hostId: query.primaryHostId, path, scope: "user" });
    }
  }

  for (const dir of query.extraDirs) {
    searchedDirs.push(dir);
    const listing = await listMarkdownFiles(alia, query.primaryHostId, dir);
    for (const path of listing?.files ?? []) {
      definitions.push({ hostId: query.primaryHostId, path, scope: "extra" });
    }
  }

  const loaded = (await Promise.all(definitions.map((entry) => readDefinition(alia, entry)))).filter(
    (agent): agent is OmpAgent => agent !== null,
  );
  const byScope = (scope: AgentScope) => loaded.filter((agent) => agent.scope === scope);
  return {
    agents: mergeAgents(byScope("project"), byScope("user"), byScope("extra")),
    searchedDirs: [...new Set(searchedDirs)],
  };
}

/** Parse the multiline `extraAgentDirs` setting into absolute paths. */
function extraDirsFrom(value: string | undefined): string[] {
  return (value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("/"))
    .slice(0, MAX_EXTRA_DIRS);
}

export default async function plugin(alia: AliaPluginApi) {
  alia.log.info("loaded");

  const settings = alia.settings.define({
    extraAgentDirs: {
      type: "string",
      label: "Extra agent directories",
      description:
        "Absolute paths on the machine running VesnALIA, one per line, searched after the project and user scopes — for example a checkout of your agent definitions.",
      experimental_multiline: true,
      default: "",
    },
    maxResults: {
      type: "number",
      label: "Mention results",
      description: "How many agents the @-mention menu lists at once.",
      default: DEFAULT_MENTION_LIMIT,
    },
    providerIds: {
      type: "string",
      label: "Providers that run OMP",
      description:
        "Comma-separated provider ids whose threads can spawn these subagents. Only these surfaces get the @ menu; on any other provider the agents would be unactionable. Defaults to acp-omp.",
      default: DEFAULT_OMP_PROVIDER_IDS,
      // A value naming nothing at all is rejected; one naming an id this server
      // does not have yet is allowed, so a setting written before its provider
      // plugin was installed still saves. The catalog cannot be consulted here:
      // `alia.sdk` is bind-gated, and `providers.list()` waits on provider
      // registrations settling — a gate the host opens only after every plugin
      // has finished loading, which is the factory itself. Awaiting it inside
      // this factory deadlocks until the 30s load timeout fails the plugin.
      experimental_schema: z
        .string()
        .refine((value) => parseProviderIds(value).length > 0, {
          message: "must name at least one provider id (comma-separated)",
        }),
    },
  });

  /**
   * One discovery per workspace, reused across the keystrokes of a search
   * (mention search is time-boxed at 2s) and refreshed after a minute so an
   * edited definition shows up without a plugin reload.
   */
  const discoveries = new Map<string, { at: number; agents: OmpAgent[] }>();

  /**
   * Mention item ids the composer has been given, mapped to the exact
   * definition file they name. The wire mention resource carries only plugin
   * id, item id, and label — no thread and no project — so an id must be
   * enough to resolve the agent the user actually picked.
   *
   * An id is `<name>~<index>`: `~` cannot appear in an agent name, so the name
   * survives a server restart (the cache does not) and still resolves against
   * the user and extra scopes.
   */
  const listed = new Map<string, { hostId: string; path: string; scope: AgentScope }>();
  const tokensByFile = new Map<string, string>();
  const MAX_LISTED = 500;

  function tokenFor(hostId: string, agent: OmpAgent): string {
    const fileKey = `${hostId}\u0000${agent.filePath}`;
    let token = tokensByFile.get(fileKey);
    if (token === undefined) {
      if (tokensByFile.size >= MAX_LISTED) {
        tokensByFile.clear();
        listed.clear();
      }
      token = `${agent.name}~${tokensByFile.size.toString(36)}`;
      tokensByFile.set(fileKey, token);
    }
    listed.set(token, { hostId, path: agent.filePath, scope: agent.scope });
    return token;
  }

  async function resolveQuery(threadId: string | null, projectId: string | null): Promise<DiscoveryQuery> {
    const { primaryHostId } = await alia.sdk.system.config();
    const { extraAgentDirs } = await settings.get();
    const extraDirs = extraDirsFrom(extraAgentDirs);

    let workspace: Workspace | null = null;
    if (threadId !== null) {
      try {
        const thread = await alia.sdk.threads.get({ threadId, include: "environment" });
        const environment = "environment" in thread ? thread.environment : null;
        if (environment !== null && environment !== undefined && environment.path !== null) {
          workspace = { hostId: environment.hostId, path: environment.path };
        }
      } catch {
        // A thread without a live environment falls back to the project source.
      }
    }
    if (workspace === null && projectId !== null) {
      try {
        const project = await alia.sdk.projects.get({ projectId });
        const source = project.sources.find((entry) => entry.isDefault) ?? project.sources[0];
        if (source !== undefined) workspace = { hostId: source.hostId, path: source.path };
      } catch {
        // Project agents stay absent; user and extra scopes still resolve.
      }
    }

    return {
      workspace,
      extraDirs,
      primaryHostId: primaryHostId ?? "",
      // The plugin runs on the VesnALIA server machine, so its own home directory is
      // that machine's home — the same one OMP resolves `~/.omp` against.
      home: homedir(),
    };
  }

  async function agentsFor(query: DiscoveryQuery): Promise<OmpAgent[]> {
    if (query.primaryHostId === "") return [];
    const key = [
      query.primaryHostId,
      query.workspace?.hostId ?? "",
      query.workspace?.path ?? "",
      ...query.extraDirs,
    ].join("\u0000");
    const cached = discoveries.get(key);
    if (cached !== undefined && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.agents;

    const { agents } = await discoverAgents(alia, query);
    discoveries.set(key, { at: Date.now(), agents });
    return agents;
  }

  alia.rpc.register(rpcContract, {
    agents_list: async ({ threadId, projectId }) => {
      const { providerIds } = await settings.get();
      const configuredProviderIds = parseProviderIds(providerIds);
      const [discovery, providerId, providers] = await Promise.all([
        discoverAgents(alia, await resolveQuery(threadId, projectId)),
        surfaceProviderId(alia, threadId),
        // Safe here and not at load time: by the time a client calls this, the
        // server has finished starting plugins and settled provider
        // registrations, so the call resolves instead of waiting on a gate the
        // factory itself would be holding shut.
        alia.sdk.providers.list().catch(() => []),
      ]);
      return {
        ...discovery,
        providerId,
        canSpawn: providerId !== null && configuredProviderIds.includes(providerId),
        knownProviderIds: providers.map((provider) => provider.id),
        configuredProviderIds,
      };
    },
  });

  alia.ui.registerMentionProvider({
    id: MENTION_PROVIDER_ID,
    label: "OMP agents",
    triggers: ["@"],
    async search({ query, projectId, threadId }) {
      const { maxResults, providerIds } = await settings.get();
      // A thread on Claude, Codex, or any non-OMP provider cannot spawn an OMP
      // subagent, so the menu stays empty there instead of offering a mention
      // that would only reach the agent as unactionable text.
      if (!(await canSpawnOmpAgents(alia, threadId, providerIds))) return [];
      const discoveryQuery = await resolveQuery(threadId, projectId);
      const agents = await agentsFor(discoveryQuery);
      const limit = Math.max(1, Math.min(MAX_MENTION_LIMIT, Math.trunc(maxResults)));
      return rankAgents(agents, query)
        .slice(0, limit)
        .map((agent) => ({
          id: tokenFor(discoveryQuery.primaryHostId, agent),
          title: agent.name,
          subtitle: mentionSubtitle(agent),
          icon: "Bot",
        }));
    },
    async resolve(itemId) {
      // Re-read the exact file this item named, so the context describes the
      // definition the user picked even if it changed since the menu opened.
      const target = listed.get(itemId);
      if (target !== undefined) {
        const agent = await readDefinition(alia, {
          hostId: target.hostId,
          path: target.path,
          scope: target.scope,
        });
        if (agent === null) {
          throw new Error(
            `OMP agent definition "${target.path}" is unreadable or invalid — re-pick it from the @ menu.`,
          );
        }
        return { context: renderMentionContext(agent) };
      }

      // The id survives a reload but the cache does not. Fall back to the name
      // it carries, against the scopes that do not depend on a workspace.
      const separator = itemId.lastIndexOf("~");
      const name = separator === -1 ? itemId : itemId.slice(0, separator);
      const agents = await agentsFor(await resolveQuery(null, null));
      const agent = agents.find((candidate) => candidate.name === name);
      if (agent === undefined) {
        throw new Error(
          `OMP agent "${name}" is no longer available — pick it again from the @ menu.`,
        );
      }
      return { context: renderMentionContext(agent) };
    },
  });

  /**
   * The admission checkpoint: refuse a send that carries one of this plugin's
   * mentions into a thread whose provider cannot spawn the agent.
   *
   * `search()` already hides the menu on a known non-OMP thread, but it cannot
   * cover the New thread screen — the composer's mention request carries no
   * provider, so the rows appear there whatever the picker says. This is the
   * only place a resolved `thread.providerId` meets the message's own mention
   * list, so it is where a wrong send can actually be stopped.
   *
   * Idempotent by construction: it reads the thread and the input and decides
   * the same way on every drain, restart, and retry, as the hook contract
   * requires. A user's explicit Send-now on a queued row bypasses the pass by
   * design; `renderMentionContext` is written to stay safe in that case.
   */
  alia.experimental_hooks.on("message.dispatch", async (ctx) => {
    const { providerIds } = await settings.get();
    if (parseProviderIds(providerIds).includes(ctx.thread.providerId)) {
      return { action: "proceed" };
    }

    const mentions = ctx.input.blocks.flatMap((block) =>
      block.type === "text"
        ? block.mentions.filter(
            (mention) =>
              mention.resource.kind === "plugin" && mention.resource.pluginId === alia.pluginId,
          )
        : [],
    );
    const first = mentions[0];
    if (first === undefined || first.resource.kind !== "plugin") return { action: "proceed" };

    // This fires on the New thread screen too, where the composer's own picker
    // decides the provider and `generalSettings.defaultProviderId` does not.
    // So name the fix that is always available: drop the mention, or re-pick
    // the provider in the composer — the picker shows exactly this id.
    const { label } = first.resource;
    return {
      action: "reject",
      message:
        `@${label} is an OMP subagent, and this message would run on "${ctx.thread.providerId}", ` +
        `which cannot spawn it. Remove the mention to send, or switch the composer's ` +
        `provider to ${parseProviderIds(providerIds).join(" or ") || "an OMP provider"} and send again.`,
    };
  });

  alia.cli.register({
    name: "omp-agents",
    summary: "List the OMP task agents visible to a workspace",
    commands: [
      {
        name: "list",
        summary: "List discovered OMP agents",
        usage: "alia omp-agents list [--cwd <path>] [--json]",
      },
    ],
    rendersHelp: false,
    async run(argv, ctx) {
      const usage = "Usage: VesnALIA omp-agents list [--cwd <path>] [--json]";
      if (argv.includes("--help") || argv.includes("-h")) {
        return { exitCode: 0, stdout: usage };
      }
      const json = argv.includes("--json");
      const [command, ...rest] = argv.filter((arg) => arg !== "--json");
      if (command !== undefined && command !== "list") return { exitCode: 1, stderr: usage };

      const cwdIndex = rest.indexOf("--cwd");
      const cwd = cwdIndex === -1 ? (ctx.cwd ?? null) : (rest[cwdIndex + 1] ?? null);
      const query = await resolveQuery(null, null);
      if (query.primaryHostId === "") {
        return { exitCode: 1, stderr: "No primary machine is available." };
      }
      if (cwd !== null) query.workspace = { hostId: query.primaryHostId, path: cwd };

      const { agents, searchedDirs } = await discoverAgents(alia, query);
      if (json) return { exitCode: 0, stdout: JSON.stringify({ agents, searchedDirs }) };
      if (agents.length === 0) {
        return {
          exitCode: 0,
          stdout: `No OMP agents found.\nSearched:\n${searchedDirs.map((dir) => `  ${dir}`).join("\n")}`,
        };
      }
      return {
        exitCode: 0,
        stdout: agents
          .map((agent) => `${agent.name.padEnd(24)} ${agent.scope.padEnd(8)} ${agent.description}`)
          .join("\n"),
      };
    },
  });

  alia.onDispose(() => {
    discoveries.clear();
    listed.clear();
    tokensByFile.clear();
    alia.log.info("disposed");
  });
}
