#!/bin/sh
set -e
cd "$HOME"
port=7801
dev=$(ip -4 route show default | awk '{print $5; exit}')
address=$(ip -4 -o addr show "$dev" | awk '{print $4}' | cut -d/ -f1)
version=${ALIA_APP_VERSION:-latest}
mkdir -p aliadata

sudo iptables -I INPUT -i "$dev" -p tcp --dport $port -j DROP
sudo iptables -I INPUT -i "$dev" -p tcp --dport $((port + 1)) -j DROP

cat > start-alia.sh <<SCRIPT
#!/bin/sh
cd "\$HOME"
exec env -i HOME=$HOME PATH=/usr/local/bin:/usr/bin:/bin ALIA_BOX_LIVE_CHECKS=1 npx -y alia-app@$version --bundled --no-in-app-updates --data-dir $HOME/aliadata --server-bind-host 0.0.0.0 --server-port $port --host-daemon-port $((port + 1))
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
./aliac box backend add microsandbox --field desktop-image= --field reserve-memory-mib=2048
./aliac box option set general.identityResetBackends=microsandbox
./aliac --version
echo "ALIA on http://$address:$port, CLI ~/aliac"
