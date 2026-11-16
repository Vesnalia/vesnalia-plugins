#!/usr/bin/env node
// Собирает итоговые файлы из data/sources.json, data/adapt-report.json и
// data/verify.json: catalog.json (магазин VesnALIA, только собранные плагины),
// status.json и STATUS.md (все плагины), README.md, THIRD_PARTY_NOTICES.md.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { brandProse } from "./adapt.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const REPO_URL = "https://github.com/Vesnalia/vesnalia-plugins";
const read = async (p, fallback) =>
  existsSync(join(ROOT, p)) ? JSON.parse(await readFile(join(ROOT, p), "utf8")) : fallback;

const sources = await read("data/sources.json", {});
const adapt = await read("data/adapt-report.json", {});
const verify = await read("data/verify.json", {});
const skipped = await read("data/skipped.json", []);
const fixes = await read("data/fixes.json", {});

// ---------- остатки имён bb после кодмода ----------
const URL_RE = /\b(?:https?|wss?|git\+https?|ssh):\/\/[^\s"'`<>)\]]+|\b(?:www\.)?github\.com\/[^\s"'`<>)\]]+|\b[\w.-]*getbb\.app\b[^\s"'`<>)\]]*/g;
const SEG = /(?<![A-Za-z0-9])bb(?![a-z0-9])|(?<![A-Z])Bb(?![a-z0-9])|(?<![A-Za-z0-9])BB(?![A-Za-z0-9])|@get-bb/;
const SKIP = /^(licen[cs]e|copying|notice)(\.[a-z]+)?$|^changelog|lock/i;
const EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".css"]);
function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!["node_modules", "dist", ".git"].includes(e.name)) walk(join(dir, e.name), out);
    } else if (e.isFile()) out.push(join(dir, e.name));
  }
  return out;
}
function residualCodeRefs(id) {
  let count = 0;
  for (const file of walk(join(ROOT, "plugins", id))) {
    const name = file.split("/").pop();
    if (SKIP.test(name) || !EXT.has(extname(file)) || statSync(file).size > 1.5e6) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (SEG.test(line.replace(URL_RE, ""))) count += 1;
    }
  }
  return count;
}

// ---------- статус ----------
function firstLine(text) {
  return String(text)
    .replace(/\s+/g, " ")
    .replace(/\/tmp\/vp-build\/[^/ ]+\//g, "")
    .slice(0, 300);
}

function passed(v) {
  return !!v && v.install === "ok" && v.manifest === "ok" && v.server === "ok" &&
    [v.app, v.host].every((x) => x === null || x === undefined || x === "ok");
}

function problemsOf(v) {
  const problems = [];
  if (v.install !== "ok") problems.push(`npm install: ${firstLine(v.install)}`);
  if (v.manifest && v.manifest !== "ok") problems.push(firstLine(v.manifest));
  if (v.build) problems.push(`сборка: ${firstLine(v.build)}`);
  for (const part of ["app", "server", "host"]) {
    if (v[part] && v[part] !== "ok") problems.push(`${part}: ${firstLine(v[part])}`);
  }
  return problems;
}

function statusOf(id) {
  const v = verify[id];
  if (!v) return { state: "broken", problems: ["сборка не проверялась"], warnings: [] };
  const warnings = [...new Set([...(v.warnings ?? []), ...(v.withPublishedSdk?.warnings ?? [])])].map(firstLine);
  if (passed(v)) return { state: "ok", problems: [], warnings };
  const sdkSpecifiers = [
    ...new Set(
      problemsOf(v)
        .join(" ")
        .match(/@vesnalia\/plugin-sdk(?:\/[\w/-]+)?/g) ?? [],
    ),
  ];
  if (v.withPublishedSdk && passed(v.withPublishedSdk)) {
    return {
      state: "needs-sdk",
      problems: [
        `нужен опубликованный в npm ${sdkSpecifiers.join(", ") || "@vesnalia/plugin-sdk"}: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается`,
      ],
      warnings,
    };
  }
  const problems = problemsOf(v);
  if (v.withPublishedSdk) problems.push(...problemsOf(v.withPublishedSdk).map((p) => `с опубликованным SDK: ${p}`));
  return { state: "broken", problems, warnings };
}

const ids = Object.keys(sources).sort();
const status = {};
for (const id of ids) {
  const s = statusOf(id);
  const notes = (adapt[id]?.notes ?? []).filter((n) => !n.startsWith("переименован "));
  const renamedFiles = (adapt[id]?.notes ?? []).filter((n) => n.startsWith("переименован ")).length;
  status[id] = {
    id,
    builds: s.state === "ok",
    state: s.state,
    parts: {
      app: verify[id]?.app ?? null,
      server: verify[id]?.server ?? null,
      host: verify[id]?.host ?? null,
    },
    fixes: [
      ...notes,
      ...(renamedFiles > 0 ? [`переименовано файлов с bb в имени: ${renamedFiles}`] : []),
      ...(fixes[id] ?? []),
    ],
    problems: s.problems,
    warnings: s.warnings,
    residualBbRefs: residualCodeRefs(id),
  };
  for (const part of ["app", "server", "host"]) {
    if (status[id].parts[part] && status[id].parts[part] !== "ok") status[id].parts[part] = "fail";
  }
}

// ---------- catalog.json ----------
function manifestOf(id) {
  return JSON.parse(readFileSync(join(ROOT, "plugins", id, "package.json"), "utf8"));
}
function hostIconName(icon) {
  return typeof icon === "string" && !icon.includes("/") && !/\.(svg|png|webp)$/i.test(icon) ? icon : null;
}
const catalog = [];
for (const id of ids) {
  if (!status[id].builds) continue;
  const src = sources[id];
  const pkg = manifestOf(id);
  const branding = pkg.alia?.branding ?? {};
  const iconName = hostIconName(branding.icon);
  const iconPath = !iconName && typeof branding.icon === "string" ? branding.icon.replace(/^\.\//, "") : null;
  catalog.push({
    slug: id,
    displayName: brandProse(src.displayName),
    description: brandProse(src.description),
    icon: iconName ?? src.icon?.url ?? null,
    ...(iconPath ? { iconPath: `plugins/${id}/${iconPath}` } : {}),
    category: src.category,
    repoUrl: REPO_URL,
    ref: "main",
    subdir: `plugins/${id}`,
    version: pkg.version,
    originalAuthor: src.author,
    originalRepo: src.originalRepo,
    originalRef: src.ref,
    originalCommit: src.commit,
    license: src.license,
  });
}


// ---------- запись ----------
await writeFile(join(ROOT, "catalog.json"), `${JSON.stringify({ name: "vesnalia-plugins", repoUrl: REPO_URL, plugins: catalog }, null, 2)}\n`);
await writeFile(join(ROOT, "status.json"), `${JSON.stringify(status, null, 2)}\n`);

const total = ids.length;
const ok = ids.filter((id) => status[id].state === "ok").length;
const needsSdk = ids.filter((id) => status[id].state === "needs-sdk").length;
const STATE_LABEL = { ok: "да", "needs-sdk": "после публикации SDK", broken: "**нет**" };
const md = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
const statusLines = [
  "# Состояние плагинов",
  "",
  `Проверка: копия плагина, \`npm install --omit=dev --ignore-scripts\` и сборка app/server/host сборщиком alia-core (\`packages/plugin-build\`), как сервер делает при установке из git. Скрипт - \`scripts/verify.mjs\`, сырые результаты - \`data/verify.json\`, полная таблица - \`status.json\`.`,
  "",
  `Всего ${total}: собирается ${ok}, соберётся после публикации \`@vesnalia/plugin-sdk\` в npm ${needsSdk}, сломано ${total - ok - needsSdk}.`,
  "",
  "«После публикации SDK» - плагину нужен установленный SDK (сабпути вроде `/provider-bridge`, `/process`, `/host` в серверном или host-коде, корень SDK во фронтенде). Сервер ставит зависимости git-плагина через `npm install`, а `@vesnalia/plugin-sdk` в npm пока нет. Проверка с пакетом SDK из alia-core (`npm pack`) такие плагины собирает. Предупреждения о снятых API SDK - в `status.json` (`warnings`).",
  "",
  "Колонка «Остатки bb» - число строк кода, где ещё встречается имя bb (не ссылки); обычно это имена внешних сервисов или текст, который кодмод не тронул намеренно.",
  "",
  "| Плагин | Собирается | app / server / host | Что поправлено | Что сломано | Остатки bb |",
  "| --- | --- | --- | --- | --- | --- |",
];
for (const id of ids) {
  const s = status[id];
  const parts = ["app", "server", "host"].map((p) => s.parts[p] ?? "-").join(" / ");
  statusLines.push(
    `| ${id} | ${STATE_LABEL[s.state]} | ${parts} | ${md(s.fixes.join("; ")) || "-"} | ${md(s.problems.join("; ")) || "-"} | ${s.residualBbRefs || "-"} |`,
  );
}
statusLines.push("");
await writeFile(join(ROOT, "STATUS.md"), statusLines.join("\n"));

const categories = {};
for (const id of ids) (categories[sources[id].category ?? "other"] ??= []).push(id);
const readme = [
  "# vesnalia-plugins",
  "",
  "Плагины для VesnALIA (движок alia-core), перенесённые из открытого каталога плагинов bb и адаптированные под alia-core. Переносятся только плагины из репозиториев с открытой лицензией (MIT, Apache-2.0, WTFPL, GPL-3.0); авторство и лицензии сохранены.",
  "",
  "## Устройство",
  "",
  "- `plugins/<id>/` - код плагина из исходного репозитория (каталог subdir на теге из каталога bb), `LICENSE` оригинала и `NOTICE.md` (автор, исходный репозиторий и коммит, лицензия).",
  "- `catalog.json` - записи для магазина VesnALIA по каждому собирающемуся плагину: установка из этого репозитория, `ref` main, `subdir` plugins/<id>.",
  "- `STATUS.md`, `status.json` - собирается ли плагин, что поправлено, что сломано.",
  "- `THIRD_PARTY_NOTICES.md` - авторы и лицензии всех перенесённых плагинов.",
  "- `data/` - происхождение (`sources.json`), отчёт кодмода, сырые результаты проверки, пропущенные плагины с причиной.",
  "",
  "## Как перегнать",
  "",
  "```bash",
  "npm install",
  "node scripts/import.mjs --catalog v2.json --licenses licenses.tsv   # исходники в plugins/",
  "node scripts/adapt.mjs                                              # кодмод bb -> alia",
  "ALIA_CORE=../alia-core SDK_TGZ=/tmp/vesnalia-plugin-sdk.tgz \\",
  "  node scripts/verify.mjs                                           # сборка сборщиком alia-core",
  "node scripts/catalog.mjs                                            # catalog.json, STATUS.md, README.md",
  "```",
  "",
  "`SDK_TGZ` - пакет `@vesnalia/plugin-sdk` (`npm pack` в `alia-core/packages/plugin-sdk`) для второго прохода проверки: как плагин соберётся, когда SDK появится в npm. В репозиторий пакет не кладётся.",
  "",
  "## Что меняет кодмод",
  "",
  "- `package.json`: раздел `bb` -> `alia`, `engines.bb`/`bbPluginSdk` -> `alia`/`aliaPluginSdk` (диапазоны, которые не пускают alia-core 0.49.0 и SDK 0.6.143, прижимаются, исходные - в `data/adapt-report.json`), имя `bb-plugin-*` -> `alia-plugin-*`, ссылки на этот репозиторий.",
  "- SDK: `@get-bb/plugin-sdk` -> `@vesnalia/plugin-sdk` в импортах; в `package.json` SDK стоит необязательной `peerDependency`. `@vesnalia/plugin-sdk` пока не опубликован в npm, а сервер ставит зависимости git-плагина через `npm install`: зависимость на неопубликованный пакет (даже в devDependencies) роняет установку. Корень SDK и `/app` при сборке даёт хост. Плагинам, которым SDK нужен установленным (сабпути `/provider-bridge`, `/process`, `/host` в серверном или host-коде, корень SDK во фронтенде), SDK прописан в `dependencies`: они встанут, когда SDK появится в npm (в STATUS.md - «после публикации SDK»).",
  "- Имена bb в коде по правилам переименования alia-core: `BbPluginApi` -> `AliaPluginApi`, `useBbNavigate` -> `useAliaNavigate`, `bbThreadId` -> `aliaThreadId`, `BB_*` -> `ALIA_*`, `__bbPluginRuntime` -> `__aliaPluginRuntime`, `data-bb-*`, `--bb-*`, протокол провайдеров `bb/...` -> `alia/...`, каталог `~/.bb` -> `~/.vesnalia`, CLI `bb` -> `alia`.",
  "- Бренд BB в видимых текстах (строки интерфейса, Markdown, комментарии) -> VesnALIA. Ссылки не меняются.",
  "",
  `## Плагины (${total}: собирается ${ok}, после публикации SDK ${needsSdk})`,
  "",
];
for (const [cat, list] of Object.entries(categories).sort()) {
  readme.push(`### ${cat}`, "", "| Плагин | Описание | Автор | Лицензия | Сборка |", "| --- | --- | --- | --- | --- |");
  for (const id of list) {
    const src = sources[id];
    const author = src.author.github ? `[${md(src.author.name ?? src.author.github)}](https://github.com/${src.author.github})` : md(src.author.name ?? "-");
    readme.push(
      `| [${md(brandProse(src.displayName).replace(/\u2014/g, "-"))}](plugins/${id}) | ${md(brandProse(src.description).replace(/\u2014/g, "-")).slice(0, 220)}${src.description.length > 220 ? "..." : ""} | ${author} | ${src.license} | ${STATE_LABEL[status[id].state].replace(/\*/g, "")} |`,
    );
  }
  readme.push("");
}
const notInList = skipped.length;
readme.push(
  "## Не перенесены",
  "",
  `${notInList} плагинов каталога bb: без лицензии в репозитории (NONE, NOASSERTION), с несвободной лицензией, только с npm-источником. Список с причинами - \`data/skipped.json\`; их код в этот репозиторий не копировался.`,
  "",
);
await writeFile(join(ROOT, "README.md"), readme.join("\n"));

const notices = [
  "# Third-party notices",
  "",
  "Код в `plugins/` написан авторами, указанными ниже, и распространяется по лицензиям их исходных репозиториев. Текст лицензии каждого плагина - в `plugins/<id>/LICENSE`, происхождение и коммит - в `plugins/<id>/NOTICE.md`. Изменения VesnALIA (адаптация под alia-core) распространяются на тех же условиях.",
  "",
  "Плагины выполнены для движка bb (https://github.com/get-bb/bb, MIT) и адаптированы для alia-core.",
  "",
  "| Плагин | Автор | Исходный репозиторий | Версия | Лицензия |",
  "| --- | --- | --- | --- | --- |",
];
for (const id of ids) {
  const src = sources[id];
  notices.push(
    `| ${id} | ${md(src.author.name ?? "-")}${src.author.github ? ` (github.com/${src.author.github})` : ""} | ${src.originalRepo}${src.subdir ? ` (${src.subdir})` : ""} | ${md(src.ref)} \`${src.commit.slice(0, 12)}\` | ${src.license}${src.licenseNote ? ` (${md(src.licenseNote)})` : ""} |`,
  );
}
notices.push("");
await writeFile(join(ROOT, "THIRD_PARTY_NOTICES.md"), notices.join("\n"));
console.log(`catalog ${catalog.length}, status ${total}, builds ${ok}, needs-sdk ${needsSdk}`);
