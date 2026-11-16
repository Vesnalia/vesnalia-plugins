#!/bin/sh
set -e
cd "$HOME"
port=7801
address=$(ip -4 -o addr show eth0 | awk '{print $4}' | cut -d/ -f1)
version=${ALIA_APP_VERSION:-latest}
mkdir -p bbdata live-results/shots

sudo iptables -I INPUT -i eth0 -p tcp --dport $port -j DROP
sudo iptables -I INPUT -i eth0 -p tcp --dport $((port + 1)) -j DROP

cat > start-alia.sh <<SCRIPT
#!/bin/sh
cd "\$HOME"
exec env -i HOME=$HOME PATH=/usr/local/bin:/usr/bin:/bin ALIA_BOX_LIVE_CHECKS=1 npx -y alia-app@$version --bundled --no-in-app-updates --data-dir $HOME/bbdata --server-bind-host 0.0.0.0 --server-port $port --host-daemon-port $((port + 1))
SCRIPT
chmod +x start-alia.sh
nohup ./start-alia.sh > alia.log 2>&1 &
until curl -s -o /dev/null http://127.0.0.1:$port/; do sleep 1; done
until [ -x bbdata/bin/alia ]; do sleep 1; done

cat > bbc <<SCRIPT
#!/bin/sh
exec env -i HOME=$HOME PATH=/usr/local/bin:/usr/bin:/bin ALIA_HOST_DAEMON_PORT=$((port + 1)) ALIA_SERVER_URL=http://127.0.0.1:$port ALIA_DATA_DIR=$HOME/bbdata $HOME/bbdata/bin/alia "\$@"
SCRIPT
chmod +x bbc

./bbc plugin install "path:$HOME/alia-box" --yes
./bbc settings general machineServerUrl "http://$address:$port"
./bbc settings general defaultMachineAccess direct

mkdir -p live && (cd live && npm init -y > /dev/null && npm i playwright@1 > /dev/null 2>&1 && sudo npx playwright install-deps chromium > /dev/null 2>&1 && npx playwright install chromium > /dev/null 2>&1)
cp alia-box/docs/decisions/070-snapshots/unit-6/*.mjs live/ 2>/dev/null || true
./bbc --version
