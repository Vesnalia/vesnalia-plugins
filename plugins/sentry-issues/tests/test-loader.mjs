export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cron-parser") {
    return {
      url: "data:text/javascript,export const CronExpressionParser = { parse() {} };",
      shortCircuit: true,
    };
  }
  if (specifier.endsWith(".js")) {
    try {
      return await nextResolve(specifier.slice(0, -3) + ".ts", context, nextResolve);
    } catch {
      // Keep normal Node resolution for package and non-TypeScript imports.
    }
  }
  return nextResolve(specifier, context, nextResolve);
}
