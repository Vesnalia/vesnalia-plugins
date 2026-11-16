// Renders one cell's inline Markdown into DOM nodes for the table widget.
//
// The text is parsed with the same GFM parser the editor uses, so a cell shows
// exactly what the source means. Output is built with DOM APIs, never
// innerHTML: the only raw HTML honoured is `<br>`, everything else stays text.
import { markdownLanguage } from "@codemirror/lang-markdown";
import type { SyntaxNode } from "@lezer/common";

const SKIPPED_MARKS: Record<string, true> = {
  EmphasisMark: true,
  CodeMark: true,
  LinkMark: true,
  StrikethroughMark: true,
  LinkTitle: true,
  LinkLabel: true,
};

export function hrefFor(url: string): string | null {
  if (/^(https?:|mailto:)/i.test(url)) return url;
  if (/^www\./i.test(url)) return `https://${url}`;
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(url)) return `mailto:${url}`;
  return null;
}

function anchor(href: string | null): HTMLElement {
  if (href === null) return document.createElement("span");
  const a = document.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.className = "cm-lm-link";
  return a;
}

function renderNode(node: SyntaxNode, text: string, parent: Node): void {
  switch (node.name) {
    case "Emphasis":
      return renderChildren(node, text, parent.appendChild(document.createElement("em")));
    case "StrongEmphasis":
      return renderChildren(node, text, parent.appendChild(document.createElement("strong")));
    case "Strikethrough":
      return renderChildren(node, text, parent.appendChild(document.createElement("s")));
    case "InlineCode": {
      const code = parent.appendChild(document.createElement("code"));
      code.className = "cm-lm-code";
      return renderChildren(node, text, code);
    }
    case "Link": {
      const url = node.getChild("URL");
      const a = parent.appendChild(anchor(url ? hrefFor(text.slice(url.from, url.to)) : null));
      // Only the label: children up to the closing "]" mark.
      const marks = node.getChildren("LinkMark");
      const labelEnd = marks.length >= 2 ? marks[1].from : node.to;
      const labelStart = marks.length >= 1 ? marks[0].to : node.from;
      return renderRange(node, text, a, labelStart, labelEnd);
    }
    case "Autolink": {
      const url = node.getChild("URL");
      const raw = url ? text.slice(url.from, url.to) : text.slice(node.from, node.to);
      parent.appendChild(anchor(hrefFor(raw))).textContent = raw;
      return;
    }
    case "URL": {
      const raw = text.slice(node.from, node.to);
      parent.appendChild(anchor(hrefFor(raw))).textContent = raw;
      return;
    }
    case "HTMLTag":
      if (/^<br\s*\/?>$/i.test(text.slice(node.from, node.to))) {
        parent.appendChild(document.createElement("br"));
      } else {
        parent.appendChild(document.createTextNode(text.slice(node.from, node.to)));
      }
      return;
    case "Escape":
      parent.appendChild(document.createTextNode(text.slice(node.from + 1, node.to)));
      return;
    default:
      if (SKIPPED_MARKS[node.name]) return;
      if (node.firstChild === null) {
        parent.appendChild(document.createTextNode(text.slice(node.from, node.to)));
        return;
      }
      renderChildren(node, text, parent);
  }
}

function renderRange(node: SyntaxNode, text: string, parent: Node, from: number, to: number): void {
  let pos = from;
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    if (child.to <= from || child.from >= to) continue;
    if (child.from > pos) parent.appendChild(document.createTextNode(text.slice(pos, child.from)));
    renderNode(child, text, parent);
    pos = Math.max(pos, child.to);
  }
  if (pos < to) parent.appendChild(document.createTextNode(text.slice(pos, to)));
}

function renderChildren(node: SyntaxNode, text: string, parent: Node): void {
  renderRange(node, text, parent, node.from, node.to);
}

/** Appends `text` (one table cell's Markdown) to `parent` as rendered inline content. */
export function renderInline(text: string, parent: HTMLElement): void {
  const tree = markdownLanguage.parser.parse(text);
  renderChildren(tree.topNode, text, parent);
}
