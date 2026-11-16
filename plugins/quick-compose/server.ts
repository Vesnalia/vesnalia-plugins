import {
  defineRpcContract,
  type AliaPluginApi,
  type NewThreadRequest,
} from "@vesnalia/plugin-sdk";
import { z } from "zod";

// The composer's NewThreadRequest, checked for its load-bearing fields and
// otherwise forwarded unchanged; `threads.spawn` validates the full shape.
const newThreadRequestShape = z.object({
  projectId: z.string().min(1),
  providerId: z.string().min(1),
  model: z.string().min(1),
  input: z.array(z.unknown()).min(1),
  environment: z.object({ type: z.string() }),
});
export const newThreadRequestSchema = z.custom<NewThreadRequest>(
  (value) => newThreadRequestShape.safeParse(value).success,
  "Expected a new thread request from the composer",
);

export const quickComposeRpcContract = defineRpcContract({
  createThread: {
    input: z.object({ request: newThreadRequestSchema }).strict(),
    output: z.object({ threadId: z.string() }).strict(),
  },
});

export default async function plugin(alia: AliaPluginApi) {
  alia.rpc.register(quickComposeRpcContract, {
    async createThread({ request }) {
      const thread = await alia.sdk.threads.spawn(request);
      return { threadId: thread.id };
    },
  });
}
