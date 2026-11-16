export interface GateRequest {
  what: string;
  where: string;
  rollback: string;
  commands: string[];
}

export interface GateEntry extends GateRequest {
  id: string;
  threadId: string;
  at: string;
  decision: "approved" | "declined" | "dismissed";
  comment: string;
}

export const MAX_ENTRIES = 300;

export function appendEntry(journal: readonly GateEntry[], entry: GateEntry): GateEntry[] {
  return [entry, ...journal].slice(0, MAX_ENTRIES);
}

export function replyToAgent(entry: GateEntry): string {
  const comment = entry.comment.trim() === "" ? "" : ` Their comment: ${entry.comment.trim()}`;
  if (entry.decision === "approved") return `Approved. Do exactly what the request described, nothing wider.${comment}`;
  if (entry.decision === "declined") return `Declined. Do not make this change or try another route to it.${comment}`;
  return "No answer yet. Do not make this change. Continue with other work and ask again when the person is back.";
}
