// The one place this plugin spawns a process.
//
// Automations belong to VesnALIA's own automations plugin, and the SDK exposes no API
// for them, so the `VesnALIA` CLI is the interface: `project list --json`,
// `automation list --project <id> --json`, `automation run <id> --project
// <id>`. Argument arrays only; no shell string is ever constructed.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface AliaRunner {
  run(args: string[]): Promise<string>;
}

/** `VesnALIA` could not be found or could not answer. */
export class AliaUnavailableError extends Error {
  constructor(
    message: string,
    /** What the CLI actually said, for a log that has to explain an empty palette. */
    readonly detail: string,
  ) {
    super(message);
    this.name = "AliaUnavailableError";
  }
}

/**
 * Where `VesnALIA` lives, most specific first.
 *
 * `ALIA_CLI` is what VesnALIA itself sets for anything it runs, so it is the right
 * answer whenever it is present. The server's PATH is not a login shell's, so
 * the install locations are a real fallback rather than a nicety.
 */
export const ALIA_PATH_CANDIDATES = [
  "/opt/homebrew/bin/alia",
  "/usr/local/bin/alia",
  "/usr/bin/alia",
] as const;

export function resolveAliaPath(options: {
  /** The plugin's `aliaPath` setting, when set. */
  configured?: string | undefined;
  /** `process.env.ALIA_CLI`, when VesnALIA injected it. */
  envPath?: string | undefined;
  /** Existence test for the fallback candidates. */
  exists: (path: string) => boolean;
}): string {
  const configured = options.configured?.trim();
  if (configured !== undefined && configured.length > 0) return configured;

  const envPath = options.envPath?.trim();
  if (envPath !== undefined && envPath.length > 0) return envPath;

  const candidate = ALIA_PATH_CANDIDATES.find((path) => options.exists(path));
  // Bare `VesnALIA` when nothing else matched: it works whenever the server's PATH
  // happens to carry it, and the error names the setting when it does not.
  return candidate ?? "alia";
}

/** stderr is where the CLI explains itself; the message is mostly the argv. */
function stderrOf(error: unknown): string {
  const stderr = (error as { stderr?: unknown })?.stderr;
  return typeof stderr === "string" ? stderr : "";
}

export function createAliaRunner(aliaPath: string): AliaRunner {
  return {
    async run(args: string[]) {
      try {
        const { stdout } = await execFileAsync(aliaPath, args, {
          maxBuffer: 8 * 1024 * 1024,
          // An automation run returns as soon as the run is queued, so this
          // bounds a hung CLI rather than the automation's own work.
          timeout: 30_000,
        });
        return stdout;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/ENOENT/.test(message)) {
          throw new AliaUnavailableError(
            `\`${aliaPath}\` was not found. Set this plugin's "aliaPath" setting to the absolute path of the VesnALIA CLI.`,
            message,
          );
        }
        const detail = stderrOf(error).trim();
        throw new AliaUnavailableError(
          detail.length > 0 ? detail : message,
          detail.length > 0 ? detail : message,
        );
      }
    },
  };
}
