// Obsidian-style live preview over the raw Markdown buffer.
//
// The document is always the file's exact text; nothing here edits it. A view
// plugin decorates the visible ranges: syntax marks (`#`, `**`, `[`, `](url)`,
// `>`) are hidden on every line the selection does not touch and shown dimmed
// on the lines it does, so clicking into a line reveals its source.
import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { hrefFor } from "./inline-render";

/** Line numbers touched by any selection range: those lines show source. */
export function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let n = first; n <= last; n++) lines.add(n);
  }
  return lines;
}

class BulletWidget extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-lm-bullet";
    span.textContent = "•";
    return span;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly pos: number,
  ) {
    super();
  }
  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked && other.pos === this.pos;
  }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-lm-task";
    box.checked = this.checked;
    box.addEventListener("mousedown", (event) => {
      event.preventDefault();
      // `[ ]` ⇄ `[x]`: one character at pos+1, the only edit this widget makes.
      view.dispatch({
        changes: { from: this.pos + 1, to: this.pos + 2, insert: this.checked ? " " : "x" },
      });
    });
    return box;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

const bullet = Decoration.replace({ widget: new BulletWidget() });
const hidden = Decoration.replace({});
const syntaxMark = Decoration.mark({ class: "cm-lm-syntax" });

const INLINE_STYLE: Record<string, string> = {
  Emphasis: "cm-lm-em",
  StrongEmphasis: "cm-lm-strong",
  Strikethrough: "cm-lm-strike",
  InlineCode: "cm-lm-code",
};

const HIDDEN_WHEN_INACTIVE: Record<string, true> = {
  HeaderMark: true,
  EmphasisMark: true,
  CodeMark: true,
  StrikethroughMark: true,
  QuoteMark: true,
  LinkMark: true,
};

function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const active = activeLines(state);
  const decorations: Range<Decoration>[] = [];
  const isActive = (pos: number) => active.has(state.doc.lineAt(pos).number);

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        const name = node.name;

        // Tables render through the block widget field; fenced code keeps its text.
        if (name === "Table") return false;

        const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(name);
        if (heading !== null) {
          const line = state.doc.lineAt(node.from);
          decorations.push(Decoration.line({ class: `cm-lm-h cm-lm-h${heading[1]}` }).range(line.from));
          return;
        }

        if (name === "Blockquote") {
          for (let pos = node.from; pos <= node.to; ) {
            const line = state.doc.lineAt(pos);
            decorations.push(Decoration.line({ class: "cm-lm-quote" }).range(line.from));
            pos = line.to + 1;
          }
          return;
        }

        if (name === "FencedCode" || name === "CodeBlock") {
          for (let pos = node.from; pos <= node.to; ) {
            const line = state.doc.lineAt(pos);
            decorations.push(Decoration.line({ class: "cm-lm-codeblock" }).range(line.from));
            pos = line.to + 1;
          }
          // Fence marks and info stay visible: they are block boundaries, not inline noise.
          return false;
        }

        if (name === "HorizontalRule") {
          if (!isActive(node.from)) {
            const line = state.doc.lineAt(node.from);
            decorations.push(Decoration.line({ class: "cm-lm-hr" }).range(line.from));
            decorations.push(hidden.range(node.from, node.to));
          }
          return;
        }

        const style = INLINE_STYLE[name];
        if (style !== undefined && node.from < node.to) {
          decorations.push(Decoration.mark({ class: style }).range(node.from, node.to));
          return;
        }

        if (name === "Link" || name === "Autolink") {
          const urlNode = node.node.getChild("URL");
          const href = urlNode ? hrefFor(state.doc.sliceString(urlNode.from, urlNode.to)) : null;
          decorations.push(
            Decoration.mark({
              class: "cm-lm-link",
              attributes: href === null ? {} : { "data-href": href },
            }).range(node.from, node.to),
          );
          return;
        }

        if (name === "URL" && node.node.parent?.name !== "Link" && node.node.parent?.name !== "Autolink") {
          const href = hrefFor(state.doc.sliceString(node.from, node.to));
          decorations.push(
            Decoration.mark({
              class: "cm-lm-link",
              attributes: href === null ? {} : { "data-href": href },
            }).range(node.from, node.to),
          );
          return;
        }

        if (name === "ListMark") {
          const text = state.doc.sliceString(node.from, node.to);
          if (!isActive(node.from) && (text === "-" || text === "*" || text === "+")) {
            // A task item keeps its marker hidden entirely: the checkbox stands in.
            const task = node.node.parent?.getChild("Task");
            decorations.push((task ? hidden : bullet).range(node.from, node.to));
          }
          return;
        }

        if (name === "TaskMarker") {
          if (!isActive(node.from)) {
            const checked = /x/i.test(state.doc.sliceString(node.from, node.to));
            decorations.push(
              Decoration.replace({ widget: new CheckboxWidget(checked, node.from) }).range(node.from, node.to),
            );
          }
          return;
        }

        if (HIDDEN_WHEN_INACTIVE[name]) {
          if (node.from === node.to) return;
          if (isActive(node.from)) {
            decorations.push(syntaxMark.range(node.from, node.to));
          } else {
            // `# ` and `> `: the space after the mark goes with it.
            let end = node.to;
            if ((name === "HeaderMark" || name === "QuoteMark") && state.doc.sliceString(end, end + 1) === " ") end++;
            decorations.push(hidden.range(node.from, end));
          }
        }
      },
    });
  }

  // Link destinations: hide `(url "title")` as one span so no stray characters remain.
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        if (node.name === "Table") return false;
        if (node.name !== "Link") return;
        const marks = node.node.getChildren("LinkMark");
        // [label](url): marks are "[", "]", "(", ")".
        if (marks.length < 4) return;
        const open = marks[2];
        const close = marks[3];
        if (isActive(node.from)) {
          decorations.push(syntaxMark.range(open.from, close.to));
        }
        // Inactive case: "(" and ")" are already hidden as LinkMarks; hide what is between them.
        else if (close.from > open.to) decorations.push(hidden.range(open.to, close.from));
      },
    });
  }

  return Decoration.set(decorations, true);
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** Ctrl/Cmd+click on a rendered link opens it; a plain click edits, like Obsidian. */
export const linkClicks = EditorView.domEventHandlers({
  mousedown(event) {
    if (!(event.metaKey || event.ctrlKey) || !(event.target instanceof Element)) return false;
    const href = event.target.closest("[data-href]")?.getAttribute("data-href");
    if (!href) return false;
    window.open(href, "_blank", "noopener,noreferrer");
    event.preventDefault();
    return true;
  },
});
