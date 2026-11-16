// Recognizes VesnALIA's own error messages where VesnALIA gives no structured field.
// Each pattern quotes the message VesnALIA 0.49.0 builds (server/dist/start-server.js);
// anything else is left as VesnALIA reported it.
import type { CheckEntry } from "./report";

/**
 * VesnALIA's update check catches what a plugin's check throws and returns that
 * plugin as `unavailable`, the error's message as `detail` (`checkRows`).
 * `unavailable` also covers results VesnALIA returns on purpose (no matching tag, a
 * moved tag, a retired marketplace, a broken release), so only these count
 * as the check having errored:
 */
const CHECK_ERRORS = [
  // runInstallCommand, which runs every git and npm command of the check:
  // `${command} ${args[0]} failed (exit ${code ?? "signal"})…`, `… timed out after ${ms}ms`,
  // `… produced more than ${n} bytes of output`
  /^(?:git|npm) \S+ (?:failed \(exit [^)]*\)|timed out after \d+ms|produced more than \d+ bytes of output)/,
  // GIT_NOT_FOUND_HINT
  /^"git" was not found on PATH/,
  // getPackument: `${packageName} registry request failed: ${detail | status}`
  /^\S+ registry request failed: /,
  /^registry returned malformed metadata for /,
  // parseLsRemote
  /^(?:malformed git ls-remote output|git ls-remote returned invalid object id)/,
  // PluginInstallCancelledError
  /^install cancelled$/,
];

/** Whether VesnALIA's entry says the check itself failed, rather than that the plugin can't be checked. */
export function isCheckError(entry: CheckEntry): boolean {
  const { outcome, detail } = entry;
  return outcome === "unavailable" && detail !== undefined && CHECK_ERRORS.some((p) => p.test(detail));
}

/**
 * VesnALIA's reason for refusing to install a release for its engines, from the
 * install's error (a failed install job carries only `error: string`).
 * VesnALIA words them `requires VesnALIA plugin SDK ${range}, running SDK is ${version}`
 * (pluginSdkRangeProblem), `requires VesnALIA ${range}, running VesnALIA is ${version}`
 * (evaluateCompatibility), `requires VesnALIA ${range}, this is ${version}`
 * (checkEngineRange) and `declares invalid engines.… range …`, after
 * "install failed: " or `install refused: plugin "<id>" `.
 */
const ENGINE_REFUSAL =
  /(requires alia plugin SDK .+?, running SDK is [\w.+-]+|requires alia .+?, (?:running alia|this) is [\w.+-]+|declares invalid engines\.(?:alia|aliaPluginSdk) range .+)/;

export function engineRefusal(error: string): string | undefined {
  return ENGINE_REFUSAL.exec(error)?.[1];
}
