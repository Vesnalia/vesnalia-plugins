import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "alia-plugin-openrouter-inference",
    include: ["**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
