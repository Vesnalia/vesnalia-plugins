// Guards the package's dependency surface: Agent TV may only reach for the
// public Plugin SDK, zod, node builtins, and its own files. Run in the same
// suite so an import that quietly reaches into VesnALIA internals fails the build.
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { experimental_scanPublicSdkOnly } from "@vesnalia/plugin-sdk/testing";

const root = fileURLToPath(new URL("..", import.meta.url));

describe("public SDK only", () => {
  it("imports nothing private", () => {
    const { violations, privateDependencies } = experimental_scanPublicSdkOnly(
      root,
      {
        // Everything here is either a package VesnALIA shims at runtime, a plugin
        // dependency it declares, or this package's own "@/" alias.
        allow: [
          /^@\/(components|lib|hooks)\//,
          /^@hugeicons\/(react|core-free-icons)$/,
          /^zod$/,
          /^node:/,
          // alia-shimmed at runtime, and the test tooling that runs alongside it.
          /^(react|react-dom|clsx|tailwind-merge|class-variance-authority)$/,
          /^vitest(\/config)?$/,
          /^@testing-library\//,
        ],
      },
    );
    expect(violations).toEqual([]);
    expect(privateDependencies).toEqual([]);
  });
});
