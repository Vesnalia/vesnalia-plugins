# alia-plugin-tinted-threads

A VesnALIA plugin that contributes a replacement sidebar thread list named
`Tinted Threads`.

Rows group by project, use a red hue when a thread is blocked on input or
failed, and use a subtle green hue while work is active. Sub-threads render
directly beneath their parent with a simple depth indent. Right-clicking a row
opens a thread actions menu. Each row subtitle shows:

- provider icon plus effective model label; Claude and Codex use provider
  glyphs, and other providers get a compact fallback icon
- short uncommitted git stats as fixed `+n` and `-n` tokens
- worktree, branch, or machine name, truncated aggressively

## Use

Install or reload the local plugin:

```sh
npm install --include=dev --cache .npm-cache
alia plugin install . --yes
alia plugin reload tinted-threads
```

Then select `Tinted Threads` in Settings -> Appearance -> Sidebar.

## Verify

```sh
npx tsc --noEmit
alia plugin build .
alia plugin list
```
