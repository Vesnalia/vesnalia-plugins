// Secret rules shared by everything that copies, publishes or records text: one file-name rule, one set of content patterns, the
// "demonstrably synthetic" exemption and the redaction of diagnostic text. A heuristic: patterns and names, not a guarantee.
import { excludedBy } from "./ports";

/**
 * Key files by name, as `excludedBy` patterns (ports.ts): `name/` — a folder at any depth, without a slash — a file name at any depth, `*` —
 * any part of one name. The same list excludes such files from the cancel snapshot commit (`CANCEL_EXCLUDE`) and keeps them out of work
 * snapshots, staged patches, the file endpoint, the autopilot file tool and every publication to GitHub.
 */
export const SECRET_NAME_PATTERNS: readonly string[] = Object.freeze([
  ".env*", "*.env", "*.pem", "*.key", "id_rsa*", "id_dsa*", "id_ecdsa*", "id_ed25519*", "secrets/",
]);

/**
 * A key file by name: `.env`, `.env.local`, `keys.env`, `*.pem`, `*.key`, SSH private keys (`id_rsa`, `id_ed25519`, …), anything in a `secrets/`
 * folder. Such files are not copied, read for display or published (an agent has been seen keeping keys in a `keys.env` in its work folder).
 */
export function secretFileName(rel: string): boolean {
  return SECRET_NAME_PATTERNS.some((p) => excludedBy(rel, p));
}

/** Only at the start of a word: `task-`, `disk-`, `keyJson` are not keys. */
const AT_TOKEN_START = "(?<![A-Za-z0-9])";

interface Pattern {
  label: string;
  /** Global: every match of a line is looked at, a synthetic one does not hide a real one next to it. */
  re: RegExp;
  /** Not counted as a finding by `secretFindings` (it is still redacted): hashes in code are common. */
  weak?: boolean;
  /** What `redact` replaces, when it is more than the match itself (a private key: the whole block, not just its header). */
  redactRe?: RegExp;
}

/**
 * Secret indicators; the order is the order of the result. A label is returned, never the matched text. The prefixes `sk-`, `ghp_`,
 * `gh[opsu]_`, `github_pat_`, `xoxb-` are matched together with a token tail of at least 20 characters (like Bearer) and only at the start of a
 * word: a bare `sk-` occurs in «task-list» and «disk-usage». The first capture group is the variable part of the token (for the
 * "few distinct characters" test). JWT — by the base64url alphabet. Also AWS access keys and PEM private key blocks.
 */
const PATTERNS: readonly Pattern[] = [
  { label: "sk-", re: new RegExp(`${AT_TOKEN_START}sk-([A-Za-z0-9_-]{20,})`, "g") },
  { label: "ghp_", re: new RegExp(`${AT_TOKEN_START}ghp_([A-Za-z0-9_]{20,})`, "g") },
  { label: "gh_token", re: new RegExp(`${AT_TOKEN_START}gh[opsu]_([A-Za-z0-9_]{20,})`, "g") },
  { label: "github_pat", re: new RegExp(`${AT_TOKEN_START}github_pat_([A-Za-z0-9_]{20,})`, "g") },
  { label: "xoxb-", re: new RegExp(`${AT_TOKEN_START}xoxb-([A-Za-z0-9-]{20,})`, "g") },
  { label: "Bearer", re: new RegExp(`${AT_TOKEN_START}Bearer ([A-Za-z0-9._~+/=-]{20,})`, "g") },
  { label: "jwt", re: new RegExp(`${AT_TOKEN_START}(eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+)`, "g") },
  { label: "aws_key", re: new RegExp(`${AT_TOKEN_START}AKIA([0-9A-Z]{16})`, "g") },
  {
    label: "private_key",
    re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g,
    // The key is the body, not the header: up to the END line, or to the end of the text when it was cut off.
    redactRe: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----|$(?![\s\S]))/g,
  },
  // 40-character commit SHAs do not match here: it takes 64 in a row.
  { label: "hex64", re: /([0-9a-fA-F]{64})/g, weak: true },
];

/** Words that mark a value as made up on purpose (fixtures, docs). */
const SYNTHETIC_WORD = /FAKE|EXAMPLE|DUMMY|PLACEHOLDER|REDACTED|XXXX/i;

/**
 * A matched value that is demonstrably not a real secret: it says so (`FAKE`, `EXAMPLE`, `DUMMY`, `PLACEHOLDER`, `REDACTED`, `XXXX`, any case),
 * or its variable part has at most four distinct characters (`"0".repeat(40)`, `abab…`). A private key header is never synthetic by the
 * second rule: its header has no variable part worth the name.
 */
export function syntheticValue(match: string, body: string): boolean {
  return SYNTHETIC_WORD.test(match) || new Set(body).size <= 4;
}

/** The patterns are global and shared: `test` and `matchAll` would start where the previous call stopped, so every use starts from 0. */
const fromStart = (re: RegExp): RegExp => {
  re.lastIndex = 0;
  return re;
};

/** Labels of every secret indicator in the text, each once, synthetic ones and `hex64` included — the raw detector. */
export function findSecrets(text: string): string[] {
  return PATTERNS.filter((p) => text.search(p.re) >= 0).map((p) => p.label);
}

/**
 * Labels of the indicators that count as findings: a match that is demonstrably synthetic is ignored, `hex64` does not count (hashes in code
 * are common). This is the rule for publication, snapshots and staged patches. The secret itself is never returned.
 */
export function secretFindings(text: string): string[] {
  const out: string[] = [];
  for (const p of PATTERNS) {
    if (p.weak) continue;
    for (const m of text.matchAll(fromStart(p.re))) {
      if (!syntheticValue(m[0], m[1] ?? m[0])) {
        out.push(p.label);
        break;
      }
    }
  }
  return out;
}

/**
 * Diagnostic text with every match of the secret patterns (synthetic ones and hashes included) replaced by `[redacted:<label>]`. For what is
 * kept or sent on: the journal, error texts, notes, reports, task comments. Best effort — a secret no pattern knows passes through.
 */
export function redact(text: string): string;
export function redact(text: string | null): string | null;
export function redact(text: string | null): string | null {
  if (text === null) return null;
  let out = text;
  for (const p of PATTERNS) out = out.replace(fromStart(p.redactRe ?? p.re), `[redacted:${p.label}]`);
  return out;
}
