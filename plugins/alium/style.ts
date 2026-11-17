// Hint styling. Three layers, later wins:
//   1. structural CSS that reads --alium-* variables (with fallbacks)
//   2. a theme preset that sets those variables
//   3. the user's Custom CSS setting, appended verbatim
// skills/alium/SKILL.md documents the variables and selectors for agents.

export const ROOT_ATTR = "data-alium-root";
const ROOT = `[${ROOT_ATTR}]`;

const THEMES = ["keycap", "vimium", "alia", "mono"] as const;
export type Theme = (typeof THEMES)[number];

export function parseTheme(raw: unknown): Theme {
  return THEMES.includes(raw as Theme) ? (raw as Theme) : "keycap";
}

const BASE = `
${ROOT} { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; }
${ROOT} .alium-hint {
  position: absolute;
  transform: translate(var(--alium-offset-x, 0px), var(--alium-offset-y, 0px));
  padding: var(--alium-padding, 1px 4px);
  border-radius: var(--alium-radius, 3px);
  font-family: var(--alium-font, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: var(--alium-font-size, 11px);
  font-weight: var(--alium-font-weight, 600);
  line-height: 1.3;
  letter-spacing: var(--alium-letter-spacing, .04em);
  text-transform: var(--alium-text-transform, uppercase);
  color: var(--alium-fg);
  background: var(--alium-bg);
  border: 1px solid var(--alium-border);
  border-bottom-width: var(--alium-border-bottom, 1px);
  box-shadow: var(--alium-shadow, 0 1px 3px rgba(0,0,0,.35));
  opacity: var(--alium-opacity, 1);
  white-space: nowrap;
}
${ROOT} .alium-hint.edge {
  transform: translate(calc(-50% + var(--alium-offset-x, 0px)), calc(-80% + var(--alium-offset-y, 0px)));
}
${ROOT} .alium-hint .typed { opacity: var(--alium-typed-opacity, .35); color: var(--alium-typed-color, inherit); }
`;

const THEME_VARS: Record<Theme, string> = {
  vimium: "--alium-bg: #fde77a; --alium-fg: #1a1400; --alium-border: #c9a227;",
  // VesnALIA's own key chip look: card surface, VesnALIA border, a keycap bottom edge.
  keycap:
    "--alium-bg: var(--card, #fff); --alium-fg: var(--foreground, #151419); --alium-border: color-mix(in oklab, var(--foreground, #151419) 22%, transparent); --alium-border-bottom: 2px; --alium-shadow: 0 2px 6px rgba(0,0,0,.14); --alium-font: var(--font-mono, ui-monospace, monospace); --alium-font-weight: 600; --alium-radius: 5px; --alium-padding: 0 5px; --alium-typed-color: var(--primary, #cc4710); --alium-typed-opacity: 1;",
  // VesnALIA's own tokens, so the preset follows the app theme and light/dark mode.
  alia: "--alium-bg: var(--primary, #cc4710); --alium-fg: var(--primary-foreground, #fff); --alium-border: transparent; --alium-font: var(--font-mono, ui-monospace, monospace); --alium-radius: var(--radius, 4px);",
  mono: "--alium-bg: var(--foreground, #151419); --alium-fg: var(--background, #fbfaf8); --alium-border: transparent; --alium-shadow: none; --alium-font: var(--font-mono, ui-monospace, monospace);",
};

// Insert mode: while the composer has focus, keys type text and `f` is a
// letter. A ring and an INSERT badge on the composer make that visible.
const COMPOSER = "[data-promptbox]";

const INSERT = `
${COMPOSER}:focus-within {
  box-shadow: 0 0 0 var(--alium-insert-width, 2px) var(--alium-insert-color) !important;
}
${COMPOSER}:focus-within::after {
  content: var(--alium-insert-label, "INSERT \\00B7  ESC");
  display: var(--alium-insert-badge, block);
  position: absolute;
  top: 0;
  right: 14px;
  transform: translateY(-50%);
  padding: 0 6px;
  border-radius: 4px;
  font: 600 10px/16px var(--alium-font, ui-monospace, SFMono-Regular, Menlo, monospace);
  letter-spacing: .06em;
  color: var(--alium-insert-fg);
  background: var(--alium-insert-color);
  pointer-events: none;
  z-index: 1;
}
`;

const INSERT_VARS: Record<Theme, string> = {
  vimium: "--alium-insert-color: #e0b400; --alium-insert-fg: #1a1400;",
  keycap: "--alium-insert-color: var(--ring, #f36525); --alium-insert-fg: var(--primary-foreground, #fff);",
  alia: "--alium-insert-color: var(--primary, #cc4710); --alium-insert-fg: var(--primary-foreground, #fff);",
  mono: "--alium-insert-color: var(--foreground, #151419); --alium-insert-fg: var(--background, #fbfaf8);",
};

/** `enabled` = vim keys on; without them there is no mode to show. */
export function buildCss(theme: Theme, customCss: string, enabled = true): string {
  const insert = enabled ? `${INSERT}\n${COMPOSER} { ${INSERT_VARS[theme]} }\n` : "";
  return `${BASE}\n${ROOT} { ${THEME_VARS[theme]} }\n${insert}/* Custom CSS */\n${customCss}\n`;
}
