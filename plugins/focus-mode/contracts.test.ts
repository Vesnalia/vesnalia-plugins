import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { experimental_scanPublicSdkOnly } from "@vesnalia/plugin-sdk/testing";

it("uses only public SDK contracts and package-local source", () => {
  const result = experimental_scanPublicSdkOnly(fileURLToPath(new URL(".", import.meta.url)), {
    allow: [/^react$/u, /^@radix-ui\/react-dialog$/u, /^@testing-library\//u],
  });
  expect(result.violations).toEqual([]);
  expect(result.privateDependencies).toEqual([]);
});
