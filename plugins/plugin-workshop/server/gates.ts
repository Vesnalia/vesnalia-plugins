import type { ReviewVerdict, TechVerdict, VerifyVerdict } from "./parse";
import type { GitFacts } from "./ports";
import type { StageNo } from "./stages";
import { attemptNoun, failureText, removedText, type AttemptFact } from "./state";

export interface ReviewFact {
  who: string;
  /** Round number. */
  round: number;
  /** The reviewer thread was created in this round. */
  started: boolean;
  verdict: ReviewVerdict | null;
  invalid: string | null;
}
export interface GateFacts {
  stage: StageNo;
  /** Work documents (`docPaths`, `ownerPath`) — used in gate messages. */
  paths: { context: string; tech: string; tz: string; owner: string };
  /** Checklist "what is needed from the owner before implementation"; null — no file. */
  owner: { open: string[] } | null;
  /** Stage 5: the review round files were sent to the current verifier; null — nothing to hand over (no round, or it is invalid). */
  reviewsHanded: boolean | null;
  /** Reviews start on their own (setting `autoReview`): the gate wording depends on it. */
  autoReview: boolean;
  /** How many reviewers the work has (chosen at start); 0 — no reviews and none are awaited. No field — two. */
  reviewers?: number;
  exists: { context: boolean; tech: boolean; tz: boolean };
  /** The `tech.md` verdict; null — no file, or it has no verdict. */
  tech: TechVerdict | null;
  /** The `MIGRATIONS` line in `tz.md`; null — missing, or the lines contradict each other. */
  migrations: boolean | null;
  /** The `NAV` lines in `tz.md` are present and do not contradict each other; null — not checked (not the Spec stage). */
  nav?: boolean | null;
  /** The «Mockup» stage: whether `mockup/index.html` exists; null — not the «Mockup» stage. */
  mockup?: { index: boolean; error?: string | null } | null;
  /** The «Mockup» stage is on: open `owner.md` items warn on the step into Implementation — from Mockup, not from Spec. */
  mockupStage?: boolean;
  /** Both reviewers of the latest round of the current stage; null — no review was requested. */
  reviews: ReviewFact[] | null;
  progress: { done: number; total: number } | null;
  /** The latest verification round; null — there was no verification. */
  verify: { verdict: VerifyVerdict | null; invalid: string | null } | null;
  /** The live check report; null — there is none. */
  live: { verdict: VerifyVerdict | null; invalid: string | null } | null;
  /** The current rollout attempt of this work's plugin (rollout, reinstall, rollback) — at stages 5 and 6; null — there was none. */
  attempt: AttemptFact | null;
  /** The plugin working copy; null — no folder. */
  copy: GitFacts | null;
  /** The working copy's main branch has moved ahead of the work branch. */
  baseAhead: boolean;
  /** Names of stages before the current one whose handover is stale. */
  staleBefore: string[];
  /** The work worktree has uncommitted changes. */
  dirty: boolean;
  queued: boolean;
  /** Free disk space, GB; null — not measured. */
  freeDiskGb: number | null;
  minFreeDiskGb: number;
  /**
   * Building: where the work branch's current commit stands for publication (`Engine.publicationOf`) — `clean`, `findings` (something like a
   * key in the new commits: a blocker), `failed` (the check did not complete: a warning) or `unscanned` (no verdict for this commit yet: a
   * warning; «To verification» and «Roll out» run the check first). null or no field — GitHub is off.
   */
  publication?: { state: "clean" | "findings" | "failed" | "unscanned"; text: string } | null;
}
export interface Gate {
  /** Never handed over. */
  blockers: string[];
  /** Handed over only with the «Hand over anyway» button. */
  warnings: string[];
}

/** The working copy's main branch: rollout happens only from it. */
export const MAIN_BRANCH = "main";

/** "1 uncommitted change", "2 uncommitted changes". */
export function editsText(n: number): string {
  return `${n} uncommitted ${n === 1 ? "change" : "changes"}`;
}

/** GB with one decimal, rounded down: "1.96" must not turn into "2" next to a threshold of "2". */
const gb = (x: number) => String(Math.floor(x * 10) / 10);

export function gate(f: GateFacts): Gate {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const reviews = () => {
    if (f.reviewers === 0) return;
    if (f.reviews === null) {
      if (!f.autoReview) blockers.push("no review yet — «Send to review»");
      else blockers.push(f.stage === 3 ? "no review yet — it starts on its own when the agent finishes the spec (or «Send to review»)" : "no review yet — it starts together with verification (or «Send to review»)");
      return;
    }
    for (const r of f.reviews) {
      if (!r.started) blockers.push(`review ${r.who} not started — «Send to review»`);
      else if (r.invalid) blockers.push(`review ${r.who} is invalid: ${r.invalid}`);
      else if (r.verdict === null) blockers.push(`review ${r.who} is not ready or has no verdict`);
      else if (r.verdict === "blocking")
        warnings.push(
          f.stage === 3
            ? `${r.who}: a blocking finding remained after round ${r.round} — see how the agent closed it in the «Review» section of the spec`
            : `${r.who}: a blocking finding — see how the verifier handled it in the «Reviews» section of the verification report`,
        );
    }
    if (f.stage === 5 && f.reviewsHanded === false) blockers.push("reviews not yet handed to the verifier — wait a minute");
  };
  const base = () => {
    if (f.dirty) blockers.push("the worktree has uncommitted changes — commit or discard them");
    if (f.baseAhead) blockers.push("the working copy's main branch has moved ahead — the implementer is pulling it in");
  };
  const copy = () => {
    if (f.copy === null) {
      blockers.push("no plugin working copy");
      return;
    }
    if (!f.copy.hasGit) {
      blockers.push("the working copy has no git");
      return;
    }
    if (f.copy.branch === null) blockers.push(`the working copy is not on branch ${MAIN_BRANCH} (detached HEAD)`);
    else if (f.copy.branch !== MAIN_BRANCH) blockers.push(`the working copy is on branch ${f.copy.branch}, not ${MAIN_BRANCH}`);
    if (f.copy.dirtyCount > 0) blockers.push(`the working copy has ${editsText(f.copy.dirtyCount)}`);
  };
  // What cannot be published is not handed on either: a key found in the work branch holds «To verification» and «Roll out» (no force);
  // a check that did not complete, or none for this commit, is the owner's call.
  const publication = () => {
    const p = f.publication;
    if (p?.state === "findings") blockers.push(`the work branch ${p.text.replace(/ — not pushed to GitHub/, " — not published, rolled out or accepted until it is removed from the branch history")}`);
    else if (p?.state === "failed") warnings.push(`the work branch is not on GitHub: ${p.text}`);
    else if (p?.state === "unscanned") warnings.push(`the work branch's current commit has not been checked for publication yet${p.text ? `: ${p.text}` : ""}`);
  };
  const disk = () => {
    if (f.freeDiskGb === null) blockers.push("free disk space not measured — a blind rollout does not start");
    else if (f.freeDiskGb < f.minFreeDiskGb) blockers.push(`${gb(f.freeDiskGb)} GB free on disk, at least ${f.minFreeDiskGb} needed`);
  };
  const UNKNOWN = "install outcome unknown — «Install again», «Roll back» or «Disable»";
  if (f.queued) blockers.push("the work is queued for the machine");
  if (f.stage === 1) {
    if (!f.exists.context) blockers.push(`no ${f.paths.context}`);
  } else if (f.stage === 2) {
    if (!f.exists.tech) blockers.push(`no ${f.paths.tech}`);
    else if (f.tech === null) blockers.push("tech.md has no verdict — last line VERDICT: OK | OK_WITH_CAVEATS | IMPOSSIBLE");
    else if (f.tech === "impossible") warnings.push("feasibility check: it cannot be done this way — hand over anyway?");
    if (f.owner === null) blockers.push(`no ${f.paths.owner} — what is needed from you before implementation`);
  } else if (f.stage === 3) {
    if (!f.exists.tz) blockers.push(`no ${f.paths.tz}`);
    else if (f.migrations === null) blockers.push("the spec has no MIGRATIONS: yes|no line");
    if (f.exists.tz && f.nav === false) blockers.push("the spec has no NAV: <plugin>/<section> after <neighbour> lines (or NAV: none) — the section's place on the navigation bar");
    reviews();
    if (!f.mockupStage && f.owner && f.owner.open.length > 0) warnings.push(`needed from you before implementation: ${f.owner.open.join("; ")}`);
  } else if (f.stage === 7) {
    if (f.mockup?.error) blockers.push(`mockup not read: ${f.mockup.error}`);
    else if (f.mockup && !f.mockup.index) blockers.push(`no ${f.paths.tz.replace(/tz\.md$/, "mockup/index.html")} — no mockup yet`);
    if (f.owner && f.owner.open.length > 0) warnings.push(`needed from you before implementation: ${f.owner.open.join("; ")}`);
  } else if (f.stage === 4) {
    if (!f.progress) blockers.push("no implementation ledger");
    else if (f.progress.done < f.progress.total) warnings.push(`${f.progress.done} of ${f.progress.total} plan tasks done`);
    base();
    publication();
  } else if (f.stage === 5) {
    // Nothing on top of a running attempt; an unknown outcome and a failure after the merge are not blindly repeated by a new rollout — the
    // owner decides first. A failure before the install (the working copy is intact or waits for the owner) does not block rollout: the gates below re-check the copy.
    const a = f.attempt;
    if (a?.status === "running") blockers.push(`${attemptNoun(a.kind)} still running — wait for it to finish`);
    else if (a && !a.resolved && a.status === "unknown") blockers.push(UNKNOWN);
    else if (a && !a.resolved && a.status === "failed" && a.step !== "recorded" && a.step !== "moved") blockers.push(failureText(a));
    if (f.verify === null) blockers.push("there was no verification");
    else if (f.verify.invalid) blockers.push(`the verification report is unusable: ${f.verify.invalid}`);
    else if (f.verify.verdict === null) blockers.push("the verification report has no verdict");
    else if (f.verify.verdict === "fail") blockers.push("verification is red — send it back to Implementation");
    reviews();
    base();
    copy();
    disk();
    publication();
  } else if (f.stage === 6) {
    // Until the attempt has finished successfully there can be no live report yet — one reason, not two.
    // The failure wording is the same as on the card (state.ts): before the merge and at it there is no advice to roll back.
    const a = f.attempt;
    if (a === null) blockers.push("there was no rollout attempt");
    else if (a.status === "running") blockers.push(`${attemptNoun(a.kind)} still running — wait for it to finish`);
    else if (a.resolved && (a.status === "failed" || a.status === "unknown")) blockers.push(removedText(a));
    else if (a.status === "failed") blockers.push(failureText(a));
    else if (a.status === "unknown") blockers.push(UNKNOWN);
    else if (a.kind === "rollback") blockers.push("the plugin was rolled back — nothing to accept, send the work back to the implementer");
    else if (f.live === null) blockers.push("no live check yet");
    else if (f.live.invalid) blockers.push(`the live check report is unusable: ${f.live.invalid}`);
    else if (f.live.verdict === null) blockers.push("the live check report has no verdict");
    else if (f.live.verdict === "fail") warnings.push("the live check is red — accept anyway?");
  }
  for (const t of f.staleBefore) blockers.push(`«${t}» is stale: what you approved has changed since`);
  return { blockers, warnings };
}
