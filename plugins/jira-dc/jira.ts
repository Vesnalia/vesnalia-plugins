// The Jira Data Center boundary: wire schemas, normalization into the plugin's
// own types, the write-permission policy, and a REST v2 client (Bearer PAT).
//
// Kept out of server.ts so everything here is testable with a fake `fetch`
// and no plugin host. The only type imported by app.tsx is erased at build.
import { z } from "zod";
import { markdownToWiki, wikiToMarkdown } from "./wiki.js";

export const API_TIMEOUT_MS = 20_000;
export const SEARCH_PAGE_SIZE = 50;
export const COMMENT_PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Plugin-owned types. Every field is present; the Jira wire shape is parsed
// leniently and defaults are filled exactly once, in `normalize*`.
// ---------------------------------------------------------------------------

/** Jira's three workflow buckets, which is what colors a status everywhere. */
export type StatusCategory = "todo" | "inprogress" | "done";

/**
 * Opaque user id for the UI. On Data Center this is the username (`name` /
 * `key` from REST), not a Cloud `accountId`.
 */
export interface JiraUser {
  accountId: string;
  displayName: string;
  email: string;
}

export interface JiraIssueSummary {
  id: string;
  key: string;
  projectKey: string;
  summary: string;
  status: string;
  statusCategory: StatusCategory;
  issueType: string;
  subtask: boolean;
  priority: string;
  assignee: JiraUser | null;
  reporter: JiraUser | null;
  labels: string[];
  created: string;
  updated: string;
}

export interface JiraIssue extends JiraIssueSummary {
  /** Markdown, converted from wiki markup. */
  description: string;
  parent: { key: string; summary: string } | null;
  url: string;
}

export interface JiraComment {
  id: string;
  author: JiraUser | null;
  body: string;
  created: string;
  updated: string;
}

export interface JiraTransition {
  id: string;
  name: string;
  toStatus: string;
  toCategory: StatusCategory;
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
}

export interface JiraStatusOption {
  name: string;
  category: StatusCategory;
}

export interface JiraIssueType {
  id: string;
  name: string;
  subtask: boolean;
}

/** How the create dialog should render a createmeta field. */
export type CreateFieldKind =
  | "text"
  | "textarea"
  | "number"
  | "date"
  | "datetime"
  | "select"
  | "multiselect"
  | "labels"
  | "user"
  | "unsupported";

export interface JiraCreateFieldOption {
  id: string;
  label: string;
}

/**
 * A field from `/issue/createmeta` that the create form may need to collect.
 * `builtIn` fields reuse the dialog's dedicated controls instead of a second widget.
 */
export interface JiraCreateField {
  key: string;
  name: string;
  required: boolean;
  kind: CreateFieldKind;
  builtIn?: "summary" | "description" | "priority" | "assignee";
  allowedValues: JiraCreateFieldOption[];
  hasDefaultValue: boolean;
}

// ---------------------------------------------------------------------------
// Wire schemas.
// ---------------------------------------------------------------------------

const rawUserSchema = z
  .object({
    accountId: z.string().optional(),
    name: z.string().optional(),
    key: z.string().optional(),
    displayName: z.string().optional(),
    emailAddress: z.string().optional(),
    active: z.boolean().optional(),
  })
  .loose();

const rawStatusSchema = z
  .object({
    name: z.string().optional(),
    statusCategory: z.object({ key: z.string().optional() }).loose().optional(),
  })
  .loose();

const rawFieldsSchema = z
  .object({
    summary: z.string().nullable().optional(),
    status: rawStatusSchema.nullable().optional(),
    issuetype: z
      .object({ name: z.string().optional(), subtask: z.boolean().optional() })
      .loose()
      .nullable()
      .optional(),
    priority: z.object({ name: z.string().optional() }).loose().nullable().optional(),
    assignee: rawUserSchema.nullable().optional(),
    reporter: rawUserSchema.nullable().optional(),
    labels: z.array(z.string()).nullable().optional(),
    created: z.string().nullable().optional(),
    updated: z.string().nullable().optional(),
    project: z.object({ key: z.string().optional() }).loose().nullable().optional(),
    description: z.unknown().optional(),
    parent: z
      .object({
        key: z.string().optional(),
        fields: z.object({ summary: z.string().optional() }).loose().optional(),
      })
      .loose()
      .nullable()
      .optional(),
  })
  .loose();

const rawIssueSchema = z
  .object({
    id: z.string().optional(),
    key: z.string(),
    fields: rawFieldsSchema.optional(),
  })
  .loose();

const rawSearchSchema = z
  .object({
    issues: z.array(rawIssueSchema).optional(),
    startAt: z.number().optional(),
    maxResults: z.number().optional(),
    total: z.number().optional(),
  })
  .loose();

const rawCommentSchema = z
  .object({
    id: z.string(),
    body: z.unknown().optional(),
    author: rawUserSchema.nullable().optional(),
    created: z.string().optional(),
    updated: z.string().optional(),
  })
  .loose();

const rawTransitionsSchema = z
  .object({
    transitions: z
      .array(
        z
          .object({
            id: z.string(),
            name: z.string().optional(),
            to: rawStatusSchema.optional(),
          })
          .loose(),
      )
      .optional(),
  })
  .loose();

const rawProjectSchema = z
  .object({ id: z.string(), key: z.string(), name: z.string().optional() })
  .loose();

const rawIssueTypeSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    subtask: z.boolean().optional(),
  })
  .loose();

const rawErrorSchema = z
  .object({
    errorMessages: z.array(z.string()).optional(),
    errors: z.record(z.string(), z.string()).optional(),
  })
  .loose();

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

export function needsConfiguration(message: string): Error {
  return Object.assign(new Error(message), { name: "NeedsConfigurationError" });
}

/**
 * Accepts a full Data Center base URL (or host) and returns the origin.
 * Allows http for on-prem instances; strips a trailing path.
 */
export function normalizeSiteUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (trimmed.length === 0) return null;
  let candidate = trimmed;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) candidate = `https://${candidate}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/** PROJ-123 — uppercase project key, a dash, a number. */
export function isIssueKey(value: string): boolean {
  return /^[A-Z][A-Z0-9_]{0,254}-[1-9][0-9]*$/.test(value);
}

export function isProjectKey(value: string): boolean {
  return /^[A-Z][A-Z0-9_]{0,254}$/.test(value);
}

export function normalizeIssueKey(value: string): string {
  return value.trim().toUpperCase();
}

export function statusCategory(key: string | undefined): StatusCategory {
  if (key === "done") return "done";
  if (key === "indeterminate") return "inprogress";
  return "todo";
}

function userId(raw: z.infer<typeof rawUserSchema>): string | undefined {
  return raw.name ?? raw.key ?? raw.accountId;
}

function normalizeUser(raw: z.infer<typeof rawUserSchema> | null | undefined): JiraUser | null {
  if (raw === null || raw === undefined) return null;
  const id = userId(raw);
  if (id === undefined || id.length === 0) return null;
  return {
    accountId: id,
    displayName: raw.displayName ?? id,
    email: raw.emailAddress ?? "",
  };
}

export function normalizeIssueSummary(raw: z.infer<typeof rawIssueSchema>): JiraIssueSummary {
  const fields = raw.fields ?? {};
  return {
    id: raw.id ?? "",
    key: raw.key,
    projectKey: fields.project?.key ?? raw.key.slice(0, raw.key.lastIndexOf("-")),
    summary: fields.summary ?? "",
    status: fields.status?.name ?? "",
    statusCategory: statusCategory(fields.status?.statusCategory?.key),
    issueType: fields.issuetype?.name ?? "",
    subtask: fields.issuetype?.subtask ?? false,
    priority: fields.priority?.name ?? "",
    assignee: normalizeUser(fields.assignee),
    reporter: normalizeUser(fields.reporter),
    labels: fields.labels ?? [],
    created: fields.created ?? "",
    updated: fields.updated ?? "",
  };
}

function descriptionToMarkdown(value: unknown): string {
  if (typeof value === "string") return wikiToMarkdown(value);
  // Some DC installs with Fabric still return ADF; fall back to empty rather
  // than dumping JSON into the UI.
  if (value !== null && typeof value === "object") return "";
  return "";
}

export function normalizeIssue(
  raw: z.infer<typeof rawIssueSchema>,
  siteUrl: string,
): JiraIssue {
  const fields = raw.fields ?? {};
  const parent = fields.parent;
  return {
    ...normalizeIssueSummary(raw),
    description: descriptionToMarkdown(fields.description),
    parent:
      parent?.key === undefined
        ? null
        : { key: parent.key, summary: parent.fields?.summary ?? "" },
    url: `${siteUrl}/browse/${raw.key}`,
  };
}

/** Quotes a value for use inside JQL. */
export function jqlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** `project = "A"` or `project in ("A", "B")`; "" for no keys. */
export function projectClause(keys: readonly string[]): string {
  const unique = [...new Set(keys)];
  if (unique.length === 0) return "";
  if (unique.length === 1) return `project = ${jqlString(unique[0] ?? "")}`;
  return `project in (${unique.map(jqlString).join(", ")})`;
}

/**
 * Restricts arbitrary JQL to the given projects, keeping its ORDER BY last:
 * `status = Done ORDER BY rank` → `project = "WEB" AND (status = Done) ORDER BY rank`.
 */
export function scopeJql(jql: string, keys: readonly string[]): string {
  const clause = projectClause(keys);
  const trimmed = jql.trim();
  if (clause.length === 0) return trimmed;
  let orderAt = -1;
  let quote: string | null = null;
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (quote !== null) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (
      /^order\s+by\b/i.test(trimmed.slice(index)) &&
      (index === 0 || /\s/.test(trimmed[index - 1] ?? ""))
    ) {
      orderAt = index;
      break;
    }
  }
  const where = (orderAt === -1 ? trimmed : trimmed.slice(0, orderAt)).trim();
  const order = orderAt === -1 ? "" : ` ${trimmed.slice(orderAt).trim()}`;
  return `${where.length > 0 ? `${clause} AND (${where})` : clause}${order}`;
}

export type IssueView = "assigned" | "reported" | "recent" | "all";

export function buildViewJql(args: {
  view: IssueView;
  projectKey: string;
  projectKeys?: readonly string[];
  text: string;
  includeDone: boolean;
  assignees?: string[];
  unassigned?: boolean;
}): string {
  const clauses: string[] = [];
  const projects = projectClause(
    args.projectKey.length > 0 ? [args.projectKey] : (args.projectKeys ?? []),
  );
  if (projects.length > 0) clauses.push(projects);
  if (args.view === "assigned") {
    clauses.push("assignee = currentUser()");
  } else {
    const people = [...new Set(args.assignees ?? [])];
    const parts: string[] = [];
    if (people.length > 0) parts.push(`assignee in (${people.map(jqlString).join(", ")})`);
    if (args.unassigned === true) parts.push("assignee is EMPTY");
    if (parts.length === 1) clauses.push(parts[0] ?? "");
    if (parts.length > 1) clauses.push(`(${parts.join(" OR ")})`);
  }
  if (args.view === "reported") clauses.push("reporter = currentUser()");
  if (args.view === "recent") clauses.push("updated >= -14d");
  if (!args.includeDone) clauses.push("statusCategory != Done");
  const text = args.text.trim();
  if (text.length > 0) {
    const key = normalizeIssueKey(text);
    clauses.push(
      isIssueKey(key)
        ? `(key = ${jqlString(key)} OR text ~ ${jqlString(text)})`
        : `text ~ ${jqlString(text)}`,
    );
  }
  if (clauses.length === 0) clauses.push("created >= -365d");
  return `${clauses.join(" AND ")} ORDER BY updated DESC`;
}

export function describeUser(user: JiraUser | null): string {
  return user === null ? "Unassigned" : user.displayName;
}

// ---------------------------------------------------------------------------
// Write permissions.
// ---------------------------------------------------------------------------

export const WRITE_ACTIONS = [
  "create",
  "update",
  "transition",
  "comment",
  "assign",
  "delete",
] as const;
export type WriteAction = (typeof WRITE_ACTIONS)[number];

export const PERMISSION_ASK = "Ask every time";
export const PERMISSION_ALWAYS = "Always allow";
export const PERMISSION_OPTIONS = [PERMISSION_ASK, PERMISSION_ALWAYS];

export function permissionSettingKey(action: WriteAction) {
  return `allow_${action}` as const;
}

export const ACTION_LABELS: Record<WriteAction, string> = {
  create: "Create issues",
  update: "Edit issue fields",
  transition: "Change status",
  comment: "Add comments",
  assign: "Change assignee",
  delete: "Delete issues",
};

export function requiresApproval(policy: unknown): boolean {
  return policy !== PERMISSION_ALWAYS;
}

// ---------------------------------------------------------------------------
// Client.
// ---------------------------------------------------------------------------

export interface JiraAccess {
  siteUrl: string;
  pat: string;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class JiraError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "JiraError";
  }
}

export function describeJiraError(status: number, body: string): string {
  let detail = "";
  try {
    const parsed = rawErrorSchema.parse(JSON.parse(body));
    detail = [
      ...(parsed.errorMessages ?? []),
      ...Object.entries(parsed.errors ?? {}).map(([field, message]) => `${field}: ${message}`),
    ].join("; ");
  } catch {
    detail = body.slice(0, 300);
  }
  return `Jira responded ${status}${detail.length > 0 ? `: ${detail}` : ""}`;
}

export interface IssueFieldsInput {
  summary?: string;
  description?: string;
  priority?: string;
  labels?: string[];
}

export interface CreateIssueInput extends IssueFieldsInput {
  projectKey: string;
  issueType: string;
  summary: string;
  assigneeAccountId?: string;
  parentKey?: string;
  /** Extra createmeta fields (components, custom fields, …), already encoded for Jira. */
  extraFields?: Record<string, unknown>;
}

export function toJiraFields(input: IssueFieldsInput): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (input.summary !== undefined) fields.summary = input.summary;
  if (input.description !== undefined) {
    fields.description =
      input.description.trim().length === 0 ? null : markdownToWiki(input.description);
  }
  if (input.priority !== undefined) fields.priority = { name: input.priority };
  if (input.labels !== undefined) fields.labels = input.labels;
  return fields;
}

/** System fields the create dialog already owns, or that Jira fills itself. */
const CREATE_META_SKIP = new Set([
  "project",
  "issuetype",
  "reporter",
  "attachment",
  "comment",
  "worklog",
  "issuelinks",
  "subtasks",
  "timetracking",
  "thumbnail",
  "watches",
  "votes",
  "issuerestriction",
]);

const rawCreateFieldSchema = z
  .object({
    required: z.boolean().optional(),
    name: z.string().optional(),
    fieldId: z.string().optional(),
    key: z.string().optional(),
    hasDefaultValue: z.boolean().optional(),
    operations: z.array(z.string()).optional(),
    allowedValues: z
      .array(
        z
          .object({
            id: z.union([z.string(), z.number()]).optional(),
            name: z.string().optional(),
            value: z.string().optional(),
          })
          .loose(),
      )
      .optional(),
    schema: z
      .object({
        type: z.string().optional(),
        items: z.string().optional(),
        system: z.string().optional(),
        custom: z.string().optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

function classifyCreateField(
  key: string,
  schema: { type?: string; items?: string; system?: string } | undefined,
  hasAllowedValues: boolean,
): { kind: CreateFieldKind; builtIn?: JiraCreateField["builtIn"] } {
  if (key === "summary" || schema?.system === "summary") {
    return { kind: "text", builtIn: "summary" };
  }
  if (key === "description" || schema?.system === "description") {
    return { kind: "textarea", builtIn: "description" };
  }
  if (key === "priority" || schema?.system === "priority" || schema?.type === "priority") {
    return { kind: "select", builtIn: "priority" };
  }
  if (key === "assignee" || schema?.system === "assignee") {
    return { kind: "user", builtIn: "assignee" };
  }
  const type = schema?.type ?? "";
  const items = schema?.items ?? "";
  if (type === "string") return { kind: "text" };
  if (type === "number") return { kind: "number" };
  if (type === "date") return { kind: "date" };
  if (type === "datetime") return { kind: "datetime" };
  if (
    type === "option" ||
    type === "priority" ||
    type === "securitylevel" ||
    type === "component" ||
    type === "version" ||
    type === "issuetype" ||
    type === "project" ||
    type === "resolution" ||
    type === "status"
  ) {
    return { kind: "select" };
  }
  if (type === "user" || type === "group") return { kind: type === "user" ? "user" : "unsupported" };
  if (type === "array") {
    if (items === "string") return { kind: "labels" };
    if (items === "option" || items === "component" || items === "version" || items === "group") {
      return { kind: "multiselect" };
    }
    if (items === "user") return { kind: "unsupported" };
  }
  if (hasAllowedValues) return { kind: "select" };
  if (type === "any" || type.length === 0) return { kind: "text" };
  return { kind: "unsupported" };
}

function normalizeCreateField(key: string, raw: z.infer<typeof rawCreateFieldSchema>): JiraCreateField | null {
  if (CREATE_META_SKIP.has(key)) return null;
  const operations = raw.operations ?? ["set"];
  if (operations.length > 0 && !operations.includes("set")) return null;
  const allowedValues = (raw.allowedValues ?? [])
    .map((entry) => {
      const id = entry.id !== undefined ? String(entry.id) : (entry.value ?? entry.name ?? "");
      const label = entry.name ?? entry.value ?? id;
      if (id.length === 0) return null;
      return { id, label };
    })
    .filter((entry): entry is JiraCreateFieldOption => entry !== null);
  const { kind, builtIn } = classifyCreateField(key, raw.schema, allowedValues.length > 0);
  return {
    key,
    name: raw.name ?? key,
    required: raw.required === true,
    kind,
    ...(builtIn === undefined ? {} : { builtIn }),
    allowedValues,
    hasDefaultValue: raw.hasDefaultValue === true,
  };
}

/** Turn a createmeta payload (classic map or modern array) into plugin fields. */
export function normalizeCreateFields(
  fields: Record<string, unknown> | Array<Record<string, unknown>> | undefined,
): JiraCreateField[] {
  const out: JiraCreateField[] = [];
  if (Array.isArray(fields)) {
    for (const entry of fields) {
      const parsed = rawCreateFieldSchema.safeParse(entry);
      if (!parsed.success) continue;
      const key = parsed.data.fieldId ?? parsed.data.key;
      if (key === undefined || key.length === 0) continue;
      const field = normalizeCreateField(key, parsed.data);
      if (field !== null) out.push(field);
    }
  } else if (fields !== undefined && typeof fields === "object") {
    for (const [key, value] of Object.entries(fields)) {
      const parsed = rawCreateFieldSchema.safeParse(value);
      if (!parsed.success) continue;
      const field = normalizeCreateField(key, parsed.data);
      if (field !== null) out.push(field);
    }
  }
  return out.sort((left, right) => Number(right.required) - Number(left.required) || left.name.localeCompare(right.name));
}

/**
 * Encode a form value into the shape Jira expects for create/update.
 * `raw` is a single id/string, or an array of ids for multiselect/labels.
 */
export function encodeCreateFieldValue(
  field: JiraCreateField,
  raw: string | string[],
): unknown {
  const asString = Array.isArray(raw) ? (raw[0] ?? "") : raw;
  const asList = Array.isArray(raw) ? raw : raw.length === 0 ? [] : [raw];
  switch (field.kind) {
    case "text":
    case "textarea":
    case "date":
    case "datetime":
      return asString;
    case "number": {
      const n = Number(asString);
      if (!Number.isFinite(n)) throw new Error(`${field.name} must be a number`);
      return n;
    }
    case "select": {
      if (asString.length === 0) return undefined;
      if (field.builtIn === "priority") {
        const match = field.allowedValues.find((option) => option.id === asString);
        return { name: match?.label ?? asString };
      }
      return { id: asString };
    }
    case "multiselect":
      return asList.filter((id) => id.length > 0).map((id) => ({ id }));
    case "labels":
      return asList
        .flatMap((value) => value.split(/[,\s]+/))
        .map((label) => label.trim())
        .filter((label) => label.length > 0);
    case "user":
      return asString.length === 0 ? null : { name: asString };
    case "unsupported":
      if (asString.trim().length === 0) return undefined;
      try {
        return JSON.parse(asString) as unknown;
      } catch {
        return asString;
      }
  }
}

/** True when the create form still needs a value for this field. */
export function createFieldNeedsValue(field: JiraCreateField, raw: string | string[] | undefined): boolean {
  if (!field.required || field.hasDefaultValue) return false;
  if (raw === undefined) return true;
  if (Array.isArray(raw)) return raw.filter((value) => value.trim().length > 0).length === 0;
  return raw.trim().length === 0;
}

const ISSUE_FIELDS =
  "summary,status,issuetype,priority,assignee,reporter,labels,created,updated,project,description,parent";

export class JiraClient {
  constructor(
    private readonly access: JiraAccess,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  get siteUrl(): string {
    return this.access.siteUrl;
  }

  private async request(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.access.siteUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.access.pat}`,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(
        `Could not reach Jira at ${this.access.siteUrl} (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
    }
    const text = await response.text();
    if (response.status === 401) {
      throw needsConfiguration(
        "Jira rejected the Personal Access Token (HTTP 401). Check the Jira Data Center plugin settings.",
      );
    }
    if (!response.ok) {
      throw new JiraError(describeJiraError(response.status, text), response.status);
    }
    if (text.length === 0) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("Jira returned a non-JSON response");
    }
  }

  async myself(): Promise<JiraUser> {
    const user = normalizeUser(rawUserSchema.parse(await this.request("GET", "/rest/api/2/myself")));
    if (user === null) throw new Error("Jira did not identify the current user");
    return user;
  }

  /**
   * Classic `/rest/api/2/search` with `startAt` pagination. The opaque
   * `nextPageToken` is the next `startAt` as a decimal string.
   */
  async search(
    jql: string,
    options: { maxResults?: number; nextPageToken?: string } = {},
  ): Promise<{ issues: JiraIssueSummary[]; nextPageToken: string | null }> {
    const maxResults = options.maxResults ?? SEARCH_PAGE_SIZE;
    const startAt =
      options.nextPageToken === undefined || options.nextPageToken.length === 0
        ? 0
        : Number.parseInt(options.nextPageToken, 10);
    if (!Number.isFinite(startAt) || startAt < 0) {
      throw new Error("Invalid search page token");
    }
    const params = new URLSearchParams({
      jql,
      startAt: String(startAt),
      maxResults: String(maxResults),
      fields: ISSUE_FIELDS.split(",").filter((field) => field !== "description").join(","),
    });
    const raw = rawSearchSchema.parse(await this.request("GET", `/rest/api/2/search?${params}`));
    const issues = (raw.issues ?? []).map(normalizeIssueSummary);
    const total = raw.total ?? startAt + issues.length;
    const nextStart = startAt + issues.length;
    return {
      issues,
      nextPageToken: nextStart < total && issues.length > 0 ? String(nextStart) : null,
    };
  }

  async getIssue(key: string): Promise<JiraIssue> {
    const raw = rawIssueSchema.parse(
      await this.request(
        "GET",
        `/rest/api/2/issue/${encodeURIComponent(key)}?fields=${ISSUE_FIELDS}`,
      ),
    );
    return normalizeIssue(raw, this.access.siteUrl);
  }

  async createIssue(input: CreateIssueInput): Promise<{ key: string }> {
    const fields: Record<string, unknown> = {
      project: { key: input.projectKey },
      issuetype: /^\d+$/.test(input.issueType) ? { id: input.issueType } : { name: input.issueType },
      ...toJiraFields(input),
      ...(input.extraFields ?? {}),
    };
    if (input.assigneeAccountId !== undefined) {
      fields.assignee = { name: input.assigneeAccountId };
    }
    if (input.parentKey !== undefined) fields.parent = { key: input.parentKey };
    const raw = z
      .object({ key: z.string() })
      .loose()
      .parse(await this.request("POST", "/rest/api/2/issue", { fields }));
    return { key: raw.key };
  }

  /**
   * Required/optional fields for the create screen. Prefers the modern
   * `/createmeta/{project}/issuetypes/{type}` endpoint (DC 8.4+), falls back
   * to classic `?expand=projects.issuetypes.fields`.
   */
  async listCreateFields(projectKey: string, issueTypeId: string): Promise<JiraCreateField[]> {
    const modernPath = `/rest/api/2/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes/${encodeURIComponent(issueTypeId)}`;
    try {
      const raw = z
        .object({
          fields: z.union([z.array(z.record(z.string(), z.unknown())), z.record(z.string(), z.unknown())]).optional(),
          values: z.array(z.record(z.string(), z.unknown())).optional(),
        })
        .loose()
        .parse(await this.request("GET", modernPath));
      const fields = normalizeCreateFields(raw.fields ?? raw.values);
      if (fields.length > 0) return fields;
    } catch {
      // Older DC builds only expose the classic createmeta query.
    }
    const params = new URLSearchParams({
      projectKeys: projectKey,
      issuetypeIds: issueTypeId,
      expand: "projects.issuetypes.fields",
    });
    const classic = z
      .object({
        projects: z
          .array(
            z
              .object({
                issuetypes: z
                  .array(z.object({ fields: z.record(z.string(), z.unknown()).optional() }).loose())
                  .optional(),
              })
              .loose(),
          )
          .optional(),
      })
      .loose()
      .parse(await this.request("GET", `/rest/api/2/issue/createmeta?${params}`));
    return normalizeCreateFields(classic.projects?.[0]?.issuetypes?.[0]?.fields);
  }

  async updateIssue(key: string, input: IssueFieldsInput): Promise<void> {
    await this.request("PUT", `/rest/api/2/issue/${encodeURIComponent(key)}`, {
      fields: toJiraFields(input),
    });
  }

  async deleteIssue(key: string, deleteSubtasks: boolean): Promise<void> {
    await this.request(
      "DELETE",
      `/rest/api/2/issue/${encodeURIComponent(key)}?deleteSubtasks=${deleteSubtasks}`,
    );
  }

  async listTransitions(key: string): Promise<JiraTransition[]> {
    const raw = rawTransitionsSchema.parse(
      await this.request("GET", `/rest/api/2/issue/${encodeURIComponent(key)}/transitions`),
    );
    return (raw.transitions ?? []).map((transition) => ({
      id: transition.id,
      name: transition.name ?? transition.id,
      toStatus: transition.to?.name ?? transition.name ?? "",
      toCategory: statusCategory(transition.to?.statusCategory?.key),
    }));
  }

  async transitionIssue(key: string, transitionId: string): Promise<void> {
    await this.request("POST", `/rest/api/2/issue/${encodeURIComponent(key)}/transitions`, {
      transition: { id: transitionId },
    });
  }

  async listComments(key: string): Promise<{ comments: JiraComment[]; total: number }> {
    const raw = z
      .object({
        comments: z.array(rawCommentSchema).optional(),
        total: z.number().optional(),
      })
      .loose()
      .parse(
        await this.request(
          "GET",
          `/rest/api/2/issue/${encodeURIComponent(key)}/comment?orderBy=-created&maxResults=${COMMENT_PAGE_SIZE}`,
        ),
      );
    const comments = (raw.comments ?? []).map((comment) => ({
      id: comment.id,
      author: normalizeUser(comment.author),
      body: descriptionToMarkdown(comment.body),
      created: comment.created ?? "",
      updated: comment.updated ?? "",
    }));
    return { comments: comments.reverse(), total: raw.total ?? comments.length };
  }

  async addComment(key: string, markdown: string): Promise<JiraComment> {
    const raw = rawCommentSchema.parse(
      await this.request("POST", `/rest/api/2/issue/${encodeURIComponent(key)}/comment`, {
        body: markdownToWiki(markdown),
      }),
    );
    return {
      id: raw.id,
      author: normalizeUser(raw.author),
      body: descriptionToMarkdown(raw.body),
      created: raw.created ?? "",
      updated: raw.updated ?? "",
    };
  }

  async assignIssue(key: string, accountId: string | null): Promise<void> {
    await this.request("PUT", `/rest/api/2/issue/${encodeURIComponent(key)}/assignee`, {
      name: accountId,
    });
  }

  async findAssignableUsers(
    target: { issueKey: string } | { projectKey: string },
    query: string,
  ): Promise<JiraUser[]> {
    const params = new URLSearchParams({ query, maxResults: "20" });
    if ("issueKey" in target) params.set("issueKey", target.issueKey);
    else params.set("project", target.projectKey);
    const raw = z
      .array(rawUserSchema)
      .parse(await this.request("GET", `/rest/api/2/user/assignable/search?${params}`));
    return raw.map(normalizeUser).filter((user): user is JiraUser => user !== null);
  }

  async searchUsers(query: string): Promise<JiraUser[]> {
    const params = new URLSearchParams({ username: query, maxResults: "20" });
    const raw = z
      .array(rawUserSchema)
      .parse(await this.request("GET", `/rest/api/2/user/search?${params}`));
    return raw
      .filter((user) => user.active !== false)
      .map(normalizeUser)
      .filter((user): user is JiraUser => user !== null);
  }

  async listProjects(): Promise<JiraProject[]> {
    const raw = z
      .array(rawProjectSchema)
      .parse(await this.request("GET", "/rest/api/2/project?expand=description"));
    return raw
      .map((project) => ({
        id: project.id,
        key: project.key,
        name: project.name ?? project.key,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async listIssueTypes(projectKey: string): Promise<JiraIssueType[]> {
    const raw = z
      .object({ issueTypes: z.array(rawIssueTypeSchema).optional() })
      .loose()
      .parse(await this.request("GET", `/rest/api/2/project/${encodeURIComponent(projectKey)}`));
    return (raw.issueTypes ?? []).map((type) => ({
      id: type.id,
      name: type.name ?? type.id,
      subtask: type.subtask ?? false,
    }));
  }

  async listProjectStatuses(projectKey: string): Promise<JiraStatusOption[]> {
    const raw = z
      .array(z.object({ statuses: z.array(rawStatusSchema).optional() }).loose())
      .parse(
        await this.request("GET", `/rest/api/2/project/${encodeURIComponent(projectKey)}/statuses`),
      );
    const byName = new Map<string, JiraStatusOption>();
    for (const type of raw) {
      for (const status of type.statuses ?? []) {
        if (status.name === undefined || byName.has(status.name)) continue;
        byName.set(status.name, {
          name: status.name,
          category: statusCategory(status.statusCategory?.key),
        });
      }
    }
    return [...byName.values()];
  }

  async listPriorities(): Promise<string[]> {
    const raw = z
      .array(z.object({ name: z.string() }).loose())
      .parse(await this.request("GET", "/rest/api/2/priority"));
    return raw.map((priority) => priority.name);
  }

  async pickIssues(query: string): Promise<Array<{ key: string; summary: string }>> {
    const params = new URLSearchParams({ query, currentJQL: "" });
    const raw = z
      .object({
        sections: z
          .array(
            z
              .object({
                issues: z
                  .array(z.object({ key: z.string(), summaryText: z.string().optional() }).loose())
                  .optional(),
              })
              .loose(),
          )
          .optional(),
      })
      .loose()
      .parse(await this.request("GET", `/rest/api/2/issue/picker?${params}`));
    const seen = new Set<string>();
    const picked: Array<{ key: string; summary: string }> = [];
    for (const section of raw.sections ?? []) {
      for (const issue of section.issues ?? []) {
        if (seen.has(issue.key)) continue;
        seen.add(issue.key);
        picked.push({ key: issue.key, summary: issue.summaryText ?? "" });
      }
    }
    return picked;
  }
}
