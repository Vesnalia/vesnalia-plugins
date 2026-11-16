// Resolves a VesnALIA channel to a alia-app version, the @vesnalia/plugin-sdk version
// that alia-app ships, and the runtime-shim pins it asks for.
//
// The SDK version comes from the target alia-app's own `alia plugin types --check`,
// run on a scratch copy of package.json (it reads only that file and needs no
// server). It is cross-checked against the PLUGIN_SDK_VERSION literal in the
// alia-app bundle; any disagreement or unrecognised output fails closed.
//
//   node scripts/alia-compat/resolve-alia.mjs --channel floor|stable|nightly [--out resolved.json]
//   node scripts/alia-compat/resolve-alia.mjs --alia-app 0.48.0
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertPackageName,
  assertPinRange,
  assertSemver,
  assertStableSemver,
  cleanEnv,
  parseArgs,
  run,
  runOk,
  stripAnsi,
} from "./lib.mjs";

export const SDK = "@vesnalia/plugin-sdk";
export const CHANNELS = ["floor", "stable", "nightly"];
const DIST_TAGS = { stable: "latest", nightly: "nightly" };

/** The minimum VesnALIA in `engines.alia`; only the `>=X.Y.Z` form is accepted. */
export function floorVersion(enginesRange, what = "engines.alia") {
  const match = /^>=\s*(\d+\.\d+\.\d+)$/.exec(String(enginesRange ?? "").trim());
  if (!match) throw new Error(`${what} must be ">=X.Y.Z", got ${JSON.stringify(enginesRange)}`);
  return assertStableSemver(match[1], what);
}

const KNOWN_NOTES = [/^The declarations are in .+ read them for exact signatures\.$/, /^Run `npm install` /];

/**
 * Parses `alia plugin types --check` output. Every non-empty line must be one
 * of the known forms; anything else is returned in `unknown`.
 */
export function parseTypesCheck(output) {
  const result = { pin: null, host: null, pins: {}, unknown: [] };
  for (const raw of stripAnsi(output).split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let match = /^This plugin uses the npm package @get-alia\/plugin-sdk; pin is (\S+), host is (\S+?)\.$/.exec(line);
    if (match) {
      result.pin = match[1];
      result.host = match[2];
      continue;
    }
    match = /^Set "([^"]+)" to (\S+) in devDependencies(?: and re-run npm install| —| -)/.exec(line);
    if (match) {
      result.pins[match[1]] = match[2];
      continue;
    }
    if (KNOWN_NOTES.some((pattern) => pattern.test(line))) continue;
    result.unknown.push(line);
  }
  return result;
}

/** Validates a parsed check against the bundle literal and returns the host. */
export function decideHost(parsed, literals) {
  if (parsed.unknown.length) {
    throw new Error(`Unrecognised \`alia plugin types --check\` output:\n${parsed.unknown.join("\n")}`);
  }
  if (!parsed.host) throw new Error("`alia plugin types --check` did not report the host SDK version");
  const host = assertSemver(parsed.host, "host SDK version");
  const distinct = [...new Set(literals)];
  if (distinct.length > 1) throw new Error(`alia-app bundle has several SDK versions: ${distinct.join(", ")}`);
  if (distinct.length === 1 && distinct[0] !== host) {
    throw new Error(`alia plugin types reports SDK ${host} but the bundle says ${distinct[0]}`);
  }
  const sdkPin = parsed.pins[SDK];
  if (sdkPin !== undefined && sdkPin !== host) throw new Error(`alia asks for ${SDK} ${sdkPin} but reports host ${host}`);
  const shimPins = {};
  for (const [name, range] of Object.entries(parsed.pins)) {
    if (name === SDK) continue;
    shimPins[assertPackageName(name)] = assertPinRange(range, `${name} pin`);
  }
  return { sdk: host, shimPins, crossChecked: distinct.length === 1 };
}

/** The PLUGIN_SDK_VERSION literals in a alia-app bundle. */
export function sdkLiterals(bundleText) {
  return [...bundleText.matchAll(/PLUGIN_SDK_VERSION\s*=\s*"([^"]+)"/g)].map((match) => match[1]);
}

async function npmViewVersion(spec) {
  const { stdout } = await runOk("npm", ["view", spec, "version", "--json"]);
  const value = JSON.parse(stdout);
  return Array.isArray(value) ? value.at(-1) : value;
}

/** The alia-app version a channel points at today. */
async function channelVersion(channel, packageJson) {
  if (channel === "floor") return floorVersion(packageJson.engines?.alia);
  const tag = DIST_TAGS[channel];
  if (!tag) throw new Error(`Unknown channel ${JSON.stringify(channel)}; use ${CHANNELS.join(", ")}`);
  const version = await npmViewVersion(`alia-app@${tag}`);
  return channel === "stable" ? assertStableSemver(version, "alia-app@latest") : assertSemver(version, "alia-app@nightly");
}

/**
 * Installs alia-app into a scratch directory (no install scripts) and asks it
 * which SDK it ships and which pins it wants for this package.json.
 */
async function resolveHost(aliaApp, packageJsonText) {
  assertSemver(aliaApp, "alia-app version");
  const scratch = mkdtempSync(join(tmpdir(), "alia-compat-resolve-"));
  try {
    const installDir = join(scratch, "install");
    const pluginDir = join(scratch, "plugin");
    const home = join(scratch, "home");
    for (const dir of [installDir, pluginDir, home]) mkdirSync(dir);
    writeFileSync(join(installDir, "package.json"), '{ "private": true }\n');
    await runOk(
      "npm",
      ["install", "--no-save", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock", `alia-app@${aliaApp}`],
      { cwd: installDir },
    );
    const appDir = join(installDir, "node_modules", "alia-app");
    const manifest = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8"));
    if (manifest.version !== aliaApp) throw new Error(`Asked for alia-app ${aliaApp}, npm installed ${manifest.version}`);
    const bin = typeof manifest.bin === "object" ? manifest.bin.alia : null;
    if (typeof bin !== "string" || !/^[\w./-]+$/.test(bin)) throw new Error("alia-app has no VesnALIA binary");
    writeFileSync(join(pluginDir, "package.json"), packageJsonText);
    // A scratch HOME keeps VesnALIA away from any real ~/.alia; the check needs neither.
    const check = await run(process.execPath, [join(appDir, bin), "plugin", "types", "--check"], {
      cwd: pluginDir,
      env: cleanEnv({ HOME: home }),
      timeoutMs: 120_000,
    });
    if (check.code !== 0 && check.code !== 1) {
      throw new Error(`alia plugin types --check exited ${check.code}\n${check.stderr}${check.stdout}`);
    }
    const parsed = parseTypesCheck(`${check.stdout}\n${check.stderr}`);
    let literals = [];
    try {
      literals = sdkLiterals(readFileSync(join(appDir, "dist", "index.js"), "utf8"));
    } catch {
      // A bundle without dist/index.js is still resolved, just not cross-checked.
    }
    const host = decideHost(parsed, literals);
    const published = await npmViewVersion(`${SDK}@${host.sdk}`);
    if (published !== host.sdk) throw new Error(`${SDK}@${host.sdk} is not published on npm`);
    return { aliaApp, ...host, pinnedSdk: parsed.pin };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export async function resolveChannel(channel, packageJsonText) {
  const packageJson = JSON.parse(packageJsonText);
  const aliaApp = await channelVersion(channel, packageJson);
  const host = await resolveHost(aliaApp, packageJsonText);
  const warnings = [];
  if (!host.crossChecked) warnings.push("alia-app bundle has no PLUGIN_SDK_VERSION literal; SDK not cross-checked.");
  if (channel === "floor") {
    const sdkFloor = floorVersion(packageJson.engines?.aliaPluginSdk, "engines.aliaPluginSdk");
    if (sdkFloor !== host.sdk) {
      warnings.push(`engines.aliaPluginSdk is >=${sdkFloor}, but the floor VesnALIA ${aliaApp} ships SDK ${host.sdk}.`);
    }
  }
  return {
    channel,
    ...host,
    pinned: { aliaApp: packageJson.devDependencies?.["alia-app"], sdk: packageJson.devDependencies?.[SDK] },
    warnings,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const packageJsonText = readFileSync(args.package ?? "package.json", "utf8");
  const result = args["alia-app"]
    ? await resolveHost(assertSemver(args["alia-app"], "--alia-app"), packageJsonText)
    : await resolveChannel(args.channel, packageJsonText);
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (args.out) writeFileSync(args.out, json);
  process.stdout.write(json);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
