import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import type { AgentExecution } from "./preferences";

/** A machine an agent can run on, as Review settings lists it. */
export interface Machine { hostId: string; name: string; connected: boolean; server: boolean; }

type Placement = Pick<Parameters<AliaPluginApi["sdk"]["threads"]["spawn"]>[0], "projectId" | "environment">;
type Host = Awaited<ReturnType<AliaPluginApi["sdk"]["hosts"]["get"]>>;

const removed = (host: Pick<Host, "lifecycle">) => host.lifecycle.phase === "removing" || host.lifecycle.phase === "destroyed";

async function findHost(alia: AliaPluginApi, hostId: string): Promise<Host | null> {
  return alia.sdk.hosts.get({ hostId }).catch((error) => {
    if ((error as { status?: number } | null)?.status === 404 || String(error).includes("HTTP 404")) return null;
    throw error;
  });
}

/** The project agents run in: the personal one, else the first. Throws when VesnALIA can't list them. */
export async function personalProjectId(alia: AliaPluginApi): Promise<string | undefined> {
  const projects = await alia.sdk.projects.list({ includePersonal: true });
  return (projects.find((project) => project.kind === "personal") ?? projects[0])?.id;
}

/** Persistent machines, the VesnALIA server first. */
export async function listMachines(alia: AliaPluginApi): Promise<Machine[]> {
  const [hosts, config] = await Promise.all([alia.sdk.hosts.list({ type: "persistent" }), alia.sdk.system.config().catch(() => null)]);
  return hosts.filter((host) => !removed(host))
    .map((host) => ({ hostId: host.id, name: host.name, connected: host.status === "connected", server: host.id === config?.primaryHostId }))
    .sort((a, b) => Number(b.server) - Number(a.server) || a.name.localeCompare(b.name));
}

/**
 * Where an agent's thread runs. By default VesnALIA places it in the review's project
 * on the server. On a chosen machine it uses that machine's personal workspace,
 * which VesnALIA offers only in the personal project; the agents read the review
 * through plugin tools, so they need no checkout.
 */
export async function agentPlacement(alia: AliaPluginApi, agent: Pick<AgentExecution, "hostId"> | null, projectId: string): Promise<Placement> {
  if (!agent?.hostId) return { projectId, environment: { type: "project-default" } };
  const personal = (await alia.sdk.projects.list({ includePersonal: true })).find((project) => project.kind === "personal");
  if (!personal) throw new Error("alia has no personal project to run the agent in.");
  return { projectId: personal.id, environment: { type: "host", hostId: agent.hostId, workspace: { type: "personal" } } };
}

/** Why an agent can't start on its chosen machine now, or null when it can. */
export async function machineUnavailable(alia: AliaPluginApi, agent: Pick<AgentExecution, "hostId"> | null, role: string): Promise<string | null> {
  if (!agent?.hostId) return null;
  const host = await findHost(alia, agent.hostId);
  if (!host || removed(host)) return `The machine chosen for the ${role} was removed. Choose another in Review settings.`;
  if (host.status !== "connected") return `${host.name} is offline. Wake it, or choose another machine for the ${role} in Review settings.`;
  return null;
}

/** A chosen machine's name and connection for display; null when unknown. */
export async function machineStatus(alia: AliaPluginApi, hostId: string | undefined): Promise<{ name: string; connected: boolean } | null> {
  if (!hostId) return null;
  const host = await findHost(alia, hostId).catch(() => null);
  return host && !removed(host) ? { name: host.name, connected: host.status === "connected" } : null;
}
