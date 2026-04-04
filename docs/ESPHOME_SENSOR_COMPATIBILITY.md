# ESPHome Sensor Compatibility Reference

This note summarizes the ESPHome sensor/peripheral types currently visible in the ELARIS repo, with emphasis on:

- what the sensor **is** in practical terms
- whether it is YAML-ready in the current system
- whether multiple sensors can share the same physical input / bus
- whether one physical sensor produces multiple ELARIS entities
- whether addressing / bus identity matters

---

## Key ideas

### 1. Separate entities is the correct model
ELARIS should treat sensors as **separate entities**, not auto-merge them into one logical input.

### 2. There are 2 main patterns

#### A. Multiple physical sensors on the same physical bus / port
Examples:
- multiple **DS18B20 temperature probes** on one 1-Wire line
- multiple **I²C sensors** on one I²C bus, each with a different address

#### B. One physical sensor creates multiple ELARIS entities
Examples:
- one **temperature + humidity sensor** creates 2 entities
- one **air-quality / power-monitor / barometric sensor** creates 2-4 entities

---

# Compatibility table

| Practical sensor type | ESPHome type in repo | What it measures | Connection style | YAML-ready now | Multiple physical sensors on same input/bus? | One physical sensor creates multiple entities? | Address / bus-aware? | Notes |
|---|---|---|---|---|---|---|---|---|
| Temperature probe | `ds18b20` | Temperature | 1-Wire / GPIO sensor port | Yes | **Yes** | No | Bus/port aware | Best-supported shared-bus temperature case. |
| Temperature + humidity sensor | `dht`, `dht11` | Temperature, humidity | Single GPIO sensor port | Yes | **Not intended as multi-drop** | **Yes** | Port-aware | One DHT gives 2 entities: temp + humidity. |
| Analog input sensor | `analog` | Generic analog reading (voltage/current/etc.) | ADC / GPIO analog input | Yes | Usually no | No | Port-aware | Good for one analog sensor per analog input. |
| Pulse / flow / meter input | `pulse_counter` | Pulses, flow, rate, counter-style measurement | GPIO / DI input | Yes | Usually no | No | Port-aware | One input channel per pulse source is the expected model. |
| Lux meter | `bh1750` | Light level / illuminance | I²C | Yes | **Yes** | No | **Address + bus aware** | Same I²C bus is fine if addresses differ. |
| Temperature + humidity sensor | `sht3x` | Temperature, humidity | I²C | Yes | **Yes** | **Yes** | **Address + bus aware** | One sensor gives temp + humidity entities. |
| Temperature + humidity + pressure sensor | `bme280` | Temperature, humidity, pressure | I²C | Yes | **Yes** | **Yes** | **Address + bus aware** | One sensor gives 3 entities. |
| Temperature + pressure sensor | `bmp280` | Temperature, pressure | I²C | Yes | **Yes** | **Yes** | **Address + bus aware** | One sensor gives 2 entities. |
| Lux meter | `veml7700` | Light level / illuminance | I²C | Yes | **Yes** | No | **Address + bus aware** | Similar shared I²C behavior to BH1750. |
| Current / power / voltage monitor | `ina219` | Current, power, voltage | I²C | Yes | **Yes** | **Yes** | **Address + bus aware** | One device gives multiple power-monitor entities. |
| Air quality sensor | `ccs811` | eCO2, TVOC | I²C | Yes | **Yes** | **Yes** | **Address + bus aware** | One device gives 2 entities. |
| CO₂ sensor | `mhz19` | CO₂, temperature | UART / RS485-style bus abstraction in repo | Yes | Bus-capable in model, practical multi-device depends on protocol wiring | **Yes** | **Bus-aware** | One device gives CO₂ + temperature entities. |
| Energy meter / power meter | `pzem004t` | Power, voltage, current, energy | UART / RS485-style bus abstraction in repo | Yes | Bus-capable in model, practical multi-device depends on addressing/protocol | **Yes** | **Bus-aware** | One device gives multiple measurement entities. |

---

# Best-supported shared-input / shared-bus cases

## 1. Multiple DS18B20 probes on one sensor port
**This is explicitly supported.**

In the repo:
- DS18B20 is modeled as a sensor-port type
- board ports such as HT/DS ports are marked with:
  - `shared_bus: true`
  - `multi_instance: true`

### Practical meaning
You can have:
- 2 or more **temperature probes**
- on the same physical 1-Wire line
- and ELARIS should still treat them as **separate entities**

### Good examples
- buffer top temperature
- buffer middle temperature
- buffer bottom temperature
- collector temperature

all on separate DS18B20 addresses, even if they share one physical bus.

---

## 2. Multiple I²C sensors on one I²C bus
**This is also clearly supported.**

The repo models bus sensors with:
- `bus_id`
- `address`

### Practical meaning
You can put multiple sensors on the same I²C bus, for example:
- 1 × lux meter
- 1 × temperature/humidity sensor
- 1 × pressure sensor
- 1 × power monitor

as long as:
- the bus wiring is valid
- addresses do not collide

### Typical supported I²C examples
- **BH1750** → lux meter
- **SHT3x** → temperature + humidity
- **BME280** → temperature + humidity + pressure
- **BMP280** → temperature + pressure
- **VEML7700** → lux meter
- **INA219** → current + power + voltage
- **CCS811** → eCO2 + TVOC

---

# Sensors that create multiple ELARIS entities from one physical device

These are important because they are **not** “2 sensors on one input”, but they **do** produce multiple entities.

## Temperature + humidity
- `dht`
- `dht11`
- `sht3x`

### Result
One physical device becomes:
- temperature entity
- humidity entity

## Temperature + humidity + pressure
- `bme280`

### Result
One physical device becomes:
- temperature entity
- humidity entity
- pressure entity

## Temperature + pressure
- `bmp280`

### Result
One physical device becomes:
- temperature entity
- pressure entity

## Power monitor
- `ina219`

### Result
One physical device becomes:
- current entity
- power entity
- voltage entity

## Air quality
- `ccs811`

### Result
One physical device becomes:
- eCO2 entity
- TVOC entity

## CO₂ sensor
- `mhz19`

### Result
One physical device becomes:
- CO₂ entity
- temperature entity

## Energy meter
- `pzem004t`

### Result
One physical device becomes:
- power entity
- voltage entity
- current entity
- energy entity

---

# Practical recommendations

## Strongest / safest shared-bus use cases

### Use freely
- multiple **DS18B20 temperature probes** on one 1-Wire / HT port
- multiple **I²C sensors** on one I²C bus with distinct addresses

## Use carefully
- UART / RS485 bus devices like:
  - `mhz19`
  - `pzem004t`

These are modeled as bus-aware in the repo, but practical multi-device support depends more on:
- protocol details
- addressing
- actual wiring expectations of the target hardware

## Not the same as shared multi-drop
- `dht` / `dht11`
- `analog`
- `pulse_counter`

These are YAML-ready, but they are not the main “many devices on one physical input” pattern.

---

# Board-specific examples

## KinCony A16

### Shared sensor ports
- `HT1` → GPIO32
- `HT2` → GPIO33
- `HT3` → GPIO14

These are marked as:
- `shared_bus: true`
- `multi_instance: true`

### Practical use
Good for:
- multiple **DS18B20 temperature probes** on the same HT port
- one **DHT temperature+humidity sensor** on an HT port

### Sensor bus
- `bus_a` → I²C on SDA=4 / SCL=5

Good for:
- **lux meters**
- **temperature + humidity sensors**
- **temperature + pressure sensors**
- **air quality sensors**
- **power monitors**

### Important note
On A16, the app model supports:
- multiple DS18B20 probes per HT port
- multiple I²C sensors on `bus_a` if addresses do not collide

---

## KinCony A8

### Shared sensor port
- `DS1` → GPIO14

This is marked as:
- `shared_bus: true`
- `multi_instance: true`

### Practical use
Good for:
- multiple **DS18B20 temperature probes** on `DS1`
- one **DHT temperature+humidity sensor** on `DS1`

### Sensor bus
- `bus_a` → I²C on SDA=4 / SCL=5

Good for:
- **lux meters**
- **temperature + humidity sensors**
- **barometric sensors**
- **power monitors**

---

## KinCony A32

### Sensor buses
- `bus_a` → I²C on SDA=15 / SCL=13
- `bus_b` → I²C on SDA=4 / SCL=5

### Practical use
Good for:
- splitting sensors across 2 I²C buses
- keeping one bus cleaner for sensor expansion
- using multiple I²C devices as separate entities

### Analog inputs
- `AI1`
- `AI2`
- `AI3`
- `AI4`

Good for:
- one **analog sensor** per analog input

### Important note
A32 does **not** expose the same HT shared 1-Wire ports in the visible board profile the way A16/A8 do.
Its strongest multi-sensor pattern is:
- multiple **I²C sensors** across `bus_a` / `bus_b`

---

# Can the app reflash YAML and add more sensors on the same GPIO / bus?

## Yes — in principle, the app already does YAML rewrite + reflash flows
The current app has routes for:
- add peripheral
- edit peripheral
- remove peripheral
- preview YAML
- flash updated YAML back to the device

So the app architecture already supports:
- reading the existing device YAML
- merging a new peripheral into it
- previewing the result
- reflashing the updated YAML

## What matters for ELARIS

The key question for ELARIS is **not** whether a hardware combination is electrically wise.
The key question is:

### Can the app/installer represent those sensors as separate entities in YAML and in ELARIS?

If the app supports the pattern, then ELARIS is doing its job.
If someone wires an unsupported sensor combination in real life, that is a hardware/user choice — not a data-model requirement.

## App support by pattern

### YES — supported pattern in the app
#### Multiple DS18B20 temperature probes on one GPIO / HT port
This is the clearest supported case.

Example:
- buffer top temperature
- buffer middle temperature
- buffer bottom temperature

all on the same 1-Wire line, as separate entities.

### YES — supported pattern in the app
#### Multiple I²C sensors on the same I²C bus
Examples:
- two **lux meters** if the hardware/addressing allows it
- one **lux meter** + one **temperature/humidity sensor**
- one **temperature/humidity sensor** + one **power monitor**

This is supported when:
- they sit on the same I²C bus
- they have different addresses

### NO — not represented as separate same-pin multi-device pattern in the app
#### Two plain GPIO-style sensors on the exact same raw GPIO line
Example:
- two DHT sensors on one raw GPIO

That is **not** the intended app model.
Even though DHT is YAML-ready, it is treated as a single sensor device on a GPIO, not a multi-drop shared-address bus like DS18B20 or I²C.

## Practical answer to your examples

### “Can I put 2 humidity sensors on the same GPIO?”
- If you mean **two plain DHT-style sensors on one raw GPIO** → the app does **not** model that as a supported separate-entity pattern.
- If you mean **two humidity-capable bus sensors on I²C**, each with its own address → **yes**, the app can model them separately.

### “Can I put 2 lux sensors?”
- **Yes in the I²C-bus sense**, if the sensor type and addressing allow it.
- The app can represent them as separate entities if they are separate bus/address devices.

## Quick matrix

| Scenario | App / installer support |
|---|---|
| 2+ DS18B20 temperature probes on one HT / 1-Wire port | **SUPPORTED** |
| 2+ I²C sensors on one I²C bus with different addresses | **SUPPORTED** |
| One sensor that exposes multiple values (temp+humidity, pressure, power, etc.) | **SUPPORTED** |
| 2 UART/RS485 sensors on same bus | **MAYBE / protocol-dependent** |
| 2 plain GPIO sensors on the exact same raw GPIO line | **NO** |
| 2 DHT sensors on one raw GPIO line | **NO** |

---

# Bottom line

## If the goal is:
### “2+ physical sensors, separate entities, same physical line/bus”

The best-supported patterns in ELARIS right now are:

1. **DS18B20 temperature probes on shared 1-Wire ports**
2. **I²C sensors on shared I²C buses with different addresses**

## If the goal is:
### “one physical sensor gives several ELARIS entities”

That is also supported for:
- DHT / DHT11
- SHT3x
- BME280
- BMP280
- INA219
- CCS811
- MH-Z19
- PZEM004T

## Correct ELARIS behavior
The system should keep these as:
- **separate entities**
- with their own keys / address / bus context
- not auto-merge them into one input

## Wiring & YAML Examples

For complete wiring diagrams and ready-to-use ESPHome YAML snippets, see **[ESPHOME_WIRING_EXAMPLES.md](ESPHOME_WIRING_EXAMPLES.md)**.
