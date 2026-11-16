/**
 * VesnALIA timeline rows carry the turn id in two different shapes:
 *   - assistant rows: `<threadId>:assistant:kind:assistant|turn:<turnId>|parent:...`
 *   - turn header rows: `<threadId>:<turnId>:turn` and `<threadId>:<turnId>:turn:<n>`
 * Badge matching needs the turn id from both, or header rows stay undecorated.
 */
export interface RowTarget {
  threadId: string;
  turnId: string;
}

const INLINE_TURN = /turn:([^|:]+)/;
const HEADER_ROW = /^[^:]+:([^:]+):turn(?::\d+)?$/;

export function parseRowId(rowId: string | undefined): RowTarget | null {
  if (!rowId) return null;
  const threadId = rowId.split(":")[0];
  if (!threadId) return null;

  // Anchored first: a header row such as `thr_a:<turnId>:turn:0` also contains
  // a `turn:` substring, so the inline pattern would capture the index instead.
  const header = HEADER_ROW.exec(rowId);
  if (header) return { threadId, turnId: header[1] };

  const inline = INLINE_TURN.exec(rowId);
  if (inline) return { threadId, turnId: inline[1] };

  return null;
}
