// Whether this VesnALIA can run a release, judged by the `engines.alia` range in the
// release's package.json, read from git without installing or building.
// `engines.aliaPluginSdk` is left to VesnALIA's own install refusal: no API reports
// the host's plugin SDK version.
import type { AliaPluginApi } from "@vesnalia/plugin-sdk";
import semver from "semver";
import { message } from "./errors";
import { readPackageJsonAt } from "./git";

/** Unknown versions skip their check: VesnALIA refuses the install anyway. */
export interface HostVersions {
  alia?: string;
}

interface Engines {
  alia?: string;
}

/** VesnALIA's version, from `system.version()`. */
export async function readHostVersions(alia: AliaPluginApi): Promise<HostVersions> {
  try {
    return { alia: (await alia.sdk.system.version()).currentVersion };
  } catch (error) {
    alia.log.warn(`can't read VesnALIA's version, so not checking engines.alia: ${message(error)}`);
    return {};
  }
}

/** Host versions, re-read at most once a minute (a check reads them per plugin). */
export function cachedHostVersions(alia: AliaPluginApi, ttlMs = 60_000) {
  let cached: { at: number; versions: Promise<HostVersions> } | undefined;
  return () => {
    if (cached === undefined || Date.now() - cached.at > ttlMs) {
      cached = { at: Date.now(), versions: readHostVersions(alia) };
    }
    return cached.versions;
  };
}

/** Why this VesnALIA can't run a release with these engines, in VesnALIA's own words; empty if it can. */
export function engineProblems(engines: Engines, host: HostVersions): string[] {
  const alia = host.alia === undefined ? null : semver.coerce(host.alia);
  // VesnALIA's dev builds (0.0.0) don't enforce engines.alia.
  if (engines.alia === undefined || alia === null || alia.version === "0.0.0") return [];
  if (semver.validRange(engines.alia) === null) {
    return [`declares invalid engines.alia range ${JSON.stringify(engines.alia)}`];
  }
  if (!semver.satisfies(alia, engines.alia)) {
    return [`requires VesnALIA ${engines.alia}, running VesnALIA is ${alia.version}`];
  }
  return [];
}

/** Reads the release's package.json at `tag`; throws if it can't be read. */
export async function releaseProblems(
  release: { url: string; tag: string; subdirectory?: string },
  host: HostVersions,
): Promise<string[]> {
  let engines: Engines;
  try {
    const manifest: unknown = JSON.parse(await readPackageJsonAt(release));
    const raw = (manifest as { engines?: Record<string, unknown> } | null)?.engines ?? {};
    engines = typeof raw.alia === "string" ? { alia: raw.alia } : {};
  } catch (error) {
    throw new Error(`couldn't read ${release.tag}'s package.json: ${message(error)}`);
  }
  return engineProblems(engines, host);
}
