import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  name: string;
  alia: { name: string; description: string };
};

describe("plugin identity", () => {
  it("uses Hands-Free for both the public name and package identity", () => {
    expect(manifest.alia).toMatchObject({
      name: "Hands-Free",
      description: "Talk to VesnALIA threads on iPhone and hear replies without returning to the chat view.",
    });
    expect(manifest.name).toBe("alia-plugin-hands-free");
  });
});
