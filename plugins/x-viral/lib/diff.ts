// Line-level diff rendered as a unified patch for the host diff viewer.

type Op = { kind: " " | "-" | "+"; line: string };

function lcsOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: " ", line: a[i]! });
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      ops.push({ kind: "-", line: a[i]! });
      i++;
    } else {
      ops.push({ kind: "+", line: b[j]! });
      j++;
    }
  }
  while (i < n) ops.push({ kind: "-", line: a[i++]! });
  while (j < m) ops.push({ kind: "+", line: b[j++]! });
  return ops;
}

/** Unified patch (one hunk, full context) between two texts, for `experimental_Diff`. */
export function unifiedPatch(before: string, after: string, path = "post.txt"): string {
  const a = before.split("\n");
  const b = after.split("\n");
  const ops = lcsOps(a, b);
  const removed = ops.filter((o) => o.kind !== "+").length;
  const added = ops.filter((o) => o.kind !== "-").length;
  const body = ops.map((o) => `${o.kind}${o.line}`).join("\n");
  return `--- a/${path}\n+++ b/${path}\n@@ -1,${removed} +1,${added} @@\n${body}\n`;
}

export function diffStats(before: string, after: string): { added: number; removed: number } {
  const ops = lcsOps(before.split("\n"), after.split("\n"));
  return { added: ops.filter((o) => o.kind === "+").length, removed: ops.filter((o) => o.kind === "-").length };
}
