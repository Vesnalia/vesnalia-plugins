# Contributing

Use Node.js 24 LTS, npm, and the VesnALIA CLI. Release preparation uses Node 24.20.0;
older Node versions have not been verified. The public SDK is locked at 0.4.34.

```sh
npm ci
npm test
npm run typecheck
alia plugin build
```

Use supported public `@vesnalia/plugin-sdk` APIs only. Do not import private
`@alia-core/*` packages, escape this package, or read VesnALIA's database. Cross-plugin
integrations must use public RPC and remain optional. Preserve bounded collection,
reasoning exclusion, redaction, reduced motion, and third-party notices.

Use synthetic examples in fixtures and screenshots. Never commit credentials,
local runtime storage, personal conversations, or diagnostic dumps. Run the
full checks before proposing a release. Publication requires maintainer approval.
