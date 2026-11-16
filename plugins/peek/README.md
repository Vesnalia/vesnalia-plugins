# alia-plugin-peek

Preview what a VesnALIA plugin would change before you install it.

Peek decorates the plugin store's cards with a Preview button. The button opens
a report of the plugin's impact: which parts of the VesnALIA interface it would
touch, which settings it would add, and which capabilities it would take.

Nothing is installed, enabled, or executed to produce that report. Peek
resolves the entry to its exact release and reads that release's files as text.

## Layout

| Path                      | What it is                                            |
| ------------------------- | ----------------------------------------------------- |
| `server.ts`               | Plugin factory: RPC, settings, and the `alia peek` CLI   |
| `src/sources.ts`          | Reading a package from disk, npm, or a GitHub archive  |
| `src/tar.ts`              | Dependency-free gzip+tar reader for both archive kinds |
| `src/extract.ts`          | Literal extraction from sources and bundles            |
| `src/analyze.ts`          | Turning files into the impact report                   |
| `src/schema.ts`           | Wire schemas, kept in lockstep with `src/types.ts`     |
| `app.tsx`                 | Frontend entry: content script + app overlay           |
| `src/ui/store-decorator.ts` | The Preview buttons on the store's cards             |
| `src/ui/PeekOverlay.tsx`  | The report modal                                       |
| `skills/peek/SKILL.md`    | How agents should read a Peek report                   |

## Develop

```sh
npm install
alia plugin build .
alia plugin install . --yes
alia plugin dev .          # rebuild and reload on every change
alia peek show aura --refresh
```

## Confidence

Peek never presents a guess as a fact. `declared` comes from the plugin's
manifest; `detected` comes from scanning its code without running it. The
report's Notes section lists what the analysis could not determine.
