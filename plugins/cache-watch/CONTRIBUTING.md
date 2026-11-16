# Contributing

Use Node.js 24 and npm. The VesnALIA CLI used for builds is pinned in development
dependencies; it does not need a running VesnALIA server.

```sh
npm ci --include=dev
npm run check
npm exec -- alia plugin types --check .
npm run build
```

Describe the observed behavior, expected behavior, provider, VesnALIA version, and
steps to reproduce in issues. Remove prompts, credentials, local paths, and
session identifiers from logs before attaching them.

Use the public VesnALIA Plugin SDK and its testing harness. Keep missing telemetry
distinct from zero; never describe an expiry estimate as confirmed cache state.
Keepalive must remain opt-in, bounded, and visible. Do not send paid pings or
enable watches as part of routine UI verification.

For a live UI check, install the local path in VesnALIA, then run
`alia plugin reload cache-watch` after building. Test against a thread you own.
Use [RELEASING.md](RELEASING.md) for publication steps.
