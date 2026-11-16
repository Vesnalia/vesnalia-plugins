/**
 * What server code logs through. It is VesnALIA's plugin logger (`alia.log`), passed in, so a failure reaches
 * `alia plugin logs firstmate-crew` — `console` output does not — and a test can read what was logged.
 */
import type { PluginLogger } from "@vesnalia/plugin-sdk";

export type Log = Pick<PluginLogger, "info" | "warn" | "error">;

/** An error as one line of a log message. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
