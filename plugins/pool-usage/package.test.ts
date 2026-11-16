import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { experimental_scanPublicSdkOnly } from "@vesnalia/plugin-sdk/testing";

it("uses only the public SDK and package-local source", async () => {
  const result = await experimental_scanPublicSdkOnly(
    fileURLToPath(new URL(".", import.meta.url)),
    {
      allow: [
        // React, and VesnALIA's dialog, sheet, and toasts, which VesnALIA provides at runtime.
        /^(react|react-dom|sonner|vaul)$/,
        /^@radix-ui\/react-dialog$/,
        /^@testing-library\//,
      ],
    },
  );
  expect(result.violations).toEqual([]);
  expect(result.privateDependencies).toEqual([]);
});
