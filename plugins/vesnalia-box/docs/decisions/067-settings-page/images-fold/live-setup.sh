#!/bin/sh
set -e
cd "$HOME"
port=7801
mkdir -p shim aliadata
cp alia-box/docs/decisions/067-settings-page/images-fold/docker-shim.sh shim/docker
chmod +x shim/docker
sudo iptables -I INPUT -i eth0 -p tcp --dport $port -j DROP
sudo iptables -I INPUT -i eth0 -p tcp --dport $((port + 1)) -j DROP

cat > start-alia.sh <<SCRIPT
#!/bin/sh
cd "\$HOME"
exec env -i HOME=$HOME PATH=$HOME/shim:/usr/local/bin:/usr/bin:/bin ALIA_BOX_LIVE_CHECKS=1 npx -y alia-app@0.48.1 --bundled --no-in-app-updates --data-dir $HOME/aliadata --server-port $port --host-daemon-port $((port + 1))
SCRIPT
chmod +x start-alia.sh
nohup ./start-alia.sh > alia.log 2>&1 &
until curl -s -o /dev/null http://127.0.0.1:$port/; do sleep 1; done
until [ -x aliadata/bin/alia ]; do sleep 1; done

cat > aliac <<SCRIPT
#!/bin/sh
exec env -i HOME=$HOME PATH=$HOME/shim:/usr/local/bin:/usr/bin:/bin ALIA_HOST_DAEMON_PORT=$((port + 1)) ALIA_SERVER_URL=http://127.0.0.1:$port ALIA_DATA_DIR=$HOME/aliadata $HOME/aliadata/bin/alia "\$@"
SCRIPT
chmod +x aliac

./aliac plugin install "path:$HOME/alia-box" --yes
./aliac box setup docker

for each in b c d e f g; do sudo ln -sf /var/run/docker.sock /run/alia-docker-$each.sock; done
printf 'FROM aliabox/linux:1\nLABEL aliabox.image-record=""\n' | docker build -q -t alia-live/due:1 - > /dev/null
printf 'FROM aliabox/linux:1\nLABEL aliabox.image-record=""\n' | docker build -q -t alia-live/fails:1 - > /dev/null
node alia-box/docs/decisions/067-settings-page/images-fold/add-backends.mjs
./aliac box images build docker:g/alia-live/fails:1 || true
