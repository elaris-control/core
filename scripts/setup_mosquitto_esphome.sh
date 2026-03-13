#!/usr/bin/env bash
set -euo pipefail

CONF_DIR="/etc/mosquitto/conf.d"
CONF_FILE="$CONF_DIR/elaris.conf"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo bash scripts/setup_mosquitto_esphome.sh" >&2
  exit 1
fi

mkdir -p "$CONF_DIR"
if [[ -f "$CONF_FILE" ]]; then
  cp "$CONF_FILE" "$CONF_FILE.bak.$(date +%Y%m%d_%H%M%S)"
fi

cat > "$CONF_FILE" <<'EOF'
listener 1883 0.0.0.0
allow_anonymous true
EOF

systemctl restart mosquitto
systemctl is-active --quiet mosquitto

echo
echo "Mosquitto LAN listener configured:"
echo "  $CONF_FILE"
echo
ss -ltnp | grep 1883 || true
