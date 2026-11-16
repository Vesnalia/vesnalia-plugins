// Where each repo of a Loom project is checked out on the project's machine.
import type { ProjectRow, TicketRow } from "./db/store";
import type { AliaPort } from "./ports";
import { LoomError } from "./projects";
import { repoSettings, type RepoSettings } from "./repos";
import type { Spec } from "./spec";

export interface RepoCheckout {
  hostId: string;
  aliaProjectId: string;
  path: string;
  settings: RepoSettings;
}

export function ticketRepo(spec: Spec, ticket: Pick<TicketRow, "repo">): RepoSettings {
  return repoSettings(spec, ticket.repo);
}

/** The checkout of repo `name` on the project's machine; a null name is the Loom project's own repository. Throws loom_no_checkout when there is none. */
export async function repoCheckout(ctx: { alia: AliaPort }, project: ProjectRow, spec: Spec, name: string | null): Promise<RepoCheckout> {
  const settings = repoSettings(spec, name);
  const aliaProjectId = settings.aliaProjectId ?? project.alia_project_id;
  const hostId = project.host_id;
  const path = hostId === null ? null : await ctx.alia.projectCheckout(aliaProjectId, hostId);
  if (hostId === null || path === null) {
    const repo = name === null ? "The project's repository" : `Repo "${name}"`;
    const machine = hostId ?? "<machine>";
    throw new LoomError(
      "loom_no_checkout",
      `${repo} (VesnALIA project ${aliaProjectId}) has no checkout on the machine ${hostId ?? "(unknown)"} that this Loom project uses. Clone it there with \`alia project source add ${aliaProjectId} --clone --machine ${machine}\`, then resume.`,
    );
  }
  return { hostId, aliaProjectId, path, settings };
}
