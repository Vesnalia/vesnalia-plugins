# alia-side-board

A [VesnALIA](https://getbb.app) plugin that keeps a side panel of the questions, bugs and todos your
agent raises, numbered `Q1` / `B1` / `T1`. Items are added and closed automatically, in every thread.

```
 agent turn ──► board_add / board_close / board_list   (agent tools)
     ▲                    │
     │ instructions       ▼
     │ (every thread)   alia.storage.kv  board:<threadId>
     │                    │ realtime
     │                    ▼
     │              ┌──────────────┐
     │              │ Side board   │  Questions · Bugs · Todos
     │              │ panel + badge│  read-only; answer in chat: "Q3 clerk" / "go"
     │              └──────────────┘
 thread.idle ──► safety net: reply raised or finished something
                 without touching the board → one reminder
```

## Install

```sh
alia plugin install git:https://github.com/devnoo/bb-side-board@semver:^0.1.0
```

Threads that are already running pick it up when their next session starts.

## Settings

| Key | Default | |
| --- | --- | --- |
| `nudge` | `true` | Remind an agent that asked a question, mentioned a bug or deferred work, or finished open work, without updating the board. One reminder per turn at most. |

`alia plugin config side-board set nudge false`

## Develop

```sh
npm install
npm test            # board logic
npm run typecheck
alia plugin build
alia plugin install path:$PWD   # then: alia plugin dev
```

| File | Role |
| --- | --- |
| `board.ts` | data model, id allocation, close, idle heuristics. Pure, unit-tested |
| `server.ts` | tools, contributed instructions, safety net, RPC + realtime |
| `app.tsx` | side-panel tab and header badge |
| `skills/side-board/SKILL.md` | the agent-facing contract |

The `components/ui/` files are vendored VesnALIA UI components (shadcn model).

## Release

Tag `vX.Y.Z` and push. `alia plugin update` follows the semver range. Never move a tag.

## License

MIT
