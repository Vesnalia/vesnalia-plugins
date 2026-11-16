# Implementation Plan: Configurable Workspace Skills Plugin for VesnALIA

## Goal
Build `alia-plugin-workspace-skills` as a headless VesnALIA plugin that allows configuring arbitrary skill paths in VesnALIA settings, dynamically scans and discovers all skill roots, writes them into `~/.vesnalia/config.json` (`sharedSkillRoots`), and triggers `alia.sdk.system.reloadConfig()`.

## Architecture Context Map Reference
- Ledger: `docs/arch-improvement-ledger.md` (Cycle 1)
- Core API: `@vesnalia/plugin-sdk` (headless server plugin)
- Target Config: `~/.vesnalia/config.json` -> `sharedSkillRoots.user`

---

## Tasks

### Task 1: Clean Headless Plugin Configuration
- [ ] Remove unused frontend scaffold files: `app.tsx`, `components/`, `hooks/`, `components.json`.
- [ ] Edit `package.json`: remove `alia.app`, update `alia.branding.icon` to `"FolderKanban"`, update description, trim frontend devDependencies.
- [ ] Verify `npm run build` or `npx tsc --noEmit` runs cleanly without missing dependencies.

### Task 2: Scanner with TDD (Path Normalization & Skill Root Discovery)
- [ ] Write failing unit test `tests/scanner.test.ts` testing:
  - `normalizeToHomeRelative`: converts `~/Projects/skills`, `/home/user/Projects/skills`, `Projects/skills` to `Projects/skills`.
  - Rejects or flags paths outside `$HOME`.
  - Rejects paths containing `.` or `..` path traversal segments.
  - `discoverSkillRoots`: discovers skill roots (folders whose children contain `SKILL.md`).
- [ ] Run `node --test tests/scanner.test.ts` (Expected: FAILS / Red).
- [ ] Implement `src/scanner.ts`.
- [ ] Run `node --test tests/scanner.test.ts` (Expected: PASSES / Green).

### Task 3: Config Merger with TDD
- [ ] Write failing unit test `tests/config-sync.test.ts` testing:
  - Preserving existing keys in `~/.vesnalia/config.json` (`customAcpAgents`, `customModels`, `serverHeaders`, etc.).
  - Deduplicating roots.
  - Correctly detecting when `sharedSkillRoots.user` has changed (idempotency check).
  - Merging `sharedSkillRoots.user` without touching `sharedSkillRoots.project`.
- [ ] Run `node --test tests/config-sync.test.ts` (Expected: FAILS / Red).
- [ ] Implement `src/config-sync.ts`.
- [ ] Run `node --test tests/config-sync.test.ts` (Expected: PASSES / Green).

### Task 4: Server Plugin Entrypoint (`server.ts`)
- [ ] Define settings in `server.ts` using `alia.settings.define`:
  - `scanPaths` (`type: "string"`, `experimental_multiline: true`, default `"Projects/skills\nProjects/.agents/skills"`).
  - `autoDiscover` (`type: "boolean"`, default `true`).
- [ ] Implement sync pass on startup and on `settings.onChange`.
- [ ] Connect `alia.sdk.system.reloadConfig()`.
- [ ] Register `alia.onDispose`.

### Task 5: Plugin CLI Subcommands (`alia workspace-skills`)
- [ ] Implement CLI command `alia workspace-skills` via `alia.cli.register`:
  - `status`: print current scanPaths, discovered roots count, and skill count.
  - `sync`: trigger immediate scan and reload.
  - `add <path>`: append path to `scanPaths` in plugin settings.
- [ ] Verify CLI routing.

### Task 6: End-to-End VesnALIA Verification
- [ ] Build plugin (`npm run build` or `alia plugin build`).
- [ ] Install plugin locally: `alia plugin install ./alia-plugin-workspace-skills --yes`.
- [ ] Check `alia plugin list` shows `workspace-skills` running.
- [ ] Test CLI command: `alia workspace-skills status` and `alia workspace-skills sync`.
- [ ] Verify skills appear in `alia skill list` and under `/` in the VesnALIA composer.

### Task 7: Complete Arch Loop Cycle (Ledger & Memory)
- [ ] Record verification evidence in `docs/arch-improvement-ledger.md`.
- [ ] Complete S10 (Ledger) and S11 (Learn).
