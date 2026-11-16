// The publication gate: the one way content leaves for GitHub. Every content-bearing push — main on the first push, every work branch commit,
// main after «Accept» or «Adopt as rolled out» — goes through `publish`: the destination is checked first (a GitHub repository, private or
// internal, owned by the configured owner), then exactly the commits the destination does not have yet are scanned (file names and every added
// line, merges against each parent, commit messages), and only a clean result pushes exactly that commit. A finding, an incomplete scan or a
// destination that does not pass refuses the push; nothing overrides it. The port's `push` accepts only a clearance issued here, for the same
// folder and commit, once. The scan reads the stored objects and their real parents (no replacement objects, no grafts — the graph a push
// sends) and refuses a shallow working copy. `scanPublication` is the same check without a clearance: the verdict the gates ask for.
import type { Ports } from "./ports";
import { secretFileName, secretFindings } from "./secrets";

/** Who may receive the code: the `githubOwner` setting; `allowPublic` — the `allowPublicRepos` setting (public or foreign-owner repositories). */
export interface PublishPolicy {
  owner: string;
  allowPublic: boolean;
}

/** A checked destination: the only push URL of `origin` and the repository as GitHub names it (`owner/name`). */
export interface Destination {
  url: string;
  repo: string;
}

/** Permission to push exactly `sha` from `dir` to `url`: issued only by `publicationGate`, consumed by the port's `push`. */
export interface Clearance {
  readonly dir: string;
  readonly sha: string;
  readonly url: string;
  readonly repo: string;
}

/** Why nothing was pushed. `destination` — the repository did not pass; `secrets` — something like a key; `scan` — the scan did not complete. */
export interface Refusal {
  ok: false;
  kind: "destination" | "secrets" | "scan";
  reason: string;
  /** «path: label» — the values themselves are never returned. */
  findings: string[];
}
export type GateResult = { ok: true; clearance: Clearance; commits: number } | Refusal;
/** The check without a push: clean for `dest`, or why not. */
export type ScanResult = { ok: true; dest: Destination; commits: number } | Refusal;
export type PublishResult = { ok: true; repo: string; commits: number } | Refusal;

/** At most this much `git log -p` output is scanned; more — the scan counts as incomplete and nothing is pushed. */
export const MAX_SCAN_BYTES = 64 * 1024 * 1024;
/** At most this many new commits in one publication. */
export const MAX_SCAN_COMMITS = 50_000;
/** `git log` header of every commit (and of every parent's diff of a merge): a NUL, the sha, the raw message, a NUL and `end`. */
export const LOG_FORMAT = "%x00commit %H%n%B%x00end";

const ISSUED = new WeakSet<Clearance>();

/**
 * For the port's `push`: the clearance was issued by the gate for this folder and has not been used yet. It is used up by this call: a retry
 * goes through the gate again (the destination may have changed in between).
 */
export function takeClearance(c: Clearance, dir: string): boolean {
  if (!ISSUED.has(c) || c.dir !== dir) return false;
  ISSUED.delete(c);
  return true;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const refuse = (kind: Refusal["kind"], reason: string, findings: string[] = []): Refusal => ({ ok: false, kind, reason, findings });

/** A GitHub owner: letters, digits and single hyphens inside. A repository name: letters, digits, `.`, `_`, `-`, but not `.` or `..`. */
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const NAME = /^(?!\.{1,2}$)[A-Za-z0-9._-]+$/;

/**
 * `owner/name` of a GitHub repository URL — `https://github.com/o/r(.git)`, `git@github.com:o/r(.git)`, `ssh://git@github.com/o/r(.git)`;
 * anything else (another host, credentials or a port in the URL, extra path segments) — null.
 */
export function githubRepo(url: string): { owner: string; name: string } | null {
  const m = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.trim());
  if (!m || !OWNER.test(m[1]!) || !NAME.test(m[2]!)) return null;
  return { owner: m[1]!, name: m[2]! };
}

/** A PR address of exactly this repository: `https://github.com/<owner>/<name>/pull/<n>`; anything else is not shown or stored. */
export function prUrlOf(url: string, repo: string): string | null {
  const m = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/([1-9][0-9]*)$/.exec(url.trim());
  return m && m[1]!.toLowerCase() === repo.toLowerCase() && githubRepo(`https://github.com/${m[1]}`) ? `https://github.com/${m[1]}/pull/${m[2]}` : null;
}

/** For display: a stored PR address is shown only if it still has exactly the PR shape of a valid GitHub repository. */
export function shownPrUrl(url: string | null): string | null {
  const m = url ? /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/[1-9][0-9]*$/.exec(url) : null;
  return m ? prUrlOf(url!, m[1]!) : null;
}

/**
 * The destination before a push: `origin` has exactly one push URL (insteadOf rules applied), it is a GitHub repository, GitHub knows it,
 * it is private or internal and belongs to the configured owner. A public or foreign repository passes only with `allowPublic`. The
 * repository's visibility is never changed. A failed request (network, sign-in) throws: that is not a refusal, the next pass retries.
 */
export async function checkDestination(github: Ports["github"], dir: string, policy: PublishPolicy): Promise<{ ok: true; dest: Destination } | Refusal> {
  if (!policy.owner) return refuse("destination", "GitHub is off: no repository owner in the settings");
  const urls = await github.pushUrls(dir);
  if (urls.length === 0) return refuse("destination", "the working copy has no origin to push to");
  if (urls.length > 1) return refuse("destination", `origin has ${urls.length} push URLs — the Workshop pushes only to exactly one checked repository`);
  const url = urls[0]!;
  const parsed = githubRepo(url);
  if (!parsed) return refuse("destination", `origin's push URL is not a GitHub repository the Workshop can check: ${url}`);
  const info = await github.repoInfo(parsed.owner, parsed.name);
  if (!info) return refuse("destination", `GitHub does not show the repository ${parsed.owner}/${parsed.name} (missing, or no access)`);
  const visibility = info.visibility.toUpperCase();
  if (!policy.allowPublic && visibility !== "PRIVATE" && visibility !== "INTERNAL")
    return refuse("destination", `${info.nameWithOwner} is ${visibility.toLowerCase()} — the Workshop publishes only to private repositories (setting «Allow public repositories»)`);
  if (!policy.allowPublic && info.owner.toLowerCase() !== policy.owner.toLowerCase())
    return refuse("destination", `${info.nameWithOwner} belongs to ${info.owner}, not to ${policy.owner} — not published (setting «Allow public repositories»)`);
  return { ok: true, dest: { url, repo: info.nameWithOwner } };
}

/** A malformed `git log` stream: the scan cannot vouch for what it did not understand. */
export class ScanError extends Error {
  override name = "ScanError";
}

/**
 * Reads `git log -p` of the outgoing commits (`LOG_FORMAT`, `--no-renames`, `-a`, merges against each parent) line by line and collects
 * findings: every added line and every commit message line goes through `secretFindings`. Hunks are followed by their line counts, so a
 * content line can never be mistaken for a header. Anything it does not expect — a binary patch, a combined diff, a stray line, a cut-off
 * stream — throws `ScanError`.
 */
export class LogScan {
  readonly findings = new Set<string>();
  /** Commits whose header was seen. */
  readonly commits = new Set<string>();
  private state: "start" | "message" | "between" | "header" | "hunk" = "start";
  private sha = "";
  private file = "?";
  private oldLeft = 0;
  private newLeft = 0;

  private scan(text: string, where: string): void {
    for (const label of secretFindings(text)) this.findings.add(`${where}: ${label}`);
  }
  /** The line itself is not quoted: it may be file content. */
  private fail(why: string, line: string): never {
    throw new ScanError(`unexpected git log output (${why}, a line of ${line.length} characters in commit ${this.sha.slice(0, 7) || "?"})`);
  }
  private commit(line: string): void {
    const m = /^\0commit (\S+)$/.exec(line);
    if (!m) this.fail("commit header", line);
    this.sha = m[1]!;
    this.commits.add(this.sha);
    this.file = "?";
    this.state = "message";
  }
  /** A file's diff header: the path is only a label for findings (names are checked separately, NUL-delimited). */
  private header(line: string): void {
    const b = line.lastIndexOf(" b/");
    this.file = b >= 0 ? line.slice(b + 3) : "?";
    this.state = "header";
  }
  private hunk(line: string): void {
    const m = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
    if (!m) this.fail("hunk header", line);
    this.oldLeft = m[1] === undefined ? 1 : Number(m[1]);
    this.newLeft = m[2] === undefined ? 1 : Number(m[2]);
    this.state = "hunk";
  }

  line(line: string): void {
    switch (this.state) {
      case "start":
        if (line === "") return;
        return this.commit(line);
      case "message": {
        const nul = line.indexOf("\0");
        this.scan(nul < 0 ? line : line.slice(0, nul), `commit ${this.sha.slice(0, 7)} message`);
        if (nul < 0) return;
        if (line.slice(nul) !== "\0end") this.fail("message end", line);
        this.state = "between";
        return;
      }
      case "between":
        if (line === "") return;
        if (line.startsWith("\0commit ")) return this.commit(line);
        if (line.startsWith("diff --git ")) return this.header(line);
        return this.fail("between commits", line);
      case "header":
        if (line.startsWith("\0commit ")) return this.commit(line);
        if (line.startsWith("diff --git ")) return this.header(line);
        if (line.startsWith("@@ ")) return this.hunk(line);
        if (line.startsWith("+++ ")) {
          const p = line.slice(4);
          if (p !== "/dev/null") this.file = p.startsWith("b/") ? p.slice(2) : p;
          return;
        }
        if (/^(--- |index |old mode |new mode |deleted file mode |new file mode |similarity index |dissimilarity index |rename from |rename to |copy from |copy to )/.test(line)) return;
        // `-a` shows every file as text: a binary patch or «Binary files … differ» means content was not shown.
        return this.fail("file header", line);
      case "hunk":
        if (this.oldLeft === 0 && this.newLeft === 0) {
          if (line.startsWith("\\")) return;
          if (line.startsWith("@@ ")) return this.hunk(line);
          if (line.startsWith("diff --git ")) return this.header(line);
          if (line.startsWith("\0commit ")) return this.commit(line);
          return this.fail("after a hunk", line);
        }
        if (line.startsWith("\\")) return;
        if (line.startsWith("+")) {
          this.newLeft--;
          this.scan(line.slice(1), this.file);
        } else if (line.startsWith("-")) this.oldLeft--;
        // `diff.suppressBlankEmpty` prints an empty context line as an empty line.
        else if (line.startsWith(" ") || line === "") {
          this.oldLeft--;
          this.newLeft--;
        } else return this.fail("hunk line", line);
        if (this.oldLeft < 0 || this.newLeft < 0) this.fail("hunk longer than its header", line);
        return;
    }
  }

  /** The stream ended: not in the middle of a message or a hunk. */
  end(): void {
    if (this.state === "message") this.fail("cut off in a commit message", "");
    if (this.state === "hunk" && (this.oldLeft > 0 || this.newLeft > 0)) this.fail("cut off in a hunk", "");
  }
}

/**
 * The check itself: the destination (`checkDestination`), the destination's exact commits (`ls-remote` of the checked URL), a working copy
 * with its whole history (a shallow clone is refused), the outgoing commits (`sha` minus everything the destination has; nothing there —
 * from the root), their file names (NUL-delimited, per parent) and their content. A failed destination request throws; a failure inside the
 * scan is a `scan` refusal.
 */
export async function scanPublication(github: Ports["github"], dir: string, sha: string, policy: PublishPolicy): Promise<ScanResult> {
  const d = await checkDestination(github, dir, policy);
  if (!d.ok) return d;
  const except = await github.remoteHeads(dir, d.dest.url);
  const findings = new Set<string>();
  let commits: string[];
  try {
    // Beyond a shallow boundary the history is missing: what is there cannot be shown to be all there is.
    if (await github.shallow(dir)) throw new ScanError("the working copy is a shallow clone — its history is incomplete");
    commits = await github.outgoing(dir, sha, except);
    if (commits.length > MAX_SCAN_COMMITS) return refuse("scan", `the publication scan did not run: ${commits.length} new commits, at most ${MAX_SCAN_COMMITS} — nothing is pushed`);
    for (const c of commits) for (const p of await github.commitPaths(dir, c)) if (secretFileName(p)) findings.add(`${p}: key file by name`);
    if (commits.length > 0) {
      const scan = new LogScan();
      await github.logLines(dir, sha, except, MAX_SCAN_BYTES, (line) => scan.line(line));
      scan.end();
      const unseen = commits.filter((c) => !scan.commits.has(c));
      if (unseen.length > 0) throw new ScanError(`git log did not show ${unseen.length} of the ${commits.length} new commits`);
      for (const f of scan.findings) findings.add(f);
    }
  } catch (e) {
    return refuse("scan", `the publication scan did not complete: ${errText(e)} — nothing is pushed`);
  }
  if (findings.size > 0) {
    const list = [...findings];
    return refuse("secrets", `looks like it contains keys — not pushed to GitHub: ${list.slice(0, 5).join("; ")}${list.length > 5 ? ` and ${list.length - 5} more` : ""}`, list);
  }
  return { ok: true, dest: d.dest, commits: commits.length };
}

/** The gate: `scanPublication`, and for a clean result a clearance for exactly `sha` — the only thing the port's `push` accepts. */
export async function publicationGate(github: Ports["github"], dir: string, sha: string, policy: PublishPolicy): Promise<GateResult> {
  const s = await scanPublication(github, dir, sha, policy);
  if (!s.ok) return s;
  const clearance: Clearance = Object.freeze({ dir, sha, url: s.dest.url, repo: s.dest.repo });
  ISSUED.add(clearance);
  return { ok: true, clearance, commits: s.commits };
}

/** The one content-bearing push: the gate, then exactly `sha` to `refs/heads/<branch>` (an explicit refspec, never `--force`). */
export async function publish(github: Ports["github"], dir: string, sha: string, branch: string, policy: PublishPolicy): Promise<PublishResult> {
  const g = await publicationGate(github, dir, sha, policy);
  if (!g.ok) return g;
  await github.push(dir, g.clearance, branch);
  return { ok: true, repo: g.clearance.repo, commits: g.commits };
}
