import { basename, join } from "node:path";
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import {
  isPublishableArtifactContent,
  parseArtifactManifest,
  resolveArtifactPath,
  unregisteredArtifactPaths,
} from "../../lib/artifact-manifest.mjs";
import { artifactRole } from "../../lib/artifact-roles.mjs";
import { AUDIT_TRAIL_FILE } from "../../lib/audit-trail-contract.mjs";
import { listNestedFiles } from "./board-read.js";
import type { WorkerCard } from "../workers-types.js";

export type DetailArtifact = {
  stage: string;
  kind: string;
  role: "deliverable" | "evidence";
  path: string;
  display: string;
  generatedAt: string;
  absolutePath: string;
  hostId: string;
  note: string | null;
};

type ArtifactDeps = {
  alia: AliaPluginApi;
  stateDir: (
    sourcePath: string,
    card: WorkerCard,
  ) => Promise<string | null>;
  fileTimestamp: (
    file: { modifiedAtMs?: unknown } | null,
    fallback: string,
  ) => string;
  auditReceiptNote: (path: string) => string | null;
  workspaceRelative: (rootPath: string, path: string) => string | null;
};

export async function readDetailArtifacts(
  deps: ArtifactDeps,
  card: WorkerCard,
  sourcePath: string | null,
  sourceHostId: string | null,
): Promise<DetailArtifact[]> {
  if (!sourcePath) return [];
  const state = await readState(deps, card, sourcePath);
  if (!state.content) return [];
  const list: DetailArtifact[] = [];
  const seen = new Set<string>();
  for (const fields of parseArtifactManifest(state.content)) {
    if (!fields.stage || !fields.path) continue;
    const full = resolveArtifactPath(sourcePath, fields.path);
    if (!full) continue;
    const artifact = await deps.alia.sdk.files.read({ path: full }).catch(() => null);
    if (artifact && isPublishableArtifactContent(artifact.content) && sourceHostId) {
      list.push(artifactEntry(
        deps,
        artifact,
        full,
        sourceHostId,
        card,
        {
          stage: fields.stage,
          kind: fields.kind ?? "document",
          path: fields.path,
          display: fields.label ?? basename(full),
        },
      ));
    }
    seen.add(full);
  }
  await appendUnregisteredArtifacts(
    deps,
    state.dir,
    sourcePath,
    sourceHostId,
    card,
    list,
    seen,
  );
  return list;
}

async function readState(
  deps: ArtifactDeps,
  card: WorkerCard,
  sourcePath: string,
): Promise<{ dir: string | null; content: string | null }> {
  if (!card.dir_hash) {
    return {
      dir: null,
      content: await readFile(deps.alia, join(sourcePath, "state.md")),
    };
  }
  const stateDir = await deps.stateDir(sourcePath, card);
  if (!stateDir) return { dir: null, content: null };
  return {
    dir: stateDir,
    content: await readFile(deps.alia, join(stateDir, "state.md")),
  };
}

async function readFile(alia: AliaPluginApi, path: string): Promise<string | null> {
  return alia.sdk.files
    .read({ path })
    .then((file) => file.content)
    .catch(() => null);
}

async function appendUnregisteredArtifacts(
  deps: ArtifactDeps,
  stateDir: string | null,
  sourcePath: string,
  sourceHostId: string | null,
  card: WorkerCard,
  list: DetailArtifact[],
  seen: Set<string>,
): Promise<void> {
  if (!stateDir || !sourceHostId) return;
  const paths = await listNestedFiles(deps.alia.sdk.files, stateDir);
  for (const absolute of unregisteredArtifactPaths(paths, [...seen])) {
    const relPath = deps.workspaceRelative(sourcePath, absolute);
    if (!relPath) continue;
    const artifact = await deps.alia.sdk.files.read({ path: absolute }).catch(() => null);
    if (!artifact || !isPublishableArtifactContent(artifact.content)) continue;
    list.push(artifactEntry(
      deps,
      artifact,
      absolute,
      sourceHostId,
      card,
      unregisteredShape(absolute, relPath),
    ));
    seen.add(absolute);
  }
}

function unregisteredShape(
  absolute: string,
  relPath: string,
): Pick<DetailArtifact, "stage" | "kind" | "path" | "display"> {
  const isTrail = basename(absolute) === AUDIT_TRAIL_FILE;
  return {
    stage: isTrail ? "audit" : "unregistered",
    kind: isTrail ? "audit-trail" : "unregistered",
    path: relPath,
    display: basename(absolute),
  };
}

function artifactEntry(
  deps: ArtifactDeps,
  artifact: { content: string; modifiedAtMs?: unknown },
  absolute: string,
  hostId: string,
  card: WorkerCard,
  shape: Pick<DetailArtifact, "stage" | "kind" | "path" | "display">,
): DetailArtifact {
  const { auditReceiptNote } = deps;
  return {
    ...shape,
    role: artifactRole({ kind: shape.kind, path: shape.path }),
    generatedAt: deps.fileTimestamp(
      artifact,
      new Date(card.updated_at).toISOString(),
    ),
    absolutePath: absolute,
    hostId,
    note: auditReceiptNote(absolute),
  };
}
