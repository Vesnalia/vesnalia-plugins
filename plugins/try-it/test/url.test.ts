import assert from "node:assert/strict";
import { test } from "node:test";
import { summarize, urlProblem } from "../lib/url.ts";

test("public links pass, addresses a phone cannot reach do not", () => {
  assert.equal(urlProblem("https://me.getbb.app/x"), null);
  assert.equal(urlProblem("http://172.32.0.1/"), null);
  for (const bad of ["http://localhost:3000", "http://127.0.0.1:4173/a", "http://192.168.1.5", "http://10.0.0.2", "http://172.16.0.1", "http://[::1]:80", "file:///tmp/a", "nope"]) {
    assert.notEqual(urlProblem(bad), null, bad);
  }
});

test("the summary leads with problems and keeps the note", () => {
  const text = summarize({ results: [{ check: "Login", result: "fail" }, { check: "Share", result: "pass" }], note: " button is grey " });
  assert.match(text, /^Tester found 1 problem/);
  assert.match(text, /FAIL: Login/);
  assert.match(text, /note: button is grey$/);
  assert.match(summarize({ results: [{ check: "A", result: "skip" }], note: "" }), /no problems/);
});
