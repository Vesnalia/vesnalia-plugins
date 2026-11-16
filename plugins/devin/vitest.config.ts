import { defineConfig } from "vitest/config";

export default defineConfig({
  ssr: {
    noExternal: ["@vesnalia/plugin-sdk"],
  },
});
