import { z } from "zod";

export const taskTypeSchema = z.enum(["coding", "reasoning", "security", "general"]);
export type TaskType = z.infer<typeof taskTypeSchema>;
