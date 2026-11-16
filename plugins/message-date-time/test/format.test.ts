import assert from "node:assert/strict";
import { test } from "node:test";
import { makeFormatter } from "../lib/format.ts";

const now = new Date(2026, 9, 7, 18, 0);

test("today, yesterday and older dates in English, 12-hour", () => {
  const f = makeFormatter("en", true);
  assert.match(f.label(new Date(2026, 9, 7, 14, 5).getTime(), now), /^Today, 2:05\sPM$/);
  assert.match(f.label(new Date(2026, 9, 6, 9, 0).getTime(), now), /^Yesterday, 9:00\sAM$/);
  assert.match(f.label(new Date(2026, 9, 3, 9, 0).getTime(), now), /^Oct 3, 9:00\sAM$/);
  assert.match(f.label(new Date(2025, 11, 31, 23, 59).getTime(), now), /^Dec 31, 2025, 11:59\sPM$/);
});

test("Russian, 24-hour", () => {
  const f = makeFormatter("ru", false);
  assert.equal(f.label(new Date(2026, 9, 7, 9, 5).getTime(), now), "Сегодня, 09:05");
  assert.equal(f.label(new Date(2026, 9, 6, 22, 10).getTime(), now), "Вчера, 22:10");
  assert.equal(f.label(new Date(2026, 9, 3, 9, 15).getTime(), now), "3 окт., 09:15");
});

test("midnight boundary", () => {
  const f = makeFormatter("ru", false);
  const justAfterMidnight = new Date(2026, 9, 8, 0, 1);
  assert.equal(f.label(new Date(2026, 9, 7, 23, 59).getTime(), justAfterMidnight), "Вчера, 23:59");
});
