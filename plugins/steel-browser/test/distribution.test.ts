import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createFakePluginHost } from "@vesnalia/plugin-sdk/testing";
import plugin from "../server.ts";

test("declares an independent VesnALIA app, server, CLI skill, and pinned SDK", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.name, "alia-plugin-steel-browser");
  assert.equal(packageJson.alia.name, "VesnALIA Surf");
  assert.equal(packageJson.alia.server, "./server.ts");
  assert.equal(packageJson.alia.app, "./app.tsx");
  assert.deepEqual(packageJson.alia.skills, ["./skills/steel-browser"]);
  assert.equal(packageJson.devDependencies["@vesnalia/plugin-sdk"], "0.4.21");
  assert.equal(packageJson.devDependencies["alia-app"], "0.40.0");
  assert.match(packageJson.scripts.build, /^env -u ALIA_CLI /u);
  assert.ok(packageJson.files.includes("jev-runtime.ts"));
});

test("registers the public surf CLI contract", async () => {
  const host = createFakePluginHost({ pluginId: "steel-browser" });
  try {
    plugin(host.alia);
    const cli = host.harness.inspection.registrations.cli;
    assert.equal(cli?.name, "surf");
    assert.deepEqual(cli?.commands.map(({ name, usage }) => ({ name, usage })), [
      { name: "status", usage: "alia surf status" },
      { name: "sessions", usage: "alia surf sessions" },
      { name: "create", usage: "alia surf create" },
      { name: "release", usage: "alia surf release <session-id>" },
      { name: "project", usage: "alia surf project" },
      { name: "bind", usage: "alia surf bind <api-url> <cdp-url> <viewer-origin>" },
      { name: "engine", usage: "alia surf engine <playwright|jev|auto> <fallback-on|fallback-off>" },
      { name: "run", usage: "alia surf run <url> [goal] [--allow-paid]" },
      { name: "tabs", usage: "alia surf tabs" },
      { name: "inspect", usage: "alia surf inspect" },
      { name: "click", usage: "alia surf click <role> <exact-name>" },
      { name: "fill", usage: "alia surf fill <role> <exact-name> <value>" },
      { name: "press", usage: "alia surf press <key>" },
      { name: "screenshot", usage: "alia surf screenshot" },
    ]);
    const help = await host.harness.runCli(["--help"]);
    assert.equal(help.exitCode, 0);
    assert.match(help.stdout ?? "", /^alia surf status$/mu);
    assert.match(help.stdout ?? "", /^alia surf screenshot$/mu);
  } finally {
    await host.harness.dispose();
  }
});

test("contributes Steel discovery instructions to new agent sessions", async () => {
  const server = await readFile(new URL("../server.ts", import.meta.url), "utf8");
  assert.match(server, /alia\.agents\.contributeInstructions/u);
  assert.match(server, /first run `alia surf project`/u);
  assert.match(server, /Never claim Steel is unavailable/u);
  assert.match(server, /emit ::steel-browser\{\}/u);
  assert.match(server,
    /Whenever you ask the user to enter credentials, sign in, complete MFA, approve consent, or perform any other manual browser action, repeat ::steel-browser\{\} on its own line in that same assistant message; never refer to an embedded browser 'above' unless that response contains the directive/u);
  assert.match(server, /Do not launch a separate browser/u);
  assert.match(server, /automatically provisions and binds/u);
  assert.match(server, /await ensureBinding\(projectId\)/u);
  assert.match(server, /const binding = await ensureBinding\(projectId\);/u);
  assert.match(server, /async binding => \{/u);
  assert.match(server, /if \(!await bindingReady\(binding\)\) return false;/u);
  assert.match(server, /await ensureViewerShare\(projectId, binding\);/u);
  assert.match(server, /return true;/u);
  assert.match(server, /client\(scope, true\)/u);
  const allProjects = server.slice(server.indexOf("async allProjects()"), server.indexOf("async project(scope"));
  assert.match(allProjects, /projects\.binding\(project\.id\)/u);
  assert.doesNotMatch(allProjects, /ensureBinding/u);

  const css = await readFile(new URL("../app.css", import.meta.url), "utf8");
  assert.match(css, /\.steel-inline-browser--following/u);
});

test("ships the required operational and responsive UI states", async () => {
  const [app, css, skill] = await Promise.all([
    readFile(new URL("../app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app.css", import.meta.url), "utf8"),
    readFile(new URL("../skills/steel-browser/SKILL.md", import.meta.url), "utf8"),
  ]);
  assert.match(app, /No active sessions/u);
  assert.match(app, /window\.confirm/u);
  assert.match(app, /Steel is not connected/u);
  assert.match(css, /@media \(max-width: 560px\)/u);
  assert.doesNotMatch(css, /#eddb63/u);
  assert.match(css, /width: min\(100%, 560px\)/u);
  assert.match(skill, /instead of KERNEL\.SH/u);
  assert.match(skill, /Never send the user to a/u);
  assert.match(skill, /current thread is the only browser surface/u);
  assert.match(skill,
    /whenever you ask the\s+user to enter credentials, sign in, complete MFA, approve consent, or perform\s+another manual browser action,[\s\S]+line in that same assistant message:[\s\S]+::steel-browser\{\}[\s\S]+Never tell the user to use an embedded browser "above" unless this response\s+contains the directive\. Repeat the directive for later sign-in, MFA, consent,\s+or manual-action handoffs; an earlier viewer message is not sufficient\./u);
  assert.match(skill, /alia surf release/u);
});
