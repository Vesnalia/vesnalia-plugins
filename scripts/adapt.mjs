#!/usr/bin/env node
// Кодмод: переводит плагин bb на движок alia-core (VesnALIA).
//
// node scripts/adapt.mjs [plugins/<id> ...]   без аргументов - все plugins/*
//
// Что делает (правила сняты с коммита переименования alia-core 606bd4a и
// сверены с экспортами @get-bb/plugin-sdk 0.6.144 и @vesnalia/plugin-sdk):
// - package.json: раздел bb -> alia, engines bb/bbPluginSdk -> alia/aliaPluginSdk
//   (диапазоны прижимаются к текущим версиям alia-core, исходные пишутся в
//   data/adapt-report.json), имя bb-plugin-* -> alia-plugin-*, SDK из
//   dependencies/devDependencies -> необязательная peerDependency
//   @vesnalia/plugin-sdk (SDK пока не опубликован в npm, а сервер ставит
//   зависимости git-плагина через npm install), bb-app убирается;
// - импорты @get-bb/plugin-sdk[/...] и @bb/plugin-sdk -> @vesnalia/plugin-sdk,
//   @bb/* -> @alia-core/*;
// - имена bb в коде: BbPluginApi -> AliaPluginApi, useBbNavigate -> useAliaNavigate,
//   bbThreadId -> aliaThreadId, BB_CLI -> ALIA_CLI, __bbPluginRuntime ->
//   __aliaPluginRuntime, data-bb-*, --bb-*, "bb/session-options" и т.п.;
//   каталог данных ~/.bb -> ~/.vesnalia, команда CLI bb -> alia;
// - бренд bb/BB в видимых текстах (строки с пробелами, JSX-текст, комментарии,
//   Markdown вне кода) -> VesnALIA;
// - файлы и каталоги с bb в имени переименовываются тем же правилом.
// Ссылки (http/https, github.com/...) не трогаются.
// Ручные правки по конкретным плагинам - FIXES ниже.

import { existsSync } from "node:fs";
import { readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import semver from "semver";
import ts from "typescript";
import { DISPLAY_NAMES, fixProse } from "./renames.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const REPO_URL = "https://github.com/Vesnalia/vesnalia-plugins";
export const ALIA_VERSION = "0.49.0";
export const ALIA_PLUGIN_SDK_VERSION = "0.6.143";
const SDK = "@vesnalia/plugin-sdk";
const BRAND = "VesnALIA";

export const SKIP_DIRS = new Set(["node_modules", ".git", ".turbo", ".bundled-runtime"]);
const SKIP_FILES = /^(licen[cs]e|copying|notice)(\.[a-z]+)?$|^changelog|^package-lock\.json$|^pnpm-lock\.yaml$|^yarn\.lock$|^bun\.lockb?$/i;
export const CODE_EXT = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const TEXT_EXT = new Set([".txt", ".html"]);
const SCRIPT_EXT = new Set([".sh", ".bash", ".zsh", ".yaml", ".yml", ".toml", ".ps1"]);
const CSS_EXT = new Set([".css", ".scss"]);
const MAX_FILE_BYTES = 1_500_000;

// ---------- текстовые правила ----------

export const URL_RE = /\b(?:https?|wss?|git\+https?|ssh):\/\/[^\s"'`<>)\]]+|\b(?:www\.)?github\.com\/[^\s"'`<>)\]]+|\b[\w.-]*getbb\.app\b[^\s"'`<>)\]]*|\b[\w.+-]+@(?:[\w-]+\.)+(?:com|org|net|io|dev|app|local|ru|co|me|ai)\b/g;

export function protect(text, fn) {
  const saved = [];
  const masked = text.replace(URL_RE, (m) => {
    saved.push(m);
    return `\uE000${saved.length - 1}\uE001`;
  });
  return fn(masked).replace(/\uE000(\d+)\uE001/g, (_, i) => saved[Number(i)]);
}

function renamePackages(text) {
  return text
    .replace(/@get-bb\/plugin-sdk\b/g, SDK)
    .replace(/@bb\/plugin-sdk\b/g, SDK)
    .replace(/@bb\//g, "@alia-core/");
}

// bb как отдельный сегмент имени: bb-x, bb_x, bb.x, bbFoo, fooBb, BB_X, ~/.bb
export function renameSegments(text) {
  return renamePackages(text)
    .replace(/(^|[~/\s"'`(=:,[])\.bb(?=$|[/\s"'`),\]])/g, "$1.vesnalia")
    .replace(/(?<![A-Za-z0-9])bb(?![a-z0-9])/g, "alia")
    .replace(/(?<![A-Z])Bb(?![a-z0-9])/g, "Alia")
    .replace(/(?<![A-Za-z0-9])BB(?![A-Za-z0-9])/g, "ALIA");
}

// Команда CLI в видимом тексте: в начале строки, после ` или "$ ", "run ", "try ", кавычки.
// В Markdown команды обычно в коде и обрабатываются как код.
const CLI_RE = /(^|`|\$ |\brun |\bRun |\btry |\bTry |")bb(?= (?:[a-z][a-z0-9-]*|--?[a-z]))/g;
const BRAND_RE = /(?<![\w./@$#:-])(?:bb|BB|Bb)(?![\w/@-]|\.[\w])/g;

// Видимый текст: команды CLI -> alia, бренд -> VesnALIA, прочие имена - по сегментам.
export function brandProse(text) {
  return protect(text, (t) =>
    renameSegments(
      renamePackages(t)
        .replace(CLI_RE, (_, lead = "") => `${lead}alia`)
        .replace(BRAND_RE, BRAND),
    ),
  );
}

export function renameCode(text) {
  return protect(text, renameSegments);
}

export function isProse(text) {
  return /[A-Za-z]{2,}\s+[A-Za-z]/.test(text);
}

export function transformMarkdown(text) {
  // Код (```...``` и `...`) - как код, остальное - как видимый текст.
  const parts = text.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 0) return brandProse(part);
      return renameCode(part);
    })
    .join("");
}

// ---------- JS/TS ----------

function scriptKind(file) {
  switch (extname(file)) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".js":
    case ".mjs":
    case ".cjs":
      return ts.ScriptKind.JSX;
    default:
      return ts.ScriptKind.TS;
  }
}

function isModuleSpecifier(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (
    (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) &&
    parent.moduleSpecifier === node
  )
    return true;
  if (ts.isModuleDeclaration(parent) && parent.name === node) return true;
  if (ts.isLiteralTypeNode(parent) && parent.parent && ts.isImportTypeNode(parent.parent)) return true;
  if (ts.isExternalModuleReference(parent)) return true;
  if (ts.isCallExpression(parent) && parent.arguments[0] === node) {
    const callee = parent.expression;
    if (callee.kind === ts.SyntaxKind.ImportKeyword) return true;
    const name = callee.getText();
    if (/^(require|require\.resolve|import\.meta\.resolve|vi\.mock|vi\.doMock|vi\.importActual|jest\.mock|jest\.requireActual)$/.test(name))
      return true;
  }
  return false;
}

function transformSpecifier(spec) {
  if (/^(\.|\/|@\/|~\/|#)/.test(spec)) return renameCode(spec); // относительные пути и алиасы @/ ~/ #

  return renamePackages(spec);
}

function transformStringRaw(raw, node) {
  const quote = raw[0];
  const body = raw.slice(1, -1);
  if (isModuleSpecifier(node)) return quote + transformSpecifier(body) + quote;
  return quote + (isProse(body) ? brandProse(body) : renameCode(body)) + quote;
}

export function transformCode(text, file) {
  let sf;
  try {
    sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
  } catch {
    return renameCode(text);
  }
  const edits = [];
  // Комментарии: всё, что между токенами (trivia), кроме пробелов.
  const leaves = [];
  const collect = (node) => {
    // JSDoc - это тоже комментарий: пусть попадёт в промежуток между токенами
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    const children = node.getChildren(sf);
    if (children.length === 0) {
      if (node.kind !== ts.SyntaxKind.SyntaxList) leaves.push(node);
      return;
    }
    for (const child of children) collect(child);
  };
  collect(sf);
  let prevEnd = 0;
  for (const leaf of leaves) {
    const start = leaf.getStart(sf);
    if (start > prevEnd) {
      const gap = text.slice(prevEnd, start);
      for (const m of gap.matchAll(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g)) {
        const next = brandProse(m[0]);
        if (next !== m[0]) edits.push([prevEnd + m.index, prevEnd + m.index + m[0].length, next]);
      }
    }
    prevEnd = Math.max(prevEnd, leaf.end);
  }
  const templateProse = new WeakMap();
  const visit = (node) => {
    const start = node.getStart(sf);
    const original = text.slice(start, node.end);
    let next = null;
    switch (node.kind) {
      case ts.SyntaxKind.Identifier:
      case ts.SyntaxKind.PrivateIdentifier:
        next = renameCode(original);
        break;
      case ts.SyntaxKind.StringLiteral:
        next = transformStringRaw(original, node);
        break;
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
        next = transformStringRaw(original, node);
        break;
      case ts.SyntaxKind.TemplateExpression: {
        const whole = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(" ");
        templateProse.set(node, isProse(whole));
        break;
      }
      case ts.SyntaxKind.TemplateHead:
      case ts.SyntaxKind.TemplateMiddle:
      case ts.SyntaxKind.TemplateTail: {
        let template = node.parent;
        while (template && template.kind !== ts.SyntaxKind.TemplateExpression) template = template.parent;
        const prose = template ? templateProse.get(template) : false;
        next = prose ? brandProse(original) : renameCode(original);
        break;
      }
      case ts.SyntaxKind.JsxText:
        next = /[A-Za-z]/.test(original) ? brandProse(original) : original;
        break;
      case ts.SyntaxKind.RegularExpressionLiteral:
        next = renameCode(original);
        break;
      default:
        break;
    }
    if (next !== null && next !== original) edits.push([start, node.end, next]);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  edits.sort((a, b) => b[0] - a[0]);
  let out = text;
  let lastStart = Infinity;
  for (const [s, e, rep] of edits) {
    if (e > lastStart) continue; // перекрытие - пропускаем внутреннюю правку
    out = out.slice(0, s) + rep + out.slice(e);
    lastStart = s;
  }
  return out;
}

// ---------- JSON ----------

const BARE_PACKAGE = /^(@[\w.-]+\/)?[\w.-]+(\/[\w./-]*)?$/;

function transformJsonValue(value, key = null) {
  if (typeof value === "string") {
    if (["description", "name", "displayName", "title", "summary"].includes(key) && isProse(value))
      return brandProse(value);
    if (!value.startsWith(".") && !value.startsWith("/") && BARE_PACKAGE.test(value) && value.includes("/"))
      return renamePackages(value);
    return isProse(value) ? brandProse(value) : renameCode(value);
  }
  if (Array.isArray(value)) return value.map((v) => transformJsonValue(v, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [renamePackages(k), transformJsonValue(v, k)]),
    );
  }
  return value;
}

// Строки JSON правим на месте, не переформатируя файл (и JSONC с комментариями).
export function transformJsonText(text) {
  return text.replace(/"((?:[^"\\\n]|\\.)*)"(\s*:)?/g, (match, body, colon) => {
    if (colon) return `"${renameCode(body)}"${colon}`;
    let next;
    if (!body.startsWith(".") && !body.startsWith("/") && BARE_PACKAGE.test(body) && body.includes("/"))
      next = renamePackages(body);
    else next = isProse(body) ? brandProse(body) : renameCode(body);
    return `"${next}"`;
  });
}

// ---------- package.json ----------

function clampRange(range, current) {
  if (typeof range !== "string" || range.trim() === "") return { range, changed: false };
  const valid = semver.validRange(range);
  if (valid && semver.satisfies(current, valid, { includePrerelease: true })) return { range, changed: false };
  return { range: `>=${semver.major(current)}.${semver.minor(current)}`, changed: true };
}

function sdkPeerRange(spec) {
  const min = semver.validRange(spec) ? semver.minVersion(spec) : null;
  if (!min || semver.gt(min, ALIA_PLUGIN_SDK_VERSION)) return `>=${ALIA_PLUGIN_SDK_VERSION}`;
  return `>=${min.version}`;
}

function sdkDependencyRange(spec) {
  const min = semver.validRange(spec) ? semver.minVersion(spec) : null;
  const caret = min ? `^${min.version}` : null;
  if (!caret || !semver.satisfies(ALIA_PLUGIN_SDK_VERSION, caret)) return `^${ALIA_PLUGIN_SDK_VERSION}`;
  return caret;
}

const SDK_KEYS = ["@get-bb/plugin-sdk", "@bb/plugin-sdk", SDK, "@alia-core/plugin-sdk"];
// Плагины, которым SDK нужен установленным при сборке (сабпути SDK в серверном
// или host-коде, корень SDK во фронтенде), хотя в оригинале он был только в
// devDependencies. Найдены проверкой сборки (scripts/verify.mjs).
const NEEDS_INSTALLED_SDK = new Set(["gtd-sidebar", "orchestrator-mode"]);
const DROP_DEV = new Set(["bb-app"]);

export function adaptPackageJson(pkg, id, notes) {
  const out = {};
  for (const [key, value] of Object.entries(pkg)) {
    if (key === "bb") out.alia = transformJsonValue(value);
    else if (key === "engines" && value && typeof value === "object") {
      const engines = {};
      for (const [k, v] of Object.entries(value)) {
        if (k === "bb") {
          const r = clampRange(v, ALIA_VERSION);
          if (r.changed) notes.push(`engines.alia: ${v} -> ${r.range} (alia-core ${ALIA_VERSION})`);
          engines.alia = r.range;
        } else if (k === "bbPluginSdk") {
          const r = clampRange(v, ALIA_PLUGIN_SDK_VERSION);
          if (r.changed)
            notes.push(`engines.aliaPluginSdk: ${v} -> ${r.range} (SDK ${ALIA_PLUGIN_SDK_VERSION})`);
          engines.aliaPluginSdk = r.range;
        } else engines[k] = v;
      }
      out.engines = engines;
    } else if (["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].includes(key)) {
      const deps = {};
      for (const [name, spec] of Object.entries(value ?? {})) {
        if (SDK_KEYS.includes(name)) {
          out.__sdkSpec = out.__sdkSpec ?? spec;
          if (key === "dependencies") out.__sdkInDependencies = true;
          continue;
        }
        if (DROP_DEV.has(name)) {
          notes.push(`убрана зависимость старого хоста (${key})`);
          continue;
        }
        if (/^@bb\//.test(name)) {
          notes.push(`убрана workspace-зависимость старого хоста (${key})`);
          continue;
        }
        deps[name] = typeof spec === "string" && /^(file|link):/.test(spec) ? renameCode(spec) : spec;
      }
      if (Object.keys(deps).length > 0) out[key] = deps;
    } else if (key === "peerDependenciesMeta") {
      const meta = Object.fromEntries(Object.entries(value ?? {}).filter(([n]) => !SDK_KEYS.includes(n)));
      if (Object.keys(meta).length > 0) out.peerDependenciesMeta = meta;
    } else if (key === "name") {
      out.name = renameSegments(value);
    } else if (key === "repository" || key === "homepage" || key === "bugs") {
      // ставим ниже на наш репозиторий
    } else if (key === "description") {
      out.description = brandProse(value);
    } else if (key === "scripts") {
      out.scripts = Object.fromEntries(Object.entries(value ?? {}).map(([k, v]) => [k, renameCode(v)]));
    } else {
      out[key] = transformJsonValue(value, key);
    }
  }
  const sdkSpec = out.__sdkSpec;
  const sdkInDependencies = out.__sdkInDependencies === true || NEEDS_INSTALLED_SDK.has(id);
  delete out.__sdkSpec;
  delete out.__sdkInDependencies;
  if (sdkInDependencies) {
    // Сервер ставит зависимости git-плагина через npm install --omit=dev; сабпути
    // SDK он не подставляет. Установка пройдёт, когда @vesnalia/plugin-sdk будет в npm.
    out.dependencies = { ...(out.dependencies ?? {}), [SDK]: sdkDependencyRange(sdkSpec ?? "") };
    notes.push(`SDK нужен установленным при сборке: ${SDK} в dependencies, установка ждёт публикации SDK в npm`);
  } else if (sdkSpec !== undefined || out.alia) {
    out.peerDependencies = { ...(out.peerDependencies ?? {}), [SDK]: sdkPeerRange(sdkSpec ?? "") };
    out.peerDependenciesMeta = { ...(out.peerDependenciesMeta ?? {}), [SDK]: { optional: true } };
  }
  out.homepage = `${REPO_URL}/tree/main/plugins/${id}#readme`;
  out.repository = { type: "git", url: `git+${REPO_URL}.git`, directory: `plugins/${id}` };
  out.bugs = { url: `${REPO_URL}/issues` };
  // id плагина выводится из имени пакета; он должен совпасть со slug в каталоге
  const derived = deriveId(out.name ?? "");
  if (derived !== id) {
    notes.push(`имя пакета приведено к alia-plugin-${id}`);
    out.name = `alia-plugin-${id}`;
  }
  if (out.alia && DISPLAY_NAMES[id]) out.alia.name = DISPLAY_NAMES[id];
  if (typeof out.alia?.description === "string") out.alia.description = fixProse(out.alia.description);
  return out;
}

export function deriveId(name) {
  const base = name.includes("/") ? name.split("/").at(-1) : name;
  return base.replace(/^alia-plugin-/, "").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");
}

// ---------- ручные правки по плагинам ----------
// id -> async (dir, notes) => void. Пополняется по итогам проверки сборки.
export const FIXES = {};

// ---------- обход ----------

async function walk(dir, files = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(join(dir, entry.name), files);
    } else if (entry.isFile()) files.push(join(dir, entry.name));
  }
  return files;
}

async function renamePaths(dir, notes) {
  // глубже - раньше, чтобы переименование каталога не ломало пути детей
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) await renamePaths(join(dir, entry.name), notes);
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name) || SKIP_FILES.test(entry.name)) continue;
    const next = renameSegments(entry.name);
    if (next !== entry.name && !existsSync(join(dir, next))) {
      await rename(join(dir, entry.name), join(dir, next));
      notes.push(`переименован файл -> ${next}`);
    }
  }
}

export async function adaptPlugin(dir) {
  const id = basename(dir);
  const notes = [];
  const pkgPath = join(dir, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
  const alreadyAdapted = pkg.alia !== undefined && pkg.bb === undefined;
  let changedFiles = 0;
  for (const file of await walk(dir)) {
    const name = basename(file);
    if (SKIP_FILES.test(name) || name === "package.json") continue;
    const ext = extname(file).toLowerCase();
    const info = await stat(file);
    if (info.size > MAX_FILE_BYTES) continue;
    let transform = null;
    if (CODE_EXT.has(ext) && !file.endsWith(".d.ts.map")) {
      transform = (t) => {
        try {
          return transformCode(t, file);
        } catch {
          return renameCode(t); // слишком глубокое дерево (минифицированный бандл)
        }
      };
    }
    else if (ext === ".json") transform = transformJsonText;
    else if (ext === ".md" || ext === ".mdx") transform = transformMarkdown;
    else if (TEXT_EXT.has(ext)) transform = brandProse;
    else if (SCRIPT_EXT.has(ext)) transform = renameCode;
    else if (CSS_EXT.has(ext)) transform = renameCode;
    if (!transform) continue;
    const text = await readFile(file, "utf8");
    if (!CODE_EXT.has(ext) && text.includes("\u0000")) continue;
    const next = transform(text);
    if (next !== text) {
      await writeFile(file, next);
      changedFiles += 1;
    }
  }
  if (!alreadyAdapted) {
    const adapted = adaptPackageJson(pkg, id, notes);
    await writeFile(pkgPath, `${JSON.stringify(adapted, null, 2)}\n`);
  }
  await renamePaths(dir, notes);
  if (FIXES[id]) await FIXES[id](dir, notes);
  return { id, changedFiles, notes };
}

async function main() {
  const args = process.argv.slice(2);
  const dirs = args.length > 0
    ? args.map((a) => resolve(a))
    : (await readdir(join(ROOT, "plugins"))).sort().map((n) => join(ROOT, "plugins", n));
  const reportPath = join(ROOT, "data", "adapt-report.json");
  const report = existsSync(reportPath) ? JSON.parse(await readFile(reportPath, "utf8")) : {};
  for (const dir of dirs) {
    if (!existsSync(join(dir, "package.json"))) continue;
    try {
      const result = await adaptPlugin(dir);
      report[result.id] = { changedFiles: result.changedFiles, notes: result.notes };
    } catch (error) {
      report[basename(dir)] = { error: String(error?.message ?? error) };
      console.error(`adapt ${relative(ROOT, dir)}: ${error?.message ?? error}`);
    }
  }
  const sorted = Object.fromEntries(Object.entries(report).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(reportPath, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`adapted ${dirs.length}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) await main();
