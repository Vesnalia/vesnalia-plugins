import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "alia-plugin-btrfs-cow",
    include: ["**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 60_000,
  },
});
