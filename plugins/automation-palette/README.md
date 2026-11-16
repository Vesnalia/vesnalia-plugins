# Automation Palette

Run any VesnALIA automation from the quick palette, without opening the Automations page.

Without the plugin, typing "automation" in VesnALIA's quick palette finds only the Automations page. To start one by hand, you open that page, open the automation, and press **Run now**:

![VesnALIA's quick palette with "automation" typed in, listing one row, Automations, under Plugin pages](https://raw.githubusercontent.com/danielbachhuber/bb-plugins-screenshots/main/automation-palette/quick-palette--without-the-plugin.png)

With it, the same search lists every automation as a row you can run:

![The same search listing the Automations page and four rows, such as "Run automation: Widget sweep · Acme Widgets" and "Run automation: Gadget release notes · Acme Gadgets (paused)", each under Plugins](https://raw.githubusercontent.com/danielbachhuber/bb-plugins-screenshots/main/automation-palette/quick-palette--with-the-plugin.png)

## Use

- Open the quick palette and type `run`, `automation`, or the automation's name.
- Select a row to start that automation now, the same as when its schedule fires. The run shows on the Automations page with the others.
- Type a project's name to list only that project's automations. Every project's automations are listed in every window.
- A paused automation keeps its row, marked **(paused)**, so you can still run it by hand.
- Rows come from a list the plugin saves between loads. After you add, rename, or delete an automation, reload VesnALIA to update them.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `aliaPath` | empty | Path to the `alia` CLI, for when the plugin cannot find it. |

## Requirements

VesnALIA 0.42 or later, with the bundled Automations plugin, and the `alia` CLI on the machine running the VesnALIA server. On each VesnALIA load the plugin runs `alia project list` once and `alia automation list` once per project. Selecting a row runs `alia automation run` once.

## Related plugins

- **Automations** (`automations`), bundled with VesnALIA: creates, schedules, edits, and runs automations, and shows their history. Automation Palette lists them in the quick palette and starts them, and leaves everything else to Automations.
- **Autopilots** (`automation-groups`): sorts automations into folders on its own page, and pauses, resumes, or runs a folder at once. Automation Palette has no page: it starts one automation at a time from the keyboard.
- **Scheduled Jobs** (`launchd-jobs`): runs shell commands on a schedule as macOS launchd jobs, which keep running while VesnALIA is closed. It does not work with VesnALIA automations.

## Develop

```sh
npm install
npx tsc --noEmit
npm test
alia plugin build . && alia plugin reload automation-palette
```
