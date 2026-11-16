---
name: higgsfield-usage
description: Report the user's Higgsfield credits balance, spending, top credit consumers, and recent generation jobs with the `alia higgsfield` CLI. Use when the user asks how many Higgsfield credits or tokens they have, how much they spent, what used their credits, or to sign in to Higgsfield for the dashboard.
---

# Higgsfield usage

The Higgsfield plugin reads the user's account through the official
`higgsfield` CLI on the user's machine. The CLI owns sign-in (OAuth in the
browser; Higgsfield's login page offers "Continue with Google"). The plugin
never stores the token.

## Commands

| Command | Effect |
| --- | --- |
| `alia higgsfield status [--refresh]` | Email, plan, credits, next reset date and grant, burn rate, runway, forecast, per-model summary for this cycle. |
| `alia higgsfield models [--range cycle\|7d\|30d\|90d]` | Per model: credits, generations, failed (refunded) generations, credits per generation, media type. |
| `alia higgsfield transactions [--limit N]` | Recent credit transactions with a category: generation, refund, subscription, package, expired. |
| `alia higgsfield jobs [--limit N]` | Recent generation jobs with model, status, and cost. |
| `alia higgsfield login` | Start browser sign-in. The user finishes it in the browser. |
| `alia higgsfield logout` | Sign out of the CLI. |
| `alia higgsfield raw <status\|transactions [cursor]\|jobs\|workspace\|models [kind]>` | Untouched CLI JSON, for debugging field mapping. |

Add `--json` when output drives code. Results are cached for 60 seconds;
`--refresh` bypasses the cache.

## Procedure

1. Run `alia higgsfield status`. Report credits and spend in plain numbers.
2. If it exits non-zero with `signed-out`, run `alia higgsfield login`, tell the
   user to finish in the browser (Google sign-in is fine), wait for their
   confirmation, then rerun `alia higgsfield status --refresh`.
3. If it reports `missing-cli`, tell the user to install the Higgsfield CLI or
   set its path in the plugin settings (`alia plugin config higgsfield`).
4. For "what used my credits" or "how many generations", run
   `alia higgsfield models` (add `--range 30d` for a longer window).
5. For "when do credits refresh", quote the `Reset:` line. The date is
   inferred from the last monthly "Subscription Credits" grant; unused
   subscription credits are removed at that moment ("Subscription Credits
   Reset"), so mention the forecast's "left at reset" figure.

## Rules

- Never read `~/.config/higgsfield/credentials.json` or print tokens.
- Do not start generations from this skill; it is read-only apart from
  login/logout.
- A "could not find a credit balance" warning means the CLI's JSON shape
  changed. Show `alia higgsfield raw status` to the user rather than guessing.
