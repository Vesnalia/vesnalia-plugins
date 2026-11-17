import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    silent: "passed-only",
    name: "alia-plugin-alia-office",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", "vendor/**"],
  },
});
