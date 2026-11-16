# Mockup of a plugin section in VesnALIA's look (the «Mockup» stage)

The mockup is what the owner sees before development: they correct it in words, approve it, and the plugin is then
built to it. So the mockup must look like VesnALIA, not like "just a web page": the same font, colours, sizes and density.

## File

- `docs/workshop/<KEY>/mockup/index.html` — one self-contained HTML file: styles and scripts inside, no external
  fonts, libraries or network requests (it is opened in VesnALIA's chat and in a browser via `file://`).
- At the top of the page — the mockup's own bar (not part of VesnALIA): the plugin name, a screen switcher, a
  «Desktop / Phone» switcher (phone — a frame 390px wide) and the note «Mockup — sample data».
- In a window narrower than 720px the mockup opens in the «Phone» view by itself (check `innerWidth` on load): VesnALIA's
  chat previews the mockup about 430px wide, where the desktop layout gets squashed. The switcher still works as usual.
- Screens are sections of the page, switched without a reload (`hidden` on the inactive ones). Every screen and
  state from the spec is its own switcher item: «List», «Card», «Empty», «Error», «Confirmation…».
- The screenshots `desktop.png` and `phone.png` sit next to it, taken from this file.

## VesnALIA's look — theme variables from VesnALIA 0.46 CSS (light theme)

These are the actual values from VesnALIA 0.46's `app/dist/assets/index-*.css` (`:root`). Browsers understand `oklch()` and
`color-mix()` — put them into the mockup as they are, not "by eye".

```css
:root {
  --canvas: oklch(100% 0 0);                                          /* background */
  --ink: oklch(32.11% 0 0);                                           /* text */
  --muted-foreground: oklch(44% 0 0);                                 /* secondary text */
  --border: color-mix(in oklch, var(--ink) 14%, var(--canvas));       /* 1px border */
  --muted: color-mix(in oklch, var(--ink) 11%, var(--canvas));        /* backgrounds of blocks */
  --accent: color-mix(in oklch, var(--ink) 8%, var(--canvas));        /* hover, selected row */
  --sidebar-accent: color-mix(in oklch, var(--ink) 8%, var(--canvas));/* active item of the bar and the thread list */
  --primary: oklch(27% 0 0);                                          /* primary button */
  --primary-foreground: oklch(100% 0 0);
  --radius: .5rem;                                                    /* cards; buttons and fields — calc(var(--radius) - 2px) */
  --font-sans: "Inter Variable", Inter, system-ui, sans-serif;
  --text-xs: .75rem; --text-sm: .8125rem; --text-base: .9375rem;      /* 12 / 13 / 15 px */
}
```

- Density: 8–12px paddings, buttons and fields 28px high, table rows 28–32px — VesnALIA is dense, not a landing page.
- Error / success / attention — by text colour (`#dc2626` / `#16a34a` / `#b45309`), no full-width fills.
- Draw the light theme; add a dark one only if the owner asks for it.

## VesnALIA window layout

```
┌────┬───────────────────┬──────────────────────────────────────────────┐
│ ▢  │ New thread        │ [BADGE] Section name                   ✕  ▯  │  ← panel header 40px
│ ▢  │ ───────────────── │──────────────────────────────────────────────│
│ABC │ Pinned            │                                              │
│DEF │  · thread         │   section content (what the plugin does)     │
│ …  │  · thread         │                                              │
│XYZ │ Threads           │                                              │
│ ⚙  │  · thread         │                                              │
└────┴───────────────────┴──────────────────────────────────────────────┘
 48px      260px                       the rest
```

- The navigation bar on the left: icons 28×28, section badges 26×16 with a 4px radius, a white bold 8.6px code, the
  badge colour chosen for the plugin (from the spec and the context). Show this plugin's badge as the active one
  (a `--sidebar-accent` background under the button).
- The thread list — grey placeholder bars; it is not the subject of the mockup.
- The plugin section — on the right: the panel header with the badge and the name, the content below.
- Phone: no navigation bar and no thread list, the section takes the full 390px width, a header with a «☰» button.

## Skeleton sample

```html
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Mockup — <plugin></title>
<style>
  :root { --bg:oklch(100% 0 0); --ink:oklch(32.11% 0 0); --mute:oklch(44% 0 0); --line:color-mix(in oklch, var(--ink) 14%, var(--bg));
          --sub:color-mix(in oklch, var(--ink) 8%, var(--bg)); --primary:oklch(27% 0 0); }
  * { box-sizing:border-box; } body { margin:0; font:13px/1.45 "Inter Variable", Inter, system-ui, sans-serif; color:var(--ink); background:#e9e9e9; }
  .mock-bar { display:flex; gap:8px; align-items:center; padding:8px 12px; background:#fffbe6; border-bottom:1px solid var(--line); font-size:12px; }
  .win { display:grid; grid-template-columns:48px 260px 1fr; height:640px; margin:16px; background:var(--bg); border:1px solid var(--line); border-radius:8px; overflow:hidden; }
  .rail { background:var(--sub); border-right:1px solid var(--line); display:flex; flex-direction:column; align-items:center; gap:10px; padding:10px 0; }
  .badge { width:26px; height:16px; border-radius:4px; color:#fff; font:800 8.6px Inter, sans-serif; display:grid; place-items:center; }
  .threads { border-right:1px solid var(--line); padding:12px; } .stub { height:10px; background:#ededed; border-radius:4px; margin:10px 0; }
  .panel { display:flex; flex-direction:column; min-width:0; } .panel-head { height:40px; display:flex; align-items:center; gap:8px; padding:0 12px; border-bottom:1px solid var(--line); font-weight:600; }
  .content { padding:12px 16px; overflow:auto; } .muted { color:var(--mute); }
  button { height:28px; padding:0 10px; border-radius:6px; border:1px solid var(--line); background:#fff; color:var(--ink); font:12px Inter, sans-serif; }
  button.primary { background:var(--primary); border-color:var(--primary); color:#fff; }
  table { width:100%; border-collapse:collapse; } td, th { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); font-size:12px; } th { color:var(--mute); font-weight:500; }
  .phone .win { grid-template-columns:1fr; width:390px; } .phone .rail, .phone .threads { display:none; }
</style></head>
<body>
  <div class="mock-bar"><b>Mockup</b> · sample data · screens: <button data-screen="list">List</button> … · <button data-view="desktop">Desktop</button><button data-view="phone">Phone</button></div>
  <div class="win">
    <nav class="rail"><div class="badge" style="background:#64748b">ABC</div></nav>
    <aside class="threads"><div class="stub"></div><div class="stub"></div></aside>
    <section class="panel"><header class="panel-head"><span class="badge" style="background:#64748b">ABC</span> Section name</header>
      <main class="content"><section data-screen-id="list">…</section><section data-screen-id="empty" hidden>…</section></main></section>
  </div>
  <script>/* screen switcher and «Desktop / Phone» */</script>
</body></html>
```

## What not to do

- No CDNs (fonts, Tailwind, React): the file must open without a network. The Workshop's preview enforces it with a
  Content Security Policy: only inline scripts and styles, images, fonts and media as `data:` (or `blob:`) URLs; no
  requests, frames, workers or forms. A mockup that navigates its own page away (a link, `location`, a meta refresh,
  a reload) is not shown again — switch screens without leaving the page.
- Do not invent features beyond the spec: the mockup shows the spec, not new ideas. If you have an idea better than
  the spec, tell the owner — they decide.
- No real personal data, emails, customer amounts or keys — only plausible samples.
