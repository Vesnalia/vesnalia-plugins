#!/usr/bin/env bash
# Start (and on first run, seed) an isolated alia instance for screenshots.
# Nothing from your real alia appears: it has its own data dir, ports, and
# dummy projects. Re-running reuses the existing data.
set -euo pipefail

ROOT=${HATS_DEMO_ROOT:-/tmp/alia-hats-demo}
PORT=${HATS_DEMO_PORT:-39886}
ALIA_APP=${ALIA_APP:-/Applications/alia.app/Contents/Resources/app.asar.unpacked/node_modules/alia-app/dist/alia-app.js}
PLUGIN_DIR=$(cd "$(dirname "$0")/.." && pwd)

# Point the alia CLI at the demo, never at the alia this shell runs in.
unset ALIA_PROJECT_ID ALIA_THREAD_ID ALIA_ENVIRONMENT_ID ALIA_THREAD_STORAGE ALIA_HOST_DAEMON_PORT ALIA_CLI
export ALIA_SERVER_URL=http://127.0.0.1:$PORT

fresh=0
[ -d "$ROOT/data" ] || fresh=1
mkdir -p "$ROOT/data" "$ROOT/projects"

if ! curl -sf -o /dev/null "$ALIA_SERVER_URL/"; then
  nohup node "$ALIA_APP" --bundled --no-in-app-updates --data-dir "$ROOT/data" \
    --server-port "$PORT" --host-daemon-port $((PORT + 1)) >"$ROOT/server.log" 2>&1 &
  disown
  for _ in $(seq 1 60); do curl -sf -o /dev/null "$ALIA_SERVER_URL/" && break; sleep 1; done
  curl -sf -o /dev/null "$ALIA_SERVER_URL/" || { echo "Demo alia did not start; see $ROOT/server.log" >&2; exit 1; }
fi

if [ "$fresh" = 0 ]; then
  echo "Demo alia ready at $ALIA_SERVER_URL (existing data in $ROOT)"
  exit 0
fi

echo "Seeding demo alia…"
machine=$(alia machine list --json | python3 -c 'import json,sys; d=json.load(sys.stdin); d=d.get("machines", d) if isinstance(d, dict) else d; print(d[0]["id"])')
alia machine rename "$machine" "Demo Mac" >/dev/null
alia thread-list prefs set organizationMode project >/dev/null

# name | folder | hat | thread titles (comma-separated)
PROJECTS=(
  "Cat Café POS|cat-cafe-pos|Day job|Add oat milk surcharge,Fix receipt paw print alignment"
  "llama-crm|llama-crm|Day job|Import herd from spreadsheet,Spit-risk scoring model"
  "Quantum Knitting|quantum-knitting|Day job|Entangle sleeve patterns"
  "haunted-hotel-wiki|haunted-hotel-wiki|Day job|Document room 237 policy"
  "🐉 Dragon Taxes|dragon-taxes|Home|Deduct hoard depreciation"
  "🍞 Sourdough Tracker|sourdough-tracker|Home|Name the starter"
  "Space Yoga|space-yoga|Home|Zero-g downward dog guide"
  "robot-garden|robot-garden|Home,Side quests|Teach tomato bot to water gently"
  "🌙 Moon Bakery|moon-bakery|Side quests|Low-gravity croissant recipe"
  "📻 Pirate Radio|pirate-radio|Side quests|Schedule 3am sea shanty block"
)

alia plugin install "$PLUGIN_DIR" --yes >/dev/null
alia hats rename work "Day job" >/dev/null
alia hats rename personal "Home" >/dev/null
alia hats icon "Home" heart >/dev/null
alia hats create "Side quests" rocket >/dev/null

for row in "${PROJECTS[@]}"; do
  IFS='|' read -r name dir hats titles <<<"$row"
  repo="$ROOT/projects/$dir"
  mkdir -p "$repo"
  (cd "$repo" && git init -q && echo "# $name" >README.md && git add . &&
    git -c user.name=demo -c user.email=demo@example.com commit -qm init)
  id=$(alia project create --machine "$machine" --name "$name" --root "$repo" --json |
    python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
  IFS=',' read -ra hat_list <<<"$hats"
  for hat in "${hat_list[@]}"; do alia hats add "$hat" "$id" >/dev/null; done
  # Threads make the sidebar look lived in. Each runs a one-word Haiku turn
  # on the Claude Code account signed in on this machine. HATS_DEMO_THREADS=0
  # skips them.
  if [ "${HATS_DEMO_THREADS:-1}" != 0 ]; then
    IFS=',' read -ra title_list <<<"$titles"
    for title in "${title_list[@]}"; do
      alia thread spawn --project "$id" --provider claude-code --model claude-haiku-5-5 \
        --permission-mode accept-edits --title "$title" \
        --prompt "Reply with exactly the word: ok. Do not use any tools." --json >/dev/null
    done
  fi
done

if [ "${HATS_DEMO_THREADS:-1}" != 0 ]; then
  echo "Waiting for demo threads to go idle…"
  for _ in $(seq 1 60); do
    busy=$(alia thread list --json | python3 -c 'import json,sys; d=json.load(sys.stdin); d=d.get("threads", d) if isinstance(d, dict) else d; print(sum(t.get("status") != "idle" for t in d))')
    [ "$busy" = 0 ] && break
    sleep 3
  done
  # Clear unread dots so the shots stay calm.
  for t in $(alia thread list --json | python3 -c 'import json,sys; d=json.load(sys.stdin); d=d.get("threads", d) if isinstance(d, dict) else d; print(" ".join(t["id"] for t in d))'); do
    alia thread read "$t" >/dev/null
  done
fi

alia hats wear "Day job" >/dev/null
echo "Demo alia ready at $ALIA_SERVER_URL (data in $ROOT)"
