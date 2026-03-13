#!/usr/bin/env bash
# ELARIS — Automated installer
# Tested on Raspberry Pi OS (Bookworm 64-bit) and Debian/Ubuntu 22.04+
# Usage: bash install.sh [--no-esphome] [--no-service]
set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

ok()   { echo -e "${GREEN}  ✓ $*${RESET}"; }
info() { echo -e "${CYAN}  → $*${RESET}"; }
warn() { echo -e "${YELLOW}  ! $*${RESET}"; }
die()  { echo -e "${RED}  ✗ $*${RESET}" >&2; exit 1; }
hdr()  { echo -e "\n${BOLD}$*${RESET}"; }

# ── Defaults ─────────────────────────────────────────────────────────────────
SKIP_ESPHOME=false
SKIP_SERVICE=false
for arg in "$@"; do
  case $arg in
    --no-esphome) SKIP_ESPHOME=true ;;
    --no-service) SKIP_SERVICE=true ;;
  esac
done

# ── Resolve paths ─────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR"
REAL_USER="${SUDO_USER:-$USER}"
REAL_HOME=$(eval echo "~$REAL_USER")

[[ -f "$PROJECT_DIR/package.json" ]] || die "Run this script from the elaris project root (package.json not found)"

echo -e "\n${BOLD}╔══════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║        ELARIS — Installer            ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════╝${RESET}"
echo ""
info "Project dir : $PROJECT_DIR"
info "User        : $REAL_USER"
info "Home        : $REAL_HOME"

# ── Must run as root ──────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  die "Please run with sudo:  sudo bash install.sh"
fi

# ── 1. System update ──────────────────────────────────────────────────────────
hdr "Step 1 — System update"
info "Running apt update..."
apt-get update -qq
ok "Package lists updated"

# ── 2. Node.js 20 ────────────────────────────────────────────────────────────
hdr "Step 2 — Node.js 20"
NODE_VER=$(node --version 2>/dev/null || true)
NODE_MAJOR=$(echo "$NODE_VER" | grep -oP '(?<=v)\d+' || echo 0)

if [[ "$NODE_MAJOR" -ge 20 ]]; then
  ok "Node.js $NODE_VER already installed"
else
  info "Installing Node.js 20 via NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
  apt-get install -y nodejs >/dev/null 2>&1
  ok "Node.js $(node --version) installed"
fi

# ── 3. Mosquitto ──────────────────────────────────────────────────────────────
hdr "Step 3 — Mosquitto MQTT broker"
if systemctl is-active --quiet mosquitto 2>/dev/null; then
  ok "Mosquitto already running"
else
  info "Installing Mosquitto..."
  apt-get install -y mosquitto mosquitto-clients >/dev/null 2>&1
  systemctl enable mosquitto >/dev/null 2>&1
  systemctl start mosquitto
  ok "Mosquitto installed and started"
fi

# Configure for LAN access (ESP boards need this)
CONF_FILE="/etc/mosquitto/conf.d/elaris.conf"
if [[ ! -f "$CONF_FILE" ]]; then
  info "Configuring Mosquitto for LAN access (0.0.0.0:1883)..."
  mkdir -p /etc/mosquitto/conf.d
  cat > "$CONF_FILE" <<'EOF'
listener 1883 0.0.0.0
allow_anonymous true
EOF
  systemctl restart mosquitto
  ok "Mosquitto LAN listener configured"
else
  ok "Mosquitto LAN config already present"
fi

# ── 4. Python tools (needed for ESPHome) ─────────────────────────────────────
hdr "Step 4 — Python tools"
info "Installing python3-pip and python3-venv..."
apt-get install -y python3-pip python3-venv >/dev/null 2>&1
ok "Python tools ready"

# dialout group for USB serial ports
if id -nG "$REAL_USER" | grep -qw dialout; then
  ok "User $REAL_USER already in dialout group"
else
  info "Adding $REAL_USER to dialout group (needed for USB flashing)..."
  usermod -aG dialout "$REAL_USER"
  warn "Group change applied — a reboot or re-login is needed for it to take effect"
fi

# ── 5. npm install ────────────────────────────────────────────────────────────
hdr "Step 5 — Node dependencies"
cd "$PROJECT_DIR"
info "Running npm install..."
sudo -u "$REAL_USER" npm install --prefer-offline 2>&1 | tail -3
info "Running npm rebuild (recompile native modules for this platform)..."
sudo -u "$REAL_USER" npm rebuild 2>&1 | tail -3
ok "Node modules ready"

# ── 6. .env file ─────────────────────────────────────────────────────────────
hdr "Step 6 — Environment config"
ENV_FILE="$PROJECT_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  ok ".env already exists — skipping (edit manually if needed)"
else
  info "Creating .env with defaults..."
  cat > "$ENV_FILE" <<EOF
PORT=8080
NODE_ENV=development
MQTT_URL=mqtt://localhost:1883
EOF
  chown "$REAL_USER:$REAL_USER" "$ENV_FILE"
  ok ".env created at $ENV_FILE"
  warn "For production, add ENGINEER_CODE / ENGINEER_SECRET / APP_SECRET to .env"
fi

# ── 7. ESPHome venv ───────────────────────────────────────────────────────────
if [[ "$SKIP_ESPHOME" == false ]]; then
  hdr "Step 7 — ESPHome (Python venv)"
  VENV_DIR="$PROJECT_DIR/data/esphome_venv"
  ESPHOME_BIN="$VENV_DIR/bin/esphome"

  mkdir -p "$PROJECT_DIR/data"
  chown "$REAL_USER:$REAL_USER" "$PROJECT_DIR/data"

  if [[ -x "$ESPHOME_BIN" ]]; then
    ESPHOME_VER=$("$ESPHOME_BIN" version 2>/dev/null || echo "unknown")
    ok "ESPHome already installed: $ESPHOME_VER"
  else
    info "Creating Python venv at $VENV_DIR..."
    sudo -u "$REAL_USER" python3 -m venv "$VENV_DIR"
    info "Installing ESPHome (this may take a few minutes)..."
    sudo -u "$REAL_USER" "$VENV_DIR/bin/pip" install --upgrade pip esphome -q
    ESPHOME_VER=$("$ESPHOME_BIN" version 2>/dev/null || echo "installed")
    ok "ESPHome $ESPHOME_VER installed"
  fi
else
  hdr "Step 7 — ESPHome"
  warn "Skipped (--no-esphome flag)"
fi

# ── 8. systemd service ────────────────────────────────────────────────────────
if [[ "$SKIP_SERVICE" == false ]]; then
  hdr "Step 8 — systemd service"
  SERVICE_FILE="/etc/systemd/system/elaris.service"

  cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=ELARIS Smart Control
After=network.target mosquitto.service

[Service]
Type=simple
User=$REAL_USER
WorkingDirectory=$PROJECT_DIR
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
RestartSec=5
EnvironmentFile=$PROJECT_DIR/.env
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable elaris >/dev/null 2>&1
  systemctl restart elaris
  sleep 2

  if systemctl is-active --quiet elaris; then
    ok "Elaris service started and enabled on boot"
  else
    warn "Service may not have started yet — check: sudo journalctl -u elaris -f"
  fi
else
  hdr "Step 8 — systemd service"
  warn "Skipped (--no-service flag)"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
PI_IP=$(hostname -I | awk '{print $1}')

echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════╗${RESET}"
echo -e "${GREEN}${BOLD}║        Installation complete!            ║${RESET}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  Open in browser:  ${BOLD}http://${PI_IP}:8080${RESET}"
echo ""
echo -e "  Useful commands:"
echo -e "    ${CYAN}sudo systemctl status elaris${RESET}      — service status"
echo -e "    ${CYAN}sudo journalctl -u elaris -f${RESET}      — live logs"
echo -e "    ${CYAN}sudo systemctl restart elaris${RESET}     — restart"
echo -e "    ${CYAN}npm run recover-admin${RESET}             — reset admin password"
echo ""
if id -nG "$REAL_USER" | grep -qw dialout; then
  true
else
  echo -e "${YELLOW}  IMPORTANT: Reboot (or log out and back in) for USB flashing to work${RESET}"
  echo -e "${YELLOW}  sudo reboot${RESET}"
  echo ""
fi
