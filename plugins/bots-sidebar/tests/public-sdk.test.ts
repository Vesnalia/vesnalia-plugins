import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { experimental_scanPublicSdkOnly } from "@vesnalia/plugin-sdk/testing";

it("uses the public SDK and declared packages without private VesnALIA imports", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const packages = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
  const allowed = packages.map(name => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:/.*)?$`));
  const scan = experimental_scanPublicSdkOnly(root, { allow: [...allowed, /^@\/(?:components|lib|hooks)\/[\w/.-]+$/] });
  expect(scan.violations).toEqual([]);
  expect(scan.privateDependencies).toEqual([]);
});
