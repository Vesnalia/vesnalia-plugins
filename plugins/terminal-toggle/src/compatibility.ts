/** Stable, content-free diagnostics for private host-contract failures. */
export class CompatibilityError extends Error {
  constructor(
    readonly code: string,
    detail: string,
  ) {
    super(
      `Terminal Toggle [${code}]: ${detail} bb's internal interfaces may have changed. Update Terminal Toggle; if the problem persists, report this code and your bb version.`,
    );
    this.name = "CompatibilityError";
  }
}

export class OperationError extends Error {}

export function compatibilityReport(show: (message: string) => void) {
  const reported = new Set<string>();
  return (cause: unknown, force = false): void => {
    const message =
      cause instanceof CompatibilityError || cause instanceof OperationError
        ? cause.message
        : "Terminal Toggle [TT_OPERATION]: bb could not complete the terminal operation. The plugin has stopped this attempt. Try again; if it persists, report this code and your bb version.";
    if (!force && reported.has(message)) return;
    reported.add(message);
    show(message);
  };
}

export function actionResult(value: unknown, code: string): boolean {
  if (typeof value !== "boolean")
    throw new CompatibilityError(
      code,
      "bb returned an unrecognized action result. Further actions were stopped.",
    );
  return value;
}
