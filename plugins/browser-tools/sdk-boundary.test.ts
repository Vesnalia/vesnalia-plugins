import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { experimental_scanPublicSdkOnly } from "@get-bb/plugin-sdk/testing";

describe("public SDK boundary", () => {
  it("imports only public SDK paths and package-local modules", () => {
    const packageRoot = fileURLToPath(new URL(".", import.meta.url));
    const result = experimental_scanPublicSdkOnly(packageRoot, {
      allow: [/^puppeteer-core$/, /^ws$/, /^@get-bb\/plugin-sdk\/testing(?:\/host)?$/],
    });
    expect(result.violations).toEqual([]);
    expect(result.privateDependencies).toEqual([]);
  });
});
