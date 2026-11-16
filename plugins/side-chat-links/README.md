# bb-plugin-side-chat-links

A [bb](https://getbb.app) plugin that shows which responses have side chats, and takes you back to them.

<img src="docs/overview.png" width="800" alt="A bb thread with a small thread icon and the number 2 under a response. The side panel beside it shows that response's two side chats as inner tabs named Spinlocks and Deadlock example, with the Spinlocks chat open.">

bb's side chats are easy to start and hard to find again: once you close a side chat's tab, nothing in the thread shows that it exists. This plugin fixes that.

- **An icon under the response.** Every response that has a side chat gets a small thread icon, with a count when it has more than one. Hover it to see their names.
- **One panel tab per response.** Click the icon to open that response's side chats in the side panel. Each side chat is an inner tab, so you switch between them in one place.
- **Names.** Click the pencil on an inner tab, or double-click the tab, to rename a side chat.

<img src="docs/rename.png" width="800" alt="The same panel with the second inner tab replaced by a text field, where the side chat is being renamed to Deadlock demo.">

## Install

```sh
bb plugin install git:github.com/robdodson/bb-plugin-side-chat-links
```

Needs bb 0.49 or later. There is nothing to configure. Reload the bb window after installing.

## Use

1. Start a side chat as usual: **Reply in side chat** on a message, and send it a message.
2. A thread icon appears under the response you replied to.
3. Click the icon to reopen the side chat later.

The panel's **+** menu also gets a **Side chats** action that lists every response in the thread that has side chats.

## How it works, and its limits

Side chats come from bb's bundled Side chat plugin. They are hidden forks of the thread. bb does not record which message a side chat was started from, so this plugin works it out from the text the side chat quotes:

- A side chat started with **Reply in side chat** on a message links to that message.
- A side chat started from selected text links to the message that contains the text.
- A side chat started with **Start side chat**, or one whose quote is not found, links to the last response written before it was created.

Other things to know:

- A side chat you opened but never wrote in gets no icon.
- **Reply in side chat** still opens the bundled plugin's own tab for a new side chat. Clicking the icon closes that tab and shows the side chat in the response's tab.
- A name is saved as the title of the side chat's own thread.
- The icon stays visible under the response through a small style override of bb's own markup. If a bb release changes that markup, the icon shows only on hover, like the other buttons under a message.
- In the macOS desktop app, the plugin also puts the close button of every panel tab back to its normal size, which fixes a tall hover highlight.

The plugin uses bb's experimental plugin APIs, so a bb update can break it. It adds no agent tools or CLI commands, and uses no external service.

## Develop

```sh
git clone https://github.com/robdodson/bb-plugin-side-chat-links
cd bb-plugin-side-chat-links
npm install
bb plugin install .   # install from this folder
bb plugin dev         # rebuild and reload on every save
```

```sh
npm run typecheck
npm test
```

`server.ts` finds each side chat's message and serves the list. `app.tsx` draws the icon and the panel tab. `shared/` holds the logic both use, with its tests. `PLUGIN_OVERVIEW.md` is the description shown in bb's plugin store.

## License

MIT. See [LICENSE](LICENSE).
