// Try It: an agent hands a running build to a person and gets their verdict back.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { summarize, urlProblem, type TryItAnswer } from "./lib/url";

export interface TryItPayload {
  title: string;
  url: string;
  changed: string[];
  checks: string[];
}

// BB rejects a longer submission detail. A person may take a while with a phone,
// well past the 10-minute default.
const clip = (text: string) => (text.length <= 280 ? text : `${text.slice(0, 279)}…`);
const WAIT_MS = 24 * 60 * 60 * 1000;

const answerSchema = z.object({
  results: z.array(z.object({ check: z.string(), result: z.enum(["pass", "fail", "skip"]) })),
  note: z.string(),
});

export default async function plugin(bb: BbPluginApi) {
  bb.agents.registerTool({
    name: "try_it",
    description:
      "Ask the person to test a running build on their own device. Shows a public link, a QR code, what changed, and a checklist in place of the composer; returns their verdict per check.",
    instructions:
      "When a build is ready for the person to test, call try_it with a public URL and at most 7 concrete checks instead of writing a link and instructions in chat. Check names describe what to do and see, in the person's language.",
    presentation: { label: { pending: "Waiting for the tester", completed: "Tester answered" } },
    parameters: z.object({
      title: z.string().min(1).max(120).describe("Build name and version"),
      url: z.string().describe("Public http(s) URL; a localhost URL is refused"),
      changed: z.array(z.string().max(200)).max(10).default([]).describe("What changed, one short line each"),
      checks: z.array(z.string().min(1).max(200)).min(1).max(7).describe("What to try"),
    }),
    async execute({ title, url, changed, checks }, { threadId, signal }) {
      const problem = urlProblem(url);
      if (problem !== null) return { content: [{ type: "text", text: problem }], isError: true };
      const payload: TryItPayload = { title, url, changed, checks };
      const answer = await bb.ui.requestInput(
        {
          threadId,
          rendererId: "try-it",
          title: `Test ${title}`,
          timeoutMs: WAIT_MS,
          payload: payload as never,
          presentation: { label: { pending: `Waiting for a test of ${title}`, completed: `Tested ${title}` } },
          describeSubmission: (value) => ({
            title: `Tested ${title}`,
            detail: clip(summarize(value as unknown as TryItAnswer)),
          }),
        },
        { signal },
      );
      if (answer.outcome === "cancelled") {
        return "The tester put this off. Do not ask again until they bring it up.";
      }
      return summarize(answerSchema.parse(answer.value));
    },
  });
}
