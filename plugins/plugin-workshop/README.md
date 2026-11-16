# Plugin Workshop

A bb plugin for building bb plugins. It adds a **Plugin Workshop** section to bb: a board where every card is a
plugin, from the first idea to retirement. Building or changing a plugin is a *work* that goes through seven stages —
Context, Feasibility, Spec, Mockup, Implementation, Verification, Rollout — with its own agent thread at each stage.
The owner moves a work from one stage to the next with the stage's button, or hands the work to the optional
**autopilot**.

- Plugin id: `plugin-workshop` · CLI: `bb plugin-workshop` · requires bb 0.46 or later.
- The CLI is read-only; actions are the panel's buttons (or autopilot actions that run the same code). Both are
  plugin RPC methods — see Security for who can call them.

## The board

Columns: **Context → Feasibility → Spec → Mockup → Building → In production → Retired**.

- Every plugin installed in bb and every `bb-plugin-<id>` folder in the plugins folder (setting `pluginsRoot`,
  default `~/plugins`) gets a card. Without an open work, an enabled plugin sits in *In production*; a disabled or
  uninstalled one in *Retired*.
- A card with an open work sits in the column of the work's stage (Implementation and Verification share *Building*,
  Rollout is *In production*). The card shows the plugin's state in bb and labels such as *needs configuration*,
  *main branch ≠ rolled-out commit* or the GitHub labels below.
- **New plugin** — name, id and what the plugin should do. The Workshop scaffolds it with `bb plugin new` under the
  build lock, moves it to `<pluginsRoot>/bb-plugin-<id>`, makes it a git repository, creates a bb project for the
  folder and a task in bb Tasks, and opens the Context stage.
- **Rework** (on a plugin's page) — the same for an existing plugin. It needs a working copy in the plugins folder on
  branch `main` without uncommitted changes, installed from that folder (if installed at all), no other open work and
  no undecided install. The Workshop does not rework itself.

A plugin has at most one open work. Each work has a task key (from bb Tasks), its own branch and worktree of the
plugin repository, and a journal on the work page.

## How a work flows

The work page lists the stages, the stage files, the stage threads and a chat with the current agent. The owner reads
the result and presses the stage's button; the next agent gets the documents, not the previous conversation.

| # | Stage | The agent produces | The owner's button |
|---|---|---|---|
| 1 | Context | A conversation with the owner → `context.md`: what is wanted, what the owner will see, what is out of scope; the section badge code and colour | **Next** |
| 2 | Feasibility | `tech.md`, checked against the SDK types of the running bb, ending with `VERDICT: OK`, `OK_WITH_CAVEATS` or `IMPOSSIBLE`; `owner.md` — a checklist of what is needed from the owner (keys, accounts, paid plans, decisions) | **Next** or send back |
| 3 | Spec | `tz.md` — an implementation plan with `### Task N:` headings, a `## Post-rollout check` section, a `MIGRATIONS: yes` or `MIGRATIONS: no` line and `NAV:` lines; reviews run on it | **Next** or send back |
| 4 | Mockup | `mockup/index.html` (one self-contained HTML file in bb's look) plus `desktop.png` and `phone.png`; the owner asks for changes in the chat | **Approve mockup** |
| 5 | Implementation | The code, built task by task with subagents; a ledger of finished tasks | **To verification** |
| 6 | Verification | A fresh verifier each round runs the tests, the typecheck, `bb plugin build` and `bb plugin types --check`, compares the branch with the spec and the mockup and writes a report ending in `VERDICT: PASS` or `VERDICT: FAIL` | **Roll out** or **Send back to Implementation per report** |
| 7 | Rollout | The Workshop installs the plugin; a fresh agent runs the spec's post-rollout check and writes a live report | **Accept**, **Roll back** or **Fix forward per report** |

Documents live in the plugin repository, in the work branch, under `docs/workshop/<KEY>/` (`context.md`, `tech.md`,
`owner.md`, `tz.md`, `mockup/`, `iteration-<N>.md`). Reports and reviews go to `.superpowers/workshop/<KEY>/` in the
worktree; the Workshop writes `.superpowers/.gitignore` so that folder stays out of git.

Rules that hold the flow together:

- **Gates.** Every hand-over is checked first. *Blockers* (a missing document or verdict, a red verification, an
  uncommitted worktree, not enough free disk, a running install, a key found in the work branch, …) cannot be
  overridden. *Warnings* (an `IMPOSSIBLE` feasibility verdict, unfinished plan tasks, a remaining blocking review
  finding, a red live check, open `owner.md` items, a publication check that failed or has not run for the current
  commit) can be accepted by the owner with **Hand over anyway** / **Accept anyway**. Some of them are hard stops for
  the autopilot (see Autopilot).
- **Versions.** A hand-over is bound to what the owner saw: the documents, the mockup and, from Implementation on,
  the commit. If an approved document changes later, its stage becomes *stale*; **Reconfirm** clears that without
  restarting agents.
- **Send-backs and iterations.** Sending a work back from Verification or Rollout starts a new iteration. The spec is
  not edited again: new tasks go to `iteration-<N>.md`. A red report offers a one-click send-back with the reason
  filled in.
- **Building queue.** At most `maxBuilding` works per machine are in Implementation and Verification; the rest wait.
- **Restart stage** starts the stage agent again. **Cancel work** (not available at Rollout) snapshots the whole
  worktree, uncommitted files included, as `refs/workshop/<KEY>/canceled` in the plugin repository, archives the
  work's threads and marks the task canceled. Key files and files with key indicators are neither committed to the
  snapshot nor copied into the plugin's data: the snapshot's `manifest.json` lists them (path and finding labels, no
  values). Staged changes are kept as `staged.patch`, built from the other paths only; it is withheld if the staged
  content it carries (binary files included) has a finding or cannot be read in full.
- **Snapshots.** On hand-overs and at the end, the work's files are copied into the plugin's data folder in bb
  (`<bb data>/plugins/plugin-workshop/works/<workId>/`, folders `0700`, files `0600`). Key files, symbolic links and
  files with key indicators are not copied; the journal names them.
- **Reconcile.** A pass every minute (and on thread events) drives every work from the facts: an action interrupted
  by a restart is finished or recognized rather than blindly repeated.

## Agents and models

The New plugin and Rework forms let the owner pick, per work, the provider, model and reasoning level for each group.
The choice is checked against bb's provider list and does not change after the work starts.

| Group | Default |
|---|---|
| Documents (Context, Feasibility, Spec, Mockup) | Claude Code · `claude-opus-5-5` |
| Implementation | Claude Code · `claude-opus-5-5` |
| Verification and Rollout | Claude Code · `claude-opus-5-5` |
| Autopilot orchestrator | Claude Code · `claude-opus-5-5` |
| Implementation subagents (Claude models only) | Claude Code · `claude-sonnet-5-5` |
| Reviewers (0, 1 or 2) | Claude Code · `claude-fable-5-1` and Codex · `gpt-6-astra` |

Every agent receives the bb plugin rules (where the plugin lives, the shared build lock, SDK pinning, append-only
migrations, no secrets in files, no installing or pushing on its own) and a short list of skills and references for
its stage. The stage knowledge is plain data in `server/rules.ts` (`stageKnowledge`). It names bb's built-in skills
(`bb-plugin-authoring`, `browser-automation`, `secrets`, `inline-vis`) and optional ones — `brainstorming`,
`writing-plans`, `subagent-driven-development`, `test-driven-development`, `verification-before-completion`,
`frontend-design` — which agents use only if they are installed.

## Reviews

A work has 0–2 reviewers. Reviewers see only files and write `review-<slot>-<stage>-r<N>.md` ending in
`VERDICT: BLOCKING` or `VERDICT: CLEAR`.

- **Spec.** With `autoReview` on, the review starts by itself when the agent ends its turn and `tz.md` has a
  `MIGRATIONS` line. The agent then closes every finding in the spec's `## Review` section. If blocking findings
  remain, another round starts by itself — up to two rounds per iteration.
- **Verification.** Reviewers look at the branch together with the verifier; their files go to the verifier, who
  confirms or refutes each finding against the code. A confirmed blocking finding means FAIL.
- **Send to review** / **Another review round** and **Stop reviewers** are the manual controls; with `autoReview`
  off they are the only way to start a review.

## Mockup

With `mockupStage` on (the default), a Mockup stage sits between Spec and Implementation. The agent draws the
plugin's section as it will look inside bb (navigation bar, panel header, every screen and state from the spec,
sample data) and shows it in the chat. The owner asks for changes in words and presses **Approve mockup**.
Implementation builds the interface to the mockup; Verification and the live check compare against it. The guide the
agent follows is `docs/mockup-guide.md`. With `mockupStage` off, Implementation follows Spec directly.

The work page previews the mockup in a sandboxed frame (scripts allowed, no same-origin access to bb) under a Content
Security Policy that allows only the mockup's inline scripts and styles and `data:`/`blob:` images, fonts and media —
no network requests, frames, workers or form submissions. A mockup that navigates its own frame away is replaced with a
notice (see Security for what this does not prevent).

Plugins with a navigation section register their own coloured badge (`docs/nav-badge.md`). The spec's
`NAV: <plugin>/<section> after <neighbour>` lines tell the Workshop where the section goes: on entering Rollout it
makes the plugin's sections visible and orders them in bb's UI settings (`sidebar.visiblePluginPanels`,
`sidebar.pluginPanelOrder`). Only the plugin's own sections are touched.

## Rollout, rollback, adopt

**Roll out** (from Verification) records an *attempt* and runs it step by step. Each step is written down before it
runs, so a restart resumes from the record:

1. Write the rollback point: `refs/workshop/<KEY>/before` and `refs/workshop/<KEY>/target` in the plugin repository.
2. Move the working copy's `main` to the work commit (`git reset --keep`, which refuses rather than overwrite changes).
3. Take the shared build lock (setting `buildLock`).
4. Install the working copy's dependencies (`npm ci --ignore-scripts`), then start a bb install job from the folder.
5. Release the lock, set the enabled state and check the result in bb's plugin list.

On success the work moves to Rollout and a live-check agent starts. Nothing starts on top of a running install, and
an unknown outcome is not repeated automatically: **Install again** is offered for that case. **Try to cancel install**
cancels the bb install job.

- **Accept** finishes the work. The rollback point stays with the plugin until the next rollout or rollback.
- **Roll back** returns the working copy to the rollback point, installs it and restores the previous enabled state;
  a plugin that was new is simply disabled. Rollback is closed when the work added data migrations
  (`MIGRATIONS: yes`) — then only **Disable** is offered. Rolling back from Verification or Rollout sends the work
  back to Implementation.
- **Disable** / **Enable** — the code and the data stay as they are.
- **Adopt as rolled out** — for a change committed to the working copy's `main` outside the Workshop (the card shows
  *main branch ≠ rolled-out commit*). The current `main` is installed under the lock and the previous rolled-out
  commit becomes the rollback point; if the diff touches data, rollback is closed.

## GitHub

Off until `githubOwner` is set. Then, with the `gh` sign-in of the bb server:

- each plugin gets a private repository `<owner>/bb-plugin-<id>`, created with the plugin's `main` the first time a
  work needs it;
- every push that carries code — `main` the first time, each new commit of the work branch, `main` after **Accept** or
  **Adopt as rolled out** — goes through one publication check. First the destination: `origin` must have exactly one
  push URL, a GitHub repository that is private (or internal) and owned by `githubOwner`; a public or foreign
  repository is refused unless `allowPublicRepos` is on, and the Workshop does not change a repository's visibility.
  Then every commit the destination does not have yet (from the root if it has nothing) is scanned: file names for
  key files, and every added line — merges against each parent, binary files as text — and commit messages for key
  patterns. The scan reads the objects as stored, with their real parents: replacement objects (`git replace`) and
  grafts are ignored, so it sees what the push sends; a shallow clone is refused, since its history is cut off.
  Test files are not exempt; only values that are plainly made up (`FAKE`, `EXAMPLE`, `DUMMY`, `PLACEHOLDER`,
  `REDACTED`, `XXXX`, or at most four distinct characters) are ignored. A finding, an incomplete scan (more than
  64 MB of changes, a git error, output it cannot read, `git` older than 2.31) or a refused destination stops the
  push; no setting or button overrides it. Only then is exactly that commit pushed (explicit refspec, without
  `--force`). The scan is a heuristic — see Security;
- each work keeps the verdict on its branch's current commit, tied to that commit, the destination and the policy:
  *clean*, *findings*, *failed* (the scan, the destination, the first push of `main` or a request did not get
  through — the reason is kept) or, for any other commit, destination or policy, *not checked*. **To verification**
  and **Roll out** run the check (scan only, no push) when the current commit has no verdict yet. *Findings* block
  both buttons (no «Hand over anyway»): the key has to be removed from the branch history; *failed* is a warning;
- with GitHub off, none of these publication checks apply;
- from Implementation on, the Workshop opens a PR from the work branch into `main`;
- after **Accept** (and **Adopt as rolled out**) `main` — the rolled-out commit — is pushed, so the PR shows as
  merged; the work branch is deleted once GitHub marks the PR merged;
- every 15 minutes each working copy is fetched, and cards get labels such as *no repository on GitHub*,
  *GitHub is behind by N*, *GitHub is ahead by N* or *main diverged from GitHub*. Rollout is blocked while `main` on
  GitHub has commits that are not in the work branch; **Adopt as rolled out** pulls them in (fast-forward only).

GitHub failures and refused pushes go to the work's journal (and to the plugin card for `main`) and are retried; a
failure on the way to GitHub is also the work's *failed* verdict until the commit gets a verdict of its own. A key-scan
finding or a refused destination needs the owner.

## Autopilot

On the Context stage, the **Autopilot** tab takes optional notes (*What matters to the autopilot*) and starts an
orchestrator: an agent thread in its own worktree that runs the work to the end on the owner's behalf. The Workshop
gives three tools to its thread alone — `plugin_workshop_status`, `plugin_workshop_act` and `plugin_workshop_file` —
and tells it to act only through them (the thread itself has full permissions; see Security). Every tool action runs
the same code as the matching button (same gates, same version checks) and is logged as `autopilot: …` in the journal.

- The Workshop wakes it with a status packet whenever the work waits for the owner (on failures — after two
  reconciles in a row), once per situation, with a reminder after 10 minutes of silence.
- It answers stage agents, hands stages over, approves the mockup against the spec's interface description, sends the
  work back on red reports, rolls out, accepts on a green live check and writes a final report into the task.
- **Hard stops** are checked by the Workshop before an orchestrator action runs, and the orchestrator's `force` does
  not lift them: no `forward` from Feasibility on an `IMPOSSIBLE` verdict; no move into Implementation or beyond
  (including roll out and accept) while `owner.md` has an open item, is missing or cannot be read (it is a required
  document once Feasibility is passed); with GitHub on, no `forward`, `enter` or `accept` unless the work branch's
  current commit has a *clean* publication verdict — *findings*, *failed* and no verdict (after the check has been
  run for it then and there) all stop it; no `accept` on a red live check (and without a green live report `accept`
  is refused). Trying one stops the autopilot and the reason goes into the task. The owner's own buttons keep their
  normal behaviour.
- For the remaining warnings the orchestrator may pass `force: true` only with a reason of at least 20 characters;
  the journal records the lifted warnings and the reason.
- Its instructions also make it stop and call the owner on `owner.md` items about keys, accounts, money or access and
  when the plugin needs configuration with keys, and tell it not to agree to anything paid or irreversible in external
  systems. Those are instructions to a model, not checks.
- The Workshop stops it on a third red check in a row, two unanswered wakes, 150 actions, 24 hours, or two crashes of
  its thread; the reason goes into the task.
- Any owner button on the work pauses it; **Resume autopilot** continues, **Stop autopilot** stops it.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `tasksProject` | none (required) | bb Tasks project where each work gets its task. Until it is set, new works are refused. Project ids: `bb tasks project list`. |
| `maxBuilding` | `2` | Works per machine in Implementation and Verification; more wait in a queue. |
| `minFreeDiskGb` | `2` | Free disk space (in the plugins folder), in GB, below which **Roll out** does not start. |
| `autoReview` | `true` | Reviews start on their own at Spec and Verification; off — only by the button. |
| `mockupStage` | `true` | The Mockup stage between Spec and Implementation. |
| `githubOwner` | empty | GitHub user or organization for `<owner>/bb-plugin-<id>`; empty — GitHub is not used. |
| `allowPublicRepos` | `false` | Also push to a public repository or one not owned by `githubOwner`. Off — such a destination refuses the push. |
| `pluginsRoot` | empty (`~/plugins`) | Folder of the plugin working copies. Change it only with no open works; takes effect after a plugin restart. |
| `buildLock` | empty (`~/.bb/locks/build.lock`) | `flock` file shared by every heavy command. Takes effect after a plugin restart. |

`pluginsRoot` and `buildLock` must be absolute, normalized paths made of letters, digits and `. _ / @ + -`; any other
value is ignored in favour of the default, and the reason is written to the plugin log and shown as the plugin's
*needs configuration* status. Shell examples given to agents single-quote these paths.

```sh
bb plugin config plugin-workshop set tasksProject <project-id>
```

## CLI

```sh
bb plugin-workshop list [--json]            # plugins by column: state in bb, open work
bb plugin-workshop show <id|KEY> [--json]   # a plugin (by id) or a work (by task key or work id)
```

The CLI is read-only: hand-overs, installs and rollbacks are the panel's buttons and the autopilot's actions (plugin RPC
methods; see Security).

## Requirements

- bb 0.46 or later (plugin SDK 0.6.37 or later), with the bb server on Linux or another Unix: the plugin runs `git`,
  `flock`, `pgrep`, `sh`, `npm` and the `bb` CLI there.
- **bb Tasks** and a project for the works' tasks (`tasksProject`).
- The **Claude Code** provider, signed in: the default agents, the orchestrator and the Implementation subagents
  (which must be Claude models). **Codex** for the default second reviewer — or pick other reviewers, or none, in the
  form. Every work runs several agent threads (one per stage, the reviewers, a verifier and a live check per round,
  optionally the orchestrator), which uses your provider plans or API budget.
- Optional: the **GitHub CLI** (`gh`) signed in on the bb server, with `gh auth setup-git` so that `git push` uses
  it, and `git` 2.31 or later, for the GitHub integration.
- Disk: every work has a worktree with its own `node_modules` (typically 50–180 MB).

## Security

The Workshop is a full-trust plugin. Install it only on a bb you control, and read this section first.

**Trust model**

- **One trust domain.** The panel's actions are plugin RPC methods. Any bb client can call them: the panel, the `bb`
  CLI (`bb plugin rpc call`) and every agent thread that can run `bb` — including the Workshop's own stage agents.
  bb does not tell the plugin whether a person clicked or an agent called, so every client is, in effect, the owner.
  The only callers the plugin refuses are *other plugins*: bb verifies the calling plugin, and every method that
  changes something rejects it (`board`, `plugin`, `work`, `file` and `models` stay readable).
- **Agents have full permissions.** Stage agents, reviewers and the autopilot orchestrator are bb threads started with
  `permissionMode: "full"` on the bb server (or the work's machine). A worktree is a working folder, not a sandbox:
  an agent can run any command the server's user can, read that user's files and use its sign-ins (`git`, `gh`, model
  providers, bb itself). Rules such as "do not install, do not push" are instructions to the agents, not enforcement.
- **The orchestrator too.** bb's narrower permission modes (`accept-edits`, `auto`) send tool calls to a user or an
  automatic reviewer; none of them limits a thread to the three Workshop tools, and nothing in the plugin SDK says the
  Workshop's tools run unattended under them. So the orchestrator also runs with `full`, and "act only through the
  Workshop tools" is an instruction. What the code enforces are the hard stops below.
- **Untrusted input.** The plugin's code and README, documents and reports written by agents, review files and agent
  replies are text someone else may have shaped. All of it reaches the models as context (prompt injection), and the
  autopilot decides from it.
- **Data to providers.** The owner's requests, the documents and the code go to the model providers you choose.

**Gates, force and hard stops**

- No button lifts a blocker. The owner's **Hand over anyway** / **Accept anyway** lift warnings — among them
  an `IMPOSSIBLE` verdict, open `owner.md` items, a red live check and a publication check that failed or has not run
  for the current commit.
- For the autopilot those are hard stops in `Pilot.act`, checked before the action runs, together with a missing or
  unreadable `owner.md` on the way into Implementation and — with GitHub on — anything but a *clean* publication
  verdict on the current commit (without a verdict the check runs first). A hard stop stops the autopilot with the
  reason in the task. Its `force` covers the remaining warnings and needs a reason of at least 20 characters, which
  goes to the journal.
- These checks bind the autopilot's tools. A full-permission agent that calls the RPC methods itself is a client like
  the owner (see above).

**Keys and secrets**

- The key scan is a heuristic: token patterns (`sk-…`, GitHub tokens, `xoxb-…`, `Bearer …`, JWTs, AWS access keys,
  private key blocks) and key file names (`.env*`, `*.env`, `*.pem`, `*.key`, SSH private keys, `secrets/`). A secret
  in another shape — a password in a config file, a token of an unknown format — passes it. Values that are plainly
  made up (`FAKE`, `EXAMPLE`, `DUMMY`, `PLACEHOLDER`, `REDACTED`, `XXXX`, or at most four distinct characters) are
  ignored.
- The scan fails closed: if it cannot complete (more than 64 MB of changes, a git error, output it cannot parse, a
  shallow clone, or a `git` older than 2.31), nothing is pushed. It reads the objects as stored, with their real
  parents: replacement objects (`refs/replace/`) and grafts are ignored, as the push ignores them. A finding blocks
  the push, **To verification** and **Roll out**; a check that did not complete blocks the push and is a warning for
  the owner at those gates (a hard stop for the autopilot).
- If `main`'s history already contains a key, the first push of `main` is refused and the work's verdict is *failed*
  (a warning). When the work branch's own check runs and its history includes that commit, the key is a finding and
  blocks those gates. The Workshop does not rewrite history; cleaning it is up to you.
- Publication goes only to a private (or internal) GitHub repository owned by `githubOwner`, through the single push
  URL of `origin`; `allowPublicRepos` is the only way to allow a public or foreign repository. The Workshop creates
  repositories as private and does not change an existing repository's visibility.
- Work snapshots (copies into the plugin's data) skip key files by name, files with findings and symbolic links;
  saved folders are `0700`, files `0600`. The cancel snapshot commit leaves out key files by name and files with
  findings (a symbolic link is kept as a link, not followed) and lists them in the snapshot's `manifest.json` (path
  and finding labels, no values) without copying them. `staged.patch` is built from the other paths of one captured
  index state, and the bytes it carries — both sides of every path, binary files included — are checked: on a
  finding, or when that content cannot be read in full (more than 64 MB, unmerged entries), the whole patch is
  withheld. The files themselves stay in the worktree until bb removes it.
- The file viewer and the autopilot's file tool refuse key file names and symbolic links. The symbolic-link checks
  apply when the worktree is on the bb server's machine; on another machine only bb's own confinement of reads to the
  worktree applies.
- Text the Workshop keeps or sends on — the journal, error texts, notes, reports, the plugin log, task comments — has
  token-shaped values replaced by `[redacted:<label>]`. That is best effort: what the patterns do not recognize stays,
  so task comments and the journal may retain text pasted into requests or reports. Agent threads are bb's and are not
  redacted.
- Agents are told to keep keys out of files, reports and git, and the owner enters keys with bb's `secrets` skill.

**Interface**

- The mockup preview runs the mockup in a sandbox without same-origin access, under a Content Security Policy that
  blocks network requests, frames, workers and forms. Residual: a script can still navigate its own frame and carry
  data in the URL — CSP cannot block that. The Workshop notices the second load and stops showing that mockup, but
  only after the navigation happened. A mockup that the stage agent shows in its chat (`inline-vis`) is rendered by
  bb, not by this plugin.
- Documents and reports are rendered with bb's `Markdown` component; how links and embedded HTML in them are handled
  relies on bb's sanitizer.
- A pull request link is stored and shown only if it points at the checked repository.

**Installs and dependencies**

- The Workshop installs, enables and disables plugins and moves the working copies' `main` branch — on the owner's
  buttons or the autopilot's actions — and changes two bb UI settings (which navigation sections are visible, and
  their order) for the plugin being rolled out. It runs `git` and `gh` with the server's sign-in, creates repositories,
  pushes without `--force` and opens pull requests.
- Rollout installs a working copy's dependencies with `npm ci --ignore-scripts`, and agents are told to install with
  `--ignore-scripts` too. `bb plugin new` (the New plugin scaffold) runs bb's own `npm install`; set
  `ignore-scripts=true` in the server user's npm config if you want that off as well. This repository's `.npmrc` sets
  `ignore-scripts=true` (see Development).

## Architecture

```
server.ts               plugin entry: calls wire()
server/wiring.ts        settings (path checks); one instance each of store, catalog, engine, creation, rollout, pilot; RPC (changing methods refuse other plugins), reconcile service, events, configure, CLI
contract.ts             RPC contract (zod) and view types shared by the server and the UI
server/engine.ts        works: stage entry, hand-over / send-back / cancel, reviews, Building queue, GitHub sync of the work branch and its publication verdict, reconcile, views
server/create.ts        «New plugin» (scaffold → rename → git → project → task) and «Rework»; every step is an intent and resumable
server/catalog.ts       the board: installed plugins and plugin folders, columns, labels, «Rework» blockers, GitHub reconcile facts
server/rollout.ts       roll out, accept, roll back, reinstall, disable / enable, cancel install, adopt — attempts with recorded steps under the build lock
server/pilot.ts         the autopilot: orchestrator thread, wake-ups, the plugin_workshop_* tools, hard stops and stop rules, its instructions
server/models.ts        default models, per-work model choice and its validation
server/stages.ts        stages and columns, stage order (pos / before / nextStage), file paths of a work, pluginsRoot
server/rules.ts         bb plugin rules for agents and per-stage knowledge (skills and references); build lock and docs paths
server/regulations.ts   stage instructions and the texts of messages to agents and reviewers
server/gates.ts         what blocks a hand-over (blockers) and what only warns (warnings)
server/versions.ts      result versions, stale stages, validity of a round's result
server/state.ts         card state and its reason
server/parse.ts         verdicts, MIGRATIONS and NAV lines, plan and ledger progress, owner.md items
server/secrets.ts       the key-file name rule, key patterns, the synthetic-value exemption, redaction of kept text
server/publish.ts       the publication gate: destination check, scan of the outgoing commits (also without a push, for verdicts), the only content push
server/snapshot.ts      the cancel snapshot and its checked staged.patch
server/ports.ts         the Ports interface — everything the server does outside its own database
server/sdk-ports.ts     Ports on top of bb.sdk, git, gh, flock and npm
server/fake-ports.ts    in-memory Ports for tests
server/store.ts         the plugin's SQLite: works, stage runs, hand-overs, intents, attempts, autopilot, journal
server/migrations.ts    append-only schema migrations
server/api.ts, cli.ts   views for the panel; `bb plugin-workshop list | show`
app.tsx, app/           the panel: board, plugin page, «New plugin» form, model picker, work page with the agent chat and the mockup preview
docs/                   guides read by stage agents: mockup-guide.md, nav-badge.md, browser-recipe.md
icons/board.svg         the section icon
```

Stage numbers are names, not positions: Mockup is stored as stage 7 but comes between Spec (3) and Implementation
(4). The code compares stages only through `pos`, `before`, `atOrAfter` and `nextStage` in `server/stages.ts`. A stage
transition is one database transaction together with the intent of what to do next; external actions (threads,
messages, installs) run from intents and are recognized after a restart; a thread is spawned with a retry key in
`pluginMetadata.opKey` and found by it after a failure.

## Development

Run heavy commands one at a time, under the same build lock the plugin uses:

```sh
flock ~/.bb/locks/build.lock npm ci                     # no install scripts (.npmrc)
flock ~/.bb/locks/build.lock npm rebuild better-sqlite3 --ignore-scripts=false   # after review: the tests need it
flock ~/.bb/locks/build.lock npm test
flock ~/.bb/locks/build.lock npm run typecheck
flock ~/.bb/locks/build.lock bb plugin build            # builds dist/, does not install
flock ~/.bb/locks/build.lock bb plugin install . --yes
bb plugin logs plugin-workshop | tail
```

The repository's `.npmrc` sets `ignore-scripts=true`: `npm install` and `npm ci` run no dependency install scripts
(named scripts such as `npm test` still run). The tests need the native binding of `better-sqlite3`, so review what
its install script does and build it with the second command above; without `--ignore-scripts=false` the `.npmrc`
setting would skip that build too. Use `bb plugin install`, not `bb plugin reload`: reload does not rebuild the
bundle. The Workshop is not developed through itself — change it by hand and install it.

## License

MIT — see `LICENSE`.
