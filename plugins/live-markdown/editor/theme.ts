// Editor look, built only from BB's theme variables so it follows the active
// palette (light, dark, and custom themes) without a second color source.
import { EditorView } from "@codemirror/view";

const muted = "var(--muted-foreground)";
const rule = "var(--border)";
const tint = "color-mix(in srgb, var(--muted) 70%, transparent)";

export const liveTheme = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--foreground)",
    backgroundColor: "transparent",
    fontFamily: "var(--font-sans)",
    fontSize: "14px",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.65", overflow: "auto" },
  ".cm-content": { padding: "16px 20px 40vh", caretColor: "var(--foreground)" },
  ".cm-line": { padding: "0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection":
    { backgroundColor: "color-mix(in srgb, var(--primary) 22%, transparent)" },

  ".cm-lm-syntax": { color: muted, opacity: "0.75" },
  ".cm-lm-h": { fontWeight: "650", lineHeight: "1.35" },
  ".cm-lm-h1": { fontSize: "1.6em", paddingTop: "0.6em" },
  ".cm-lm-h2": { fontSize: "1.3em", paddingTop: "0.5em" },
  ".cm-lm-h3": { fontSize: "1.12em", paddingTop: "0.4em" },
  ".cm-lm-strong": { fontWeight: "650" },
  ".cm-lm-em": { fontStyle: "italic" },
  ".cm-lm-strike": { textDecoration: "line-through" },
  ".cm-lm-code": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.9em",
    backgroundColor: tint,
    borderRadius: "4px",
    padding: "0.1em 0.3em",
  },
  ".cm-lm-link": { color: "var(--primary)", textDecoration: "underline", textUnderlineOffset: "2px" },
  ".cm-lm-quote": { borderLeft: `3px solid ${rule}`, paddingLeft: "12px !important", color: muted },
  ".cm-lm-codeblock": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.88em",
    backgroundColor: tint,
    padding: "0 8px !important",
  },
  ".cm-lm-hr": { borderBottom: `1px solid ${rule}`, height: "0.9em", marginBottom: "0.9em" },
  ".cm-lm-bullet": { color: muted, display: "inline-block", width: "0.8em" },
  ".cm-lm-task": { margin: "0 0.35em 0 0", verticalAlign: "-2px", cursor: "pointer" },

  // `contain: inline-size` keeps a wide table from widening the editor; it scrolls sideways instead.
  ".cm-lm-table-wrap": {
    overflowX: "auto",
    width: "100%",
    contain: "inline-size",
    // Padding, not margin: the observed border box is then exactly the block height CodeMirror measures.
    padding: "4px 0 12px",
    cursor: "text",
  },
  ".cm-lm-table": { borderCollapse: "collapse", fontSize: "13px", lineHeight: "1.5", width: "max-content", maxWidth: "none" },
  ".cm-lm-table th, .cm-lm-table td": {
    border: `1px solid ${rule}`,
    padding: "4px 8px",
    verticalAlign: "top",
    maxWidth: "28em",
    minWidth: "3em",
  },
  ".cm-lm-table th": { backgroundColor: tint, fontWeight: "600", textAlign: "left" },
  ".cm-lm-table tr:hover td": { backgroundColor: "color-mix(in srgb, var(--muted) 40%, transparent)" },
  // The cell being edited shows its raw Markdown in place, outlined, on the page background.
  ".cm-lm-table td.cm-lm-cell-editing, .cm-lm-table th.cm-lm-cell-editing": {
    outline: "2px solid var(--ring)",
    outlineOffset: "-2px",
    backgroundColor: "var(--background)",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    cursor: "text",
  },

  ".cm-panels": { backgroundColor: "var(--background)", color: "var(--foreground)", borderColor: rule },
  ".cm-searchMatch": { backgroundColor: "color-mix(in srgb, var(--primary) 25%, transparent)" },
  ".cm-searchMatch-selected": { backgroundColor: "color-mix(in srgb, var(--primary) 45%, transparent)" },
});
