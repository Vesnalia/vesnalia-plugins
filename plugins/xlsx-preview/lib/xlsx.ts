// Minimal .xlsx reader: zip via DecompressionStream, XML via DOMParser.
// ponytail: values only (no formulas, styles beyond dates); add a library if fidelity matters.

export interface Sheet {
  name: string;
  rows: string[][]; // dense grid, "" for empty cells
  merges: { r: number; c: number; rows: number; cols: number }[];
  totalRows: number;
  totalCols: number;
}

async function unzip(buf: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a zip file (is this an old binary .xls?)");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  if (p === 0xffffffff) throw new Error("ZIP64 workbooks are not supported");
  const out = new Map<string, Uint8Array>();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error("Corrupt zip directory");
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    // Sizes come from the central directory: local headers may hold zeros (flag bit 3).
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = buf.subarray(start, start + size);
    if (method === 0) out.set(name, data);
    else if (method === 8) {
      const stream = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      out.set(name, new Uint8Array(await new Response(stream).arrayBuffer()));
    }
  }
  return out;
}

const all = (node: ParentNode, tag: string) =>
  Array.from((node as Element).getElementsByTagNameNS("*", tag));
const first = (node: ParentNode, tag: string) => all(node, tag)[0];

function colIndex(ref: string): [number, number] {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return [-1, -1];
  let c = 0;
  for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64;
  return [Number(m[2]) - 1, c - 1];
}

export function colName(c: number): string {
  let s = "";
  for (c++; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + ((c - 1) % 26)) + s;
  return s;
}

function serialToDate(serial: number, withTime: boolean): string {
  const d = new Date(Math.round((serial - 25569) * 86400000));
  const iso = d.toISOString();
  return withTime && serial % 1 !== 0 ? iso.slice(0, 19).replace("T", " ") : iso.slice(0, 10);
}

export async function parseXlsx(
  bytes: Uint8Array,
  limits = { rows: 1000, cols: 100 },
): Promise<Sheet[]> {
  const files = await unzip(bytes);
  const dec = new TextDecoder();
  const xml = (path: string) => {
    const f = files.get(path);
    return f ? new DOMParser().parseFromString(dec.decode(f), "application/xml") : null;
  };

  const shared = (() => {
    const doc = xml("xl/sharedStrings.xml");
    if (!doc) return [];
    // Rich text: concatenate runs' <t>, skipping phonetic <rPh> hints.
    return all(doc, "si").map((si) =>
      all(si, "t").filter((t) => (t.parentElement?.localName ?? "") !== "rPh").map((t) => t.textContent ?? "").join(""),
    );
  })();

  // Which style indexes are dates: built-in formats 14–22 plus custom ones with y/m/d.
  const dateStyles = new Set<number>();
  const styles = xml("xl/styles.xml");
  if (styles) {
    const custom = new Map(all(styles, "numFmt").map((f) => [Number(f.getAttribute("numFmtId")), f.getAttribute("formatCode") ?? ""]));
    const xfs = first(styles, "cellXfs");
    if (xfs) all(xfs, "xf").forEach((xf, i) => {
      const id = Number(xf.getAttribute("numFmtId"));
      const code = (custom.get(id) ?? "").replace(/"[^"]*"|\[[^\]]*\]/g, "");
      if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47) || /[ymd]/i.test(code)) dateStyles.add(i);
    });
  }

  const workbook = xml("xl/workbook.xml");
  if (!workbook) throw new Error("Missing xl/workbook.xml");
  const rels = new Map(
    all(xml("xl/_rels/workbook.xml.rels") ?? workbook, "Relationship").map((r) => [r.getAttribute("Id"), r.getAttribute("Target") ?? ""]),
  );

  return all(workbook, "sheet").map((s) => {
    const rid = s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ?? s.getAttribute("r:id");
    const target = rels.get(rid) ?? "";
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    const doc = xml(path);
    const grid: string[][] = [];
    let totalRows = 0, totalCols = 0;
    if (doc) for (const row of all(doc, "row")) {
      for (const c of all(row, "c")) {
        const [r, col] = colIndex(c.getAttribute("r") ?? "");
        if (r < 0) continue;
        totalRows = Math.max(totalRows, r + 1);
        totalCols = Math.max(totalCols, col + 1);
        if (r >= limits.rows || col >= limits.cols) continue;
        const v = first(c, "v")?.textContent ?? "";
        const t = c.getAttribute("t");
        let text: string;
        if (t === "s") text = shared[Number(v)] ?? "";
        else if (t === "inlineStr") text = all(first(c, "is") ?? c, "t").map((x) => x.textContent ?? "").join("");
        else if (t === "b") text = v === "1" ? "TRUE" : "FALSE";
        else if (t === "str" || t === "e" || v === "") text = v;
        else {
          const style = Number(c.getAttribute("s") ?? -1);
          text = dateStyles.has(style) ? serialToDate(Number(v), true) : v;
        }
        (grid[r] ??= [])[col] = text;
      }
    }
    const rows = Math.min(totalRows, limits.rows), cols = Math.min(totalCols, limits.cols);
    const dense = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => grid[r]?.[c] ?? ""));
    const merges = doc ? all(doc, "mergeCell").flatMap((m) => {
      const [a, b] = (m.getAttribute("ref") ?? "").split(":");
      const [r1, c1] = colIndex(a ?? ""), [r2, c2] = colIndex(b ?? "");
      return r1 < 0 || r2 < 0 ? [] : [{ r: r1, c: c1, rows: r2 - r1 + 1, cols: c2 - c1 + 1 }];
    }) : [];
    return { name: s.getAttribute("name") ?? "Sheet", rows: dense, merges, totalRows, totalCols };
  });
}
