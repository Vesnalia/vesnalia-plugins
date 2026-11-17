#!/usr/bin/env node
// Дочистка после кодмода (scripts/adapt.mjs): те же правила переименования, но по всем
// текстовым файлам плагина, включая большие, CHANGELOG, тестовые записи и скрипты на
// других языках. Плюс:
//   - source map (*.map) удаляются: в рантайме не нужны, а внутри пути и имена исходников;
//   - из package-lock.json убираются пакеты старого хоста (@get-bb/*, @bb/*, bb-app):
//     в package.json их уже нет;
//   - имена внешних npm-пакетов из зависимостей плагина не трогаются, иначе установка
//     пойдёт за несуществующим пакетом;
//   - не трогаются LICENSE/NOTICE, *.patch (накладываются на чужой код как есть) и чужие
//     lock-файлы (yarn.lock, Cargo.lock и т.п.).
// Запуск: node scripts/deep-clean.mjs [id ...]
import { existsSync } from "node:fs";
import { readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import {
  CODE_EXT,
  SKIP_DIRS,
  brandProse,
  isProse,
  protect,
  renameCode,
  renameSegments,
  transformCode,
  transformMarkdown,
} from "./adapt.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const LEAVE = /^(licen[cs]e|copying|notice|unlicense)([.-][\w.-]*)?$|\.patch$|\.diff$|^(yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|cargo\.lock|poetry\.lock|gemfile\.lock|go\.sum|uv\.lock|package\.json)$/i;
const OLD_HOST_PKG = /^(@get-bb\/|@bb\/|bb-app$)/;

// Слова, где bb не отдельный сегмент (bbui, bbbox): имена внутренних модулей и классов.
// Пополняется по итогам прогона; каждое правило проверяется пересборкой всех плагинов.
const WORDS = [
  [/\bbbium\b/g, "alium"],
  [/\bBbium\b/g, "Alium"],
  [/\bbbbbs\b/g, "aliabbs"],
  // bb в начале слова: bbui, bbbox, .bbae, --bbnotes-*; не bbox, bbs, bbq, bbcode
  [/(?<![A-Za-z0-9])bb(?=[a-z])(?!ox|q(?![a-z])|s(?![a-z])|code)/g, "alia"],
  [/(?<![A-Za-z0-9])Bb(?=[a-z])(?!ox|s(?![a-z]))/g, "Alia"],
  [/(?<![A-Za-z0-9])BB(?=[A-Z][a-z])/g, "Alia"], // BBDesk
  [/(?<![A-Za-z0-9])BB(?=[A-Z_])(?!OX|S|Q|C(?![A-Z]))/g, "ALIA"], // BBBOX_ID; не BBS*, BBQ*
  [/(?<=[a-z])BB(?![A-Za-z0-9])/g, "ALIA"], // openBB
  [/(?<=%2[Ff])bb(?=-)/g, "alia"], // путь в URL-кодировке
];

function applyWords(text) {
  return protect(text, (t) => WORDS.reduce((acc, [re, to]) => acc.replace(re, to), t));
}

function isBinary(buf) {
  return buf.subarray(0, 8000).includes(0);
}

// Что нельзя трогать: data-URI, длинные base64 и хеши (bb внутри них - случайные символы).
const OPAQUE = /data:[\w/+.-]+;base64,[A-Za-z0-9+/=]+|sha(?:1|256|384|512)-[A-Za-z0-9+/=]+|[A-Za-z0-9+/]{48,}={0,2}|\b[0-9a-fA-F]{16,}\b/g;

// Имена внешних пакетов с bb и непрозрачные строки: подменяем на метку на время правки.
function guard(text, names, fn) {
  const saved = [];
  let masked = text.replace(OPAQUE, (m) => `\uE100${saved.push(m) - 1}\uE101`);
  for (const name of names) {
    masked = masked.split(name).join(`${saved.push(name) - 1}`);
  }
  return fn(masked).replace(/(\d+)/g, (_, i) => saved[Number(i)]);
}

async function packageName(dir) {
  try {
    return JSON.parse(await readFile(join(dir, "package.json"), "utf8")).name ?? null;
  } catch {
    return null;
  }
}

async function externalNames(dir) {
  const names = new Set();
  const add = (n) => {
    if (/bb/i.test(n) && !OLD_HOST_PKG.test(n)) names.add(n);
  };
  try {
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    for (const key of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      for (const n of Object.keys(pkg[key] ?? {})) add(n);
    }
  } catch {}
  return [...names].sort((a, b) => b.length - a.length);
}

function pruneLock(text, pkgName) {
  const lock = JSON.parse(text);
  if (pkgName) {
    lock.name = pkgName;
    if (lock.packages?.[""]) lock.packages[""].name = pkgName;
  }
  const isOld = (key) =>
    key.split("node_modules/").slice(1).some((part) => OLD_HOST_PKG.test(part.replace(/\/$/, "")));
  for (const key of Object.keys(lock.packages ?? {})) {
    if (isOld(key)) delete lock.packages[key];
  }
  const root = lock.packages?.[""];
  if (root?.engines) {
    // как в package.json после кодмода
    const e = root.engines;
    if ("bb" in e) { e.alia = e.bb; delete e.bb; }
    if ("bbPluginSdk" in e) { e.aliaPluginSdk = e.bbPluginSdk; delete e.bbPluginSdk; }
  }
  if (root) {
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      for (const n of Object.keys(root[field] ?? {})) if (OLD_HOST_PKG.test(n)) delete root[field][n];
    }
  }
  for (const n of Object.keys(lock.dependencies ?? {})) if (OLD_HOST_PKG.test(n)) delete lock.dependencies[n];
  return `${JSON.stringify(lock, null, 2)}\n`;
}

function transformerFor(file) {
  const name = basename(file);
  const ext = extname(name).toLowerCase();
  if (/^changelog/i.test(name) || ext === ".md" || ext === ".mdx") return transformMarkdown;
  if (CODE_EXT.has(ext)) {
    return (t) => {
      try {
        return transformCode(t, file);
      } catch {
        return renameCode(t);
      }
    };
  }
  // JSON целиком, без исключения для строк вида пакет/путь: внешние пакеты защищает guard
  if (ext === ".json" || ext === ".jsonc") {
    return (t) =>
      t.replace(/"((?:[^"\\\n]|\\.)*)"/g, (_, body) => `"${isProse(body) ? brandProse(body) : renameCode(body)}"`);
  }
  if (ext === ".txt" || ext === ".html") return brandProse;
  return renameCode;
}

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) await walk(join(dir, e.name), out);
    } else if (e.isFile()) out.push(join(dir, e.name));
  }
  return out;
}

async function renamePaths(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory() && !SKIP_DIRS.has(e.name)) await renamePaths(join(dir, e.name));
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name) || LEAVE.test(e.name)) continue;
    const next = applyWords(renameSegments(e.name));
    if (next !== e.name && !existsSync(join(dir, next))) await rename(join(dir, e.name), join(dir, next));
  }
}

export async function deepClean(dir) {
  const names = await externalNames(dir);
  let changed = 0;
  for (const file of await walk(dir)) {
    const name = basename(file);
    if (name.endsWith(".map")) {
      await rm(file);
      changed += 1;
      continue;
    }
    if (/^(yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/i.test(name)) {
      // npm их не читает; со старым SDK внутри они только устарели
      if (/@get-bb\/|"bb-app"|\bbb-app@/.test(await readFile(file, "utf8"))) {
        await rm(file);
        changed += 1;
      }
      continue;
    }
    if (LEAVE.test(name)) continue;
    const buf = await readFile(file);
    if (isBinary(buf)) continue;
    const text = buf.toString("utf8");
    if (!/bb/i.test(text)) continue;
    const next =
      name === "package-lock.json"
        ? pruneLock(text, await packageName(dir))
        : guard(text, names, (t) => applyWords(transformerFor(file)(t)));
    if (next !== text) {
      await writeFile(file, next);
      changed += 1;
    }
  }
  await renamePaths(dir);
  return changed;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const ids = process.argv.slice(2);
  const all = (await readdir(join(ROOT, "plugins"))).sort();
  let total = 0;
  for (const id of ids.length > 0 ? ids : all) {
    const dir = join(ROOT, "plugins", id);
    if (!(await stat(dir)).isDirectory()) continue;
    total += await deepClean(dir);
  }
  console.log(`changed files: ${total}`);
}
