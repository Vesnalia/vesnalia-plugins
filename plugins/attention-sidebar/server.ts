// The list is frontend-only. VesnALIA's manifest still requires a `alia.server`
// entry (`alia plugin build` refuses a manifest without one), so this backend
// registers nothing. The parameter stays untyped so the plugin does not need
// the backend SDK's type dependencies (better-sqlite3, hono).
export default function plugin(_alia: unknown): void {}
