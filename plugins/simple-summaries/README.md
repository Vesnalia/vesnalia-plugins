# Simple Summaries

Small italic thread summaries above the VesnALIA composer. The widget shows only the full summary text, with natural wrapping: no icon, label, timestamp, status badge, buttons, or card border.

## Install

Install from the VesnALIA Community marketplace once published, or from this repository:

```sh
alia plugin install git:https://github.com/bottlebrushes/bb-simple-summaries.git@semver:^0.1.0
```

For local development:

```sh
npm ci --ignore-scripts
alia plugin build .
alia plugin install .
```

## Use

Select a provider and model in Settings → Plugins → Simple Summaries. Automatic generation runs after eligible threads become idle. Settings control the idle delay, minimum turns, prompt, concurrency, and cleanup.

Choose **Summary text** to show the inline widget, or **On demand** to hide it. Manual generation remains available in the Simple Summaries panel, the command palette, and the CLI:

```sh
alia summaries summarize [thread-id]
alia summaries show [thread-id]
alia summaries list --limit 10
```

Summaries are display-only. They do not compact the conversation or change the agent's context. Generation sends conversation text to the selected provider and uses its normal subscription allowance or API billing.

This plugin has its own settings and storage. If Recap is also installed, enable automatic generation in only one plugin to avoid duplicate work.

## Development

```sh
npm test
npx tsc --noEmit
alia plugin build .
```

## Attribution

Derived from [Recap v0.2.1 by MacHatter1](https://github.com/MacHatter1/bb-recap). The original MIT license is preserved in LICENSE, with provenance in NOTICE.
