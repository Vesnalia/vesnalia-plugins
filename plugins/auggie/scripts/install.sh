#!/usr/bin/env bash
# Merge alia-auggie into ~/.vesnalia/config.json customAcpAgents and install logo.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_JSON="$ROOT/config/custom-acp-agent.json"
LOGO_SRC="$ROOT/assets/logo.svg"

ALIA_DATA_DIR="${ALIA_DATA_DIR:-$HOME/.alia}"
CONFIG_PATH="$ALIA_DATA_DIR/config.json"
LOGO_NAME="auggie-logo.svg"
LOGO_DST="$ALIA_DATA_DIR/$LOGO_NAME"

if [[ ! -f "$AGENT_JSON" ]]; then
  echo "error: missing agent definition: $AGENT_JSON" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required (brew install jq)" >&2
  exit 1
fi

if ! command -v auggie >/dev/null 2>&1; then
  echo "warning: auggie not on PATH — install with: npm install -g @augmentcode/auggie" >&2
else
  echo "auggie: $(command -v auggie) ($(auggie --version 2>/dev/null | head -1))"
fi

mkdir -p "$ALIA_DATA_DIR"
cp "$LOGO_SRC" "$LOGO_DST"
chmod 644 "$LOGO_DST"

# Build agent object with logo relative to alia data dir
AGENT="$(jq --arg logo "$LOGO_NAME" '. + {logo: $logo}' "$AGENT_JSON")"
AGENT_ID="$(jq -r '.id' <<<"$AGENT")"

if [[ -f "$CONFIG_PATH" ]]; then
  CURRENT="$(cat "$CONFIG_PATH")"
else
  CURRENT='{}'
fi

# Validate current is an object
if ! jq -e 'type == "object"' >/dev/null 2>&1 <<<"$CURRENT"; then
  echo "error: $CONFIG_PATH is not a JSON object" >&2
  exit 1
fi

# Replace existing entry with same id, or append
NEXT="$(
  jq -c --argjson agent "$AGENT" --arg id "$AGENT_ID" '
    .customAcpAgents = (
      ((.customAcpAgents // []) | map(select(.id != $id))) + [$agent]
    )
  ' <<<"$CURRENT"
)"

TMP="$(mktemp "${ALIA_DATA_DIR}/.config.json.XXXXXX")"
# Pretty-print with trailing newline; mode 600 like alia-app
umask 077
printf '%s\n' "$(jq '.' <<<"$NEXT")" >"$TMP"
mv "$TMP" "$CONFIG_PATH"
chmod 600 "$CONFIG_PATH"

echo "wrote $CONFIG_PATH (customAcpAgents id=$AGENT_ID → provider acp-$AGENT_ID)"
echo "logo: $LOGO_DST"

# Prefer alia-app refresh when present; packaged macOS builds expose dist/alia-app.js
refreshed=0
refresh_candidates=(
  "alia-app"
  "/Applications/alia.app/Contents/MacOS/alia-app"
  "/Applications/alia.app/Contents/Resources/app.asar.unpacked/node_modules/alia-app/dist/alia-app.js"
)
for cmd in "${refresh_candidates[@]}"; do
  if [[ "$cmd" == *.js ]]; then
    if [[ -f "$cmd" ]] && node "$cmd" config refresh 2>/dev/null; then
      echo "refreshed managed config via: node $cmd config refresh"
      refreshed=1
      break
    fi
  elif command -v "$cmd" >/dev/null 2>&1 || [[ -x "$cmd" ]]; then
    if "$cmd" config refresh 2>/dev/null; then
      echo "refreshed managed config via: $cmd config refresh"
      refreshed=1
      break
    fi
  fi
done

if [[ "$refreshed" -eq 0 ]]; then
  echo "note: restart alia (or run: node /Applications/alia.app/Contents/Resources/app.asar.unpacked/node_modules/alia-app/dist/alia-app.js config refresh)"
fi

echo
echo "verify:"
echo "  alia provider list"
echo "  alia provider models acp-$AGENT_ID"
