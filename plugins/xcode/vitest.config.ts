import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * The suite is pure Node: parsers, the reconciler, and an in-memory SQLite.
 * Nothing here needs a DOM, so the default node environment is the fast and
 * honest choice — a jsdom default would only hide that the frontend is
 * currently covered by type checking rather than by tests.
 */
export default defineConfig({
  // The Simulators half's suite drives the plugin factory itself, so it needs
  // the SDK's two *value* entry points resolved to stubs: VesnALIA supplies those
  // in-process, so the npm package ships declarations with no runtime behind
  // them.
  //
  // `internal/host-policy` is the exception and is deliberately NOT stubbed —
  // it is real, executable code in the package, and `tool-registration.test.ts`
  // checks our tool registrations against that genuine host validator.
  //
  // The array form is load-bearing. Aliases match on exact-or-`/` prefix and
  // are tried in order, so the bare `@vesnalia/plugin-sdk` entry would otherwise
  // swallow every subpath and rewrite it to `<stub>.ts/<subpath>`. Most
  // specific first.
  resolve: {
    alias: [
      {
        find: "@vesnalia/plugin-sdk/internal/host-policy",
        replacement: fileURLToPath(
          new URL("./node_modules/@vesnalia/plugin-sdk/dist/internal/host-policy.js", import.meta.url),
        ),
      },
      {
        // The host-entry harness is real code, like host-policy: it applies the
        // contract schemas and JSON round-trips exactly as the daemon does.
        find: "@vesnalia/plugin-sdk/testing/host",
        replacement: fileURLToPath(
          new URL("./node_modules/@vesnalia/plugin-sdk/dist/testing/host.js", import.meta.url),
        ),
      },
      {
        find: "@vesnalia/plugin-sdk/app",
        replacement: fileURLToPath(
          new URL("./test/sim/stubs/plugin-sdk-app.ts", import.meta.url),
        ),
      },
      {
        find: "@vesnalia/plugin-sdk",
        replacement: fileURLToPath(new URL("./test/sim/stubs/plugin-sdk.ts", import.meta.url)),
      },
      { find: "@", replacement: fileURLToPath(new URL("./", import.meta.url)) },
    ],
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    environmentMatchGlobs: [["test/**/*.dom.test.tsx", "jsdom"]],
    // `abandoned.test.ts` drives a real Collector over a temp directory tree,
    // which is slower than the parser tests but still well inside this bound.
    testTimeout: 20_000,
  },
});
