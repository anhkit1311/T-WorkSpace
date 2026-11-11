#!/bin/sh
# Copies the versioned config into /etc/asterisk and writes the parts that carry secrets or depend on
# the host (ARI user, spike extensions, external address) from environment variables.
set -eu

: "${ARI_PASSWORD:?ARI_PASSWORD is required}"
: "${SPIKE_SIP_PASSWORD:?SPIKE_SIP_PASSWORD is required}"
EXTERNAL_IP="${EXTERNAL_IP:-127.0.0.1}"
ARI_ORIGINS="${ARI_ALLOWED_ORIGINS:-http://localhost:5173}"

if [ "${#SPIKE_SIP_PASSWORD}" -lt 12 ]; then
  echo "SPIKE_SIP_PASSWORD must be at least 12 characters" >&2
  exit 1
fi

cp /opt/tws-asterisk/*.conf /etc/asterisk/

cat > /etc/asterisk/ari.conf <<EOF
[general]
enabled = yes
pretty = no
allowed_origins = ${ARI_ORIGINS}

[tworkspace]
type = user
read_only = no
password = ${ARI_PASSWORD}
EOF

# Addresses Asterisk must advertise instead of the container's private one.
cat >> /etc/asterisk/pjsip.conf <<EOF

[transport-udp](+)
external_media_address = ${EXTERNAL_IP}
external_signaling_address = ${EXTERNAL_IP}
local_net = 127.0.0.0/8
EOF
CONTAINER_IP="$(ip -4 -o addr show scope global | awk '{print $4}' | cut -d/ -f1 | head -n1)"
cat >> /etc/asterisk/rtp.conf <<EOF

[ice_host_candidates]
${CONTAINER_IP} => ${EXTERNAL_IP}
EOF

# Spike extensions (plan week 1): two softphones over UDP and one browser over WebSocket.
# Real extensions are created on the web and pushed over ARI (CC-2).
{
  for ext in 1001 1002; do
    printf '\n[%s](sip-endpoint)\nauth = %s\naors = %s\ncallerid = "Spike %s" <%s>\n' "$ext" "$ext" "$ext" "$ext" "$ext"
    printf '\n[%s](auth-userpass)\nusername = %s\npassword = %s\n' "$ext" "$ext" "$SPIKE_SIP_PASSWORD"
    printf '\n[%s](aor-single)\n' "$ext"
  done
  printf '\n[1101](webrtc-endpoint)\nauth = 1101\naors = 1101\ncallerid = "Web 1101" <1101>\n'
  printf '\n[1101](auth-userpass)\nusername = 1101\npassword = %s\n' "$SPIKE_SIP_PASSWORD"
  printf '\n[1101](aor-single)\n'
} > /etc/asterisk/pjsip_spike.conf

# SIP trunk for the hotline number (CC-4), only when the provider account is set. It has its own
# transport without external addresses: the provider sits outside our NAT and answers to where
# packets come from (rport), and the short registration keeps that NAT binding open. Providers that
# send INVITEs to the registered Contact instead (Pitel) need TRUNK_PUBLIC_IP plus UDP 5070
# forwarded on the router to this machine; media stays symmetric (outbound calls already work).
# shortcut: without router access, TRUNK_PUBLIC_PORT = the NAT port the provider sees (rport in the
# REGISTER reply); it holds while registration keeps the binding alive, recheck after a modem restart.
: > /etc/asterisk/pjsip_trunk.conf
if [ -n "${TRUNK_USERNAME:-}" ]; then
  : "${TRUNK_PASSWORD:?TRUNK_PASSWORD is required with TRUNK_USERNAME}"
  : "${TRUNK_SERVER:?TRUNK_SERVER (host:port) is required with TRUNK_USERNAME}"
  : "${TRUNK_NUMBER:?TRUNK_NUMBER (the hotline number) is required with TRUNK_USERNAME}"
  TRUNK_HOST="${TRUNK_SERVER%%:*}"
  cat > /etc/asterisk/pjsip_trunk.conf <<EOF
[transport-trunk]
type = transport
protocol = udp
bind = 0.0.0.0:5070
${TRUNK_PUBLIC_IP:+external_signaling_address = ${TRUNK_PUBLIC_IP}
external_signaling_port = ${TRUNK_PUBLIC_PORT:-5070}
local_net = 10.0.0.0/8
local_net = 172.16.0.0/12
local_net = 192.168.0.0/16
}
[trunk-auth]
type = auth
auth_type = userpass
username = ${TRUNK_USERNAME}
password = ${TRUNK_PASSWORD}

[trunk]
type = registration
transport = transport-trunk
outbound_auth = trunk-auth
server_uri = sip:${TRUNK_SERVER}
client_uri = sip:${TRUNK_USERNAME}@${TRUNK_SERVER}
contact_user = ${TRUNK_USERNAME}
expiration = 120
retry_interval = 30
forbidden_retry_interval = 300
line = yes
endpoint = trunk

[trunk]
type = aor
contact = sip:${TRUNK_SERVER}
qualify_frequency = 30

[trunk]
type = endpoint
transport = transport-trunk
context = from-trunk
disallow = all
allow = alaw,ulaw
outbound_auth = trunk-auth
aors = trunk
from_user = ${TRUNK_USERNAME}
from_domain = ${TRUNK_HOST}
direct_media = no
rtp_symmetric = yes
force_rport = yes
rewrite_contact = yes

; Only the provider may send calls to this endpoint.
[trunk]
type = identify
endpoint = trunk
match = ${TRUNK_HOST}
EOF
fi

chown -R asterisk:asterisk /etc/asterisk
chmod 600 /etc/asterisk/ari.conf /etc/asterisk/pjsip_spike.conf /etc/asterisk/pjsip_trunk.conf

exec /usr/sbin/asterisk -f -U asterisk -G asterisk -vvv
