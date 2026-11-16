---
name: create-hook
description: Guide the user from an idea ("tell me when a thread needs me", "block messages that mention production") to a working VesnALIA hook. Use when a thread is opened from the Hooks page's New hook button, when the user asks to create, set up, or automate a hook, or when they describe something that should happen automatically on a VesnALIA thread event. Ends with a tested, installed hook.
---

# Create a hook with the user

You are turning a plain-language wish into an installed, tested hook. Work
with the `alia hooks` CLI only; never edit the plugin's storage or settings
files by hand. The user can watch the result appear on the Hooks page.

## 1. Understand what they want

If the user has not said what should happen and when, ask, briefly:

- **When** should it fire? Map their words to an event with
  `alia hooks events`: "finished" → `thread.idle`, "needs me / waiting" →
  `interaction.pending`, "broke / failed" → `thread.failed` or `turn.failed`,
  "before a message goes to the agent" → `message.dispatch` (a gate).
- **What** should happen? A notification, a message to a service, a shell
  command, a follow-up thread, or a decision to block or hold a message.
- **Which threads**? Everything, or only some project, provider, or a title
  or text pattern.

Ask at most one round of questions. Prefer sensible defaults and say what
you assumed.

## 2. Prefer a template

Run `alia hooks templates --search <words>` (also `alia hooks marketplace search`).
If a template fits, install it with `alia hooks use <ref> --set key=value …`,
adding `--event`, `--title`, `--project`, `--text` filters as needed.
Credentials belong in `--set` values for secret params (stored encrypted) or
in `alia hooks secrets set <name> <value>`; never paste a token into a command.
A template from a catalog needs `--yes`; before adding it, show the user what
`alia hooks templates <ref>` prints under "What it runs".

## 3. Otherwise write the hook

`alia hooks add <id> --event <event> --command '<sh>'` or `--url <https://…>`.

- Commands run with `/bin/sh` on the machine hosting VesnALIA. The event arrives as
  JSON on stdin; `ALIA_THREAD_TITLE`, `ALIA_THREAD_ID`, `ALIA_PROJECT_ID`,
  `ALIA_HOOK_EVENT`, `ALIA_SERVER_URL` and `ALIA_CLI` (the VesnALIA binary) are in the
  environment. Use `{{secret:name}}` for credentials.
- Webhooks: add `--header 'name=value'` and let the plugin send the event
  JSON, or shape it with a body template via `alia hooks edit <id> --url …`
  (bodies use `{{thread.title}}`, `{{lastAssistantText|500}}`).
- Gate hooks (`message.dispatch`): exit 0 proceeds, 2 rejects with stderr as
  the reason, 3 queues; must answer within 8 seconds; use `--on-error` to
  choose what happens if the command fails.
- Chaining agents: call `"$ALIA_CLI" thread spawn …` from the command; the
  `follow-up` and `review` templates show the pattern, including the guard
  that stops chains after one hop. Their `agent` setting decides who runs
  the new thread: `--set agent=inherit` (same provider, model and reasoning
  as the triggering thread; the plugin passes them as `ALIA_MODEL`,
  `ALIA_REASONING_LEVEL`, `ALIA_SERVICE_TIER`), `--set agent=codex` (a provider
  with its default model), or `--set agent='{"providerId":"codex","model":"gpt-5.5","reasoningLevel":"high"}'`.
  Ask the user which they want when it matters, for example a reviewer on a
  different provider than the author.

## 4. Test, then hand over

1. `alia hooks test <id>` (add `--thread $ALIA_THREAD_ID` for a real payload).
   Read the output; fix the command until it does what the user asked.
2. For a gate, test both directions: a message that should pass and one
   that should not.
3. `alia hooks show <id>` and tell the user, in two or three sentences: what
   fires when, where to see runs (Hooks → Installed), and how to disable or
   remove it (`alia hooks disable <id>`, `alia hooks remove <id>`).

Do not install more than the user asked for. Do not leave test hooks behind.
