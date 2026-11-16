// Token Guard: stops credentials on their way into a thread and reports the
// ones already in agent history. No matched value is ever logged or stored.
import { defineRpcContract, type AliaPluginApi } from "@vesnalia/plugin-sdk";
import { z } from "zod";
import { detect, rejectionMessage } from "./lib/detect.ts";
import { scanAttachments } from "./lib/attachments.ts";
import { defaultRoots, scan, type ScanReport } from "./lib/scan.ts";

const rowSchema = z.object({
  kind: z.string(),
  revokeUrl: z.string(),
  fingerprint: z.string(),
  occurrences: z.number(),
  files: z.number(),
  sources: z.array(z.string()),
  lastSeen: z.string(),
});
const reportSchema = z.object({
  finishedAt: z.string(),
  filesScanned: z.number(),
  bytesScanned: z.number(),
  unreadable: z.number(),
  rows: z.array(rowSchema),
  truncated: z.boolean(),
});
const stateSchema = z.object({
  enabled: z.boolean(),
  blocked: z.number(),
  scanning: z.boolean(),
  error: z.string().nullable(),
  report: reportSchema.nullable(),
});
export type GuardState = z.infer<typeof stateSchema>;

export const rpcContract = defineRpcContract({
  state: { input: z.null(), output: stateSchema },
  scan_start: { input: z.null(), output: stateSchema },
});

const STATE_CHANGED = "state-changed";

export default async function plugin(alia: AliaPluginApi) {
  const settings = alia.settings.define({
    enabled: {
      type: "boolean",
      label: "Block messages that contain a credential",
      default: true,
    },
  });
  const { enabled } = await settings.get();

  let scanning = false;
  let scanError: string | null = null;
  const stop = new AbortController();
  alia.onDispose(() => stop.abort());

  async function readState(): Promise<GuardState> {
    return {
      enabled,
      blocked: (await alia.storage.kv.get<number>("blocked")) ?? 0,
      scanning,
      error: scanError,
      report: (await alia.storage.kv.get<ScanReport>("report")) ?? null,
    };
  }

  async function runScan(): Promise<void> {
    if (scanning) return;
    scanning = true;
    scanError = null;
    alia.realtime.publish(STATE_CHANGED, {});
    try {
      const report = await scan(defaultRoots(alia.server.experimental_dataDir ?? null), stop.signal);
      await alia.storage.kv.set("report", report);
    } catch (cause) {
      if (!stop.signal.aborted) {
        scanError = cause instanceof Error ? cause.message : String(cause);
        alia.log.error(`scan failed: ${scanError}`);
      }
    } finally {
      scanning = false;
      if (!stop.signal.aborted) alia.realtime.publish(STATE_CHANGED, {});
    }
  }

  if (enabled) {
    alia.experimental_hooks.on("message.dispatch", async (ctx) => {
      // A retry resends what already went through; blocking it helps nobody.
      if (ctx.initiator === "system") return { action: "proceed" };
      const findings = detect(ctx.input.text);
      let attachmentFindings;
      try {
        attachmentFindings = findings.length > 0 ? [] : await scanAttachments(ctx.input.blocks, async (path) =>
          (await alia.sdk.projects.attachments.read({ projectId: ctx.project.id, path })).bytes,
        );
      } catch {
        return { action: "reject", message: /[а-яё]/i.test(ctx.input.text)
          ? "Token Guard не смог прочитать вложение. Сообщение не отправлено. Удалите вложение или повторите попытку."
          : "Token Guard could not read an attachment. The message was not sent. Remove the attachment or try again." };
      }
      if (findings.length === 0 && attachmentFindings.length === 0) return { action: "proceed" };
      const allFindings = [...findings, ...attachmentFindings];
      const blocked = ((await alia.storage.kv.get<number>("blocked")) ?? 0) + 1;
      await alia.storage.kv.set("blocked", blocked);
      alia.realtime.publish(STATE_CHANGED, {});
      alia.log.info(`blocked a message in ${ctx.thread.id}: ${allFindings.map((f) => f.kind).join(", ")}`);
      return { action: "reject", message: attachmentFindings.length > 0
        ? /[а-яё]/i.test(ctx.input.text)
          ? `Сообщение не отправлено: в текстовом вложении обнаружен ключ (${[...new Set(attachmentFindings.map((f) => f.kind))].join(", ")}). Удалите ключ из файла и прикрепите его заново. Если ключ уже использовался в чате, отзовите его.`
          : `Message not sent: a text attachment contains a credential (${[...new Set(attachmentFindings.map((f) => f.kind))].join(", ")}). Remove it from the file and attach it again. If it was sent before, revoke it.`
        : rejectionMessage(ctx.input.text, findings) };
    });
  }

  alia.rpc.register(rpcContract, {
    state: readState,
    scan_start: async () => {
      void runScan();
      return readState();
    },
  });

  alia.cli.register({
    name: "token-guard",
    summary: "Find credentials in agent history; report them without their values",
    commands: [
      { name: "scan", summary: "Scan agent history on the server machine", usage: "alia token-guard scan [--json]" },
      { name: "status", summary: "Show guard state and the last report", usage: "alia token-guard status [--json]" },
    ],
    async run(argv) {
      const json = argv.includes("--json");
      const [command] = argv.filter((arg) => arg !== "--json");
      if (command === "scan") await runScan();
      else if (command !== "status") {
        return { exitCode: command === undefined || command === "help" || command === "--help" ? 0 : 1, stdout: "Usage:\n  VesnALIA token-guard scan [--json]\n  VesnALIA token-guard status [--json]" };
      }
      const state = await readState();
      if (json) return { exitCode: 0, stdout: JSON.stringify(state) };
      const lines = [`Guard: ${state.enabled ? "on" : "off"}. Messages blocked: ${state.blocked}.`];
      if (state.error !== null) lines.push(`Last scan failed: ${state.error}`);
      if (state.report === null) lines.push("No scan yet. Run: VesnALIA token-guard scan");
      else {
        const { report } = state;
        lines.push(`${report.rows.length} credentials in ${report.filesScanned} files (${report.finishedAt}).`);
        for (const row of report.rows) {
          lines.push(`${row.kind.padEnd(28)} ${row.fingerprint}  ${String(row.occurrences).padStart(5)}x  ${row.files} files  ${row.sources.join(", ")}  ${row.lastSeen.slice(0, 10)}`);
        }
      }
      return { exitCode: 0, stdout: lines.join("\n") };
    },
  });
}
