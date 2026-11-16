// alia-plugin-feature-flags — backend entry.
//
// Sees and manages LaunchDarkly feature flags. The plugin talks to the
// LaunchDarkly REST API with an access token you supply in settings; the
// nav panel (app.tsx) reads and toggles flags over RPC. A toggle publishes a
// realtime signal so every open page refetches.
import { defineRpcContract, type AliaPluginApi } from "@vesnalia/plugin-sdk";
import { z } from "zod";

const environmentSchema = z.object({
  key: z.string(),
  name: z.string(),
  color: z.string().nullable(),
});
export type Environment = z.infer<typeof environmentSchema>;

// A flag's on/off and evaluation status in one environment. A flag is a
// single entity; only this state is per-environment.
const flagStateSchema = z.object({
  on: z.boolean(),
  // new | active | launched | inactive | archived | "".
  status: z.string(),
});
export type FlagState = z.infer<typeof flagStateSchema>;

const flagSchema = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  kind: z.string(),
  tags: z.array(z.string()),
  archived: z.boolean(),
  temporary: z.boolean(),
  creationDate: z.number(),
  maintainerId: z.string().nullable(),
  maintainerName: z.string().nullable(),
  // Keyed by environment key.
  states: z.record(z.string(), flagStateSchema),
});
export type Flag = z.infer<typeof flagSchema>;

const memberSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
});
export type Member = z.infer<typeof memberSchema>;

export const rpcContract = defineRpcContract({
  // Whether a token is set, plus the target project and host — the page shows
  // a setup prompt when this is not configured.
  config: {
    input: z.null(),
    output: z.object({
      configured: z.boolean(),
      projectKey: z.string(),
      baseUrl: z.string(),
      protectedEnvironments: z.array(z.string()),
    }),
  },
  environments: {
    input: z.null(),
    output: z.object({ environments: z.array(environmentSchema) }),
  },
  // The member the access token belongs to, so the page can show "mine".
  me: {
    input: z.null(),
    output: z.object({ member: memberSchema.nullable() }),
  },
  flags: {
    // refresh: true pulls fresh from LaunchDarkly; false serves the cache when
    // present. fetchedAt is the epoch-ms time the cache was last filled.
    input: z.object({ refresh: z.boolean() }),
    output: z.object({
      flags: z.array(flagSchema),
      fetchedAt: z.number(),
    }),
  },
  toggle: {
    input: z.object({
      key: z.string(),
      env: z.string(),
      on: z.boolean(),
    }),
    output: z.object({ key: z.string(), on: z.boolean() }),
  },
  // Flags linked to a thread, resolved to full flag records from the cache.
  thread_flags: {
    input: z.object({ threadId: z.string() }),
    output: z.object({ flags: z.array(flagSchema) }),
  },
  thread_link: {
    input: z.object({ threadId: z.string(), key: z.string() }),
    output: z.object({ keys: z.array(z.string()) }),
  },
  thread_unlink: {
    input: z.object({ threadId: z.string(), key: z.string() }),
    output: z.object({ keys: z.array(z.string()) }),
  },
  // Search the cached flag list (for the link picker), newest matches first.
  search_flags: {
    input: z.object({ query: z.string() }),
    output: z.object({ flags: z.array(flagSchema) }),
  },
});

/** Realtime channels app.tsx listens on. */
const FLAGS_CHANGED = "flags-changed";
const THREAD_LINKS_CHANGED = "thread-links-changed";

export default async function plugin(alia: AliaPluginApi) {
  alia.log.info("loaded");

  const settings = alia.settings.define({
    apiToken: {
      type: "string",
      label: "LaunchDarkly access token",
      secret: true,
    },
    projectKey: {
      type: "string",
      label: "Project key",
      default: "default",
    },
    baseUrl: {
      type: "string",
      label: "API base URL",
      default: "https://app.launchdarkly.com",
    },
    protectedEnvironments: {
      type: "string",
      label: "Protected environments (comma-separated)",
      default: "production",
    },
  });

  // Read settings fresh on each request so a token change takes effect after a
  // reload without stale captures.
  async function config() {
    const { apiToken, projectKey, baseUrl, protectedEnvironments } =
      await settings.get();
    return {
      apiToken: apiToken?.trim() ?? "",
      projectKey: projectKey.trim() || "default",
      baseUrl: (baseUrl.trim() || "https://app.launchdarkly.com").replace(
        /\/+$/,
        "",
      ),
      protectedEnvironments: protectedEnvironments
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    };
  }

  const initial = await config();
  if (initial.apiToken === "") {
    alia.status.needsConfiguration(
      "Set the LaunchDarkly access token with `alia plugin config feature-flags`, then reload.",
    );
  }

  async function ld(
    path: string,
    init?: { method?: string; body?: unknown; semanticPatch?: boolean },
  ): Promise<unknown> {
    const { apiToken, baseUrl } = await config();
    if (apiToken === "") {
      throw new Error(
        "No LaunchDarkly access token set. Configure it in the plugin settings.",
      );
    }
    // HTTP header values must be plain ASCII. A pasted token that carries a
    // smart quote, accented letter, or other hidden character both fails here
    // and would not authenticate — flag it clearly instead of letting fetch
    // throw its cryptic ByteString error.
    const badChar = apiToken.match(/[^\x20-\x7E]/);
    if (badChar) {
      const at = apiToken.indexOf(badChar[0]);
      throw new Error(
        `The access token has an invalid character (code ${badChar[0].codePointAt(0)}) at position ${at}. ` +
          "Re-set it, taking care to paste the raw token with no smart quotes or trailing characters.",
      );
    }
    const headers: Record<string, string> = { Authorization: apiToken };
    if (init?.body !== undefined) {
      headers["Content-Type"] = init.semanticPatch
        ? "application/json; domain-model=launchdarkly.semanticpatch"
        : "application/json";
    }
    const response = await fetch(`${baseUrl}${path}`, {
      method: init?.method ?? "GET",
      headers,
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let detail = text;
      try {
        const parsed = JSON.parse(text) as { message?: string };
        if (parsed.message) detail = parsed.message;
      } catch {
        // keep raw text
      }
      throw new Error(
        `LaunchDarkly request failed (${response.status})${detail ? `: ${detail}` : ""}`,
      );
    }
    if (response.status === 204) return null;
    return response.json();
  }

  async function listEnvironments(): Promise<Environment[]> {
    const { projectKey } = await config();
    const data = (await ld(
      `/api/v2/projects/${encodeURIComponent(projectKey)}/environments?limit=100`,
    )) as { items?: Array<{ key: string; name: string; color?: string }> };
    return (data.items ?? []).map((item) => ({
      key: item.key,
      name: item.name,
      color: item.color ?? null,
    }));
  }

  type RawFlag = {
    key: string;
    name: string;
    description?: string;
    kind: string;
    tags?: string[];
    archived?: boolean;
    temporary?: boolean;
    creationDate?: number;
    maintainerId?: string;
    _maintainer?: {
      _id?: string;
      firstName?: string;
      lastName?: string;
      email?: string;
    };
    environments?: Record<string, { on?: boolean }>;
  };

  // Map flag key -> evaluation status (new | active | launched | inactive)
  // for one environment. The status lives on a separate endpoint; the flag key
  // is the last path segment of each item's self link.
  async function listStatuses(env: string): Promise<Map<string, string>> {
    const { projectKey } = await config();
    const statuses = new Map<string, string>();
    try {
      let path:
        | string
        | undefined = `/api/v2/flag-statuses/${encodeURIComponent(projectKey)}/${encodeURIComponent(env)}`;
      for (let page = 0; path && page < 200; page++) {
        const data = (await ld(path)) as {
          items?: Array<{
            name?: string;
            _links?: { self?: { href?: string } };
          }>;
          _links?: { next?: { href?: string } };
        };
        for (const item of data.items ?? []) {
          const href = item._links?.self?.href;
          const key = href?.split("/").pop();
          if (key && item.name) statuses.set(key, item.name);
        }
        path = data._links?.next?.href;
      }
    } catch (cause) {
      // Status is a nice-to-have facet; a token without access to it should not
      // break the flag list.
      alia.log.warn(`flag statuses unavailable: ${String(cause)}`);
    }
    return statuses;
  }

  // The flags list is paged (LaunchDarkly defaults to 20 per page). Follow the
  // `next` link until every flag is in hand — otherwise a large project only
  // shows its first page and filters miss most flags.
  async function fetchAllFlags(
    archived: boolean,
    envKeys: string[],
  ): Promise<RawFlag[]> {
    const { projectKey } = await config();
    // The list only carries each flag's per-environment `on` state for the
    // environments named with `env` params; without them the environments
    // block is dropped and every flag reads as off.
    const envQuery = envKeys
      .map((key) => `&env=${encodeURIComponent(key)}`)
      .join("");
    let path:
      | string
      | undefined = `/api/v2/flags/${encodeURIComponent(projectKey)}?summary=true&archived=${archived}&limit=50${envQuery}`;
    const items: RawFlag[] = [];
    for (let page = 0; path && page < 200; page++) {
      const data = (await ld(path)) as {
        items?: RawFlag[];
        _links?: { next?: { href?: string } };
      };
      items.push(...(data.items ?? []));
      path = data._links?.next?.href;
    }
    return items;
  }

  async function listFlags(): Promise<Flag[]> {
    const environments = await listEnvironments();
    const envKeys = environments.map((e) => e.key);
    const [live, archived, statusByEnvEntries] = await Promise.all([
      fetchAllFlags(false, envKeys),
      fetchAllFlags(true, envKeys),
      Promise.all(
        environments.map(async (e): Promise<[string, Map<string, string>]> => [
          e.key,
          await listStatuses(e.key),
        ]),
      ),
    ]);
    const statusByEnv = new Map(statusByEnvEntries);

    const toFlag = (item: RawFlag): Flag => {
      const m = item._maintainer;
      const maintainerName = m
        ? [m.firstName, m.lastName].filter(Boolean).join(" ") || m.email || null
        : null;
      const isArchived = item.archived === true;
      const states: Record<string, FlagState> = {};
      for (const e of environments) {
        states[e.key] = {
          on: item.environments?.[e.key]?.on === true,
          status: isArchived
            ? "archived"
            : (statusByEnv.get(e.key)?.get(item.key) ?? ""),
        };
      }
      return {
        key: item.key,
        name: item.name,
        description: item.description ?? "",
        kind: item.kind,
        tags: item.tags ?? [],
        archived: isArchived,
        temporary: item.temporary === true,
        creationDate: item.creationDate ?? 0,
        maintainerId: item.maintainerId ?? m?._id ?? null,
        maintainerName,
        states,
      };
    };

    return [...live, ...archived].map(toFlag);
  }

  async function getMe(): Promise<Member | null> {
    const data = (await ld("/api/v2/members/me")) as {
      _id?: string;
      email?: string;
      firstName?: string;
      lastName?: string;
    };
    if (!data._id) return null;
    const name = [data.firstName, data.lastName].filter(Boolean).join(" ");
    return {
      id: data._id,
      email: data.email ?? "",
      name: name || data.email || data._id,
    };
  }

  async function toggleFlag(
    key: string,
    env: string,
    on: boolean,
  ): Promise<void> {
    const { projectKey } = await config();
    await ld(
      `/api/v2/flags/${encodeURIComponent(projectKey)}/${encodeURIComponent(key)}`,
      {
        method: "PATCH",
        semanticPatch: true,
        body: {
          environmentKey: env,
          instructions: [{ kind: on ? "turnFlagOn" : "turnFlagOff" }],
        },
      },
    );
  }

  // Cached flag list plus the time it was pulled. The page reads this on open
  // and only hits LaunchDarkly when asked to refresh.
  const CACHE_KEY = "flags-cache";
  type FlagsCache = { flags: Flag[]; fetchedAt: number };
  async function readCache(): Promise<FlagsCache | null> {
    return (await alia.storage.kv.get<FlagsCache>(CACHE_KEY)) ?? null;
  }
  async function writeCache(flags: Flag[], fetchedAt: number): Promise<void> {
    await alia.storage.kv.set(CACHE_KEY, { flags, fetchedAt });
  }
  // Cached flags, pulling once if the cache is cold. Returns [] when no token
  // is set so thread surfaces render empty rather than erroring.
  async function getCachedFlags(): Promise<Flag[]> {
    const { apiToken } = await config();
    if (apiToken === "") return [];
    const cached = await readCache();
    if (cached) return cached.flags;
    const flags = await listFlags();
    await writeCache(flags, Date.now());
    return flags;
  }

  // Per-thread links: an array of flag keys stored under the thread id.
  const threadKey = (threadId: string) => `thread:${threadId}`;
  async function readLinks(threadId: string): Promise<string[]> {
    return (await alia.storage.kv.get<string[]>(threadKey(threadId))) ?? [];
  }
  async function writeLinks(threadId: string, keys: string[]): Promise<void> {
    await alia.storage.kv.set(threadKey(threadId), keys);
    alia.realtime.publish(THREAD_LINKS_CHANGED, { threadId });
  }

  // Toggle a flag, then update the cached copy in place and signal listeners so
  // every surface reflects the change without a full pull. Shared by the RPC
  // and the CLI.
  async function applyToggle(
    key: string,
    env: string,
    on: boolean,
  ): Promise<void> {
    await toggleFlag(key, env, on);
    const cached = await readCache();
    if (cached) {
      const flags = cached.flags.map((f) =>
        f.key === key && f.states[env]
          ? { ...f, states: { ...f.states, [env]: { ...f.states[env], on } } }
          : f,
      );
      await writeCache(flags, cached.fetchedAt);
    }
    alia.realtime.publish(FLAGS_CHANGED, { key, env, on });
  }

  alia.rpc.register(rpcContract, {
    config: async () => {
      const { apiToken, projectKey, baseUrl, protectedEnvironments } =
        await config();
      return {
        configured: apiToken !== "",
        projectKey,
        baseUrl,
        protectedEnvironments,
      };
    },
    environments: async () => ({ environments: await listEnvironments() }),
    me: async () => ({ member: await getMe() }),
    flags: async ({ refresh }) => {
      if (!refresh) {
        const cached = await readCache();
        if (cached)
          return { flags: cached.flags, fetchedAt: cached.fetchedAt };
      }
      const flags = await listFlags();
      const fetchedAt = Date.now();
      await writeCache(flags, fetchedAt);
      return { flags, fetchedAt };
    },
    toggle: async ({ key, env, on }) => {
      await applyToggle(key, env, on);
      return { key, on };
    },
    thread_flags: async ({ threadId }) => {
      const keys = await readLinks(threadId);
      if (keys.length === 0) return { flags: [] };
      const byKey = new Map((await getCachedFlags()).map((f) => [f.key, f]));
      return {
        flags: keys
          .map((key) => byKey.get(key))
          .filter((f): f is Flag => f !== undefined),
      };
    },
    thread_link: async ({ threadId, key }) => {
      const keys = await readLinks(threadId);
      if (!keys.includes(key)) keys.push(key);
      await writeLinks(threadId, keys);
      return { keys };
    },
    thread_unlink: async ({ threadId, key }) => {
      const keys = (await readLinks(threadId)).filter((k) => k !== key);
      await writeLinks(threadId, keys);
      return { keys };
    },
    search_flags: async ({ query }) => {
      const q = query.trim().toLowerCase();
      if (q === "") return { flags: [] };
      const flags = (await getCachedFlags())
        .filter(
          (f) =>
            !f.archived &&
            (f.name.toLowerCase().includes(q) ||
              f.key.toLowerCase().includes(q) ||
              f.tags.some((t) => t.toLowerCase().includes(q))),
        )
        .sort((a, b) => b.creationDate - a.creationDate)
        .slice(0, 10);
      return { flags };
    },
  });

  // ── CLI: `alia feature-flags …` ──────────────────────────────────────────────
  // Same backend as the UI, for the shell and for agents working in threads.
  const usage = [
    "Usage:",
    "  VesnALIA feature-flags list [--env <env>] [--mine] [--json]",
    "  VesnALIA feature-flags status <flag-key> [--json]",
    "  VesnALIA feature-flags on <flag-key> --env <env> [--yes] [--json]",
    "  VesnALIA feature-flags off <flag-key> --env <env> [--yes] [--json]",
    "  VesnALIA feature-flags open <flag-key>",
    "  VesnALIA feature-flags link <flag-key>      # attach to the current thread",
    "  VesnALIA feature-flags unlink <flag-key>    # detach from the current thread",
    "  VesnALIA feature-flags linked [--json]      # flags attached to this thread",
    "",
    "Toggling a protected environment (see settings) needs --yes.",
  ].join("\n");

  function parseArgs(argv: string[]) {
    const positional: string[] = [];
    const opts: { json: boolean; mine: boolean; yes: boolean; env?: string } = {
      json: false,
      mine: false,
      yes: false,
    };
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === "--json") opts.json = true;
      else if (arg === "--mine") opts.mine = true;
      else if (arg === "--yes" || arg === "-y") opts.yes = true;
      else if (arg === "--env") opts.env = argv[++i];
      else if (arg.startsWith("--env=")) opts.env = arg.slice("--env=".length);
      else positional.push(arg);
    }
    return { positional, opts };
  }

  const stateGlyph = (on: boolean) => (on ? "on " : "off");

  alia.cli.register({
    name: "feature-flags",
    summary: "List and toggle LaunchDarkly feature flags",
    commands: [
      {
        name: "list",
        summary: "List flags with their per-environment state",
        usage: "alia feature-flags list [--env <env>] [--mine] [--json]",
      },
      {
        name: "status",
        summary: "Show one flag's state across environments",
        usage: "alia feature-flags status <flag-key> [--json]",
      },
      {
        name: "on",
        summary: "Turn a flag on in an environment",
        usage: "alia feature-flags on <flag-key> --env <env> [--yes]",
      },
      {
        name: "off",
        summary: "Turn a flag off in an environment",
        usage: "alia feature-flags off <flag-key> --env <env> [--yes]",
      },
      {
        name: "open",
        summary: "Print the LaunchDarkly URL for a flag",
        usage: "alia feature-flags open <flag-key>",
      },
      {
        name: "link",
        summary: "Attach a flag to the current thread",
        usage: "alia feature-flags link <flag-key>",
      },
      {
        name: "unlink",
        summary: "Detach a flag from the current thread",
        usage: "alia feature-flags unlink <flag-key>",
      },
      {
        name: "linked",
        summary: "List flags attached to the current thread",
        usage: "alia feature-flags linked [--json]",
      },
    ],
    async run(argv, ctx) {
      const { positional, opts } = parseArgs(argv);
      const [command, arg1] = positional;
      const { apiToken, projectKey, baseUrl, protectedEnvironments } =
        await config();
      if (apiToken === "") {
        return {
          exitCode: 1,
          stderr:
            "No LaunchDarkly access token set. Run `alia plugin config feature-flags set apiToken <token>` and reload.",
        };
      }

      const findFlag = async (key: string) =>
        (await getCachedFlags()).find((f) => f.key === key) ?? null;

      switch (command) {
        case undefined:
        case "help":
        case "--help":
          return { exitCode: 0, stdout: usage };

        case "list": {
          let flags = (await getCachedFlags()).filter((f) => !f.archived);
          if (opts.mine) {
            const me = await getMe();
            flags = flags.filter((f) => me && f.maintainerId === me.id);
          }
          const envs = (await listEnvironments()).filter(
            (e) => opts.env === undefined || e.key === opts.env,
          );
          if (opts.json) {
            const rows = flags.map((f) => ({
              key: f.key,
              name: f.name,
              states: Object.fromEntries(
                envs.map((e) => [e.key, f.states[e.key]?.on === true]),
              ),
            }));
            return { exitCode: 0, stdout: JSON.stringify(rows, null, 2) };
          }
          if (flags.length === 0)
            return { exitCode: 0, stdout: "No flags." };
          const lines = flags.map((f) => {
            const states = envs
              .map((e) => `${e.key}:${stateGlyph(f.states[e.key]?.on === true)}`)
              .join("  ");
            return `${f.key}\n  ${states}`;
          });
          return { exitCode: 0, stdout: lines.join("\n") };
        }

        case "status": {
          if (!arg1) return { exitCode: 1, stderr: usage };
          const flag = await findFlag(arg1);
          if (!flag)
            return { exitCode: 1, stderr: `No flag with key ${arg1}.` };
          if (opts.json)
            return { exitCode: 0, stdout: JSON.stringify(flag, null, 2) };
          const lines = Object.entries(flag.states).map(
            ([env, s]) => `  ${env}: ${stateGlyph(s.on)}${s.status ? `  (${s.status})` : ""}`,
          );
          return {
            exitCode: 0,
            stdout: `${flag.name} (${flag.key})\n${lines.join("\n")}`,
          };
        }

        case "on":
        case "off": {
          const on = command === "on";
          if (!arg1 || !opts.env)
            return {
              exitCode: 1,
              stderr: `Need a flag key and --env. e.g. VesnALIA feature-flags ${command} ${arg1 ?? "<flag-key>"} --env staging`,
            };
          if (protectedEnvironments.includes(opts.env) && !opts.yes) {
            return {
              exitCode: 1,
              stderr: `${opts.env} is a protected environment. Re-run with --yes to change it.`,
            };
          }
          try {
            await applyToggle(arg1, opts.env, on);
          } catch (cause) {
            return { exitCode: 1, stderr: String(cause) };
          }
          const result = { key: arg1, env: opts.env, on };
          return {
            exitCode: 0,
            stdout: opts.json
              ? JSON.stringify(result)
              : `${arg1} is now ${on ? "on" : "off"} in ${opts.env}.`,
          };
        }

        case "open": {
          if (!arg1) return { exitCode: 1, stderr: usage };
          const url = `${baseUrl}/projects/${encodeURIComponent(projectKey)}/flags/${encodeURIComponent(arg1)}/`;
          return { exitCode: 0, stdout: url };
        }

        case "link":
        case "unlink": {
          if (!arg1) return { exitCode: 1, stderr: usage };
          if (!ctx.threadId)
            return {
              exitCode: 1,
              stderr:
                "No thread in context. Run this from within a thread to link a flag.",
            };
          if (command === "link" && !(await findFlag(arg1)))
            return { exitCode: 1, stderr: `No flag with key ${arg1}.` };
          const current = await readLinks(ctx.threadId);
          const next =
            command === "link"
              ? current.includes(arg1)
                ? current
                : [...current, arg1]
              : current.filter((k) => k !== arg1);
          await writeLinks(ctx.threadId, next);
          const verb = command === "link" ? "Linked" : "Unlinked";
          const prep = command === "link" ? "to" : "from";
          return {
            exitCode: 0,
            stdout: opts.json
              ? JSON.stringify({ threadId: ctx.threadId, keys: next })
              : `${verb} ${arg1} ${prep} this thread. (${next.length} linked)`,
          };
        }

        case "linked": {
          if (!ctx.threadId)
            return {
              exitCode: 1,
              stderr: "No thread in context. Run this from within a thread.",
            };
          const keys = await readLinks(ctx.threadId);
          if (opts.json) {
            const byKey = new Map(
              (await getCachedFlags()).map((f) => [f.key, f]),
            );
            return {
              exitCode: 0,
              stdout: JSON.stringify(
                keys.map((k) => byKey.get(k) ?? { key: k }),
                null,
                2,
              ),
            };
          }
          return {
            exitCode: 0,
            stdout:
              keys.length === 0
                ? "No flags linked to this thread."
                : keys.join("\n"),
          };
        }
      }
      return { exitCode: 1, stderr: usage };
    },
  });

  alia.onDispose(() => {
    alia.log.info("disposed");
  });
}
