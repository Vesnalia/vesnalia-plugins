export const MAX_TITLE_LENGTH = 80;
export const MAX_PROJECT_LENGTH = 30;
export const MAX_DETAIL_LENGTH = 120;
export const PERSONAL_PROJECT_ID = "proj_personal";

export type NotificationKind = "idle" | "failed" | "test";
export type ThreadNotificationKind = Exclude<NotificationKind, "test">;

function compactTextToLength(
  value: string | null,
  maxLength: number,
): string | null {
  if (!value) return null;
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  return compact.length > maxLength
    ? `${compact.slice(0, maxLength - 1)}…`
    : compact;
}

export function compactText(value: string | null): string | null {
  return compactTextToLength(value, MAX_DETAIL_LENGTH);
}

export function compactTitle(value: string | null): string | null {
  return compactTextToLength(value, MAX_TITLE_LENGTH);
}

export function notificationTitle(
  projectName: string | null,
  threadTitle: string,
): string {
  const project = compactTextToLength(projectName, MAX_PROJECT_LENGTH);
  if (!project) return compactTitle(threadTitle) ?? "Untitled chat";
  const separator = " · ";
  const availableThreadLength =
    MAX_TITLE_LENGTH - project.length - separator.length;
  const thread =
    compactTextToLength(threadTitle, availableThreadLength) ?? "Untitled chat";
  return `${project}${separator}${thread}`;
}

export function resolveThreadTitle(thread: {
  title: string | null;
  titleFallback: string | null;
}): string {
  return (
    compactTitle(thread.title) ??
    compactTitle(thread.titleFallback) ??
    "Untitled chat"
  );
}

export function threadHref(
  projectId: string | null,
  threadId: string,
): string {
  if (!projectId || projectId === PERSONAL_PROJECT_ID) {
    return `/threads/${encodeURIComponent(threadId)}`;
  }
  return `/projects/${encodeURIComponent(projectId)}/threads/${encodeURIComponent(threadId)}`;
}

export function notificationContent(
  kind: ThreadNotificationKind,
  projectName: string | null,
  threadTitle: string,
  detail: string | null,
  showPreview: boolean,
): { title: string; body: string } {
  const status = kind === "idle" ? "alia agent finished" : "alia agent failed";
  return {
    title: notificationTitle(projectName, threadTitle),
    body: showPreview && detail ? `${status} — ${detail}` : status,
  };
}

export function isExpiredPushStatus(statusCode: number | null): boolean {
  return statusCode === 404 || statusCode === 410;
}

export function isRetryablePushStatus(statusCode: number | null): boolean {
  return statusCode === null || statusCode === 408 || statusCode === 429 || (statusCode >= 500 && statusCode < 600);
}
