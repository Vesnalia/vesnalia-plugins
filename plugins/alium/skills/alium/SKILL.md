---
name: alium
description: Configure the Alium plugin - Vimium-style keys in VesnALIA (f hints, j/k d/u scroll, gg/G, i). Use to change hint colors, size, font, position, theme, hint letters, scroll step, or to turn the keys off. Triggers - alium, hint style, hint colors, vim keys in VesnALIA, f hints look.
---

# Alium settings

Alium adds keyboard control to the VesnALIA app. Keys work when focus is outside a text field (`Esc` leaves the composer):
`f` hints, `j`/`k` scroll, `d`/`u` half a screen, `gg`/`G` top and bottom, `i` composer.
Keys listed in `disabledKeys` are left to VesnALIA and other plugins (e.g. `jk` for thread switching in the Kuri sidebar).

## Read and change settings

```sh
alia plugin config alium                         # show all values
alia plugin config alium set theme alia
alia plugin config alium set scrollStep 120
alia plugin config alium set disabledKeys jk     # leave j/k to the sidebar
alia plugin config alium set customCss '[data-alium-root] { --alium-font-size: 13px; }'
alia plugin config alium unset customCss         # back to default
```

Changes apply live in every open VesnALIA window. No reload.

| Key              | Type    | Default          | Meaning                                                                                                                                                              |
| ---------------- | ------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vimKeys`        | boolean | `true`           | Turn all keys on or off                                                                                                                                              |
| `disabledKeys`   | string  | empty            | Keys alium does not handle, any of `f i j k d u g G` (case matters). Other characters are dropped                                                                     |
| `hintCharacters` | string  | `sadfjklewcmpgh` | Label letters, home row first. Non a-z letters are dropped; fewer than 2 = default                                                                                   |
| `scrollStep`     | number  | `70`             | Pixels per `j`/`k` (max 2000)                                                                                                                                        |
| `theme`          | select  | `keycap`         | `keycap` alia-style key chips (typed letters in the accent color), `vimium` yellow, `alia` app accent, `mono` text color on background; all but vimium follow light/dark |
| `customCss`      | string  | empty            | CSS appended after the theme, so it wins                                                                                                                             |

## Style hints with customCss

Set variables on `[data-alium-root]`. Each one has a default, so set only what changes.

| Variable                                | Default                     | Controls                                        |
| --------------------------------------- | --------------------------- | ----------------------------------------------- |
| `--alium-bg`                            | theme                       | Label background                                |
| `--alium-fg`                            | theme                       | Label text color                                |
| `--alium-border`                        | theme                       | Border color                                    |
| `--alium-shadow`                        | `0 1px 3px rgba(0,0,0,.35)` | Box shadow                                      |
| `--alium-radius`                        | `3px`                       | Corner radius                                   |
| `--alium-padding`                       | `1px 4px`                   | Padding                                         |
| `--alium-font`                          | system monospace            | Font family                                     |
| `--alium-font-size`                     | `11px`                      | Font size                                       |
| `--alium-font-weight`                   | `600`                       | Font weight                                     |
| `--alium-letter-spacing`                | `.04em`                     | Letter spacing                                  |
| `--alium-text-transform`                | `uppercase`                 | `none` shows lowercase labels                   |
| `--alium-opacity`                       | `1`                         | Whole label opacity                             |
| `--alium-typed-opacity`                 | `.35`                       | Opacity of letters already typed                |
| `--alium-typed-color`                   | `inherit`                   | Color of letters already typed                  |
| `--alium-border-bottom`                 | `1px`                       | Bottom border width (keycap edge)               |
| `--alium-offset-x` / `--alium-offset-y` | `0px`                       | Shift labels from the element's top-left corner |

Insert mode: while the composer has focus, keys type text. The composer then gets a ring and an `INSERT · ESC` badge. Set these variables on `[data-promptbox]` (not on `[data-alium-root]`):

| Variable               | Default          | Controls                         |
| ---------------------- | ---------------- | -------------------------------- |
| `--alium-insert-color` | theme            | Ring and badge color             |
| `--alium-insert-fg`    | theme            | Badge text color                 |
| `--alium-insert-width` | `2px`            | Ring width; `0px` hides the ring |
| `--alium-insert-badge` | `block`          | `none` hides the badge           |
| `--alium-insert-label` | `"INSERT · ESC"` | Badge text, a CSS string         |

VesnALIA theme tokens work as values: `var(--primary)`, `var(--primary-foreground)`, `var(--foreground)`, `var(--background)`, `var(--accent)`, `var(--border)`, `var(--font-mono)`, `var(--font-sans)`, `var(--radius)`.

Selectors for anything the variables do not cover:

- `[data-alium-root]` - fixed full-window layer that holds all labels
- `[data-alium-root] .alium-hint` - one label
- `[data-alium-root] .alium-hint .typed` - letters already typed

Example - larger lowercase labels in the VesnALIA accent color, nudged up:

```sh
alia plugin config alium set theme alia
alia plugin config alium set customCss '[data-alium-root] { --alium-font-size: 13px; --alium-text-transform: none; --alium-radius: 6px; --alium-offset-y: -4px; }'
```

## Verify a style change

1. Run `alia plugin config alium` and check the stored value.
2. Ask the user to press `Esc` then `f` in VesnALIA and confirm the look. Labels close with `Esc`.

CSS is not validated. A syntax error drops the broken rule, and the theme still applies.
