import { z } from "zod";

/** Input of an RPC method with no fields. The VesnALIA CLI sends null when the caller gives no input. */
export const noInput = z.object({}).strict().nullish();
