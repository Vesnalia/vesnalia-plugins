---
name: Transparency
description: A native VesnALIA appearance studio with rendered backdrops and a focused inspector.
colors:
  primary: "var(--primary)"
  primary-foreground: "var(--primary-foreground)"
  background: "var(--background)"
  foreground: "var(--foreground)"
  muted: "var(--muted)"
  muted-foreground: "var(--muted-foreground)"
  border: "var(--border)"
  destructive: "var(--destructive, #cc4444)"
  artwork-ground: "#10121b"
typography:
  body:
    fontSize: "14px"
    lineHeight: 1.5
  title:
    fontSize: "14px"
    fontWeight: 600
  label:
    fontSize: "14px"
    fontWeight: 500
  supporting:
    fontSize: "13px"
    lineHeight: 1.5
  measurement:
    fontSize: "12px"
  button:
    fontSize: "13px"
    lineHeight: "20px"
  code:
    fontFamily: "var(--font-mono, monospace)"
    fontSize: "12px"
rounded:
  inset: "4px"
  control: "6px"
  scene: "8px"
spacing:
  tight: "6px"
  compact: "8px"
  field: "12px"
  narrow-inset: "16px"
  divider: "20px"
  section: "24px"
  gallery: "28px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "5px 12px"
  button-secondary:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "5px 12px"
  button-text:
    textColor: "{colors.muted-foreground}"
    padding: "4px 0"
  input:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    padding: "7px 10px"
  inspector-navigation:
    textColor: "{colors.muted-foreground}"
    padding: "9px 3px 11px"
  preview-mode:
    backgroundColor: "{colors.muted}"
    padding: "3px"
  backdrop-choice:
    textColor: "{colors.foreground}"
    rounded: "{rounded.scene}"
    padding: "4px"
---

# Design System: Transparency

## Overview

**Creative North Star: "The native appearance studio"**

Transparency inherits VesnALIA’s visual identity. The host supplies the title, navigation, typeface, and semantic light/dark colors. Rendered artwork demonstrates the effect, and compact controls let users judge it against readable sample content.

The chrome stays calm and utilitarian. Dividers establish groups, a narrow inspector concentrates decisions, and the artwork carries color and motion. The sample workspace is explicitly labeled and illustrates readability.

**Key Characteristics:**

- Host-owned identity and semantic colors in both themes.
- A rendered preview, visual backdrop library, and focused inspector.
- Flat controls, fine dividers, small radii, and visible selection states.
- Ambient artwork motion with stable controls.
- Solid compact host surfaces that preserve text legibility.

## Colors

The control palette follows VesnALIA’s semantic tokens; user-selected colors belong to the artwork. CSS variable references in the frontmatter intentionally preserve the host’s live theme rather than freezing one screenshot’s colors.

### Primary

Host primary marks selected backdrop outlines, active tab rules, sliders, switches, and Save & use. Primary foreground supplies readable text and switch thumbs against that fill.

### Neutral

Background and foreground serve fields, buttons, and labels. Muted fills and muted foreground serve hover, segmented tracks, supporting copy, status, and measurements. Border supplies structural rules. Artwork ground backs both preview and thumbnail imagery. Destructive marks errors and confirmed removal/reset actions.

The VesnALIA theme, Cobalt, Moss, Ember, Dusk, and custom three-color palettes are artwork settings, defined in `config.ts`. VesnALIA theme resolves its first artwork color from the current host primary token.

**The Host Color Rule.** Keep UI colors bound to VesnALIA’s semantic variables; treat shader palette colors as artwork, not new navigation or control tokens.

## Typography

The body and title typeface is inherited from VesnALIA; no independent display face is defined. The shader editor uses the host mono token with monospace fallback. The hierarchy is compact: 14px body and section titles, weight 600 for headings, weight 500 for field labels, 13px supporting copy and button/tab/scene labels, and 12px status and measurements. Range values use tabular numerals.

Below the compact viewport breakpoint, ordinary text fields and selects use 16px text. The code editor retains its dedicated code size and preserves whitespace. Miniature sample-workspace text is illustration-specific and is not a general UI type scale.

## Layout

The panel uses the available host width, owns internal scrolling, and starts with a full-width enable/status toolbar and divider. Standard outer padding uses section spacing; compact viewport padding uses narrow-inset. Wide containers place the flexible preview/gallery beside a 320px inspector with a 32px gap. Gallery sections use gallery spacing and inspector groups use section spacing. Six shader choices form three columns; Glow, Image, and Plain share a row beneath. Custom shaders use a divided list.

- At **860px inner container width or less**, the inspector follows the gallery with a divider and two columns for eligible controls. Shader/image editing stays one column. Edit appearance scrolls to and focuses the inspector. Preview height becomes 300px.
- At **500px inner container width or less**, inspector controls, toolbar, and footer stack. The three-column scene grid tightens. Buttons have at least 36px height, tabs at least 44px, and preview height becomes 260px.
- Below a **768px viewport**, panel padding reduces and ordinary text fields/selects enlarge. This viewport boundary also controls host surface protection; it is independent of the container layout rules.

The wide preview height is fluid. Its clipped miniature sidebar/thread composition remains explicitly labeled and noninteractive.

## Elevation & Depth

Controls are flat: borders, muted fills, and selection outlines establish hierarchy. The panel defines no box-shadow vocabulary. Depth belongs to shader light and configurable desktop surface alpha, backdrop blur, dimming, sidebar frost, docked composer frost, and dialog frost. Popup surfaces retain a higher opacity floor. Do not copy these effect treatments into inspector chrome.

**The Compact Surface Rule.** Below a 768px viewport, keep host canvas, background, card, sidebar, and popover colors solid, hide the global backdrop, and remove popup blur so mounted shelves cannot show text through the foreground panel.

Artwork motion honors reduced motion and document visibility. Quality bounds frame rate and rendered pixels. Thumbnails are still renders, and temporary GPU resources are released. Controls change state immediately without decorative panel animation.

## Shapes

Control radii frame buttons and fields; inset radii frame swatches, thumbnail artwork, and segment selections; scene radii frame choice buttons and the miniature workspace. The large preview has a 10px clipped boundary. Fine one-pixel rules establish divisions; active tabs use a two-pixel bottom rule. Switches have capsule tracks and circular thumbs. Focus uses a two-pixel host ring outline with a three-pixel offset.

## Components

### Buttons

Secondary buttons use native background, foreground, border, and control radius; hover fills with muted. Primary buttons use the primary pair and mix their fill slightly on hover. Text actions are muted and underlined, becoming foreground on hover. Disabled buttons reduce opacity and retain labels. Destructive actions use destructive text.

### Inputs / Fields

Labels sit above outlined fields, with at least 36px input height. Sliders place a label and tabular value above the range. Palette controls expose three equal swatches or native color inputs. Switches align a fixed capsule with a label and optional hint. All keyboard-editable controls receive the shared focus outline.

### Navigation

Look, Surfaces, Motion, and Shader occupy equal-width tabs. Selected text becomes foreground with a primary bottom rule. Arrow keys, Home, and End move selection and focus. Workspace/Backdrop uses a compact segmented track, with a background fill marking the pressed choice.

### Backdrop choices and library

Choices pair actual still shader renders with a short name. Selection adds a primary outline, light primary tint, and vector check; hover uses muted. The custom library uses divided rows with select, Edit, and Remove actions, and an inline removal confirmation.

### Workspace preview

Workspace mode adds a clipped sample sidebar and thread over the artwork, with opacity driven by the controls. Backdrop mode exposes the artwork alone. A persistent sample label identifies the demonstration; shader drafts add Unsaved. Graphics errors produce a still fallback and readable feedback outside the artwork.

### Shader editor and feedback

The editor combines a name, resizable code field, collapsible input/example reference, compiler details, and explicit Preview shader and Save & use actions. Save & use requires a successful preview of unchanged source. Loading precedes editing; save status stays above the studio, failures retain pending appearance edits and expose Retry, and reset confirmation states that saved shaders remain. Image URLs remain drafts until Apply image.

## Do's and Don'ts

### Do:

- **Do** inherit VesnALIA’s title, navigation, typeface, and semantic theme colors.
- **Do** show actual rendered artwork in choices and label the sample workspace.
- **Do** preserve keyboard focus, selected states, readable errors, and save feedback.
- **Do** adapt to container width and keep compact host surfaces solid.
- **Do** keep artwork motion optional, bounded, and responsive to reduced motion and visibility.

### Don't:

- **Don't** add an independent branding header or centered outer card around the native panel.
- **Don't** use shader palette colors as a replacement UI theme.
- **Don't** continuously animate shader thumbnails or add decorative control motion.
- **Don't** treat miniature sample text sizes as the scale for operating controls.
- **Don't** replace shared vector icon components with raw text glyphs.
