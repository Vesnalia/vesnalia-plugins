# alia-plugin-reveal-in-finder

Renders a file an agent hands over as a card in the chat, like Codex does: an icon, the
name, its type and size, and **Open in ▾** — Finder, the default app, or VesnALIA's preview.
Clicking the card opens VesnALIA's preview (a folder opens in Finder).

An agent writes the card as a directive on its own line:

```
::file{path="/Users/me/Downloads/cats-radar-1.10.2.apk"}
```

`path` takes an absolute path, `~/…`, a `file://` URL, or a path relative to the thread's
worktree. A path that does not exist renders as "Not found". Finder and the default app run
on the Mac that runs the VesnALIA server.

From a shell: `alia reveal-in-finder show <absolute-path>`.

Install: `alia plugin install path:~/Projects/alia --plugin reveal-in-finder`; after a change,
`npm test && alia plugin build && alia plugin reload reveal-in-finder`.
