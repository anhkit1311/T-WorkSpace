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

cp /opt/nexo-asterisk/*.conf /etc/asterisk/

cat > /etc/asterisk/ari.conf <<EOF
[general]
enabled = yes
pretty = no
allowed_origins = ${ARI_ORIGINS}

[nexo]
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

chown -R asterisk:asterisk /etc/asterisk
chmod 600 /etc/asterisk/ari.conf /etc/asterisk/pjsip_spike.conf

exec /usr/sbin/asterisk -f -U asterisk -G asterisk -vvv
