// Self-check for the parser: `node lib/xlsx.check.ts ../sample.xlsx`
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { DOMParser } from "@xmldom/xmldom";
(globalThis as any).DOMParser = DOMParser;
const { parseXlsx } = await import("./xlsx.ts");

const sheets = await parseXlsx(new Uint8Array(readFileSync(process.argv[2]!)));
const [sales, notes] = sheets;
assert.deepEqual(sheets.map((s) => s.name), ["Sales", "Notes"]);
assert.deepEqual(sales!.rows, [
  ["Merged header", "", "", "", ""],
  ["Region", "Total sales", "Date", "", ""],
  ["", "", "", "", ""],
  ["North", "1234.5", "", "2023-07-16", "TRUE"],
]);
assert.deepEqual(sales!.merges, [{ r: 0, c: 0, rows: 1, cols: 3 }]);
assert.deepEqual(notes!.rows, [["", "hello"]]);
const capped = (await parseXlsx(new Uint8Array(readFileSync(process.argv[2]!)), { rows: 2, cols: 2 }))[0]!;
assert.equal(capped.rows.length, 2);
assert.equal(capped.totalRows, 4);
console.log("xlsx parser OK");
