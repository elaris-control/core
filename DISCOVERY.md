> **DB location:** By default ELARIS stores SQLite at `./data/elaris.db` (outside repo). Override with `ELARIS_DB_PATH=/path/to/elaris.db`.

# ELARIS MQTT Discovery (Device → Server)

Goal: When a new node/peripheral (e.g. ESP32) comes online, it automatically announces what IOs it has (sensors/relays). The ELARIS server picks it up, adds it to **Pending IO**, and from the **Installer** you approve + rename + assign to a zone.

## 1) Topic

**Retained JSON** published to:

- `elaris/<deviceId>/config`

> The config message must be published with **retain=true** so the server receives it even if it starts later.

## 2) Payload Schema (JSON)

```json
{
  "device": {
    "name": "Boiler Node",
    "manufacturer": "ELARIS",
    "model": "ESP32",
    "sw": "0.1.0",
    "hw": "devkit",
    "mac": "AA:BB:CC:DD:EE:FF"
  },
  "entities": [
    {
      "key": "temp_solar",
      "group": "tele",
      "type": "sensor",
      "name": "Solar Temp",
      "unit": "°C",
      "device_class": "temperature"
    },
    {
      "key": "pump",
      "group": "state",
      "type": "relay",
      "name": "Circulation Pump"
    }
  ]
}
```

### Fields

- `device` (optional): device metadata
  - `name`, `manufacturer`, `model`, `sw`, `hw`, `mac`
- `entities` (required): list of IOs
  - `key` (required): entity key
  - `group` (optional): `tele` or `state`
    - if omitted: auto-assigned (`state` for relay/switch, `tele` for everything else)
  - `type` (optional): `sensor` or `relay` (`switch` is accepted as an alias for relay)
  - `name` (optional): suggested label (shown pre-filled in the Installer)
  - `unit` (optional): e.g. `°C`, `%`, `bar`
  - `device_class` (optional): e.g. `temperature`, `humidity`

## 3) Runtime Topics

- Telemetry (sensors): `elaris/<deviceId>/tele/<key>`
- State (relays): `elaris/<deviceId>/state/<key>` (payload: `ON` / `OFF`)
- Commands (from server): `elaris/<deviceId>/cmnd/<key>` (payload: `ON` / `OFF`)

## 4) Example mosquitto_pub

```bash
mosquitto_pub -h 127.0.0.1 -t 'elaris/demo_boiler/config' -r -m \
  '{"device":{"name":"Demo Boiler","model":"ESP32"},"entities":[{"key":"temp","group":"tele","type":"sensor","name":"Solar Temp","unit":"°C"},{"key":"pump","group":"state","type":"relay","name":"Circulation Pump"}]}'

mosquitto_pub -h 127.0.0.1 -t 'elaris/demo_boiler/tele/temp' -m '42.3'
mosquitto_pub -h 127.0.0.1 -t 'elaris/demo_boiler/state/pump' -m 'OFF'
```

Then open:
- `http://<PI_IP>:8080/installer.html` → approve + rename + assign zone
- `http://<PI_IP>:8080/` → dashboard
