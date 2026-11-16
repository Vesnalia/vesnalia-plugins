// Pins the message.dispatch guard — the checkpoint that stops an OMP mention
// from reaching a provider that cannot spawn it — and the factory's load-time
// safety, which a cold start depends on.
import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@vesnalia/plugin-sdk/testing";
import plugin from "./server";

const USER_DIR = "/home/u/.omp/agent/agents";
const AGENT_MD = "---\nname: sonar-agent\ndescription: SonarQube orchestrator\n---\n\nbody\n";

const mention = (pluginId: string, label: string) => ({
  start: 0,
  end: 8,
  resource: { kind: "plugin", pluginId, itemId: "omp-agent:sonar-agent~0", label },
});
const textBlock = (mentions: unknown[]) => ({ type: "text", text: "do it @sonar-agent", mentions });

function host(sdk: Record<string, unknown>) {
  return createFakePluginHost({ pluginId: "omp-agents", sdk });
}

const liveSdk = {
  system: {
    config: async () => ({
      primaryHostId: "host_1",
      generalSettings: { defaultProviderId: "acp-omp" },
    }),
  },
  threads: { get: async ({ threadId }: { threadId: string }) => ({ id: threadId, providerId: "acp-omp" }) },
  projects: { get: async () => ({ id: "p1", sources: [] }) },
  providers: { list: async () => [{ id: "acp-omp" }, { id: "claude-code" }] },
  hosts: {
    directory: async ({ path }: { path: string }) => {
      if (path !== USER_DIR) throw new Error("ENOENT");
      return {
        directory: USER_DIR,
        parent: "/home/u",
        entries: [{ kind: "file", name: "sonar-agent.md", path: `${USER_DIR}/sonar-agent.md` }],
      };
    },
  },
  files: {
    read: async ({ path }: { path: string }) => ({ path, content: AGENT_MD, contentEncoding: "utf8" }),
  },
};

async function setup() {
  const { alia, harness } = host(liveSdk);
  await plugin(alia);
  const dispatch = harness.registrations.hooks["message.dispatch"];
  if (dispatch === null) throw new Error("message.dispatch hook was not registered");
  const decide = (providerId: string, blocks: unknown[]) =>
    dispatch({ thread: { id: "t1", providerId }, input: { blocks, text: "do it @sonar-agent" } });
  return { harness, decide };
}

describe("message.dispatch guard", () => {
  it("proceeds when the thread's provider can spawn OMP agents", async () => {
    const { harness, decide } = await setup();
    expect((await decide("acp-omp", [textBlock([mention("omp-agents", "sonar-agent")])])).action).toBe(
      "proceed",
    );
    await harness.lifecycle.dispose();
  });

  it("rejects an OMP mention on a provider that cannot spawn it", async () => {
    const { harness, decide } = await setup();
    for (const providerId of ["claude-code", "codex", "pi", "acp-opencode"]) {
      const decision = await decide(providerId, [textBlock([mention("omp-agents", "sonar-agent")])]);
      expect(decision.action).toBe("reject");
      // The message has to name the provider and the fix, because this fires on
      // the New thread screen where the composer's picker is the only control.
      if (decision.action === "reject") {
        expect(decision.message).toContain(providerId);
        expect(decision.message).toContain("sonar-agent");
        expect(decision.message).toContain("acp-omp");
      }
    }
    await harness.lifecycle.dispose();
  });

  it("leaves unrelated sends alone", async () => {
    const { harness, decide } = await setup();
    // No mention at all.
    expect((await decide("acp-opencode", [textBlock([])])).action).toBe("proceed");
    // Another plugin's mention is not this plugin's business.
    expect((await decide("acp-opencode", [textBlock([mention("docs", "a note")])])).action).toBe(
      "proceed",
    );
    // A non-text block cannot carry a mention.
    expect((await decide("acp-opencode", [{ type: "image", url: "https://x/y.png" }])).action).toBe(
      "proceed",
    );
    await harness.lifecycle.dispose();
  });
});

describe("factory load safety", () => {
  it("loads without touching alia.sdk, so a cold start cannot deadlock", async () => {
    // A cold start runs this factory while provider registrations are still
    // unsettled, and the host's own `providers.list()` waits on that gate until
    // every plugin has loaded. Any `alia.sdk` call here would therefore wait on
    // the factory itself and fail the plugin at the 30s load timeout. The fake
    // host throws for every unstubbed sdk call, so an empty stub set is exactly
    // that condition: this must complete with no stub at all.
    const { alia, harness } = host({});
    await expect(plugin(alia)).resolves.toBeUndefined();
    expect(harness.registrations.hooks["message.dispatch"]).not.toBeNull();
    expect(harness.registrations.mentionProviders).toHaveLength(1);
    expect(harness.registrations.settingsDescriptors).toHaveProperty("providerIds");
    await harness.lifecycle.dispose();
  });
});
