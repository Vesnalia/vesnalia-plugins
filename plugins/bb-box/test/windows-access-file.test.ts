import "./check-test-machine.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { accessFileRewrite, envScript } from "../src/core/in-box.ts";

test("a Windows access-file rewrite is PowerShell that checks the written SHA-256", () => {
  const env = envScript("windows", {
    ALIA_BOX_ID: "bx_1",
    ALIA_BOX_NAME: "amber-fox",
    ALIA_BOX_KIND: "windows-desktop",
    ALIA_THREAD_ID: "thr_1",
  });
  const digest = createHash("sha256").update(env).digest("hex");

  const script = accessFileRewrite("windows", env);

  const check = `if ((Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $HOME '.config/alia-box/env.ps1')).Hash.ToLowerInvariant() -ne '${digest}') { exit 1 }`;
  assert.equal(script.slice(-check.length), check);
  assert.equal(script.includes("$env:ALIA_BOX_ID = ''bx_1''"), true);
});

test("a Linux access-file rewrite still checks the file with sha256sum", () => {
  const env = envScript("linux", { ALIA_BOX_ID: "bx_1" });
  const digest = createHash("sha256").update(env).digest("hex");

  const script = accessFileRewrite("linux", env);

  assert.equal(script.endsWith(`[ "$(sha256sum < "$HOME/.config/alia-box/env" | cut -d' ' -f1)" = ${digest} ]`), true);
});
