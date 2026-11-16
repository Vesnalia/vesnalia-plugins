import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin, { parseCliArgs } from "../server";

async function host() {
  const { bb, harness } = createFakePluginHost({ pluginId: "x-viral" });
  await plugin(bb);
  return harness;
}

describe("cli", () => {
  it("parses flags and text", () => {
    const parsed = parseCliArgs(["hello", "world", "--image", "--followers", "40", "--video=20", "--json"]);
    expect(parsed.text).toBe("hello world");
    expect(parsed.context).toMatchObject({ hasImage: true, authorFollowers: 40, hasVideo: true, videoSeconds: 20 });
    expect(parsed.json).toBe(true);
  });
  it("scores from the command line", async () => {
    const h = await host();
    const result = await h.behavior.runCli(["score", "Shipped the thing. Activation 31% to 47%.", "--json"]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout ?? "");
    expect(parsed.report.score).toBeGreaterThan(0);
    expect(Array.isArray(parsed.suggestions)).toBe(true);
    await h.lifecycle.dispose();
  });
  it("runs autoresearch from the command line", async () => {
    const h = await host();
    const result = await h.behavior.runCli(["autoresearch", "READ MY BLOG!!! https://x.example/1 #a #b #c like if you agree"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Improved post");
    await h.lifecycle.dispose();
  });
  it("rejects missing text", async () => {
    const h = await host();
    expect((await h.behavior.runCli(["score"])).exitCode).toBe(1);
    await h.lifecycle.dispose();
  });
});

describe("agent tools and rpc", () => {
  it("exposes both tools", async () => {
    const h = await host();
    const out = await h.behavior.callAgentTool("x_viral_score", { text: "Shipped it. What would you cut first?", context: { hasImage: true } });
    expect(JSON.stringify(out)).toContain("Viral reach score");
    const research = await h.behavior.callAgentTool("x_viral_autoresearch", { text: "link in bio!!! #a #b" });
    expect(JSON.stringify(research)).toContain("Original score");
    await h.lifecycle.dispose();
  });
  it("answers rpc", async () => {
    const h = await host();
    const out = (await h.behavior.callRpc("score", { text: "Shipped it." })) as { report: { score: number } };
    expect(out.report.score).toBeGreaterThanOrEqual(0);
    await h.lifecycle.dispose();
  });
});

function hasUndefined(value: unknown): boolean {
  if (value === undefined) return true;
  if (Array.isArray(value)) return value.some(hasUndefined);
  if (value !== null && typeof value === "object") return Object.values(value as object).some(hasUndefined);
  return false;
}

describe("rpc results are strict JSON", () => {
  it("never carries undefined fields", async () => {
    const h = await host();
    const research = await h.behavior.callRpc("autoresearch", { text: "Shipped it. Activation 31% to 47%. What would you cut?" });
    expect(hasUndefined(research)).toBe(false);
    const score = await h.behavior.callRpc("score", { text: "Shipped it." });
    expect(hasUndefined(score)).toBe(false);
    await h.lifecycle.dispose();
  });
});
