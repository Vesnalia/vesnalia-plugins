import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const css = await readFile(new URL("themes/vercel.css", root), "utf8");

function relativeLuminance(hex) {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4
    );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground, background) {
  const lighter = Math.max(
    relativeLuminance(foreground),
    relativeLuminance(background)
  );
  const darker = Math.min(
    relativeLuminance(foreground),
    relativeLuminance(background)
  );
  return (lighter + 0.05) / (darker + 0.05);
}

const requiredTokens = [
  "--canvas",
  "--ink",
  "--primary",
  "--primary-foreground",
  "--muted-foreground",
  "--subtle-foreground",
  "--readback-foreground",
  "--destructive",
  "--destructive-text",
  "--warning",
  "--attention",
  "--success",
  "--diff-added",
  "--diff-removed",
  "--pr-merged",
  "--file-accent"
];

test("manifest contributes one Vercel theme", () => {
  assert.equal(manifest.name, "bb-plugin-vercel-theme");
  assert.equal(manifest.bb.themes.length, 1);
  assert.deepEqual(manifest.bb.themes[0], {
    id: "vercel",
    name: "Vercel",
    description:
      "Geist typography, monochrome surfaces, restrained blue accents, and matching light and dark code palettes.",
    css: "./themes/vercel.css",
    codeTheme: {
      dark: "./themes/vercel-dark-code.json",
      light: "./themes/vercel-light-code.json"
    }
  });
});

test("every declared release asset exists", async () => {
  const theme = manifest.bb.themes[0];
  const declared = [
    manifest.bb.branding.icon,
    manifest.bb.server,
    theme.css,
    theme.codeTheme.dark,
    theme.codeTheme.light,
    ...manifest.files.filter((path) => !path.includes("*") && !path.endsWith("/"))
  ];
  await Promise.all(
    declared
      .filter((path) => !path.startsWith("dist/"))
      .map((path) => access(new URL(path.replace(/^\.\//, ""), root)))
  );

  const icon = await readFile(new URL("assets/icon.svg", root), "utf8");
  assert.match(icon, /^<svg[\s\S]*<\/svg>\s*$/);
  assert.doesNotMatch(icon, /<script|\bon\w+=|javascript:/i);

  for (const screenshot of ["vercel-dark.png", "vercel-light.png"]) {
    const bytes = await readFile(new URL(`assets/screenshots/${screenshot}`, root));
    assert.equal(bytes.subarray(1, 4).toString("ascii"), "PNG");
  }
});

test("palette defines the complete contract in both modes", () => {
  assert.match(css, /:root,\s*\.light\s*\{/);
  assert.match(css, /\.dark\s*\{/);
  for (const token of requiredTokens) {
    const occurrences = css.match(new RegExp(token.replace("--", "\\-\\-"), "g")) ?? [];
    assert.ok(occurrences.length >= 2, `${token} must be defined for light and dark`);
  }
  assert.match(css, /--font-sans:\s*"Geist"/);
  assert.match(css, /--font-mono:\s*"Geist Mono"/);
  assert.match(css, /\.dark[\s\S]*?--canvas:\s*#000000;/);
  assert.match(css, /\.dark[\s\S]*?--ink:\s*#ededed;/);
  assert.match(css, /--primary:\s*#006fee;/);
});

test("code themes are valid, matching, and AA-readable", async () => {
  for (const [file, type, background, comment] of [
    ["vercel-dark-code.json", "dark", "#000000", "#888888"],
    ["vercel-light-code.json", "light", "#ffffff", "#666666"]
  ]) {
    const theme = JSON.parse(
      await readFile(new URL(`themes/${file}`, root), "utf8")
    );
    assert.equal(theme.type, type);
    assert.equal(theme.colors["editor.background"], background);
    assert.ok(theme.tokenColors.length >= 10);
    assert.equal(theme.tokenColors[0].settings.foreground, comment);
    for (const token of theme.tokenColors) {
      const foreground = token.settings.foreground;
      if (foreground === undefined) continue;
      assert.ok(
        contrastRatio(foreground.slice(0, 7), background) >= 4.5,
        `${type} token ${foreground} must meet WCAG AA contrast`
      );
    }
  }
});
