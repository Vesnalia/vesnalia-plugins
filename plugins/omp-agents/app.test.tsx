// @vitest-environment jsdom
// Renders the nav panel and asserts what each provider state tells the user.
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@vesnalia/plugin-sdk/testing/app";

const agent = (name) => ({
  name,
  description: `${name} description`,
  tools: [],
  model: [],
  spawns: [],
  scope: "user",
  filePath: `/home/u/.omp/agent/agents/${name}.md`,
});

let mounted = null;

afterEach(() => {
  // Every renderSlot appends to the same document; without this the next test
  // asserts against the previous test's DOM.
  mounted?.lifecycle.unmount();
  mounted = null;
});

async function render(result) {
  const app = await loadPluginApp(() => import("./app"));
  const slot = renderSlot(app.navPanels[0], { subPath: "" }, {
    rpc: { agents_list: () => result },
  });
  mounted = slot;
  // The panel fetches over rpc in an effect; wait for the row to land so the
  // assertion sees the settled state, not "Loading agents…".
  await slot.findByText(result.agents[0].name);
  return slot;
}

describe("OMP agents panel", () => {
  it("warns when the configured providers are unknown", async () => {
    const slot = await render({
      agents: [agent("sonar-agent")],
      searchedDirs: ["/home/u/.omp/agent/agents"],
      providerId: "claude-code",
      canSpawn: false,
      knownProviderIds: ["codex", "claude-code", "acp-omp"],
      configuredProviderIds: ["acp-ompp"],
    });
    const text = slot.container.textContent ?? "";
    expect(text).toContain("Providers that run OMP");
    expect(text).toContain("acp-ompp");
    expect(text).toContain("acp-omp");
    expect(slot.getByRole("alert")).toBeTruthy();
  });

  it("explains a non-OMP surface without the misconfiguration warning", async () => {
    const slot = await render({
      agents: [agent("sonar-agent")],
      searchedDirs: [],
      providerId: "claude-code",
      canSpawn: false,
      knownProviderIds: ["codex", "claude-code", "acp-omp"],
      configuredProviderIds: ["acp-omp"],
    });
    const text = slot.container.textContent ?? "";
    expect(text).toContain("runs on claude-code");
    expect(text).not.toContain("Providers that run OMP");
    expect(slot.queryByRole("alert")).toBeNull();
  });

  it("invites the composer when the surface is OMP", async () => {
    const slot = await render({
      agents: [agent("sonar-agent")],
      searchedDirs: [],
      providerId: "acp-omp",
      canSpawn: true,
      knownProviderIds: ["acp-omp"],
      configuredProviderIds: ["acp-omp"],
    });
    const text = slot.container.textContent ?? "";
    expect(text).toContain("Type @ in the composer");
    expect(slot.queryByRole("alert")).toBeNull();
  });
});
