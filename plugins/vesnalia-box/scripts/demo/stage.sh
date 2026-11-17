#!/bin/sh
set -e
checkout="$(cd "${1:?usage: stage.sh <alia-box checkout>}" && pwd)"
fresh="$HOME/fresh"
agent_dir="$HOME/demo-agent"
mkdir -p "$fresh" "$agent_dir"

cat > "$fresh/alia.sh" <<EOF
#!/bin/sh
exec env -i HOME="$fresh" PATH=/usr/local/bin:/usr/bin:/bin USER="\$(id -un)" ALIA_DATA_DIR="$fresh/data" ALIA_SERVER_URL=http://127.0.0.1:4999 npx -y --package alia-app@latest alia "\$@"
EOF
chmod +x "$fresh/alia.sh"
alia="$fresh/alia.sh"

cd "$fresh"
env -i HOME="$fresh" PATH=/usr/local/bin:/usr/bin:/bin USER="$(id -un)" nohup npx -y alia-app@latest --data-dir "$fresh/data" --server-bind-host 0.0.0.0 --server-port 4999 --host-daemon-port 4998 --no-in-app-updates > "$fresh/alia.log" 2>&1 &
for _ in $(seq 1 90); do curl -s -o /dev/null http://127.0.0.1:4999/ && break; sleep 2; done

cd "$checkout" && npm ci --no-audit --no-fund > "$fresh/npm-ci.log" 2>&1
"$alia" plugin install "path:$checkout" --yes > "$fresh/install.log" 2>&1

bridge=$(ip -4 addr show docker0 | sed -n 's/.*inet \([0-9.]*\)\/.*/\1/p')
"$alia" settings general machineServerUrl "http://$bridge:4999" > /dev/null
"$alia" settings general defaultMachineAccess direct > /dev/null
"$alia" settings general onboardingCompletedAt "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" > /dev/null
"$alia" settings general telemetryEnabled false > /dev/null

cp "$checkout/scripts/demo/agent.mjs" "$agent_dir/agent.mjs"
cd "$agent_dir" && { [ -f package.json ] || echo '{ "private": true }' > package.json; }
npm i @modelcontextprotocol/sdk@1 --no-audit --no-fund > /dev/null 2>&1
"$alia" plugin config provider-acp set customAgents "[{\"id\":\"demo\",\"displayName\":\"Demo agent\",\"command\":\"node\",\"args\":[\"$agent_dir/agent.mjs\"]}]" > /dev/null
sleep 3
"$alia" settings general defaultProviderId acp-demo > /dev/null

"$alia" box setup docker | tail -1
"$alia" box config show --json > "$fresh/config.json"
python3 - "$fresh/config.json" <<'EOF'
import json, sys
path = sys.argv[1]
config = json.load(open(path))
docker = next(backend for backend in config["backends"] if backend["type"] == "docker")
docker["fields"]["desktop-image"] = "aliabox/linux-desktop:1"
docker["fields"]["linux-image"] = ""
microsandbox = {"id": "microsandbox", "type": "microsandbox", "enabled": True, "fields": {"desktop-image": ""}}
config["backends"] = [microsandbox] + [backend for backend in config["backends"] if backend["type"] != "microsandbox"]
json.dump(config, open(path, "w"))
EOF
"$alia" box config apply "$fresh/config.json" | tail -1
"$alia" box option set monitor.refreshIntervalSeconds=2 | tail -1
machine=$("$alia" machine list --json | python3 -c "import json, sys; print(next(m['name'] for m in json.load(sys.stdin) if m.get('machineProviderId') is None))")
"$alia" box docker-build "$machine" > "$fresh/docker-build.log" 2>&1
tail -3 "$fresh/docker-build.log"
echo "stage ready: $machine"
