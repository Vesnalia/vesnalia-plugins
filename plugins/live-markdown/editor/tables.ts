// GFM tables stay rendered while you edit them. Clicking a cell turns that one
// cell into an editable field holding its raw Markdown; every keystroke
// replaces exactly that cell's characters in the file, so the rest of the
// table — and the rest of the line — never changes. A table shows as raw
// source only when it no longer parses as a table, i.e. when it is broken.
//
// Keys in a cell: Tab / Shift+Tab move between cells (Tab past the last cell
// adds a row), Enter moves down a row, Shift+Enter inserts `<br>`, Escape
// leaves the cell. A typed `|` is written as `\|` so a cell edit cannot split
// the row.
//
// Block replacements must come from a state field, not a view plugin.
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { Tree } from "@lezer/common";
import { type EditorState, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, runScopeHandlers, WidgetType } from "@codemirror/view";
import { renderInline } from "./inline-render";

interface Cell {
  /** Offset of the cell's trimmed text from the table's first character. */
  offset: number;
  text: string;
}

/** Splits one table row on unescaped pipes, keeping each cell's source offset. */
function splitRow(line: string, lineOffset: number): Cell[] {
  const pipes: number[] = [];
  let inCode = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\") i++;
    else if (line[i] === "`") inCode = !inCode;
    else if (line[i] === "|" && !inCode) pipes.push(i);
  }
  // Segments between pipes; the outer `|` of `| a | b |` only bound the row.
  const edges = [-1, ...pipes, line.length];
  const first = line.trimStart().startsWith("|") ? 1 : 0;
  const last = line.trimEnd().endsWith("|") ? edges.length - 2 : edges.length - 1;
  const cells: Cell[] = [];
  for (let k = first; k < last; k++) {
    const start = edges[k] + 1;
    const raw = line.slice(start, edges[k + 1]);
    // An empty cell `|  |` is anchored after its first space, so typing yields `| x |`.
    const lead = raw.trim() === "" ? Math.min(raw.length, 1) : raw.length - raw.trimStart().length;
    cells.push({ offset: lineOffset + start + lead, text: raw.trim() });
  }
  return cells;
}

/**
 * Where in a cell's source the click landed. The rendered text before the
 * caret is matched back into the source (markup only adds characters, so the
 * last few visible characters still occur there, in order); a click that
 * cannot be matched lands at the end of the cell.
 */
function clickOffsetInCell(cell: HTMLElement, source: string, x: number, y: number): number {
  const position = document.caretPositionFromPoint?.(x, y);
  const legacy = position ? null : document.caretRangeFromPoint?.(x, y);
  const node = position?.offsetNode ?? legacy?.startContainer;
  const offset = position?.offset ?? legacy?.startOffset;
  if (node == null || offset === undefined || !cell.contains(node)) return source.length;
  const range = document.createRange();
  range.setStart(cell, 0);
  range.setEnd(node, offset);
  const before = range.toString();
  if (before === "") return 0;
  for (const size of [12, 6, 3]) {
    const tail = before.slice(-size);
    // The n-th occurrence in the rendered prefix is the n-th in the source.
    const occurrences = before.split(tail).length - 1;
    let at = -1;
    for (let n = 0; n < occurrences; n++) {
      at = source.indexOf(tail, at + 1);
      if (at === -1) break;
    }
    if (at !== -1) return at + tail.length;
  }
  return source.length;
}

interface ParsedTable {
  /** Rendered rows (header first; the delimiter row is not one of them). */
  rows: Cell[][];
  alignments: string[];
}

function parseTable(source: string): ParsedTable {
  const lines = source.split("\n");
  const rows: Cell[][] = [];
  let lineOffset = 0;
  lines.forEach((line, index) => {
    if (index !== 1) rows.push(splitRow(line, lineOffset));
    lineOffset += line.length + 1;
  });
  const alignments = splitRow(lines[1] ?? "", 0).map((cell) =>
    cell.text.startsWith(":") && cell.text.endsWith(":") ? "center" : cell.text.endsWith(":") ? "right" : "",
  );
  return { rows, alignments };
}

interface EditTarget {
  row: number;
  col: number;
  caret: number;
}

interface ActiveEdit {
  cell: HTMLElement;
  row: number;
  col: number;
  /** The exact source range this field owns, relative to the table start. */
  start: number;
  length: number;
}

/**
 * Last rendered height of each table, by table id. A changed block widget
 * enters CodeMirror's height map at its `estimatedHeight` until the next
 * measure; without a real figure that is one line, and a table collapsing to
 * one line under the viewport sends scroll anchoring a full table height away.
 */
const renderedHeights = new Map<number, number>();

/**
 * One rendered table and its (at most one) cell being edited. It outlives
 * widget instances: CodeMirror hands each new source to `update` through
 * `updateDOM`, so focus and caret survive every keystroke.
 */
class LiveTable {
  private parsed: ParsedTable;
  private editing: ActiveEdit | null = null;
  /** Where to resume editing after a change that rebuilds the table (a new row). */
  private pendingEdit: EditTarget | null = null;
  private inserting = false;
  private readonly resizes: ResizeObserver;

  constructor(
    readonly wrap: HTMLElement,
    private readonly view: EditorView,
    private source: string,
    id: number,
  ) {
    this.parsed = parseTable(source);
    this.render();
    this.resizes = new ResizeObserver(([entry]) => {
      const height = entry.borderBoxSize[0]?.blockSize;
      if (height) renderedHeights.set(id, height);
    });
    this.resizes.observe(wrap);
    wrap.addEventListener("mousedown", (event) => this.onMouseDown(event));
    wrap.addEventListener("input", () => this.onInput());
    wrap.addEventListener("keydown", (event) => this.onKeyDown(event));
    wrap.addEventListener("beforeinput", (event) => this.onBeforeInput(event));
    wrap.addEventListener("paste", (event) => this.onPaste(event));
    wrap.addEventListener("focusout", (event) => {
      if (this.editing !== null && event.target === this.editing.cell) this.finishEdit();
    });
  }

  dispose(): void {
    this.resizes.disconnect();
  }

  private render(): void {
    const table = document.createElement("table");
    table.className = "cm-lm-table";
    const head = table.appendChild(document.createElement("thead"));
    const body = table.appendChild(document.createElement("tbody"));
    this.parsed.rows.forEach((cells, row) => {
      const tr = (row === 0 ? head : body).appendChild(document.createElement("tr"));
      cells.forEach((cell, col) => {
        const td = tr.appendChild(document.createElement(row === 0 ? "th" : "td"));
        td.dataset.row = String(row);
        td.dataset.col = String(col);
        const align = this.parsed.alignments[col];
        if (align) td.style.textAlign = align;
        renderInline(cell.text, td);
      });
    });
    this.wrap.replaceChildren(table);
  }

  private cellElement(row: number, col: number): HTMLElement | null {
    return this.wrap.querySelector<HTMLElement>(`[data-row="${row}"][data-col="${col}"]`);
  }

  /** Takes a new table source: re-renders changed cells, never the one being edited. */
  update(source: string): void {
    this.source = source;
    const next = parseTable(source);
    const sameShape =
      next.rows.length === this.parsed.rows.length &&
      next.rows.every((cells, row) => cells.length === this.parsed.rows[row].length);
    if (!sameShape || this.pendingEdit !== null) {
      const edit = this.editing;
      const target =
        this.pendingEdit ??
        (edit === null ? null : { row: edit.row, col: edit.col, caret: this.caretOffset(edit.cell) });
      this.editing = null;
      this.pendingEdit = null;
      this.parsed = next;
      this.render();
      // CodeMirror is mid-update here and restores its own selection afterwards; focus the cell after it.
      if (target !== null) requestAnimationFrame(() => this.startEdit(target));
      return;
    }
    const previous = this.parsed;
    this.parsed = next;
    next.rows.forEach((cells, row) =>
      cells.forEach((cell, col) => {
        if (this.editing?.row === row && this.editing.col === col) return;
        if (cell.text === previous.rows[row][col].text) return;
        const td = this.cellElement(row, col);
        if (td === null) return;
        td.replaceChildren();
        renderInline(cell.text, td);
      }),
    );
  }

  private caretOffset(cell: HTMLElement): number {
    const selection = window.getSelection();
    if (selection === null || selection.rangeCount === 0 || !cell.contains(selection.anchorNode)) {
      return cell.textContent?.length ?? 0;
    }
    const range = document.createRange();
    range.setStart(cell, 0);
    range.setEnd(selection.anchorNode as Node, selection.anchorOffset);
    return range.toString().length;
  }

  private startEdit({ row, col, caret }: EditTarget): void {
    this.finishEdit();
    const cell = this.parsed.rows[row]?.[col];
    const td = this.cellElement(row, col);
    if (cell === undefined || td === null) return;
    this.editing = { cell: td, row, col, start: cell.offset, length: cell.text.length };
    // The editor's own selection follows the cell: CodeMirror keeps the selection's
    // surroundings mounted, so the table (and this field) is never unmounted mid-edit.
    this.view.dispatch({ selection: { anchor: this.view.posAtDOM(this.wrap) + cell.offset } });
    td.textContent = cell.text;
    td.contentEditable = "plaintext-only";
    td.spellcheck = true;
    td.classList.add("cm-lm-cell-editing");
    td.focus({ preventScroll: true });
    const text = td.firstChild;
    const selection = window.getSelection();
    if (selection !== null) {
      const at = Math.min(caret, cell.text.length);
      selection.setBaseAndExtent(text ?? td, text ? at : 0, text ?? td, text ? at : 0);
    }
  }

  private finishEdit(): void {
    const edit = this.editing;
    if (edit === null) return;
    this.editing = null;
    const td = edit.cell;
    td.removeAttribute("contenteditable");
    td.classList.remove("cm-lm-cell-editing");
    td.replaceChildren();
    renderInline(this.parsed.rows[edit.row]?.[edit.col]?.text ?? "", td);
  }

  private onMouseDown(event: MouseEvent): void {
    if (!(event.target instanceof Element)) return;
    if (this.editing !== null && this.editing.cell.contains(event.target)) return; // caret moves natively
    if (event.target.closest("a") !== null && (event.metaKey || event.ctrlKey)) return; // the link opens
    const td = event.target.closest<HTMLElement>("[data-row]");
    event.preventDefault();
    if (td === null) return;
    const row = Number(td.dataset.row);
    const col = Number(td.dataset.col);
    const text = this.parsed.rows[row]?.[col]?.text ?? "";
    this.startEdit({ row, col, caret: clickOffsetInCell(td, text, event.clientX, event.clientY) });
  }

  /** Writes the field's text over exactly the source range it owns. */
  private onInput(): void {
    const edit = this.editing;
    if (edit === null) return;
    const text = edit.cell.textContent ?? "";
    const from = this.view.posAtDOM(this.wrap) + edit.start;
    const to = from + edit.length;
    edit.length = text.length;
    this.view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
      userEvent: "input.type",
    });
  }

  private insert(text: string): void {
    this.inserting = true;
    document.execCommand("insertText", false, text);
    this.inserting = false;
  }

  private onBeforeInput(event: InputEvent): void {
    if (this.inserting || this.editing === null) return;
    if (event.inputType === "insertParagraph" || event.inputType === "insertLineBreak") {
      event.preventDefault();
    } else if (event.inputType === "insertText" && event.data?.includes("|")) {
      event.preventDefault();
      this.insert(event.data.replace(/\|/g, "\\|"));
    }
  }

  private onPaste(event: ClipboardEvent): void {
    if (this.editing === null) return;
    event.preventDefault();
    const text = event.clipboardData?.getData("text/plain") ?? "";
    this.insert(text.replace(/\r?\n/g, "<br>").replace(/(?<!\\)\|/g, "\\|"));
  }

  private onKeyDown(event: KeyboardEvent): void {
    const edit = this.editing;
    if (edit === null) return;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod && key === "s") {
      event.preventDefault();
      runScopeHandlers(this.view, event, "editor");
    } else if (mod && (key === "z" || key === "y")) {
      // Undo is the editor's: leave the field so the cell re-renders from the result.
      event.preventDefault();
      this.finishEdit();
      runScopeHandlers(this.view, event, "editor");
    } else if (event.key === "Escape") {
      event.preventDefault();
      this.finishEdit();
    } else if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      this.insert("<br>");
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (edit.row + 1 < this.parsed.rows.length) this.startEdit({ row: edit.row + 1, col: edit.col, caret: Infinity });
      else this.finishEdit();
    } else if (event.key === "Tab") {
      event.preventDefault();
      this.moveHorizontally(edit, event.shiftKey ? -1 : 1);
    }
  }

  private moveHorizontally(edit: ActiveEdit, step: 1 | -1): void {
    const rows = this.parsed.rows;
    let { row, col } = edit;
    col += step;
    if (col < 0) {
      row -= 1;
      col = (rows[row]?.length ?? 1) - 1;
    } else if (col >= rows[row].length) {
      row += 1;
      col = 0;
    }
    if (row < 0) return;
    if (row < rows.length) {
      this.startEdit({ row, col, caret: Infinity });
      return;
    }
    // Tab past the last cell: append an empty row shaped like the header, edit its first cell.
    this.finishEdit();
    this.pendingEdit = { row, col: 0, caret: 0 };
    // The field's range is mapped through every edit, even while the widget's source lags a parse.
    const start = this.view.posAtDOM(this.wrap);
    let end = start + this.source.length;
    this.view.state.field(tables).between(start, start, (from, to) => {
      if (from === start) end = to;
    });
    this.view.dispatch({
      changes: { from: end, insert: `\n|${"  |".repeat(rows[0].length)}` },
      userEvent: "input.type",
    });
  }
}

const liveTables = new WeakMap<HTMLElement, LiveTable>();

let nextTableId = 0;

/**
 * `id` follows one table through edits (see `buildTables`). CodeMirror offers
 * a new widget any old table's DOM, and several tables share a header; the id
 * is what keeps a table — and the cell being edited in it — on its own DOM.
 */
class TableWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly id: number,
  ) {
    super();
  }

  eq(other: TableWidget): boolean {
    return other.id === this.id && other.source === this.source;
  }

  get estimatedHeight(): number {
    return renderedHeights.get(this.id) ?? -1;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-lm-table-wrap";
    wrap.contentEditable = "false";
    liveTables.set(wrap, new LiveTable(wrap, view, this.source, this.id));
    return wrap;
  }

  updateDOM(dom: HTMLElement, _view: EditorView, from: WidgetType): boolean {
    const live = liveTables.get(dom);
    if (live === undefined || !(from instanceof TableWidget) || from.id !== this.id) return false;
    live.update(this.source);
    return true;
  }

  destroy(dom: HTMLElement): void {
    liveTables.get(dom)?.dispose();
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/**
 * `tree` must cover the whole document: a partial tree can end a table early
 * and re-render it without its last rows. `previous` is the last decoration
 * set mapped onto `state`; a table that starts where one did keeps its id.
 */
function buildTables(state: EditorState, tree: Tree, previous: DecorationSet = Decoration.none): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  tree.iterate({
    enter(node) {
      if (node.name !== "Table") {
        // Tables only live in the document, list items, and quotes.
        return node.name === "Document" || node.name === "BulletList" || node.name === "OrderedList" ||
          node.name === "ListItem" || node.name === "Blockquote";
      }
      const from = state.doc.lineAt(node.from).from;
      const to = state.doc.lineAt(node.to).to;
      let id = -1;
      previous.between(from, from, (start, _end, decoration) => {
        if (start === from && decoration.spec.widget instanceof TableWidget) id = decoration.spec.widget.id;
      });
      const widget = new TableWidget(state.doc.sliceString(from, to), id === -1 ? nextTableId++ : id);
      decorations.push(Decoration.replace({ widget, block: true }).range(from, to));
      return false;
    },
  });
  return Decoration.set(decorations);
}

/** 50 ms bounds a full parse of a large file; incremental re-parses after an edit are far faster. */
const PARSE_BUDGET_MS = 50;

export const tables = StateField.define<DecorationSet>({
  create: (state) => buildTables(state, ensureSyntaxTree(state, state.doc.length, PARSE_BUDGET_MS) ?? syntaxTree(state)),
  update(value, transaction) {
    // A background parse that reached more of the document can reveal more tables.
    if (!transaction.docChanged && syntaxTree(transaction.startState) === syntaxTree(transaction.state)) return value;
    const mapped = value.map(transaction.changes);
    const tree = ensureSyntaxTree(transaction.state, transaction.state.doc.length, PARSE_BUDGET_MS);
    // Not parsed to the end yet: keep the mapped tables; the finished parse lands as its own update.
    if (tree === null) return mapped;
    return buildTables(transaction.state, tree, mapped);
  },
  provide: (field) => EditorView.decorations.from(field),
});
