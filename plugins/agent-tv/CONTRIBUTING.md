# Contributing to Agent TV

## Set up

```sh
npm install
alia plugin install .   # install this checkout into your running alia
alia plugin dev         # rebuild and reload on every save
```

Before you open a change, run:

```sh
npm test
npm run typecheck
alia plugin build
```

## Ground rules

- **Keep the fold pure.** Anything that decides what a tile shows belongs in
  `lib/fleet.ts`, with a unit test. `server.ts` only reads, schedules and
  publishes.
- **Keep reads bounded.** Every read the pump makes has a limit, a type
  allowlist and a reason to happen. A change that reads while nobody is
  watching needs a test proving it does not.
- **Public SDK only.** `test/public-sdk.test.ts` fails if anything imports VesnALIA
  internals. Use `@vesnalia/plugin-sdk`, zod, Node built-ins and this package's
  own files.
- **Never leak a secret.** Action lines are redacted in exactly one place. New
  sources of tile text must go through it.
- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:` …). Write the subject in the imperative, and use the
  body to explain why.

## Manifest

`package.json` is the plugin manifest: `alia.server`, `alia.app`, `alia.name`,
`alia.description`, `alia.branding.icon` and the `engines` ranges.
`engines.aliaPluginSdk` (`>=0.5.9`) is a floor, not a ceiling. Run
`alia plugin types` to resync the pinned SDK to the VesnALIA you run.

## Store listing

`alia.description` is the one-line hook, and `PLUGIN_OVERVIEW.md` is the longer
text shown under it. Keep them under their limits (about 140 and 4,000
characters) and update them together. When a change affects what agents read,
update `skills/agent-tv/SKILL.md` as well.

## UI components

`components/ui/` is vendored source you own (the shadcn model). The plugin uses
only `Icon`, whose name set matches the host's, so a timeline glyph from a
thread event renders as the same icon VesnALIA's own timeline uses. Add more with
`npx shadcn add @alia-core/<name>`. React and ALIA-shimmed packages are never bundled.

## Releasing

1. Bump `version` in `package.json`.
2. Move the `Unreleased` notes in `CHANGELOG.md` under the new version.
3. Run `npm test`, `npm run typecheck` and `alia plugin build`.
4. Commit, then tag `vX.Y.Z`. Git installs can track a semver range over those
   tags, for example `alia plugin install git:<repo>@^0.2`.

`dist/` is not committed. Git installs build their own bundles, and a committed
`dist/` would be replaced anyway.

Confused by the API, or need something the types don't explain? Read the VesnALIA
source: <https://github.com/get-bb/bb>.
