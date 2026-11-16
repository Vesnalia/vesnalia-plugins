// Собирает один плагин сборщиком alia-core так же, как сервер при установке из git
// (apps/server/src/services/plugins/managed-plugin-artifacts.ts validateInstallDir):
// app (minify, hostProvidedZod), server, host.
// Запуск: node --conditions=source --import <alia-core>/node_modules/tsx/dist/loader.mjs build-one.mjs <aliaCore> <pluginDir>
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [aliaCore, rootDir] = process.argv.slice(2);
const build = await import(pathToFileURL(join(aliaCore, "packages/plugin-build/src/index.ts")).href);
const domain = await import(pathToFileURL(join(aliaCore, "packages/domain/src/index.ts")).href);
const aliaVersion = JSON.parse(await readFile(join(aliaCore, "packages/alia-app/package.json"), "utf8")).version;

const result = { manifest: null, app: null, server: null, host: null, warnings: [] };
const pkg = JSON.parse(await readFile(join(rootDir, "package.json"), "utf8"));
const parsed = domain.pluginPackageJsonSchema.safeParse(pkg);
if (!parsed.success) {
  const issue = parsed.error.issues[0];
  result.manifest = `invalid manifest (${issue?.path.join(".")}): ${issue?.message}`;
  console.log(JSON.stringify(result));
  process.exit(0);
}
result.manifest = "ok";
const toolchain = await build.resolvePluginBuildToolchain("/tmp/vp-toolchain");
const short = (e) => String(e?.message ?? e).slice(0, 1500);
if (pkg.alia.app !== undefined) {
  try {
    const app = await build.buildPluginApp(rootDir, aliaVersion, toolchain, { minify: true, hostProvidedZod: true });
    result.app = "ok";
    result.warnings.push(...(app.migrationWarnings ?? []));
  } catch (e) {
    result.app = short(e);
  }
}
try {
  const server = await build.buildPluginServer(rootDir, aliaVersion, toolchain);
  result.server = "ok";
  result.warnings.push(...(server.migrationWarnings ?? []));
} catch (e) {
  result.server = short(e);
}
if (pkg.alia.host !== undefined) {
  try {
    await build.buildPluginHost(rootDir, aliaVersion, toolchain);
    result.host = "ok";
  } catch (e) {
    result.host = short(e);
  }
}
console.log(JSON.stringify(result));
