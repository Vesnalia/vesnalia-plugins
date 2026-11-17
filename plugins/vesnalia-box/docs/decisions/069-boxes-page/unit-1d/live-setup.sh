#!/bin/sh
set -e
cd "$HOME"
port=7801
address=$(ip -4 -o addr show eth0 | awk '{print $4}' | cut -d/ -f1)
mkdir -p aliadata live-results

sudo iptables -I INPUT -i eth0 -p tcp --dport $port -j DROP
sudo iptables -I INPUT -i eth0 -p tcp --dport $((port + 1)) -j DROP

cat > start-alia.sh <<SCRIPT
#!/bin/sh
cd "\$HOME"
exec env -i HOME=$HOME PATH=/usr/local/bin:/usr/bin:/bin npx -y alia-app@0.48.0 --bundled --no-in-app-updates --data-dir $HOME/aliadata --server-bind-host 0.0.0.0 --server-port $port --host-daemon-port $((port + 1))
SCRIPT
chmod +x start-alia.sh
nohup ./start-alia.sh > alia.log 2>&1 &
until curl -s -o /dev/null http://127.0.0.1:$port/; do sleep 1; done
until [ -x aliadata/bin/alia ]; do sleep 1; done

cat > aliac <<SCRIPT
#!/bin/sh
exec env -i HOME=$HOME PATH=/usr/local/bin:/usr/bin:/bin ALIA_HOST_DAEMON_PORT=$((port + 1)) ALIA_SERVER_URL=http://127.0.0.1:$port ALIA_DATA_DIR=$HOME/aliadata $HOME/aliadata/bin/alia "\$@"
SCRIPT
chmod +x aliac

./aliac plugin install "path:$HOME/alia-box" --yes
./aliac settings general machineServerUrl "http://$address:$port"
./aliac settings general defaultMachineAccess direct
./aliac box setup docker
./aliac box backend set docker --field reserve-memory-mib=512 --no-doctor

mkdir -p agent && cp alia-box/docs/decisions/069-boxes-page/unit-1b/acp-agent.mjs agent/
(cd agent && npm init -y > /dev/null && npm i @modelcontextprotocol/sdk@1 > /dev/null 2>&1)
./aliac plugin config provider-acp set customAgents "[{\"id\":\"tools\",\"displayName\":\"Tool caller\",\"command\":\"/usr/local/bin/node\",\"args\":[\"$HOME/agent/acp-agent.mjs\"]}]"
cp alia-box/docs/decisions/069-boxes-page/unit-1c/agent-call.sh . && chmod +x agent-call.sh

mkdir -p proj && (cd proj && git init -q && git -c user.email=a@example.com -c user.name=a commit -q --allow-empty -m init)
project=$(./aliac project create --name demo --root "$HOME/proj" --json | node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>console.log(JSON.parse(s).id))')
threads=""
for title in "Fix the sign-in flow" "Docs pass" "Run the tests"; do
  before=$(cat agent-trace.log 2>/dev/null | grep -c "result box_list" || true)
  thread=$(./aliac thread spawn --project "$project" --environment "$HOME/proj" --provider acp-tools --prompt "$title. CALL box_list" --json | node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>console.log(JSON.parse(s).id))')
  until [ "$(grep -c "result box_list" agent-trace.log 2>/dev/null || echo 0)" -gt "$before" ]; do sleep 1; done
  for n in 1 2 3; do ./agent-call.sh "$thread" box_acquire '{"kind":"linux","memory_gib":2}'; done
  threads="$threads $thread"
done
./aliac box machines add linux --name workbench --memory-gib 2 > /dev/null

mkdir -p live && (cd live && npm init -y > /dev/null && npm i playwright@1 > /dev/null 2>&1 && sudo npx playwright install-deps chromium > /dev/null 2>&1 && npx playwright install chromium > /dev/null 2>&1)
cp alia-box/docs/decisions/069-boxes-page/unit-1c/live-lib.mjs alia-box/docs/decisions/069-boxes-page/unit-1d/live-check.mjs alia-box/docs/decisions/069-boxes-page/unit-1d/runs.sh live/
chmod +x live/runs.sh
printf 'export LIVE_THREADS="%s"\n' "$threads" > live/env.sh
cat live/env.sh
