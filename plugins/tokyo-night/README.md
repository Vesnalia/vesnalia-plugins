# Tokyo Night for VesnALIA

Two Tokyo Night palettes for the [VesnALIA](https://getbb.app) interface:

| Theme | Dark base | Notes |
| --- | --- | --- |
| **Tokyo Night** | `#1a1b26` | The original — deep indigo. |
| **Tokyo Night Storm** | `#24283b` | Lighter, bluer base; identical accents. |

VesnALIA folds both modes into a single palette, so every variant ships the upstream
**Tokyo Night Light** (`#d5d6db` / `#343b58`) for light mode. Switching light/dark
is a per-client VesnALIA setting, independent of which palette is active.

## Install

```sh
alia plugin install tokyo-night
```

Then pick a palette in **Settings → Appearance**, or:

```sh
alia theme set plugin:tokyo-night:tokyo-night-storm
```

## Development

```sh
alia plugin build .
alia plugin install .
alia plugin reload tokyo-night   # after editing themes/*.css
```

Each palette is a plain stylesheet in `themes/` that overrides VesnALIA's design
tokens — the two anchors (`--canvas`, `--ink`), the accent, the text tiers, and
the semantic colors. Every neutral surface and border derives from the anchors.

## Credits

Colors are taken from
[tokyo-night/tokyo-night-vscode-theme](https://github.com/tokyo-night/tokyo-night-vscode-theme)
(MIT), not re-derived. This plugin is not affiliated with or endorsed by that
project.

## License

MIT — see [LICENSE](LICENSE).
