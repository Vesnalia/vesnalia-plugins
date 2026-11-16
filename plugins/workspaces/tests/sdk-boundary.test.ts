import { experimental_scanPublicSdkOnly } from "@vesnalia/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

describe("public SDK boundary", () => {
  it("uses only the public VesnALIA plugin SDK and declared UI packages", () => {
    const scan = experimental_scanPublicSdkOnly(".", {
      allow: [
        /^@\//,
        /^@hugeicons\//,
        /^@radix-ui\//,
        /^@testing-library\//,
        /^class-variance-authority$/,
        /^clsx$/,
        /^react(?:-dom)?(?:\/.*)?$/,
        /^tailwind-merge$/,
        /^vitest(?:\/.*)?$/,
        /^better-sqlite3$/,
        /^zod$/,
      ],
    });

    expect(scan.violations).toEqual([]);
    expect(scan.privateDependencies).toEqual([]);
  });
});
