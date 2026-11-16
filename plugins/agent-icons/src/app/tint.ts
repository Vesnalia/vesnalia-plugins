import type { Tint } from "../shared/contract";

/** An unset theme keeps VesnALIA's own colour. */
export function tintColor(tint: Tint | undefined): string | undefined {
  if (!tint || (!tint.light && !tint.dark)) return undefined;
  return `light-dark(${tint.light ?? "currentColor"}, ${tint.dark ?? "currentColor"})`;
}
