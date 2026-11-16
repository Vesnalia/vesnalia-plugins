import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "alia-plugin-korey",
    include: ["plugin/**/*.test.ts", "plugin/**/*.test.tsx"],
    exclude: ["node_modules/**", "dist/**"],
  },
});
