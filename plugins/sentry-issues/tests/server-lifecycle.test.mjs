import assert from "node:assert/strict";
import test from "node:test";
import { createFakePluginHost } from "@vesnalia/plugin-sdk/testing";
import plugin from "../src/server.ts";

let hostNumber = 0;

function response(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function connection(id, projectSlug = "web") {
  return {
    id,
    label: id,
    orgSlug: "acme",
    projectSlugs: [projectSlug],
    projectLinks: [],
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function loadHost({ connections, tokens, fetchResponse }) {
  const previousFetch = globalThis.fetch;
  const id = ++hostNumber;
  globalThis.fetch = (input, init) => fetchResponse(new URL(input), init);
  const host = createFakePluginHost({
    pluginId: "sentry-lifecycle-" + id,
    dataDir: "/tmp/alia-sentry-lifecycle-" + id,
    settings: { connectionTokens: JSON.stringify(tokens) },
    sdk: { plugins: { updateSettings: () => undefined } },
  });
  try {
    await host.alia.storage.kv.set("sentry-connections", connections);
    await plugin(host.alia);
    return {
      host,
      restore: () => {
        globalThis.fetch = previousFetch;
      },
    };
  } catch (error) {
    globalThis.fetch = previousFetch;
    await host.harness.lifecycle.dispose();
    throw error;
  }
}

async function cleanup(loaded) {
  loaded.restore();
  await loaded.host.harness.lifecycle.dispose();
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail("timed out waiting for lifecycle state");
}

test("aborting the background service aborts fetch and leaves no failure state", async () => {
  const pending = deferred();
  let started = false;
  let aborted = false;
  const loaded = await loadHost({
    connections: [connection("work")],
    tokens: { work: "test-token" },
    fetchResponse: (_url, init) => {
      started = true;
      init.signal.addEventListener("abort", () => {
        aborted = true;
        pending.reject(new DOMException("aborted", "AbortError"));
      }, { once: true });
      return pending.promise;
    },
  });
  try {
    const service = loaded.host.harness.runService("sync");
    await waitFor(() => started);
    service.controller.abort();
    await service.done;
    assert.equal(aborted, true);
    const db = loaded.host.alia.storage.database();
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM issue_snapshots").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM connection_health").get().count, 0);
  } finally {
    await cleanup(loaded);
  }
});

test("refreshes targets with bounded observable concurrency and keeps partial failures", async () => {
  const connections = Array.from({ length: 8 }, (_, index) => connection("c" + index, "web" + index));
  const tokens = Object.fromEntries(connections.map((item) => [item.id, "test-token"]));
  let active = 0;
  let maximumActive = 0;
  const loaded = await loadHost({
    connections,
    tokens,
    fetchResponse: async (url) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return response([]);
    },
  });
  try {
    const result = await loaded.host.harness.behavior.callRpc("refreshAllIssues", null);
    assert.equal(result.complete, true);
    assert.equal(maximumActive <= 4, true);
    assert.equal(loaded.host.harness.logEntries.some((entry) => entry.message.includes("Sentry sync refreshed")), true);
  } finally {
    await cleanup(loaded);
  }

  const partialConnections = [connection("ok-1", "web"), connection("bad", "api"), connection("ok-2", "worker")];
  const partialTokens = Object.fromEntries(partialConnections.map((item) => [item.id, "test-token"]));
  const partial = await loadHost({
    connections: partialConnections,
    tokens: partialTokens,
    fetchResponse: async (url) => url.pathname.includes("/projects/acme/api/")
      ? response({}, 500)
      : response([issue("good", url.pathname.includes("worker") ? "worker" : "web")]),
  });
  try {
    const result = await partial.host.harness.behavior.callRpc("refreshAllIssues", null);
    assert.equal(result.issues.length, 2);
    assert.equal(result.complete, false);
    assert.match(result.warning, /500|failed|incomplete|No cached/iu);
  } finally {
    await cleanup(partial);
  }
});

test("connection removal invalidates an in-flight refresh before it can write stale data", async () => {
  const pending = deferred();
  let started = false;
  let removalStarted = false;
  const loaded = await loadHost({
    connections: [connection("work")],
    tokens: { work: "test-token" },
    fetchResponse: (_url, init) => {
      started = true;
      init.signal.addEventListener("abort", () => {
        removalStarted = true;
      }, { once: true });
      return pending.promise;
    },
  });
  try {
    const refresh = loaded.host.harness.behavior.callRpc("refreshIssues", {
      connectionId: "work",
      projectSlug: "web",
    });
    await waitFor(() => started);
    const removal = loaded.host.harness.behavior.callRpc("removeConnection", {
      connectionId: "work",
      confirmation: "REMOVE",
    });
    await waitFor(() => removalStarted);
    pending.resolve(response([issue("stale")]));
    await assert.rejects(refresh, /aborted|superseded/iu);
    await removal;
    assert.deepEqual(await loaded.host.alia.storage.kv.get("sentry-connections"), []);
    const db = loaded.host.alia.storage.database();
    for (const table of ["issue_snapshots", "issue_details", "connection_health", "triage_thread_links"]) {
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM " + table).get().count, 0);
    }
  } finally {
    await cleanup(loaded);
  }
});

test("serializes refresh and pagination so load-more observes the newest cursor", async () => {
  const first = deferred();
  const cursors = [];
  let requestCount = 0;
  const loaded = await loadHost({
    connections: [connection("work")],
    tokens: { work: "test-token" },
    fetchResponse: async (url) => {
      requestCount += 1;
      cursors.push(url.searchParams.get("cursor"));
      if (requestCount === 1) return await first.promise;
      assert.equal(url.searchParams.get("cursor"), "new-cursor");
      return response([issue("page-2")]);
    },
  });
  try {
    const refresh = loaded.host.harness.behavior.callRpc("refreshIssues", {
      connectionId: "work",
      projectSlug: "web",
    });
    await waitFor(() => requestCount === 1);
    const loadMore = loaded.host.harness.behavior.callRpc("loadMoreIssues", {
      connectionId: "work",
      projectSlug: "web",
    });
    first.resolve(response([issue("fresh")], 200, {
      link: '<https://sentry.example.test/api/issues/?cursor=new-cursor>; rel="next"; results="true"; cursor="new-cursor"',
    }));
    await refresh;
    await loadMore;
    assert.deepEqual(cursors, [null, "new-cursor"]);
    const result = await loaded.host.harness.behavior.callRpc("listIssues", {
      connectionId: "work",
      projectSlug: "web",
    });
    assert.deepEqual(result.issues.map((item) => item.id), ["fresh", "page-2"]);
  } finally {
    await cleanup(loaded);
  }
});

test("rejects metadata that would exceed the VesnALIA KV limit before touching secrets", async () => {
  const longSlug = (id, index) => id + "-" + String(index).padStart(2, "0") + "-" + "p".repeat(180);
  const heavy = (id) => {
    const projectSlugs = Array.from({ length: 50 }, (_, index) => longSlug(id, index));
    return {
      ...connection(id, projectSlugs[0]),
      projectSlugs,
      projectLinks: projectSlugs.slice(0, 7).map((projectSlug, index) => ({
        projectSlug,
        localProjectId: id + "-local-" + String(index) + "-" + "l".repeat(180),
      })),
    };
  };
  const base = [];
  for (let index = 0; index < 19; index += 1) {
    const candidate = heavy("c" + index);
    const next = [...base, candidate, connection("spare")];
    const bytes = new TextEncoder().encode(JSON.stringify(next)).byteLength;
    if (bytes >= 245_000) break;
    base.push(candidate);
  }
  const finalConnection = connection("spare");
  const connections = [...base, finalConnection];
  const expandedSlugs = Array.from({ length: 50 }, (_, index) => longSlug("expanded", index));
  const expanded = {
    ...finalConnection,
    projectSlugs: expandedSlugs,
    projectLinks: expandedSlugs.map((projectSlug, index) => ({
      projectSlug,
      localProjectId: "local-" + String(index) + "-" + "l".repeat(180),
    })),
  };
  const beforeBytes = new TextEncoder().encode(JSON.stringify(connections)).byteLength;
  const afterBytes = new TextEncoder().encode(JSON.stringify([...base, expanded])).byteLength;
  assert.equal(beforeBytes < 256 * 1024, true);
  assert.equal(beforeBytes > 220_000, true);
  assert.equal(afterBytes > 256 * 1024, true);
  const tokens = Object.fromEntries(connections.map((item) => [item.id, "test-token"]));
  const loaded = await loadHost({ connections, tokens, fetchResponse: async () => response([]) });
  try {
    const before = await loaded.host.alia.storage.kv.get("sentry-connections");
    await assert.rejects(
      loaded.host.harness.behavior.callRpc("saveConnection", {
        id: "spare",
        label: expanded.label,
        orgSlug: expanded.orgSlug,
        projectSlugs: expanded.projectSlugs,
        projectLinks: expanded.projectLinks,
        baseUrl: expanded.baseUrl,
        filters: expanded.filters,
      }),
      /256 KiB/iu,
    );
    assert.deepEqual(await loaded.host.alia.storage.kv.get("sentry-connections"), before);
    assert.equal(loaded.host.harness.sdk.callsTo("plugins.updateSettings").length, 0);
  } finally {
    await cleanup(loaded);
  }
});

test("rolls back metadata and keeps SQLite artifacts when connection removal secret storage fails", async () => {
  const loaded = await loadHost({
    connections: [connection("work")],
    tokens: { work: "test-token" },
    fetchResponse: async () => response([issue("cached")]),
  });
  try {
    await loaded.host.harness.behavior.callRpc("refreshIssues", {
      connectionId: "work",
      projectSlug: "web",
    });
    const before = await loaded.host.alia.storage.kv.get("sentry-connections");
    loaded.host.harness.sdk.stub("plugins.updateSettings", () => {
      throw new Error("simulated secret storage failure");
    });
    await assert.rejects(
      loaded.host.harness.behavior.callRpc("removeConnection", {
        connectionId: "work",
        confirmation: "REMOVE",
      }),
      /secret|credentials/iu,
    );
    assert.deepEqual(await loaded.host.alia.storage.kv.get("sentry-connections"), before);
    const db = loaded.host.alia.storage.database();
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM issue_snapshots WHERE connection_id = 'work'").get().count, 1);
    const connections = await loaded.host.harness.behavior.callRpc("getConnections", null);
    assert.deepEqual(connections.connections.map((item) => item.id), ["work"]);
  } finally {
    await cleanup(loaded);
  }
});
