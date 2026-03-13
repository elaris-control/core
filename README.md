<p align="center">
  <img src="./assets/logo.png" alt="ELARIS Logo" width="140" />
</p>

<h1 align="center">ELARIS Core</h1>

<p align="center"><strong>Modular automation engine for home, building, and light industrial control.</strong></p>

ELARIS Core is the open foundation of the ELARIS ecosystem — a runtime automation platform built around MQTT device integration, a role-aware control model, and a modular logic system designed for real installations.

---

## What it does

- Discovers and manages ESP32-based I/O nodes over MQTT
- Runs automation modules (lighting, climate, shading, energy, scenes)
- Provides a web-based UI for daily control and engineering commissioning
- Supports multi-zone, multi-site configurations
- Integrates with ESPHome for firmware generation and flashing

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
- **Hardware:** ESP32 + Kincony KC868 series I/O boards
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

- Generate and flash firmware for supported boards
- Browse 750+ community device profiles
- Build YAML configs for peripheral sensors (Peripheral Library)
- Flash over USB or OTA

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
