import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "alia-plugin-gone-fishing",
    silent: "passed-only",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**"],
  },
});
