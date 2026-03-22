<p align="center">
  <img src="./assets/logo.png" alt="ELARIS Logo" width="140" />
</p>

<h1 align="center">ELARIS Core</h1>

<p align="center"><strong>Modular automation engine for home, building, and light industrial control.</strong></p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.3.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/node-20+-green" alt="Node">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License">
  <img src="https://img.shields.io/badge/platform-Raspberry%20Pi-red" alt="Platform">
  <img src="https://img.shields.io/badge/protocol-MQTT-purple" alt="MQTT">
</p>

<p align="center">
  <a href="https://elariscontrol.online">🌐 elariscontrol.online</a>
</p>

ELARIS Core is the open foundation of the ELARIS ecosystem — a runtime automation platform built around MQTT device integration, a role-aware control model, and a modular logic system designed for real installations.

---

## What it does

**Devices & connectivity**
- Discovers and manages ESP32-based I/O nodes automatically over MQTT
- Supports Kincony KC868 series, WT32-ETH01, and any generic ESPHome board
- Real-time device state via WebSocket — no polling

**Automation**
- Runs automation modules with a 30-second tick engine
- Multi-zone, multi-site configurations
- Scenes: multi-device macros with trigger conditions
- Three-tier role model: User / Engineer / Admin

**ESPHome integration (v0.3)**
- Browse 750+ community device profiles from esphome.io directly in the UI
- Flash a device directly from the browser without saving to catalog first
- Generate and flash custom firmware over USB serial or OTA
- Peripheral Library: 22 sensor types (temperature, humidity, CO₂, flow, PIR, soil, wind, and more)
- Add peripherals to existing firmware via OTA — no USB re-flash required
- Board profile manager: create, edit, clone, and export custom profiles
- **Use My YAML** — bring your own ESPHome YAML, let ELARIS inject its MQTT overlay and flash it
- **Native API import** — connect to any existing ESPHome device over the native API (port 6053) without reflashing; supports both plaintext and Noise-encrypted devices
- **External read-only mode** — monitor a third-party ESPHome device's entities without taking ownership of it

**Platform**
- Web-based UI — no app, no build step, works from any browser on the local network
- Runs on Raspberry Pi 3/4/5 under PM2 or systemd
- Dark / light theme — follows system preference, toggleable on every page including login

---

## Modules included in Core

| Module | Description |
|--------|-------------|
| Lighting Control | PIR-based, lux sensor, schedule, dimmer |
| Smart Lighting | Scene-based moods, adaptive dimming, fade |
| Awning / Blind | Wind lockout, sun shading, position tracking |
| Thermostat | Multi-zone heating/cooling, window detection |
| Energy Monitor | Power tracking, tariff rates, peak detection |
| Presence Simulator | Anti-theft lighting/blind patterns |
| Maintenance Tracker | Service intervals, filter alerts |
| Scenes | Multi-device macros with trigger conditions |

Additional modules (Solar, Pool, Irrigation, Hydronic, Load Shifting, Custom Logic) are part of **ELARIS Pro**.

---

## Tech stack

- **Runtime:** Node.js 20+
- **Database:** SQLite (via better-sqlite3)
- **Protocol:** MQTT (Mosquitto)
- **Hardware:** ESP32 / ESP8266 — Kincony KC868 series, WT32-ETH01, generic boards
- **Firmware:** ESPHome (auto-generated YAML, OTA flashing)
- **Frontend:** Vanilla HTML/CSS/JS — no build step

---

## Quick start (Raspberry Pi)

```bash
# 1. Clone
git clone https://github.com/elaris-control/core.git
cd core

# 2. Install dependencies
npm install

# 3. Create environment file
cp .env.example .env
# Edit .env — set your MQTT broker URL

# 4. Start
npm start
```

Open `http://<PI_IP>:8080` — first run will prompt you to create an admin account.

For full installation instructions (Node.js setup, Mosquitto, systemd service, ESPHome):

```bash
sudo bash install.sh
```

See [INSTALL.md](INSTALL.md) for details.

---

## Role model

ELARIS uses a three-tier role system:

| Role | Access |
|------|--------|
| **User** | Daily control — scenes, overrides, status |
| **Engineer** | Commissioning — device setup, module config, IO mapping |
| **Admin** | System management — users, sites, database |

Engineer access is protected by a separate unlock code, keeping commissioning controls away from daily users.

---

## Device integration

ELARIS discovers ESP32 devices automatically over MQTT using a lightweight discovery protocol. Supported hardware:

- **Kincony KC868-A4 / A8 / A16 / A32** — relay + digital input boards
- **Generic ESP32** — any ESPHome-based device
- **WT32-ETH01** — Ethernet-capable ESP32 module
- **Peripheral sensors** — anemometer, rain, CO2, temperature, flow, and more (via ESPHome Peripheral Library)

---

## ESPHome integration

The built-in ESPHome page (`/esphome.html`) lets you:

- **Browse** 750+ community device profiles from esphome.io (cached, searchable)
- **Flash directly** from the browser — no need to import to catalog first
- **Generate** custom firmware for any ESP32/ESP8266 board
- **Peripheral Library** — add 22 sensor/actuator types to existing devices via OTA
- **Import** YAML configs from URL or paste — auto-parsed into the board catalog
- **Manage** board profiles: create, edit, clone, export
- Flash over **USB serial** or **OTA** (Ethernet or WiFi)

### Use My YAML

Already have an ESPHome YAML? Use the **Use My YAML** flow:

1. Paste your YAML in the installer
2. ELARIS parses it, detects WiFi/Ethernet, and injects its MQTT announce overlay
3. Optionally add extra peripherals (sensors, inputs) before flashing
4. Flash over USB or OTA — device appears in ELARIS automatically

> Your YAML stays intact. ELARIS only appends its managed MQTT block.

### Native API import (external devices)

For devices already flashed with ESPHome official firmware (not flashed by ELARIS):

1. Open the installer and select or create a device card
2. Click **Native Import** — enter the device IP and optional encryption key
3. ELARIS connects over the ESPHome native API (port 6053), reads all entities, and imports them
4. Choose **read-only** (monitor only) or **managed** (ELARIS takes ownership)

**Encryption:** If your device YAML has `api: encryption: key: !secret ...`, find the actual key in your `secrets.yaml` file (on the machine that compiled the firmware, or in the Home Assistant ESPHome addon at `/config/esphome/secrets.yaml`). Enter it once — ELARIS stores it in the database and uses it automatically on all future connections.

**No encryption** (recommended for local networks): Remove the `api: encryption:` block from your YAML and reflash. After that, native import works with no key required.

---

## Project structure

```
src/
├── automation/       # Module logic (engine + handlers)
├── modules/          # Module registry + API routes
├── esphome/          # Firmware generation + board profiles
├── core/control/     # Control algorithms (PI, hysteresis, EMA, ramp)
└── index.js          # Server entry point

public/               # Web UI (HTML, CSS, JS — no build step)
scripts/              # CLI utilities (admin recovery, DB tools)
docs/                 # Architecture and protocol documentation
```

---

## Admin tools

The admin panel (`/admin.html`) includes:

- **Users & roles** — create/manage users, assign sites, set roles
- **Sites** — multi-site support
- **Runtime debug** — toggle MQTT debug logging, tune ESPHome stale thresholds, set sensor/event history retention, rebuild history rollups
- **Stale MQTT retained messages** — clear retained topics published by old or removed ESPHome devices that are no longer in ELARIS. These accumulate in the broker and generate `registry_miss` log entries. Use Refresh + Clear to remove them permanently.
- **Database management** — browse devices, pending IOs, board profiles; repair DB; erase all data

## Documentation

| Doc | Contents |
|-----|----------|
| [INSTALL.md](INSTALL.md) | Raspberry Pi setup guide |
| [MODULES.md](MODULES.md) | Module reference — IOs, setpoints, logic |
| [DISCOVERY.md](DISCOVERY.md) | MQTT device discovery protocol |
| [docs/AUTH_MODEL.md](docs/AUTH_MODEL.md) | Authentication and role architecture |
| [docs/ROUTE_ACCESS_MATRIX.md](docs/ROUTE_ACCESS_MATRIX.md) | API endpoint permissions |

---

## Roadmap

- [ ] Alarm system module
- [ ] HVAC / split unit control
- [ ] EV charger manager
- [ ] Generator manager
- [ ] Hot water recirculation
- [ ] Remote access (Tailscale integration)
- [ ] HTTPS / self-signed cert setup helper

---

## License

ELARIS Core is released under the **MIT License**.

Pro modules (Solar, Pool & Spa, Irrigation, Hydronic, Load Shifter, Custom Logic Engine) are licensed separately under a commercial license.

---

## ELARIS Ecosystem

| Repository | Description |
|------------|-------------|
| [core](https://github.com/elaris-control/core) | This repository — open automation engine |
| elaris-pro *(private)* | Advanced modules — solar, pool, irrigation, hydronic |
| elaris-nodes *(coming)* | ESP32 firmware templates for common hardware |

---

Built for real installations. Not for demos.
