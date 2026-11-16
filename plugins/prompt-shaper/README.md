# Prompt Improver

Improve Prompt gives a rough VesnALIA composer draft one focused editing pass. It returns a clearer, context-complete request for you to review, without sending anything.

![Improve Prompt working on a draft in the VesnALIA composer](docs/screenshot-running.png)

![The improved prompt returned for review in the VesnALIA composer](docs/screenshot-result.png)

## Install

```bash
alia plugin install git:https://github.com/brsbl/bb-plugins.git@plugin/improve-prompt --yes
```

## Use

Write as roughly as you like, then choose **Improve prompt**. The revised text comes back in place for review; attachments stay attached, and you can undo the change.

While the rewrite is running, the composer is locked to prevent conflicting edits, the draft uses Improve Prompt's own shimmer treatment, and the same action becomes an accessible cancellation control. Cancelling aborts the client operation and stops the helper request; successful replacement restores focus to the composer.

## Customize the instructions

The hidden helper follows the **Rewrite instructions** setting. It ships with the full default guidance written out, so you can read exactly what the helper is told and edit it in Settings → Plugins → Prompt Improver, or from the CLI:

```bash
alia plugin config prompt-shaper --json
alia plugin config prompt-shaper set instructions "$(cat my-instructions.txt)"
```

Clear the field, or run `alia plugin config prompt-shaper unset instructions`, to restore the default. The output format, the draft-only boundary, and the rule against running the draft are fixed, so custom instructions cannot break the in-place replacement.

These instructions replace the `prompt-shaper` skill for the hidden helper, including a personal or project copy of that skill. To keep using your own copy, paste its guidance into the setting.

## Choose the helper model

By default the helper matches the composer's thread, or the project's spawn defaults for a new thread. Pick one under **Runs with** in Settings → Plugins → Prompt Improver, or from the CLI:

```bash
alia prompt-shaper helper                      # print the current choice
alia prompt-shaper helper fixed codex gpt-5    # always use this provider, optionally with a model
alia prompt-shaper helper thread               # follow the composer's thread
alia prompt-shaper helper default              # clear the choice
```

The stable plugin ID remains `prompt-shaper` for compatibility.

## How it works

The plugin sends only the current draft to a standalone hidden helper thread. The helper follows the Rewrite instructions setting to rewrite the draft into one paste-ready prompt, and the result replaces the draft in place. The helper may reuse the source thread's environment and execution settings, but it never reads or inherits that thread's transcript.

The bundled `prompt-shaper` skill remains available for rewriting prompts in a normal thread with `/prompt-shaper`.

The UI is registered through `app.composer.customize(...)` as the `improve` composer action. Its component uses the context-bound `useComposer()` and `useComposerView()` hooks, so thread, queued-message, side-chat, and new-thread drafts are handled by their mounted composer instance.

## Develop

From the monorepo root:

```bash
npm ci
npm run check --workspace=alia-plugin-prompt-shaper
alia plugin install "path:$PWD/plugins/improve-prompt" --yes
```
