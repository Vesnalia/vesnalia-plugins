import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import {
  fileNameOf,
  joinHostPath,
  joinPreviewUrl,
  mimeForPath,
  PREVIEW_TTL_MS,
  splitAbsoluteFile,
  splitRelativeSegments,
} from "./formats";

export type AudioSourceKind = "host" | "thread-storage" | "workspace";

export type AudioSource = {
  kind: AudioSourceKind;
  threadId: string | null;
  environmentId: string | null;
  projectId: string | null;
};

export type ResolvedAudio = {
  hostId?: string;
  rootPath: string;
  relativePath: string;
  fileName: string;
  mimeType: string;
};

export async function resolveAudioLocation(
  alia: AliaPluginApi,
  path: string,
  source: AudioSource,
): Promise<ResolvedAudio> {
  const fileName = fileNameOf(path);
  const mimeType = mimeForPath(path);

  if (source.kind === "host") {
    const { dir, name } = splitAbsoluteFile(path);
    return {
      hostId: await resolveHostId(alia, source),
      rootPath: dir,
      relativePath: name,
      fileName: name,
      mimeType,
    };
  }

  const relativePath = splitRelativeSegments(path).join("/");

  if (source.kind === "thread-storage") {
    if (!source.threadId) {
      throw new Error("Thread-storage audio is missing its thread id.");
    }
    const listing = await alia.sdk.threads.storageFiles({
      threadId: source.threadId,
      query: relativePath,
    });
    return {
      hostId: await resolveHostId(alia, source),
      rootPath: listing.storageRootPath,
      relativePath,
      fileName,
      mimeType,
    };
  }

  const located = await resolveWorkspaceRoot(alia, source);
  return {
    hostId: located.hostId,
    rootPath: located.rootPath,
    relativePath,
    fileName,
    mimeType,
  };
}

export async function createAudioPreviewUrl(
  alia: AliaPluginApi,
  resolved: ResolvedAudio,
): Promise<{ url: string; expiresAtMs: number }> {
  const preview = await alia.sdk.files.createPreview({
    hostId: resolved.hostId,
    rootPath: resolved.rootPath,
    ttlMs: PREVIEW_TTL_MS,
  });
  return {
    url: joinPreviewUrl(preview.baseUrl, resolved.relativePath),
    expiresAtMs: preview.expiresAtMs,
  };
}

export async function readAudioBytes(
  alia: AliaPluginApi,
  resolved: ResolvedAudio,
): Promise<{ contentBase64: string; sizeBytes: number }> {
  const file = await alia.sdk.files.read({
    hostId: resolved.hostId,
    path: joinHostPath(resolved.rootPath, resolved.relativePath),
    rootPath: resolved.rootPath,
  });
  if (file.contentEncoding !== "base64") {
    throw new Error(
      "VesnALIA returned this audio file as text instead of bytes. Try Open with → Audio preview again.",
    );
  }
  return { contentBase64: file.content, sizeBytes: file.sizeBytes };
}

async function resolveWorkspaceRoot(
  alia: AliaPluginApi,
  source: AudioSource,
): Promise<{ hostId?: string; rootPath: string }> {
  if (source.environmentId) {
    const environment = await alia.sdk.environments.get({
      environmentId: source.environmentId,
    });
    if (!environment.path) {
      throw new Error("This environment has no workspace path yet.");
    }
    return { hostId: environment.hostId, rootPath: environment.path };
  }

  if (source.threadId) {
    const thread = await alia.sdk.threads.get({ threadId: source.threadId });
    if (thread.environmentId) {
      return resolveWorkspaceRoot(alia, {
        ...source,
        environmentId: thread.environmentId,
      });
    }
    if (thread.projectId) {
      return resolveProjectRoot(alia, thread.projectId);
    }
  }

  if (source.projectId) {
    return resolveProjectRoot(alia, source.projectId);
  }

  throw new Error("Cannot locate the workspace that contains this audio file.");
}

async function resolveProjectRoot(
  alia: AliaPluginApi,
  projectId: string,
): Promise<{ hostId: string; rootPath: string }> {
  const project = await alia.sdk.projects.get({ projectId });
  const row = project.sources.find((source) => source.isDefault) ?? project.sources[0];
  if (!row) {
    throw new Error("This project has no local path on a connected machine.");
  }
  return { hostId: row.hostId, rootPath: row.path };
}

async function resolveHostId(
  alia: AliaPluginApi,
  source: AudioSource,
): Promise<string | undefined> {
  if (source.environmentId) {
    const environment = await alia.sdk.environments.get({
      environmentId: source.environmentId,
    });
    return environment.hostId;
  }
  if (source.threadId) {
    const thread = await alia.sdk.threads.get({ threadId: source.threadId });
    if (thread.environmentId) {
      const environment = await alia.sdk.environments.get({
        environmentId: thread.environmentId,
      });
      return environment.hostId;
    }
    if (thread.projectId) {
      const root = await resolveProjectRoot(alia, thread.projectId);
      return root.hostId;
    }
  }
  if (source.projectId) {
    const root = await resolveProjectRoot(alia, source.projectId);
    return root.hostId;
  }
  return undefined;
}
