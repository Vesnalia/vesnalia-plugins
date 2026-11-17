# Shared by alia-box's Proxmox host scripts: reads /etc/alia-box/alia-box.env (or
# $ALIABOX_ENV) and fills in defaults. Sourced, not run.
# shellcheck shell=bash

ALIABOX_ENV=${ALIABOX_ENV:-/etc/alia-box/alia-box.env}
if [ -f "$ALIABOX_ENV" ]; then
  # Settings already in the environment win over the file, so one run can
  # override one value (for example ALIABOX_BUILD_ADDRESS for a second build).
  _aliabox_set=$(declare -p $(compgen -v ALIABOX_) 2>/dev/null || true)
  # shellcheck disable=SC1090
  . "$ALIABOX_ENV"
  eval "$_aliabox_set"
  unset _aliabox_set
fi

ALIABOX_NODE=${ALIABOX_NODE:-$(hostname)}
ALIABOX_POOL=${ALIABOX_POOL:-aliabox}
ALIABOX_STORAGE=${ALIABOX_STORAGE:-local-lvm}
ALIABOX_OS_TEMPLATE=${ALIABOX_OS_TEMPLATE:-local:vztmpl/ubuntu-24.04-standard_24.04-2_amd64.tar.zst}
ALIABOX_OS_TEMPLATE_WAYLAND=${ALIABOX_OS_TEMPLATE_WAYLAND:-local:vztmpl/ubuntu-26.04-standard_26.04-1_amd64.tar.zst}
ALIABOX_BRIDGE=${ALIABOX_BRIDGE:-vmbr200}
ALIABOX_GATEWAY_CIDR=${ALIABOX_GATEWAY_CIDR:-10.200.0.1/24}
ALIABOX_BUILD_ADDRESS=${ALIABOX_BUILD_ADDRESS:-10.200.0.2}
ALIABOX_BUILD_VMID=${ALIABOX_BUILD_VMID:-}
ALIABOX_GPU_REPORT_VMID=${ALIABOX_GPU_REPORT_VMID:-}
ALIABOX_DNS=${ALIABOX_DNS:-1.1.1.1 9.9.9.9}
ALIABOX_DNAT=${ALIABOX_DNAT:-}
ALIABOX_ALIA_URL=${ALIABOX_ALIA_URL:-}
ALIABOX_ALIA_RESOLVE=${ALIABOX_ALIA_RESOLVE:-}
ALIABOX_SSH_KEY=${ALIABOX_SSH_KEY:-/root/alia-box/ssh/id_ed25519}
ALIABOX_API_USER=${ALIABOX_API_USER:-aliabox@pve}
ALIABOX_API_TOKEN=${ALIABOX_API_TOKEN:-plugin}
ALIABOX_API_ROLE=${ALIABOX_API_ROLE:-AliaBoxPlugin}
ALIABOX_TOKEN_FILE=${ALIABOX_TOKEN_FILE:-/root/alia-box/proxmox-token.env}

ALIABOX_GATEWAY=${ALIABOX_GATEWAY_CIDR%/*}
ALIABOX_PREFIX=${ALIABOX_GATEWAY_CIDR#*/}

die() {
  echo "${0##*/}: $*" >&2
  exit 1
}

# The subnet in CIDR form, for example 10.200.0.0/24.
aliabox_subnet() {
  python3 -c 'import ipaddress, sys; print(ipaddress.ip_interface(sys.argv[1]).network)' "$ALIABOX_GATEWAY_CIDR"
}

[ "$(id -u)" = 0 ] || die "run as root on the Proxmox host"
