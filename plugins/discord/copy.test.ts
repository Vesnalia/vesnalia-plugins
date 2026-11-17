import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), "utf8");

const readme = read("./README.md");
const packageJson = JSON.parse(read("./package.json")) as {
  description: string;
  alia: { description: string };
};

test("README leads from install through token setup and pairing in order", () => {
  const install = readme.indexOf("## Install");
  const createBot = readme.indexOf("### 1. Create a Discord bot");
  const addToken = readme.indexOf("### 2. Add the token in VesnALIA");
  const pairBot = readme.indexOf("### 3. Invite and pair the bot");

  assert.ok(install >= 0 && install < createBot);
  assert.ok(createBot < addToken && addToken < pairBot);
  assert.match(readme, /alia plugin install git:https:\/\/github\.com\/MayankBansal12\/alia-plugin-discord\.git@main/);
  assert.match(readme, /Settings → Extensions → Plugins → Discord/);
  assert.match(readme, /<@123456789012345678> pair ABC-123/);
});

test("public copy uses the VesnALIA wordmark and includes the demo media", () => {
  assert.doesNotMatch(readme, /\bALIA\b/);
  assert.match(readme, /## Demo/);
  for (const image of [
    "test-run-discord.png",
    "alia-bot-pair.png",
    "discord-settings.png",
  ]) {
    assert.match(readme, new RegExp(`docs/images/${image.replace(".", "\\.")}`));
    assert.ok(existsSync(new URL(`./docs/images/${image}`, import.meta.url)));
  }
  assert.equal(packageJson.description, packageJson.alia.description);
  assert.match(packageJson.description, /\aliab\b/);
  assert.doesNotMatch(packageJson.description, /\bALIA\b/);
});
