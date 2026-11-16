#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
RUNTIME="$HOME/.local/share/agent-board-vnext-validation"
TOOLS="$RUNTIME/alia-tools/node_modules/alia-app/dist"
export PATH="$RUNTIME/node24/bin:$HOME/.local/bin:$PATH"
export ALIA_DATA_DIR="$RUNTIME/data"
export ALIA_SERVER_URL="http://127.0.0.1:50886"
export ALIA_TELEMETRY=false
if [[ ! -x "$RUNTIME/node24/bin/node" || ! -f "$TOOLS/alia-app.js" ]]; then
  printf '%s\n' 'Isolated Node/ALIA tools are missing.' >&2; exit 1
fi
assert_host() {
  node --input-type=module - "$ALIA_DATA_DIR/alia-app-runtime.json" "$TOOLS/alia-app.js" <<'JS'
import fs from 'node:fs';
const marker = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const entry = fs.realpathSync(process.argv[3]);
if (marker.serverUrl !== process.env.ALIA_SERVER_URL || fs.realpathSync(marker.entryPath) !== entry) throw Error('Isolated host marker mismatch');
const args = fs.readFileSync(`/proc/${marker.pid}/cmdline`,'utf8').split('\0');
if (!args.includes(entry) || !args.includes(process.env.ALIA_DATA_DIR)) throw Error('Isolated launcher process mismatch');
JS
}
cd -- "$ROOT"
case "${1:-start}" in
  start)
    if ss -H -ltn '( sport = :50886 or sport = :50887 )' | grep -q .; then
      printf '%s\n' 'Validation ports are occupied; no process was changed.' >&2; exit 1
    fi
    exec node "$TOOLS/alia-app.js" --data-dir "$ALIA_DATA_DIR" --server-bind-host 127.0.0.1 --server-port 50886 --host-daemon-port 50887 --no-in-app-updates start ;;
  stop) assert_host; exec node "$TOOLS/alia-app.js" --data-dir "$ALIA_DATA_DIR" stop ;;
  build) exec node "$TOOLS/alia.js" plugin build ;;
  install)
    assert_host
    curl --silent --show-error --fail --max-time 5 "$ALIA_SERVER_URL/api/health" >/dev/null
    exec node "$TOOLS/alia.js" plugin install "$ROOT" --yes ;;
  status) assert_host; exec node "$TOOLS/alia.js" plugin list ;;
  *) printf '%s\n' 'Usage: bash scripts/linux-validation-host.sh start|stop|build|install|status' >&2; exit 1 ;;
esac
