---
name: hooks
description: Create, inspect, test, and remove custom VesnALIA hooks with the `alia hooks` CLI, including premade templates (desktop notifications, Slack, Discord, Telegram, ntfy phone push, log to file, follow-up and review threads, block patterns, office hours). Use when the user wants something to happen automatically when a thread finishes, fails, needs attention, or is archived, wants a webhook or shell command fired on a VesnALIA event, or wants to block or hold messages before they reach the agent.
---

# Custom hooks

A hook binds one VesnALIA event to a shell command or a webhook URL. Definitions
are stored in the plugin's `hooks` setting (Settings → Installed plugins →
Hooks) and the `alia hooks` command reads and writes the same list. The user
also has a **Hooks** page in the VesnALIA sidebar (Marketplace, Installed, Sources,
Secrets); point them there for browsing and forms, and use the CLI yourself.

## Premade hooks (start here)

| Command | Effect |
| --- | --- |
| `alia hooks templates` | List templates from subscribed marketplace catalogs. The plugin ships none of its own. |
| `alia hooks templates <template>` | Show its parameters and an example. |
| `alia hooks use <template> --set key=value…` | Create hooks from it. `--event` overrides events (repeatable), `--id` renames, `--project`/`--provider`/`--title`/`--text` filter. |

| `alia hooks marketplace add owner/repo` | Subscribe to a catalog (`hooks-catalog.json` in a GitHub repo, or an https URL). Then `alia hooks templates --search <text>` and `alia hooks use catalog/template --yes`. |
| `alia hooks marketplace stats [on\|off]` | Show or set whether new VesnALIA Hooks Marketplace installs are reported to its install counter. Leave the choice to the user; never switch it on for them. |
| `alia hooks secrets set <name> <value>` | Store a credential encrypted; reference it as `{{secret:<name>}}`. Secret template params are stored this way automatically. |
| `alia hooks export <id>` | Turn a hook into a template JSON for a catalog; `alia hooks marketplace init` prints a starter catalog. |

Prefer a template over a hand-written command when one fits. A fresh install subscribes to `MacHatter1/alia-hooks-marketplace` (catalog name `community`). Examples:
`alia hooks use community/slack --set webhookUrl=… --yes`,
`alia hooks use community/block-pattern --set 'pattern=\bprod\b' --set 'message=Ask a human.' --yes`,
`alia hooks use community/review --set provider=codex --title '^feat' --yes`.

## Commands

| Command | Effect |
| --- | --- |
| `alia hooks events` | List every event a hook can subscribe to, with what it means. |
| `alia hooks list` | Show hooks: id, event, enabled, target, match. |
| `alia hooks show <id>` | Print one hook as JSON. |
| `alia hooks add <id> --event <event> --command '<shell>'` | Create a command hook. |
| `alia hooks add <id> --event <event> --url <https://…>` | Create a webhook hook. |
| `alia hooks edit <id> [flags]` | Change fields; `--clear-match` drops filters. |
| `alia hooks enable <id>` / `alia hooks disable <id>` | Toggle without deleting. |
| `alia hooks remove <id>` | Delete. |
| `alia hooks test <id> [--thread <thread_id>]` | Run it now with a sample payload, or the given thread's facts. |
| `alia hooks history [--limit n] [--hook id]` | Recent runs with status, duration and output. |

Optional `add`/`edit` flags: `--project <proj_id>`, `--provider <id>`,
`--title <regex>`, `--text <regex>` (filters), `--timeout <ms>`, `--cwd <dir>`,
`--header k=v` (webhooks), `--description <text>`, `--disabled`,
`--on-error proceed|reject|wait` (gate hooks only). Add `--json` to any
command when the output drives code.

## Events

Observe-only (the hook is told after the fact): `thread.created`,
`thread.active`, `thread.idle`, `thread.failed`, `thread.archived`,
`thread.unarchived`, `thread.deleted`, `interaction.pending`,
`message.queued`, `message.dispatched`, `message.cancelled`, `turn.failed`,
`experimental_thread.events` (noisy: up to once per second per running thread),
`experimental_terminal.input`.

Gate (the hook's answer is acted on): `message.dispatch` runs before every
message reaches the provider. Exit 0 proceeds, exit 2 rejects (stderr becomes
the message the user sees), exit 3 queues the message with stderr as the
reason. Any other exit is a failure and the reason names the exit code.
A JSON object on the last stdout line overrides the exit code:
`{"action":"reject","message":"…"}`, `{"action":"wait","reason":"…","sendAt":<epoch ms>}`
or `{"action":"proceed"}`. Gate hooks must answer within 8 seconds.

## What the hook receives

- **stdin** (command) or **POST body** (webhook): one JSON object with
  `event`, `hookId`, `timestamp`, `serverUrl`, and the event payload
  (`thread` for thread events, plus `lastAssistantText`, `error`, `entry`,
  `interaction`, or the dispatch context). Read it with `jq`, for example
  `jq -r .thread.title`.
- **environment**: `ALIA_HOOK_EVENT`, `ALIA_HOOK_ID`, `ALIA_THREAD_ID`,
  `ALIA_PROJECT_ID`, `ALIA_PROVIDER_ID`, `ALIA_THREAD_TITLE`, `ALIA_THREAD_STATUS`,
  `ALIA_SERVER_URL`; gate hooks also get `ALIA_DISPATCH_ATTEMPT`, `ALIA_MODEL` and
  `ALIA_MESSAGE_TEXT` (first 1000 characters). Observe hooks whose command
  mentions `ALIA_MODEL`, `ALIA_REASONING_LEVEL`, `ALIA_SERVICE_TIER` or
  `ALIA_PERMISSION_MODE` also get the triggering thread's execution settings.
- Template settings of type `agent` take `inherit`, a provider id, or JSON
  `{providerId, model, reasoningLevel}`; in a command they expand to
  `{{agent.mode}}`, `{{agent.providerId}}`, `{{agent.model}}`,
  `{{agent.reasoningLevel}}` and `{{agent.serviceTier}}`.
- Webhooks get `x-alia-hooks-event` and `x-alia-hooks-id` headers, and when the
  plugin's webhook secret is set, `x-alia-hooks-timestamp` and
  `x-alia-hooks-signature: sha256=<hmac of "<timestamp>.<body>">`.

## Procedure

1. Run `alia hooks templates` first; use one when it fits. Otherwise run
   `alia hooks events` if unsure which event fits. `thread.idle` is "the
   agent finished", `interaction.pending` is "the agent needs the user",
   `thread.failed` and `turn.failed` are "something broke".
2. Create the hook with a short kebab-case id and quote the command:
   `alia hooks add notify-done --event thread.idle --command 'osascript -e "display notification \"$ALIA_THREAD_TITLE\" with title \"Agent finished\""'`.
3. Run `alia hooks test <id>` (add `--thread $ALIA_THREAD_ID` for a real payload)
   and read the output before relying on it.
4. Check `alia hooks history` when a hook seems not to fire.

## Rules

- Commands run on the machine that hosts the VesnALIA server, not inside the
  thread's environment; `--cwd` is a server-side path.
- Change hooks only through `alia hooks` or the settings page; never edit the
  plugin database directly.
- Keep gate hooks fast and side-effect free; a slow or failing gate hook lets
  the message through unless `--on-error reject` or `wait` is set.
- Do not add hooks the user did not ask for. Never put a credential in a
  command line or url: store it with `alia hooks secrets set` and reference
  `{{secret:name}}`.
- Catalog templates run third-party commands on the server. Show the user
  what `alia hooks templates <catalog/template>` prints before using `--yes`.
