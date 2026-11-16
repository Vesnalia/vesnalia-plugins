import assert from "node:assert/strict";
import { test } from "node:test";
import { group, parseName, type FileEntry } from "../lib/versions.ts";

const file = (name: string, mtime = 1): FileEntry => ({ path: `/p/${name}`, name, mtime, size: 1, version: parseName(name).version });

test("reads versions in the names people actually use", () => {
  assert.equal(parseName("Acme_Platform_Board_v5.pptx").version, 5);
  assert.equal(parseName("Roadmap 2027 v29.xlsx").version, 29);
  assert.equal(parseName("Обзор рынка — Июнь 2026 v5.pptx").version, 5);
  assert.equal(parseName("deck-v2.1.pdf").version, 2);
  assert.equal(parseName("Revenue.docx").version, null);
  assert.equal(parseName("mov2.docx").version, null);
});

test("versions, drafts, dates and copies of one document share a key", () => {
  const key = parseName("Бюджет.xlsx").key;
  for (const name of ["Бюджет_v2.xlsx", "Бюджет v3 финал.xlsx", "Бюджет (1).xlsx", "Бюджет_2026-09-28.xlsx", "бюджет_final.xlsx"]) {
    assert.equal(parseName(name).key, key, name);
  }
  assert.notEqual(parseName("Бюджет LTL.xlsx").key, key);
});

test("the highest version wins over a newer file, then the newest file", () => {
  const [g] = group("/p", [file("Deck_v3.pptx", 1), file("Deck_v2.pptx", 9), file("Deck.pptx", 5)]);
  assert.equal(g?.latest.name, "Deck_v3.pptx");
  assert.equal(g?.older.length, 2);
  const [h] = group("/p", [file("Note.docx", 1), file("Note (1).docx", 9)]);
  assert.equal(h?.latest.name, "Note (1).docx");
});

const HOUR = 60 * 60 * 1000;

test("after a sync reset every date, a numbered file beats the unnumbered original", () => {
  const [g] = group("/p", [file("BoD.pptx", 5), file("BoD_v5.pptx", 5), file("BoD_v4.pptx", 5)]);
  assert.deepEqual([g?.latest.name, g?.older[0]?.name, g?.older[1]?.name], ["BoD_v5.pptx", "BoD_v4.pptx", "BoD.pptx"]);
});

test("an unnumbered file wins only when clearly newer", () => {
  assert.equal(group("/p", [file("Deck.pptx", 3 * HOUR), file("Deck_v5.pptx", HOUR)])[0]?.latest.name, "Deck.pptx");
  assert.equal(group("/p", [file("Deck.pptx", HOUR + 5), file("Deck_v5.pptx", HOUR)])[0]?.latest.name, "Deck_v5.pptx");
});

test("copy numbers order files with equal dates", () => {
  const [g] = group("/p", [file("A (19).pptx", 5), file("A (24).pptx", 5), file("A (2).pptx", 5)]);
  assert.deepEqual([g?.latest.name, g?.older[0]?.name], ["A (24).pptx", "A (19).pptx"]);
  const [h] = group("/p", [file("B_v3.pptx", 5), file("B_v3 (1).pptx", 5), file("B_v2.pptx", 5)]);
  assert.equal(h?.latest.name, "B_v3 (1).pptx");
});

test("different formats stay separate", () => {
  assert.equal(group("/p", [file("Deck.pptx"), file("Deck.pdf")]).length, 2);
});

test("a file outside an archive folder beats a higher number inside one", () => {
  const moved = (name: string): FileEntry => ({ ...file(name), path: `/p/_старые версии/${name}` });
  const [g] = group("/p", [moved("Q4 (7).pptx"), moved("Q4_v9.pptx"), file("Q4.pptx")]);
  assert.equal(g?.latest.name, "Q4.pptx");
  assert.equal(g?.older[0]?.name, "Q4_v9.pptx");
  assert.equal(group("/p", [moved("R_v1.pptx"), moved("R_v2.pptx")])[0]?.latest.name, "R_v2.pptx");
});
