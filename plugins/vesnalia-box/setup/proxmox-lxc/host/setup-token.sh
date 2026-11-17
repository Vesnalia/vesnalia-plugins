#!/bin/bash
# The alia-box plugin's Proxmox identity: a pool, a user with no password, an
# API token with privilege separation, a role with only what the plugin uses,
# and ACLs on the pool, the storage and the box bridge. Writes the token to
# ALIABOX_TOKEN_FILE (0600) and never prints the secret.
#
# Idempotent; an existing token is kept (delete it with
# `pveum user token remove` to make a new one).
# usage: setup-token.sh
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=common.sh
. "$here/common.sh"
command -v jq >/dev/null || die "jq is required (apt install jq)"
tokenid="$ALIABOX_API_USER!$ALIABOX_API_TOKEN"

pveum pool list --output-format json | jq -e --arg p "$ALIABOX_POOL" '.[] | select(.poolid == $p)' >/dev/null ||
  pveum pool add "$ALIABOX_POOL" --comment "alia-box: CT templates and boxes"

# What the plugin does with boxes in the pool: linked-clone a template, set
# cores, memory, disk size, the network, description and tags, clear the
# protection a clone inherits, start, stop, delete, read status and config,
# and list the pool. For Windows VMs (Proxmox QEMU) it also sets the SMBIOS
# serial, which carries the box's address, and opens the console. It takes,
# deletes and restores a box's snapshots.
privs="VM.Audit,VM.Clone,VM.Allocate,VM.Config.CPU,VM.Config.Memory,VM.Config.Disk,VM.Config.Network,VM.Config.Options,VM.Config.HWType,VM.Console,VM.PowerMgmt,VM.Snapshot,VM.Snapshot.Rollback,Pool.Audit"
if pveum role list --output-format json | jq -e --arg r "$ALIABOX_API_ROLE" '.[] | select(.roleid == $r)' >/dev/null; then
  pveum role modify "$ALIABOX_API_ROLE" --privs "$privs"
else
  pveum role add "$ALIABOX_API_ROLE" --privs "$privs"
fi

# Reading the node's memory, disk and network (capacity guard and doctor).
if pveum role list --output-format json | jq -e --arg r "$ALIABOX_API_ROLE-node" '.[] | select(.roleid == $r)' >/dev/null; then
  pveum role modify "$ALIABOX_API_ROLE-node" --privs Sys.Audit
else
  pveum role add "$ALIABOX_API_ROLE-node" --privs Sys.Audit
fi

pveum user list --output-format json | jq -e --arg u "$ALIABOX_API_USER" '.[] | select(.userid == $u)' >/dev/null ||
  pveum user add "$ALIABOX_API_USER" --comment "alia-box plugin; API token only, no password"

if ! pveum user token list "$ALIABOX_API_USER" --output-format json |
  jq -e --arg t "$ALIABOX_API_TOKEN" '.[] | select(.tokenid == $t)' >/dev/null; then
  secret=$(pveum user token add "$ALIABOX_API_USER" "$ALIABOX_API_TOKEN" --privsep 1 \
    --comment "alia-box plugin: boxes in pool $ALIABOX_POOL" --output-format json | jq -er .value)
  fingerprint=$(openssl x509 -in /etc/pve/local/pve-ssl.pem -noout -fingerprint -sha256 | cut -d= -f2)
  address=$(ip -o -4 route get 1.1.1.1 | sed -n 's/.* src \([0-9.]*\).*/\1/p')
  install -d -m 0700 "$(dirname "$ALIABOX_TOKEN_FILE")"
  umask 077
  cat >"$ALIABOX_TOKEN_FILE.tmp" <<EOF
# alia-box plugin: Proxmox API access. Secret: keep 0600.
# Header: Authorization: PVEAPIToken=\${PROXMOX_TOKEN_ID}=\${PROXMOX_TOKEN_SECRET}
PROXMOX_API_URL=https://$address:8006/api2/json
PROXMOX_NODE=$ALIABOX_NODE
PROXMOX_TOKEN_ID=$tokenid
PROXMOX_TOKEN_SECRET=$secret
# pveproxy's certificate is signed by the cluster's own CA (/etc/pve/pve-root-ca.pem).
PROXMOX_TLS_SHA256_FINGERPRINT=$fingerprint
EOF
  mv "$ALIABOX_TOKEN_FILE.tmp" "$ALIABOX_TOKEN_FILE"
  unset secret
  echo "created token $tokenid in $ALIABOX_TOKEN_FILE"
else
  echo "token $tokenid already exists; $ALIABOX_TOKEN_FILE kept"
fi

# With privilege separation a token has the intersection of its own ACLs and
# its user's, so both get the same ones. Clone needs VM.Clone on the template
# and VM.Allocate on the pool, Datastore.AllocateSpace on the storage and
# SDN.Use on the bridge.
for who in "$ALIABOX_API_USER" "$tokenid"; do
  flag=--users
  [ "$who" = "$ALIABOX_API_USER" ] || flag=--tokens
  pveum acl modify "/pool/$ALIABOX_POOL" "$flag" "$who" --roles "$ALIABOX_API_ROLE"
  pveum acl modify "/storage/$ALIABOX_STORAGE" "$flag" "$who" --roles PVEDatastoreUser
  pveum acl modify "/sdn/zones/localnetwork/$ALIABOX_BRIDGE" "$flag" "$who" --roles PVESDNUser
  pveum acl modify "/nodes/$ALIABOX_NODE" "$flag" "$who" --roles "$ALIABOX_API_ROLE-node"
done
pveum acl list --output-format json |
  jq -r --arg u "$ALIABOX_API_USER" '.[] | select(.ugid | startswith($u)) | "  \(.path)  \(.ugid)  \(.roleid)"'
