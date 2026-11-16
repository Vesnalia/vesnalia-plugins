export interface ReaderMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

export interface RowLike {
  id: string;
  kind?: unknown;
  role?: unknown;
  initiator?: unknown;
  text?: unknown;
  status?: unknown;
  sourceSeqStart?: unknown;
  createdAt?: unknown;
  children?: unknown;
}

function isRow(value: unknown): value is RowLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

function sortKey(row: RowLike): [number, number] {
  const seq = typeof row.sourceSeqStart === "number" ? row.sourceSeqStart : 0;
  const created = typeof row.createdAt === "number" ? row.createdAt : 0;
  return [seq, created];
}

/** Upsert timeline rows by id and return them in conversation order. */
export function mergeRows(
  known: ReadonlyMap<string, RowLike>,
  incoming: readonly unknown[],
): Map<string, RowLike> {
  const next = new Map(known);
  for (const row of incoming) if (isRow(row)) next.set(row.id, row);
  return new Map(
    [...next.entries()].sort(([, a], [, b]) => {
      const [seqA, createdA] = sortKey(a);
      const [seqB, createdB] = sortKey(b);
      return seqA - seqB || createdA - createdB;
    }),
  );
}

/**
 * Keep only the words people exchanged: the user's own prompts and the
 * assistant's prose, including progress notes inside a turn. Tool calls,
 * file edits, system notices, and messages from other agents are dropped.
 */
export function readerMessages(rows: Iterable<unknown>): ReaderMessage[] {
  const messages: ReaderMessage[] = [];
  const visit = (row: unknown) => {
    if (!isRow(row)) return;
    if (row.kind === "turn") {
      if (Array.isArray(row.children)) row.children.forEach(visit);
      return;
    }
    if (row.kind !== "conversation") return;
    if (typeof row.text !== "string" || !row.text.trim()) return;
    if (row.role === "assistant") {
      messages.push({ id: row.id, role: "assistant", text: row.text });
    } else if (row.role === "user" && row.initiator === "user") {
      messages.push({ id: row.id, role: "user", text: row.text });
    }
  };
  for (const row of rows) visit(row);
  return messages;
}
