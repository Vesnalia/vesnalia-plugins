import type { AliaPluginApi, PluginAgentToolResult } from "@vesnalia/plugin-sdk";
import type { z } from "zod";
import {
  BrowserToolError,
  browserClickInputSchema,
  browserCloseInputSchema,
  browserConsoleInputSchema,
  browserEvaluateInputSchema,
  browserNavigateInputSchema,
  browserOpenInputSchema,
  browserPressInputSchema,
  browserScreenshotInputSchema,
  browserSnapshotInputSchema,
  browserTypeInputSchema,
  toErrorEnvelope,
  interpretActionResult,
  type ActionWithSnapshot,
  type BrowserClickInput,
  type BrowserCloseInput,
  type BrowserConsoleInput,
  type BrowserEvaluateInput,
  type BrowserNavigateInput,
  type BrowserOpenInput,
  type BrowserPressInput,
  type BrowserScreenshotInput,
  type BrowserSnapshotInput,
  type BrowserTypeInput,
  type SnapshotPayload,
} from "./contracts.js";
import { LIMITS } from "./limits.js";
import type { SessionManager } from "./sessions.js";

type ToolRunContext = {
  threadId: string;
  signal: AbortSignal;
};

type ToolConfig<TInput> = {
  name: string;
  description: string;
  instructions?: string;
  parameters: z.ZodType<TInput>;
  pending: string;
  completed: string;
  run: (input: TInput, context: ToolRunContext) => Promise<PluginAgentToolResult>;
};

function text(content: string): PluginAgentToolResult {
  return { content: [{ type: "text", text: content }] };
}

function failure(error: unknown): PluginAgentToolResult {
  const envelope = toErrorEnvelope(error);
  return { content: [{ type: "text", text: `${envelope.code}: ${envelope.message}` }], isError: true };
}

function snapshotText(snapshot: SnapshotPayload): string {
  const heading = `Page: ${snapshot.title || "(untitled)"} — ${snapshot.url}`;
  return `${heading}\n${snapshot.text}`;
}

function actionResult(result: ActionWithSnapshot): PluginAgentToolResult {
  return { content: [{ type: "text", text: actionText(result) }], isError: interpretActionResult(result).failed };
}

function actionText(result: ActionWithSnapshot): string {
  if (!result.action.ok) {
    const head = `Action failed: ${result.action.error.code}: ${result.action.error.message}`;
    return result.snapshot ? `${head}\n${snapshotText(result.snapshot)}` : head;
  }
  if (result.snapshot) return `Action succeeded.\n${snapshotText(result.snapshot)}`;
  const detail = result.snapshotError
    ? `${result.snapshotError.code}: ${result.snapshotError.message}`
    : "unknown error";
  return `Action succeeded, but the follow-up snapshot failed (${detail}). Take a fresh snapshot before the next action.`;
}

function register<TInput>(alia: AliaPluginApi, config: ToolConfig<TInput>): string {
  alia.agents.registerTool({
    name: config.name,
    description: config.description,
    instructions: config.instructions,
    parameters: config.parameters,
    presentation: {
      label: { pending: config.pending, completed: config.completed },
    },
    async execute(input, context) {
      try {
        return await config.run(input, { threadId: context.threadId, signal: context.signal });
      } catch (error) {
        return failure(error);
      }
    },
  });
  return config.name;
}

export type BrowserToolsRegistration = {
  names: string[];
  selection: (context: {
    origin: { kind: "fork" | null; pluginId: string | null };
  }) => string[];
};

/**
 * Registers the ten native tools from the shared contract schemas. Inputs,
 * bounds, and error codes have one owner (`contracts.ts`); this module only
 * parses, presents, and delegates to the session manager.
 */
export function registerBrowserTools(
  alia: AliaPluginApi,
  manager: SessionManager,
): BrowserToolsRegistration {
  const settings = alia.settings.define({
    enableEvaluate: {
      type: "boolean",
      label: "Enable trusted browser_evaluate",
      description:
        "Allows the browser_evaluate tool to run arbitrary JavaScript in the automation tab. Not read-only.",
      default: false,
    },
  });

  let evaluateEnabled = false;
  const settingsReady = settings.get().then((values) => {
    evaluateEnabled = values.enableEvaluate;
  });
  settings.onChange((next) => {
    evaluateEnabled = next.enableEvaluate;
  });
  void settingsReady;

  const names: string[] = [];

  names.push(
    register<BrowserOpenInput>(alia, {
      name: "browser_open",
      instructions:
        "You can control a real browser with the native browser_* tools. Use them when the task calls for testing a local web app, reproducing UI bugs, verifying interactions, inspecting a website, or checking screenshots and browser diagnostics. Read the browser-tools skill before your first browser action, then start with browser_open and use the returned snapshot refs. No separate browser automation setup is needed. Capability is not authorization: follow the user's scope and repository rules, obtain required approval for consequential actions or personal-tab access, and let the user enter credentials manually.",
      description:
        "Open a browser session on a VesnALIA desktop automation tab and return the session id plus an initial accessibility snapshot. An existing tabId can be handed off (allowPersonal only with explicit user authorization); browser_open cannot combine tabId and url.",
      parameters: browserOpenInputSchema,
      pending: "Opening browser session",
      completed: "Opened browser session",
      async run(input, context) {
        const { session, snapshot } = await manager.open(input, context.threadId, context.signal);
        const mode = session.borrowed ? "handed-off tab" : "plugin-created automation tab";
        return text(
          `Session ${session.sessionId} ready on ${mode} ${session.tabId}; control expires ${new Date(
            session.expiresAt,
          ).toISOString()}.\n${snapshotText(snapshot)}`,
        );
      },
    }),
  );

  names.push(
    register<BrowserNavigateInput>(alia, {
      name: "browser_navigate",
      description:
        "Navigate the session's tab to an http(s) URL or about:blank and return a fresh snapshot. Waits for DOMContentLoaded only, which does not prove the application finished loading.",
      parameters: browserNavigateInputSchema,
      pending: "Navigating",
      completed: "Navigated",
      async run(input, context) {
        return actionResult(await manager.navigate(input, context.threadId, context.signal));
      },
    }),
  );

  names.push(
    register<BrowserSnapshotInput>(alia, {
      name: "browser_snapshot",
      description:
        "Take a fresh accessibility snapshot of the current page. Refs are versioned to this snapshot; any earlier ref becomes invalid.",
      parameters: browserSnapshotInputSchema,
      pending: "Inspecting page",
      completed: "Inspected page",
      async run(input, context) {
        return text(snapshotText(await manager.snapshot(input, context.threadId, context.signal)));
      },
    }),
  );

  names.push(
    register<BrowserClickInput>(alia, {
      name: "browser_click",
      description:
        "Click the element for a ref from the current snapshot. One attempt only; returns the outcome and a single post-action snapshot. Never retried automatically.",
      parameters: browserClickInputSchema,
      pending: "Clicking element",
      completed: "Clicked element",
      async run(input, context) {
        return actionResult(await manager.click(input, context.threadId, context.signal));
      },
    }),
  );

  names.push(
    register<BrowserTypeInput>(alia, {
      name: "browser_type",
      description:
        "Replace or append text in the element for a ref. Does not submit the form; use browser_press for Enter. Never type credentials or secrets.",
      parameters: browserTypeInputSchema,
      pending: "Typing text",
      completed: "Typed text",
      async run(input, context) {
        return actionResult(await manager.type(input, context.threadId, context.signal));
      },
    }),
  );

  names.push(
    register<BrowserPressInput>(alia, {
      name: "browser_press",
      description:
        "Press a supported key or modifier combination, such as Enter, Tab, or Control+Enter.",
      parameters: browserPressInputSchema,
      pending: "Pressing key",
      completed: "Pressed key",
      async run(input, context) {
        return actionResult(await manager.press(input, context.threadId, context.signal));
      },
    }),
  );

  names.push(
    register<BrowserScreenshotInput>(alia, {
      name: "browser_screenshot",
      description:
        "Capture a bounded JPEG of the viewport (or the full page) and return it as an image with its true pixel dimensions.",
      parameters: browserScreenshotInputSchema,
      pending: "Capturing screenshot",
      completed: "Captured screenshot",
      async run(input, context) {
        const shot = await manager.screenshot(input, context.threadId, context.signal);
        const details = `${input.fullPage ? "Full page" : "Viewport"} screenshot, ${
          shot.width
        }×${shot.height}px, ${Math.round(shot.bytes / 1024)} KiB${
          shot.reduced ? ", resolution reduced to stay within the size budget" : ""
        }.`;
        return {
          content: [
            { type: "text", text: details },
            { type: "image", data: shot.data, mimeType: shot.mimeType },
          ],
        };
      },
    }),
  );

  names.push(
    register<BrowserEvaluateInput>(alia, {
      name: "browser_evaluate",
      description:
        "Run trusted JavaScript in the page and return a bounded JSON value. Disabled unless the plugin setting enables it. Not read-only and not a sandbox; never use it to bypass approvals or manufacture application state.",
      parameters: browserEvaluateInputSchema,
      pending: "Evaluating page script",
      completed: "Evaluated page script",
      async run(input, context) {
        const current = await settings.get();
        if (!current.enableEvaluate) {
          throw new BrowserToolError(
            "EVALUATE_DISABLED",
            "browser_evaluate is disabled; enable it in the Browser Tools plugin settings if trusted JavaScript is required",
          );
        }
        const result = await manager.evaluate(input, context.threadId, context.signal);
        const json = JSON.stringify(result.value) ?? "null";
        return text(`Evaluation result:\n${json}${result.notice ? `\n[${result.notice}]` : ""}`);
      },
    }),
  );

  names.push(
    register<BrowserConsoleInput>(alia, {
      name: "browser_console",
      description:
        "Read bounded console, page-error, and HTTP/transport diagnostics since a cursor. Reading does not drain the buffer.",
      parameters: browserConsoleInputSchema,
      pending: "Reading browser diagnostics",
      completed: "Read browser diagnostics",
      async run(input, context) {
        const payload = await manager.console(input, context.threadId, context.signal);
        if (payload.entries.length === 0) {
          return text(`No new diagnostics. Next cursor: ${payload.nextCursor}.`);
        }
        const lines = payload.entries.map((entry) => {
          const level = entry.level === null ? entry.kind : `${entry.kind}/${entry.level}`;
          return `#${entry.seq} [${level}] ${entry.text}${entry.url ? ` — ${entry.url}` : ""}`;
        });
        const dropped =
          payload.dropped > 0
            ? `\n(${payload.dropped} earlier entries were dropped from the bounded buffer)`
            : "";
        return text(`Diagnostics:\n${lines.join("\n")}\nNext cursor: ${payload.nextCursor}.${dropped}`);
      },
    }),
  );

  names.push(
    register<BrowserCloseInput>(alia, {
      name: "browser_close",
      description:
        "Close the browser session and release control. The tab and its login are retained unless closeTab is explicitly true for a plugin-created tab; borrowed or personal tabs are never closed.",
      parameters: browserCloseInputSchema,
      pending: "Closing browser session",
      completed: "Closed browser session",
      async run(input, context) {
        const result = await manager.close(input, context.threadId, context.signal);
        return text(
          result.tabClosed
            ? "Session closed and the plugin-created automation tab was closed."
            : "Session closed; the automation tab and its login were retained.",
        );
      },
    }),
  );

  const selection = (context: {
    origin: { kind: "fork" | null; pluginId: string | null };
  }): string[] => {
    const sideChat = context.origin.kind === "fork" && context.origin.pluginId === "side-chat";
    if (sideChat) return [];
    return evaluateEnabled ? [...names] : names.filter((name) => name !== "browser_evaluate");
  };

  alia.agents.configure((context) => ({
    tools: selection(context),
    skills: selection(context).length > 0 ? ["browser-tools"] : [],
  }));

  return { names, selection };
}
