// Change Gate: a one-click decision before an agent touches production, kept in a journal.
import { randomUUID } from "node:crypto";
import { defineRpcContract, type AliaPluginApi } from "@vesnalia/plugin-sdk";
import { z } from "zod";
import { appendEntry, replyToAgent, type GateEntry, type GateRequest } from "./lib/journal";

const entrySchema = z.object({
  id: z.string(),
  threadId: z.string(),
  at: z.string(),
  decision: z.enum(["approved", "declined", "dismissed"]),
  comment: z.string(),
  what: z.string(),
  where: z.string(),
  rollback: z.string(),
  commands: z.array(z.string()),
});

export const rpcContract = defineRpcContract({
  journal: { input: z.null(), output: z.object({ entries: z.array(entrySchema) }) },
});

// VesnALIA rejects a longer submission detail. Approvals often wait for someone to come
// back, well past the 10-minute default.
const clip = (text: string) => (text.length <= 280 ? text : `${text.slice(0, 279)}…`);
const WAIT_MS = 24 * 60 * 60 * 1000;

const answerSchema = z.object({ approved: z.boolean(), comment: z.string() });

export default async function plugin(alia: AliaPluginApi) {
  const readJournal = async () => (await alia.storage.kv.get<GateEntry[]>("journal")) ?? [];

  alia.agents.registerTool({
    name: "change_gate",
    description:
      "Ask the person to approve a change to production or shared data before making it: a migration, a deploy, a server config change, a data deletion. Waits for their answer and records it.",
    instructions:
      "Before changing production or shared data, call change_gate and wait for its answer. Describe the change plainly, without jargon. Make only the approved change. An approval covers that one request.",
    presentation: { label: { pending: "Waiting for approval", completed: "Approval answered" } },
    parameters: z.object({
      what: z.string().min(1).max(500).describe("What changes, in plain words"),
      where: z.string().min(1).max(200).describe("The system or environment affected"),
      rollback: z.string().min(1).max(500).describe("How to undo it, or that it cannot be undone"),
      commands: z.array(z.string().max(500)).max(10).default([]).describe("Exact commands, without any credential"),
    }),
    async execute(input, { threadId, signal }) {
      const request: GateRequest = input;
      const answer = await alia.ui.requestInput(
        {
          threadId,
          rendererId: "change-gate",
          title: "Approve a change",
          timeoutMs: WAIT_MS,
          payload: request as never,
          presentation: { label: { pending: "Waiting for approval", completed: "Change answered" } },
          describeSubmission: (value) => ({
            title: (value as { approved?: boolean }).approved ? "Change approved" : "Change declined",
            detail: clip(`${request.what}\n\n**Where:** ${request.where}`),
          }),
        },
        { signal },
      );
      const parsed = answer.outcome === "submitted" ? answerSchema.parse(answer.value) : null;
      const entry: GateEntry = {
        ...request,
        id: randomUUID().slice(0, 8),
        threadId,
        at: new Date().toISOString(),
        decision: parsed === null ? "dismissed" : parsed.approved ? "approved" : "declined",
        comment: parsed?.comment ?? "",
      };
      await alia.storage.kv.set("journal", appendEntry(await readJournal(), entry));
      alia.realtime.publish("journal-changed", {});
      return replyToAgent(entry);
    },
  });

  alia.rpc.register(rpcContract, { journal: async () => ({ entries: await readJournal() }) });

  alia.cli.register({
    name: "change-gate",
    summary: "Read the journal of approved and declined changes",
    commands: [{ name: "log", summary: "Show the journal", usage: "alia change-gate log [--json]" }],
    async run(argv) {
      const entries = await readJournal();
      if (argv.includes("--json")) return { exitCode: 0, stdout: JSON.stringify(entries) };
      if (entries.length === 0) return { exitCode: 0, stdout: "No decisions yet." };
      return { exitCode: 0, stdout: entries.map((e) => `${e.at.slice(0, 16)}  ${e.decision.padEnd(9)}  ${e.where}: ${e.what}`).join("\n") };
    },
  });
}
