import { LIMITS } from "./limits.js";

/**
 * A depth-independent view of one accessibility node. The host maps rendered
 * ids back to live browser nodes; only nodes that can be addressed carry
 * `refable: true`.
 */
export type SnapshotNode = {
  readonly id: number;
  readonly role: string;
  readonly name?: string | null;
  readonly value?: string | null;
  readonly description?: string | null;
  readonly states?: readonly string[];
  readonly refable?: boolean;
  readonly children?: readonly SnapshotNode[];
};

export type RenderedSnapshot = {
  text: string;
  refs: { ref: string; id: number }[];
  truncated: {
    text: boolean;
    nodes: boolean;
    depth: boolean;
    refs: boolean;
    droppedNodes: number;
  };
};

const NAME_MAX_CHARS = 4_000;
const VALUE_MAX_CHARS = 2_000;
const ROLE_MAX_CHARS = 120;
const TRUNCATION_PREFIX = "[snapshot truncated";

type Entry = { node: SnapshotNode; depth: number };

function clampString(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars - 1)}…`;
}

function sanitizeToken(value: string, maxChars: number): string {
  return clampString(value.replace(/[\s\u0000-\u001f]+/g, "-").replace(/[\[\]]/g, ""), maxChars);
}

function formatLine(node: SnapshotNode, depth: number, ref: string | undefined): string {
  const parts = [`${"  ".repeat(depth)}- ${sanitizeToken(node.role, ROLE_MAX_CHARS)}`];
  if (node.name !== undefined && node.name !== null && node.name !== "") {
    parts.push(` ${JSON.stringify(clampString(node.name, NAME_MAX_CHARS))}`);
  }
  if (node.value !== undefined && node.value !== null) {
    parts.push(` value=${JSON.stringify(clampString(node.value, VALUE_MAX_CHARS))}`);
  }
  if (node.description !== undefined && node.description !== null && node.description !== "") {
    parts.push(` description=${JSON.stringify(clampString(node.description, NAME_MAX_CHARS))}`);
  }
  for (const state of node.states ?? []) {
    parts.push(` [${sanitizeToken(state, ROLE_MAX_CHARS)}]`);
  }
  if (ref !== undefined) {
    parts.push(` [ref=${ref}]`);
  }
  return parts.join("");
}

/**
 * Iteratively renders a snapshot within the text/node/depth/ref budgets.
 * Traversal stops when a budget is exhausted; a line is only emitted when it
 * fits whole, and a node receives a ref only when its line was emitted.
 */
export function renderSnapshot(
  root: SnapshotNode | null, snapshotId: string,
  acquisition: Partial<RenderedSnapshot["truncated"]> = {},
): RenderedSnapshot {
  if (root === null && !acquisition.nodes && !acquisition.depth) {
    return {
      text: `${snapshotId}: no accessible content`,
      refs: [],
      truncated: { text: false, nodes: false, depth: false, refs: false, droppedNodes: 0 },
    };
  }

  const entries: { line: string; ref?: { ref: string; id: number } }[] = [];
  const refs: { ref: string; id: number }[] = [];
  let usedChars = 0;
  let visited = 0;
  let dropped = acquisition.droppedNodes ?? 0;
  let textTruncated = false;
  let nodesTruncated = acquisition.nodes ?? false;
  let depthTruncated = acquisition.depth ?? false;
  let refsTruncated = false;

  const stack: Entry[] = root ? [{ node: root, depth: 0 }] : [];
  while (stack.length > 0) {
    if (visited >= LIMITS.snapshot.nodes) {
      nodesTruncated = true;
      dropped += stack.length;
      break;
    }
    const entry = stack.pop()!;
    if (entry.depth > LIMITS.snapshot.depth) {
      depthTruncated = true;
      dropped += 1;
      continue;
    }
    visited += 1;

    let ref: string | undefined;
    if (entry.node.refable === true) {
      if (refs.length < LIMITS.snapshot.refs) {
        ref = `${snapshotId}:e${refs.length + 1}`;
      } else {
        refsTruncated = true;
      }
    }
    const line = formatLine(entry.node, entry.depth, ref);
    const newlineCost = entries.length === 0 ? 0 : 1;
    if (usedChars + newlineCost + line.length > LIMITS.snapshot.textChars) {
      textTruncated = true;
      dropped += 1 + stack.length;
      break;
    }
    const record: { line: string; ref?: { ref: string; id: number } } = { line };
    if (ref !== undefined) {
      const refEntry = { ref, id: entry.node.id };
      record.ref = refEntry;
      refs.push(refEntry);
    }
    entries.push(record);
    usedChars += newlineCost + line.length;

    const children = entry.node.children ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: children[index]!, depth: entry.depth + 1 });
    }
  }

  const truncated = textTruncated || nodesTruncated || depthTruncated || refsTruncated;
  if (truncated) {
    const reasons = [
      textTruncated ? "text limit" : null,
      nodesTruncated ? "node limit" : null,
      depthTruncated ? "depth limit" : null,
      refsTruncated ? "ref limit" : null,
    ].filter((reason): reason is string => reason !== null);
    let notice = `${TRUNCATION_PREFIX}: ${reasons.join(", ")}; ${dropped} more node(s)]`;
    while (entries.length > 0 && usedChars + 1 + notice.length > LIMITS.snapshot.textChars) {
      const removed = entries.pop()!;
      usedChars = entries.length === 0 ? 0 : usedChars - (removed.line.length + 1);
      dropped += 1;
      if (removed.ref !== undefined) refs.pop();
      notice = `${TRUNCATION_PREFIX}: ${reasons.join(", ")}; ${dropped} more node(s)]`;
    }
    return {
      text: `${entries.map((entry) => entry.line).join("\n")}\n${notice}`.trimStart(),
      refs,
      truncated: {
        text: textTruncated,
        nodes: nodesTruncated,
        depth: depthTruncated,
        refs: refsTruncated,
        droppedNodes: dropped,
      },
    };
  }

  return {
    text: entries.map((entry) => entry.line).join("\n"),
    refs,
    truncated: { text: false, nodes: false, depth: false, refs: false, droppedNodes: 0 },
  };
}
