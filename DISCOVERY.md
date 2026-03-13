> **DB location:** By default ELARIS now stores SQLite at `./data/elaris.db` (outside repo). Override with `ELARIS_DB_PATH=/path/to/elaris.db`.

# ELARIS MQTT Discovery (Device → Server)

Στόχος: Μόλις μπει ένας νέος κόμβος/περιφερειακό (π.χ. ESP32), να «δηλώνει» αυτόματα τι IO έχει (sensors/relays). Ο ELARIS server το βλέπει, το περνάει σε **Pending IO**, και από το **Installer** κάνεις approve + rename + zone.

## 1) Topic

**Retained JSON** στο:

- `elaris/<deviceId>/config`

> Το config πρέπει να είναι **retain=true** για να το παίρνει ο server ακόμα κι αν ξεκινήσει αργότερα.

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
      "name": "Temp Ηλιακών",
      "unit": "°C",
      "device_class": "temperature"
    },
    {
      "key": "pump",
      "group": "state",
      "type": "relay",
      "name": "Κυκλοφορητής"
    }
  ]
}
```

### Fields

- `device` (optional): metadata
  - `name`, `manufacturer`, `model`, `sw`, `hw`, `mac`
- `entities` (required): λίστα IO
  - `key` (required): το key του entity
  - `group` (optional): `tele` ή `state`
    - αν λείπει: γίνεται auto (`state` για relay/switch, αλλιώς `tele`)
  - `type` (optional): `sensor` ή `relay` (δέχεται και `switch` σαν relay)
  - `name` (optional): suggested label (εμφανίζεται pre-filled στο Installer)
  - `unit` (optional): π.χ. `°C`, `%`, `bar`
  - `device_class` (optional): π.χ. `temperature`, `humidity`

## 3) Runtime Topics

- Telemetry (sensors): `elaris/<deviceId>/tele/<key>`
- State (relays): `elaris/<deviceId>/state/<key>`  (payload: `ON` / `OFF`)
- Commands (from server): `elaris/<deviceId>/cmnd/<key>` (payload: `ON` / `OFF`)

## 4) Example mosquitto_pub

```bash
mosquitto_pub -h 127.0.0.1 -t 'elaris/demo_boiler/config' -r -m '{"device":{"name":"Demo Boiler","model":"ESP32"},"entities":[{"key":"temp","group":"tele","type":"sensor","name":"Temp Ηλιακών","unit":"°C"},{"key":"pump","group":"state","type":"relay","name":"Κυκλοφορητής"}]}'

mosquitto_pub -h 127.0.0.1 -t 'elaris/demo_boiler/tele/temp' -m '42.3'
mosquitto_pub -h 127.0.0.1 -t 'elaris/demo_boiler/state/pump' -m 'OFF'
```

Μετά άνοιξε:
- `http://<PI_IP>:8080/installer.html` → approve + rename + zone
- `http://<PI_IP>:8080/` → dashboard
