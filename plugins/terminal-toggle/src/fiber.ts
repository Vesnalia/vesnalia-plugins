import { CompatibilityError } from "./compatibility";
/** Private React adapter. Keep all host identity inspection in this file. */
export type Fields = Record<string, unknown>;
export interface Fiber {
  return: Fiber | null;
  child: Fiber | null;
  sibling: Fiber | null;
  stateNode: unknown;
  memoizedProps: unknown;
  tag: number;
}
export function fields(value: unknown): Fields {
  return value !== null && typeof value === "object" ? (value as Fields) : {};
}
export function callable(
  value: unknown,
): value is (...args: never[]) => unknown {
  return typeof value === "function";
}

function attached(element: Element): Fiber | null {
  const key = Object.getOwnPropertyNames(element).find(
    (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactContainer$"),
  );
  return key ? (fields(element)[key] as Fiber) : null;
}
export function rootFor(element: Element): Fiber | null {
  let fiber: Fiber | null = null;
  for (
    let node: Element | null = element;
    node && !fiber;
    node = node.parentElement
  )
    fiber = attached(node);
  const visited = new Set<Fiber>();
  while (fiber?.return) {
    if (visited.has(fiber) || visited.size > 250) return null;
    visited.add(fiber);
    fiber = fiber.return;
  }
  const current = fields(fiber?.stateNode).current;
  return fiber?.tag === 3 && current ? (current as Fiber) : null;
}

/** Traverse the committed tree, never an arbitrary alternate's props. */
export function* traverse(root: Fiber): Generator<Fiber> {
  const stack = [root],
    seen = new Set<Fiber>();
  while (stack.length) {
    const node = stack.pop()!;
    if (seen.has(node) || seen.size >= 100_000)
      throw new CompatibilityError(
        "TT_REACT",
        "The React tree is invalid or exceeds the inspection limit.",
      );
    seen.add(node);
    yield node;
    if (node.sibling) stack.push(node.sibling);
    if (node.child) stack.push(node.child);
  }
  if (fields(root.stateNode).current !== root)
    throw new CompatibilityError(
      "TT_REACT",
      "The committed React tree changed during inspection.",
    );
}
export function walk(root: Fiber): Fiber[] {
  return [...traverse(root)];
}
export function ancestors(node: Fiber): Fiber[] {
  const result: Fiber[] = [];
  for (
    let next: Fiber | null = node;
    next && result.length < 250;
    next = next.return
  )
    result.push(next);
  return result;
}
export function currentNode(
  element: Element,
  tree: readonly Fiber[],
): Fiber | null {
  const matches = tree.filter((n) => n.stateNode === element);
  return matches.length === 1 ? matches[0] : null;
}
export function props(node: Fiber): Fields {
  return fields(node.memoizedProps);
}
export function paneOf(
  node: Fiber,
): { paneId: string; focused: boolean } | null {
  for (const owner of ancestors(node)) {
    const value = fields(props(owner).value);
    if (
      typeof value.paneId === "string" &&
      typeof value.isFocused === "boolean" &&
      "navigateInPane" in value
    ) {
      return { paneId: value.paneId, focused: value.isFocused };
    }
  }
  return null;
}
