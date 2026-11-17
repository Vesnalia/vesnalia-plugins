#!/usr/bin/env node
// Забирает исходники плагинов из каталога bb (marketplace v2) в plugins/<id>/.
// Берёт только репозитории с открытой лицензией из licenses.tsv; код без
// лицензии (NONE) и с NOASSERTION не скачивается и не копируется.
//
// node scripts/import.mjs --catalog v2.json --licenses licenses.tsv [--only id1,id2] [--cache dir]
//
// Пишет plugins/<id>/ (код subdir на выбранном теге), LICENSE оригинала,
// NOTICE.md и data/sources.json (происхождение каждого плагина).

import { execFile } from "node:child_process";
import { cp, mkdir, readFile, readdir, readlink, rm, stat, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import semver from "semver";
import { ourId } from "./renames.mjs";

const exec = promisify(execFile);
const ROOT = resolve(import.meta.dirname, "..");
const OPEN_LICENSES = new Set(["MIT", "Apache-2.0", "WTFPL", "GPL-3.0"]);
const LICENSE_FILE = /^(licen[cs]e|copying)(\.[a-z]+)?$/i;
const SKIP_COPY = new Set([".git", "node_modules", ".turbo", ".bundled-runtime", ".done"]);
// Лицензии, которые не считаем открытыми, даже если в репозитории лежит MIT.
const NON_OPEN = /UNLICENSED|SEE LICEN[CS]E|proprietary|PolyForm|BUSL|Commons-Clause|SSPL|Elastic-2/i;
// Крупные медиа (демо-видео, гифки) не нужны для работы плагина и раздувают
// репозиторий: не копируем, если на файл не ссылается package.json.
const MEDIA = /\.(mp4|mov|webm|gif|webp|png|jpe?g|avif)$/i;
const MEDIA_MAX_BYTES = 512 * 1024;
const DOC_MEDIA_DIRS = new Set(["docs", "screenshots", "media", "design", "decisions", "research", "demo", "demos"]);

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const catalogPath = arg("catalog", "/tmp/bbstore/v2.json");
const licensesPath = arg("licenses", "/tmp/bbstore/licenses.tsv");
const cacheDir = resolve(arg("cache", join(ROOT, ".work", "src")));
const only = arg("only", "")?.split(",").filter(Boolean) ?? [];
// Репозитории без лицензии (NONE, NOASSERTION) берутся только с флагом
// --with-permission, когда разрешение авторов подтверждено владельцем проекта.
const withPermission = process.argv.includes("--with-permission");
const PERMISSION_LICENSES = new Set(["NONE", "NOASSERTION"]);
const concurrency = Number(arg("concurrency", "10"));

function normalizeRepoUrl(url) {
  return url.toLowerCase().replace(/\/+$/, "").replace(/\.git$/, "");
}

async function git(args, opts = {}) {
  const { stdout } = await exec("git", args, {
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    ...opts,
  });
  return stdout.trim();
}

const lsRemoteCache = new Map();
async function lsRemote(url) {
  if (!lsRemoteCache.has(url)) {
    lsRemoteCache.set(
      url,
      git(["ls-remote", url]).then((out) => {
        const refs = new Map();
        for (const line of out.split("\n").filter(Boolean)) {
          const [sha, ref] = line.split("\t");
          refs.set(ref, sha);
        }
        return refs;
      }),
    );
  }
  return lsRemoteCache.get(url);
}

function tagCommit(refs, tag) {
  return refs.get(`refs/tags/${tag}^{}`) ?? refs.get(`refs/tags/${tag}`);
}

async function resolveSource(gitSource) {
  const refs = await lsRemote(gitSource.url);
  if (gitSource.ref !== undefined) {
    const ref = gitSource.ref;
    if (/^[0-9a-f]{40}$/i.test(ref)) return { ref, commit: ref, note: null };
    const commit =
      tagCommit(refs, ref) ?? refs.get(`refs/heads/${ref}`) ?? refs.get(ref);
    if (commit) return { ref, commit, note: null };
    throw new Error(`ref ${ref} not found`);
  }
  const prefix = gitSource.tagPrefix ?? "";
  const candidates = [];
  for (const name of refs.keys()) {
    if (!name.startsWith("refs/tags/") || name.endsWith("^{}")) continue;
    const tag = name.slice("refs/tags/".length);
    if (!tag.startsWith(prefix)) continue;
    const version = semver.valid(semver.clean(tag.slice(prefix.length)) ?? "");
    if (version && semver.satisfies(version, gitSource.range, { includePrerelease: false })) {
      candidates.push({ tag, version });
    }
  }
  candidates.sort((a, b) => semver.rcompare(a.version, b.version));
  if (candidates.length > 0) {
    const { tag } = candidates[0];
    return { ref: tag, commit: tagCommit(refs, tag), note: null };
  }
  const head = refs.get("HEAD");
  if (!head) throw new Error("no matching tag and no HEAD");
  return {
    ref: "HEAD",
    commit: head,
    note: `нет тега под ${prefix}${gitSource.range}, взят HEAD`,
  };
}

const checkoutLocks = new Map();
async function checkout(url, commit) {
  const dir = join(cacheDir, commit);
  if (!checkoutLocks.has(dir)) {
    checkoutLocks.set(
      dir,
      (async () => {
        if (existsSync(join(dir, ".done"))) return dir;
        await rm(dir, { recursive: true, force: true });
        await mkdir(dir, { recursive: true });
        await git(["init", "--quiet"], { cwd: dir });
        await git(["fetch", "--quiet", "--depth", "1", url, commit], { cwd: dir });
        await git(["-c", "advice.detachedHead=false", "checkout", "--quiet", "FETCH_HEAD"], {
          cwd: dir,
        });
        await writeFile(join(dir, ".done"), "");
        return dir;
      })(),
    );
  }
  return checkoutLocks.get(dir);
}

async function findLicenseFile(dir) {
  try {
    const entries = await readdir(dir);
    const hit = entries.filter((name) => LICENSE_FILE.test(name)).sort()[0];
    return hit ? join(dir, hit) : null;
  } catch {
    return null;
  }
}

async function headLicense(url) {
  const refs = await lsRemote(url);
  const head = refs.get("HEAD");
  if (!head) return null;
  const dir = await checkout(url, head);
  const file = await findLicenseFile(dir);
  return file ? { file, commit: head } : null;
}

// Ссылки внутри плагина оставляем; ведущие наружу заменяем копией файла
// (сервер клонирует репозиторий и берёт только каталог плагина), битые убираем.
async function fixSymlinks(target, srcDir, checkoutDir) {
  for (const entry of await readdir(target, { withFileTypes: true, recursive: true })) {
    if (!entry.isSymbolicLink()) continue;
    const path = join(entry.parentPath, entry.name);
    const link = await readlink(path);
    const resolved = resolve(entry.parentPath, link);
    if (!isAbsolute(link) && (resolved + sep).startsWith(target + sep)) continue;
    const source = resolve(srcDir, relative(target, entry.parentPath), link);
    await rm(path, { force: true });
    if ((source + sep).startsWith(checkoutDir + sep) && (await stat(source).catch(() => null))?.isFile()) {
      await cp(source, path);
    }
  }
}

function repoWebUrl(url) {
  return url.replace(/\.git$/, "").replace(/\/+$/, "");
}

function noticeText(entry) {
  const lines = [
    `# ${entry.displayName.replace(/\u2014/g, "-")}`,
    "",
    entry.license === "permission"
      ? "Используется и адаптировано для VesnALIA с разрешения автора (подтверждено владельцем проекта 16.11.2026)."
      : "Плагин адаптирован для VesnALIA из открытого каталога плагинов bb.",
    "",
    `- Оригинальный автор: ${entry.author.name}${entry.author.github ? ` (https://github.com/${entry.author.github})` : ""}`,
    `- Исходный репозиторий: ${entry.originalRepo}`,
    `- Каталог в репозитории: ${entry.subdir || "(корень)"}`,
    `- Версия: ${entry.ref}, коммит ${entry.commit}`,
    `- Ссылка на исходник: ${entry.originalRepo}/tree/${entry.commit}${entry.subdir ? `/${entry.subdir}` : ""}`,
    entry.license === "permission"
      ? "- Лицензия: лицензия не указана в исходном репозитории"
      : `- Лицензия: ${entry.license} (текст в файле LICENSE рядом)`,
  ];
  if (entry.licenseNote) lines.push(`- Примечание о лицензии: ${entry.licenseNote}`);
  if (entry.omittedMedia?.length) {
    lines.push(
      `- Не перенесены демо-медиа из документации (${entry.omittedMedia.length} файлов, есть в исходном репозитории)`,
    );
  }
  lines.push(
    "",
    "Изменения VesnALIA: манифест и зависимости переведены на движок alia-core",
    "(раздел `alia`, `@vesnalia/plugin-sdk`), имена bb заменены на имена VesnALIA,",
    "бренд BB в видимых текстах заменён на VesnALIA. Изменения сделаны скриптом",
    "`scripts/adapt.mjs`; список ручных правок и состояние сборки - в STATUS.md.",
    "",
    "Авторские права на исходный код принадлежат оригинальному автору.",
    "",
  );
  return lines.join("\n");
}

async function main() {
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const licenses = new Map();
  for (const line of (await readFile(licensesPath, "utf8")).split("\n")) {
    if (!line.trim()) continue;
    const [url, , spdx] = line.split("\t");
    licenses.set(normalizeRepoUrl(url), spdx);
  }
  await mkdir(cacheDir, { recursive: true });
  await mkdir(join(ROOT, "plugins"), { recursive: true });
  await mkdir(join(ROOT, "data"), { recursive: true });

  const sourcesPath = join(ROOT, "data", "sources.json");
  const sources = existsSync(sourcesPath)
    ? JSON.parse(await readFile(sourcesPath, "utf8"))
    : {};
  const skipped = [];
  const queue = [];
  for (const plugin of catalog.plugins) {
    if (only.length > 0 && !only.includes(plugin.id)) continue;
    const gitSource = plugin.source?.git;
    if (!gitSource) {
      skipped.push({ id: plugin.id, reason: "в каталоге bb только npm-источник" });
      continue;
    }
    const spdx = licenses.get(normalizeRepoUrl(gitSource.url));
    if (withPermission && PERMISSION_LICENSES.has(spdx)) {
      queue.push({ plugin, gitSource, spdx: "permission" });
      continue;
    }
    if (!OPEN_LICENSES.has(spdx)) {
      skipped.push({ id: plugin.id, reason: `лицензия ${spdx ?? "неизвестна"}` });
      continue;
    }
    queue.push({ plugin, gitSource, spdx });
  }

  let done = 0;
  const failures = [];
  async function work(item) {
    const { plugin, gitSource, spdx } = item;
    const subdir = (gitSource.subdir ?? "").replace(/^\/+|\/+$/g, "");
    try {
      const resolved = await resolveSource(gitSource);
      const dir = await checkout(gitSource.url, resolved.commit);
      const srcDir = subdir ? join(dir, subdir) : dir;
      if (!(await stat(srcDir).catch(() => null))?.isDirectory()) {
        throw new Error(`subdir ${subdir} not found at ${resolved.commit}`);
      }
      const pkg = JSON.parse(await readFile(join(srcDir, "package.json"), "utf8"));
      const pkgLicense = typeof pkg.license === "string" ? pkg.license : null;
      if (pkgLicense && NON_OPEN.test(pkgLicense)) {
        skipped.push({ id: plugin.id, reason: `package.json license: ${pkgLicense}` });
        return;
      }
      let licenseFile = (await findLicenseFile(srcDir)) ?? (await findLicenseFile(dir));
      let licenseNote = null;
      if (spdx === "permission") {
        licenseFile = null;
      } else if (!licenseFile) {
        const head = await headLicense(gitSource.url);
        if (!head) {
          skipped.push({ id: plugin.id, reason: "нет файла лицензии в репозитории" });
          return;
        }
        licenseFile = head.file;
        licenseNote = `файла лицензии нет на ${resolved.ref}; текст взят с ветки по умолчанию (коммит ${head.commit})`;
      }
      if (pkgLicense && pkgLicense !== spdx) {
        licenseNote = [licenseNote, `в package.json указано "${pkgLicense}", в репозитории ${spdx}`]
          .filter(Boolean)
          .join("; ");
      }

      const target = join(ROOT, "plugins", ourId(plugin.id));
      await rm(target, { recursive: true, force: true });
      const manifestText = JSON.stringify(pkg);
      const omitted = [];
      await cp(srcDir, target, {
        recursive: true,
        verbatimSymlinks: true,
        filter: (entry) => {
          const rel = entry.slice(srcDir.length).split("/").filter(Boolean);
          if (rel.some((part) => SKIP_COPY.has(part))) return false;
          if (MEDIA.test(entry) && !manifestText.includes(rel.at(-1))) {
            const size = statSync(entry, { throwIfNoEntry: false })?.size ?? 0;
            if (size > MEDIA_MAX_BYTES || rel.slice(0, -1).some((part) => DOC_MEDIA_DIRS.has(part))) {
              omitted.push(rel.join("/"));
              return false;
            }
          }
          return true;
        },
      });
      await fixSymlinks(target, srcDir, dir);
      const existingLicense = await findLicenseFile(target);
      if (!existingLicense && licenseFile) await cp(licenseFile, join(target, "LICENSE"));

      const entry = {
        id: ourId(plugin.id),
        originalId: plugin.id,
        displayName: plugin.displayName,
        description: plugin.description,
        icon: plugin.icon ?? null,
        category: plugin.category ?? null,
        tags: plugin.tags ?? [],
        author: { name: plugin.author?.name ?? null, github: plugin.author?.github ?? null },
        originalRepo: repoWebUrl(gitSource.url),
        subdir,
        ref: resolved.ref,
        commit: resolved.commit,
        refNote: resolved.note,
        license: spdx,
        licenseNote,
        omittedMedia: omitted,
      };
      await writeFile(join(target, "NOTICE.md"), noticeText(entry));
      sources[ourId(plugin.id)] = entry;
    } catch (error) {
      failures.push({ id: plugin.id, reason: String(error.message ?? error).split("\n")[0] });
    } finally {
      done += 1;
      if (done % 25 === 0) console.error(`${done}/${queue.length}`);
    }
  }

  const pending = [...queue];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (pending.length > 0) await work(pending.shift());
    }),
  );

  const sorted = Object.fromEntries(Object.entries(sources).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(sourcesPath, `${JSON.stringify(sorted, null, 2)}\n`);
  const skippedPath = join(ROOT, "data", "skipped.json");
  const previousSkipped = existsSync(skippedPath)
    ? JSON.parse(await readFile(skippedPath, "utf8"))
    : [];
  const handled = new Set([...queue.map((q) => q.plugin.id), ...skipped.map((s) => s.id)]);
  const mergedSkipped = [
    ...previousSkipped.filter((s) => !handled.has(s.id)),
    ...skipped,
    ...failures.map((f) => ({ ...f, reason: `ошибка импорта: ${f.reason}` })),
  ].sort((a, b) => a.id.localeCompare(b.id));
  await writeFile(skippedPath, `${JSON.stringify(mergedSkipped, null, 2)}\n`);
  console.log(
    `imported ${queue.length - failures.length - skipped.filter((s) => handled.has(s.id) && queue.some((q) => q.plugin.id === s.id)).length}, skipped ${skipped.length}, failed ${failures.length}`,
  );
  for (const f of failures) console.log(`FAIL ${f.id}: ${f.reason}`);
}

await main();
