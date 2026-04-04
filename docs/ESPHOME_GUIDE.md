# ESPHome Integration Guide

This guide covers how ESPHome works inside ELARIS — flashing boards, importing YAML, adding peripherals, and using the board profile catalog.

---

## Table of Contents

1. [Overview](#overview)
2. [Three Ways to Flash an ESP32](#three-ways-to-flash-an-esp32)
3. [Method 1: Board Profile (Recommended)](#method-1-board-profile-recommended)
4. [Method 2: Use My YAML](#method-2-use-my-yaml)
5. [Method 3: Native API Import](#method-3-native-api-import)
6. [USB vs OTA Flashing](#usb-vs-ota-flashing)
7. [Important: No `!secret` Tags](#important-no-secret-tags)
8. [Board Profile Catalog](#board-profile-catalog)
9. [Adding Peripherals After Flash](#adding-peripherals-after-flash)
10. [How MQTT Entity Mapping Works](#how-mqtt-entity-mapping-works)
11. [Troubleshooting](#troubleshooting)
12. [Wiring & YAML Examples](#wiring--yaml-examples)

---

## Overview

ELARIS manages ESPHome devices through a self-contained pipeline:

```
Board Profile / YAML  →  YAML Generator / Importer  →  ESPHome Compiler  →  Flash (USB/OTA)  →  MQTT Discovery
```

The system handles everything automatically:
- Entity discovery (relays, sensors, inputs)
- MQTT topic wiring (state, telemetry, commands)
- No manual DI/DO mapping required — the parser reads your YAML and wires everything up

---

## Three Ways to Flash an ESP32

| Method | When to Use | Effort |
|--------|-------------|--------|
| **Board Profile** | You have a supported board (KinCony, WT32, etc.) | Lowest — pick board, fill form, flash |
| **Use My YAML** | You have an existing ESPHome YAML config | Medium — paste YAML, ELARIS adds MQTT layer |
| **Native API Import** | Device is already flashed and running on the network | Lowest — ELARIS discovers it and syncs |

---

## Method 1: Board Profile (Recommended)

This is the easiest path. ELARIS ships with pre-tested board profiles that know exactly how each board is wired.

### Steps

1. Go to **ESPHome** → **Flash Board**
2. Select a board from the catalog (e.g., `KinCony KC868-A16`)
3. Fill in:
   - Device name
   - WiFi SSID / password (or Ethernet if supported)
   - MQTT broker address
   - Connection (USB port or IP for OTA)
4. Add peripherals through the UI (relays, sensors, etc.)
5. Click **Flash**

### What Happens Behind the Scenes

ELARIS generates a complete ESPHome YAML from the board profile + your selections:

- `esphome`, `esp32`, `wifi`/`ethernet`, `logger`, `api`, `ota` blocks
- I2C bus, PCF8574 expanders, UART, one_wire — as defined by the profile
- All entities with correct pins, modes, and inversion
- MQTT overlay: `on_boot` config publish, `on_state`/`on_turn_on`/`on_turn_off` handlers, `on_message` command routing

The generated YAML is saved to `data/esphome/<device_name>.yaml` and compiled/flashed via `esphome run`.

### Supported Boards

These profiles are bundled and ready to go:

| Board | Relays | DI | HT | AI | Ethernet | Profile ID |
|-------|--------|----|----|----|----------|------------|
| KinCony KC868-A4 | 4 | 4 | — | — | Yes | `kincony_kc868_a4` |
| KinCony KC868-A8 | 8 | 8 | 1 | — | — | `kincony_kc868_a8` |
| KinCony KC868-A16 | 16 | 16 | 3 | 4 | Yes | `kincony_kc868_a16` |
| KinCony KC868-A32 | 32 | 32 | — | 4 | — | `kincony_kc868_a32` |
| KinCony E16S | 16 | — | — | — | Yes | `kincony_e16s` |
| WT32-ETH01 | — | — | — | — | Yes | `wt32_eth01` |
| Generic ESP32 DevKit | Raw GPIO | Raw GPIO | — | — | — | `generic_esp32dev` |

Additional profiles can be added as JSON files in `src/esphome/catalog_profiles/` and seeded into the catalog.

---

## Method 2: Use My YAML

If you already have an ESPHome YAML file (from another project, Home Assistant, or hand-written), you can import it directly.

### Steps

1. Go to **ESPHome** → **Use My YAML**
2. Paste your YAML or provide a URL
3. Fill in:
   - Device name
   - WiFi SSID / password
   - MQTT broker address
   - Connection (USB port or IP for OTA)
4. Click **Flash**

### What ELARIS Does With Your YAML

1. **Applies overrides** — replaces device name, friendly name, WiFi credentials, and MQTT broker
2. **Validates** — checks for `!secret` tags (rejected — see below), parses the structure
3. **Extracts entities** — the YAML importer reads all `switch`, `binary_sensor`, `sensor`, and `output` blocks and maps them to ELARIS entity types (relay, di, analog, ds18b20, dht, etc.)
4. **Injects MQTT overlay** — adds:
   - `on_boot` block with discovery config payload
   - `on_state` handlers on each binary_sensor → publishes to `elaris/<device>/tele/<key>`
   - `on_turn_on`/`on_turn_off` handlers on each switch → publishes to `elaris/<device>/state/<key>`
   - `mqtt.on_message` subscribers → routes `elaris/<device>/cmnd/<key>` commands to the right entity
5. **Matches a board profile** — tries to find a matching catalog profile based on the parsed structure (board type, I2C, PCF8574, etc.). Falls back to a draft profile if no match.
6. **Flashes** — compiles and flashes via `esphome run`

### What Your YAML Must Have

- Valid ESPHome structure (`esphome:`, `esp32:`/`esp8266:`, etc.)
- **Literal values** for passwords — no `!secret` tags
- At least one entity (switch, binary_sensor, sensor) for meaningful import

### What Gets Stripped / Rejected

| Tag | Behavior |
|-----|----------|
| `!secret foo` | **Rejected** — flash is blocked with a helpful error |
| `!lambda` | Replaced with `"__lambda__"` during parsing, but kept in the flashed YAML (ESPHome supports it) |
| `!include file.yaml` | Replaced with `"__include__"` during parsing — **will cause compile failure** if present in flashed YAML |
| `!extend` | Replaced with `"__extend__"` during parsing — not needed for standalone flash |

---

## Method 3: Native API Import

If you already have an ESPHome device running on your network (flashed outside ELARIS), ELARIS can discover and import it.

### Steps

1. Make sure the device has `api:` and `mqtt:` enabled in its YAML
2. Make sure the device is on the same network and the MQTT broker is reachable
3. ELARIS will auto-discover the device via MQTT
4. Go to **ESPHome** → **Devices** and sync the device

### Requirements

The device must publish a discovery payload to MQTT. For ELARIS-managed devices, this is done automatically by the `on_boot` block. For external devices, you can manually publish a config JSON to:

```
elaris/<device_name>/config
```

With a payload like:

```json
{
  "device": {
    "name": "my_device",
    "hostname": "my_device",
    "model": "Custom ESP32",
    "board_profile_id": "generic_esp32dev",
    "sw": "1.0.0"
  },
  "entities": [
    { "key": "relay_1", "group": "state", "type": "relay", "name": "Pump" },
    { "key": "di_1", "group": "tele", "type": "di", "name": "Door Sensor" }
  ]
}
```

---

## USB vs OTA Flashing

### USB (Serial) Flashing

- **First-time flash** — the device has no firmware yet
- Connect the ESP32 via USB to the machine running ELARIS
- Select the correct serial port (e.g., `/dev/ttyUSB0` or `COM3`)
- ESPHome handles the serial flash automatically

### OTA Flashing

- **Update existing device** — the device already has ESPHome firmware with `ota:` enabled
- Provide the device's IP address instead of a serial port
- ESPHome pushes the new firmware over the network
- Requires the device to be reachable on the network and the OTA password to match

### When to Use Which

| Situation | Method |
|-----------|--------|
| Brand new board, no firmware | USB |
| Board already running ESPHome | OTA |
| Board on remote site | OTA (if network reachable) |
| USB not accessible | OTA |

---

## Important: No `!secret` Tags

ELARIS does **not** support `!secret` references in YAML files.

### Why

ESPHome's `!secret` tags require a `secrets.yaml` file in the same directory as the YAML. ELARIS generates and compiles YAML in its own `data/esphome/` directory, which does not have a `secrets.yaml` file. Using `!secret` would cause a compilation failure.

### What to Do Instead

Replace all `!secret` references with **literal values**:

```yaml
# BAD — will be rejected
wifi:
  ssid: !secret wifi_ssid
  password: !secret wifi_password

# GOOD — literal values
wifi:
  ssid: "My_Place_24"
  password: "KjBgggDG2120!"
```

This applies to:
- WiFi SSID and password
- OTA password
- API encryption key
- MQTT credentials (if any)

### Error Message

If you try to flash YAML with `!secret` tags, you will get:

```
The following !secret references were found: !secret wifi_ssid, !secret wifi_password.
Replace them with literal values before flashing — ESPHome needs a secrets.yaml file
that is not available in this environment.
```

---

## Board Profile Catalog

ELARIS maintains a **DB-backed board profile catalog** that stores definitions for all supported boards.

### Where Profiles Live

| Location | Purpose |
|----------|---------|
| `src/esphome/board_profiles/*.js` | Bundled JS profiles — loaded at startup |
| `src/esphome/catalog_profiles/*.json` | JSON profiles — extend the catalog without editing code |
| Database (`esphome_board_profiles` table) | Runtime catalog — seeded from the above sources |

### Profile Structure

Each profile defines:

- **Board info** — `id`, `label`, `platform`, `board`, `frameworkDefault`
- **Capabilities** — `supports` (usb, ota, wifi, ethernet)
- **Hardware layout** — `i2c`, `pcf8574`, `ethernet`, `boardPorts`, `boardBuses`
- **Entity defaults** — `entityDefaults` array with pre-mapped relays, DIs, sensors
- **Pin rules** — reserved pins, input-only, no-pullup, flash pins, strapping pins
- **Source resolver** — `resolveSource()` function to map port labels to GPIO

### Adding a New Board Profile

Create a JSON file in `src/esphome/catalog_profiles/`:

```json
{
  "id": "my_custom_board",
  "label": "My Custom Board",
  "platform": "esp32",
  "board": "esp32dev",
  "framework_default": "arduino",
  "definition": {
    "supports": { "usb": true, "ota": true, "wifi": true, "ethernet": false },
    "i2c": { "sda": 21, "scl": 22, "scan": true, "id": "bus_a" },
    "boardPorts": [],
    "boardBuses": [],
    "pinRules": {
      "reserved": [],
      "inputOnly": [34, 35, 36, 39],
      "noPullup": [34, 35, 36, 39],
      "flashPins": [6, 7, 8, 9, 10, 11],
      "strapping": [0, 2, 5, 12, 15]
    },
    "entityDefaults": []
  },
  "capabilities": {
    "relay": 0,
    "di": 0,
    "analog": 0,
    "ds18b20": 0,
    "dht": 0
  }
}
```

Then reseed the catalog:

```bash
node scripts/reseed_esphome_catalog.js
```

Or import a single file:

```bash
node scripts/import_esphome_profile.js src/esphome/catalog_profiles/my_custom_board.json
```

### Purpose of the Catalog

The board profile catalog exists so that:

1. **Installers don't need to write YAML** — pick a board, add peripherals through the UI, flash
2. **Entity mapping is automatic** — the profile knows which GPIO/PCF8574 pin each relay and input uses
3. **New boards can be added without code changes** — just drop a JSON file and reseed
4. **Tested configurations are reusable** — once a board is verified, the profile is the source of truth

---

## Adding Peripherals After Flash

Once a device is flashed, you can add, edit, or remove peripherals without reflashing the entire YAML.

### How It Works

1. ELARIS reads the current YAML from `data/esphome/<device_name>.yaml`
2. The peripheral editor injects or removes the entity using **text-based YAML injection**
3. The MQTT discovery payload is updated automatically
4. The device is reflashed with the updated YAML

### Supported Peripheral Types

| Type | Port/Bus | Examples |
|------|----------|----------|
| Relay | DO port | `relay_1`, `relay_2` |
| Digital Input | DI port | `di_1`, `di_2` |
| Analog Input | AI port | `ai_1`, `ai_2` |
| DS18B20 | HT port (1-Wire) | `ht_1`, `ht_2` |
| DHT | HT port | `dht_1` |
| BH1750 | I2C bus | `bh1750_lux` |
| SHT3x | I2C bus | `sht3x_temp`, `sht3x_hum` |
| BME280 | I2C bus | `bme280_temp`, `bme280_hum`, `bme280_press` |
| BMP280 | I2C bus | `bmp280_temp`, `bmp280_press` |
| MH-Z19 | UART (RS485) | `mhz19_co2` |
| PZEM-004T | UART (RS485) | `pzem004t_power` |

---

## How MQTT Entity Mapping Works

When ELARIS flashes a device, it injects an MQTT layer that handles all communication automatically.

### Topic Structure

```
elaris/<device_id>/config        → Discovery payload (published on boot, retained)
elaris/<device_id>/state/<key>   → Relay state (ON/OFF, retained)
elaris/<device_id>/tele/<key>    → Sensor/telemetry data (ON/OFF or numeric)
elaris/<device_id>/cmnd/<key>    → Command topic (send ON/OFF to control relays)
```

### Example: 6-Relay Board (KC868-A6)

**Discovery payload** (published on boot):
```json
{
  "device": {
    "name": "kc868_a6",
    "hostname": "kc868_a6",
    "model": "KC868-A6",
    "board_profile_id": "kincony_kc868_a6",
    "sw": "1.0.0"
  },
  "entities": [
    { "key": "relay_1", "group": "state", "type": "relay", "name": "Main Pool Pump" },
    { "key": "relay_2", "group": "state", "type": "relay", "name": "KC868-A6-RELAY-2" },
    ...
    { "key": "di_1", "group": "tele", "type": "di", "name": "Front Door Sensor" },
    ...
  ]
}
```

**Relay state** (published when relay changes):
```
Topic: elaris/kc868_a6/state/relay_1
Payload: "ON"   (or "OFF", retained)
```

**Digital input** (published when state changes):
```
Topic: elaris/kc868_a6/tele/di_1
Payload: "ON"   (or "OFF")
```

**Relay command** (send to control a relay):
```
Topic: elaris/kc868_a6/cmnd/relay_1
Payload: "ON"   (or "OFF")
```

### Key Point: No Manual Mapping Needed

The YAML importer reads entity IDs from your YAML and generates unique keys automatically. It doesn't matter what names you use in the YAML — `relay_1`, `pool_pump`, `my_switch` — they all get mapped to sequential keys (`relay_1`, `relay_2`, etc.) and wired to the correct MQTT topics.

---

## Troubleshooting

### `!secret` References Found

**Error:** `yaml_contains_secrets`

**Fix:** Replace all `!secret` tags with literal values in your YAML.

### `!include` References Found

**Error:** YAML compiles but fails because included file is missing

**Fix:** Inline the content of any `!include` files directly into your YAML before importing.

### ESPHome Not Installed

**Error:** `esphome_not_installed`

**Fix:** Run ESPHome setup from the UI, or manually:
```bash
pip install esphome
```

### Flash Fails — Device Not Found

**USB:** Check the serial port is correct and the device is connected.
**OTA:** Check the IP address is reachable and the device is running ESPHome with `ota:` enabled.

### Flash Fails — Compilation Error

Check the ESPHome log output. Common causes:
- Invalid pin configuration
- Conflicting I2C addresses
- Missing platform-specific settings
- Strapping pin conflicts (GPIO 0, 2, 5, 12, 15 on ESP32)

### Device Not Appearing in ELARIS After Flash

1. Check the MQTT broker is reachable from the device
2. Check the device name matches what ELARIS expects
3. Check the `on_boot` block is present in the YAML (for discovery)
4. Check MQTT logs on the broker for incoming messages

### Duplicate Device Name

**Error:** `device_name_already_exists`

**Fix:** Use a different device name, or update the existing device instead.

### Flash Already In Progress

**Error:** `flash_in_progress`

**Fix:** Wait for the current flash to complete, or cancel it:
```
DELETE /api/esphome/flash
```

### Pin Conflicts

The validator checks for:
- **Flash pins** (GPIO 6-11 on ESP32) — reserved for flash memory
- **Strapping pins** (GPIO 0, 2, 5, 12, 15) — can cause boot issues
- **Input-only pins** (GPIO 34-39) — cannot be used as outputs
- **Reserved pins** — used by Ethernet, I2C, UART, etc.

If you get a validation error, check the pin assignments against the board's pin rules.

---

## Wiring & YAML Examples

For complete wiring diagrams and ESPHome YAML examples for common peripherals, see the dedicated **[ESPHOME_WIRING_EXAMPLES.md](ESPHOME_WIRING_EXAMPLES.md)** guide.

It covers:

- **DS18B20** — single and multi-drop (multiple sensors on one 1-Wire bus)
- **I2C sensors** — BME280, BH1750, multiple devices on same bus
- **Analog Output (AO)** — 0-10V via ESP32 DAC
- **NTC Thermistor** — voltage divider wiring and calibration
- **CT Clamp** — AC current measurement circuit
- **MH-Z19** — CO2 sensor UART wiring
- **PZEM-004T** — energy monitor Modbus/RS485
- **Pulse Counter** — YF-S201 water flow meter
