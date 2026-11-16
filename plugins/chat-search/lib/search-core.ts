// Pure matching helpers shared by the server (message text) and the content
// script (rendered DOM text). No DOM or Node APIs here.
//
// Matching runs on RE2JS, a JavaScript port of RE2. RE2 guarantees linear
// time in the length of the input for every pattern, so a hostile query such
// as `(a+)+$` cannot pin the CPU the way a backtracking engine would. The
// price is RE2 syntax: no backreferences and no lookaround.

import { RE2JS } from "re2js";

export interface MatchRange {
  start: number;
  end: number;
}

export interface MatcherOptions {
  caseSensitive: boolean;
  regex: boolean;
}

export const MAX_QUERY_LENGTH = 500;

/**
 * Input budget per searched text. RE2 is linear, so this only bounds the
 * constant: a single message is scanned up to this many UTF-16 units.
 */
export const MAX_TEXT_LENGTH = 2_000_000;

/** A compiled query. Stateless, so one instance can scan many texts. */
export type Matcher = RE2JS;

/**
 * Compile the query, or return null when it is empty, too long, or (in regex
 * mode) not a valid RE2 pattern.
 */
export function buildMatcher(
  query: string,
  options: MatcherOptions,
): Matcher | null {
  if (query.length === 0 || query.length > MAX_QUERY_LENGTH) return null;
  const source = options.regex ? query : RE2JS.quote(query);
  const flags = options.caseSensitive ? 0 : RE2JS.CASE_INSENSITIVE;
  try {
    return RE2JS.compile(source, flags);
  } catch {
    return null;
  }
}

/**
 * Every non-empty match in `text`, in order, capped at `limit`. Offsets are
 * UTF-16 indexes into `text`, so they line up with `String#slice` and DOM
 * text node offsets.
 */
export function findMatches(
  text: string,
  matcher: Matcher,
  limit = Number.POSITIVE_INFINITY,
): MatchRange[] {
  const ranges: MatchRange[] = [];
  const input = text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) : text;
  const scan = matcher.matcher(input);
  while (ranges.length < limit && scan.find()) {
    const start = scan.start();
    const end = scan.end();
    // Zero-width matches (e.g. /a*/) are skipped; RE2JS advances on its own.
    if (end === start) continue;
    ranges.push({ start, end });
  }
  return ranges;
}

export interface Snippet {
  before: string;
  match: string;
  after: string;
}

/** A short single-line excerpt around one match. */
export function makeSnippet(
  text: string,
  range: MatchRange,
  radius = 60,
): Snippet {
  const before = text.slice(Math.max(0, range.start - radius), range.start);
  const after = text.slice(range.end, range.end + radius);
  const squash = (value: string) => value.replace(/\s+/g, " ");
  return {
    before: (range.start - radius > 0 ? "…" : "") + squash(before),
    match: squash(text.slice(range.start, range.end)),
    after: squash(after) + (range.end + radius < text.length ? "…" : ""),
  };
}
