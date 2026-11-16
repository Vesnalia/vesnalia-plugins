# A plugin's section on the navigation bar: badge and place (template for Plugin Workshop agents)

The badge and the place of a plugin's section on the bar are part of the work on the plugin, not something "to do
outside the plugin".

## 1. The badge — inside the plugin itself

bb 0.46's navigation bar draws plugins' file icons in a single grey tone. A plugin registers a coloured badge with a
three-letter code itself, in its own `app.tsx`, under the same icon name its section passes to `navPanel({ icon })`.
The look: a 26×16 badge, a white bold code, the colour the owner chose.

```tsx
/** Section badge on the navigation bar: a three-letter Latin code on a coloured plate. */
function navBadge(code: string, color: string) {
  return function NavBadge({ className }: { className?: string }) {
    return (
      <svg className={className} viewBox="0 0 16 16" overflow="visible" style={{ overflow: "visible" }} aria-hidden="true">
        <rect x={-5} y={0} width={26} height={16} rx={4} fill={color} />
        <text x={8} y={11.4} textAnchor="middle" fill="#fff" fontSize={8.6} fontWeight={800} fontFamily="Inter, 'Segoe UI', Roboto, Arial, sans-serif">
          {code}
        </text>
      </svg>
    );
  };
}

export default definePluginApp((app) => {
  app.experimental_icons.register({ name: "<plugin id>/<icon>", component: navBadge("ABC", "#64748b") });
  app.slots.navPanel({ id: "<section>", title: "…", icon: "<plugin id>/<icon>", path: "<section>", component: Panel });
});
```

- The icon name is the plugin's own, of the form `<plugin id>/<name>` (not a built-in bb name such as
  `LayoutDashboard`): otherwise the badge would replace the icon of other plugins' sections.
- The code is three uppercase Latin letters that no other section uses. Check the plugins folder (the folder from the
  «bb plugin rules» in your instructions): `grep -rhoE 'navBadge\("[A-Z]{3}"' <plugins folder>/bb-plugin-*/app.tsx`.
- The colour is the owner's choice. If they group sections on the bar by colour, use the colour of the section's
  group. Suggested palette (white text stays readable on all of them): blue `#2563eb`, purple `#9333ea`,
  green `#16a34a`, teal `#0d9488`, orange `#ea580c`, red `#dc2626`, slate `#64748b`.
- The owner names the code and the colour at the «Context» stage; they are recorded in `context.md` and the spec.
- If another plugin already registers a badge under this section's icon name, do not register a second one: which of
  two registrations of the same name wins is decided by plugin order, not by you. Tell the owner instead.

## 2. The place on the bar — the `NAV` line in the spec, applied by the Workshop on rollout

In `tz.md` (or in an iteration file) — one line per plugin section, on its own line, without formatting:

```
NAV: <plugin id>/<section id> after <neighbour plugin id>/<neighbour section id>
```

A plugin without a navigation section — a single line `NAV: none`. Without ` after …` the section goes to the end.
The neighbour is the section it should follow on the bar now (for example, the last section of the same colour
group), written as it appears in `sidebar.pluginPanelOrder` of `bb settings ui list`. On rollout the Workshop itself makes the section visible
(`sidebar.visiblePluginPanels`) and puts it after the neighbour (`sidebar.pluginPanelOrder`); with no neighbour given
or found — at the end. Agents do not touch bb settings.
