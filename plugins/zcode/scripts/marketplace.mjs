import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const overview = await readFile(new URL("PLUGIN_OVERVIEW.md", root), "utf8");
if (!overview.trim() || [...overview.trimEnd()].length > 4000) {
  throw new Error("PLUGIN_OVERVIEW.md must contain 1–4000 characters.");
}
// Catalog icons are either a host glyph name or { url } pointing at a plugin
// asset; relative URLs resolve against this catalog document.
const glyph = /^[A-Za-z][A-Za-z0-9]*$/;
const icon = glyph.test(pkg.alia.branding.icon)
  ? pkg.alia.branding.icon
  : { url: pkg.alia.branding.icon };

const catalog = {
  $schema: "https://getbb.app/schemas/marketplace-v2.schema.json",
  schemaVersion: 2,
  name: "alia-zcode",
  displayName: "ZCode for VesnALIA",
  description:
    "The independent ZCode provider for VesnALIA, maintained by Dmitry Polishuk.",
  plugins: [
    {
      id: "zcode",
      displayName: pkg.alia.name,
      description: pkg.alia.description,
      icon,
      tags: ["coding", "provider", "zcode", "local"],
      author: {
        name: "Dmitry Polishuk",
        github: "dpolishuk",
        url: "https://github.com/dpolishuk",
      },
      overview,
      source: {
        git: { url: "https://github.com/dpolishuk/bb-zcode.git", ref: "main" },
      },
    },
  ],
};
const file = new URL("marketplace.json", root);
const expected = `${JSON.stringify(catalog, null, 2)}\n`;
if (process.argv.includes("--check")) {
  if ((await readFile(file, "utf8")) !== expected) {
    throw new Error(
      "Marketplace metadata is stale. Run npm run marketplace:build.",
    );
  }
  console.log(
    "Marketplace metadata matches package.json and PLUGIN_OVERVIEW.md.",
  );
} else {
  await writeFile(file, expected);
  console.log("Wrote marketplace.json.");
}
