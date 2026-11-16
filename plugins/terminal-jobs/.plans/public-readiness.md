# Terminal Jobs public readiness

## Goal

Prepare the plugin for a later public release and VesnALIA Community submission without changing the proven exact-owner notification contract. This change does not release, tag, publish, install into the canonical checkout, contact maintainers, or submit marketplace metadata.

## Result shape

- The VesnALIA server plugin stays responsible for durable job rows, VesnALIA terminal creation and observation, outcome validation, and owner-thread notification.
- A new `alia.host` entry runs on each selected target host. It reports a versioned runner command from the downloaded host artifact, so a managed plugin install needs no separate runner checkout or symlink.
- The host artifact also acts as the terminal runner when VesnALIA's Node executable starts it with a private `__terminal_job_runner__` argument. Runner and host-worker execution share one bundled implementation.
- `alia terminal-job list` provides bounded, argument-free job history.
- `alia terminal-job prune` previews or explicitly deletes old settled job artifacts on their target hosts, then deletes the matching database rows.
- Existing schema-1 launch and outcome artifacts and the at-least-once notification marker stay unchanged.

## Decisions

### D1. Use the managed `alia.host` artifact as the runner

The plugin defines `terminalJobHostContract` with `defineRpcContract` and Zod. The server creates `alia.hosts.experimental_client({ contract })` and calls `host.call("runner.readiness", null, { hostId, signal: ctx.signal })` before it inserts a run row or calls `alia.sdk.terminals.create`.

The strict readiness result contains:

- runner protocol version `1`;
- `supported: false` on native Windows and true on POSIX platforms, including WSL;
- `process.execPath`, the host artifact's `fileURLToPath(import.meta.url)`, `process.version`, and platform.

The server requires Node 22 or later, protocol 1, absolute POSIX paths without control characters, and POSIX support. The shell command quotes every fixed and user argument with the existing single-quote function and starts the runtime with `ELECTRON_RUN_AS_NODE=1`; this is harmless for plain Node and required by the packaged VesnALIA executable. A local probe confirmed that the packaged VesnALIA executable runs a script in this mode. The private runner token is accepted only as the first artifact argument.

A host transport failure, offline host, unsupported platform, invalid path, old Node runtime, or protocol mismatch exits the CLI with an actionable readiness error before persistence or terminal creation. The host API supplies a 30-second call limit; the CLI also passes its request abort signal. No retry row is created because no terminal launch was attempted. `watch` does not call host readiness.

This removes per-host installation and version skew without a second copied script. Long commands still run inside native VesnALIA terminals, not inside a time-limited host RPC call.

### D2. Keep artifact schema version 1

The launch and outcome documents keep their current fields and validation. Commands can contain sensitive data, so documentation states that arguments, launch metadata, SQLite rows, and logs are sensitive. Users must provide secrets through target-host mode-0600 files; invoking-shell environment variables do not cross the VesnALIA boundary.

A secure environment-input feature is not added because the approved scope requires corrected guidance, not a new secret transport.

### D3. Add bounded list output

`list` accepts `--limit N` and `--json`. It defaults to 20 and accepts only decimal safe integers from 1 through 200. Results are newest first and use the same argument-free status shape as `show`. Text output contains one compact record per job. A malformed stored row is reported as skipped without mutating it or blocking healthy rows.

### D4. Make pruning explicit, confined, and exclusive

`prune --older-than-days N [--limit N] [--delete] [--json]` accepts `--older-than-days` as a decimal safe integer from 1 through 36,500. `--limit` defaults to 100 and accepts 1 through 200. Without `--delete`, prune is a read-only preview. Selection is oldest first.

A row is eligible only when its terminal and outcome observation are settled, its delivery is `delivered` or `abandoned`, its `updated_at` is older than the cutoff, and it has no claim from the current plugin generation. Malformed rows are reported and skipped without mutation.

A second append-only database migration adds a nullable prune claim token. Delete mode atomically claims each still-eligible row before remote I/O. `retry-notification` requires no prune claim, so it cannot revive an abandoned row while deletion is in progress. A later explicit prune atomically replaces a prior generation's claim without exposing an unclaimed state; repeated remote removal is safe. A failure restores the replaced claim, or clears the current claim when no prior claim existed, and retains the row.

Before any file call, a run row must have a generated `job_<id>` marker and normalized absolute POSIX paths, and `jobDirectory` must exactly equal `path.posix.join(artifactRoot, jobId)` beneath, but not equal to, `artifactRoot`. Otherwise prune keeps the row and reports the path error. The plugin calls:

```ts
alia.sdk.files.remove({
  hostId: job.hostId,
  rootPath: job.artifactRoot,
  path: job.jobDirectory,
  recursive: true,
})
```

Published SDK 0.4.34 defines this method and recursive argument. Current VesnALIA resolves and confines the real path below `rootPath`; it refuses removal of the root and symlink escapes. Missing paths return a typed not-found error, which prune treats as already removed. Other failures retain the row. After removal, a token-matched database delete removes the row. A watched job has no plugin-owned directory, so pruning removes only its claimed row.

No automatic retention policy is introduced. Users can preview and schedule this explicit command according to their storage policy.

### D5. Terminate the command process group on ordinary terminal stop

On POSIX hosts, the runner starts the command in a new process group and forwards SIGHUP, SIGINT, and SIGTERM with a negative process-group ID. Tests use a real parent and grandchild process and verify that terminal-style SIGTERM leaves neither running. The existing post-child-exit signal race remains covered.

There is no new escalation timer because no ignored-SIGTERM failure is observed or required. SIGKILL cannot be handled by a userspace runner; a direct SIGKILL or daemon loss can leave a descendant and no outcome. The forced-loss test confirms that this condition never becomes success and cleans up its fixture process. README guidance names the limitation. Native VesnALIA terminal process-tree cleanup remains the operator's final stop mechanism.

Daemon disconnect is also an uncertainty boundary: if no valid outcome exists, the service records `missing`, sends one notice that command success is unknown, and never reports success.

### D6. Prepare version 0.2.0 on the current public toolchain

The manifest moves to `0.2.0`, adds `alia.host`, raises compatibility to VesnALIA `>=0.41.0` and plugin SDK `>=0.4.34`, pins published SDK `0.4.34`, and builds with public `alia-app@0.41.0`. Zod moves to runtime dependencies because both server and host import it for the strict readiness contract and managed Git installs omit development dependencies before building.

Inspection after implementation found that public `alia-app@0.41.0` builds artifacts with SDK 0.4.34, not 0.4.36 as the installed desktop build reports. Published SDK 0.4.34 contains every host, file-removal, and test-harness API used here. The reproducible SDK gate therefore requires source declarations and both built artifacts to use exactly 0.4.34. Current desktop VesnALIA's newer SDK 0.4.36 satisfies the `>=0.4.34` engine range. No unpublished package, private source, or compatibility exception is used.

The package allowlist includes `host.ts`, the shared contract and runner sources, and built host artifacts. Obsolete `bin/terminal-job-runner`, `bin/terminal-job-schema.cjs`, `bin/package.json`, runner-install scripts, package scripts, and schema-mirror tests are removed or repointed to the shared TypeScript source. `server.ts` uses the prepared package version instead of a stale hard-coded load message.

### D7. Test installed behavior at public boundaries

- Unit and integration tests use the VesnALIA fake plugin host and `experimental_createHostEntryHarness` from `@vesnalia/plugin-sdk/testing/host`.
- Runner tests build first, then execute `dist/host.js` in runner mode. They cover argv preservation, statuses, artifact permissions, forced loss, group-targeted shutdown, and no false success.
- Service tests keep exact-owner, retry, duplicate-prevention, launch ambiguity, daemon-disconnect, corrupt-row, and post-exit signal-race coverage.
- Prune tests pause remote removal and try `retry-notification`, corrupt each path component, exercise missing and permission failures, verify watched rows, and test zero, negative, fractional, non-numeric, infinite spelling, and unsafe integers.
- Readiness tests cover unsupported platforms, wrong protocol, old Node, transport failure, hostile paths, no inserted row or terminal on failure, and no readiness call for `watch`.
- Disposable VesnALIA smoke tests use public `alia-app@0.41.0`, install once from a path and once from a temporary local Git repository, invoke conventional `--help`, call host readiness on the target host, run a short durable job, wait through `alia terminal wait --exit`, inspect the final job, and clean up the disposable VesnALIA instance.
- CI runs the full gates on Linux and macOS with a limit adjusted only if measured runtime needs it. WSL remains supported as Linux; native Windows is rejected by readiness.

## Implementation steps

1. Add the strict host contract, host entry, and shared runner module. Add host-entry harness tests before changing the server launch path.
2. Wire one host client into the plugin and require readiness before a run row or terminal is created. Replace the hard-coded `$HOME/.local/bin` command. Keep watch behavior independent of the runner.
3. Refactor runner tests to build and execute the host artifact. Add the real grandchild shutdown regression, preserve the post-exit race, and retain forced-loss uncertainty coverage with fixture cleanup.
4. Append the prune-claim migration. Add non-mutating, corruption-tolerant list and prune selection; atomic claim, release, recovery, and token-matched deletion; numeric range validation; and the exact path guard.
5. Add CLI registration and help for `list` and `prune`, including top-level `--help`. Add safe text and JSON results that omit argv, preview results, partial failures, remote removal, and typed missing-path handling.
6. Strengthen the daemon-disconnect regression so an absent outcome remains explicit uncertainty and is delivered once.
7. Replace the disposable install smoke with shared path/Git modes on VesnALIA 0.41.0 and a real target-host runner execution. Keep commands and temporary state local to the disposable server.
8. Update package metadata, lockfile, CI gates, README, and the agent skill. Remove every obsolete external-runner path. Ensure the package allowlist contains all managed-install source and artifact files.
9. Build committed `dist/server.*` and `dist/host.*`, run all checks on the worktree, inspect the package contents, and confirm no path refers to the canonical checkout.
10. Commit the complete approved change on `terminal-plugin-launch` with no tag, push, live install, or public action.

## Acceptance checks

- A path or managed Git install builds and loads both server and host artifacts on VesnALIA 0.41.0.
- A run calls host readiness for the resolved target, rejects unsupported or incompatible readiness before persistence, and launches once with the bundled runner.
- The short smoke job exits zero, writes valid mode-0600 schema-1 artifacts, reaches delivered notification state, and needs no external runner file.
- `alia terminal-job --help`, `list`, and prune preview work; prune deletion cannot remove active, unsettled, too-new, malformed, or current-generation claimed rows.
- Pruning never removes a path that fails the exact root/job guard, never deletes a row after target-host removal failure, and blocks notification retry while claimed.
- CLI output omits argv. Numeric options accept only their stated ranges.
- SIGTERM reaches a spawned grandchild. Forced runner loss and daemon disconnect cannot become success.
- Existing exact-owner, stable-marker, retry, ambiguity, and duplicate-prevention tests remain green.
- `npm run check`, package dry-run, `git diff --check`, and repository status checks pass.

## Not authorized

No release or tag, network publication, GitHub comment, marketplace entry or pull request, maintainer contact, canonical-checkout edit, or live plugin installation.
