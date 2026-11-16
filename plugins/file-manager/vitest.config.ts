import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const rootDir = dirname(fileURLToPath(import.meta.url));

// Plain vitest config on purpose: this plugin lives outside the VesnALIA monorepo,
// so `defineWorkspaceTestConfig` (which rewrites `@alia-core/*` workspace conditions)
// is neither available nor meaningful here.
export default defineConfig({
  resolve: {
    // Mirrors `paths: { "@/*": ["./*"] }` in tsconfig.json. esbuild reads the
    // tsconfig during `alia plugin build`, but vitest does not, so imports like
    // `@/components/ui/button` need the alias spelled out for tests.
    alias: { "@": rootDir },
  },
  test: {
    name: "alia-plugin-file-manager",
    setupFiles: ["./vitest.setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", "dist/**"],
    // Backend suites build real temp trees and frontend suites drive
    // testing-library; 20s bounds a genuine hang without flaking.
    testTimeout: 20_000,
  },
});
