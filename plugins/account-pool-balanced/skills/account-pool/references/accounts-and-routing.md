Enable Account Pool Balanced and keep the builtin Account Pooler disabled.
Add Claude or Codex credentials, then inspect proxy routes and account quota:

```sh
alia plugin enable account-pool-balanced
alia pool account add --provider claude --login
printf '%s\n' "$CLAUDE_AUTH_CODE" | alia pool account login-complete --session <id> --code-stdin
alia pool account add --provider codex --login
alia pool account login-poll --session <id>
alia pool account add --provider claude --import
alia pool account add --provider codex --import
printf '%s\n' "$ANTHROPIC_API_KEY" | alia pool account add --provider claude --api-key-stdin [--label <text>] [--priority <n>]
alia pool account add --provider claude --api-key <key> [--label <text>] [--priority <n>]
alia pool account list [--json]
alia pool account remove <id>
alia pool account enable <id>
alia pool account disable <id>
alia pool account priority <id> <n>
alia pool account reorder <claude|codex> <id>...
alia pool account role <id> <primary|reserve>
alia pool account cap <id> <early> <late>
alia pool account cap <id> off
alia pool account refresh <id>
alia pool status [--json]
alia pool routing <claude|codex> [--off]
alia pool config
alia pool config set <anthropicUpstreamBaseUrl|codexUpstreamBaseUrl|switchThreshold|parentMode|routingStrategy|reserveDrainHours|restDays> <value>
alia pool token rotate --machine <id-or-name>
alia pool bypass <thread-id> [--off]
```

Claude `--login` starts a PKCE session, prints a browser URL and session ID,
then exits. Pipe the manual callback code to `account login-complete` with that
session ID within ten minutes. Codex `--login` prints a device verification
URL, one-time code, session ID, and an `account login-poll` command that waits
for authorization. The Claude code stays out of process arguments, and either
browser may be on a different machine from the VesnALIA server. Newly added or
enabled accounts are available without a plugin reload. With an
enabled account whose secret file remains readable and valid, matching Claude
Code or Codex sessions receive the pool route and a distinct secret token for
their machine.
Codex receives `CODEX_OPENAI_BASE_URL` and the secret
`CODEX_POOL_AUTH_TOKEN`; VesnALIA applies them as in-memory app-server config.
Codex image generation and editing use the same authenticated pool route.
Tokens are never printed. `status` prunes tokens for unenrolled machines and
shows token timestamps plus recently routed threads whose machines need a
local Claude login before the pool can be disabled safely. Rotation keeps the
prior token valid for ten minutes. Agents should pipe API keys to
`--api-key-stdin`;
`--api-key <key>` is an unsafe compatibility form that exposes the key in
process arguments, shell history, and agent transcripts. Prefer `--import` for
an existing Claude Code login. The CLI Codex import path reads
`~/.codex/auth.json` on the VesnALIA server host. OAuth quota refreshes on add or
enable and every five minutes while an account is idle. Use
`alia pool account refresh <id>` to request an immediate refresh for one account.
Account tables add columns for observed model-family buckets; JSON status
exposes their utilization, reset, status, observation time, and source under
`familyWeekly`. Selection skips an account whose requested family is spent
while retaining it for other families. A present `metadata.user_id` account
UUID is aligned with the selected OAuth account. Use `alia pool config` to
inspect the full routing configuration and
`alia pool config set <key> <value>` to update one value. The upstream URL keys
are QA-only overrides; `switchThreshold` must be greater than 0 and at most 1.
`routingStrategy` is `sequential` by default; `balanced` sends new
conversations and failover to the eligible account with the most quota to spend
before its reset, while existing conversations stay pinned.

Accounts run sequentially per provider: lower priority numbers first, with ties
following the order accounts were added. New conversations use the current
account until it reaches the switch threshold or fails; the pool then advances
to the next eligible account and wraps at the end. It keeps using that fallback
even when an earlier account recovers. Existing conversations stay pinned while
their account remains eligible. Short temporary rate limits wait on the same
account once; longer holds return Retry-After for pinned conversations while new
conversations can advance. A model-family limit detours only requests for that
family without moving the session's main pin or the provider cursor. The cursor
and session pins survive hub restarts. Session pins expire after 30 idle minutes,
and the pool retains the 4,096 most recently used pins.

Drag an account’s handle in Account Pooler settings (or focus the handle and use
Space, arrow keys, and Space again), or
`alia pool account reorder <claude|codex> <id>...`, to set the complete order for
one provider. Include disabled accounts too. Reordering changes the next failover
sequence without moving the current account. `alia pool account priority <id> <n>`
sets an individual priority; the same operations are available through the
`account.reorder` and `account.setPriority` plugin RPCs.

For private, bounded attribution of natural forwarding requests and hold causes,
use `alia pool observations --json` (0.4.35+). See
[request observations](../../../docs/request-observations.md) for coverage,
identity provenance, retained-event rate counts and privacy/retention limits.
The command does not refresh quotas or make provider requests.
