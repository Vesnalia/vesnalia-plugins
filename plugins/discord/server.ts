// alia-plugin-discord — drive VesnALIA agent threads from a paired Discord server.

import { createHash } from "node:crypto";
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import {
  ActiveThreadWatcher,
  detachUnavailableSession,
  discordInteractionSenderThreadId,
  discordQuestionControl,
  discordSessionName,
  InteractionAnnouncementGuard,
  isAllowedSpawnLocation,
  isDiscordAgentConversation,
  normalizeOptionalDiscordSnowflake,
  parseDiscordIds,
  prepareDiscordSession,
  pendingInteractionPrompt,
  rehydrateActiveThreadWatches,
  resolveDiscordInteractionOwner,
  routeDiscordMessage,
  routeCreatesSession,
  resolveApprovalDecision,
  resolveInteractionReply,
  resolveQuestionSelection,
  shouldAlertHomeForFailure,
  type PendingInteractionLike,
} from "./bridge.js";
import {
  DiscordClient,
  isUnavailableDiscordChannelError,
  type DiscordApprovalActionResult,
  type DiscordInboundApprovalAction,
  type DiscordInboundMessage,
  type DiscordInboundQuestionAction,
  type DiscordQuestionActionResult,
} from "./discord.js";
import {
  classifyDiscordError,
  clearStoredPairingState,
  formatPairingCode,
  generatePairingCode,
  inviteUrlFromToken,
  isActiveMappedGuild,
  pairingFailureMessage,
  parsePairCommand,
  resolveSpawnPermissionMode,
  retryDelayMs,
  verifyPairingCode,
  type DiscordAccessLevel,
  type PendingPairingCode,
} from "./pairing.js";
import {
  availableToolNames,
  DISCORD_BRIDGE_AGENT_INSTRUCTIONS,
  registerDiscordTools,
} from "./tools.js";
import { ReplyOutbox, resolveReplyOutputId } from "./delivery.js";
import { migrations } from "./migrations.js";
import {
  discordRpcContract,
  type DiscordConfigurationStatus,
  type DiscordExecutionStatus,
  type DiscordPairingStatus,
} from "./contract.js";
import { buildPairingStatus, pairingCommand } from "./pairing-status.js";
import {
  accessLevelLabel,
  authorizedUsers,
  botDisplayName,
  botSentenceName,
  channelLabel,
  destructiveActionsState,
  effectiveHomeChannel,
  maskBotToken,
  permissionModeLabel,
} from "./config-view.js";
import {
  buildExecutionView,
  readExecutionSelection,
  resolveExecution,
  validateSelectionRequest,
  type ExecutionResolution,
  type MachineCatalog,
  type MachineInfo,
  type ProjectExecutionDefaults,
  type ProjectInfo,
  type ReasoningLevel,
  type ServiceTier,
} from "./execution.js";

const MAX_PROMPT_CHARS = 8000;
const MAX_INTERACTION_PROMPT_CHARS = 1800;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const ACTIVE_THREAD_WATCH_INTERVAL_MS = 5000;
const PAIRING_REALTIME_CHANNEL = "pairing-state";

interface ThreadMapRow {
  discord_channel_id: string;
  discord_thread_id: string;
  discord_parent_channel_id: string | null;
  guild_id: string;
  alia_thread_id: string;
  alia_project_id: string | null;
  title: string | null;
  created_at: number;
  last_activity_at: number;
}

interface PairingRow {
  id: number;
  guild_id: string;
  guild_name: string | null;
  channel_id: string;
  channel_name: string | null;
  user_id: string;
  user_tag: string | null;
  paired_at: number;
}

interface InteractionActionRow {
  token: string;
  alia_thread_id: string;
  interaction_id: string;
  discord_channel_id: string;
  discord_message_id: string | null;
  status: string;
}

interface InteractionRouteRow {
  alia_thread_id: string;
  owner_alia_thread_id: string;
  created_at: number;
  last_activity_at: number;
}

interface DiscordConfigRow {
  permission_mode: string;
  server_access: string;
  allow_destructive: number;
  default_project_id: string | null;
  machine_host_id: string | null;
  provider_id: string | null;
  model: string | null;
  reasoning_level: string | null;
  service_tier: string | null;
  spawn_channel_id: string | null;
  home_channel_id: string | null;
}

interface DiscordConfigValues {
  permissionMode: string;
  serverAccess: DiscordAccessLevel;
  allowDestructiveServerActions: boolean;
  defaultProjectId?: string;
  machineHostId?: string;
  providerId?: string;
  model?: string;
  reasoningLevel?: ReasoningLevel;
  serviceTier?: ServiceTier;
  spawnChannelId?: string;
  homeChannelId?: string;
}

interface RuntimeValues extends DiscordConfigValues {
  botToken?: string;
}

export default async function plugin(alia: AliaPluginApi) {
  const db = alia.storage.database();
  alia.storage.migrate(db, migrations);

  const writeConfig = (values: DiscordConfigValues): void => {
    db.prepare(
      `INSERT INTO discord_config (
        id, permission_mode, server_access, allow_destructive,
        default_project_id, machine_host_id, provider_id, model, reasoning_level, service_tier,
        spawn_channel_id, home_channel_id
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        permission_mode = excluded.permission_mode,
        server_access = excluded.server_access,
        allow_destructive = excluded.allow_destructive,
        default_project_id = excluded.default_project_id,
        machine_host_id = excluded.machine_host_id,
        provider_id = excluded.provider_id,
        model = excluded.model,
        reasoning_level = excluded.reasoning_level,
        service_tier = excluded.service_tier,
        spawn_channel_id = excluded.spawn_channel_id,
        home_channel_id = excluded.home_channel_id`,
    ).run(
      values.permissionMode,
      values.serverAccess,
      values.allowDestructiveServerActions ? 1 : 0,
      values.defaultProjectId ?? null,
      values.machineHostId ?? null,
      values.providerId ?? null,
      values.model ?? null,
      values.reasoningLevel ?? null,
      values.serviceTier ?? null,
      values.spawnChannelId ?? null,
      values.homeChannelId ?? null,
    );
  };

  const readConfig = (): DiscordConfigValues => {
    const row = db.prepare("SELECT * FROM discord_config WHERE id = 1").get() as
      | DiscordConfigRow
      | undefined;
    if (!row) {
      const initial: DiscordConfigValues = {
        permissionMode: "machine-default",
        serverAccess: "messages",
        allowDestructiveServerActions: false,
      };
      writeConfig(initial);
      return initial;
    }
    const optional = (value: string | null): string | undefined =>
      value?.trim() ? value.trim() : undefined;
    return {
      permissionMode: row.permission_mode || "machine-default",
      serverAccess: row.server_access === "full" ? "full" : "messages",
      allowDestructiveServerActions: row.allow_destructive === 1,
      defaultProjectId: optional(row.default_project_id),
      machineHostId: optional(row.machine_host_id),
      providerId: optional(row.provider_id),
      model: optional(row.model),
      reasoningLevel: optional(row.reasoning_level) as ReasoningLevel | undefined,
      serviceTier: optional(row.service_tier) as ServiceTier | undefined,
      spawnChannelId: optional(row.spawn_channel_id),
      homeChannelId: optional(row.home_channel_id),
    };
  };

  // The host-rendered form intentionally contains one thing: the secret. All
  // non-secret preferences live in the connected-state UI below.
  const settings = alia.settings.define({
    botToken: {
      type: "string",
      secret: true,
      label: "Discord bot token",
      description:
        "Paste your Discord bot token to connect for the first time or replace the current token. VesnALIA stores it securely and verifies it before continuing.",
    },
  });

  const secretValues = await settings.get();
  let cached: RuntimeValues = { ...readConfig(), botToken: secretValues.botToken };
  const updateConfig = (patch: Partial<DiscordConfigValues>): void => {
    cached = { ...cached, ...patch };
    writeConfig(cached);
    executionCache = null;
    publishPairingState("settings-changed");
  };
  let client: DiscordClient | null = null;
  let pendingCode: PendingPairingCode | null = null;
  let botTag: string | null = null;
  let gatewayState: DiscordPairingStatus["gateway"]["state"] = "disconnected";
  let gatewayMessage: string | null = null;

  // Discord copy speaks as the bot the operator invited. Before the gateway
  // identifies it these fall back to a neutral placeholder rather than a
  // hardcoded product name that is not what anyone sees in the member list.
  const botName = (): string => botDisplayName(botTag);
  const botName_ = (): string => botSentenceName(botTag);

  const publishPairingState = (reason: string): void => {
    alia.realtime.publish(PAIRING_REALTIME_CHANNEL, { reason });
  };

  const setGatewayState = (
    state: DiscordPairingStatus["gateway"]["state"],
    message: string | null,
    reason: string,
  ): void => {
    gatewayState = state;
    gatewayMessage = message;
    publishPairingState(reason);
  };

  // Waiters are released on abort, on a bot-token change, or on a timeout, so
  // the gateway can reconnect without `alia plugin reload discord`.
  const waiters = new Set<() => void>();
  const wakeAll = (): void => {
    for (const wake of [...waiters]) wake();
  };

  const waitForWake = (signal: AbortSignal, ms?: number): Promise<void> =>
    new Promise<void>((resolve) => {
      if (signal.aborted) return resolve();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = (): void => {
        if (timer) clearTimeout(timer);
        waiters.delete(done);
        signal.removeEventListener("abort", done);
        resolve();
      };
      waiters.add(done);
      signal.addEventListener("abort", done, { once: true });
      if (ms !== undefined) timer = setTimeout(done, ms);
    });

  settings.onChange((next, prev) => {
    cached = { ...cached, botToken: next.botToken };
    executionCache = null;
    publishPairingState("settings-changed");
    if (next.botToken !== prev.botToken) {
      // Only the token requires a new gateway connection; everything else is
      // read per message.
      setGatewayState(
        next.botToken ? "connecting" : "disconnected",
        null,
        "gateway-configuration-changed",
      );
      wakeAll();
    }
  });

  // ---------------------------------------------------------------------
  // Pairing state
  // ---------------------------------------------------------------------

  const getPairing = (): PairingRow | undefined =>
    db.prepare("SELECT * FROM discord_pairing WHERE id = 1").get() as
      | PairingRow
      | undefined;

  const savePairing = (row: Omit<PairingRow, "id">): void => {
    db.prepare(
      `INSERT INTO discord_pairing
        (id, guild_id, guild_name, channel_id, channel_name, user_id, user_tag, paired_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         guild_id = excluded.guild_id,
         guild_name = excluded.guild_name,
         channel_id = excluded.channel_id,
         channel_name = excluded.channel_name,
         user_id = excluded.user_id,
         user_tag = excluded.user_tag,
         paired_at = excluded.paired_at`,
    ).run(
      row.guild_id,
      row.guild_name,
      row.channel_id,
      row.channel_name,
      row.user_id,
      row.user_tag,
      row.paired_at,
    );
    publishPairingState("paired");
  };

  const clearPairing = (): void => {
    clearStoredPairingState(db);
    publishPairingState("unpaired");
  };

  const extraAllowedUsers = (): string[] =>
    (
      db.prepare("SELECT user_id FROM discord_allowed_users").all() as Array<{
        user_id: string;
      }>
    ).map((row) => row.user_id);

  /** Pairing is the only way a guild becomes authorized. */
  const effectiveGuildId = (): string | null => getPairing()?.guild_id ?? null;

  const effectiveAllowedUsers = (): string[] => {
    const pairing = getPairing();
    const ids = new Set<string>(extraAllowedUsers());
    if (pairing) ids.add(pairing.user_id);
    return [...ids];
  };

  const isPaired = (): boolean => effectiveGuildId() !== null;

  const isAuthorized = (guildId: string, authorId: string): boolean => {
    const allowedGuild = effectiveGuildId();
    if (!allowedGuild || guildId !== allowedGuild) return false;
    return effectiveAllowedUsers().includes(authorId);
  };

  const isPairingCandidate = (content: string): boolean =>
    !isPaired() && parsePairCommand(content) !== null;

  const ensurePairingCode = (): PendingPairingCode => {
    if (!pendingCode || pendingCode.expiresAt <= Date.now()) {
      pendingCode = generatePairingCode();
      publishPairingState("pairing-code-created");
    }
    return pendingCode;
  };

  // ---------------------------------------------------------------------
  // Execution selection (project + machine + model)
  // ---------------------------------------------------------------------

  interface ExecutionContext {
    project: ProjectInfo | null;
    projects: ProjectInfo[] | null;
    projectError: string | null;
    machines: MachineInfo[] | null;
    machine: MachineInfo | null;
    /** VesnALIA's own fallback machine, used when the project names no default. */
    primaryHostId: string | null;
    catalog: MachineCatalog | null;
    defaults: ProjectExecutionDefaults | null;
  }

  // The panel refreshes on every realtime pairing signal, and three SDK round
  // trips per refresh is wasteful for state that changes on the order of
  // minutes. Stale entries are never used for a spawn — `spawnAliaThread` always
  // reloads.
  const EXECUTION_CACHE_MS = 15_000;
  let executionCache: { at: number; value: ExecutionContext } | null = null;

  const listMachines = async (): Promise<MachineInfo[] | null> => {
    try {
      const hosts = await alia.sdk.hosts.list();
      return hosts.map((host) => ({
        id: host.id,
        name: host.name,
        status: host.status,
        maxPermissionMode: host.maxPermissionMode,
      }));
    } catch (error) {
      alia.log.warn(`Could not list VesnALIA machines: ${errorMessage(error)}`);
      return null;
    }
  };

  /**
   * The personal project has no checkout, so it names no default machine —
   * VesnALIA falls back to the primary host. The panel needs that id to name its
   * automatic option instead of listing the same machine twice.
   */
  const readPrimaryHostId = async (): Promise<string | null> => {
    try {
      return (await alia.sdk.system.config()).primaryHostId;
    } catch (error) {
      alia.log.warn(`Could not read the primary VesnALIA machine: ${errorMessage(error)}`);
      return null;
    }
  };

  /**
   * The unconfigured fallback is the personal project, never "the first
   * project on the list" — that would let an arbitrary repository be driven
   * from Discord the moment someone cleared the setting.
   */
  const loadProject = async (
    configuredProjectId: string | null,
  ): Promise<{
    project: ProjectInfo | null;
    projects: ProjectInfo[] | null;
    error: string | null;
  }> => {
    try {
      const projectRows = await alia.sdk.projects.list({ includePersonal: true });
      const projects = projectRows.map((project) => ({
        id: project.id,
        name: project.name,
        kind: project.kind,
        hostIds: [...new Set(project.sources.map((source) => source.hostId))],
        defaultHostId: project.sources.find((source) => source.isDefault)?.hostId ?? null,
      }));
      const chosen = configuredProjectId
        ? projects.find((project) => project.id === configuredProjectId)
        : projects.find((project) => project.kind === "personal");
      if (!chosen) {
        return {
          project: null,
          projects,
          error: configuredProjectId
            ? `Project \`${configuredProjectId}\` no longer exists. Pick a different project in Settings → Extensions → Plugins → Discord in VesnALIA.`
            : "No personal VesnALIA project is available. Pick a project in Settings → Extensions → Plugins → Discord in VesnALIA.",
        };
      }
      return {
        project: chosen,
        projects,
        error: null,
      };
    } catch (error) {
      return {
        project: null,
        projects: null,
        error: `Could not read VesnALIA projects: ${errorMessage(error)}`,
      };
    }
  };

  const loadCatalog = async (
    hostId: string | null,
    providerId?: string | null,
  ): Promise<MachineCatalog | null> => {
    try {
      const catalog = hostId
        ? await alia.sdk.providers.models({
            hostId,
            ...(providerId ? { providerId } : {}),
          })
        : providerId
          ? await alia.sdk.providers.models({ providerId })
          : await alia.sdk.providers.models();
      return {
        providers: catalog.providers.map((provider) => ({
          id: provider.id,
          displayName: provider.displayName,
          available: provider.available,
          serviceTiers: provider.capabilities.supportsServiceTier
            ? (provider.serviceTiers?.map((tier) => tier.id).filter((tier): tier is ServiceTier => tier === "default" || tier === "fast") ?? ["default", "fast"])
            : [],
        })),
        models: catalog.models.map((model) => ({
          model: model.model,
          displayName: model.displayName,
          isDefault: model.isDefault,
          defaultReasoningEffort: model.defaultReasoningEffort,
          supportedReasoningEfforts: model.supportedReasoningEfforts.map((entry) => entry.reasoningEffort),
          routeProviderId: model.routeProviderId,
        })),
        permissionCeiling: catalog.permissionCeiling,
        loadError: catalog.modelLoadError
          ? {
              providerId: catalog.modelLoadError.providerId,
              code: catalog.modelLoadError.code,
            }
          : null,
      };
    } catch (error) {
      alia.log.warn(
        `Could not read the model catalog${hostId ? ` for machine ${hostId}` : ""}: ${errorMessage(error)}`,
      );
      return null;
    }
  };

  const loadExecutionContext = async (
    values: RuntimeValues,
  ): Promise<ExecutionContext> => {
    const selection = readExecutionSelection(values);
    const [{ project, projects, error: projectError }, machines, primaryHostId] = await Promise.all([
      loadProject(selection.projectId),
      listMachines(),
      readPrimaryHostId(),
    ]);
    const effectiveHostId = selection.hostId ?? project?.defaultHostId ?? null;
    const machine =
      effectiveHostId && machines
        ? machines.find((entry) => entry.id === effectiveHostId) ?? null
        : null;
    let defaults: ProjectExecutionDefaults | null = null;
    if (project) {
      try {
        defaults = await alia.sdk.projects.defaultExecutionOptions({
          projectId: project.id,
        });
      } catch (error) {
        alia.log.warn(
          `Could not read execution defaults for project ${project.id}: ${errorMessage(error)}`,
        );
      }
    }
    // Model catalogs are provider-scoped. Without the provider id, VesnALIA returns
    // the routed default provider's models, which made a valid OpenCode/Grok
    // selection look absent when this plugin validated it.
    const catalog = await loadCatalog(
      effectiveHostId,
      selection.providerId ?? defaults?.providerId,
    );
    return { project, projects, projectError, machines, machine, primaryHostId, catalog, defaults };
  };

  const executionContext = async (
    values: RuntimeValues,
  ): Promise<ExecutionContext> => {
    if (executionCache && Date.now() - executionCache.at < EXECUTION_CACHE_MS) {
      return executionCache.value;
    }
    const value = await loadExecutionContext(values);
    executionCache = { at: Date.now(), value };
    return value;
  };

  const resolveExecutionFor = (
    values: RuntimeValues,
    context: ExecutionContext,
  ): ExecutionResolution | null => {
    if (!context.project || !context.defaults) return null;
    return resolveExecution({
      selection: readExecutionSelection(values),
      project: context.project,
      defaults: context.defaults,
      permissionMode: resolveSpawnPermissionMode(
        values.permissionMode,
        context.defaults.permissionMode,
        context.catalog?.permissionCeiling ?? context.machine?.maxPermissionMode,
      ),
      machine: context.machine,
      catalog: context.catalog,
    });
  };

  /**
   * The picker only offers combinations that would actually resolve: a model
   * whose provider is signed out on that machine is not a choice, it is a
   * future error.
   */
  const catalogModelOptions = (
    context: ExecutionContext,
    selectedProviderId: string | null,
  ): DiscordExecutionStatus["models"] => {
    const catalog = context.catalog;
    if (!catalog) return [];
    // Provider-scoped catalog responses do not need routeProviderId on every
    // model, so fall back to the provider used to request this catalog before
    // falling back to the project's provider.
    const fallbackProviderId = selectedProviderId ?? context.defaults?.providerId ?? "";
    return catalog.models.flatMap((model) => {
      const providerId = model.routeProviderId ?? fallbackProviderId;
      const provider = catalog.providers.find((entry) => entry.id === providerId);
      if (!provider || !provider.available) return [];
      return [
        {
          providerId,
          providerDisplayName: provider.displayName,
          model: model.model,
          displayName: model.displayName,
          isDefault: model.isDefault,
          defaultReasoningLevel: model.defaultReasoningEffort,
        },
      ];
    });
  };

  const executionStatus = async (): Promise<DiscordExecutionStatus> => {
    const context = await executionContext(cached);
    const selection = readExecutionSelection(cached);
    const resolution = resolveExecutionFor(cached, context);
    const extraWarnings = [
      context.projectError,
      !context.defaults && context.project
        ? `Project "${context.project.name}" has no execution defaults yet. Open it once in VesnALIA and pick a provider and model.`
        : null,
      selection.hostId && !context.machines
        ? "The machine list is unavailable right now, so the pinned machine could not be checked."
        : null,
    ].filter((entry): entry is string => entry !== null);

    const view = buildExecutionView({
      selection,
      project: context.project,
      machine: context.machine,
      defaults: context.defaults,
      resolution,
      warnings: extraWarnings,
    });

    return {
      project: view.project,
      machine: view.machine,
      model: view.model,
      resolvedProviderId: resolution?.ok
        ? resolution.plan.providerId
        : selection.providerId ?? context.defaults?.providerId ?? null,
      resolvedReasoningLevel: resolution?.ok
        ? resolution.plan.reasoningLevel
        : selection.reasoningLevel ?? context.defaults?.reasoningLevel ?? null,
      resolvedServiceTier: context.catalog?.providers.find(
        (provider) => provider.id === (resolution?.ok ? resolution.plan.providerId : selection.providerId ?? context.defaults?.providerId),
      )?.serviceTiers.length
        ? (resolution?.ok ? resolution.plan.serviceTier : selection.serviceTier ?? context.defaults?.serviceTier ?? null)
        : null,
      summary: view.summary,
      issues: view.issues,
      projects: (context.projects ?? []).map((project) => ({
        id: project.id,
        name: project.name,
        kind: project.kind,
        hostIds: project.hostIds,
        defaultHostId: project.defaultHostId,
      })),
      machines: (context.machines ?? []).map((machine) => ({
        id: machine.id,
        name: machine.name,
        status: machine.status,
      })),
      primaryHostId: context.primaryHostId,
      models: catalogModelOptions(context, selection.providerId),
      catalogUnavailable: context.catalog === null,
    };
  };

  const configurationStatus = (): DiscordConfigurationStatus => {
    const pairing = getPairing();
    const pairingView = pairing
      ? {
          channelId: pairing.channel_id,
          channelName: pairing.channel_name,
          userId: pairing.user_id,
          userTag: pairing.user_tag,
        }
      : null;
    const token = maskBotToken(cached.botToken);
    const home = effectiveHomeChannel(cached.homeChannelId, pairingView);
    const spawn = effectiveHomeChannel(cached.spawnChannelId, null);
    const guildId = getPairing()?.guild_id ?? null;
    const level = accessLevel();

    return {
      botToken: {
        configured: token !== null,
        masked: token?.masked ?? null,
      },
      permissionMode: {
        value: cached.permissionMode ?? "machine-default",
        label: permissionModeLabel(cached.permissionMode),
      },
      serverAccess: { value: level, label: accessLevelLabel(level) },
      destructiveActions: destructiveActionsState(
        level,
        cached.allowDestructiveServerActions === true,
      ),
      homeChannel: { ...home, label: channelLabel(home) },
      newConversationChannel: {
        ...spawn,
        label: spawn.id ? channelLabel(spawn) : "Any channel in the paired server",
      },
      guild: { value: guildId, source: guildId ? "pairing" : "none" },
      authorizedUsers: authorizedUsers(extraAllowedUsers(), pairingView),
    };
  };

  const pairingStatus = async (
    notice: string | null = null,
  ): Promise<DiscordPairingStatus> => {
    const pairing = getPairing();
    const code = !pairing && cached.botToken ? ensurePairingCode() : null;
    const inviteUrl = inviteUrlFromToken(
      cached.botToken,
      cached.serverAccess === "full" ? "full" : "messages",
    );

    return buildPairingStatus({
      gatewayState,
      gatewayMessage,
      botUserId: client?.getUserId() ?? null,
      botTag,
      tokenConfigured: Boolean(cached.botToken),
      storedPairing: pairing
        ? {
            guildId: pairing.guild_id,
            guildName: pairing.guild_name,
            channelId: pairing.channel_id,
            channelName: pairing.channel_name,
            userId: pairing.user_id,
            userTag: pairing.user_tag,
            pairedAt: pairing.paired_at,
          }
        : null,
      pairingCode: code,
      inviteUrl,
      configuration: configurationStatus(),
      execution: await executionStatus(),
      notice,
    });
  };

  const pairingInstructions = (): string => {
    const code = ensurePairingCode();
    const command = pairingCommand(
      client?.getUserId() ?? null,
      formatPairingCode(code.code),
    );
    const invite = inviteUrlFromToken(
      cached.botToken,
      cached.serverAccess === "full" ? "full" : "messages",
    );
    const minutes = Math.max(
      1,
      Math.round((code.expiresAt - Date.now()) / 60_000),
    );
    return [
      botTag
        ? `Discord connected as ${botTag}.`
        : "Discord bot token saved.",
      invite ? `Invite the bot: ${invite}` : null,
      command
        ? "Then send this exact command in the channel you want to authorize:"
        : "The gateway is still identifying the bot. Run `alia discord pair` again once it connects.",
      command ? `    ${command}` : null,
      command
        ? `The code is single-use and expires in ${minutes} minute${minutes === 1 ? "" : "s"}. Run \`alia discord pair\` for a fresh one.`
        : null,
    ]
      .filter((line): line is string => line !== null)
      .join("\n");
  };

  const announcePairing = (): void => {
    alia.log.info(
      `Discord connected as ${botName()} and is awaiting pairing. Open Settings → Extensions → Plugins → Discord in VesnALIA or run \`alia discord pair\` to get the one-time command.`,
    );
  };

  alia.rpc.register(discordRpcContract, {
    getPairingStatus() {
      return pairingStatus();
    },
    refreshPairingCode() {
      if (!cached.botToken || effectiveGuildId()) return pairingStatus();
      pendingCode = generatePairingCode();
      publishPairingState("pairing-code-created");
      return pairingStatus();
    },
    /** Validates and saves the connected settings form as one configuration. */
    async setConfiguration(request) {
      const projectId = request.defaultProjectId?.trim() || null;
      const projectResult = await loadProject(projectId);
      if (!projectResult.project) {
        throw new Error("That project is no longer available.");
      }
      const [machines, machine] = [
        await listMachines(),
        request.machineHostId?.trim() || null,
      ];
      const catalog = request.model?.trim()
        ? await loadCatalog(
            machine ?? projectResult.project.defaultHostId,
            request.providerId,
          )
        : null;

      const check = validateSelectionRequest({ request, machines, catalog });
      if (!check.ok) {
        executionCache = null;
        throw new Error(check.message);
      }
      let homeChannelId: string | null;
      let spawnChannelId: string | null;
      try {
        homeChannelId = normalizeOptionalDiscordSnowflake(
          request.homeChannelId ?? undefined,
        );
        spawnChannelId = normalizeOptionalDiscordSnowflake(
          request.spawnChannelId ?? undefined,
        );
      } catch (error) {
        throw new Error(`Could not save channels: ${errorMessage(error)}`);
      }

      updateConfig({
        defaultProjectId: projectId ?? undefined,
        machineHostId: check.selection.machineHostId ?? undefined,
        providerId: check.selection.providerId ?? undefined,
        model: check.selection.model ?? undefined,
        reasoningLevel: check.selection.reasoningLevel ?? undefined,
        serviceTier: check.selection.serviceTier ?? undefined,
        permissionMode: request.permissionMode,
        serverAccess: request.serverAccess,
        homeChannelId: homeChannelId ?? undefined,
        spawnChannelId: spawnChannelId ?? undefined,
      });
      return pairingStatus(check.notice ?? "Configuration saved.");
    },
    /**
     * Writes one key and only that key. The reported bug was the destructive
     * control taking Discord server access up to "full" with it; this handler
     * cannot do that, and refuses outright rather than escalating access on the
     * operator's behalf.
     */
    async setDestructiveActions({ enabled }) {
      if (enabled && accessLevel() !== "full") {
        return pairingStatus(
          "Destructive actions need Full server access. Change that setting first.",
        );
      }
      if ((cached.allowDestructiveServerActions === true) === enabled) {
        return pairingStatus();
      }
      updateConfig({ allowDestructiveServerActions: enabled });
      return pairingStatus(
        enabled
          ? "Destructive Discord actions are on. Discord server access was not changed."
          : "Destructive Discord actions are off.",
      );
    },
    async unpair() {
      const pairing = getPairing();
      clearPairing();
      pendingCode = null;
      return pairingStatus(
        pairing
          ? `Unpaired from ${pairing.guild_name ?? "the Discord server"}.`
          : "Discord was already unpaired; stale conversation links were cleared.",
      );
    },
  });

  // ---------------------------------------------------------------------
  // Thread mapping
  // ---------------------------------------------------------------------

  const getBotUserId = (): string | undefined => client?.getUserId();

  const getMapByAliaThread = (aliaThreadId: string): ThreadMapRow | undefined =>
    db
      .prepare("SELECT * FROM discord_threads WHERE alia_thread_id = ?")
      .get(aliaThreadId) as ThreadMapRow | undefined;

  const getMapByDiscordChannel = (
    discordChannelId: string,
  ): ThreadMapRow | undefined =>
    db
      .prepare("SELECT * FROM discord_threads WHERE discord_channel_id = ?")
      .get(discordChannelId) as ThreadMapRow | undefined;

  const getInteractionRoute = (
    aliaThreadId: string,
  ): InteractionRouteRow | undefined =>
    db
      .prepare("SELECT * FROM discord_interaction_routes WHERE alia_thread_id = ?")
      .get(aliaThreadId) as InteractionRouteRow | undefined;

  const getInteractionMapByAliaThread = (
    aliaThreadId: string,
  ): ThreadMapRow | undefined => {
    const direct = getMapByAliaThread(aliaThreadId);
    if (direct) return direct;
    const route = getInteractionRoute(aliaThreadId);
    return route ? getMapByAliaThread(route.owner_alia_thread_id) : undefined;
  };

  const persistInteractionRoute = (
    aliaThreadId: string,
    ownerAliaThreadId: string,
  ): void => {
    if (aliaThreadId === ownerAliaThreadId) return;
    const now = Date.now();
    db.prepare(
      `INSERT INTO discord_interaction_routes
        (alia_thread_id, owner_alia_thread_id, created_at, last_activity_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(alia_thread_id) DO UPDATE SET
         owner_alia_thread_id = excluded.owner_alia_thread_id,
         last_activity_at = excluded.last_activity_at`,
    ).run(aliaThreadId, ownerAliaThreadId, now, now);
  };

  const ensureInteractionRoute = (thread: {
    id: string;
    parentThreadId: string | null;
  }): ThreadMapRow | undefined => {
    const ownerAliaThreadId = resolveDiscordInteractionOwner(
      thread,
      (threadId) => getMapByAliaThread(threadId) !== undefined,
      (threadId) => getInteractionRoute(threadId)?.owner_alia_thread_id,
    );
    if (!ownerAliaThreadId) return undefined;
    const map = getMapByAliaThread(ownerAliaThreadId);
    if (!map) return undefined;
    persistInteractionRoute(thread.id, ownerAliaThreadId);
    return map;
  };

  const ensureInteractionRouteFromSender = async (
    thread: { id: string; parentThreadId: string | null },
    visited = new Set<string>(),
  ): Promise<ThreadMapRow | undefined> => {
    const existing = ensureInteractionRoute(thread);
    if (existing) return existing;
    if (visited.has(thread.id) || visited.size >= 8) return undefined;
    visited.add(thread.id);

    try {
      const events = await alia.sdk.threads.events.list({
        threadId: thread.id,
        types: ["client/turn/requested"],
        order: "desc",
        limit: "25",
      });
      const senderThreadId = discordInteractionSenderThreadId(events);
      if (!senderThreadId || visited.has(senderThreadId)) return undefined;

      let ownerMap = getInteractionMapByAliaThread(senderThreadId);
      if (!ownerMap) {
        const senderThread = await alia.sdk.threads.get({
          threadId: senderThreadId,
        });
        ownerMap = await ensureInteractionRouteFromSender(senderThread, visited);
      }
      if (!ownerMap) return undefined;
      persistInteractionRoute(thread.id, ownerMap.alia_thread_id);
      return ownerMap;
    } catch (error) {
      alia.log.warn(
        `Could not infer Discord interaction route for ${thread.id}: ${errorMessage(error)}`,
      );
      return undefined;
    }
  };

  const insertMap = (row: ThreadMapRow): void => {
    db.prepare(
      `INSERT INTO discord_threads
        (discord_channel_id, discord_thread_id, discord_parent_channel_id, guild_id, alia_thread_id, alia_project_id, title, created_at, last_activity_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.discord_channel_id,
      row.discord_thread_id,
      row.discord_parent_channel_id,
      row.guild_id,
      row.alia_thread_id,
      row.alia_project_id,
      row.title,
      row.created_at,
      row.last_activity_at,
    );
  };

  const touchMap = (aliaThreadId: string): void => {
    db.prepare(
      "UPDATE discord_threads SET last_activity_at = ? WHERE alia_thread_id = ?",
    ).run(Date.now(), aliaThreadId);
  };

  const touchInteractionThread = (aliaThreadId: string): void => {
    const route = getInteractionRoute(aliaThreadId);
    if (route) {
      db.prepare(
        "UPDATE discord_interaction_routes SET last_activity_at = ? WHERE alia_thread_id = ?",
      ).run(Date.now(), aliaThreadId);
      touchMap(route.owner_alia_thread_id);
      return;
    }
    touchMap(aliaThreadId);
  };

  const markMessageSeen = (messageId: string, channelId: string): boolean => {
    const result = db
      .prepare(
        "INSERT OR IGNORE INTO discord_seen_messages (discord_message_id, discord_channel_id, seen_at) VALUES (?, ?, ?)",
      )
      .run(messageId, channelId, Date.now());
    return result.changes > 0;
  };

  const retryMessage = (messageId: string): void => {
    db.prepare("DELETE FROM discord_seen_messages WHERE discord_message_id = ?").run(
      messageId,
    );
  };

  const isInteractionPosted = (
    aliaThreadId: string,
    interactionId: string,
  ): boolean =>
    db
      .prepare(
        "SELECT 1 FROM discord_posted_interactions WHERE alia_thread_id = ? AND interaction_id = ?",
      )
      .get(aliaThreadId, interactionId) !== undefined;

  const markInteractionPosted = (
    aliaThreadId: string,
    interactionId: string,
  ): void => {
    db.prepare(
      "INSERT OR IGNORE INTO discord_posted_interactions (alia_thread_id, interaction_id, posted_at) VALUES (?, ?, ?)",
    ).run(aliaThreadId, interactionId, Date.now());
  };

  const interactionToken = (aliaThreadId: string, interactionId: string): string =>
    createHash("sha256")
      .update(aliaThreadId)
      .update("\0")
      .update(interactionId)
      .digest("hex")
      .slice(0, 24);

  const registerInteractionAction = (
    token: string,
    aliaThreadId: string,
    interactionId: string,
    discordChannelId: string,
  ): void => {
    db.prepare(
      `INSERT OR IGNORE INTO discord_interaction_actions
        (token, alia_thread_id, interaction_id, discord_channel_id, status, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
    ).run(token, aliaThreadId, interactionId, discordChannelId, Date.now());
  };

  const attachInteractionMessage = (token: string, messageId: string): void => {
    db.prepare(
      `UPDATE discord_interaction_actions
       SET discord_message_id = ?
       WHERE token = ? AND status = 'pending'`,
    ).run(messageId, token);
  };

  const getInteractionAction = (token: string): InteractionActionRow | undefined =>
    db
      .prepare("SELECT * FROM discord_interaction_actions WHERE token = ?")
      .get(token) as InteractionActionRow | undefined;

  const finishInteractionAction = (
    token: string,
    status: "resolved" | "stale",
    outcome?: string,
    userId?: string,
  ): void => {
    db.prepare(
      `UPDATE discord_interaction_actions
       SET status = ?, decision = ?, resolved_by_user_id = ?, resolved_at = ?
       WHERE token = ? AND status = 'pending'`,
    ).run(status, outcome ?? null, userId ?? null, Date.now(), token);
  };

  const pendingInteractionActions = (
    aliaThreadId: string,
    interactionId?: string,
  ): InteractionActionRow[] =>
    (interactionId
      ? db
          .prepare(
            `SELECT * FROM discord_interaction_actions
             WHERE alia_thread_id = ? AND interaction_id = ? AND status = 'pending'`,
          )
          .all(aliaThreadId, interactionId)
      : db
          .prepare(
            `SELECT * FROM discord_interaction_actions
             WHERE alia_thread_id = ? AND status = 'pending'`,
          )
          .all(aliaThreadId)) as InteractionActionRow[];

  const removeThreadState = (aliaThreadId: string): void => {
    const remove = db.transaction(() => {
      db.prepare(
        `DELETE FROM discord_posted_interactions
         WHERE alia_thread_id IN (
           SELECT alia_thread_id FROM discord_interaction_routes
           WHERE owner_alia_thread_id = ?
         )`,
      ).run(aliaThreadId);
      db.prepare(
        `DELETE FROM discord_interaction_actions
         WHERE alia_thread_id IN (
           SELECT alia_thread_id FROM discord_interaction_routes
           WHERE owner_alia_thread_id = ?
         )`,
      ).run(aliaThreadId);
      db.prepare(
        "DELETE FROM discord_interaction_routes WHERE owner_alia_thread_id = ? OR alia_thread_id = ?",
      ).run(aliaThreadId, aliaThreadId);
      db.prepare("DELETE FROM discord_threads WHERE alia_thread_id = ?").run(
        aliaThreadId,
      );
      db.prepare("DELETE FROM discord_posted_replies WHERE alia_thread_id = ?").run(
        aliaThreadId,
      );
      db.prepare("DELETE FROM discord_reply_outbox WHERE alia_thread_id = ?").run(aliaThreadId);
      db.prepare(
        "DELETE FROM discord_posted_interactions WHERE alia_thread_id = ?",
      ).run(aliaThreadId);
      db.prepare(
        "DELETE FROM discord_interaction_actions WHERE alia_thread_id = ?",
      ).run(aliaThreadId);
    });
    remove();
  };

  const removeInteractionThreadState = (aliaThreadId: string): void => {
    const remove = db.transaction(() => {
      db.prepare(
        "DELETE FROM discord_posted_interactions WHERE alia_thread_id = ?",
      ).run(aliaThreadId);
      db.prepare(
        "DELETE FROM discord_interaction_actions WHERE alia_thread_id = ?",
      ).run(aliaThreadId);
      db.prepare(
        "DELETE FROM discord_interaction_routes WHERE alia_thread_id = ?",
      ).run(aliaThreadId);
    });
    remove();
  };

  const sendToDiscord = async (
    guildId: string,
    channelId: string,
    text: string,
  ): Promise<boolean> => {
    if (!client) return false;
    try {
      await client.sendMessage(guildId, channelId, text);
      return true;
    } catch (error) {
      alia.log.warn(
        `Discord send failed (${channelId}): ${classifyDiscordError(error).message}`,
      );
      return false;
    }
  };

  const postToThreadChannel = async (
    aliaThreadId: string,
    text: string,
  ): Promise<boolean> => {
    const map = getMapByAliaThread(aliaThreadId);
    // A legacy row stores its original bound channel in discord_thread_id.
    // Keep delivering there until a mention migrates it into a session.
    return map &&
      isActiveMappedGuild(map.guild_id, effectiveGuildId())
      ? sendToDiscord(map.guild_id, map.discord_thread_id, text)
      : false;
  };

  const replyOutbox = new ReplyOutbox({
    db,
    isConnected: () => client?.isReady() === true,
    isAuthorized: ({ aliaThreadId, guildId, channelId }) => {
      const map = getMapByAliaThread(aliaThreadId);
      return Boolean(map && isActiveMappedGuild(guildId, effectiveGuildId()) &&
        map.guild_id === guildId && map.discord_thread_id === channelId);
    },
    resolveOutputId: (reply, signal) => resolveReplyOutputId(reply, (beforeSeq) =>
      alia.sdk.threads.events.list({
        threadId: reply.aliaThreadId,
        types: ["item/completed", "system/manager/user_message"],
        order: "desc",
        limit: "100",
        signal,
        ...(beforeSeq ? { beforeSeq } : {}),
      }), signal,
    ),
    sendChunk: async ({ guildId, channelId }, text, nonce) => {
      if (!client?.isReady()) throw new Error("Discord is reconnecting.");
      await client.sendReplyChunk(guildId, channelId, text, nonce);
    },
    onError: (threadId, error) => {
      alia.log.warn(`Discord reply for ${threadId} remains queued: ${errorMessage(error)}`);
    },
  });

  const homeChannelId = (): string | null =>
    cached.homeChannelId?.trim() || getPairing()?.channel_id || null;

  const postToHome = async (text: string): Promise<boolean> => {
    const channelId = homeChannelId();
    const guildId = effectiveGuildId();
    return channelId && guildId
      ? sendToDiscord(guildId, channelId, text)
      : false;
  };

  const announcementGuard = new InteractionAnnouncementGuard();

  const postInteractionToThreadChannel = async (
    aliaThreadId: string,
    text: string,
    interaction: PendingInteractionLike,
  ): Promise<boolean> => {
    const map = getInteractionMapByAliaThread(aliaThreadId);
    if (
      !map ||
      !client ||
      !isActiveMappedGuild(map.guild_id, effectiveGuildId())
    ) {
      return false;
    }
    // Unlike ordinary lifecycle output, let this failure reach the watcher.
    // A transient failure is retried on its next tick; a missing session is
    // detached by the watcher's permanent-channel error policy.
    const payload = interaction.payload;
    const question = discordQuestionControl(interaction);
    if (
      payload.kind === "approval" &&
      "availableDecisions" in payload &&
      payload.availableDecisions.length > 0
    ) {
      const token = interactionToken(aliaThreadId, interaction.id);
      registerInteractionAction(
        token,
        aliaThreadId,
        interaction.id,
        map.discord_thread_id,
      );
      const messageId = await client.sendApprovalRequest(
        map.guild_id,
        map.discord_thread_id,
        text,
        {
          token,
          decisions: payload.availableDecisions,
        },
      );
      attachInteractionMessage(token, messageId);
    } else if (question) {
      const token = interactionToken(aliaThreadId, interaction.id);
      registerInteractionAction(
        token,
        aliaThreadId,
        interaction.id,
        map.discord_thread_id,
      );
      const messageId = await client.sendQuestionRequest(
        map.guild_id,
        map.discord_thread_id,
        text,
        {
          token,
          multiSelect: question.multiSelect,
          options: question.options.map(({ description, label }) => ({
            ...(description ? { description } : {}),
            label,
          })),
        },
      );
      attachInteractionMessage(token, messageId);
    } else {
      await client.sendMessage(map.guild_id, map.discord_thread_id, text);
    }
    return true;
  };

  const closeInteractionControls = async (
    aliaThreadId: string,
    interactionId: string,
    status: "resolved" | "stale",
    statusText: string,
    outcome?: string,
    userId?: string,
  ): Promise<void> => {
    const actions = pendingInteractionActions(aliaThreadId, interactionId);
    const map = getInteractionMapByAliaThread(aliaThreadId);
    for (const action of actions) {
      finishInteractionAction(action.token, status, outcome, userId);
      if (!client || !map || !action.discord_message_id) continue;
      try {
        await client.closeInteractionRequest(
          map.guild_id,
          action.discord_channel_id,
          action.discord_message_id,
          statusText,
        );
      } catch (error) {
        // VesnALIA is already resolved. A later click still sees the durable stale
        // action and closes the controls, so a cosmetic edit must not retry
        // the user's answer against VesnALIA.
        alia.log.warn(
          `Could not close Discord controls for ${interactionId}: ${errorMessage(error)}`,
        );
      }
    }
  };

  const reconcileClosedInteractionControls = async (
    aliaThreadId: string,
    openInteractionIds: ReadonlySet<string>,
  ): Promise<void> => {
    for (const action of pendingInteractionActions(aliaThreadId)) {
      if (openInteractionIds.has(action.interaction_id)) continue;
      await closeInteractionControls(
        aliaThreadId,
        action.interaction_id,
        "stale",
        "⌛ This VesnALIA request was answered or closed in VesnALIA.",
      );
    }
  };

  const announcePendingInteractions = async (
    aliaThreadId: string,
  ): Promise<number> => {
    const interactions = await alia.sdk.threads.interactions.list({
      threadId: aliaThreadId,
    });
    const pending = interactions.filter(
      (interaction) => interaction.status === "pending",
    );
    await reconcileClosedInteractionControls(
      aliaThreadId,
      new Set(
        interactions
          .filter(
            (interaction) =>
              interaction.status === "pending" || interaction.status === "resolving",
          )
          .map((interaction) => interaction.id),
      ),
    );
    for (const interaction of pending) {
      const payload = (interaction as PendingInteractionLike).payload;
      const nativeControls =
        (payload.kind === "approval" &&
          "availableDecisions" in payload &&
          payload.availableDecisions.length > 0) ||
        discordQuestionControl(interaction as PendingInteractionLike) !== null;
      const prompt = pendingInteractionPrompt(
        interaction as PendingInteractionLike,
        MAX_INTERACTION_PROMPT_CHARS,
        nativeControls,
      );
      await announcementGuard.postOnce({
        key: `${aliaThreadId}:${interaction.id}`,
        isPosted: () => isInteractionPosted(aliaThreadId, interaction.id),
        post: () =>
          postInteractionToThreadChannel(
            aliaThreadId,
            `❓ **${botName_()} needs you:** ${prompt}`,
            interaction as PendingInteractionLike,
          ),
        markPosted: () => markInteractionPosted(aliaThreadId, interaction.id),
      });
    }
    return pending.length;
  };

  const activeThreadWatcher = new ActiveThreadWatcher({
    intervalMs: ACTIVE_THREAD_WATCH_INTERVAL_MS,
    initiallyPaused: true,
    inspect: async (aliaThreadId) => {
      const map = getInteractionMapByAliaThread(aliaThreadId);
      if (!map || !isActiveMappedGuild(map.guild_id, effectiveGuildId())) {
        activeThreadWatcher.stop(aliaThreadId);
        return;
      }

      const pendingCount = await announcePendingInteractions(aliaThreadId);
      if (pendingCount > 0) return;
      const thread = await alia.sdk.threads.get({ threadId: aliaThreadId });
      if (thread.status !== "active" && thread.status !== "starting") {
        activeThreadWatcher.stop(aliaThreadId);
        return;
      }
      if (!client) return;
      await client.sendTyping(map.guild_id, map.discord_thread_id);
    },
    onError: async (aliaThreadId, error) => {
      if (isUnavailableDiscordChannelError(error)) {
        const map = getInteractionMapByAliaThread(aliaThreadId);
        if (!map || !isActiveMappedGuild(map.guild_id, effectiveGuildId())) {
          return "stop";
        }

        alia.log.warn(
          `Discord session ${map.discord_thread_id} disappeared; stopping and unlinking VesnALIA thread ${map.alia_thread_id}.`,
        );
        const notice =
          "⚠️ **I stopped the linked VesnALIA conversation.** Its Discord thread is unavailable. Mention me here to start a new conversation.";
        const parentChannelId = map.discord_parent_channel_id;
        const fallbackChannelId = homeChannelId();
        await detachUnavailableSession({
          stopAliaThread: async () => {
            await alia.sdk.threads.stop({ threadId: map.alia_thread_id });
          },
          onStopError: (stopError) => {
            alia.log.warn(
              `Could not stop detached VesnALIA thread ${map.alia_thread_id}: ${errorMessage(stopError)}`,
            );
          },
          unlink: () => removeThreadState(map.alia_thread_id),
          notifyParent: parentChannelId
            ? () => sendToDiscord(map.guild_id, parentChannelId, notice)
            : null,
          notifyHome: async () => {
            if (
              fallbackChannelId &&
              fallbackChannelId !== parentChannelId
            ) {
              await sendToDiscord(
                map.guild_id,
                fallbackChannelId,
                `⚠️ **I stopped a linked VesnALIA conversation.** Discord thread <#${map.discord_thread_id}> is unavailable. Mention me in a channel to start a new conversation.`,
              );
            }
          },
        });
        return "stop";
      }
      alia.log.warn(
        `Discord active-thread watch failed for ${aliaThreadId}: ${errorMessage(error)}`,
      );
    },
  });

  const watchActiveThread = (aliaThreadId: string): void => {
    const map = getMapByAliaThread(aliaThreadId);
    if (!map || !isActiveMappedGuild(map.guild_id, effectiveGuildId())) return;
    activeThreadWatcher.start(aliaThreadId);
    void activeThreadWatcher.tick();
  };

  const watchInteractionThread = async (thread: {
    id: string;
    parentThreadId: string | null;
  }): Promise<void> => {
    const map = await ensureInteractionRouteFromSender(thread);
    if (!map || !isActiveMappedGuild(map.guild_id, effectiveGuildId())) return;
    activeThreadWatcher.start(thread.id);
    void activeThreadWatcher.tick();
  };

  const rehydrateActiveThreads = async (): Promise<void> => {
    const guildId = effectiveGuildId();
    if (!guildId) return;
    const rows = db
      .prepare(
        `SELECT alia_thread_id FROM discord_threads WHERE guild_id = ?
         UNION
         SELECT routes.alia_thread_id
         FROM discord_interaction_routes AS routes
         JOIN discord_threads AS owners
           ON owners.alia_thread_id = routes.owner_alia_thread_id
         WHERE owners.guild_id = ?`,
      )
      .all(guildId, guildId) as Array<{ alia_thread_id: string }>;
    await rehydrateActiveThreadWatches({
      threadIds: rows.map((row) => row.alia_thread_id),
      inspect: async (aliaThreadId) => {
        const [thread, interactions] = await Promise.all([
          alia.sdk.threads.get({ threadId: aliaThreadId }),
          alia.sdk.threads.interactions.list({ threadId: aliaThreadId }),
        ]);
        const pendingInteractionCount = interactions.filter(
          (interaction) => interaction.status === "pending",
        ).length;
        return { pendingInteractionCount, status: thread.status };
      },
      watch: (aliaThreadId) => activeThreadWatcher.start(aliaThreadId),
      onError: (aliaThreadId, error) => {
        alia.log.warn(
          `Could not restore Discord watch for ${aliaThreadId}: ${errorMessage(error)}`,
        );
      },
    });
    await activeThreadWatcher.tick();
  };

  const spawnAliaThread = async (
    prompt: string,
    message: DiscordInboundMessage,
  ): Promise<{ id: string; projectId: string; title: string | null }> => {
    const values = cached;
    // Never spawn off the panel's cache: a machine can go offline or a provider
    // can be signed out between the last refresh and this request.
    const context = await loadExecutionContext(values);
    executionCache = { at: Date.now(), value: context };

    if (!context.project) {
      throw new Error(
        context.projectError ??
          "No VesnALIA project is available for Discord threads. Pick one in Settings → Extensions → Plugins → Discord in VesnALIA.",
      );
    }
    if (!context.defaults) {
      throw new Error(
        `Project "${context.project.name}" has no execution defaults. Open it once in VesnALIA and choose a provider and model.`,
      );
    }

    const resolution = resolveExecution({
      selection: readExecutionSelection(values),
      project: context.project,
      defaults: context.defaults,
      permissionMode: resolveSpawnPermissionMode(
        values.permissionMode,
        context.defaults.permissionMode,
        context.catalog?.permissionCeiling ?? context.machine?.maxPermissionMode,
      ),
      machine: context.machine,
      catalog: context.catalog,
    });
    if (!resolution.ok) throw new Error(resolution.problem.message);
    const plan = resolution.plan;
    for (const warning of plan.warnings) {
      alia.log.warn(`Discord thread execution: ${warning}`);
    }

    const attributedPrompt = `Discord request from ${message.authorTag} (${message.authorId}):\n\n${prompt}`;
    const thread = await alia.sdk.threads.spawn({
      projectId: plan.projectId,
      providerId: plan.providerId,
      model: plan.model,
      reasoningLevel: plan.reasoningLevel,
      permissionMode: plan.permissionMode,
      serviceTier: plan.serviceTier,
      environment: plan.environment,
      // Say which of these the operator actually chose, so VesnALIA records the
      // Discord settings as explicit rather than as a client preference.
      executionInputSources: {
        model: values.model?.trim() ? "explicit" : "client-preference",
        providerId: values.providerId?.trim() ? "explicit" : "client-preference",
        reasoningLevel: values.reasoningLevel ? "explicit" : "client-preference",
        serviceTier: values.serviceTier ? "explicit" : "client-preference",
        permissionMode:
          values.permissionMode === "project-default" ||
          values.permissionMode === "machine-default"
            ? "client-preference"
            : "explicit",
      },
      prompt: attributedPrompt,
      title: truncate(`Discord: ${prompt}`, 100),
      visibility: "hidden",
    });

    return { id: thread.id, projectId: plan.projectId, title: thread.title ?? null };
  };

  const createDiscordSession = async (
    message: DiscordInboundMessage,
  ): Promise<{ id: string; name: string }> => {
    if (!client) throw new Error("The Discord bridge is not connected.");
    return client.createThread(
      message.guildId,
      message.channelId,
      discordSessionName(message.content, botName()),
    );
  };

  const moveLegacyMapToSession = (
    map: ThreadMapRow,
    parentChannelId: string,
    sessionChannelId: string,
  ): ThreadMapRow => {
    const now = Date.now();
    const result = db.prepare(
      `UPDATE discord_threads
       SET discord_channel_id = ?, discord_thread_id = ?,
           discord_parent_channel_id = ?, last_activity_at = ?
       WHERE alia_thread_id = ? AND discord_parent_channel_id IS NULL`,
    ).run(
      sessionChannelId,
      sessionChannelId,
      parentChannelId,
      now,
      map.alia_thread_id,
    );
    if (result.changes !== 1) {
      throw new Error("The legacy Discord conversation changed during migration.");
    }
    return {
      ...map,
      discord_channel_id: sessionChannelId,
      discord_thread_id: sessionChannelId,
      discord_parent_channel_id: parentChannelId,
      last_activity_at: now,
    };
  };

  const forwardToAlia = async (
    map: ThreadMapRow,
    message: DiscordInboundMessage,
  ): Promise<void> => {
    if (await handleInteractionReply(map, message)) return;
    await alia.sdk.threads.send({
      threadId: map.alia_thread_id,
      mode: "auto",
      input: [
        {
          type: "text",
          text: `Discord follow-up from ${message.authorTag} (${message.authorId}):\n\n${message.content}`,
          mentions: [],
        },
      ],
    });
    touchMap(map.alia_thread_id);
  };

  const handleInteractionReply = async (
    map: ThreadMapRow,
    message: DiscordInboundMessage,
  ): Promise<boolean> => {
    const routed = db
      .prepare(
        `SELECT alia_thread_id FROM discord_interaction_routes
         WHERE owner_alia_thread_id = ? ORDER BY last_activity_at DESC`,
      )
      .all(map.alia_thread_id) as Array<{ alia_thread_id: string }>;
    const pending: Array<{ threadId: string; interaction: unknown }> = [];
    for (const threadId of [
      map.alia_thread_id,
      ...routed.map((row) => row.alia_thread_id),
    ]) {
      const interactions = await alia.sdk.threads.interactions.list({ threadId });
      pending.push(
        ...interactions
          .filter((interaction) => interaction.status === "pending")
          .map((interaction) => ({ threadId, interaction })),
      );
    }
    if (pending.length === 0) return false;
    if (pending.length > 1) {
      await sendToDiscord(
        message.guildId,
        message.channelId,
        "⚠️ I found multiple pending VesnALIA requests. Use the controls on the request you want to answer, or open the VesnALIA thread.",
      );
      return true;
    }

    const target = pending[0]!;
    const interaction = target.interaction as PendingInteractionLike;
    const action = resolveInteractionReply(
      interaction,
      message.content,
    );
    if (action.kind === "error") {
      await sendToDiscord(message.guildId, message.channelId, `⚠️ ${action.message}`);
      return true;
    }

    if (action.kind === "respond") {
      await alia.sdk.threads.interactions.respond({
        threadId: target.threadId,
        interactionId: interaction.id,
        value: action.value,
      });
    } else {
      await alia.sdk.threads.interactions.resolve({
        threadId: target.threadId,
        interactionId: interaction.id,
        resolution: action.resolution,
      });
    }
    const statusText =
      interaction.payload.kind === "approval"
        ? `✅ Approval answered by ${message.authorTag}.`
        : `✅ Answered by ${message.authorTag}.`;
    await closeInteractionControls(
      target.threadId,
      interaction.id,
      "resolved",
      statusText,
      message.content,
      message.authorId,
    );
    touchInteractionThread(target.threadId);
    return true;
  };

  const resolvingInteractionTokens = new Set<string>();
  const handleApprovalAction = async (
    action: DiscordInboundApprovalAction,
  ): Promise<DiscordApprovalActionResult> => {
    if (resolvingInteractionTokens.has(action.token)) {
      return {
        outcome: "retry",
        errorText: "That approval is already being processed. Please wait a moment.",
      };
    }
    resolvingInteractionTokens.add(action.token);
    try {
      const stored = getInteractionAction(action.token);
      if (!stored || stored.status !== "pending") {
        return {
          outcome: "stale",
          statusText: "⌛ This VesnALIA approval is no longer pending.",
        };
      }
      const map = getInteractionMapByAliaThread(stored.alia_thread_id);
      if (
        !map ||
        !isAuthorized(action.guildId, action.authorId) ||
        !isActiveMappedGuild(map.guild_id, effectiveGuildId()) ||
        map.guild_id !== action.guildId ||
        map.discord_thread_id !== action.channelId ||
        stored.discord_channel_id !== action.channelId ||
        (stored.discord_message_id !== null &&
          stored.discord_message_id !== action.messageId)
      ) {
        return {
          outcome: "retry",
          errorText: "This approval does not belong to this Discord conversation.",
        };
      }

      const interactions = await alia.sdk.threads.interactions.list({
        threadId: stored.alia_thread_id,
      });
      const interaction = interactions.find(
        (candidate) =>
          candidate.id === stored.interaction_id && candidate.status === "pending",
      );
      if (!interaction) {
        finishInteractionAction(action.token, "stale");
        return {
          outcome: "stale",
          statusText: "⌛ This VesnALIA approval was already answered or expired.",
        };
      }

      const resolution = resolveApprovalDecision(
        interaction as PendingInteractionLike,
        action.decision,
      );
      if (resolution.kind !== "resolve") {
        finishInteractionAction(action.token, "stale");
        return {
          outcome: "stale",
          statusText: "⌛ That choice is not available for this VesnALIA approval.",
        };
      }
      await alia.sdk.threads.interactions.resolve({
        threadId: stored.alia_thread_id,
        interactionId: stored.interaction_id,
        resolution: resolution.resolution,
      });
      finishInteractionAction(
        action.token,
        "resolved",
        action.decision,
        action.authorId,
      );
      touchInteractionThread(stored.alia_thread_id);

      const actor = `<@${action.authorId}>`;
      if (action.decision === "allow_once") {
        return { outcome: "resolved", statusText: `✅ Approved once by ${actor}.` };
      }
      if (action.decision === "allow_for_session") {
        return {
          outcome: "resolved",
          statusText: `✅ Allowed for this VesnALIA session by ${actor}. Similar requests may proceed without another prompt.`,
        };
      }
      return { outcome: "resolved", statusText: `⛔ Denied by ${actor}.` };
    } catch (error) {
      alia.log.warn(
        `Could not resolve Discord approval ${action.token}: ${errorMessage(error)}`,
      );
      return {
        outcome: "retry",
        errorText:
          "alia could not apply that decision yet. The approval is still open; please try again.",
      };
    } finally {
      resolvingInteractionTokens.delete(action.token);
    }
  };

  const handleQuestionAction = async (
    action: DiscordInboundQuestionAction,
  ): Promise<DiscordQuestionActionResult> => {
    if (resolvingInteractionTokens.has(action.token)) {
      return {
        outcome: "retry",
        errorText: "That answer is already being processed. Please wait a moment.",
      };
    }
    resolvingInteractionTokens.add(action.token);
    try {
      const stored = getInteractionAction(action.token);
      if (!stored || stored.status !== "pending") {
        return {
          outcome: "stale",
          statusText: "⌛ This VesnALIA question is no longer pending.",
        };
      }
      const map = getInteractionMapByAliaThread(stored.alia_thread_id);
      if (
        !map ||
        !isAuthorized(action.guildId, action.authorId) ||
        !isActiveMappedGuild(map.guild_id, effectiveGuildId()) ||
        map.guild_id !== action.guildId ||
        map.discord_thread_id !== action.channelId ||
        stored.discord_channel_id !== action.channelId ||
        (stored.discord_message_id !== null &&
          stored.discord_message_id !== action.messageId)
      ) {
        return {
          outcome: "retry",
          errorText: "This question does not belong to this Discord conversation.",
        };
      }

      const interactions = await alia.sdk.threads.interactions.list({
        threadId: stored.alia_thread_id,
      });
      const interaction = interactions.find(
        (candidate) =>
          candidate.id === stored.interaction_id && candidate.status === "pending",
      );
      if (!interaction) {
        finishInteractionAction(action.token, "stale");
        return {
          outcome: "stale",
          statusText: "⌛ This VesnALIA question was already answered or expired.",
        };
      }

      const resolution = resolveQuestionSelection(
        interaction as PendingInteractionLike,
        action.selectedIndices,
      );
      if (resolution.kind !== "resolve") {
        return {
          outcome: "retry",
          errorText: "That option is no longer available. Please answer in VesnALIA.",
        };
      }
      await alia.sdk.threads.interactions.resolve({
        threadId: stored.alia_thread_id,
        interactionId: stored.interaction_id,
        resolution: resolution.resolution,
      });
      finishInteractionAction(
        action.token,
        "resolved",
        action.selectedIndices.join(","),
        action.authorId,
      );
      touchInteractionThread(stored.alia_thread_id);
      return {
        outcome: "resolved",
        statusText: `✅ Answered by ${action.authorTag}.`,
      };
    } catch (error) {
      alia.log.warn(
        `Could not resolve Discord question ${action.token}: ${errorMessage(error)}`,
      );
      return {
        outcome: "retry",
        errorText:
          "alia could not apply that answer yet. The question is still open; please try again.",
      };
    } finally {
      resolvingInteractionTokens.delete(action.token);
    }
  };

  const handlePairingMessage = async (
    message: DiscordInboundMessage,
  ): Promise<void> => {
    const command = parsePairCommand(message.content);
    if (!command) return;
    if (!markMessageSeen(message.messageId, message.channelId)) return;

    if (command.kind === "missing-code") {
      await sendToDiscord(
        message.guildId,
        message.channelId,
        "Open Settings → Extensions → Plugins → Discord in VesnALIA for a pairing code, then send the command shown there. Prefer the terminal? Run `alia discord pair`.",
      );
      return;
    }

    const check = verifyPairingCode(pendingCode, command.code);
    if (!check.ok) {
      await sendToDiscord(
        message.guildId,
        message.channelId,
        `⚠️ ${pairingFailureMessage(check.reason)}`,
      );
      return;
    }

    // Single-use: burn the code before anything else can consume it.
    pendingCode = null;
    savePairing({
      guild_id: message.guildId,
      guild_name: message.guildName,
      channel_id: message.channelId,
      channel_name: message.channelName,
      user_id: message.authorId,
      user_tag: message.authorTag,
      paired_at: Date.now(),
    });
    const summary = [
      `✅ **This server is paired with VesnALIA through ${botName()}.**`,
      `• Server: ${message.guildName ?? "This server"}`,
      `• Authorized user: ${message.authorTag} (${message.authorId})`,
      `• Home channel: ${message.channelName ? `#${message.channelName}` : "This channel"}`,
      "",
      `Next: mention ${botName()} in a channel with a request. I’ll open a dedicated conversation thread there.`,
    ].join("\n");
    alia.log.info(
      `Discord paired: guild=${message.guildId} user=${message.authorId} channel=${message.channelId}`,
    );
    await sendToDiscord(message.guildId, message.channelId, summary);
  };

  const handleInbound = async (
    message: DiscordInboundMessage,
  ): Promise<void> => {
    if (!message.content.trim()) return;

    if (!isPaired()) {
      await handlePairingMessage(message);
      return;
    }
    // Defense in depth: the gateway already gated this, but pairing state can
    // change between the gateway check and here.
    if (!isAuthorized(message.guildId, message.authorId)) return;

    const existing = getMapByDiscordChannel(message.channelId);
    const route = routeDiscordMessage(
      message,
      existing
        ? {
            discordChannelId: existing.discord_channel_id,
            discordParentChannelId: existing.discord_parent_channel_id,
          }
        : null,
    );
    if (route.kind === "ignore") return;
    if (message.content.length > MAX_PROMPT_CHARS) {
      await sendToDiscord(
        message.guildId,
        message.channelId,
        `⚠️ I couldn’t send that prompt because it’s over ${MAX_PROMPT_CHARS.toLocaleString("en-US")} characters. Shorten it and try again.`,
      );
      return;
    }
    if (!markMessageSeen(message.messageId, message.channelId)) return;

    if (route.kind === "forward-session" && existing) {
      try {
        await forwardToAlia(existing, message);
      } catch (error) {
        alia.log.error(
          `Could not forward Discord session ${message.channelId} to VesnALIA: ${classifyDiscordError(error).message}`,
        );
        retryMessage(message.messageId);
        await sendToDiscord(
          message.guildId,
          message.channelId,
          "I couldn’t send that message to VesnALIA. Try it once more; if it still fails, check the linked conversation in VesnALIA.",
        );
      }
      return;
    }

    const values = cached;
    let spawnChannelId: string | null;
    try {
      spawnChannelId = normalizeOptionalDiscordSnowflake(values.spawnChannelId);
    } catch {
      alia.log.warn(
        "Discord spawnChannelId is not a valid Discord channel snowflake.",
      );
      await sendToDiscord(
        message.guildId,
        message.channelId,
        "⚠️ I couldn’t start that conversation because the restricted channel setting isn’t a valid Discord channel ID. Update it in Settings → Extensions → Plugins → Discord in VesnALIA, then try again.",
      );
      return;
    }
    if (
      routeCreatesSession(route) &&
      !isAllowedSpawnLocation(message, spawnChannelId ?? undefined)
    ) {
      await sendToDiscord(
        message.guildId,
        message.channelId,
        `Start new VesnALIA conversations in <#${spawnChannelId}>. Mention me there with your request.`,
      );
      return;
    }

    if (route.kind === "migrate-legacy-session" && existing) {
      let migrated: ThreadMapRow;
      try {
        const session = await createDiscordSession(message);
        migrated = moveLegacyMapToSession(
          existing,
          message.channelId,
          session.id,
        );
        await sendToDiscord(
          message.guildId,
          session.id,
          "✅ **I moved the existing VesnALIA conversation to this thread.** Continue here — no mention needed.",
        );
        await client?.react(
          message.guildId,
          message.channelId,
          message.messageId,
          "🚀",
        );
      } catch (error) {
        alia.log.error(
          `Could not migrate legacy Discord session ${message.channelId}: ${classifyDiscordError(error).message}`,
        );
        await sendToDiscord(
          message.guildId,
          message.channelId,
          "I couldn’t move this conversation into a Discord thread. Check that I can create public threads here, then mention me again.",
        );
        return;
      }

      try {
        await forwardToAlia(migrated, {
          ...message,
          channelId: migrated.discord_thread_id,
        });
      } catch (error) {
        alia.log.error(
          `Could not forward migrated Discord session ${migrated.discord_thread_id} to VesnALIA: ${classifyDiscordError(error).message}`,
        );
        await sendToDiscord(
          message.guildId,
          migrated.discord_thread_id,
          "This thread is ready, but that message did not reach VesnALIA. Please send it here once more.",
        );
      }
      return;
    }

    try {
      const { thread, session } = await prepareDiscordSession({
        spawnAliaThread: () => spawnAliaThread(message.content, message),
        createDiscordSession: () => createDiscordSession(message),
        cleanupAliaThread: async (spawned) => {
          try {
            await alia.sdk.threads.archive({ threadId: spawned.id });
          } catch (cleanupError) {
            alia.log.warn(
              `Could not archive unlinked VesnALIA thread ${spawned.id}: ${classifyDiscordError(cleanupError).message}`,
            );
          }
          try {
            await alia.sdk.threads.stop({ threadId: spawned.id });
          } catch (cleanupError) {
            alia.log.warn(
              `Could not stop unlinked VesnALIA thread ${spawned.id}: ${classifyDiscordError(cleanupError).message}`,
            );
          }
        },
      });
      const now = Date.now();
      insertMap({
        discord_channel_id: session.id,
        discord_thread_id: session.id,
        discord_parent_channel_id: message.channelId,
        guild_id: message.guildId,
        alia_thread_id: thread.id,
        alia_project_id: thread.projectId,
        title: thread.title,
        created_at: now,
        last_activity_at: now,
      });
      watchActiveThread(thread.id);
      await sendToDiscord(
        message.guildId,
        session.id,
        `✅ **${botName_()} is on it.** Keep chatting in this thread — no mention needed.`,
      );
      await client?.react(
        message.guildId,
        message.channelId,
        message.messageId,
        "🚀",
      );
    } catch (error) {
      alia.log.error(
        `Could not start a Discord-backed VesnALIA session from ${message.channelId}: ${classifyDiscordError(error).message}`,
      );
      await sendToDiscord(
        message.guildId,
        message.channelId,
        "I couldn’t start this VesnALIA conversation. Check the Discord plugin settings in VesnALIA, then mention me again.",
      );
    }
  };

  // ---------------------------------------------------------------------
  // Agent tools
  // ---------------------------------------------------------------------

  const accessLevel = (): DiscordAccessLevel =>
    cached.serverAccess === "full" ? "full" : "messages";

  registerDiscordTools(alia, {
    getClient: () => client,
    getGuildId: () => effectiveGuildId(),
    getAccessLevel: accessLevel,
    allowsDestructive: () => cached.allowDestructiveServerActions === true,
    isDiscordConversation: (aliaThreadId) =>
      getInteractionMapByAliaThread(aliaThreadId) !== undefined,
  });

  alia.agents.configure((context) => {
    // Origin attribution covers a brand-new conversation before its Discord
    // session mapping exists. The durable lookup covers mappings created by
    // older plugin versions that may not carry current attribution metadata.
    ensureInteractionRoute(context.thread);
    const isDiscordConversation = isDiscordAgentConversation(
      alia.pluginId,
      context.origin.pluginId,
      getInteractionMapByAliaThread(context.thread.id) !== undefined,
    );
    return {
      tools: availableToolNames(
        accessLevel(),
        cached.allowDestructiveServerActions === true,
        isPaired(),
        // A Discord-backed VesnALIA thread already has one authoritative outbound
        // path: its final assistant text is relayed to the mapped Discord
        // thread by the lifecycle handler below. Giving that same agent the
        // generic send tool lets it accidentally cross-post a reply to the
        // parent channel and then relay a second confirmation to the thread.
        { allowSendMessage: !isDiscordConversation },
      ),
      skills: [],
      ...(isDiscordConversation
        ? {
            instructions: DISCORD_BRIDGE_AGENT_INSTRUCTIONS,
          }
        : {}),
    };
  });

  // ---------------------------------------------------------------------
  // Thread lifecycle
  // ---------------------------------------------------------------------

  alia.events.on("thread.created", ({ thread }) => {
    ensureInteractionRoute(thread);
  });

  alia.events.on("thread.active", ({ thread }) => {
    void watchInteractionThread(thread);
  });

  alia.events.on("thread.idle", async ({ thread, lastAssistantText }) => {
    activeThreadWatcher.stop(thread.id);
    const interactionMap =
      getInteractionMapByAliaThread(thread.id) ??
      (await ensureInteractionRouteFromSender(thread));
    if (
      !interactionMap ||
      !isActiveMappedGuild(interactionMap.guild_id, effectiveGuildId())
    ) {
      return;
    }
    touchInteractionThread(thread.id);

    const directMap = getMapByAliaThread(thread.id);
    if (directMap && lastAssistantText?.trim()) {
      // Capture before the first delivery await, even while Discord is down.
      replyOutbox.enqueue({
        aliaThreadId: thread.id,
        guildId: directMap.guild_id,
        channelId: directMap.discord_thread_id,
        idleAt: thread.updatedAt,
        text: lastAssistantText.trim(),
      });
      await replyOutbox.flush();
    }

    // Belt and braces. The watcher is the primary announcement path because a
    // thread blocked on an approval stays `active`, and it is stopped on the
    // first line of this handler. But nothing guarantees every interaction
    // kind keeps the thread active — a question VesnALIA asks at the end of a turn
    // could land here instead. Announcing is idempotent (DB-backed
    // `isInteractionPosted` plus the in-flight guard), so the only thing this
    // costs is one list call, and the thing it prevents is an interaction that
    // is never surfaced at all.
    try {
      await announcePendingInteractions(thread.id);
    } catch (error) {
      alia.log.warn(
        `Could not announce pending interactions for ${thread.id}: ${classifyDiscordError(error).message}`,
      );
    }
  });

  alia.events.on("thread.failed", async ({ thread, error }) => {
    activeThreadWatcher.stop(thread.id);
    const map = getMapByAliaThread(thread.id);
    if (!map || !isActiveMappedGuild(map.guild_id, effectiveGuildId())) return;
    alia.log.error(
      `Discord-linked VesnALIA thread ${thread.id} failed: ${classifyDiscordError(error).message}`,
    );
    const sessionPosted = await postToThreadChannel(
      thread.id,
      `${botName_()} couldn’t finish that turn. Try your request again here; if it keeps failing, check VesnALIA for details.`,
    );
    const failureHomeChannelId = homeChannelId();
    if (
      shouldAlertHomeForFailure(
        map.discord_thread_id,
        failureHomeChannelId,
      )
    ) {
      const label = map.title?.trim() || "a Discord-linked VesnALIA session";
      await sendToDiscord(
        map.guild_id,
        failureHomeChannelId!,
        sessionPosted
          ? `${botName_()} couldn’t finish a turn in ${label}. Continue in <#${map.discord_thread_id}> or check VesnALIA for details.`
          : `${botName_()} couldn’t finish a turn in ${label}. Open VesnALIA for details, then try again.`,
      );
    }
  });

  alia.events.on("thread.deleted", async ({ thread }) => {
    activeThreadWatcher.stop(thread.id);
    const map = getMapByAliaThread(thread.id);
    if (!map) {
      removeInteractionThreadState(thread.id);
      return;
    }
    // Revoke delivery before the notice can yield to a retry or reconnect.
    removeThreadState(thread.id);
    if (isActiveMappedGuild(map.guild_id, effectiveGuildId())) {
      await sendToDiscord(
        map.guild_id,
        map.discord_thread_id,
        map.discord_parent_channel_id
          ? `🗑️ The linked VesnALIA thread was deleted. Mention me in <#${map.discord_parent_channel_id}> to start a new conversation.`
          : "🗑️ The linked VesnALIA thread was deleted. Mention me in this channel to start a new conversation.",
      );
    }
  });

  // ---------------------------------------------------------------------
  // CLI
  // ---------------------------------------------------------------------

  alia.cli.register({
    name: "discord",
    summary: "Manage the Discord VesnALIA bridge",
    commands: [
      {
        name: "status",
        summary: "Show connection, pairing, and recent mapped threads",
        usage: "alia discord status",
      },
      {
        name: "pair",
        summary: "Show a one-time pairing code to send in Discord",
        usage: "alia discord pair",
      },
      {
        name: "unpair",
        summary: "Forget the paired server and allowed users",
        usage: "alia discord unpair",
      },
      {
        name: "invite",
        summary: "Print the bot invite URL for this token",
        usage: "alia discord invite [--full]",
      },
      {
        name: "allow",
        summary: "Authorize another Discord user",
        usage: "alia discord allow <user-id>",
      },
      {
        name: "revoke",
        summary: "Remove an authorized Discord user",
        usage: "alia discord revoke <user-id>",
      },
    ],
    async run(argv) {
      const [command = "status", ...rest] = argv;

      if (command === "status") {
        const config = configurationStatus();
        const execution = await executionStatus();
        const pairing = getPairing();
        const activeGuild = effectiveGuildId();
        const rows = activeGuild
          ? (db
              .prepare(
                "SELECT * FROM discord_threads WHERE guild_id = ? ORDER BY last_activity_at DESC LIMIT 10",
              )
              .all(activeGuild) as ThreadMapRow[])
          : [];
        const lines = rows.map((row) => {
          const kind = row.discord_parent_channel_id
            ? "Session thread"
            : "Legacy channel";
          return `${kind}: ${row.title ?? "Untitled Discord conversation"} (<#${row.discord_thread_id}>)`;
        });
        return {
          exitCode: 0,
          stdout: [
            `Discord gateway: ${client?.isReady() ? `connected as ${botTag ?? "?"}` : "not connected"}`,
            pairing
              ? `Paired: ${pairing.guild_name ?? pairing.guild_id} · #${pairing.channel_name ?? pairing.channel_id} · ${pairing.user_tag ?? "Discord user"} (${pairing.user_id})`
              : cached.botToken
                ? "Paired: no — run `alia discord pair`"
                : "Paired: no — add the bot token in Settings → Extensions → Plugins → Discord in VesnALIA",
            `Authorized users: ${effectiveAllowedUsers().join(", ") || "(none)"}`,
            `Server access: ${config.serverAccess.value}${config.destructiveActions.effective ? " (destructive actions enabled)" : config.destructiveActions.configured ? " (destructive actions requested but inactive)" : ""}`,
            `Thread permission mode: ${config.permissionMode.value}`,
            `Home channel: ${config.homeChannel.label}${config.homeChannel.source === "pairing" ? " (from pairing)" : ""}`,
            `New conversations: ${config.newConversationChannel.label}`,
            `Runs in: ${execution.summary}`,
            ...execution.issues.map((issue) => `⚠️ ${issue}`),
            cached.botToken && !activeGuild
              ? "Pairing: waiting for an explicit `alia discord pair` request (the one-time code is hidden from status)."
              : null,
            lines.length > 0
              ? `Recent conversations:\n${lines.map((line) => `• ${line}`).join("\n")}`
              : "No Discord conversations yet.",
          ]
            .filter((line): line is string => line !== null)
            .join("\n"),
        };
      }

      if (command === "pair") {
        if (!cached.botToken) {
          return {
            exitCode: 1,
            stderr:
              "No bot token yet. Add it in Settings → Extensions → Plugins → Discord in VesnALIA, then run `alia discord pair`.",
          };
        }
        const pairing = getPairing();
        if (pairing) {
          return {
            exitCode: 0,
            stdout: `Already paired with ${pairing.guild_name ?? pairing.guild_id}. Run \`alia discord unpair\` first to pair somewhere else.`,
          };
        }
        return { exitCode: 0, stdout: pairingInstructions() };
      }

      if (command === "unpair") {
        const pairing = getPairing();
        if (!pairing) {
          clearPairing();
          return { exitCode: 0, stdout: "Not paired. Cleared any stale thread mappings." };
        }
        clearPairing();
        pendingCode = null;
        return {
          exitCode: 0,
          stdout: `Unpaired from ${pairing.guild_name ?? pairing.guild_id}. Run \`alia discord pair\` to link a server again.`,
        };
      }

      if (command === "invite") {
        const level =
          rest.includes("--full") || accessLevel() === "full" ? "full" : "messages";
        const url = inviteUrlFromToken(cached.botToken, level);
        if (!url) {
          return {
            exitCode: 1,
            stderr:
              "Could not derive the application id from the bot token. Check the token in Settings → Extensions → Plugins → Discord in VesnALIA.",
          };
        }
        return {
          exitCode: 0,
          stdout: `Invite URL (${level} access):\n${url}`,
        };
      }

      if (command === "allow" || command === "revoke") {
        const [userId] = parseDiscordIds(rest.join(" "));
        if (!userId) {
          return {
            exitCode: 2,
            stderr: `Usage: VesnALIA discord ${command} <discord-user-id>`,
          };
        }
        if (command === "allow") {
          db.prepare(
            "INSERT OR IGNORE INTO discord_allowed_users (user_id, user_tag, added_at) VALUES (?, ?, ?)",
          ).run(userId, null, Date.now());
          return { exitCode: 0, stdout: `Authorized ${userId}.` };
        }
        const pairing = getPairing();
        if (pairing?.user_id === userId) {
          return {
            exitCode: 1,
            stderr:
              "That user paired this server and cannot be revoked. Run `alia discord unpair` instead.",
          };
        }
        db.prepare("DELETE FROM discord_allowed_users WHERE user_id = ?").run(userId);
        return { exitCode: 0, stdout: `Revoked ${userId}.` };
      }

      return {
        exitCode: 2,
        stderr:
          "Usage: VesnALIA discord <status|pair|unpair|invite|allow|revoke>",
      };
    },
  });

  // ---------------------------------------------------------------------
  // Gateway service
  // ---------------------------------------------------------------------

  const runGateway = async (
    token: string,
    signal: AbortSignal,
  ): Promise<void> => {
    setGatewayState("connecting", null, "gateway-connecting");
    const gatewayStopped = new AbortController();
    const gatewaySignal = AbortSignal.any([signal, gatewayStopped.signal]);
    let fatalError: Error | null = null;
    const created = new DiscordClient({
      token,
      isAuthorized,
      isPairingCandidate,
      botUserId: getBotUserId,
      onMessage: handleInbound,
      onApprovalAction: handleApprovalAction,
      onQuestionAction: handleQuestionAction,
      onReady: async (tag) => {
        botTag = tag;
        setGatewayState("connected", null, "gateway-connected");
        if (isPaired()) {
          await postToHome(`✅ **Discord is connected.** I’m online as ${tag}.`);
        } else {
          announcePairing();
        }
      },
      onFatalError: (error) => {
        fatalError = error;
        gatewayStopped.abort();
      },
      onConnectionStateChange: (ready) => {
        setGatewayState(
          ready ? "connected" : "connecting",
          null,
          ready ? "gateway-connected" : "gateway-reconnecting",
        );
        if (ready) {
          activeThreadWatcher.resume();
          void replyOutbox.flush();
          void rehydrateActiveThreads().catch((error) => {
            alia.log.warn(
              `Could not restore Discord active-thread watches: ${errorMessage(error)}`,
            );
          });
        } else {
          activeThreadWatcher.pause();
        }
      },
      onSuspectedMissingContentIntent: () => {
        const message =
          "I couldn’t read Discord message text. Enable Message Content Intent in the Discord Developer Portal → your application → Bot, then restart VesnALIA.";
        alia.log.warn(message);
        void postToHome(`⚠️ ${message}`);
      },
      log: {
        info: (message) => alia.log.info(message),
        warn: (message) => alia.log.warn(message),
        error: (message) => alia.log.error(message),
      },
    });

    client = created;
    try {
      await created.login();
      // A terminal close can occur before this wait starts; an aborted signal
      // remembers it. A token change during login also must not be lost.
      if (cached.botToken === token) await waitForWake(gatewaySignal);
      if (fatalError) throw fatalError;
    } finally {
      gatewayStopped.abort();
      activeThreadWatcher.pause();
      if (client === created) client = null;
      botTag = null;
      setGatewayState("disconnected", null, "gateway-disconnected");
      await created.destroy();
    }
  };

  alia.background.service("discord-gateway", {
    async start(signal) {
      let attempt = 0;
      while (!signal.aborted) {
        const values = await settings.get();
        cached = { ...cached, botToken: values.botToken };

        if (!values.botToken) {
          // A missing token is a standing configuration gap, which is exactly
          // what the SDK's needs-configuration state is for; it clears on the
          // next load, so it does not go stale the way a pairing prompt would.
          alia.status.needsConfiguration(
            "Add your bot token in Settings → Extensions → Plugins → Discord in VesnALIA. You can finish pairing in the connection panel there.",
          );
          setGatewayState("disconnected", null, "gateway-not-configured");
          await waitForWake(signal);
          continue;
        }

        try {
          await runGateway(values.botToken, signal);
          attempt = 0;
        } catch (error) {
          const classified = classifyDiscordError(error);
          alia.log.error(`Discord gateway stopped: ${classified.message}`);
          if (classified.needsConfiguration) {
            // Retrying cannot help until the operator changes something.
            setGatewayState("failed", classified.message, "gateway-failed");
            alia.status.needsConfiguration(classified.message);
            await waitForWake(signal);
            attempt = 0;
            continue;
          }
          attempt += 1;
          setGatewayState("connecting", null, "gateway-retrying");
          const delayMs = retryDelayMs(attempt);
          alia.log.warn(
            `Reconnecting to Discord in ${Math.round(delayMs / 1000)}s (attempt ${attempt}).`,
          );
          await waitForWake(signal, delayMs);
        }
      }
    },
  });

  alia.background.service("discord-replies", {
    async start(signal) {
      const stop = () => replyOutbox.stop();
      signal.addEventListener("abort", stop, { once: true });
      try {
        while (!signal.aborted) {
          await replyOutbox.flush();
          await waitForWake(signal, ACTIVE_THREAD_WATCH_INTERVAL_MS);
        }
      } finally {
        signal.removeEventListener("abort", stop);
      }
    },
  });

  alia.background.schedule("cleanup", "0 4 * * *", async () => {
    const cutoff = Date.now() - RETENTION_MS;
    db.prepare("DELETE FROM discord_seen_messages WHERE seen_at < ?").run(cutoff);
    db.prepare("DELETE FROM discord_reply_outbox WHERE created_at < ?").run(cutoff);
    db.prepare("DELETE FROM discord_posted_replies WHERE posted_at < ?").run(cutoff);
    db.prepare("DELETE FROM discord_posted_interactions WHERE posted_at < ?").run(
      cutoff,
    );
    db.prepare("DELETE FROM discord_interaction_actions WHERE created_at < ?").run(
      cutoff,
    );
    db.prepare(
      "DELETE FROM discord_interaction_routes WHERE last_activity_at < ?",
    ).run(cutoff);
  });

  alia.onDispose(async () => {
    wakeAll();
    activeThreadWatcher.dispose();
    const repliesStopped = replyOutbox.dispose();
    if (client) {
      await client.destroy();
      client = null;
    }
    await repliesStopped;
  });

  alia.log.info("Discord plugin loaded");
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
