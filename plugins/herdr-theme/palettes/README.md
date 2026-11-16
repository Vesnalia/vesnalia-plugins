# Palette provenance

`herdr.json` contains the RGB palette records extracted from Herdr's
`src/app/state.rs` on September 13, 2026, at upstream revision
`aa961df943b874730b23f78baf94af7332f7acfa`.
Source: https://github.com/herdrdev/herdr/blob/aa961df943b874730b23f78baf94af7332f7acfa/src/app/state.rs
Herdr is Copyright Herdr contributors, distributed under Apache-2.0.
The accompanying LICENSE-herdr.txt preserves that license for the data.
The original palette names credit Catppuccin, Tokyo Night, Dracula, Nord,
Gruvbox, One, Solarized, Kanagawa, Rosé Pine, and Vesper.

Changes for VesnALIA: scripts/generate-palettes.py maps records into VesnALIA semantic
roles, supplies explicit backgrounds where terminals would inherit their host,
and adjusts text and status shades for contrast. Dracula, Nord, and Vesper
have original light companions for VesnALIA, labeled in the picker. Code highlighting
uses corresponding bundled themes when available; Tokyo Night Day and the
three VesnALIA light companions use GitHub Light as a compatible code fallback.
These are adaptations, not pixel-identical terminal palette reproductions.

Regenerate with `python3 scripts/generate-palettes.py`. The script preserves
Lavender, writes ten theme files and the picker catalog, and records 180 text
contrast checks in design/palette-contrast.txt. Each family remains a native
VesnALIA manifest theme. Light/dark appearance remains VesnALIA's setting.

The settings picker writes VesnALIA's theme SDK through validated plugin RPC. Only
this plugin's registered palette IDs are accepted. Selection follows the palette
CSS VesnALIA applies, including updates from other clients, without polling or a second
saved preference. Navigation reads the same theme attribute.
