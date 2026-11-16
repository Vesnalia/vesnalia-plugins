import assert from "node:assert/strict";
import { assertSkillName, skillMarkdown } from "./create-skill.ts";

function expectThrow(fn: () => void, messageIncludes: string) {
  try {
    fn();
    assert.fail("expected throw");
  } catch (err) {
    assert.match(String(err), new RegExp(messageIncludes));
  }
}

expectThrow(() => assertSkillName(""), "1–64");
expectThrow(() => assertSkillName("My Skill"), "lowercase");
expectThrow(() => assertSkillName("UPPER"), "lowercase");
expectThrow(() => assertSkillName("-bad"), "lowercase");
assert.equal(assertSkillName("my-skill"), "my-skill");

const md = skillMarkdown({
  name: "my-skill",
  description: "Does a thing.",
  body: "Hello.\n",
});
assert.match(md, /^---\nname: my-skill\ndescription: Does a thing\.\n---\n\nHello\.\n$/);

console.log("create-skill.test.ts: ok");
