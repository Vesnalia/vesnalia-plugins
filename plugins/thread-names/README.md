# alia-plugin-thread-names

A VesnALIA plugin that names threads `category: name`, all lowercase, so a sidebar
with dozens of parallel threads reads at a glance:

```
feat: csv export
fix: login redirect loop
review: rate limiter changes
ops: staging deploy pipeline
```

- The category is one word from a list you control. The defaults suit
  developers who run many coding-agent threads.
- The name is two or three words, four at most, about the subject of the task,
  written in the task's language.
- Everything is lowercase.

## Install

From the VesnALIA plugin marketplace once it is listed there, or from git:

```
alia plugin install git:https://github.com/nikushiks/bb-plugin-thread-names.git
```

## Select it

The plugin adds an AI service, `short-names`. Make it write thread titles:

```
alia settings ai-services set thread-title short-names --plugin thread-names
alia settings ai-services test thread-title
```

The test runs a sample through the service and prints the title it got.

Rename one existing thread: `alia thread regenerate-title <id>`.

Go back to VesnALIA's default titles:

```
alia settings ai-services set thread-title automatic
```

## Configure categories

The plugin has two settings, shown in VesnALIA under Settings, Installed plugins,
Thread Names, and readable with `alia plugin config thread-names`.

**Categories**: one per line, `name: what it covers`. The name is one
lowercase word of `a-z`, `0-9` and hyphens, at most 20 characters. Use 1 to 16
categories. The defaults:

```
feat: new features, endpoints, screens and the tests that come with them
fix: bugs, errors, crashes, failing tests and broken builds
refactor: restructuring, cleanup, renames, dependency upgrades, no change in behavior
review: code review, pull requests, diffs and audits of changes
docs: readmes, guides, code comments, changelogs and specs
research: questions, investigation, spikes, comparing options, reading code to learn how it works
ops: CI/CD, deploys, releases, infrastructure, environments, databases and monitoring
agents: the agent setup itself: prompts, skills, MCP servers, plugins, workflows, alia configuration
```

**Example names**: optional, one per line, `category: name`, all lowercase, at
most 12. The model sees them as samples of the style. An example whose
category is not in the active category list is left out, so after you replace
the categories, write examples for them or leave the field empty.

Edit both fields in Settings, or from a terminal:

```
alia plugin config thread-names set categories "$(cat categories.txt)"
alia plugin config thread-names set examples "$(cat examples.txt)"
alia plugin config thread-names unset categories   # back to the defaults
alia plugin config thread-names unset examples     # back to the defaults
```

VesnALIA refuses a value that breaks these rules and shows why, for example
`Line 3: the category "fix" is listed twice.` A stored value that still fails
when a title is written is replaced by the defaults, and the plugin logs a
warning (`alia plugin logs thread-names`). A change applies to the next title;
no reload is needed.

## How it works

VesnALIA hands every title service its own title prompt. The service keeps only the
thread material from it (the task, later messages, agent replies, the current
title), puts the naming rules and your categories on top, and sends it to VesnALIA
cloud through the alia-account plugin, as VesnALIA's own title service does. It uses
the same model, account and daily budget, and needs no API key.

- VesnALIA keeps the prompt text as the title when the first prompt has fewer than
  5 words, and older threads keep sentence-case titles. After each finished turn, a thread whose
  title is not in the `category: name` form gets its title regenerated from
  the prompt and the agent's replies. Each thread gets at most 2 tries.
- A thread that once had the form and was then renamed by hand is left alone.
- This runs only while `short-names` writes thread titles.
- The reply is lowercased before VesnALIA shows it.
- A prompt that is not a title request (a commit message, if you pick this
  service for commits) goes to VesnALIA cloud unchanged.
- The plugin reads VesnALIA 0.49's title prompt layout. If VesnALIA changes it, the whole
  prompt is passed with the naming rules on top.

## Requirements

- VesnALIA 0.49 or later (plugin SDK 0.6.79 or later).
- A VesnALIA account signed in on this VesnALIA (`alia account`), and VesnALIA cloud on
  (`alia ai on`). Titles count against the VesnALIA cloud daily budget.
- `alia ai off` stops the service at once: it reports not ready and sends
  nothing.

## Develop

```
npm install
npm run typecheck
alia plugin build
alia plugin install .
```

## License

MIT
