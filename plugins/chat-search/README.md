# alia-plugin-chat-search

Find text in the open VesnALIA chat. Every match is highlighted in place.

![Find in chat panel with highlighted matches](docs/screenshot.png)

## Use

- Press **Mod+Shift+F**, or pick **Find in chat** from the right panel's new-tab list.
- Type a query. Matches light up in the chat, the panel lists each hit, and Enter / Shift+Enter step through them.
- `Aa` toggles match case, `.*` toggles regex.
- Regex mode uses [RE2 syntax](https://github.com/google/re2/wiki/Syntax) through [re2js](https://github.com/le0pard/re2js), so every pattern runs in linear time. Backreferences and lookaround are not supported.

No index. Each search reads the thread on demand and nothing is stored.
Searches follow the timeline's snapshot-bound cursors, up to 200 pages of
100 segments. Results are marked truncated if history remains or the list
exceeds 500 hits.

## CLI

```
alia chat-search find <query> --thread <thread-id> [--case] [--regex] [--json]
```

## Develop

This version targets VesnALIA `0.47.1-nightly.40028638376.1` or later and Plugin SDK
`0.6.75` or later. These are the oldest versions verified for the current tab,
command and timeline contracts. Older hosts have not been verified.

```
npm install
alia plugin types --check
alia plugin install .   # once
alia plugin dev         # rebuild and reload on save
npm run check         # typecheck, tests, build
```

Use `alia plugin types` followed by `npm install` to sync development declarations
when changing the test host. See [compatibility verification](docs/compatibility.md)
for the isolated browser checks and their limits.
