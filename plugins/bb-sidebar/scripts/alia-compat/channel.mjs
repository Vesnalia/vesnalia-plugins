// One channel of the daily compatibility check: install a alia-app and the SDK
// it ships (one npm command, nothing saved), then run the channel's checks.
//
//   node scripts/alia-compat/channel.mjs --channel floor|stable|nightly --out compat-results
//
// Writes <out>/results.json and <out>/logs/. Exits 1 when floor or stable
// fails; a nightly failure only prints a warning and exits 0.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { channelSteps, firstErrorLines, quoted, runSteps } from "./checks.mjs";
import { parseArgs, run, stripAnsi } from "./lib.mjs";
import { CHANNELS, resolveChannel, SDK } from "./resolve-alia.mjs";
import { compareSdkVersions, renderMarkdown, surfaceProblems } from "./sdk-surface.mjs";

/** The single npm command that installs a resolved VesnALIA without saving it. */
export function installArgs(resolved) {
  const specs = [`alia-app@${resolved.aliaApp}`, `${SDK}@${resolved.sdk}`];
  for (const [name, range] of Object.entries(resolved.shimPins ?? {})) specs.push(`${name}@${range}`);
  return ["install", "--no-save", "--no-audit", "--no-fund", ...specs];
}

export function installedVersion(name, cwd = process.cwd()) {
  return JSON.parse(readFileSync(join(cwd, "node_modules", name, "package.json"), "utf8")).version;
}

function failedStep(name, error, output = "") {
  const text = `${error?.message ?? error}\n${output}`;
  return { name, command: name, status: "fail", errors: firstErrorLines(text) };
}

/** Runs one channel and returns its results object. */
export async function runChannel(channel, { out, cwd = process.cwd() }) {
  const results = { kind: "channel", channel, steps: [], warnings: [] };
  const packageJsonText = readFileSync(join(cwd, "package.json"), "utf8");
  let resolved;
  try {
    resolved = await resolveChannel(channel, packageJsonText);
    Object.assign(results, {
      aliaApp: resolved.aliaApp,
      sdk: resolved.sdk,
      pinned: resolved.pinned,
      shimPins: resolved.shimPins,
      warnings: resolved.warnings,
    });
    results.steps.push({ name: "Resolve VesnALIA", command: "resolve-alia", status: "pass" });
  } catch (error) {
    results.steps.push(failedStep("Resolve VesnALIA", error));
    return finish(results);
  }

  const args = installArgs(resolved);
  console.log(`npm ${args.join(" ")}`);
  const install = await run("npm", args, { cwd, timeoutMs: 15 * 60_000 });
  console.log(quoted(`${install.stdout}\n${install.stderr}`.trim()));
  const installed = { aliaApp: safeVersion("alia-app", cwd), sdk: safeVersion(SDK, cwd) };
  if (install.code !== 0 || installed.aliaApp !== resolved.aliaApp || installed.sdk !== resolved.sdk) {
    const why =
      install.code !== 0
        ? `npm install exited ${install.code}`
        : `installed alia-app ${installed.aliaApp}, SDK ${installed.sdk}`;
    results.steps.push(failedStep("Install VesnALIA", why, stripAnsi(`${install.stderr}\n${install.stdout}`)));
    return finish(results);
  }
  results.steps.push({ name: "Install VesnALIA", command: `npm ${args.join(" ")}`, status: "pass" });

  if (channel !== "floor") {
    try {
      const diff = await compareSdkVersions(resolved.pinned.sdk, resolved.sdk);
      const problems = surfaceProblems(diff);
      results.surface = {
        from: resolved.pinned.sdk,
        to: resolved.sdk,
        markdown: renderMarkdown(diff, { from: resolved.pinned.sdk, to: resolved.sdk }),
      };
      results.steps.push(
        problems.length
          ? { name: "SDK surface report", command: "sdk-surface", status: "fail", errors: problems }
          : { name: "SDK surface report", command: "sdk-surface", status: "pass" },
      );
    } catch (error) {
      results.steps.push(failedStep("SDK surface report", error));
    }
  }

  results.steps.push(...(await runSteps(channelSteps(channel), { cwd, logDir: join(out, "logs") })));
  return finish(results);
}

function safeVersion(name, cwd) {
  try {
    return installedVersion(name, cwd);
  } catch {
    return null;
  }
}

function finish(results) {
  results.ok = results.steps.every((step) => step.status === "pass");
  results.finishedAt = new Date().toISOString();
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const channel = args.channel;
  if (!CHANNELS.includes(channel)) throw new Error(`--channel must be one of ${CHANNELS.join(", ")}`);
  const out = resolve(args.out ?? "compat-results");
  mkdirSync(out, { recursive: true });
  const results = await runChannel(channel, { out });
  writeFileSync(join(out, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
  for (const step of results.steps) console.log(`${step.status.padEnd(7)} ${step.name}`);
  if (results.ok) return;
  if (channel === "nightly") {
    console.log(`::warning::alia nightly ${results.aliaApp ?? "(unresolved)"} fails the sidebar checks (warning only).`);
    return;
  }
  console.log(`::error::The ${channel} channel (VesnALIA ${results.aliaApp ?? "unresolved"}) fails the sidebar checks.`);
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
