# Context Handoff

A context meter and an **Auto handoff** switch directly above each thread's chat input. The meter shows how much of its context window a thread has used. The switch moves a long task to a fresh thread that picks up from notes the agent writes first. New independent threads default to off.

![The context meter and Auto handoff switch above VesnALIA's chat input](screenshots/context-handoff/composer.png)

## Install

```
alia plugin install https://github.com/RoRoGitr/bb-plugin-context-handoff
```

That follows the main branch. To follow tagged releases instead:

```
alia plugin install git:https://github.com/RoRoGitr/bb-plugin-context-handoff.git@^0.4.1
```

To see the plugin with screenshots in VesnALIA's plugin store first, add this repository's marketplace and install from there:

```
alia marketplace add https://raw.githubusercontent.com/RoRoGitr/bb-plugin-context-handoff/main/marketplace.json
alia plugin install context-handoff@rorogitr-plugins
```

Needs VesnALIA with plugin SDK 0.6.132 or newer (tested on VesnALIA 0.49) and a provider that reports token usage and context window size.

## Meter colors

The meter shows the percentage of the provider-reported context window. The bar changes color as the thread fills:

| Usage | Bar color |
|---|---|
| Below 20% | The theme's main color (`--primary`): light gray in VesnALIA's dark theme, dark gray in its light theme |
| 20% to 30% | Yellow (`#faf76b`) |
| 30% to 40% | Orange (`#ff9245`) |
| 40% to 65% | Red (`#ef4444`) |
| 65% and up | Dark red (`#991b1b`) |

If usage or window size is unavailable, the meter says so and automatic threshold checks wait for valid data.

![Each meter color and each state of the Auto handoff switch](screenshots/context-handoff/meter-and-switch.png)

The first image is a capture from VesnALIA. The second shows the plugin's banner component rendered once per state with sample usage values.

## Auto handoff switch

The switch is set per thread, beside the meter. What it does depends on how full the thread is when you turn it on:

- **Off** (the default for a thread you start): the thread shows the meter and gets no handoff messages.
- **Turned on below 20%:** the thread waits for 30%. A tick on the bar marks that point, and the handoff is requested when usage reaches it.
- **Turned on at or above 20%:** a handoff is requested at the next safe stopping point. On an idle thread that starts a turn.
- **Turned off again:** a pending request is withdrawn and the thread carries on. An already-confirmed continuation is not stopped.

Requests queue after the current turn. The agent finishes important steps, running tools and their verification before checkpointing. Continuations start with Auto handoff on and automatically request handoff at 30%. Every continuation is a direct child of the original thread, so nesting stays one level deep.

While a handoff is under way, a line under the meter says what is happening, such as "Handing off at the next safe stopping point…" or "Starting part 2…". Afterwards the meter is replaced by "Context handed off." and an **Open part 2** link.

## Handoff

- Turning the switch on at or above 20% records a request and queues the checkpoint request; on an idle thread that starts a turn. Below 20%, switching on arms the 30% trigger. If the agent is waiting for an answer from the user, the request waits and goes out once the thread can take it. Switching off before the next part starts withdraws it; switching on again makes a fresh request. A cancelled handoff is not requested again by itself.
- For a thread that is already on (a continuation), VesnALIA reports context usage while it runs. The plugin checks at most once every five seconds and also checks when a turn finishes. A queued message waits for the current turn and asks the agent to finish a safe unit of work; the plugin never forcibly stops tools. The threshold is approximate because the provider's usage reporting and the current operation determine when a checkpoint can happen.
- The agent saves the original request, requirements, and plan in `.handoff/<first-thread-id>/PLAN.md`, and current progress, decisions, questions, files, and the exact next action in `HANDOFF.md`. Each request carries a checkpoint id, and `HANDOFF.md` must start with that `Checkpoint:` line. Existing project plans can be referenced. Notes should be excluded from git.
- The agent runs `alia context-handoff ready` after writing the notes. When the workspace is locally accessible, the plugin checks that the files are nonempty, that the handoff note is fresh, and that it carries this request's checkpoint id. It then starts the next thread with the same workspace, provider, and available execution settings, waits briefly for that thread to start, and prints `HANDOFF_OK` only if it has not failed.
- **No second continuation doing the work.** The start attempt is saved before the thread is created, and the new thread is created with a back-link to that attempt. If VesnALIA's reply is lost, the link cannot be saved, or the plugin reloads mid-start, the next `ready` or check finds that thread instead of creating another. While an attempt's outcome is uncertain, `ready` asks the agent to wait a minute without working (counted from the failure, with a reminder) rather than retrying blindly; a definite refusal from VesnALIA is reported for the user instead, and uncertain failures stop after three attempts. VesnALIA's spawn has no idempotency key, so if VesnALIA finishes creating a thread long after that wait, a stray thread can exist; it cannot confirm, so it cancels itself and does no work.
- **Confirmed before it works.** The new thread is not shown the checkpoint id. It must read it from `HANDOFF.md` and run `alia context-handoff resume <id>` before any other work, so it proves it can see the right notes (including in remote workspaces the server cannot check). Only the thread from the current attempt can confirm. Until it does, the old thread's banner says **Part N is starting**; it warns, with what to do, if the part **failed to start** (with no retry queued by VesnALIA) or **stopped before confirming**, and says when a start **didn't finish**.
- **Cancelling.** Archiving (once VesnALIA's 30-second undo window has passed) or deleting a part that has not confirmed cancels that handoff: the part is marked cancelled, and the old thread becomes usable again with Auto handoff off, so a failing start is not repeated automatically. An archived part cannot confirm, even while VesnALIA keeps its turn running during the undo window. A part that already confirmed is never cancelled this way.
- The continuation inherits the on setting and chain. Switching off cancels a pending checkpoint, retires any unresolved start attempt so nothing from it can take over later (even one VesnALIA is still creating), and blocks a late ready call. An already-confirmed continuation is not stopped by a later switch change.
- Unrelated sub-agents, hidden or archived threads, and threads waiting for an interaction are not prompted. Plugin continuation children remain eligible. Off threads get no handoff messages or added instructions. The meter remains visible while off; unavailable usage is labeled explicitly.
- If the agent has not completed its checkpoint after another 20k tokens, the plugin can send a reminder when idle; it does not stack reminders during an active turn. The composer shows that preparation is in progress. Completion depends on the agent following the checkpoint instruction.

## Agent CLI

```
alia context-handoff status [thread-id] [--json]
alia context-handoff ready [thread-id] [--json]
alia context-handoff resume <checkpoint-id> [thread-id] [--json]
```

`ready` is for an agent responding to a plugin request, not a manual handoff command. Success prints `HANDOFF_OK` and the continuation link; `Not handed off` says whether to fix the notes, wait and run it again, stop and tell the user, or carry on. `resume` is run once by a new part with the id from its `HANDOFF.md`; it prints `RESUME_OK` or `Not resumed` with the reason. An agent may act only on its own thread; from a terminal, name the thread. The former `mode`, `now`, and `skip` commands have been removed.

## Settings

`alia plugin config context-handoff set <key> <value>`

- `enabled` (default `true`): global master switch. Each thread must also have Auto handoff on.
- The handoff target is 30% of each thread's reported context window. The old fixed-token `limit` setting is no longer used.
- `docsDir` (default `.handoff`): notes folder within the workspace. Absolute or escaping paths fall back to `.handoff`.

## Develop

```
npm install
npm test
npm run check
alia plugin types --check
alia plugin build
alia plugin reload context-handoff
```

`server.ts` implements watching, checkpoints, thread preferences, RPCs and agent commands. `app.tsx` renders the composer meter and switch. The tests use VesnALIA's official backend and frontend harnesses. The plugin uses only public SDK APIs.

## Listing text and screenshots

- `alia.description` in `package.json` is the paragraph on the plugin's page in VesnALIA. It is plain text.
- `PLUGIN_OVERVIEW.md` is the long description, and `screenshots/context-handoff/` holds the images, for a marketplace listing. VesnALIA 0.49 shows both only for a plugin that has a marketplace entry; a plugin installed from a local path shows the description alone.
- `marketplace.json` is this repository's own marketplace. It repeats the description and carries the `PLUGIN_OVERVIEW.md` text as `overview`, so update it whenever either one changes.

Keep all of them in step with the behavior described above.

## License

MIT, see `LICENSE`.
