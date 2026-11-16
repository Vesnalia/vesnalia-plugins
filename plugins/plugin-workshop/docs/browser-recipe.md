# VesnALIA's browser: how to open a plugin section and take a screenshot (recipe)

Used by the «Mockup» stage (screenshots of the mockup) and the «Rollout» stage (the live check of the installed
plugin). The tool is VesnALIA's built-in `browser-automation` skill with a local headless browser on the VesnALIA server machine.

## Addresses

- **VesnALIA address** — the URL the VesnALIA server is served at. Inside a VesnALIA thread it is in `$ALIA_SERVER_URL`
  (for example `http://127.0.0.1:<port>`); replace `<alia address>` below with that value.
- **A plugin section** — `<alia address>/plugins/<plugin id>/<path>`, where `path` is the one the plugin passes to
  `app.slots.navPanel({ path })` in its `app.tsx`. The Workshop's own board, for example, is
  `<alia address>/plugins/plugin-workshop/plugin-workshop`.
- **A mockup** — `file://` plus the full path to `docs/workshop/<KEY>/mockup/index.html` in your worktree.

## What works and what does not

- `p.setViewport(...)` and `p.waitForFunction(...)` have been seen to end the run with `BrowserStoppedError` and stop
  the session. Instead: wait by polling `p.evaluate(...)` in a loop with short pauses; change the effective width with
  the page's CSS `zoom` (it affects only this tab and does not touch VesnALIA settings).
- A screenshot taken right after loading catches «loading…» and empty lists: a section's text and data typically appear
  only after a few seconds. Wait until the strings that prove the section has loaded are on the page.
- In `p.evaluate` only page code is available: use `location` and `document` inside the function, not outside.

## Recipe

```sh
# 1. Open a session (from a thread; outside a thread add --thread <id>). <server machine> — the alia server's row in
#    `alia machine list`. Remember "id" from the answer.
alia browser-automation open --backend local --headless --machine <server machine> --json
S=<id from the answer>

# 2–4. Address → wait until the section has loaded (up to 60 s) → zoom → screenshot.
alia browser-automation run "$S" --timeout 90s --json --script '
const p = await browser.getPage("main");
await p.goto("<alia address>/plugins/plugin-workshop/plugin-workshop");
let text = "", ready = false;
for (let i = 0; i < 120 && !ready; i++) {
  text = await p.evaluate(() => document.querySelector("main")?.innerText ?? "");
  ready = text.includes("New plugin") && text.includes("Retired") && !/loading…/i.test(text);
  if (!ready) await new Promise((r) => setTimeout(r, 500));
}
await p.evaluate(() => { document.documentElement.style.zoom = "0.6"; });
await new Promise((r) => setTimeout(r, 800));
await p.shot({ type: "jpeg", maxEdge: 1280, quality: 70 });
({ ready, url: p.url(), head: text.slice(0, 600) })'
# ready:false — the section did not load: the screenshot does not count; look at `alia plugin logs <plugin id>`.

# 5. Open images[0].path with your image-reading tool (same machine) and check it against what the section must show.
#    The file lives until the session is closed.

# 6. Close the session and make sure it is closed.
alia browser-automation close "$S" --json
alia browser-automation list --json
```

For another plugin, put its address into `p.goto(...)` and, into the `ready` condition, strings that only appear once
its section has loaded (a title, a button, a column name) plus its own loading text. With `zoom = "0.6"` a wide board
fits into 1280px and its text is still readable.

For the mockup's `phone.png`, switch the mockup to its own «Phone» view (click its switcher inside `p.evaluate`)
instead of resizing the viewport.

## If the direct address of a section does not load

A heavy section opened directly with `p.goto("…/plugins/<id>/<path>")` may keep ending with `host plugin call …
exceeded its deadline` or a white page with `ERR_INSUFFICIENT_RESOURCES`, although the section itself works. What
works is navigating inside an already loaded VesnALIA, without reloading the page:

```js
const p = await browser.getPage("main");
await p.goto("<alia address>/plugins/plugin-workshop/plugin-workshop"); // a light page: alia loads in full
await new Promise((r) => setTimeout(r, 4000));
await p.evaluate(() => { history.pushState({}, "", "/plugins/<id>/<path>"); dispatchEvent(new PopStateEvent("popstate")); });
// then poll the text of `main` in short steps and take `p.shot(...)`, as above
```

Another fallback: open `<alia address>/`, wait for the navigation bar and click the button whose `aria-label` is the
section's title.
