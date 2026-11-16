// alia-plugin-security-guidance — pattern-matched security warnings for code
// the agent writes.
//
// Port of the Hermes `security-guidance` plugin to VesnALIA's plugin model.
//
// VesnALIA has no `transform_tool_result` hook (the Hermes plugin's delivery
// mechanism), so this port exposes the same 25-rule pattern engine as a
// native agent tool instead:
//
//   - `security_scan` — scan content (and an optional path) for known
//     dangerous code patterns (pickle.load, yaml.load, eval(, os.system,
//     subprocess shell=True, dangerouslySetInnerHTML, verify=False, ECB,
//     XXE, GitHub Actions injection, torch.load without weights_only=True,
//     ...). Returns a warning block for every match. The agent calls this
//     on content it is about to write, reads the warnings, and either fixes
//     the code or briefly documents why the construct is safe.
//
// Same warn-by-default philosophy as the Hermes original: the scan is
// advisory, not blocking. Pattern matching has a non-trivial false-positive
// rate, so the tool returns warnings rather than refusing anything.
import { type AliaPluginApi } from "@vesnalia/plugin-sdk";
import { z } from "zod";
import { scanContent, formatWarningBlock } from "./patterns";

export default async function plugin(alia: AliaPluginApi) {
  alia.log.info("alia-plugin-security-guidance loaded");

  const settings = alia.settings.define({
    mode: {
      type: "select" as const,
      label: "Mode",
      options: ["warn", "block"],
      default: "warn",
      description:
        "warn: returns warnings for the agent to act on. block: returns a refusal message when patterns match.",
    },
  });

  let { mode } = await settings.get();

  // Re-read settings on change without a plugin reload.
  settings.onChange((next) => {
    mode = next.mode;
    alia.log.info(`[security-guidance] mode updated → ${mode}`);
  });

  alia.agents.registerTool({
    name: "security_scan",
    description:
      "Scan code content for known-dangerous security patterns (pickle.load, yaml.load, eval(, os.system, " +
      "subprocess shell=True, dangerouslySetInnerHTML, verify=False, ECB mode, GitHub Actions injection, " +
      "torch.load without weights_only=True, XXE-prone XML parsers, and more). " +
      "Call this on content you are about to write to a file. Returns a warning block for every pattern matched. " +
      "Pattern matches can be false positives — if the construct is safe in context, document why in a comment and continue; " +
      "otherwise fix the code before writing it.",
    parameters: z.object({
      content: z.string().min(1).describe("The code/content to scan."),
      path: z
        .string()
        .optional()
        .describe("Optional file path the content will be written to. Used for per-extension rule filtering."),
    }),
    async execute({ content, path }) {
      const findings = scanContent(path || "", content);
      if (findings.length === 0) {
        return "security_scan: no dangerous patterns matched. Safe to write.";
      }
      if (mode === "block") {
        return (
          "security-guidance refused this write: " +
          formatWarningBlock(findings) +
          "\n\nTo override, switch the plugin mode to 'warn' and retry."
        );
      }
      return formatWarningBlock(findings);
    },
  });

  alia.onDispose(() => {
    alia.log.info("alia-plugin-security-guidance disposed");
  });
}
