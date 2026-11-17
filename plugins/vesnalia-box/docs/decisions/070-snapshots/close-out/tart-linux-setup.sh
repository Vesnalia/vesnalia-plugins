#!/bin/sh
set -e
[ $# -eq 4 ] || { echo "usage: tart-linux-setup.sh <user@mac> <known_hosts file> <private key file> <Linux image>"; exit 2; }
mac=$1 known=$2 key=$3 image=$4
cd "$HOME"
port=7801
dev=$(ip -4 route show default | awk '{print $5; exit}')
address=$(ip -4 -o addr show "$dev" | awk '{print $4}' | cut -d/ -f1)
version=${ALIA_APP_VERSION:-latest}
mkdir -p aliadata
sudo iptables -I INPUT -i "$dev" -p tcp --dport $port -j DROP || echo "no iptables here: ALIA's ports are open to its network"
sudo iptables -I INPUT -i "$dev" -p tcp --dport $((port + 1)) -j DROP || :
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
./aliac box backend add tart --no-doctor --secret-file "ssh-private-key=$key" \
  --field macos-image= --field macos-desktop-image= --field windows-image= --field ios-image= --field linux-desktop-image= \
  --field "linux-image=$image" --field reserve-disk-gib=60 --warm linux-arm64=0
./aliac box backend host add tart mac1 --field "address=${mac#*@}" --field "user=${mac%@*}" --field-file "host-keys=$known"
./aliac box option set general.identityResetBackends=tart
./aliac --version
echo "ALIA on http://$address:$port, CLI ~/aliac"
