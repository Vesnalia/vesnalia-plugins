import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakePorts } from "./fake-ports";
import { CANCEL_EXCLUDE, cancelSnapshot, findSecrets } from "./snapshot";
import { redact, secretFileName, secretFindings, syntheticValue } from "./secrets";
import { BEARER, GITHUB_OAUTH, GITHUB_TOKEN as GITHUB, JWT, OPENAI_KEY as OPENAI, PEM_KEY, pemHeader, SLACK_TOKEN as SLACK } from "./test-tokens";

// Values that must be found are assembled at run time (test-tokens.ts); written-out ones here are synthetic on purpose: FAKE, zeros, `f`×64.
const HEX64 = "f".repeat(64);
const GH_OAUTH = GITHUB_OAUTH;
const GITHUB_PAT = `github_pat_${"FAKE".repeat(6)}_${"0".repeat(20)}`;
const AWS = "AKIAFAKEFAKEFAKEFAKE";
const PEM = PEM_KEY;

describe("CANCEL_EXCLUDE and the file-name rule", () => {
  it("lists what never goes into the snapshot commit, whatever .gitignore says: the base folders and the key-file names", () => {
    expect(CANCEL_EXCLUDE).toEqual(["node_modules/", "dist/", ".superpowers/", ".env*", "*.env", "*.pem", "*.key", "id_rsa*", "id_dsa*", "id_ecdsa*", "id_ed25519*", "secrets/"]);
  });
  it("secretFileName is the same rule at any depth: .env*, *.env, *.pem, *.key, SSH keys, secrets/", () => {
    for (const p of [".env", "a/.env.local", "keys.env", "x/y/prod.env", "id.pem", "deep/server.key", "id_rsa", "home/.ssh/id_ed25519", "id_rsa.pub", "secrets/db.txt", "a b/secrets/c d"])
      expect(secretFileName(p)).toBe(true);
    for (const p of ["src/env.ts", ".env-files/x.ts", "envs/e.ts", "pem.txt", "keys.ts", "my-secrets/s.ts", "notes.keys", "secrets.md", "id_rsa_helper/x.ts"])
      expect(secretFileName(p)).toBe(false);
  });
});

describe("findSecrets", () => {
  it("commit SHAs and bare Bearer are not secrets", () => {
    expect(findSecrets("commit 539fea4c1d2e3f40516273849506172839405162 and `Authorization: Bearer ${token}`")).toEqual([]);
  });
  it("secrets are found", () => {
    expect(findSecrets(`OPENAI=${OPENAI}`)).toEqual(["sk-"]);
    expect(findSecrets(BEARER)).toEqual(["Bearer"]);
    expect(findSecrets(HEX64)).toEqual(["hex64"]);
  });
  it("finds the GitHub, Slack and JWT tokens", () => {
    expect(findSecrets(`GITHUB_TOKEN=${GITHUB}`)).toEqual(["ghp_", "gh_token"]);
    expect(findSecrets(`SLACK_BOT_TOKEN="${SLACK}"`)).toEqual(["xoxb-"]);
    expect(findSecrets(`{"jwt":"${JWT}"}`)).toEqual(["jwt"]);
  });
  it("finds GitHub OAuth and fine-grained tokens, AWS access keys and private key blocks", () => {
    expect(findSecrets(`GH_TOKEN=${GH_OAUTH}`)).toEqual(["gh_token"]);
    for (const p of ["ghs_", "ghu_"]) expect(findSecrets(`${p}${"FAKE".repeat(5)}`)).toEqual(["gh_token"]);
    expect(findSecrets(`token: ${GITHUB_PAT}`)).toEqual(["github_pat"]);
    expect(findSecrets(`aws_access_key_id = ${AWS}`)).toEqual(["aws_key"]);
    expect(findSecrets(PEM)).toEqual(["private_key"]);
    expect(findSecrets(pemHeader("RSA "))).toEqual(["private_key"]);
    expect(findSecrets(pemHeader(""))).toEqual(["private_key"]);
    expect(findSecrets(`${pemHeader("PGP ", true)}\nZmFrZQ==`)).toEqual(["private_key"]);
    expect(findSecrets("-----BEGIN PGP PUBLIC KEY BLOCK-----")).toEqual([]);
  });
  it("the new prefixes need their tails and a word start: short or embedded ones are not secrets", () => {
    expect(findSecrets(`gho_${"F".repeat(19)} xgho_${"FAKE".repeat(9)} github_pat_short AKIAFAKE akia${"F".repeat(16)} XAKIAFAKEFAKEFAKEFAKE`)).toEqual([]);
    expect(findSecrets("-----BEGIN PUBLIC KEY-----\n-----BEGIN CERTIFICATE-----")).toEqual([]);
  });
  it("hex of 64 or more characters, in either case; 63 is not enough", () => {
    expect(findSecrets(`key=${"AbCdEf0123456789".repeat(5)}`)).toEqual(["hex64"]);
    expect(findSecrets("f".repeat(63))).toEqual([]);
  });
  it("Bearer needs a token of at least 20 characters", () => {
    const bearer = (n: number) => `${"Bea"}rer ${"Q7f2Lm9xVt4Rk8Wn3Jp6Yd1Hc5".slice(0, n)}`;
    expect(findSecrets(bearer(19))).toEqual([]);
    expect(findSecrets(bearer(20))).toEqual(["Bearer"]);
    expect(findSecrets("Authorization: Bearer <token>")).toEqual([]);
  });
  it("ordinary words that merely contain the prefixes are not secrets", () => {
    expect(findSecrets("task-list disk-usage risk-based desk-top; sk-short")).toEqual([]);
    expect(findSecrets("const keyJson = parse(a).b.c;")).toEqual([]);
    // long words with «sk-» inside: the tail after it is longer than 20 characters, but the word does not start with it
    expect(findSecrets("see task-list-of-everything-we-need-to-do and disk-usage-report-for-the-whole-server")).toEqual([]);
    expect(findSecrets("fileKeyJson.alpha.beta")).toEqual([]);
  });
  it("a JWT is three base64url segments, not any text between two dots", () => {
    expect(findSecrets("eyJ header. payload.sig")).toEqual([]);
  });
  it("reports each kind once, in a fixed order, and never the secret itself", () => {
    const found = findSecrets(`${HEX64}\n${OPENAI} and again ${OPENAI}\n${BEARER}\n${JWT}`);
    expect(found).toEqual(["sk-", "Bearer", "jwt", "hex64"]);
    expect(JSON.stringify(found)).not.toContain("abcdefghijklmnop");
  });
  it("repeated calls give the same answer", () => {
    for (let i = 0; i < 3; i++) expect(findSecrets(OPENAI)).toEqual(["sk-"]);
  });
});

describe("secretFindings: what counts for publication and snapshots", () => {
  it("finds real-looking values of every kind, each label once, never the value", () => {
    const found = secretFindings([OPENAI, GITHUB, SLACK, JWT, BEARER, PEM].join("\n"));
    expect(found).toEqual(["sk-", "ghp_", "gh_token", "xoxb-", "Bearer", "jwt", "private_key"]);
    expect(JSON.stringify(found)).not.toContain(OPENAI.slice(3));
  });
  it("ignores demonstrably synthetic values: FAKE / EXAMPLE / DUMMY / PLACEHOLDER / REDACTED / XXXX, or at most four distinct characters", () => {
    for (const v of [`ghp_${"FAKE".repeat(9)}`, "AKIAFAKEFAKEFAKEFAKE", "sk-EXAMPLEexampleEXAMPLE1234", "sk-dummy-dummy-dummy-dummy", "sk-placeholder-value-0000", "Bearer REDACTEDREDACTEDREDACTED", "Bearer xxxx-xxxx-xxxx-xxxx-xxxx", `sk-${"0".repeat(32)}`, `ghp_${"ab".repeat(15)}`])
      expect(secretFindings(v)).toEqual([]);
    expect(syntheticValue("sk-abcd", "abcdabcd")).toBe(true);
    expect(syntheticValue(OPENAI, OPENAI.slice(3))).toBe(false);
  });
  it("a synthetic value next to a real one does not hide it", () => {
    expect(secretFindings(`ghp_${"FAKE".repeat(9)} and ${GITHUB}`)).toEqual(["ghp_", "gh_token"]);
  });
  it("64 hex characters (hashes) are not counted; the raw detector still sees them", () => {
    expect(secretFindings("Q7f2Lm9x".repeat(8).replace(/[^0-9a-f]/gi, "a"))).toEqual([]);
    expect(secretFindings("0123456789abcdef".repeat(4))).toEqual([]);
    expect(findSecrets("0123456789abcdef".repeat(4))).toEqual(["hex64"]);
  });
  it("a private key header is never synthetic by the distinct-characters rule", () => {
    expect(secretFindings(pemHeader("RSA "))).toEqual(["private_key"]);
    expect(secretFindings(pemHeader("EC "))).toEqual(["private_key"]);
  });
});

describe("redact", () => {
  it("replaces every match with its label, synthetic ones and hashes included; text around stays", () => {
    expect(redact(`npm ERR! token ${OPENAI} rejected`)).toBe("npm ERR! token [redacted:sk-] rejected");
    expect(redact(`Authorization: ${BEARER}`)).toBe("Authorization: [redacted:Bearer]");
    expect(redact(`x ghp_${"FAKE".repeat(9)} y`)).toBe("x [redacted:ghp_] y");
    expect(redact(`sha256 ${HEX64}`)).toBe("sha256 [redacted:hex64]");
    expect(redact("commit 539fea4c1d2e3f40516273849506172839405162, task-list")).toBe("commit 539fea4c1d2e3f40516273849506172839405162, task-list");
    expect(redact(null)).toBeNull();
  });
  it("a private key is redacted with its body, also when the END line was cut off", () => {
    const out = redact(`before\n${PEM}\nafter`);
    expect(out).toBe("before\n[redacted:private_key]\nafter");
    expect(redact(`x ${pemHeader("RSA ")}\nMIIBVQIBADANq9Lm2Vx7`)).toBe("x [redacted:private_key]");
  });
  it("is idempotent and finds nothing left to report", () => {
    const once = redact([OPENAI, GITHUB, SLACK, JWT, BEARER, PEM].join(" "));
    expect(redact(once)).toBe(once);
    expect(secretFindings(once)).toEqual([]);
  });
});

const KEY = "TEST-12";
const REF = `refs/workshop/${KEY}/canceled`;
const w = { id: "w1", task_key: KEY, environment_id: "env_1", worktreeDir: "/wt/bb120", pluginDir: "/plugins/alia-plugin-hello" };
let ports: FakePorts;

/** The work's working tree: git files and their content in the VesnALIA worktree. */
function tree(files: Record<string, string>, staged = "") {
  ports.git.setRepo(w.worktreeDir, { files: Object.keys(files), stagedDiff: staged });
  for (const [rel, text] of Object.entries(files)) ports.files.set(`${w.environment_id}:${rel}`, text);
}
const manifest = () => JSON.parse(ports.texts.find((t) => t.relPath === "manifest.json")!.content) as { ref: string; withheld: Array<{ path: string; labels: string[] }>; stagedPatch: string };
/** A staged diff block of a new file. */
const block = (path: string, ...lines: string[]) => `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}\n`).join("")}`;

beforeEach(() => {
  ports = new FakePorts();
  ports.git.setRepo(w.pluginDir, {});
  ports.git.setRepo(w.worktreeDir, {});
});

describe("cancelSnapshot", () => {
  it("a file with a secret is skipped from the commit and not kept anywhere — only listed, with labels, in the manifest", async () => {
    tree({ "config.ts": `export const key = "${OPENAI}";`, "src/a.ts": "export const a = 1;" });
    const r = await cancelSnapshot(ports, w);
    expect(r).toEqual({ ok: true, sha: expect.stringMatching(/^c0de/), skipped: ["config.ts"], withheld: [{ path: "config.ts", labels: ["sk-"] }], patch: "empty", nested: [] });
    expect(ports.calls.filter((c) => c.effect === "snapshotTree")).toEqual([{ effect: "snapshotTree", args: [w.worktreeDir, REF, [...CANCEL_EXCLUDE], ["config.ts"]] }]);
    expect(ports.saved).toEqual([]);
    expect([...ports.savedFiles.values()].join("\n")).not.toContain(OPENAI);
    expect(manifest()).toEqual({ ref: REF, withheld: [{ path: "config.ts", labels: ["sk-"] }], stagedPatch: "empty" });
    expect(ports.git.ref(w.pluginDir, REF)).toBe((r as { sha: string }).sha);
  });

  it("the commit comes first in the log of effects, the reference after it", async () => {
    tree({ "a.ts": "1" });
    await cancelSnapshot(ports, w);
    expect(ports.calls.map((c) => c.effect)).toEqual(["snapshotTree", "updateRef"]);
    expect(ports.calls[1]!.args).toEqual([w.pluginDir, REF, expect.stringMatching(/^c0de/)]);
  });

  it("a clean tree: nothing is skipped, nothing is withheld, nothing is copied aside; synthetic values are not findings", async () => {
    tree({ "src/a.ts": "export const a = 1;", "README.md": "commit 539fea4c1d2e3f40516273849506172839405162", "src/a.test.ts": `const t = "ghp_${"FAKE".repeat(9)}";`, "c.json": `{"hash":"${HEX64}"}` });
    const r = await cancelSnapshot(ports, w);
    expect(r).toMatchObject({ ok: true, skipped: [], withheld: [] });
    expect(ports.saved).toEqual([]);
    expect(manifest().withheld).toEqual([]);
  });

  it("key files by name are not read, not committed and not kept — they are listed by name; node_modules and .superpowers are not even listed", async () => {
    tree({
      ".env": `TOKEN=${OPENAI}`,
      ".env.local": `TOKEN=${GITHUB}`,
      "keys.env": "PASSWORD=hunter2",
      "node_modules/x/index.js": OPENAI,
      ".superpowers/sdd/report.md": BEARER,
      "certs/server.pem": JWT,
      "secrets/db.txt": SLACK,
      "home/.ssh/id_ed25519": "key",
      "src/a.ts": "ok",
    });
    const read = vi.spyOn(ports, "readRaw");
    const r = await cancelSnapshot(ports, w);
    expect(r).toMatchObject({ ok: true, skipped: [] });
    expect(read.mock.calls.map((c) => c[1])).toEqual(["src/a.ts"]);
    expect(ports.saved).toEqual([]);
    const byName = (p: string) => ({ path: p, labels: ["key file by name"] });
    expect(manifest().withheld).toEqual([byName(".env"), byName(".env.local"), byName("keys.env"), byName("certs/server.pem"), byName("secrets/db.txt"), byName("home/.ssh/id_ed25519")]);
    // They never reach the commit: CANCEL_EXCLUDE carries the same name rule (`*.env` included).
    expect(ports.calls.find((c) => c.effect === "snapshotTree")!.args[2]).toEqual([...CANCEL_EXCLUDE]);
  });

  it("snapshot labels carry the time: a later snapshot of the work sorts after them, so readSaved is not shadowed", async () => {
    tree({ "config.ts": OPENAI, "a.ts": "1" });
    ports.t = 1_700_000_000_000;
    await cancelSnapshot(ports, w);
    expect(ports.texts.map((t) => t.label)).toEqual(["1700000000000-canceled", "1700000000000-canceled"]);
    // labels without the time («canceled…») would sort before any «<time>-…» in reverse order and shadow later snapshots
    expect(["1700000000001-s5-i1", ...ports.texts.map((t) => t.label)].sort().reverse()[0]).toBe("1700000000001-s5-i1");
  });

  it("a nested repository is not scanned and not committed; its name is reported as nested", async () => {
    ports.git.setRepo(w.worktreeDir, { files: ["a.ts"], nested: ["vendor/ref"] });
    ports.files.set("env_1:a.ts", "1");
    const read = vi.spyOn(ports, "readRaw");
    const r = await cancelSnapshot(ports, w);
    expect(r).toMatchObject({ ok: true, skipped: [], nested: ["vendor/ref"] });
    expect(read.mock.calls.map((c) => c[1])).toEqual(["a.ts"]);
    expect(ports.saved).toEqual([]);
  });

  it("several files with findings are all skipped, in the order git lists them; test files are not exempt", async () => {
    tree({ "b.ts": GITHUB, "a.ts": "fine", "server.test.ts": `const k = "${SLACK}";` });
    const r = await cancelSnapshot(ports, w);
    expect(r).toMatchObject({ ok: true, skipped: ["b.ts", "server.test.ts"] });
    expect(manifest().withheld).toEqual([{ path: "b.ts", labels: ["ghp_", "gh_token"] }, { path: "server.test.ts", labels: ["xoxb-"] }]);
  });

  it("a binary file is scanned too", async () => {
    tree({ "blob.bin": "stub" });
    const bytes = Buffer.concat([Buffer.from([0, 1, 2, 255]), Buffer.from(`TOKEN=${GITHUB}`), Buffer.from([0, 9])]);
    vi.spyOn(ports, "readRaw").mockResolvedValue({ content: bytes.toString("base64"), encoding: "base64", mime: "application/octet-stream", size: bytes.length });
    expect(await cancelSnapshot(ports, w)).toMatchObject({ ok: true, skipped: ["blob.bin"] });
  });

  it("a symbolic link is committed as a link, not followed: nothing to scan", async () => {
    tree({ "link.md": "(link)", "a.ts": "1" });
    ports.symlinks.add("env_1:link.md");
    expect(await cancelSnapshot(ports, w)).toMatchObject({ ok: true, skipped: [], withheld: [] });
  });

  it("a file that vanished between the listing and the reading is not a failure", async () => {
    ports.git.setRepo(w.worktreeDir, { files: ["gone.ts", "a.ts"] });
    ports.files.set("env_1:a.ts", "1");
    expect(await cancelSnapshot(ports, w)).toMatchObject({ ok: true, skipped: [] });
  });

  it("staged diff is saved as staged.patch", async () => {
    const diff = block("a.ts", "export const a = 1;");
    tree({ "a.ts": "export const a = 1;" }, diff);
    const r = await cancelSnapshot(ports, w);
    expect(r).toMatchObject({ ok: true, patch: "saved" });
    expect(ports.texts[0]).toEqual({ workId: "w1", label: `${ports.t}-canceled`, relPath: "staged.patch", content: diff });
    expect(manifest().stagedPatch).toBe("saved");
  });

  it("staged.patch is built from non-secret paths only: a staged key file and a file with a finding stay out of it, listed", async () => {
    const ok = block("a.ts", "export const a = 1;");
    tree({ "a.ts": "export const a = 1;", "config.ts": OPENAI }, ok + block("keys.env", "PASSWORD=hunter2") + block("config.ts", OPENAI));
    const r = await cancelSnapshot(ports, w);
    expect(r).toMatchObject({ ok: true, patch: "saved", skipped: ["config.ts"] });
    expect(ports.texts[0]!.content).toBe(ok);
    expect(manifest().withheld).toEqual([{ path: "config.ts", labels: ["sk-"] }, { path: "keys.env", labels: ["key file by name"] }]);
  });

  it("a staged patch with a finding is not saved at all: the manifest says it was withheld and why (labels only)", async () => {
    // The index holds a token the working tree no longer has: only the patch can carry it.
    tree({ "a.ts": "export const a = 1;" }, block("a.ts", `export const a = "${JWT}";`));
    const r = await cancelSnapshot(ports, w);
    expect(r).toMatchObject({ ok: true, patch: "withheld", skipped: [] });
    expect(ports.texts.map((t) => t.relPath)).toEqual(["manifest.json"]);
    expect(manifest()).toMatchObject({ stagedPatch: "withheld", withheld: [{ path: "staged.patch", labels: ["a.ts (staged): jwt"] }] });
    expect(JSON.stringify(ports.texts)).not.toContain(JWT);
  });

  it("the staged blobs themselves are checked, binary included: a token staged in a binary whose worktree copy is clean withholds the patch", async () => {
    // The patch text of a binary is compressed — it shows nothing; the indexed bytes carry the token. The worktree file is clean.
    const binary = `diff --git a/blob.bin b/blob.bin\nnew file mode 100644\nGIT binary patch\nliteral 9\nzcmZQzU|?imVqj)ufB*mg\n\n`;
    tree({ "blob.bin": "clean bytes", "a.ts": "export const a = 1;" }, binary + block("a.ts", "export const a = 1;"));
    ports.git.setRepo(w.worktreeDir, { stagedBlobs: { "blob.bin": Buffer.concat([Buffer.from([0, 1, 255, 0]), Buffer.from(`k=${GITHUB}`), Buffer.from([0])]) } });
    const r = await cancelSnapshot(ports, w);
    expect(r).toMatchObject({ ok: true, patch: "withheld", skipped: [] });
    expect(manifest().withheld).toEqual([{ path: "staged.patch", labels: ["blob.bin (staged): ghp_", "blob.bin (staged): gh_token"] }]);
    expect(ports.texts.map((t) => t.relPath)).toEqual(["manifest.json"]);
  });

  it("HEAD's side of a staged change is in the patch too (a binary patch carries both sides): a finding there withholds it", async () => {
    tree({ "cfg.ts": "export const k = process.env.K;" }, block("cfg.ts", "export const k = process.env.K;"));
    ports.git.setRepo(w.worktreeDir, { stagedOld: { "cfg.ts": `export const k = "${OPENAI}";\n` } });
    expect(await cancelSnapshot(ports, w)).toMatchObject({ ok: true, patch: "withheld" });
    expect(manifest().withheld).toEqual([{ path: "staged.patch", labels: ["cfg.ts (HEAD): sk-"] }]);
  });

  it("only the paths that may go into the patch are read: key files by name and skipped files stay out of the check and the patch", async () => {
    tree({ "a.ts": "export const a = 1;", "config.ts": OPENAI }, block("a.ts", "export const a = 1;") + block("keys.env", "PASSWORD=hunter2") + block("config.ts", OPENAI));
    const read = vi.spyOn(ports.git, "readBlobs");
    expect(await cancelSnapshot(ports, w)).toMatchObject({ ok: true, patch: "saved", skipped: ["config.ts"] });
    expect(read.mock.calls.map((c) => c[1])).toEqual([[`new:${w.worktreeDir}:a.ts`]]);
  });

  it("staged content that cannot be read in full, or an index that cannot be captured, withholds the patch unchecked — the snapshot itself goes on", async () => {
    tree({ "a.ts": "export const a = 1;" }, block("a.ts", "export const a = 1;"));
    ports.git.blobsFail = "more than 64 MB";
    expect(await cancelSnapshot(ports, w)).toMatchObject({ ok: true, patch: "withheld" });
    expect(manifest().withheld).toEqual([{ path: "staged.patch", labels: ["staged content not read in full, not checked (more than 64 MB)"] }]);
    expect(ports.count("snapshotTree")).toBe(1);
    ports.git.blobsFail = null;
    ports.texts.length = 0;
    ports.git.stagedFails = "git write-tree: error building trees";
    expect(await cancelSnapshot(ports, w)).toMatchObject({ ok: true, patch: "withheld" });
    expect(manifest().withheld).toEqual([{ path: "staged.patch", labels: ["staged changes not captured, not checked (git write-tree: error building trees)"] }]);
    expect(ports.count("snapshotTree")).toBe(2);
  });

  it("nothing staged: an empty staged.patch still says it was checked", async () => {
    tree({ "a.ts": "1" });
    await cancelSnapshot(ports, w);
    expect(ports.texts[0]).toEqual({ workId: "w1", label: `${ports.t}-canceled`, relPath: "staged.patch", content: "" });
  });

  it("snapshot failure keeps the worktree", async () => {
    tree({ "config.ts": `key=${OPENAI}`, "a.ts": "1" });
    ports.failAt("snapshotTree");
    const r = await cancelSnapshot(ports, w);
    expect(r).toEqual({ ok: false, reason: expect.stringContaining("failure before snapshotTree") });
    expect(ports.count("updateRef")).toBe(0);
    expect(ports.git.ref(w.pluginDir, REF)).toBeNull();
    expect(ports.archived).toEqual([]);
  });

  it("a failure after the commit (the reference is not set) is a failure too", async () => {
    tree({ "a.ts": "1" });
    ports.failAt("updateRef");
    expect(await cancelSnapshot(ports, w)).toEqual({ ok: false, reason: expect.stringContaining("failure before updateRef") });
  });

  it("the manifest cannot be saved: no commit is made at all", async () => {
    tree({ "config.ts": OPENAI });
    ports.saveFails = true;
    const r = await cancelSnapshot(ports, w);
    expect(r).toEqual({ ok: false, reason: expect.stringContaining("disk full") });
    expect(ports.count("snapshotTree")).toBe(0);
  });

  it("staged.patch cannot be saved: no commit is made", async () => {
    tree({ "a.ts": "1" });
    ports.saveFails = true;
    expect(await cancelSnapshot(ports, w)).toMatchObject({ ok: false });
    expect(ports.count("snapshotTree")).toBe(0);
  });

  it("the worktree is gone or the machine is down: nothing is verified, so nothing is committed", async () => {
    tree({ "a.ts": "1" });
    ports.gone.add("env_1");
    expect(await cancelSnapshot(ports, w)).toEqual({ ok: false, reason: expect.stringContaining("a.ts") });
    ports.gone.delete("env_1");
    ports.machineDown = true;
    expect(await cancelSnapshot(ports, w)).toMatchObject({ ok: false });
    expect(ports.count("snapshotTree")).toBe(0);
  });

  it("no failure reason ever contains the secret", async () => {
    tree({ "config.ts": `key=${OPENAI}`, "t.txt": `${GITHUB}` });
    for (const effect of ["snapshotTree", "updateRef"]) {
      ports.failAt(effect, "before");
      const r = await cancelSnapshot(ports, w);
      expect(r.ok).toBe(false);
      if (!r.ok) for (const s of [OPENAI, GITHUB]) expect(r.reason).not.toContain(s);
    }
    ports.failAt(null);
    ports.saveFails = true;
    const r = await cancelSnapshot(ports, w);
    if (!r.ok) for (const s of [OPENAI, GITHUB]) expect(r.reason).not.toContain(s);
  });

  it("a retry after a failure makes the snapshot", async () => {
    tree({ "a.ts": "1" });
    ports.failAt("snapshotTree");
    expect((await cancelSnapshot(ports, w)).ok).toBe(false);
    ports.failAt(null);
    expect((await cancelSnapshot(ports, w)).ok).toBe(true);
  });
});
