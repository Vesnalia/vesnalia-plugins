# alia-plugin-callstack

Call-stack-driven development for VesnALIA. The agent publishes **flows** — call
stacks with types moving through them — and the **Call stacks** thread panel
renders them live, with before/after change markers. One thread owns its own
set of flows.

## How it works

- **Skill** (`skills/call-stack-driven-development/`): teaches the agent the
  paradigm — trace the current call path, publish it, express the plan as a
  proposed flow with `change` markers, reconcile after implementing.
- **Agent tools**: `callstack_publish` upserts a flow (same name replaces),
  `callstack_delete` removes one. Flows are validated against the schema in
  `flow-schema.ts`.
- **Panel**: open the thread's right panel → Actions → **Call stacks**. It
  refreshes live as the agent publishes.
- **CLI**:

  ```sh
  alia callstack list [--thread <threadId>]
  alia callstack show <name> [--thread <threadId>]
  alia callstack clear [<name>] [--thread <threadId>]
  ```

## Flow format

A flow is `{ name, description?, status?: "current" | "proposed", frames }`.
Each frame: `fn`, `loc` (file:line), `in`/`out` types, `cond` (guarding
condition), `loop` context, `change` (`same|added|modified|removed`), `note`,
and nested `calls`. See `flow-schema.ts` and the skill's example.

## Install

```sh
alia plugin install .        # from this directory
```

## Develop

```sh
alia plugin dev              # watch: rebuild + reload on save
npx vitest run             # backend round-trip test (needs built better-sqlite3)
npx tsc --noEmit           # typecheck
```

Storage: plugin SQLite table `flows (thread_id, name, data, updated_at)`.
No settings.
