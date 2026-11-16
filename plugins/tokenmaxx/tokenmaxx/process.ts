import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

// The VesnALIA server inherits a login-shell PATH in most setups, but a desktop
// launch can miss the directories bun and the provider CLIs install into, and
// `tokenmaxx doctor`/`install` shell out to codex, claude, and security.
const EXTRA_PATHS = [
  join(homedir(), ".bun", "bin"),
  join(homedir(), ".local", "bin"),
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
];

const isExecutable = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

export const searchPath = (): string => {
  const current = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const merged = [...current];
  for (const entry of EXTRA_PATHS) {
    if (!merged.includes(entry)) merged.push(entry);
  }
  return merged.join(delimiter);
};

export const resolveBinary = (configured: string): string | null => {
  const trimmed = configured.trim();
  if (trimmed.length > 0) return isExecutable(trimmed) ? trimmed : null;
  for (const directory of searchPath().split(delimiter)) {
    const candidate = join(directory, "tokenmaxx");
    if (isExecutable(candidate)) return candidate;
  }
  return null;
};

export class BinaryMissingError extends Error {
  constructor() {
    super(
      "tokenmaxx was not found on PATH. Install it with `bun add -g tokenmaxx`, or set the binary path in this plugin's settings.",
    );
    this.name = "BinaryMissingError";
  }
}

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export const runTokenmaxx = (input: {
  binary: string;
  args: string[];
  home: string;
  timeoutMs: number;
}): Promise<CommandResult> =>
  new Promise((fulfil) => {
    const home = input.home.trim();
    execFile(
      input.binary,
      input.args,
      {
        env: {
          ...process.env,
          PATH: searchPath(),
          ...(home.length > 0 ? { TOKENMAXX_HOME: home } : {}),
        },
        maxBuffer: 4 * 1024 * 1024,
        timeout: input.timeoutMs,
      },
      (error, stdout, stderr) => {
        const failure = error as (Error & { code?: number | string; killed?: boolean }) | null;
        fulfil({
          exitCode: typeof failure?.code === "number" ? failure.code : failure === null ? 0 : 1,
          stdout: stdout.toString(),
          stderr:
            failure?.killed === true
              ? `${stderr.toString()}\nCommand timed out after ${input.timeoutMs}ms.`
              : stderr.toString(),
        });
      },
    );
  });

const DOCTOR_STATUSES = new Set([
  "ok",
  "note",
  "warning",
  "missing",
  "running",
  "stopped",
  "state",
]);

export type DoctorCheck = {
  status: string;
  name: string;
  detail: string;
};

export const parseDoctor = (output: string): DoctorCheck[] =>
  output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [first = "", ...rest] = line.split(/\s+/);
      if (!DOCTOR_STATUSES.has(first)) return { status: "note", name: "", detail: line };
      const isDaemon = rest[0] === "manager" && rest[1] === "daemon";
      const nameLength = isDaemon ? 2 : 1;
      return {
        status: first,
        name: rest.slice(0, nameLength).join(" "),
        detail: rest.slice(nameLength).join(" "),
      };
    });
