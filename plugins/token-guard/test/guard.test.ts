import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { detect, rejectionMessage } from "../lib/detect.ts";
import { scan, scanFile } from "../lib/scan.ts";
import { scanAttachments } from "../lib/attachments.ts";

// Built at run time so the repository holds nothing that looks like a key.
const supabase = "sbp_" + "a1".repeat(20);
const telegram = "8123456789:AA" + "b".repeat(33);
const github = "ghp_" + "c".repeat(36);

test("scans uploaded UTF-8 files without exposing values and skips binary files", async () => {
  const files: Record<string, Uint8Array> = {
    "uploads/config.txt": new TextEncoder().encode(`key=${supabase}`),
    "uploads/image.bin": new Uint8Array([0, 1, 2]),
    "uploads/clean.txt": new TextEncoder().encode("ordinary text"),
  };
  const reads: string[] = [];
  const findings = await scanAttachments([
    { type: "localFile", path: "uploads/image.bin" },
    { type: "localFile", path: "uploads/clean.txt" },
    { type: "localFile", path: "uploads/clean.txt" },
    { type: "localFile", path: "/remote/file" },
    { type: "localImage", path: "uploads/image.png" },
    { type: "localFile", path: "uploads/config.txt" },
  ], async (path) => { reads.push(path); return files[path]!; });
  assert.deepEqual(reads, ["uploads/image.bin", "uploads/clean.txt", "uploads/config.txt"]);
  assert.deepEqual(findings.map((f) => f.kind), ["Supabase access token"]);
  assert.ok(!JSON.stringify(findings).includes(supabase));
});

test("detects credentials in UTF-16 files with either byte order", async () => {
  for (const bigEndian of [false, true]) {
    const bytes = Buffer.from(`\ufeffkey=${github}`, "utf16le");
    if (bigEndian) bytes.swap16();
    const findings = await scanAttachments([{ type: "localFile", path: "uploads/config.txt" }], async () => bytes);
    assert.deepEqual(findings.map((f) => f.kind), ["GitHub token"]);
  }
});

test("clean UTF-8 and binary attachments pass", async () => {
  for (const bytes of [new TextEncoder().encode("обычный текст"), new Uint8Array([0, 1, 2]), new Uint8Array([0xff, 0x80])]) {
    assert.deepEqual(await scanAttachments([{ type: "localFile", path: "uploads/file" }], async () => bytes), []);
  }
});

test("an unreadable uploaded file fails the check", async () => {
  await assert.rejects(scanAttachments([{ type: "localFile", path: "uploads/missing.txt" }], async () => {
    throw new Error("read failed");
  }));
});

test("detects each format and never returns the value", () => {
  const findings = detect(`one ${supabase} two ${telegram} three ${github}`);
  assert.deepEqual(findings.map((f) => f.kind), ["Supabase access token", "Telegram bot token", "GitHub token"]);
  const dump = JSON.stringify(findings);
  for (const value of [supabase, telegram, github]) assert.ok(!dump.includes(value));
});

test("the same value has the same fingerprint, another value does not", () => {
  const [a, b, c] = detect(`${supabase} ${supabase} sbp_${"d2".repeat(20)}`);
  assert.equal(a?.fingerprint, b?.fingerprint);
  assert.notEqual(a?.fingerprint, c?.fingerprint);
});

test("leaves ordinary text and documentation samples alone", () => {
  for (const text of [
    "git commit abc123 sha256:0123456789abcdef0123456789abcdef",
    "sk-learn and sb_secret and sbp_short",
    "AKIAIOSFODNN7EXAMPLE",
    "12:30 время 8123456789:notatoken",
    "use a key like ghp_xxxxxxxx",
    "chat-id 8123456789",
  ]) {
    assert.deepEqual(detect(text), [], text);
  }
});

test("the rejection message follows the language and omits the value", () => {
  const findings = detect(supabase);
  assert.match(rejectionMessage(`вот ключ ${supabase}`, findings), /не отправлено/);
  const english = rejectionMessage(`here ${supabase}`, findings);
  assert.match(english, /not sent/);
  assert.ok(!english.includes(supabase));
});

test("a token split across a chunk boundary is counted once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tg-"));
  const path = join(dir, "big.jsonl");
  const before = "x".repeat((1 << 20) - 10);
  writeFileSync(path, `${before}${supabase}\n${"y".repeat(1 << 20)}${supabase}\n`);
  let count = 0;
  await scanFile(path, () => { count += 1; });
  assert.equal(count, 2);
});

test("a scan groups by token and its report holds no value", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tg-"));
  writeFileSync(join(dir, "a.jsonl"), `${supabase} ${supabase}\n`);
  writeFileSync(join(dir, "b.jsonl"), `${supabase} ${telegram}\n`);
  const report = await scan([{ label: "Test", path: dir }, { label: "Missing", path: join(dir, "nope") }]);
  assert.equal(report.filesScanned, 2);
  const row = report.rows.find((r) => r.kind === "Supabase access token");
  assert.equal(row?.occurrences, 3);
  assert.equal(row?.files, 2);
  assert.equal(report.rows.length, 2);
  const dump = JSON.stringify(report);
  assert.ok(!dump.includes(supabase) && !dump.includes(telegram));
});
