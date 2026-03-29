# ELARIS MQTT Debug Guide

ELARIS uses MQTT (Mosquitto) for all device communication. This guide covers the topic structure and debug commands.

---

## Prerequisites

```bash
# Install mosquitto clients (if not already installed)
# Raspberry Pi / Linux
sudo apt install mosquitto-clients

# Windows — download from https://mosquitto.org/download/
# mosquitto_sub.exe and mosquitto_pub.exe are in the install directory
```

---

## Topic Structure

All ELARIS-managed devices use the `elaris/` prefix.

### Device Announce (Config)

```
elaris/{device_id}/config    → JSON payload (retained)
```

Sent when a device boots. Contains device info, IO list, capabilities.

### Telemetry (Sensor Data)

```
elaris/{device_name}/tele/{key}    → value string
```

Examples:
- `elaris/living_room/tele/ht_1` → `22.5` (temperature)
- `elaris/living_room/tele/ht_1_hum` → `55.2` (humidity)
- `elaris/solar_ctrl/tele/solar_temp` → `48.3`
- `elaris/energy/tele/ct1_power` → `1250.5`

### State (Relay/Switch)

```
elaris/{device_name}/state/{key}    → "ON" or "OFF"
```

Examples:
- `elaris/living_room/state/relay_1` → `ON`
- `elaris/boiler_ctrl/state/relay_2` → `OFF`

### Commands (Outgoing)

```
elaris/{device_id}/cmnd/{key}    → "ON", "OFF", or value
```

Sent by ELARIS to control a device. QoS 0, non-retained.

### Device Status

```
elaris/{device_id}/status    → "online" (retained)
{device_name}/status         → "online" (standard ESPHome)
```

---

## Standard ESPHome Topics

Devices also publish on standard ESPHome topics:

```
{device_name}/switch/{key}/state      → "ON" / "OFF"
{device_name}/binary_sensor/{key}/state → "ON" / "OFF"
{device_name}/sensor/{key}/state      → numeric value
{device_name}/text_sensor/{key}/state → text value
{device_name}/status                  → "online" / "offline"
```

---

## Debug Commands

### Watch all ELARIS traffic

```bash
mosquitto_sub -h localhost -t "elaris/#" -v
```

### Watch a specific device

```bash
# All messages from a device
mosquitto_sub -h localhost -t "elaris/living_room/#" -v

# Only telemetry
mosquitto_sub -h localhost -t "elaris/living_room/tele/#" -v

# Only state changes
mosquitto_sub -h localhost -t "elaris/living_room/state/#" -v
```

### Watch device announces

```bash
mosquitto_sub -h localhost -t "elaris/+/config" -v
```

### Watch all status messages

```bash
mosquitto_sub -h localhost -t "+/status" -v
mosquitto_sub -h localhost -t "elaris/+/status" -v
```

### Watch commands sent by ELARIS

```bash
mosquitto_sub -h localhost -t "elaris/+/cmnd/#" -v
```

### Watch everything (very verbose)

```bash
mosquitto_sub -h localhost -t "#" -v
```

---

## Send Test Commands

### Toggle a relay

```bash
# Turn ON
mosquitto_pub -h localhost -t "elaris/YOUR_DEVICE/cmnd/relay_1" -m "ON"

# Turn OFF
mosquitto_pub -h localhost -t "elaris/YOUR_DEVICE/cmnd/relay_1" -m "OFF"
```

### Simulate a sensor value

```bash
mosquitto_pub -h localhost -t "elaris/test_device/tele/ht_1" -m "25.5"
```

### Simulate a device announce

```bash
mosquitto_pub -h localhost -t "elaris/test_device/config" -r -m '{
  "id": "test_device",
  "name": "Test Device",
  "io": [
    {"key": "relay_1", "type": "relay", "group": "switch"},
    {"key": "ht_1", "type": "sensor", "group": "sensor", "unit": "°C"}
  ]
}'
```

### Clear a retained message

```bash
# Send empty payload with retain flag
mosquitto_pub -h localhost -t "elaris/old_device/config" -r -n
mosquitto_pub -h localhost -t "elaris/old_device/status" -r -n
```

---

## MQTT Debug Mode in ELARIS

ELARIS has a built-in MQTT debug toggle.

### Enable via Admin UI

Admin → Runtime Debug → MQTT Debug Logging → Enable

### Enable via database

```sql
INSERT OR REPLACE INTO app_settings (key, value, updated_ts)
VALUES ('mqtt_debug_enabled', '1', strftime('%s','now') * 1000);
```

### Enable via environment variable

```bash
ELARIS_MQTT_DEBUG=1 node src/index.js
```

When enabled, the server logs detailed MQTT processing: subscriptions, message parsing, state updates, and retained topic handling.

---

## Common Debug Scenarios

### Device not showing up

1. Check if device is publishing config:
   ```bash
   mosquitto_sub -h localhost -t "elaris/+/config" -v
   ```
2. Check if Mosquitto is running:
   ```bash
   systemctl status mosquitto    # Linux
   sc query mosquitto            # Windows
   ```
3. Check retained config messages:
   ```bash
   mosquitto_sub -h localhost -t "elaris/+/config" -v --retained-only
   ```

### Sensor not updating

1. Watch telemetry for the device:
   ```bash
   mosquitto_sub -h localhost -t "elaris/DEVICE_NAME/tele/#" -v
   ```
2. Check if IO is approved (not in pending_io):
   ```sql
   SELECT * FROM pending_io WHERE device_id = 'DEVICE_NAME';
   SELECT * FROM io WHERE device_id = 'DEVICE_NAME' AND enabled = 1;
   ```

### Relay not responding

1. Watch if command is being sent:
   ```bash
   mosquitto_sub -h localhost -t "elaris/DEVICE_ID/cmnd/#" -v
   ```
2. Manually test the relay:
   ```bash
   mosquitto_pub -h localhost -t "elaris/DEVICE_ID/cmnd/relay_1" -m "ON"
   ```
3. Check state feedback:
   ```bash
   mosquitto_sub -h localhost -t "elaris/DEVICE_NAME/state/relay_1" -v
   ```

### Stale retained messages from old devices

Old devices may leave retained messages that show phantom devices. Clear them:

```bash
# Clear config
mosquitto_pub -h localhost -t "elaris/OLD_DEVICE/config" -r -n

# Clear status
mosquitto_pub -h localhost -t "elaris/OLD_DEVICE/status" -r -n

# Or use the Admin UI: Admin → Stale MQTT → Purge
```

---

## Mosquitto Configuration

Default config location:
- Linux: `/etc/mosquitto/mosquitto.conf`
- Windows: `C:\Program Files\mosquitto\mosquitto.conf`

Recommended settings for ELARIS:

```
listener 1883
allow_anonymous true
persistence true
persistence_location /var/lib/mosquitto/
```

### Check Mosquitto logs

```bash
# Linux
journalctl -u mosquitto -f

# Or check log file
tail -f /var/log/mosquitto/mosquitto.log
```
