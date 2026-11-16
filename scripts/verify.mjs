#!/usr/bin/env node
// Проверка сборки: для каждого плагина копия во временный каталог, npm install
// как на сервере (--omit=dev --ignore-scripts), затем сборка app/server/host
// сборщиком alia-core (scripts/build-one.mjs). Итог - data/verify.json.
//
// ALIA_CORE=/path/to/alia-core node scripts/verify.mjs [id ...] [--concurrency 6]
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const ROOT = resolve(import.meta.dirname, "..");
const ALIA_CORE = process.env.ALIA_CORE ?? resolve(ROOT, "../alia-core");
const WORK = process.env.VERIFY_WORK ?? "/tmp/vp-build";
const args = process.argv.slice(2);
const ci = args.indexOf("--concurrency");
const concurrency = ci === -1 ? 6 : Number(args[ci + 1]);
const ids = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--concurrency");

async function run(cmd, argv, opts = {}) {
  try {
    const { stdout, stderr } = await exec(cmd, argv, { maxBuffer: 64 * 1024 * 1024, timeout: 600_000, ...opts });
    return { ok: true, stdout, stderr };
  } catch (e) {
    return { ok: false, stdout: e.stdout ?? "", stderr: (e.stderr ?? "") + (e.killed ? "\n[timeout]" : "") };
  }
}

function npmError(stderr) {
  const lines = stderr.split("\n").filter((l) => /npm error/.test(l) && !/A complete log|^npm error\s*$/.test(l));
  return lines.slice(0, 6).join("\n").slice(0, 1200) || stderr.slice(-800);
}

// Пакет @vesnalia/plugin-sdk (npm pack из alia-core) для второго прохода:
// как плагин соберётся, когда SDK будет опубликован в npm. В репозиторий не кладётся.
const SDK_TGZ = process.env.SDK_TGZ ?? null;
const SDK = "@vesnalia/plugin-sdk";

function passed(r) {
  return r.install === "ok" && r.manifest === "ok" && r.server === "ok" &&
    [r.app, r.host].every((x) => x === null || x === undefined || x === "ok");
}

function sdkRelated(r) {
  return ["install", "app", "server", "host", "build"].some(
    (k) => typeof r[k] === "string" && r[k] !== "ok" && r[k].includes(SDK),
  );
}

async function verifyOne(id) {
  const first = await verifyPass(id, false);
  if (!passed(first) && SDK_TGZ && sdkRelated(first)) {
    const second = await verifyPass(id, true);
    delete second.id;
    first.withPublishedSdk = second;
  }
  return first;
}

async function verifyPass(id, withSdk) {
  const src = join(ROOT, "plugins", id);
  const dir = join(WORK, withSdk ? `${id}--sdk` : id);
  await rm(dir, { recursive: true, force: true });
  await mkdir(WORK, { recursive: true });
  await cp(src, dir, { recursive: true, filter: (p) => !/\/node_modules(\/|$)/.test(p.slice(src.length)) });
  for (const name of [".npmrc", ".yarnrc", ".yarnrc.yml"]) await rm(join(dir, name), { force: true });
  if (withSdk) {
    const pkgPath = join(dir, "package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
    for (const field of ["devDependencies", "peerDependencies", "optionalDependencies"]) delete pkg[field]?.[SDK];
    if (pkg.peerDependenciesMeta) delete pkg.peerDependenciesMeta[SDK];
    pkg.dependencies = { ...(pkg.dependencies ?? {}), [SDK]: `file:${SDK_TGZ}` };
    await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    await rm(join(dir, "package-lock.json"), { force: true });
  }
  const started = Date.now();
  const install = await run("npm", ["install", "--prefix", dir, "--ignore-scripts", "--omit=dev", "--omit=optional", "--no-audit", "--no-fund"], {
    env: { ...process.env, npm_config_cache: "/tmp/vp-npm-cache", npm_config_update_notifier: "false" },
  });
  const result = { id, install: install.ok ? "ok" : npmError(install.stderr) };
  if (install.ok) {
    const built = await run(
      process.execPath,
      ["--conditions=source", "--import", join(ALIA_CORE, "node_modules/tsx/dist/loader.mjs"), join(ROOT, "scripts/build-one.mjs"), ALIA_CORE, dir],
      { cwd: WORK },
    );
    const line = built.stdout.trim().split("\n").at(-1) ?? "";
    try {
      Object.assign(result, JSON.parse(line));
    } catch {
      result.build = (built.stderr || built.stdout).slice(-1500);
    }
  }
  result.seconds = Math.round((Date.now() - started) / 1000);
  await rm(dir, { recursive: true, force: true });
  return result;
}

const all = (await readdir(join(ROOT, "plugins"))).filter((n) => existsSync(join(ROOT, "plugins", n, "package.json"))).sort();
const queue = ids.length > 0 ? ids : all;
const outPath = join(ROOT, "data", "verify.json");
const results = existsSync(outPath) ? JSON.parse(await readFile(outPath, "utf8")) : {};
let done = 0;
const pending = [...queue];
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (pending.length > 0) {
      const id = pending.shift();
      results[id] = await verifyOne(id);
      done += 1;
      const r = results[id];
      const ok = passed(r);
      const sdkOk = r.withPublishedSdk ? (passed(r.withPublishedSdk) ? " sdk:OK" : " sdk:FAIL") : "";
      console.error(`${done}/${queue.length} ${id} ${ok ? "OK" : "FAIL"}${sdkOk} ${r.seconds}s`);
      if (done % 10 === 0) await writeFile(outPath, `${JSON.stringify(results, null, 2)}\n`);
    }
  }),
);
const sorted = Object.fromEntries(Object.entries(results).sort(([a], [b]) => a.localeCompare(b)));
await writeFile(outPath, `${JSON.stringify(sorted, null, 2)}\n`);
