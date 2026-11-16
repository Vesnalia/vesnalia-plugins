import assert from "node:assert/strict";
import test from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../src/server.ts";

let hostNumber = 0;

function response(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function connection(id = "work", projectSlug = "web", projectLinks = []) {
  return {
    id,
    label: id,
    orgSlug: "acme",
    projectSlugs: [projectSlug],
    projectLinks,
    baseUrl: "https://sentry.example.test",
    filters: { environment: "", timeRange: "24h", query: "", limit: "20" },
  };
}

function issue(id, projectSlug = "web") {
  return {
    id,
    shortId: projectSlug.toUpperCase() + "-" + id,
    title: "Issue " + id,
    status: "unresolved",
    count: "1",
    project: { slug: projectSlug },
    lastSeen: "2026-08-30T10:00:00Z",
  };
}

async function loadHost({
  connections = [],
  tokens = {},
  fetchResponse = async () => response([]),
  sdk = {},
} = {}) {
  const previousFetch = globalThis.fetch;
  const host = createFakePluginHost({
    pluginId: "sentry-contract-" + (++hostNumber),
    settings: { connectionTokens: JSON.stringify(tokens) },
    sdk: { plugins: { updateSettings: () => undefined }, ...sdk },
  });
  globalThis.fetch = (input, init) => fetchResponse(new URL(input), init);
  try {
    await host.bb.storage.kv.set("sentry-connections", connections);
    await plugin(host.bb);
    return {
      host,
      cleanup: async () => {
        globalThis.fetch = previousFetch;
        await host.harness.lifecycle.dispose();
      },
    };
  } catch (error) {
    globalThis.fetch = previousFetch;
    await host.harness.lifecycle.dispose();
    throw error;
  }
}

test("registers secret settings and restores externally edited credentials", async () => {
  const token = "secret-token";
  const loaded = await loadHost({
    connections: [connection()],
    tokens: { work: token },
  });
  try {
    const { host } = loaded;
    const descriptors = host.harness.inspection.registrations.settingsDescriptors;
    assert.equal(descriptors.connectionTokens.secret, true);
    assert.equal(descriptors.connectionTokens.type, "string");
    assert.equal(host.harness.inspection.registrations.services.map((service) => service.name).join(","), "sync");
    assert.equal(host.harness.inspection.registrations.mentionProviders[0].id, "sentry-issue");
    assert.ok(host.harness.inspection.registrations.rpcMethods.includes("getConnections"));
    assert.ok(host.harness.inspection.registrations.rpcMethods.includes("removeConnection"));

    const result = await host.harness.behavior.callRpc("getConnections", null);
    assert.equal(result.connections[0].configured, true);
    assert.equal(JSON.stringify(result).includes(token), false);

    await host.harness.behavior.setSettings({
      connectionTokens: JSON.stringify({ work: "edited-outside-connections" }),
    });
    await new Promise((resolve) => setImmediate(resolve));
    const updates = host.harness.inspection.sdk.callsTo("plugins.updateSettings");
    assert.equal(updates.length, 1);
    assert.equal(updates[0][0].values.connectionTokens, JSON.stringify({ work: token }));
    assert.equal(JSON.stringify(await host.harness.behavior.callRpc("getConnections", null)).includes(token), false);
  } finally {
    await loaded.cleanup();
  }
});

test("reports newly detected unresolved issues in the issue badge", async () => {
  let requestCount = 0;
  const loaded = await loadHost({
    connections: [connection()],
    tokens: { work: "test-token" },
    fetchResponse: async () => {
      requestCount += 1;
      const issues = requestCount === 1
        ? [issue("existing")]
        : [issue("existing"), issue("new")];
      return response(issues);
    },
  });
  try {
    const first = await loaded.host.harness.behavior.callRpc("getIssueBadge", null);
    assert.equal(first.count, 1);
    assert.equal(first.newIssueCount, 0);

    await loaded.host.harness.behavior.callRpc("refreshIssues", {
      connectionId: "work",
      projectSlug: "web",
    });
    const second = await loaded.host.harness.behavior.callRpc("getIssueBadge", null);
    assert.equal(second.count, 2);
    assert.equal(second.newIssueCount, 1);

    await loaded.host.harness.behavior.callRpc("refreshIssues", {
      connectionId: "work",
      projectSlug: "web",
    });
    const third = await loaded.host.harness.behavior.callRpc("getIssueBadge", null);
    assert.equal(third.newIssueCount, 0);
    assert.equal(requestCount, 3);
  } finally {
    await loaded.cleanup();
  }
});

test("bounds cached issue details per project", async () => {
  const loaded = await loadHost({
    connections: [connection()],
    tokens: { work: "test-token" },
    fetchResponse: async (url) => url.pathname.endsWith("/events/")
      ? response([])
      : response({ ...issue(url.pathname.split("/").at(-2)), project: { slug: "web" } }),
  });
  try {
    for (let index = 0; index < 101; index += 1) {
      await loaded.host.harness.behavior.callRpc("getIssueDetail", {
        connectionId: "work",
        projectSlug: "web",
        issueId: "issue-" + index,
      });
    }
    const db = loaded.host.bb.storage.database();
    const row = db.prepare(
      "SELECT COUNT(*) AS count FROM issue_details WHERE connection_id = 'work' AND project_slug = 'web'",
    ).get();
    assert.equal(row.count, 100);
  } finally {
    await loaded.cleanup();
  }
});

test("paginates project discovery through the RPC boundary", async () => {
  const requests = [];
  const loaded = await loadHost({
    fetchResponse: async (url, init) => {
      requests.push({ url, init });
      if (url.searchParams.get("cursor") === null) {
        return response([{ id: "project-web", slug: "web", name: "Web" }], 200, {
          link: '<https://sentry.example.test/api/0/organizations/acme/projects/?cursor=next>; rel="next"; results="true"; cursor="next"',
        });
      }
      return response([{ id: "project-api", slug: "api", name: "API" }]);
    },
  });
  try {
    const result = await loaded.host.harness.behavior.callRpc("discoverProjects", {
      orgSlug: "acme",
      baseUrl: "https://sentry.example.test",
      authToken: "discovery-token",
    });
    assert.deepEqual(result.projects.map((project) => project.slug), ["web", "api"]);
    assert.equal(result.fallback, false);
    assert.equal(result.warning, null);
    assert.deepEqual(requests.map(({ url }) => url.searchParams.get("cursor")), [null, "next"]);
    assert.equal(requests[0].init.headers.Authorization, "Bearer discovery-token");
    assert.equal(JSON.stringify(result).includes("discovery-token"), false);
  } finally {
    await loaded.cleanup();
  }
});

test("exposes project discovery truncation when a full page has no cursor", async () => {
  let requestCount = 0;
  const loaded = await loadHost({
    fetchResponse: async () => {
      requestCount += 1;
      return response(Array.from({ length: 100 }, (_, index) => ({
        id: "project-" + index,
        slug: "project-" + index,
        name: "Project " + index,
      })));
    },
  });
  try {
    const result = await loaded.host.harness.behavior.callRpc("discoverProjects", {
      orgSlug: "acme",
      baseUrl: "https://sentry.example.test",
      authToken: "discovery-token",
    });
    assert.equal(requestCount, 1);
    assert.equal(result.projects.length, 100);
    assert.equal(result.fallback, false);
    assert.match(result.warning ?? "", /incomplete/iu);
  } finally {
    await loaded.cleanup();
  }
});

test("enforces RPC boundaries before handlers run", async () => {
  const loaded = await loadHost();
  try {
    const { host } = loaded;
    await assert.rejects(
      host.harness.behavior.callRpc("getConnections", { unexpected: true }),
      /rpc input|invalid/u,
    );
    await assert.rejects(
      host.harness.behavior.callRpc("removeConnection", {
        connectionId: "work",
        confirmation: "NO",
      }),
      /rpc input|REMOVE|invalid/u,
    );
    await assert.rejects(
      host.harness.behavior.callRpc("not-a-method", null),
      /no rpc method|unknown.*method/u,
    );
    await assert.rejects(
      host.harness.behavior.callRpc("saveConnection", {
        label: "Work",
        orgSlug: "acme",
        projectSlugs: ["web"],
        baseUrl: "https://sentry.example.test",
      }),
      /Enter a Sentry auth token/u,
    );
    assert.equal(host.harness.inspection.sdk.callsTo("plugins.updateSettings").length, 0);
  } finally {
    await loaded.cleanup();
  }
});

test("disposes the registered sync service and storage handles", async () => {
  const loaded = await loadHost();
  try {
    const service = loaded.host.harness.lifecycle.runService("sync");
    await loaded.host.harness.lifecycle.dispose();
    await service.done;
    assert.equal(service.controller.signal.aborted, true);
    assert.throws(
      () => loaded.host.bb.storage.database(),
      /stale API handle/u,
    );
  } finally {
    await loaded.cleanup();
  }
});

test("keeps partial refresh results while reporting the failed target", async () => {
  const loaded = await loadHost({
    connections: [connection("good", "web"), connection("bad", "api")],
    tokens: { good: "good-token", bad: "bad-token" },
    fetchResponse: async (url) => url.pathname.includes("/projects/acme/api/")
      ? response({}, 500)
      : response([issue("good")]),
  });
  try {
    const result = await loaded.host.harness.behavior.callRpc("refreshAllIssues", null);
    assert.deepEqual(result.issues.map((item) => item.id), ["good"]);
    assert.equal(result.complete, false);
    assert.match(result.warning ?? "", /500|failed|incomplete|No cached/iu);
  } finally {
    await loaded.cleanup();
  }
});

test("serves bounded mention and triage context before removing every artifact", async () => {
  const loaded = await loadHost({
    connections: [connection("work", "web", [{ projectSlug: "web", localProjectId: "local-web" }])],
    tokens: { work: "triage-token" },
    fetchResponse: async (url) => {
      if (url.pathname.endsWith("/events/")) return response([]);
      if (url.pathname.includes("/issues/42/")) {
        return response({
          ...issue("42"),
          project: { id: "9", slug: "web", name: "Web" },
        });
      }
      return response([issue("42")]);
    },
    sdk: {
      projects: {
        get: () => ({ id: "local-web", sources: [{ type: "local_path", path: "/tmp/local-web" }] }),
      },
      threads: {
        spawn: () => ({ id: "thread-1", title: "Triage", status: "idle" }),
      },
    },
  });
  try {
    const { host } = loaded;
    await host.harness.behavior.callRpc("refreshIssues", {
      connectionId: "work",
      projectSlug: "web",
    });

    const mention = host.harness.inspection.registrations.mentionProviders[0];
    const matches = await mention.search({ query: "WEB", projectId: "local-web", threadId: "thread-1" });
    assert.equal(matches.length, 1);
    const resolved = await mention.resolve(matches[0].id);
    assert.equal(resolved.context.includes("triage-token"), false);
    assert.equal(resolved.context.length <= 9000, true);

    const triage = await host.harness.behavior.callRpc("triageIssue", {
      connectionId: "work",
      projectSlug: "web",
      issueId: "42",
      newRun: true,
    });
    assert.equal(triage.threadId, "thread-1");
    assert.equal(host.harness.inspection.sdk.callsTo("threads.spawn").length, 1);

    await host.harness.behavior.callRpc("removeConnection", {
      connectionId: "work",
      confirmation: "REMOVE",
    });
    assert.deepEqual(await host.bb.storage.kv.get("sentry-connections"), []);
    assert.equal(host.harness.inspection.sdk.callsTo("plugins.updateSettings").at(-1)[0].values.connectionTokens, "{}");
    const db = host.bb.storage.database();
    for (const table of ["issue_snapshots", "issue_details", "connection_health", "triage_thread_links"]) {
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM " + table).get().count, 0);
    }
  } finally {
    await loaded.cleanup();
  }
});
