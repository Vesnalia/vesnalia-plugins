import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import {
  aggregateIssues,
  MAX_NORMALIZED_STRING_LENGTH,
  MAX_SENTRY_RESPONSE_BYTES,
  TRUNCATION_MARKER,
  eventBelongsToIssue,
  issueBelongsToProject,
  buildEventDetailUrl,
  buildIssueDetailUrl,
  buildIssueEventsUrl,
  buildIssuesUrl,
  buildOrganizationIssuesUrl,
  buildOrganizationProjectsUrl,
  cachedBadgeState,
  countNewIssues,
  issueBadgeEntries,
  connectionHealth,
  deleteConnectionArtifacts,
  fetchSentryPage,
  discoverSentryProjects,
  dedupeTriageThreadLinks,
  emptyConnectionHealth,
  eventDetailOrSummary,
  healthAfterSync,
  healthAfterTest,
  issueRouteKey,
  mergeIssuePages,
  nextCursorFromLink,
  normalizeIssue,
  normalizeIssueDetail,
  normalizeIssueEvent,
  redactPii,
  sortIssuesByRecent,
  splitProjectSlugs,
  testSentryConnection,
  validateSentryBaseUrl,
} from "../src/sentry-core.ts";

test("normalizes issues, redacts PII, and sorts newest first", () => {
  assert.equal(redactPii("alice@example.com at 192.168.1.2"), "[redacted] at [redacted]");
  const oldIssue = normalizeIssue({
    id: "1",
    shortId: "WEB-1",
    title: "Old alice@example.com error",
    lastSeen: "2026-08-01T00:00:00Z",
    count: "2",
  });
  const newIssue = normalizeIssue({
    id: "2",
    shortId: "WEB-2",
    title: "New error",
    lastSeen: "2026-08-02T00:00:00Z",
    level: "warning",
    tags: [{ key: "host", value: "10.0.0.4" }],
  });
  assert.deepEqual(sortIssuesByRecent([oldIssue, newIssue]).map((issue) => issue.id), ["2", "1"]);
  assert.equal(oldIssue.title, "Old [redacted] error");
  assert.equal(newIssue.topTags[0].value, "[redacted]");
  assert.equal(newIssue.severity, "warning");

  const safeIssueUrl = normalizeIssue({
    id: "3",
    url: "https://example.test/issues/3?access_token=event-token&email=alice@example.com#private",
  }).permalink;
  assert.ok(safeIssueUrl);
  const parsedSafeIssueUrl = new URL(safeIssueUrl);
  assert.equal(parsedSafeIssueUrl.searchParams.get("access_token"), "[redacted]");
  assert.equal(parsedSafeIssueUrl.searchParams.get("email"), "[redacted]");
  assert.equal(parsedSafeIssueUrl.hash, "");
  assert.equal(safeIssueUrl.includes("event-token"), false);
  assert.equal(safeIssueUrl.includes("alice@example.com"), false);
});

test("builds a bounded GET endpoint URL without credentials", () => {
  const url = buildIssuesUrl("https://sentry.example.test", "acme", "web", {
    environment: "prod",
    timeRange: "24h",
    query: "is:unresolved",
    limit: 20,
  });
  assert.equal(url.pathname, "/api/0/projects/acme/web/issues/");
  assert.equal(url.searchParams.get("statsPeriod"), "24h");
  assert.equal(url.searchParams.get("limit"), "20");
  assert.equal(url.username, "");
  assert.equal(url.password, "");
});

test("allows loopback HTTP but rejects remote HTTP Sentry base URLs", () => {
  assert.equal(validateSentryBaseUrl("http://127.0.0.1:9000").protocol, "http:");
  assert.equal(validateSentryBaseUrl("http://localhost:9000/sentry").hostname, "localhost");
  assert.throws(
    () => validateSentryBaseUrl("http://sentry.example.test"),
    /https|localhost/iu,
  );
});

test("splits project slugs from form input", () => {
  assert.deepEqual(splitProjectSlugs(" web,api\nworker\napi "), ["web", "api", "worker"]);
});

test("builds organization issue URLs for longer time ranges", () => {
  const url = buildOrganizationIssuesUrl("https://sentry.example.test", "acme", "web", {
    environment: "prod",
    timeRange: "30d",
    query: "is:unresolved",
    limit: 20,
  });
  assert.equal(url.pathname, "/api/0/organizations/acme/issues/");
  assert.equal(url.searchParams.get("project"), "web");
  assert.equal(url.searchParams.get("statsPeriod"), "30d");
});

test("keeps an empty query explicit so Sentry returns all issue statuses", () => {
  const url = buildIssuesUrl("https://sentry.example.test", "acme", "web", {
    environment: "",
    timeRange: "14d",
    query: "",
    limit: 20,
  });
  assert.equal(url.searchParams.get("query"), "");
});

test("normalizes issue detail and event data for the in-app view", () => {
  const issue = normalizeIssueDetail({
    id: "42",
    shortId: "WEB-42",
    title: "Request failed",
    status: "unresolved",
    count: "7",
    project: { id: "9", name: "Web", slug: "web", platform: "javascript" },
    level: "error",
    priority: "high",
    platform: "javascript",
    userCount: 3,
    numComments: 2,
    assignedTo: { name: "Ada" },
    firstRelease: { version: "build-1", shortVersion: "1.0.0", dateCreated: "2026-08-01T00:00:00Z" },
    activity: [{ id: "a1", type: "first_seen", dateCreated: "2026-08-01T00:00:00Z" }],
  });
  const event = normalizeIssueEvent({
    eventID: "event-1",
    title: "Request failed",
    message: "alice@example.com at 192.168.1.2",
    platform: "javascript",
    "event.type": "error",
    dateCreated: "2026-08-02T00:00:00Z",
    tags: [{ key: "environment", value: "production" }],
    metadata: { type: "TypeError", value: "Cannot read property" },
    entries: [
      {
        type: "exception",
        data: {
          values: [{
            type: "TypeError",
            value: "alice@example.com",
            mechanism: { type: "generic", data: { token: "event-token" } },
            stacktrace: {
              frames: [{
                filename: "src/app.ts",
                function: "loadData",
                lineNo: 42,
                colNo: 7,
                in_app: true,
                context_line: "const email = alice@example.com",
                pre_context: ["before"],
                post_context: ["after"],
              }],
            },
          }],
        },
      },
      {
        type: "breadcrumbs",
        data: {
          values: [{
            timestamp: "2026-08-02T00:00:00Z",
            category: "http",
            level: "info",
            message: "bob@example.com",
            data: { authorization: "Bearer event-token", nested: { email: "bob@example.com" } },
          }],
        },
      },
      {
        type: "request",
        data: {
          url: "https://example.test/api?access_token=event-token&ok=1",
          headers: { Authorization: "Bearer event-token", cookie: "sid=event-token", "X-Api-Key": "event-token" },
          query_string: { token: "event-token", page: "1" },
          data: { email: "alice@example.com" },
        },
      },
      { type: "contexts", data: { browser: { name: "Chrome" }, nested: { secret: "event-token" } } },
      { type: "user", data: { email: "alice@example.com", id: "user-1", ip_address: "192.168.1.2" } },
      { type: "sdk", data: { name: "sentry.javascript.browser", version: "8" } },
      { type: "extra", data: { safe: "value" } },
    ],
  });

  assert.equal(issue.projectName, "Web");
  assert.equal(issue.priority, "high");
  assert.equal(issue.userCount, 3);
  assert.equal(issue.firstRelease?.shortVersion, "1.0.0");
  assert.equal(issue.activity[0].type, "first_seen");
  assert.equal(event.environment, "production");
  assert.equal(event.message, "[redacted] at [redacted]");
  assert.equal(event.metadataType, "TypeError");
  assert.equal(issue.events.length, 0);
  assert.equal(event.exceptions[0].frames[0].lineNumber, 42);
  assert.equal(event.exceptions[0].frames[0].columnNumber, 7);
  assert.equal(event.exceptions[0].frames[0].contextLine, "const email = [redacted]");
  assert.equal(event.exceptions[0].mechanism.data.token, "[redacted]");
  assert.equal(event.breadcrumbs[0].message, "[redacted]");
  assert.equal(event.breadcrumbs[0].data.authorization, "[redacted]");
  assert.equal(event.request.headers.Authorization, "[redacted]");
  assert.equal(event.request.headers["X-Api-Key"], "[redacted]");
  assert.equal(event.request.query_string.token, "[redacted]");
  assert.equal(event.contexts.browser.name, "Chrome");
  assert.equal(event.user.email, "[redacted]");
  assert.equal(event.extra.safe, "value");
  assert.equal(JSON.stringify(event).includes("event-token"), false);
});

test("builds issue detail and latest-event URLs without credentials", () => {
  const detailUrl = buildIssueDetailUrl("https://sentry.example.test", "acme", "issue/42", "prod");
  const eventsUrl = buildIssueEventsUrl("https://sentry.example.test", "acme", "issue/42", {
    environment: "prod",
    timeRange: "30d",
  });
  assert.equal(detailUrl.pathname, "/api/0/organizations/acme/issues/issue%2F42/");
  assert.equal(detailUrl.searchParams.get("environment"), "prod");
  assert.equal(eventsUrl.pathname, "/api/0/organizations/acme/issues/issue%2F42/events/");
  assert.equal(eventsUrl.searchParams.get("statsPeriod"), "30d");
  const eventUrl = buildEventDetailUrl("https://sentry.example.test", "acme", "project/name", "event/42");
  assert.equal(eventsUrl.searchParams.get("per_page"), "10");
  assert.equal(eventUrl.pathname, "/api/0/projects/acme/project%2Fname/events/event%2F42/");
  assert.equal(eventsUrl.username, "");
  assert.equal(eventsUrl.password, "");
});

test("keeps the summary when optional event detail is unavailable", () => {
  const summary = normalizeIssueEvent({ eventID: "summary", message: "summary" });
  const detail = normalizeIssueEvent({
    eventID: "detail",
    message: "detailed",
    entries: [{ type: "request", data: { url: "https://example.test/details" } }],
  });
  assert.equal(eventDetailOrSummary(summary, null), summary);
  assert.equal(eventDetailOrSummary(null, detail), detail);
  assert.equal(eventDetailOrSummary(null, null), null);
});

test("deduplicates persisted triage links while retaining newest bounded links", () => {
  const first = {
    threadId: "thread-1",
    projectId: "project-1",
    createdAt: "2026-08-29T10:00:00.000Z",
    title: "First triage",
    status: "running",
  };
  const duplicate = { ...first, title: "Duplicate row" };
  const second = {
    threadId: "thread-2",
    projectId: "project-1",
    createdAt: "2026-08-29T09:00:00.000Z",
    title: "Earlier triage",
    status: "success",
  };
  assert.deepEqual(dedupeTriageThreadLinks([first, duplicate, second]), [first, second]);
  assert.deepEqual(dedupeTriageThreadLinks([first, second], 1), [first]);
});



test("builds the organization project discovery URL with bounded pagination", () => {
  const url = buildOrganizationProjectsUrl("https://sentry.example.test", "acme/team");
  assert.equal(url.pathname, "/api/0/organizations/acme%2Fteam/projects/");
  assert.equal(url.searchParams.get("per_page"), "100");
  assert.equal(url.username, "");
  assert.equal(url.password, "");
});

test("follows project discovery cursors across pages", async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    requests.push(url);
    if (requests.length === 1) {
      return new Response(JSON.stringify([{ id: "1", slug: "web", name: "Web" }]), {
        status: 200,
        headers: {
          "content-type": "application/json",
          link: '<https://sentry.example.test/api/0/organizations/acme/projects/?cursor=0%3A1%3A0>; rel="next"; results="true"; cursor="0:1:0"',
        },
      });
    }
    return new Response(JSON.stringify([{ id: "2", slug: "api", name: "API" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const result = await discoverSentryProjects(
      "https://sentry.example.test",
      "acme",
      "pagination-token",
    );
    assert.deepEqual(result.projects.map((project) => project.slug), ["web", "api"]);
    assert.equal(result.warning, null);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].searchParams.get("per_page"), "100");
    assert.equal(requests[1].searchParams.get("cursor"), "0:1:0");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("reports incomplete project discovery when a full page has no cursor", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(
    Array.from({ length: 100 }, (_, index) => ({
      id: String(index),
      slug: "project-" + index,
      name: "Project " + index,
    })),
  ), { status: 200, headers: { "content-type": "application/json" } });
  try {
    const result = await discoverSentryProjects(
      "https://sentry.example.test",
      "acme",
      "pagination-token",
    );
    assert.equal(result.projects.length, 100);
    assert.match(result.warning ?? "", /incomplete/u);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("caps paginated project discovery and reports the cap", async () => {
  const previousFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    const start = (requestCount - 1) * 100;
    return new Response(JSON.stringify(
      Array.from({ length: 100 }, (_, index) => ({
        id: String(start + index),
        slug: "project-" + (start + index),
        name: "Project " + (start + index),
      })),
    ), {
      status: 200,
      headers: {
        "content-type": "application/json",
        link: '<https://sentry.example.test/api/0/organizations/acme/projects/?cursor=next-' + requestCount + '>; rel="next"; results="true"; cursor="next-' + requestCount + '"',
      },
    });
  };
  try {
    const result = await discoverSentryProjects(
      "https://sentry.example.test",
      "acme",
      "pagination-token",
    );
    assert.equal(result.projects.length, 500);
    assert.match(result.warning ?? "", /capped/u);
    assert.equal(requestCount, 5);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("tests the token, organization, and configured projects without returning the token", async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(input);
    requests.push({
      pathname: url.pathname,
      authorization: init?.headers?.Authorization,
    });
    return new Response(JSON.stringify([{ id: "1", slug: "web", name: "Web" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const result = await testSentryConnection(
      { baseUrl: "https://sentry.example.test", orgSlug: "acme", projectSlugs: ["web"] },
      "super-secret-token",
    );
    assert.equal(result.ok, true);
    assert.deepEqual(result.organization, { slug: "acme", name: null, ok: true, error: null });
    assert.deepEqual(result.projects, [{ slug: "web", name: "Web", ok: true, error: null }]);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].authorization, "Bearer super-secret-token");
    assert.equal(JSON.stringify(result).includes("super-secret-token"), false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("reports an individual configured project failure after organization validation", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/projects/")) {
      return new Response(JSON.stringify([{ id: "1", slug: "web", name: "Web" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("", { status: 403 });
  };
  try {
    const result = await testSentryConnection(
      {
        baseUrl: "https://sentry.example.test",
        orgSlug: "acme",
        projectSlugs: ["web", "api"],
      },
      "project-check-token",
    );
    assert.equal(result.organization.ok, true);
    assert.equal(result.ok, false);
    assert.deepEqual(result.projects.map((project) => [project.slug, project.ok]), [
      ["web", true],
      ["api", false],
    ]);
    assert.match(result.projects[1].error, /403/u);
    assert.equal(JSON.stringify(result).includes("project-check-token"), false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("records failed project health and recovers to degraded or healthy states", () => {
  const testedAt = "2026-08-29T10:00:00.000Z";
  const failed = healthAfterTest(
    emptyConnectionHealth(),
    [{ slug: "web", name: null, ok: false, error: "Sentry rejected the token (401)." }],
    testedAt,
  );
  assert.equal(failed.status, "failed");
  assert.deepEqual(failed.failedProjects, ["web"]);
  assert.equal(failed.lastFailure?.message, "Sentry rejected the token (401).");

  const partiallyRecovered = healthAfterSync(failed, "api", "2026-08-29T10:01:00.000Z", null);
  assert.equal(partiallyRecovered.status, "degraded");
  assert.deepEqual(partiallyRecovered.failedProjects, ["web"]);

  const recovered = healthAfterTest(
    partiallyRecovered,
    [{ slug: "web", name: "Web", ok: true, error: null }, { slug: "api", name: "API", ok: true, error: null }],
    "2026-08-29T10:02:00.000Z",
  );
  assert.equal(recovered.status, "healthy");
  assert.deepEqual(recovered.failedProjects, []);
  assert.equal(recovered.lastTestedAt, "2026-08-29T10:02:00.000Z");
  assert.equal(connectionHealth(recovered).status, "healthy");
});

test("uses manual project validation when organization discovery is unavailable", async () => {
  const previousFetch = globalThis.fetch;
  const paths = [];
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    paths.push(url.pathname);
    if (url.pathname.endsWith("/projects/")) return new Response("", { status: 404 });
    return new Response("[]", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const discovery = await discoverSentryProjects(
      "https://sentry.example.test",
      "acme",
      "manual-fallback-token",
    );
    assert.equal(discovery.fallback, true);
    assert.deepEqual(discovery.projects, []);
    assert.match(discovery.warning, /manually/u);

    const result = await testSentryConnection(
      { baseUrl: "https://sentry.example.test", orgSlug: "acme", projectSlugs: ["web"] },
      "manual-fallback-token",
    );
    assert.equal(result.ok, true);
    assert.equal(result.fallback, true);
    assert.equal(result.organization.ok, true);
    assert.equal(result.projects[0].ok, true);
    assert.deepEqual(paths, [
      "/api/0/organizations/acme/projects/",
      "/api/0/organizations/acme/projects/",
      "/api/0/projects/acme/web/issues/",
    ]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("does not expose an invalid token in a failed connection result", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("", { status: 401 });
  try {
    const result = await testSentryConnection(
      { baseUrl: "https://sentry.example.test", orgSlug: "acme", projectSlugs: ["web"] },
      "invalid-secret-token",
    );
    assert.equal(result.ok, false);
    assert.equal(result.organization.ok, false);
    assert.equal(result.projects[0].ok, false);
    assert.equal(JSON.stringify(result).includes("invalid-secret-token"), false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("deletes all persisted connection artifacts while preserving other connections", () => {
  const db = new Database(":memory:");
  db.exec(
    `CREATE TABLE issue_snapshots (connection_id TEXT);
     CREATE TABLE issue_details (connection_id TEXT);
     CREATE TABLE connection_health (connection_id TEXT);
     CREATE TABLE triage_thread_links (connection_id TEXT);`,
  );
  for (const table of ["issue_snapshots", "issue_details", "connection_health", "triage_thread_links"]) {
    db.prepare(`INSERT INTO ${table} (connection_id) VALUES (?), (?)`).run("gone", "keep");
  }

  deleteConnectionArtifacts(db, "gone");

  for (const table of ["issue_snapshots", "issue_details", "connection_health", "triage_thread_links"]) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE connection_id = ?`).get("gone").count, 0);
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE connection_id = ?`).get("keep").count, 1);
  }
  db.close();
});

test("aggregates issues with connection and project identity", () => {
  const first = normalizeIssue({
    id: "same-id",
    shortId: "WEB-1",
    title: "First project",
    status: "unresolved",
    lastSeen: "2026-08-03T00:00:00Z",
  });
  const second = normalizeIssue({
    id: "same-id",
    shortId: "WEB-1",
    title: "Second account",
    status: "unresolved",
    lastSeen: "2026-08-02T00:00:00Z",
  });
  const result = aggregateIssues([
    {
      connectionId: "work",
      connectionLabel: "Work",
      orgSlug: "acme",
      projectSlug: "web",
      issues: [first],
    },
    {
      connectionId: "personal",
      connectionLabel: "Personal",
      orgSlug: "acme",
      projectSlug: "web",
      issues: [second],
    },
  ]);
  assert.deepEqual(result.map((issue) => [
    issue.connectionId,
    issue.connectionLabel,
    issue.orgSlug,
    issue.projectSlug,
    issue.id,
  ]), [
    ["work", "Work", "acme", "web", "same-id"],
    ["personal", "Personal", "acme", "web", "same-id"],
  ]);
  assert.notEqual(issueRouteKey("work", "web", "same-id"), issueRouteKey("personal", "web", "same-id"));
  assert.notEqual(issueRouteKey("work", "web", "same-id"), issueRouteKey("work", "api", "same-id"));
});

test("reads Sentry next cursors and merges a bounded page", () => {
  const link = [
    '<https://sentry.example.test/api/issues/?cursor=0%3A0%3A1>; rel="previous"; results="false"; cursor="0:0:1"',
    '<https://sentry.example.test/api/issues/?cursor=0%3A50%3A0>; rel="next"; results="true"; cursor="0:50:0"',
  ].join(", ");
  assert.equal(nextCursorFromLink(link), "0:50:0");
  assert.equal(
    nextCursorFromLink('<https://sentry.example.test/api/issues/?cursor=0%3A50%3A0>; rel="next"; results="false"; cursor="0:50:0"'),
    null,
  );

  const first = normalizeIssue({ id: "1", title: "First", lastSeen: "2026-08-03T00:00:00Z" });
  const second = normalizeIssue({ id: "2", title: "Second", lastSeen: "2026-08-02T00:00:00Z" });
  const updatedFirst = normalizeIssue({ id: "1", title: "Updated first", lastSeen: "2026-08-04T00:00:00Z" });
  assert.deepEqual(
    mergeIssuePages([first], [second, updatedFirst], 2).map((issue) => [issue.id, issue.title]),
    [["1", "Updated first"], ["2", "Second"]],
  );
});

test("exposes pagination cursors from the Sentry response headers", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("[]", {
    status: 200,
    headers: {
      link: '<https://sentry.example.test/api/issues/?cursor=0%3A50%3A0>; rel="next"; results="true"; cursor="0:50:0"',
    },
  });
  try {
    const result = await fetchSentryPage(new URL("https://sentry.example.test/api/issues/"), "cursor-token");
    assert.deepEqual(result.body, []);
    assert.equal(result.nextCursor, "0:50:0");
    assert.equal(result.hasNextLink, true);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("reports when Sentry omits pagination metadata", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("[]", { status: 200 });
  try {
    const result = await fetchSentryPage(new URL("https://sentry.example.test/api/issues/"), "cursor-token");
    assert.equal(result.hasNextLink, false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("rejects a next link that cannot continue pagination", () => {
  assert.throws(
    () => nextCursorFromLink('<https://sentry.example.test/api/issues/>; rel="next"; results="true"'),
    /usable cursor/,
  );
});

test("counts unresolved cached issues across targets and flags incomplete sync", () => {
  const result = cachedBadgeState([
    {
      issues: [
        normalizeIssue({ id: "1", status: "unresolved", level: "error" }),
        normalizeIssue({ id: "2", status: "resolved" }),
      ],
      newIssueCount: 1,
      complete: true,
      warning: null,
      healthStatus: "healthy",
    },
    {
      issues: [
        normalizeIssue({ id: "3", status: "unresolved", level: "warning" }),
        normalizeIssue({ id: "4", status: "ignored" }),
      ],
      newIssueCount: 2,
      complete: false,
      warning: "request failed",
      healthStatus: "degraded",
    },
  ]);
  assert.deepEqual(result, {
    count: 2,
    severityCounts: { error: 1, warning: 1, info: 0 },
    error: true,
    complete: false,
    newIssueCount: 3,
  });
});

test("counts newly discovered unresolved issue ids between snapshots", () => {
  const previous = [
    normalizeIssue({ id: "known", status: "unresolved" }),
  ];
  const current = [
    normalizeIssue({ id: "known", status: "unresolved" }),
    normalizeIssue({ id: "new", status: "unresolved" }),
    normalizeIssue({ id: "resolved", status: "resolved" }),
  ];

  assert.equal(countNewIssues(previous, current), 1);
  assert.equal(countNewIssues(null, current), 0);
});

test("maps Sentry levels into the three display severity categories", () => {
  const result = cachedBadgeState([
    {
      issues: [
        normalizeIssue({ id: "fatal", status: "unresolved", level: "fatal" }),
        normalizeIssue({ id: "error", status: "unresolved", level: "error" }),
        normalizeIssue({ id: "warning", status: "unresolved", level: "warning" }),
        normalizeIssue({ id: "info", status: "unresolved", level: "info" }),
        normalizeIssue({ id: "debug", status: "unresolved", level: "debug" }),
        normalizeIssue({ id: "unknown", status: "unresolved" }),
      ],
      complete: true,
      warning: null,
      healthStatus: "healthy",
    },
  ]);

  assert.deepEqual(result.severityCounts, { error: 2, warning: 1, info: 3 });
});

test("creates separate display badges for all severity categories", () => {
  assert.deepEqual(issueBadgeEntries({ error: 2, warning: 0, info: 4 }), [
    { severity: "error", count: 2 },
    { severity: "warning", count: 0 },
    { severity: "info", count: 4 },
  ]);
});


test("drops sensitive tags and sanitizes URLs under arbitrary fields", () => {
  const url = "https://sentry.example.test/path?access_token=event-token&safe=ok#private";
  const embedded = "see " + url;
  const event = normalizeIssueEvent({
    eventID: "event-1",
    tags: [
      { key: "authorization", value: "Bearer event-token" },
      { key: "ordinary", value: "secret" },
      { key: "safe", value: "visible" },
    ],
    location: url,
    extra: {
      redirect: url,
      location: url,
      resource: url,
      data: { redirect: url, note: embedded },
    },
  });

  assert.deepEqual(event.tags, [{ key: "safe", value: "visible" }]);
  assert.equal(event.location?.includes("event-token"), false);
  assert.equal(event.location?.includes("#"), false);
  assert.equal(new URL(event.location).searchParams.get("access_token"), "[redacted]");
  assert.equal(new URL(event.location).searchParams.get("safe"), "ok");
  assert.equal(JSON.stringify(event).includes("event-token"), false);
  assert.equal(JSON.stringify(event).includes("#private"), false);
});

test("bounds normalized strings with an explicit truncation marker", () => {
  const long = "x".repeat(MAX_NORMALIZED_STRING_LENGTH + 200);
  const issue = normalizeIssue({
    id: long,
    title: long,
    culprit: long,
    tags: [{ key: "safe", value: long }],
  });
  const event = normalizeIssueEvent({
    eventID: long,
    message: long,
    extra: { payload: long },
  });

  assert.equal(issue.title.length, MAX_NORMALIZED_STRING_LENGTH);
  assert.ok(issue.title.endsWith(TRUNCATION_MARKER));
  assert.equal(issue.id.length, MAX_NORMALIZED_STRING_LENGTH);
  assert.equal(issue.topTags[0].value.length, MAX_NORMALIZED_STRING_LENGTH);
  assert.equal(event.message?.length, MAX_NORMALIZED_STRING_LENGTH);
  assert.ok(event.message?.endsWith(TRUNCATION_MARKER));
  assert.equal((event.extra).payload.length, MAX_NORMALIZED_STRING_LENGTH);
});

test("rejects oversized Sentry response bodies before JSON parsing", async () => {
  const previousFetch = globalThis.fetch;
  const oversized = JSON.stringify({ payload: "x".repeat(MAX_SENTRY_RESPONSE_BYTES) });
  globalThis.fetch = async () => new Response(oversized, { status: 200 });
  try {
    await assert.rejects(
      fetchSentryPage(new URL("https://sentry.example.test/api/issues/"), "test-token"),
      new RegExp("exceeded " + MAX_SENTRY_RESPONSE_BYTES + " bytes.*" + TRUNCATION_MARKER),
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("requires project identity and matches event identity at the shared resource boundary", () => {
  assert.equal(issueBelongsToProject({ project: { slug: "web" } }, "web"), true);
  assert.equal(issueBelongsToProject({ project: { slug: "other" } }, "web"), false);
  assert.equal(issueBelongsToProject({ id: "42" }, "web"), false);

  const event = { eventID: "event-1", groupID: "42", project: { slug: "web" } };
  assert.equal(eventBelongsToIssue(event, "42", "web"), true);
  assert.equal(eventBelongsToIssue({ ...event, groupID: "other" }, "42", "web"), false);
  assert.equal(eventBelongsToIssue({ ...event, project: { slug: "other" } }, "42", "web"), false);
  assert.equal(eventBelongsToIssue({ eventID: "event-1" }, "42", "web"), false);
  assert.equal(eventBelongsToIssue({ eventID: "event-1" }, "42", "web", true), true);
});
