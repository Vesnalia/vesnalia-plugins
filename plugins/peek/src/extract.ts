// Tiny literal extractors used by the analyzer.
//
// Peek reads plugin sources and built bundles as text — it never imports or
// evaluates them. These helpers find a call site and pull string literals out
// of its first argument. Minified bundles keep SDK property names and inline
// string literals, so the same routines work on `app.tsx` and on `dist/app.js`.

const QUOTES = new Set(["'", '"', "`"]);

/**
 * Return the source of the balanced call arguments that start at the "(" at or
 * after `from`, without the outer parentheses. Quote- and escape-aware so a
 * paren inside a string never unbalances the scan.
 */
export function sliceCallArgs(source: string, from: number, maxLength = 6000): string | null {
  const open = source.indexOf("(", from);
  if (open === -1 || open - from > 40) return null;
  let depth = 0;
  let quote: string | null = null;
  const limit = Math.min(source.length, open + maxLength);
  for (let index = open; index < limit; index += 1) {
    const char = source[index]!;
    if (quote !== null) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (QUOTES.has(char)) {
      quote = char;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  return null;
}

/** Every index at which `marker` occurs, capped so a pathological file cannot stall. */
export function findAll(source: string, marker: string, max = 40): number[] {
  const found: number[] = [];
  let index = source.indexOf(marker);
  while (index !== -1 && found.length < max) {
    found.push(index);
    index = source.indexOf(marker, index + marker.length);
  }
  return found;
}

/**
 * First `key: "value"` string literal in `fragment`. Only accepts literals: a
 * computed value (`title: entry.displayName`) yields null rather than a guess.
 */
export function stringProp(fragment: string, key: string): string | null {
  const pattern = new RegExp(`(?:^|[\\s,{(])${key}\\s*:\\s*(["'\`])((?:\\\\.|(?!\\1).)*)\\1`);
  const match = pattern.exec(fragment);
  if (match === null) return null;
  const value = match[2]!.replace(/\\(.)/g, "$1").trim();
  return value === "" ? null : value;
}

/** True when `key: true` appears in the fragment. */
export function boolProp(fragment: string, key: string): boolean {
  return new RegExp(`(?:^|[\\s,{(])${key}\\s*:\\s*!?0?true`).test(fragment)
    || new RegExp(`(?:^|[\\s,{(])${key}\\s*:\\s*!0(?![0-9])`).test(fragment);
}

/** Every `name: "value"` inside an array of objects, e.g. a CLI's subcommands. */
export function stringPropList(fragment: string, key: string, max = 24): string[] {
  const pattern = new RegExp(`(?:^|[\\s,{(])${key}\\s*:\\s*(["'\`])((?:\\\\.|(?!\\1).)*)\\1`, "g");
  const values: string[] = [];
  let match = pattern.exec(fragment);
  while (match !== null && values.length < max) {
    const value = match[2]!.replace(/\\(.)/g, "$1").trim();
    if (value !== "") values.push(value);
    match = pattern.exec(fragment);
  }
  return values;
}

/**
 * Split an object literal's top-level `key: {...}` entries. Used for
 * `alia.settings.define({ showDone: { type: "boolean", ... } })`.
 */
export function topLevelEntries(objectSource: string, max = 32): { key: string; body: string }[] {
  const entries: { key: string; body: string }[] = [];
  const trimmed = objectSource.trim();
  const inner = trimmed.startsWith("{") ? trimmed.slice(1, -1) : trimmed;
  let index = 0;
  while (index < inner.length && entries.length < max) {
    const keyMatch = /(["'`]?)([A-Za-z_$][\w$]*)\1\s*:\s*\{/.exec(inner.slice(index));
    if (keyMatch === null) break;
    const keyStart = index + keyMatch.index;
    const braceStart = keyStart + keyMatch[0].length - 1;
    let depth = 0;
    let quote: string | null = null;
    let end = -1;
    for (let cursor = braceStart; cursor < inner.length; cursor += 1) {
      const char = inner[cursor]!;
      if (quote !== null) {
        if (char === "\\") cursor += 1;
        else if (char === quote) quote = null;
        continue;
      }
      if (QUOTES.has(char)) {
        quote = char;
        continue;
      }
      if (char === "{" || char === "[" || char === "(") depth += 1;
      else if (char === "}" || char === "]" || char === ")") {
        depth -= 1;
        if (depth === 0) {
          end = cursor;
          break;
        }
      }
    }
    if (end === -1) break;
    entries.push({ key: keyMatch[2]!, body: inner.slice(braceStart, end + 1) });
    index = end + 1;
  }
  return entries;
}

/** Relative import specifiers, so the analyzer can follow one level of splits. */
export function relativeImports(source: string, max = 12): string[] {
  const pattern = /(?:from|import)\s*\(?\s*["'`](\.\.?\/[^"'`]+)["'`]/g;
  const found = new Set<string>();
  let match = pattern.exec(source);
  while (match !== null && found.size < max) {
    found.add(match[1]!);
    match = pattern.exec(source);
  }
  return [...found];
}
