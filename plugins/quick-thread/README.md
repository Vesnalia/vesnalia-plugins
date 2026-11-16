# bb-plugin-quick-thread

A BB plugin that opens a floating "new thread" composer from anywhere, without
leaving the thread you are on.

## What it does

- **Ctrl/Cmd+N** opens a floating dialog over the current thread. It embeds
  BB's real new-thread composer, so every selection you already use is there:
  project, environment, provider/model, mentions, and attachments.
- **Enter** / **Create & open** creates the thread and navigates to it.
- **Ctrl/Cmd+Enter** / **Run in background** creates the thread, keeps you on
  the current thread, and shows a toast with an Open action.
- **Command palette** row "Quick Thread: new thread" opens the same dialog as
  a fallback where the OS reserves Cmd/Ctrl+N.

## How it works

The dialog is registered as an app overlay (`app.slots.experimental_appOverlay`),
so it is mounted once per window, outside any route layout, and stays available
on every screen. The backend takes the composer's `NewThreadRequest` and
forwards it to `bb.sdk.threads.spawn`, which fills in `origin: "plugin"` /
`originPluginId` so quick-created threads stay attributed to this plugin.

Nothing leaves the machine. The plugin needs no account, API key, or external
service.

## Install

From this directory:

```sh
npm install
bb plugin install .
```

After editing sources, reload:

```sh
bb plugin reload quick-thread
```

Or let `bb plugin dev` rebuild and reload on every save.

## Development

- `server.ts` — backend entry: the `create_thread` RPC that spawns the thread.
- `app.tsx` — frontend entry: wires the overlay and the command-palette row.
- `components/QuickThreadOverlay.tsx` — the floating dialog and its hotkeys.

Run `bb plugin build` before publishing git/npm installs. It writes
`dist/server.js` + `server.meta.json` and `app.js` / `app.css` /
`app.meta.json`.

## Types & API reference

The plugin API ships as the npm package `@get-bb/plugin-sdk`, pinned to an
exact version in `devDependencies`. After `npm install`, the full surface is
on disk at:

```
node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk.d.ts      # backend
node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk-app.d.ts  # frontend
```

Sync the SDK surface to the running BB:

```sh
bb plugin types          # sync this plugin's SDK surface to the running BB
bb plugin types --check  # CI: fail when it does not match
```

Ask BB to write plugins for you: the `bb-plugin-authoring` skill documents
the whole surface with examples. Confused by the API? Clone the BB repo and
read the source: <https://github.com/get-bb/bb>.
