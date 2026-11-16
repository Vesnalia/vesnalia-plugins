# Thread Pages

A VesnALIA plugin: every agent session gets one web page its agent writes for the task — a decision sheet, a diagram you
click, a report of what failed — and the forms on that page answer the session. You read and answer where the work
is, from VesnALIA, a browser or your phone over VesnALIA Connect.

```sh
alia plugin install thread-pages                                                   # the ALIA Community marketplace
alia plugin install git:https://github.com/unifedev/bb-thread-pages.git@^1.14.13       # or straight from this repository
```

VesnALIA 0.42 or later. From install, every new session receives a short standing instruction and writes a page; the agent
runs `alia pages init` and gives you the link. Turn off **Agent instructions** in the plugin's settings
(`alia plugin config thread-pages`) to stop that. The home page, `<your alia>/api/v1/plugins/thread-pages/http/home`, lists your
sessions by what needs you, with unsent drafts and the pages you let answer other sessions; `alia pages home` in a
session makes that session's page the home.

## Updating from 1.9

1.10.0 is a different implementation under the same plugin id: the VesnALIA host of Unife Pages. `alia plugin update
thread-pages` moves an installed 1.x to it. Kept: every page (a file in the thread's storage) and the settings by name and
value. Gone: `alia thread-page` (the command is `alia pages`), the bar around the page, and every kv row 1.9 stored —
offline copies, storage pages, grants and the signing key are deleted once on the first start (`alia plugin logs
thread-pages` shows the count). A session started under 1.9 still names `alia thread-page` in its instruction: tell it to
use `alia pages`, or start a new thread. `CHANGELOG.md` has the full list.

## What this repository is

A build artefact. The plugin is developed in the private monorepo `unifedev/unife` (`packages/alia-pages`), and this
tree is written from it by `scripts/release-alia.mjs`: the VesnALIA host (`server.ts`, `src/`) with the reference server
`@unifedev/pages-core` vendored under `core/src/` so that VesnALIA's git install — `npm install --omit=dev --omit=optional
--ignore-scripts`, then `alia plugin build` — builds it with no monorepo around. Nothing here is edited by hand, and
`main` is only ever a reviewed release (tags `vX.Y.Z`; this is 1.14.13). Report problems in this repository's issues.

Thread Pages is a host of the Unife Pages protocol for agent-written pages; the protocol spec is published separately.

## License

MIT — see [LICENSE](./LICENSE).
