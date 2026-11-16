export type SentryTag = { key: string; value: string };

export type SentryRelease = {
  version: string;
  shortVersion: string | null;
  dateCreated: string | null;
  dateReleased: string | null;
  url: string | null;
};

export type SentryActivity = {
  id: string;
  type: string;
  dateCreated: string | null;
};

export type SentrySafeValue =
  | string
  | number
  | boolean
  | null
  | SentrySafeValue[]
  | { [key: string]: SentrySafeValue };

export type SentryEventFrame = {
  filename: string | null;
  function: string | null;
  module: string | null;
  package: string | null;
  lineNumber: number | null;
  columnNumber: number | null;
  contextLine: string | null;
  preContext: string[];
  postContext: string[];
  inApp: boolean | null;
};

export type SentryException = {
  type: string | null;
  value: string | null;
  mechanism: SentrySafeValue | null;
  frames: SentryEventFrame[];
};

export type SentryBreadcrumb = {
  timestamp: string | null;
  category: string | null;
  message: string | null;
  level: string | null;
  data: SentrySafeValue | null;
};

export type SentryEventSummary = {
  id: string;
  title: string | null;
  message: string | null;
  platform: string | null;
  type: string | null;
  culprit: string | null;
  timestamp: string | null;
  environment: string | null;
  release: string | null;
  location: string | null;
  metadataType: string | null;
  metadataValue: string | null;
  tags: SentryTag[];
  exceptions: SentryException[];
  breadcrumbs: SentryBreadcrumb[];
  request: SentrySafeValue | null;
  contexts: SentrySafeValue | null;
  user: SentrySafeValue | null;
  sdk: SentrySafeValue | null;
  extra: SentrySafeValue | null;
};

export const sentryIssueSeverityValues = ["fatal", "error", "warning", "info", "debug", "unknown"] as const;
export type SentryIssueSeverity = (typeof sentryIssueSeverityValues)[number];
export const issueBadgeSeverityValues = ["error", "warning", "info"] as const;
export type IssueBadgeSeverity = (typeof issueBadgeSeverityValues)[number];
export type IssueBadgeEntry = {
  severity: IssueBadgeSeverity;
  count: number;
};

export function issueBadgeEntries(
  counts: Record<IssueBadgeSeverity, number>,
): IssueBadgeEntry[] {
  return issueBadgeSeverityValues.map((severity) => ({ severity, count: counts[severity] }));
}

export type SentryIssue = {
  id: string;
  shortId: string;
  title: string;
  status: string;
  severity: SentryIssueSeverity;
  firstSeen: string | null;
  lastSeen: string | null;
  count: number;
  environments: string[];
  topTags: SentryTag[];
  culprit: string | null;
  permalink: string | null;
};

export type SentryIssueTarget = {
  connectionId: string;
  connectionLabel: string;
  orgSlug: string;
  projectSlug: string;
};

export type SentryAggregatedIssue = SentryIssue & SentryIssueTarget;

export type SentryIssueSnapshotForAggregation = SentryIssueTarget & {
  issues: readonly SentryIssue[];
};

export type SentryIssueDetail = SentryIssue & {
  logger: string | null;
  level: string | null;
  platform: string | null;
  priority: string | null;
  substatus: string | null;
  issueType: string | null;
  issueCategory: string | null;
  projectId: string | null;
  projectName: string | null;
  projectSlug: string | null;
  userCount: number;
  numComments: number;
  userReportCount: number;
  assignedTo: string | null;
  firstRelease: SentryRelease | null;
  lastRelease: SentryRelease | null;
  activity: SentryActivity[];
  events: SentryEventSummary[];
  latestEvent: SentryEventSummary | null;
};


export type SentryProject = {
  id: string;
  slug: string;
  name: string;
};

export type SentryConnectionTarget = {
  baseUrl: string;
  orgSlug: string;
  projectSlugs: string[];
};

export type SentryConnectionTestProject = {
  slug: string;
  name: string | null;
  ok: boolean;
  error: string | null;
};

export type SentryConnectionTestResult = {
  ok: boolean;
  organization: {
    slug: string;
    name: string | null;
    ok: boolean;
    error: string | null;
  };
  projects: SentryConnectionTestProject[];
  fallback: boolean;
  warning: string | null;
};

export type SentryProjectDiscoveryResult = {
  projects: SentryProject[];
  fallback: boolean;
  warning: string | null;
};

export type SentryConnectionHealthStatus = "unknown" | "healthy" | "degraded" | "failed";

export type SentryConnectionFailure = {
  at: string;
  message: string;
};

export type SentryConnectionHealthFields = {
  lastSuccessfulSync: string | null;
  lastFailure: SentryConnectionFailure | null;
  failedProjects: string[];
  lastTestedAt: string | null;
};

export type SentryConnectionHealth = SentryConnectionHealthFields & {
  status: SentryConnectionHealthStatus;
};

export function connectionHealth(fields: SentryConnectionHealthFields): SentryConnectionHealth {
  const latestGood = Math.max(
    fields.lastSuccessfulSync === null ? 0 : Date.parse(fields.lastSuccessfulSync),
    fields.failedProjects.length > 0 || fields.lastTestedAt === null ? 0 : Date.parse(fields.lastTestedAt),
  );
  const failureAt = fields.lastFailure === null ? 0 : Date.parse(fields.lastFailure.at);
  let status: SentryConnectionHealthStatus = "unknown";
  if (fields.failedProjects.length > 0) {
    status = latestGood > 0 && latestGood >= failureAt ? "degraded" : "failed";
  } else if (latestGood > 0 && latestGood >= failureAt) {
    status = "healthy";
  } else if (fields.lastFailure !== null) {
    status = "failed";
  }
  return { ...fields, status };
}

export function emptyConnectionHealth(): SentryConnectionHealth {
  return connectionHealth({
    lastSuccessfulSync: null,
    lastFailure: null,
    failedProjects: [],
    lastTestedAt: null,
  });
}

export function healthAfterSync(
  current: SentryConnectionHealth,
  projectSlug: string,
  at: string,
  error: string | null,
): SentryConnectionHealth {
  const failedProjects = new Set(current.failedProjects);
  if (error === null) failedProjects.delete(projectSlug);
  else failedProjects.add(projectSlug);
  return connectionHealth({
    lastSuccessfulSync: error === null ? at : current.lastSuccessfulSync,
    lastFailure: error === null ? current.lastFailure : { at, message: error },
    failedProjects: Array.from(failedProjects),
    lastTestedAt: current.lastTestedAt,
  });
}

export function healthAfterTest(
  current: SentryConnectionHealth,
  projectResults: SentryConnectionTestProject[],
  at: string,
): SentryConnectionHealth {
  const failedProjects = projectResults.filter((project) => !project.ok).map((project) => project.slug);
  const firstFailure = projectResults.find((project) => !project.ok)?.error ?? "Sentry connection test failed.";
  return connectionHealth({
    lastSuccessfulSync: current.lastSuccessfulSync,
    lastFailure: failedProjects.length === 0 ? current.lastFailure : { at, message: firstFailure },
    failedProjects,
    lastTestedAt: at,
  });
}

export function splitProjectSlugs(value: string): string[] {
  return Array.from(new Set(value.split(/[\n,]+/u).map((item) => item.trim()).filter(Boolean)));
}

type SentryRecord = Record<string, unknown>;

export const MAX_NORMALIZED_STRING_LENGTH = 1000;
export const MAX_SENTRY_RESPONSE_BYTES = 512 * 1024;
export const TRUNCATION_MARKER = "[truncated]";
// ponytail: cap discovery at 20 pages/500 projects; add resumable paging only if larger orgs need it.
const MAX_DISCOVERED_PROJECTS = 500;
const MAX_DISCOVERY_PAGES = 20;
const PROJECT_DISCOVERY_PAGE_SIZE = 100;

export function truncateText(
  value: string,
  limit = MAX_NORMALIZED_STRING_LENGTH,
): string {
  const max = Math.max(0, Math.floor(limit));
  if (value.length <= max) return value;
  if (max <= TRUNCATION_MARKER.length) return TRUNCATION_MARKER.slice(0, max);
  return value.slice(0, max - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
}

function record(value: unknown): SentryRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as SentryRecord)
    : {};
}

function text(value: unknown, fallback: string | null = null): string | null {
  const result = typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
  const candidate = result === "" ? fallback : result;
  return candidate === null ? null : truncateText(safeDataUrl(candidate.trim()));
}

function redactPiiUnbounded(value: string): string {
  return value
    .replace(/[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+/giu, "[redacted]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[redacted]")
    .replace(/\b(?:[0-9a-f]{1,4}:){2,}[0-9a-f:]*\b/giu, "[redacted]");
}

export function redactPii(
  value: string,
  limit = MAX_NORMALIZED_STRING_LENGTH,
): string {
  return truncateText(redactPiiUnbounded(value), limit);
}

function safeText(value: unknown, fallback: string | null = null): string | null {
  const result = text(value, fallback);
  return result === null ? null : redactPii(result);
}

const MAX_SAFE_VALUE_DEPTH = 4;
const MAX_SAFE_VALUE_ENTRIES = 24;
const MAX_SAFE_VALUE_STRING_LENGTH = MAX_NORMALIZED_STRING_LENGTH;
const sensitiveDataKeyPattern = /(?:authorization|cookie|password|passcode|secret|token|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|private[-_]?key|session|csrf|jwt|ssn)/iu;

function isSensitiveDataKey(key: string): boolean {
  return sensitiveDataKeyPattern.test(key.replace(/\s+/gu, "").toLowerCase());
}

function sanitizeUrl(url: URL): URL {
  for (const [key, value] of url.searchParams) {
    if (isSensitiveDataKey(key) || redactPiiUnbounded(value) !== value) {
      url.searchParams.set(key, "[redacted]");
    }
  }
  url.hash = "";
  return url;
}

function safeDataUrlCandidate(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.username !== "" || url.password !== "") return "[redacted url]";
    if (url.protocol === "http:" || url.protocol === "https:") {
      return sanitizeUrl(url).toString();
    }
  } catch {
    return null;
  }
  return null;
}

function safeDataUrl(value: string): string {
  const exact = safeDataUrlCandidate(value);
  if (exact !== null) return exact;
  return value.replace(/https?:\/\/[^\s"'<>]+/giu, (candidate) =>
    safeDataUrlCandidate(candidate) ?? candidate,
  );
}

function normalizeSafeValue(
  value: unknown,
  key = "",
  depth = 0,
  seen = new WeakSet<object>(),
): SentrySafeValue {
  if (isSensitiveDataKey(key)) return "[redacted]";
  if (value === null) return null;
  if (typeof value === "string") {
    const normalized = safeDataUrl(value);
    return redactPii(normalized, MAX_SAFE_VALUE_STRING_LENGTH);
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : "[redacted]";
  if (typeof value === "boolean") return value;
  if (depth >= MAX_SAFE_VALUE_DEPTH) return "[truncated]";
  if (typeof value !== "object") return "[redacted]";
  if (seen.has(value)) return "[circular]";

  seen.add(value);
  if (Array.isArray(value)) {
    const result = value
      .slice(0, MAX_SAFE_VALUE_ENTRIES)
      .map((entry) => normalizeSafeValue(entry, key, depth + 1, seen));
    if (value.length > MAX_SAFE_VALUE_ENTRIES) result.push("[truncated]");
    seen.delete(value);
    return result;
  }

  const result: { [key: string]: SentrySafeValue } = {};
  const entries = Object.entries(value).slice(0, MAX_SAFE_VALUE_ENTRIES);
  for (const [entryKey, entryValue] of entries) {
    const safeKey = truncateText(redactPiiUnbounded(entryKey), 120);
    result[safeKey] = normalizeSafeValue(entryValue, entryKey, depth + 1, seen);
  }
  if (Object.keys(value).length > MAX_SAFE_VALUE_ENTRIES) result["[truncated]"] = "[truncated]";
  seen.delete(value);
  return result;
}

function optionalSafeValue(value: unknown): SentrySafeValue | null {
  return value === undefined ? null : normalizeSafeValue(value);
}

function safeValueText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "number") return safeText(value);
  return redactPii(JSON.stringify(normalizeSafeValue(value)), MAX_SAFE_VALUE_STRING_LENGTH);
}

function safeNumber(value: unknown): number | null {
  if (typeof value === "string" && value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function safeBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function safeStringList(value: unknown, limit: number): string[] {
  return (Array.isArray(value) ? value : [])
    .map((entry) => safeText(entry))
    .filter((entry): entry is string => entry !== null)
    .slice(0, limit);
}

function normalizeEventFrames(value: unknown): SentryEventFrame[] {
  return (Array.isArray(value) ? value : [])
    .map((frame) => {
      const item = record(frame);
      return {
        filename: safeText(item.filename ?? item.absPath ?? item.path),
        function: safeText(item.function ?? item.rawFunction),
        module: safeText(item.module),
        package: safeText(item.package),
        lineNumber: safeNumber(item.lineNo ?? item.lineNumber),
        columnNumber: safeNumber(item.colNo ?? item.columnNo ?? item.columnNumber),
        contextLine: safeText(item.contextLine ?? item.context_line),
        preContext: safeStringList(item.preContext ?? item.pre_context, 5),
        postContext: safeStringList(item.postContext ?? item.post_context, 5),
        inApp: safeBoolean(item.inApp ?? item.in_app),
      };
    })
    .slice(0, 50);
}

function normalizeExceptions(value: unknown): SentryException[] {
  const root = record(value);
  const values = Array.isArray(value)
    ? value
    : Array.isArray(root.values)
      ? root.values
      : value === undefined
        ? []
        : [value];
  return values.slice(0, 10).map((exception) => {
    const item = record(exception);
    const stacktrace = record(item.stacktrace);
    return {
      type: safeText(item.type),
      value: safeText(item.value),
      mechanism: optionalSafeValue(item.mechanism),
      frames: normalizeEventFrames(stacktrace.frames ?? item.frames),
    };
  });
}

function normalizeBreadcrumbs(value: unknown): SentryBreadcrumb[] {
  const root = record(value);
  const values = Array.isArray(value)
    ? value
    : Array.isArray(root.values)
      ? root.values
      : [];
  return values.slice(0, 100).map((breadcrumb) => {
    const item = record(breadcrumb);
    return {
      timestamp: text(item.timestamp ?? item.dateCreated),
      category: safeText(item.category),
      message: safeText(item.message),
      level: safeText(item.level),
      data: optionalSafeValue(item.data),
    };
  });
}

function eventEntryData(event: SentryRecord, type: string): unknown {
  const entry = (Array.isArray(event.entries) ? event.entries : [])
    .find((candidate) => record(candidate).type === type);
  return entry === undefined ? undefined : record(entry).data;
}

function safeUrl(value: unknown): string | null {
  const result = text(value);
  if (result === null) return null;
  try {
    const url = new URL(result);
    if (
      url.username !== "" ||
      url.password !== "" ||
      (url.protocol !== "https:" && url.protocol !== "http:")
    ) {
      return null;
    }
    return sanitizeUrl(url).toString();
  } catch {
    return null;
  }
}

function stringValues(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((entry) => {
    if (typeof entry === "string") return [text(entry)].filter((item): item is string => item !== null);
    const item = record(entry);
    const name = text(item.name ?? item.environment ?? item.value);
    return name === null ? [] : [name];
  });
}

function countValue(value: unknown): number {
  const result = Number(value ?? 0);
  return Number.isFinite(result)
    ? Math.min(Math.max(Math.round(result), 0), Number.MAX_SAFE_INTEGER)
    : 0;
}

function isSensitiveTagValue(value: string): boolean {
  return isSensitiveDataKey(value) ||
    /^(?:bearer|basic)\s+\S+$/iu.test(value) ||
    /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/u.test(value);
}

function normalizeTagValues(value: unknown, limit: number): SentryTag[] {
  return (Array.isArray(value) ? value : [])
    .flatMap((tag) => {
      const item = record(tag);
      const rawKey = item.key ?? item.name;
      const rawValue = item.value;
      if (
        (typeof rawKey === "string" && isSensitiveDataKey(rawKey)) ||
        (typeof rawValue === "string" && isSensitiveTagValue(rawValue))
      ) return [];
      const key = safeText(rawKey);
      const tagValue = safeText(rawValue);
      return key === null || tagValue === null ? [] : [{ key, value: tagValue }];
    })
    .slice(0, limit);
}

function normalizeRelease(value: unknown): SentryRelease | null {
  const item = record(value);
  const version = safeText(item.version ?? item.shortVersion ?? value);
  if (version === null) return null;
  return {
    version,
    shortVersion: safeText(item.shortVersion),
    dateCreated: text(item.dateCreated),
    dateReleased: text(item.dateReleased),
    url: safeUrl(item.url),
  };
}

function normalizeActivity(value: unknown): SentryActivity[] {
  return (Array.isArray(value) ? value : [])
    .flatMap((activity, index) => {
      const item = record(activity);
      const type = safeText(item.type, "activity");
      if (type === null) return [];
      return [{
        id: text(item.id, `${type}-${index}`)!,
        type,
        dateCreated: text(item.dateCreated),
      }];
    })
    .slice(0, 20);
}


export function normalizeSentryProject(input: unknown): SentryProject | null {
  const project = record(input);
  const slug = safeText(project.slug ?? project.projectSlug ?? project.id);
  const id = text(project.id ?? project.projectId ?? slug);
  const name = safeText(project.name ?? slug);
  if (id === null || slug === null || name === null) return null;
  return { id, slug, name };
}

export function normalizeSentryProjects(input: unknown): SentryProject[] {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Map(
      input
        .map(normalizeSentryProject)
        .filter((project): project is SentryProject => project !== null)
        .map((project) => [project.slug, project] as const),
    ).values(),
  ).slice(0, 100);
}

export function normalizeIssueEvent(input: unknown): SentryEventSummary {
  const event = record(input);
  const tags = normalizeTagValues(event.tags, 12);
  const metadata = record(event.metadata);
  const exceptionEntry = eventEntryData(event, "exception");
  const breadcrumbEntry = eventEntryData(event, "breadcrumbs");
  const requestEntry = eventEntryData(event, "request");
  const contextsEntry = eventEntryData(event, "contexts");
  const userEntry = eventEntryData(event, "user");
  const sdkEntry = eventEntryData(event, "sdk");
  const extraEntry = eventEntryData(event, "extra");
  return {
    id: text(event.eventID ?? event.id, "unknown")!,
    title: safeText(event.title ?? event.message),
    message: safeText(event.message),
    platform: safeText(event.platform),
    type: safeText(event["event.type"] ?? event.type),
    culprit: safeText(event.culprit),
    timestamp: text(event.dateCreated ?? event.dateReceived ?? event.timestamp),
    environment: tags.find((tag) => tag.key === "environment")?.value ?? safeText(event.environment),
    release: tags.find((tag) => tag.key === "release")?.value ?? safeText(event.release),
    location: safeText(event.location),
    metadataType: safeText(metadata.type),
    metadataValue: safeValueText(metadata.value ?? metadata.title),
    tags,
    exceptions: normalizeExceptions(event.exception ?? exceptionEntry),
    breadcrumbs: normalizeBreadcrumbs(event.breadcrumbs ?? breadcrumbEntry),
    request: optionalSafeValue(event.request ?? requestEntry),
    contexts: optionalSafeValue(event.contexts ?? event.context ?? contextsEntry),
    user: optionalSafeValue(event.user ?? userEntry),
    sdk: optionalSafeValue(event.sdk ?? sdkEntry),
    extra: optionalSafeValue(event.extra ?? extraEntry),
  };
}

export function eventDetailOrSummary(
  summary: SentryEventSummary | null,
  detail: SentryEventSummary | null,
): SentryEventSummary | null {
  return detail ?? summary;
}

export function normalizeIssueDetail(input: unknown): SentryIssueDetail {
  const issue = record(input);
  const project = record(issue.project);
  const assignedTo = record(issue.assignedTo);
  return {
    ...normalizeIssue(input),
    logger: safeText(issue.logger),
    level: safeText(issue.level),
    platform: safeText(issue.platform ?? project.platform),
    priority: safeText(issue.priority),
    substatus: safeText(issue.substatus),
    issueType: safeText(issue.issueType ?? issue.type),
    issueCategory: safeText(issue.issueCategory),
    projectId: text(project.id ?? project.projectId ?? issue.projectId ?? issue.project_id),
    projectName: safeText(project.name ?? issue.projectName),
    projectSlug: safeText(
      project.slug ??
        project.projectSlug ??
        issue.projectSlug ??
        issue.project_slug ??
        (typeof issue.project === "string" ? issue.project : undefined),
    ),
    userCount: countValue(issue.userCount),
    numComments: countValue(issue.numComments),
    userReportCount: countValue(issue.userReportCount),
    assignedTo: safeText(assignedTo.name ?? assignedTo.username ?? assignedTo.id),
    firstRelease: normalizeRelease(issue.firstRelease),
    lastRelease: normalizeRelease(issue.lastRelease),
    activity: normalizeActivity(issue.activity),
    events: [],
    latestEvent: null,
  };
}

function identityText(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const result = String(value).trim();
  return result === "" ? null : result;
}

function identityValues(values: readonly unknown[]): string[] {
  return values
    .map(identityText)
    .filter((value): value is string => value !== null);
}

export function issueBelongsToProject(input: unknown, projectSlug: string): boolean {
  const issue = record(input);
  const project = record(issue.project);
  const candidates = identityValues([
    project.slug,
    project.projectSlug,
    issue.projectSlug,
    issue.project_slug,
    typeof issue.project === "string" ? issue.project : null,
  ]);
  return candidates.length > 0 && candidates.every((candidate) => candidate === projectSlug);
}

export function eventBelongsToIssue(
  input: unknown,
  issueId: string,
  projectSlug: string,
  allowUnidentified = false,
): boolean {
  const event = record(input);
  const issueReference = record(event.issue);
  const projectReference = record(event.project);
  const issueCandidates = identityValues([
    event.groupID,
    event.groupId,
    event.group_id,
    event.issueId,
    event.issue_id,
    issueReference.id,
    issueReference.issueId,
    issueReference.groupID,
    issueReference.groupId,
  ]);
  const projectCandidates = identityValues([
    event.projectSlug,
    event.project_slug,
    typeof event.project === "string" ? event.project : null,
    projectReference.slug,
    projectReference.projectSlug,
  ]);
  if (issueCandidates.length === 0 && !allowUnidentified) return false;
  return issueCandidates.every((candidate) => candidate === issueId) &&
    projectCandidates.every((candidate) => candidate === projectSlug);
}

function issueSeverity(value: unknown): SentryIssueSeverity {
  const normalized = text(value)?.toLowerCase();
  return normalized !== undefined && (sentryIssueSeverityValues as readonly string[]).includes(normalized)
    ? normalized as SentryIssueSeverity
    : "unknown";
}

export function normalizeIssue(input: unknown): SentryIssue {
  const issue = record(input);
  const id = text(issue.id ?? issue.issueId, "unknown")!;
  const shortId = text(issue.shortId ?? issue.short_id, id)!;
  const topTags = normalizeTagValues(issue.tags, 8);
  const environments = Array.from(
    new Set(
      stringValues(issue.environments ?? issue.environment)
        .map(redactPii)
        .filter(Boolean),
    ),
  ).slice(0, 8);
  const count = countValue(issue.count);

  return {
    id,
    shortId,
    title: safeText(issue.title ?? issue.message, "Untitled Sentry issue")!,
    status: safeText(issue.status, "unknown")!,
    severity: issueSeverity(issue.level ?? issue.severity),
    firstSeen: text(issue.firstSeen),
    lastSeen: text(issue.lastSeen),
    count,
    environments,
    topTags,
    culprit: safeText(issue.culprit),
    permalink: safeUrl(issue.permalink ?? issue.url),
  };
}

export function sortIssuesByRecent<T extends SentryIssue>(issues: readonly T[]): T[] {
  return [...issues].sort((left, right) => {
    const rightTime = right.lastSeen === null ? 0 : Date.parse(right.lastSeen);
    const leftTime = left.lastSeen === null ? 0 : Date.parse(left.lastSeen);
    return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
  });
}

export function issueRouteKey(connectionId: string, projectSlug: string, issueId: string): string {
  return ["issue", connectionId, projectSlug, issueId].map(encodeURIComponent).join("/");
}

export type SentryTriageThreadLink = {
  threadId: string;
  projectId: string;
  createdAt: string;
  title: string | null;
  status: string | null;
};

export function dedupeTriageThreadLinks(
  links: readonly SentryTriageThreadLink[],
  limit = 20,
): SentryTriageThreadLink[] {
  const seen = new Set<string>();
  return links.filter((link) => {
    if (seen.has(link.threadId)) return false;
    seen.add(link.threadId);
    return true;
  }).slice(0, Math.max(0, limit));
}

export function aggregateIssues(
  targets: readonly SentryIssueSnapshotForAggregation[],
): SentryAggregatedIssue[] {
  const seen = new Set<string>();
  const issues: SentryAggregatedIssue[] = [];
  for (const target of targets) {
    for (const issue of target.issues) {
      const key = issueRouteKey(target.connectionId, target.projectSlug, issue.id);
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push({
        ...issue,
        connectionId: target.connectionId,
        connectionLabel: target.connectionLabel,
        orgSlug: target.orgSlug,
        projectSlug: target.projectSlug,
      });
    }
  }
  return sortIssuesByRecent(issues);
}

export function mergeIssuePages(
  existing: readonly SentryIssue[],
  incoming: readonly SentryIssue[],
  maxIssues: number,
): SentryIssue[] {
  const merged = new Map(existing.map((issue) => [issue.id, issue]));
  for (const issue of incoming) merged.set(issue.id, issue);
  return sortIssuesByRecent(Array.from(merged.values())).slice(0, Math.max(0, maxIssues));
}

export type CachedBadgeTarget = {
  issues: readonly SentryIssue[] | null;
  newIssueCount?: number;
  complete: boolean;
  warning: string | null;
  healthStatus: SentryConnectionHealthStatus;
};

export function countNewIssues(
  previous: readonly SentryIssue[] | null,
  current: readonly SentryIssue[],
): number {
  if (previous === null) return 0;
  const knownIds = new Set(previous.map((issue) => issue.id));
  return current.filter((issue) =>
    issue.status.toLowerCase() === "unresolved" && !knownIds.has(issue.id),
  ).length;
}

function badgeSeverityForIssue(severity: SentryIssueSeverity): IssueBadgeSeverity {
  if (severity === "fatal" || severity === "error") return "error";
  if (severity === "warning") return "warning";
  return "info";
}

export function cachedBadgeState(targets: readonly CachedBadgeTarget[]): {
  count: number;
  severityCounts: Record<IssueBadgeSeverity, number>;
  error: boolean;
  complete: boolean;
  newIssueCount: number;
} {
  let count = 0;
  const severityCounts: Record<IssueBadgeSeverity, number> = {
    error: 0,
    warning: 0,
    info: 0,
  };
  let complete = true;
  let error = false;
  let newIssueCount = 0;
  for (const target of targets) {
    const targetNewIssueCount = target.newIssueCount ?? 0;
    newIssueCount += targetNewIssueCount;
    if (target.issues === null) {
      complete = false;
    } else {
      for (const issue of target.issues) {
        if (issue.status.toLowerCase() !== "unresolved") continue;
        count += 1;
        severityCounts[badgeSeverityForIssue(issue.severity ?? "unknown")] += 1;
      }
    }
    if (!target.complete) complete = false;
    if (target.warning !== null || target.healthStatus !== "healthy") {
      error = true;
    }
  }
  return { count, severityCounts, error: error || !complete, complete, newIssueCount };
}

export function validateSentryBaseUrl(value: string): URL {
  let base: URL;
  try {
    base = new URL(value);
  } catch {
    throw new Error("Sentry base URL must be a valid URL.");
  }
  const hostname = base.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  const loopbackHttp = base.protocol === "http:" &&
    (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1");
  if (base.protocol !== "https:" && !loopbackHttp) {
    throw new Error("Sentry base URL must use https, or http://localhost for local development.");
  }
  if (base.username !== "" || base.password !== "") {
    throw new Error("Sentry base URL must not contain credentials.");
  }
  if (base.search !== "" || base.hash !== "") {
    throw new Error("Sentry base URL must not contain a query or fragment.");
  }
  return base;
}

function sentryResourceUrl(baseUrl: string, pathname: string): URL {
  const base = validateSentryBaseUrl(baseUrl);
  const prefix = base.pathname.replace(/\/+$/, "");
  base.pathname = `${prefix}${pathname}`;
  base.search = "";
  base.hash = "";
  return base;
}

function issueUrl(
  baseUrl: string,
  pathname: string,
  filters: {
    environment: string;
    timeRange: string;
    query: string;
    limit: number;
    cursor?: string | null;
  },
): URL {
  const base = sentryResourceUrl(baseUrl, pathname);
  base.searchParams.set("statsPeriod", filters.timeRange);
  if (filters.environment.trim() !== "") base.searchParams.set("environment", filters.environment.trim());
  base.searchParams.set("query", filters.query.trim());
  base.searchParams.set("limit", String(filters.limit));
  if (filters.cursor?.trim()) base.searchParams.set("cursor", filters.cursor.trim());
  return base;
}

export function buildIssuesUrl(
  baseUrl: string,
  orgSlug: string,
  projectSlug: string,
  filters: {
    environment: string;
    timeRange: string;
    query: string;
    limit: number;
    cursor?: string | null;
  },
): URL {
  return issueUrl(
    baseUrl,
    `/api/0/projects/${encodeURIComponent(orgSlug)}/${encodeURIComponent(projectSlug)}/issues/`,
    filters,
  );
}

export function buildOrganizationIssuesUrl(
  baseUrl: string,
  orgSlug: string,
  projectSlug: string,
  filters: {
    environment: string;
    timeRange: string;
    query: string;
    limit: number;
    cursor?: string | null;
  },
): URL {
  const url = issueUrl(baseUrl, `/api/0/organizations/${encodeURIComponent(orgSlug)}/issues/`, filters);
  url.searchParams.append("project", projectSlug);
  return url;
}


export function buildOrganizationProjectsUrl(baseUrl: string, orgSlug: string): URL {
  const url = sentryResourceUrl(
    baseUrl,
    "/api/0/organizations/" + encodeURIComponent(orgSlug) + "/projects/",
  );
  url.searchParams.set("per_page", "100");
  return url;
}

export function buildIssueDetailUrl(
  baseUrl: string,
  orgSlug: string,
  issueId: string,
  environment = "",
): URL {
  const url = sentryResourceUrl(
    baseUrl,
    `/api/0/organizations/${encodeURIComponent(orgSlug)}/issues/${encodeURIComponent(issueId)}/`,
  );
  if (environment.trim() !== "") url.searchParams.set("environment", environment.trim());
  return url;
}

export function buildEventDetailUrl(
  baseUrl: string,
  orgSlug: string,
  projectSlug: string,
  eventId: string,
): URL {
  return sentryResourceUrl(
    baseUrl,
    `/api/0/projects/${encodeURIComponent(orgSlug)}/${encodeURIComponent(projectSlug)}/events/${encodeURIComponent(eventId)}/`,
  );
}


export class SentryApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "SentryApiError";
    this.status = status;
  }
}

export function sentryErrorMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  const normalized = message.replace(/\s+/gu, " ").trim();
  return redactPii(normalized === "" ? "Sentry request failed." : normalized, 500);
}

export function isProjectDiscoveryFallbackStatus(status: number): boolean {
  return status === 403 || status === 404 || status === 405 || status === 501;
}

function abortError(signal?: AbortSignal): Error {
  const reason = signal?.reason;
  if (reason instanceof Error && reason.name === "AbortError") return reason;
  const error = new Error("Sentry request was aborted.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

function isAbortSignalError(cause: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || cause instanceof Error && cause.name === "AbortError";
}

async function readWithAbort<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return work;
  throwIfAborted(signal);
  let onAbort: (() => void) | null = null;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([work, aborted]);
  } finally {
    if (onAbort !== null) signal.removeEventListener("abort", onAbort);
  }
}

async function fetchSentryResponse(
  url: URL,
  token: string,
  signal?: AbortSignal,
): Promise<Response> {
  throwIfAborted(signal);
  const requestSignal = signal === undefined
    ? AbortSignal.timeout(15_000)
    : AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
  try {
    return await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer " + token,
      },
      signal: requestSignal,
    });
  } catch (cause) {
    if (signal?.aborted) throw abortError(signal);
    throw new SentryApiError(0, "Sentry request could not be reached.");
  }
}

function boundedCursor(value: string): string {
  const cursor = value.trim();
  if (cursor.length > 200) {
    throw new Error("Sentry returned a next cursor that was too large " + TRUNCATION_MARKER + ".");
  }
  return cursor;
}

function nextLinkFromHeader(link: string | null): {
  found: boolean;
  cursor: string | null;
} {
  if (link === null) return { found: false, cursor: null };
  for (const entry of link.split(/,\s*(?=<)/u)) {
    const match = entry.match(/^<([^>]+)>\s*;([\s\S]*)$/u);
    if (match === null) continue;
    const parameters = match[2];
    const relation = parameters.match(/(?:^|;)\s*rel=(?:"([^"]+)"|([^;\s]+))/iu);
    if ((relation?.[1] ?? relation?.[2] ?? "").toLowerCase() !== "next") continue;
    const results = parameters.match(/(?:^|;)\s*results=(?:"([^"]+)"|([^;\s]+))/iu);
    if ((results?.[1] ?? results?.[2] ?? "").toLowerCase() === "false") {
      return { found: true, cursor: null };
    }
    try {
      const cursor = new URL(match[1]).searchParams.get("cursor");
      if (cursor?.trim()) return { found: true, cursor: boundedCursor(cursor) };
    } catch {
      // Keep checking the header parameters before rejecting an unusable next link.
    }
    const cursor = parameters.match(/(?:^|;)\s*cursor=(?:"([^"]+)"|([^;\s]+))/iu);
    if (cursor?.[1] ?? cursor?.[2]) {
      return { found: true, cursor: boundedCursor(cursor[1] ?? cursor[2] ?? "") };
    }
    throw new Error("Sentry returned a next link without a usable cursor.");
  }
  return { found: false, cursor: null };
}

export function nextCursorFromLink(link: string | null): string | null {
  return nextLinkFromHeader(link).cursor;
}

async function readSentryResponseText(
  response: Response,
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal);
  const declaredLength = response.headers.get("content-length");
  const declaredBytes = declaredLength === null ? null : Number(declaredLength);
  if (declaredBytes !== null && Number.isFinite(declaredBytes) && declaredBytes > MAX_SENTRY_RESPONSE_BYTES) {
    throw new SentryApiError(
      response.status,
      "Sentry response exceeded " + MAX_SENTRY_RESPONSE_BYTES + " bytes " + TRUNCATION_MARKER + ".",
    );
  }

  if (response.body === null) {
    const body = await readWithAbort(response.text(), signal);
    throwIfAborted(signal);
    if (new TextEncoder().encode(body).byteLength > MAX_SENTRY_RESPONSE_BYTES) {
      throw new SentryApiError(
        response.status,
        "Sentry response exceeded " + MAX_SENTRY_RESPONSE_BYTES + " bytes " + TRUNCATION_MARKER + ".",
      );
    }
    return body;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await readWithAbort(reader.read(), signal);
      if (chunk.done) break;
      throwIfAborted(signal);
      bytes += chunk.value.byteLength;
      if (bytes > MAX_SENTRY_RESPONSE_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The response is already being rejected; cancellation is best effort.
        }
        throw new SentryApiError(
          response.status,
          "Sentry response exceeded " + MAX_SENTRY_RESPONSE_BYTES + " bytes " + TRUNCATION_MARKER + ".",
        );
      }
      chunks.push(decoder.decode(chunk.value, { stream: true }));
    }
    throwIfAborted(signal);
    chunks.push(decoder.decode());
    return chunks.join("");
  } catch (cause) {
    if (isAbortSignalError(cause, signal)) {
      try {
        await reader.cancel();
      } catch {
        // Aborted reads are already being rejected; cancellation is best effort.
      }
      throw abortError(signal);
    }
    throw cause;
  } finally {
    reader.releaseLock();
  }
}

export async function fetchSentryPage(
  url: URL,
  token: string,
  signal?: AbortSignal,
): Promise<{
  body: unknown;
  nextCursor: string | null;
  hasNextLink: boolean;
}> {
  const response = await fetchSentryResponse(url, token, signal);
  throwIfAborted(signal);
  if (!response.ok) {
    if (response.status === 401) {
      throw new SentryApiError(response.status, "Sentry rejected the token (401). Check its read-only scopes.");
    }
    if (response.status === 403) {
      throw new SentryApiError(response.status, "Sentry rejected the request (403). Check the token scopes and organization access.");
    }
    if (response.status === 429) {
      throw new SentryApiError(response.status, "Sentry rate-limited the request. Try again shortly.");
    }
    throw new SentryApiError(response.status, "Sentry request failed (" + response.status + ").");
  }

  let body: unknown;
  try {
    body = JSON.parse(await readSentryResponseText(response, signal));
  } catch (cause) {
    if (isAbortSignalError(cause, signal)) throw abortError(signal);
    if (cause instanceof SentryApiError) throw cause;
    throw new SentryApiError(response.status, "Sentry returned invalid JSON.");
  }
  throwIfAborted(signal);
  const link = response.headers.get("link");
  const next = nextLinkFromHeader(link);
  return {
    body,
    nextCursor: next.cursor,
    hasNextLink: next.found,
  };
}

export async function fetchSentryJson(
  url: URL,
  token: string,
  signal?: AbortSignal,
): Promise<unknown> {
  return (await fetchSentryPage(url, token, signal)).body;
}

export async function discoverSentryProjects(
  baseUrl: string,
  orgSlug: string,
  token: string,
  signal?: AbortSignal,
): Promise<SentryProjectDiscoveryResult> {
  try {
    const projects = new Map<string, SentryProject>();
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    let warning: string | null = null;

    for (let pageNumber = 0; pageNumber < MAX_DISCOVERY_PAGES; pageNumber += 1) {
      const url = buildOrganizationProjectsUrl(baseUrl, orgSlug);
      if (cursor !== null) url.searchParams.set("cursor", cursor);
      const page = await fetchSentryPage(url, token, signal);
      if (!Array.isArray(page.body)) throw new Error("Sentry returned an unexpected project list.");
      for (const project of normalizeSentryProjects(page.body)) {
        projects.set(project.slug, project);
        if (projects.size >= MAX_DISCOVERED_PROJECTS) break;
      }

      const pageLooksFullButHasNoCursor =
        page.nextCursor === null && !page.hasNextLink && page.body.length >= PROJECT_DISCOVERY_PAGE_SIZE;
      if (projects.size >= MAX_DISCOVERED_PROJECTS) {
        warning = page.nextCursor !== null || pageLooksFullButHasNoCursor
          ? "Project discovery was capped at the first 500 projects; enter a project slug manually for anything beyond this bound."
          : null;
        if (warning === null) cursor = null;
        break;
      }
      if (page.nextCursor === null) {
        if (pageLooksFullButHasNoCursor) {
          warning = "Sentry returned a full project page without a usable pagination link; the discovered project list may be incomplete.";
        }
        cursor = null;
        break;
      }
      if (seenCursors.has(page.nextCursor)) {
        warning = "Sentry repeated a project pagination cursor; the discovered project list may be incomplete.";
        break;
      }
      seenCursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }

    if (cursor !== null && warning === null) {
      warning = "Project discovery stopped at a safe pagination bound; the discovered project list may be incomplete.";
    }
    return {
      projects: Array.from(projects.values()).slice(0, MAX_DISCOVERED_PROJECTS),
      fallback: false,
      warning,
    };
  } catch (cause) {
    if (isAbortSignalError(cause, signal)) throw abortError(signal);
    if (!(cause instanceof SentryApiError) || !isProjectDiscoveryFallbackStatus(cause.status)) {
      throw cause instanceof Error ? cause : new Error(sentryErrorMessage(cause));
    }
    const warning = cause.status === 403
      ? "Sentry did not allow project discovery. Enter project slugs manually; org:read may be required."
      : "Project discovery is unavailable on this Sentry instance. Enter project slugs manually.";
    return { projects: [], fallback: true, warning };
  }
}

export async function testSentryConnection(
  target: SentryConnectionTarget,
  token: string,
  signal?: AbortSignal,
): Promise<SentryConnectionTestResult> {
  let discovery: SentryProjectDiscoveryResult;
  try {
    discovery = await discoverSentryProjects(target.baseUrl, target.orgSlug, token, signal);
  } catch (cause) {
    if (isAbortSignalError(cause, signal)) throw abortError(signal);
    const error = sentryErrorMessage(cause);
    return {
      ok: false,
      organization: { slug: target.orgSlug, name: null, ok: false, error },
      projects: target.projectSlugs.map((slug) => ({
        slug,
        name: null,
        ok: false,
        error,
      })),
      fallback: false,
      warning: null,
    };
  }

  const discovered = new Map(discovery.projects.map((project) => [project.slug, project]));
  const projects: SentryConnectionTestProject[] = [];
  for (const slug of target.projectSlugs) {
    throwIfAborted(signal);
    const project = discovered.get(slug);
    if (project !== undefined) {
      projects.push({ slug, name: project.name, ok: true, error: null });
      continue;
    }

    try {
      const body = await fetchSentryJson(
        buildIssuesUrl(target.baseUrl, target.orgSlug, slug, {
          environment: "",
          timeRange: "24h",
          query: "",
          limit: 1,
        }),
        token,
        signal,
      );
      if (!Array.isArray(body)) throw new Error("Sentry returned an unexpected issue list.");
      projects.push({ slug, name: null, ok: true, error: null });
    } catch (cause) {
      if (isAbortSignalError(cause, signal)) throw abortError(signal);
      projects.push({ slug, name: null, ok: false, error: sentryErrorMessage(cause) });
    }
  }

  throwIfAborted(signal);
  const organizationOk = !discovery.fallback || projects.some((project) => project.ok);
  return {
    ok: projects.every((project) => project.ok),
    organization: {
      slug: target.orgSlug,
      name: null,
      ok: organizationOk,
      error: organizationOk
        ? null
        : "Organization access could not be validated because project discovery is unavailable.",
    },
    projects,
    fallback: discovery.fallback,
    warning: discovery.warning,
  };
}

type SqliteCleanupDb = {
  prepare(sql: string): { run(...params: unknown[]): unknown };
  transaction<T>(callback: () => T): () => T;
};

export function deleteConnectionArtifacts(db: SqliteCleanupDb, connectionId: string): void {
  db.transaction(() => {
    db.prepare("DELETE FROM issue_snapshots WHERE connection_id = ?").run(connectionId);
    db.prepare("DELETE FROM issue_details WHERE connection_id = ?").run(connectionId);
    db.prepare("DELETE FROM connection_health WHERE connection_id = ?").run(connectionId);
    db.prepare("DELETE FROM triage_thread_links WHERE connection_id = ?").run(connectionId);
  })();
}

export function buildIssueEventsUrl(
  baseUrl: string,
  orgSlug: string,
  issueId: string,
  filters: { environment: string; timeRange: string },
): URL {
  const url = sentryResourceUrl(
    baseUrl,
    `/api/0/organizations/${encodeURIComponent(orgSlug)}/issues/${encodeURIComponent(issueId)}/events/`,
  );
  url.searchParams.set("statsPeriod", filters.timeRange);
  if (filters.environment.trim() !== "") url.searchParams.set("environment", filters.environment.trim());
  url.searchParams.set("per_page", "10");
  return url;
}
