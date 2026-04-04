# ESPHome Wiring Examples for Elaris

> **Current as of ESPHome 2026.3.0** | **Elaris Platform** — No `!secret` tags, literal values only
> 
> All examples follow the Elaris MQTT topic convention: `elaris/<device>/tele/<key>`

---

## Table of Contents

1. [Single DS18B20 on 1-Wire Bus](#1-single-ds18b20-on-1-wire-bus)
2. [Multiple DS18B20 on Same 1-Wire Bus (Multi-Drop)](#2-multiple-ds18b20-on-same-1-wire-bus-multi-drop)
3. [I2C: Multiple Sensors on Same Bus](#3-i2c-multiple-sensors-on-same-bus)
4. [Analog Output (AO) — 0-10V](#4-analog-output-ao--0-10v)
5. [NTC Thermistor (Analog Input)](#5-ntc-thermistor-analog-input)
6. [CT Clamp Current Sensor](#6-ct-clamp-current-sensor)
7. [MH-Z19 CO2 Sensor (UART)](#7-mh-z19-co2-sensor-uart)
8. [PZEM-004T (Modbus/UART)](#8-pzem-004t-modbusuart)
9. [Pulse Counter — Water Flow YF-S201](#9-pulse-counter--water-flow-yf-s201)

---

## 1. Single DS18B20 on 1-Wire Bus

### Physical Wiring

```
DS18B20 (TO-92 package, facing flat side, pins down left-to-right):

  Pin 1 (GND)  ─────────────────────────────── ESP32 GND
  Pin 2 (DATA) ────┬────────────────────────── ESP32 GPIO4
                   │
                   └── 4.7kΩ resistor ──────── ESP32 3.3V (VCC)
  Pin 3 (VCC)  ─────────────────────────────── ESP32 3.3V (VCC)

Parasite power mode (2-wire):
  Pin 1 (GND)  ─────────────────────────────── ESP32 GND
  Pin 2+3 (DATA+VCC shorted) ──┬───────────── ESP32 GPIO4
                               │
                               └── 4.7kΩ resistor ── ESP32 3.3V
```

**Notes:**
- The 4.7kΩ pull-up resistor is **required** between DATA and VCC
- For cable runs >3m, use 3.3kΩ pull-up
- GPIO4 is common but any GPIO works (avoid GPIO6-11 on ESP32 — flash pins)

### ESPHome YAML

```yaml
esphome:
  name: temp-sensor-01
  friendly_name: "Living Room Temperature"

esp32:
  board: esp32dev
  framework:
    type: esp-idf

logger:

ota:
  - platform: esphome

wifi:
  ssid: "your_wifi_ssid"
  password: "your_wifi_password"

# 1-Wire bus on GPIO4
one_wire:
  - platform: gpio
    pin: GPIO4

mqtt:
  broker: 192.168.1.100
  port: 1883
  discovery: false
  on_connect:
    then:
      - mqtt.publish:
          topic: "elaris/temp-sensor-01/config"
          payload: '{"device":{"name":"Living Room Temp","hostname":"temp-sensor-01","model":"DS18B20","sw":"1.0.0"},"entities":[{"key":"living_room_temp","group":"tele","type":"sensor","name":"Living Room Temperature","unit":"°C","device_class":"temperature"}]}'
          retain: true

sensor:
  - platform: dallas_temp
    index: 0
    name: "Living Room Temperature"
    id: living_room_temp
    unit_of_measurement: "°C"
    update_interval: 30s
    on_value:
      - mqtt.publish:
          topic: "elaris/temp-sensor-01/tele/living_room_temp"
          payload: !lambda |-
            return str_sprintf("%.1f", x);
```

### Elaris Notes

- **Address discovery**: The `index: 0` picks the first sensor found on the bus. To use a specific sensor by its 64-bit MAC address instead:

```yaml
sensor:
  - platform: dallas_temp
    address: 0x1C0000031EDD2A28  # Replace with your sensor's actual address
    name: "Living Room Temperature"
    id: living_room_temp
```

- **Finding addresses**: Check the ESPHome logs on first boot — it prints all discovered Dallas sensor addresses:
  ```
  [D][dallas_temp:036]: Found sensors: 0x1C0000031EDD2A28, 0x8C0000031F0E5B28
  ```
- Elaris maps this to `elaris/<device>/tele/<key>` on every value update
- The `dallas_temp` platform is the modern ESPHome syntax (replaces the older `dallas` + `sensor:` sub-config)

---

## 2. Multiple DS18B20 on Same 1-Wire Bus (Multi-Drop)

### Physical Wiring

```
Same as single sensor, but all sensors share the same DATA line:

  Sensor 1 Pin 2 (DATA) ──┐
  Sensor 2 Pin 2 (DATA) ──┼────────────────────── ESP32 GPIO4
  Sensor 3 Pin 2 (DATA) ──┤
                          │
  Sensor 1 Pin 1 (GND) ───┼──┐
  Sensor 2 Pin 1 (GND) ───┼──┼─────────────────── ESP32 GND
  Sensor 3 Pin 1 (GND) ───┘  │
                              │
  Sensor 1 Pin 3 (VCC) ───┬──┼──┐
  Sensor 2 Pin 3 (VCC) ───┼──┼──┼──────────────── ESP32 3.3V
  Sensor 3 Pin 3 (VCC) ───┘  │  │
                             │  │
  DATA line ─────────────────┴──┼── 4.7kΩ resistor ── ESP32 3.3V
                                │
  (Only ONE pull-up resistor for the entire bus, placed near the ESP32)
```

**Notes:**
- All sensors share the same 3 wires (parallel connection)
- Only **one** 4.7kΩ pull-up resistor needed for the entire bus
- Max ~10 sensors per bus reliably; beyond that, consider lower pull-up (2.2kΩ)
- Each sensor has a unique 64-bit ROM address burned in at factory

### ESPHome YAML

```yaml
esphome:
  name: multi-temp-01
  friendly_name: "Multi-Zone Temperature"

esp32:
  board: esp32dev
  framework:
    type: esp-idf

logger:

ota:
  - platform: esphome

wifi:
  ssid: "your_wifi_ssid"
  password: "your_wifi_password"

one_wire:
  - platform: gpio
    pin: GPIO4
    id: ow_bus_1

mqtt:
  broker: 192.168.1.100
  port: 1883
  discovery: false
  on_connect:
    then:
      - mqtt.publish:
          topic: "elaris/multi-temp-01/config"
          payload: '{"device":{"name":"Multi-Zone Temp","hostname":"multi-temp-01","model":"DS18B20 x3","sw":"1.0.0"},"entities":[{"key":"zone_1_temp","group":"tele","type":"sensor","name":"Zone 1 Temperature","unit":"°C","device_class":"temperature"},{"key":"zone_2_temp","group":"tele","type":"sensor","name":"Zone 2 Temperature","unit":"°C","device_class":"temperature"},{"key":"zone_3_temp","group":"tele","type":"sensor","name":"Zone 3 Temperature","unit":"°C","device_class":"temperature"}]}'
          retain: true

sensor:
  - platform: dallas_temp
    one_wire_id: ow_bus_1
    address: 0x1C0000031EDD2A28
    name: "Zone 1 Temperature"
    id: zone_1_temp
    unit_of_measurement: "°C"
    update_interval: 30s
    on_value:
      - mqtt.publish:
          topic: "elaris/multi-temp-01/tele/zone_1_temp"
          payload: !lambda |-
            return str_sprintf("%.1f", x);

  - platform: dallas_temp
    one_wire_id: ow_bus_1
    address: 0x8C0000031F0E5B28
    name: "Zone 2 Temperature"
    id: zone_2_temp
    unit_of_measurement: "°C"
    update_interval: 30s
    on_value:
      - mqtt.publish:
          topic: "elaris/multi-temp-01/tele/zone_2_temp"
          payload: !lambda |-
            return str_sprintf("%.1f", x);

  - platform: dallas_temp
    one_wire_id: ow_bus_1
    address: 0x3D0000031A2B4C28
    name: "Zone 3 Temperature"
    id: zone_3_temp
    unit_of_measurement: "°C"
    update_interval: 30s
    on_value:
      - mqtt.publish:
          topic: "elaris/multi-temp-01/tele/zone_3_temp"
          payload: !lambda |-
            return str_sprintf("%.1f", x);
```

### Elaris Notes

- **Address discovery**: Boot the device with `index: 0`, `index: 1`, `index: 2` first, then check logs for addresses. Replace `index` with `address` for stable identification.
- Using `address` instead of `index` is **strongly recommended** — index order can change if a sensor is replaced
- The `one_wire_id` references the bus ID defined in the `one_wire:` block
- Elaris peripheral injection (`addPeripheralToYaml`) auto-increments the index when adding new DS18B20 sensors via OTA
- Each sensor gets its own MQTT topic: `elaris/<device>/tele/zone_1_temp`, etc.

---

## 3. I2C: Multiple Sensors on Same Bus

### Physical Wiring

```
ESP32          BME280              BH1750
─────          ──────              ──────
3.3V    ────── VCC          VCC ──┐
GND     ────── GND          GND ──┼── GND
GPIO21  ────── SDA          SDA ──┼── SDA (shared bus)
GPIO22  ────── SCL          SCL ──┼── SCL (shared bus)
                                ┌─┘
                                │
3.3V ─── 4.7kΩ ─────────────────┤ (SDA pull-up)
                                │
3.3V ─── 4.7kΩ ─────────────────┤ (SCL pull-up)

I2C Addresses:
  BME280:  0x76 (default) or 0x77 (SDO tied to VCC)
  BH1750:  0x23 (default, ADDR floating) or 0x5C (ADDR tied to VCC)
```

**Notes:**
- I2C requires pull-up resistors on **both** SDA and SCL lines
- 4.7kΩ is standard for short runs (<30cm); use 2.2kΩ for longer runs or many devices
- Each device has a unique I2C address — check datasheets
- ESP32 default I2C pins: GPIO21 (SDA), GPIO22 (SCL) — but any GPIO works
- KinCony boards often use dedicated I2C buses defined in board profiles

### ESPHome YAML

```yaml
esphome:
  name: env-monitor-01
  friendly_name: "Environment Monitor"

esp32:
  board: esp32dev
  framework:
    type: esp-idf

logger:

ota:
  - platform: esphome

wifi:
  ssid: "your_wifi_ssid"
  password: "your_wifi_password"

# I2C bus definition
i2c:
  - id: bus_a
    sda: GPIO21
    scl: GPIO22
    scan: true  # Scans bus at boot and logs found addresses

mqtt:
  broker: 192.168.1.100
  port: 1883
  discovery: false
  on_connect:
    then:
      - mqtt.publish:
          topic: "elaris/env-monitor-01/config"
          payload: '{"device":{"name":"Environment Monitor","hostname":"env-monitor-01","model":"BME280+BH1750","sw":"1.0.0"},"entities":[{"key":"env_temp","group":"tele","type":"sensor","name":"Environment Temperature","unit":"°C","device_class":"temperature"},{"key":"env_hum","group":"tele","type":"sensor","name":"Environment Humidity","unit":"%","device_class":"humidity"},{"key":"env_press","group":"tele","type":"sensor","name":"Environment Pressure","unit":"hPa","device_class":"pressure"},{"key":"ambient_light","group":"tele","type":"sensor","name":"Ambient Light","unit":"lx","device_class":"illuminance"}]}'
          retain: true

sensor:
  - platform: bme280_i2c
    i2c_id: bus_a
    address: 0x76
    temperature:
      name: "Environment Temperature"
      id: env_temp
      oversampling: 16x
      on_value:
        - mqtt.publish:
            topic: "elaris/env-monitor-01/tele/env_temp"
            payload: !lambda |-
              return str_sprintf("%.1f", x);
    pressure:
      name: "Environment Pressure"
      id: env_press
      oversampling: 16x
      on_value:
        - mqtt.publish:
            topic: "elaris/env-monitor-01/tele/env_press"
            payload: !lambda |-
              return str_sprintf("%.1f", x);
    humidity:
      name: "Environment Humidity"
      id: env_hum
      oversampling: 16x
      on_value:
        - mqtt.publish:
            topic: "elaris/env-monitor-01/tele/env_hum"
            payload: !lambda |-
              return str_sprintf("%.1f", x);
    update_interval: 60s

  - platform: bh1750
    i2c_id: bus_a
    address: 0x23
    name: "Ambient Light"
    id: ambient_light
    update_interval: 30s
    measurement_duration: 69  # 69 = High resolution mode 2 (0.5 lux precision)
    on_value:
      - mqtt.publish:
          topic: "elaris/env-monitor-01/tele/ambient_light"
          payload: !lambda |-
            return str_sprintf("%.0f", x);
```

### Elaris Notes

- **`bme280_i2c`** is the modern ESPHome platform name (not just `bme280`)
- `scan: true` in the I2C block logs all found device addresses at boot — invaluable for debugging
- Elaris board profiles define I2C buses with `id`, `sda`, `scl` — the generator auto-references `i2c_id`
- Multiple I2C buses supported: define separate `i2c:` entries with different IDs
- I2C address conflicts: BME280 can switch to 0x77 by tying SDO pin to VCC; BH1750 to 0x5C by tying ADDR to VCC
- Elaris discovery payload includes all sub-sensors (temp, humidity, pressure, illuminance) as separate entities

---

## 4. Analog Output (AO) — 0-10V

### Physical Wiring

```
ESP32 DAC to 0-10V Controller:

ESP32 GPIO25 (DAC1) ────┬─────── 0-10V Input (+)
                        │
                        └─── Op-amp buffer (recommended) ─── 0-10V Input (+)
                                                              (if driving long cable)

ESP32 GND ────────────────────── 0-10V Input (GND / Signal Return)

Note: ESP32 DAC outputs 0-3.3V natively.
For true 0-10V, use an op-amp circuit:

  GPIO25 ──── 10kΩ ────┬─── Op-amp (+) ──── 0-10V output
                       │
                       └─── 10kΩ ──── GND
                       
  Op-amp configured as non-inverting amplifier with gain of ~3.03
  (3.3V * 3.03 ≈ 10V)
```

**Notes:**
- ESP32 has **only two** DAC pins: GPIO25 (DAC1) and GPIO26 (DAC2)
- Native output is 0-3.3V (8-bit resolution, 0-255)
- For 0-10V control, an external op-amp or DAC module (e.g., MCP4725 + op-amp) is needed
- The ESP32-S3 does **not** have DAC pins — use ESP32 (original) or ESP32-S2

### ESPHome YAML

```yaml
esphome:
  name: ao-controller-01
  friendly_name: "Analog Output Controller"

esp32:
  board: esp32dev
  framework:
    type: esp-idf

logger:

ota:
  - platform: esphome

wifi:
  ssid: "your_wifi_ssid"
  password: "your_wifi_password"

mqtt:
  broker: 192.168.1.100
  port: 1883
  discovery: false
  on_connect:
    then:
      - mqtt.publish:
          topic: "elaris/ao-controller-01/config"
          payload: '{"device":{"name":"AO Controller","hostname":"ao-controller-01","model":"ESP32 DAC","sw":"1.0.0"},"entities":[{"key":"ao_valve","group":"state","type":"ao_output","name":"Valve Control 0-10V"}]}'
          retain: true
  on_message:
    - topic: "elaris/ao-controller-01/cmnd/ao_valve"
      then:
        - lambda: |-
            float val = atof(x.c_str());  // 0.0 to 1.0
            id(ao_valve_output).set_level(val);

output:
  - platform: esp32_dac
    pin: GPIO25
    id: ao_valve_output

# Example: expose as a number component for setting from Elaris UI
number:
  - platform: template
    name: "Valve Control 0-10V"
    id: valve_control
    min_value: 0
    max_value: 100
    step: 1
    set_action:
      then:
        - output.set_level:
            id: ao_valve_output
            level: !lambda "return x / 100.0;"
```

### Elaris Notes

- The `esp32_dac` platform outputs 0-3.3V directly. For 0-10V, external scaling hardware is required
- Elaris maps AO outputs to `elaris/<device>/cmnd/<key>` for commands (send `0.0` to `1.0` as string)
- The `level` value is a float from `0.0` (0V) to `1.0` (3.3V or 10V with amplifier)
- Alternative: use `ledc` platform for PWM-based analog output on any GPIO (requires low-pass filter)
- For higher resolution DAC, use an external I2C DAC like MCP4725:

```yaml
# External I2C DAC option (MCP4725 — 12-bit, 0-3.3V or 0-5V)
output:
  - platform: mcp4725
    id: ao_valve_output
    address: 0x60
```

---

## 5. NTC Thermistor (Analog Input)

### Physical Wiring

```
Voltage Divider Circuit:

ESP32 3.3V ──────────────────────┐
                                 │
                              ┌──┴──┐
                              │     │  10kΩ reference resistor (1% tolerance)
                              │     │  (R_ref — known, fixed value)
                              │     │
                              └──┬──┘
                                 │
                                 ├─────────── ESP32 ADC Pin (GPIO34)
                                 │
                              ┌──┴──┐
                              │     │  NTC Thermistor (e.g., 10kΩ @ 25°C)
                              │     │  (R_ntc — varies with temperature)
                              │     │
                              └──┬──┘
                                 │
ESP32 GND ───────────────────────┘

V_out = 3.3V * R_ntc / (R_ref + R_ntc)

At 25°C: R_ntc = 10kΩ, V_out = 3.3V * 10k/(10k+10k) = 1.65V
```

**Notes:**
- Use a **1% tolerance** reference resistor for accuracy
- NTC thermistor specs needed: resistance at 25°C (e.g., 10kΩ), B-constant (e.g., 3950)
- ESP32 ADC pins: GPIO32-GPIO39 (ADC1, preferred), GPIO0, GPIO2, GPIO4, GPIO12-GPIO15 (ADC2 — conflicts with WiFi)
- For best accuracy, calibrate with known temperatures (ice water = 0°C, boiling water = 100°C)
- Add a 100nF capacitor between ADC pin and GND for noise filtering

### ESPHome YAML

```yaml
esphome:
  name: ntc-temp-01
  friendly_name: "NTC Temperature Sensor"

esp32:
  board: esp32dev
  framework:
    type: esp-idf

logger:

ota:
  - platform: esphome

wifi:
  ssid: "your_wifi_ssid"
  password: "your_wifi_password"

mqtt:
  broker: 192.168.1.100
  port: 1883
  discovery: false
  on_connect:
    then:
      - mqtt.publish:
          topic: "elaris/ntc-temp-01/config"
          payload: '{"device":{"name":"NTC Temp Sensor","hostname":"ntc-temp-01","model":"NTC 10K","sw":"1.0.0"},"entities":[{"key":"ntc_temperature","group":"tele","type":"sensor","name":"NTC Temperature","unit":"°C","device_class":"temperature"}]}'
          retain: true

sensor:
  # Raw ADC reading — converts voltage to resistance
  - platform: adc
    pin: GPIO34
    id: ntc_raw
    update_interval: 10s
    attenuation: 11db  # Use 11dB attenuation for full 0-3.3V range on ESP32
    filters:
      - sliding_window_moving_average:
          window_size: 5
          send_every: 5

  # Convert ADC voltage to resistance, then to temperature
  - platform: ntc
    sensor: ntc_raw
    name: "NTC Temperature"
    id: ntc_temperature
    unit_of_measurement: "°C"
    update_interval: 10s
    calibration:
      b_constant: 3950
      reference_resistance: 10kOhm
      reference_temperature: 25°C
    on_value:
      - mqtt.publish:
          topic: "elaris/ntc-temp-01/tele/ntc_temperature"
          payload: !lambda |-
            return str_sprintf("%.1f", x);

  # Optional: output the resistance value for debugging/calibration
  - platform: resistance
    sensor: ntc_raw
    id: ntc_resistance
    configuration: DOWNSTREAM  # NTC is the bottom resistor in the divider
    reference_voltage: 3.3V
    reference_resistance: 10kOhm
    name: "NTC Resistance"
    update_interval: 10s
```

### Elaris Notes

- **Calibration is critical**: The `b_constant`, `reference_resistance`, and `reference_temperature` must match your specific NTC thermistor. Check the datasheet.
- For higher accuracy, use the 3-point calibration method. Measure resistance at 3 known temperatures and use:

```yaml
    calibration:
      - 27.3kOhm -> 0°C
      - 10.0kOhm -> 25°C
      - 1.5kOhm -> 80°C
```

- ESP32 ADC is non-linear — consider adding a `calibrate_linear` filter if precision matters
- `attenuation: 11db` is required on ESP32 to read the full 0-3.3V range (default is ~1.1V max)
- Elaris maps this as a single sensor entity to `elaris/<device>/tele/ntc_temperature`
- The `resistance` platform sensor is optional but useful for verifying the wiring and calibration

---

## 6. CT Clamp Current Sensor

### Physical Wiring

```
Non-Invasive AC Current Measurement Circuit:

  AC Mains Wire ───┐
                   │  (wire passes through CT clamp — no direct connection)
                   │
  CT Clamp (SCT-013-030, 30A/1V output)
  ┌─────────────────────────────────────┐
  │  ╭───────────────────────────────╮  │
  │  │    CT Clamp Core (opens)      │  │
  │  ╰───────────────────────────────╯  │
  └──┬──────────────────────────────┬───┘
     │                              │
     │ CT secondary leads           │
     └──────┬───────────────────┬───┘
            │                   │
         ┌──┴──┐             ┌──┴──┐
         │     │ Burden      │     │ 10kΩ
         │     │ Resistor    │     │ 10kΩ
         │     │             │     │ voltage divider
         │     │             │     │ (bias to 1.65V)
         └──┬──┘             └──┬──┘
            │                   │
            ├───────┬───────────┤
            │       │           │
         ┌──┴──┐ ┌──┴──┐     ┌──┴──┐
         │     │ │     │     │     │
         │     │ │10µF │     │     │
         │     │ │     │     │     │
         └──┬──┘ └──┬──┘     └──┬──┘
            │       │           │
            ├───────┤           │
            │                   │
ESP32 3.3V ─┘                   ├─── ESP32 ADC Pin (GPIO34)
                                │
ESP32 GND ──────────────────────┘

Simplified (CT clamp module with built-in burden + bias):
  CT Module VCC ─── ESP32 3.3V
  CT Module GND ─── ESP32 GND
  CT Module OUT ─── ESP32 GPIO34 (ADC)
```

**Notes:**
- The SCT-013-030 outputs 1V at 30A (has built-in burden resistor)
- For SCT-013-000 (no burden), add an external burden resistor (e.g., 33Ω for 30A)
- The voltage divider (two 10kΩ resistors) biases the AC signal to ~1.65V midpoint
- A 10µF capacitor smooths the bias voltage
- **WARNING**: Mains voltage is dangerous. The CT clamp is non-invasive but the circuit connects to the ESP32

### ESPHome YAML

```yaml
esphome:
  name: current-monitor-01
  friendly_name: "AC Current Monitor"

esp32:
  board: esp32dev
  framework:
    type: esp-idf

logger:

ota:
  - platform: esphome

wifi:
  ssid: "your_wifi_ssid"
  password: "your_wifi_password"

mqtt:
  broker: 192.168.1.100
  port: 1883
  discovery: false
  on_connect:
    then:
      - mqtt.publish:
          topic: "elaris/current-monitor-01/config"
          payload: '{"device":{"name":"Current Monitor","hostname":"current-monitor-01","model":"SCT-013-030","sw":"1.0.0"},"entities":[{"key":"ac_current","group":"tele","type":"sensor","name":"AC Current","unit":"A","device_class":"current"},{"key":"ac_power","group":"tele","type":"sensor","name":"AC Power","unit":"W","device_class":"power"}]}'
          retain: true

sensor:
  # Raw ADC — reads the biased AC waveform
  - platform: adc
    pin: GPIO34
    id: ct_raw
    update_interval: 1s
    attenuation: 11db

  # CT clamp processing — extracts RMS current from the AC waveform
  - platform: ct_clamp
    sensor: ct_raw
    name: "AC Current"
    id: ac_current
    unit_of_measurement: "A"
    device_class: current
    sample_duration: 200ms  # Sample for 200ms to capture multiple AC cycles
    update_interval: 5s
    filters:
      - calibrate_linear:
          # Map ADC reading to actual current
          # 0A -> 0A (no current)
          # Known load calibration point:
          - 0 -> 0
          - 0.045 -> 10.0  # Example: 10A load produces 0.045V RMS on ADC
    on_value:
      - mqtt.publish:
          topic: "elaris/current-monitor-01/tele/ac_current"
          payload: !lambda |-
            return str_sprintf("%.2f", x);

  # Calculated power (assuming 230V mains — adjust for your region)
  - platform: template
    name: "AC Power"
    id: ac_power
    unit_of_measurement: "W"
    device_class: power
    lambda: |-
      if (id(ac_current).has_state()) {
        return id(ac_current).state * 230.0;  // P = I × V (230V mains)
      }
      return {};
    update_interval: 5s
    on_value:
      - mqtt.publish:
          topic: "elaris/current-monitor-01/tele/ac_power"
          payload: !lambda |-
            return str_sprintf("%.1f", x);
```

### Elaris Notes

- **Calibration is essential**: The `calibrate_linear` mapping must be determined empirically. Use a known load (e.g., a 100W bulb = ~0.43A at 230V) and measure the raw ADC value
- The `sample_duration` should cover multiple AC cycles: 200ms captures 10 cycles at 50Hz or 12 cycles at 60Hz
- For the SCT-013-030 (1V output at 30A), the calibration factor is approximately: `raw_voltage / 1.0 * 30.0`
- Elaris publishes both current and calculated power to separate MQTT topics
- For accurate power measurement (including power factor), use a dedicated energy monitor like PZEM-004T (see example 8) instead of CT clamp + template
- The `ct_clamp` platform only measures AC current — it cannot measure DC

---

## 7. MH-Z19 CO2 Sensor (UART)

### Physical Wiring

```
MH-Z19 to ESP32 (cross-wired UART):

MH-Z19 Pinout (JST connector, 5 pins):
  Pin 1 (Vin)    ─── ESP32 5V (or external 5V supply)
  Pin 2 (GND)    ─── ESP32 GND
  Pin 3 (RX)     ─── ESP32 GPIO17 (TX pin — cross-wired!)
  Pin 4 (TX)     ─── ESP32 GPIO16 (RX pin — cross-wired!)
  Pin 5 (PWM)    ─── Not used (analog PWM output alternative)

  ┌────────────────────────────────────────────┐
  │  MH-Z19 Module                              │
  │                                             │
  │  Vin ─── 5V                                 │
  │  GND ─── GND                                │
  │  RX  ─── GPIO17 (ESP32 TX)  ← cross-wired   │
  │  TX  ─── GPIO16 (ESP32 RX)  ← cross-wired   │
  │                                             │
  │  ⚠ MH-Z19 requires 5V logic!               │
  │  For 3.3V ESP32: use a level shifter       │
  │  or rely on the fact that most MH-Z19       │
  │  modules accept 3.3V on RX                  │
  └────────────────────────────────────────────┘

Level shifter (if needed):
  ESP32 TX (3.3V) ─── Level Shifter ─── MH-Z19 RX (5V)
  MH-Z19 TX (5V) ──── Level Shifter ─── ESP32 RX (3.3V)
```

**Notes:**
- UART pins are **cross-wired**: ESP TX → Sensor RX, Sensor TX → ESP RX
- MH-Z19 requires 5V power (draws ~100mA during heating)
- Most MH-Z19 modules work with 3.3V UART logic, but a level shifter is recommended for reliability
- Allow 3 minutes warm-up time after power-on for accurate readings
- Disable automatic baseline calibration (ABC) for indoor use — it assumes the sensor sees 400ppm (outdoor air) regularly

### ESPHome YAML

```yaml
esphome:
  name: co2-monitor-01
  friendly_name: "CO2 Monitor"

esp32:
  board: esp32dev
  framework:
    type: esp-idf

logger:

ota:
  - platform: esphome

wifi:
  ssid: "your_wifi_ssid"
  password: "your_wifi_password"

# UART bus for MH-Z19
uart:
  id: uart_co2
  tx_pin: GPIO17
  rx_pin: GPIO16
  baud_rate: 9600

mqtt:
  broker: 192.168.1.100
  port: 1883
  discovery: false
  on_connect:
    then:
      - mqtt.publish:
          topic: "elaris/co2-monitor-01/config"
          payload: '{"device":{"name":"CO2 Monitor","hostname":"co2-monitor-01","model":"MH-Z19","sw":"1.0.0"},"entities":[{"key":"co2_level","group":"tele","type":"sensor","name":"CO2 Level","unit":"ppm","device_class":"carbon_dioxide"},{"key":"co2_temp","group":"tele","type":"sensor","name":"CO2 Sensor Temperature","unit":"°C","device_class":"temperature"}]}'
          retain: true

sensor:
  - platform: mhz19
    uart_id: uart_co2
    update_interval: 60s
    automatic_baseline_calibration: false  # Disable ABC for indoor use
    co2:
      name: "CO2 Level"
      id: co2_level
      unit_of_measurement: "ppm"
      device_class: carbon_dioxide
      on_value:
        - mqtt.publish:
            topic: "elaris/co2-monitor-01/tele/co2_level"
            payload: !lambda |-
              return str_sprintf("%.0f", x);
    temperature:
      name: "CO2 Sensor Temperature"
      id: co2_temp
      unit_of_measurement: "°C"
      on_value:
        - mqtt.publish:
            topic: "elaris/co2-monitor-01/tele/co2_temp"
            payload: !lambda |-
              return str_sprintf("%.1f", x);

# Optional: expose calibration button
button:
  - platform: template
    name: "MH-Z19 Zero Point Calibration"
    id: mhz19_calibrate
    on_press:
      - mhz19.calibrate_zero:
          id: co2_level
  - platform: template
    name: "MH-Z19 Reset Zero Point"
    on_press:
      - mhz19.abc_reset:
          id: co2_level
```

### Elaris Notes

- The `automatic_baseline_calibration: false` is **critical** for indoor use — ABC will drift readings if the sensor never sees outdoor air (400ppm)
- The MH-Z19 reports both CO2 (ppm) and an internal temperature (less accurate than a dedicated temp sensor)
- Elaris maps CO2 to `elaris/<device>/tele/co2_level` and temperature to `elaris/<device>/tele/co2_temp`
- UART bus must be defined with `tx_pin` and `rx_pin` — the MH-Z19 uses 9600 baud
- For outdoor/ventilation calibration: place sensor in fresh outdoor air for 20+ minutes, then trigger `mhz19.calibrate_zero`
- The MH-Z19 has a 3-minute warm-up period — readings during this time are unreliable
- If using with Elaris OTA peripheral injection, the `uart_id` references the bus defined in the board profile

---

## 8. PZEM-004T (Modbus/UART)

### Physical Wiring

```
PZEM-004T V3.0 to ESP32 (via RS485 TTL module):

PZEM-004T V3.0 has built-in RS485 interface:
  PZEM-004T A+ ──── RS485 Module A (or directly to ESP32 via MAX485)
  PZEM-004T B- ──── RS485 Module B

If using a MAX485/TTL-to-RS485 module:
  ┌─────────────────────────────────────────┐
  │  MAX485 Module                          │
  │                                         │
  │  A  ───────────── PZEM-004T A+          │
  │  B  ───────────── PZEM-004T B-          │
  │  RO ───────────── ESP32 GPIO16 (RX)     │
  │  DI ───────────── ESP32 GPIO17 (TX)     │
  │  RE ───┐                                │
  │  DE  ──┼──── ESP32 GPIO5 (control)      │
  │        │                                │
  │  VCC ───────────── ESP32 3.3V or 5V    │
  │  GND ───────────── ESP32 GND            │
  └─────────────────────────────────────────┘

PZEM-004T AC Input (DANGER — Mains Voltage):
  L (Live)  ──── PZEM-004T L input
  N (Neutral) ── PZEM-004T N input
  Load ───────── PZEM-004T L output → Load → N

  ⚠ The current clamp (CT) must be around the LIVE wire only
  ⚠ The voltage measurement is taken from the L/N input terminals
  ⚠ Mains voltage is lethal — proper enclosure and isolation required
```

**Notes:**
- PZEM-004T V3.0 uses Modbus RTU over RS485 at 9600 baud
- The V3.0 version has built-in RS485 (no separate TTL module needed)
- Multiple PZEM-004T units can share the same RS485 bus with different addresses (default: 0xF8)
- The CT clamp must be around **one conductor only** (Live or Neutral, not both)
- Voltage measurement is direct from the input terminals — no external wiring needed

### ESPHome YAML

```yaml
esphome:
  name: energy-monitor-01
  friendly_name: "Energy Monitor"

esp32:
  board: esp32dev
  framework:
    type: esp-idf

logger:
  baud_rate: 0  # Disable logger UART to free up hardware UART for PZEM

ota:
  - platform: esphome

wifi:
  ssid: "your_wifi_ssid"
  password: "your_wifi_password"

# UART bus for PZEM-004T
uart:
  id: uart_pzem
  tx_pin: GPIO17
  rx_pin: GPIO16
  baud_rate: 9600
  # For RS485 with DE/RE control pin:
  #   tx_pin:
  #     number: GPIO17
  #     mode: OUTPUT
  #   rx_pin:
  #     number: GPIO16
  #     mode: INPUT
  #   rs485:
  #     de_pin: GPIO5
  #     rx_pin: GPIO16

mqtt:
  broker: 192.168.1.100
  port: 1883
  discovery: false
  on_connect:
    then:
      - mqtt.publish:
          topic: "elaris/energy-monitor-01/config"
          payload: '{"device":{"name":"Energy Monitor","hostname":"energy-monitor-01","model":"PZEM-004T V3","sw":"1.0.0"},"entities":[{"key":"power","group":"tele","type":"sensor","name":"Power","unit":"W","device_class":"power"},{"key":"voltage","group":"tele","type":"sensor","name":"Voltage","unit":"V","device_class":"voltage"},{"key":"current","group":"tele","type":"sensor","name":"Current","unit":"A","device_class":"current"},{"key":"energy","group":"tele","type":"sensor","name":"Energy","unit":"kWh","device_class":"energy"}]}'
          retain: true

sensor:
  - platform: pzemac
    uart_id: uart_pzem
    update_interval: 30s
    voltage:
      name: "Voltage"
      id: voltage
      unit_of_measurement: "V"
      device_class: voltage
      accuracy_decimals: 1
      on_value:
        - mqtt.publish:
            topic: "elaris/energy-monitor-01/tele/voltage"
            payload: !lambda |-
              return str_sprintf("%.1f", x);
    current:
      name: "Current"
      id: current
      unit_of_measurement: "A"
      device_class: current
      accuracy_decimals: 3
      on_value:
        - mqtt.publish:
            topic: "elaris/energy-monitor-01/tele/current"
            payload: !lambda |-
              return str_sprintf("%.3f", x);
    power:
      name: "Power"
      id: power
      unit_of_measurement: "W"
      device_class: power
      accuracy_decimals: 1
      on_value:
        - mqtt.publish:
            topic: "elaris/energy-monitor-01/tele/power"
            payload: !lambda |-
              return str_sprintf("%.1f", x);
    energy:
      name: "Energy"
      id: energy
      unit_of_measurement: "kWh"
      device_class: energy
      accuracy_decimals: 3
      on_value:
        - mqtt.publish:
            topic: "elaris/energy-monitor-01/tele/energy"
            payload: !lambda |-
              return str_sprintf("%.3f", x);
    frequency:
      name: "Frequency"
      id: frequency
      unit_of_measurement: "Hz"
      accuracy_decimals: 1
      on_value:
        - mqtt.publish:
            topic: "elaris/energy-monitor-01/tele/frequency"
            payload: !lambda |-
              return str_sprintf("%.1f", x);
    power_factor:
      name: "Power Factor"
      id: power_factor
      accuracy_decimals: 2
      on_value:
        - mqtt.publish:
            topic: "elaris/energy-monitor-01/tele/power_factor"
            payload: !lambda |-
              return str_sprintf("%.2f", x);
```

### Elaris Notes

- **`pzemac`** is the ESPHome platform for PZEM-004T V3.0 (AC version). For DC, use `pzemdc`
- The `logger: baud_rate: 0` is **important** — the default logger uses UART0, which can conflict with the PZEM's UART
- PZEM-004T reports: voltage, current, power, energy, frequency, and power factor
- Energy is cumulative (stored in the PZEM's internal EEPROM) — it persists across reboots
- For multiple PZEM units on the same RS485 bus, set different addresses using the `pzemac.set_address` action
- Elaris maps each measurement to its own MQTT topic under `elaris/<device>/tele/<key>`
- The Elaris generator uses `pzemac` platform for `pzem004t` entity types (see `generator.js:810`)

---

## 9. Pulse Counter — Water Flow YF-S201

### Physical Wiring

```
YF-S201 Water Flow Sensor to ESP32:

YF-S201 Pinout (3 wires: Red, Black, Yellow):

  Red    (VCC)   ─── ESP32 5V (or 3.3V — works with both)
  Black  (GND)   ─── ESP32 GND
  Yellow (Pulse) ──┬──────── ESP32 GPIO (e.g., GPIO32)
                   │
                   └── 10kΩ pull-up resistor ── ESP32 3.3V

  ┌──────────────────────────────────────────┐
  │  YF-S201                                 │
  │                                          │
  │  Water flow direction: → (arrow on body) │
  │                                          │
  │  Red ─── 5V                              │
  │  Black ── GND                            │
  │  Yellow ─ Pulse output (open-collector)  │
  │            needs pull-up to 3.3V         │
  └──────────────────────────────────────────┘

YF-S201 Specifications:
  Operating voltage: 5-18V DC (works at 3.3V)
  Max current: 15mA
  Pulse characteristic: f = 7.5 * Q (L/min)
    → 1 L/min = 7.5 pulses/second = 450 pulses/minute
  Max pressure: 1.75 MPa
  Flow range: 1-30 L/min
```

**Notes:**
- The pulse output is **open-collector** — requires a pull-up resistor (10kΩ to 3.3V)
- The YF-S201 generates ~450 pulses per minute per L/min of flow
- Formula: `Flow (L/min) = Pulse frequency (Hz) / 7.5` or `Pulses per minute / 450`
- Install with correct flow direction (arrow on sensor body)
- For best accuracy, install with straight pipe sections before and after the sensor

### ESPHome YAML

```yaml
esphome:
  name: water-flow-01
  friendly_name: "Water Flow Monitor"

esp32:
  board: esp32dev
  framework:
    type: esp-idf

logger:

ota:
  - platform: esphome

wifi:
  ssid: "your_wifi_ssid"
  password: "your_wifi_password"

mqtt:
  broker: 192.168.1.100
  port: 1883
  discovery: false
  on_connect:
    then:
      - mqtt.publish:
          topic: "elaris/water-flow-01/config"
          payload: '{"device":{"name":"Water Flow Monitor","hostname":"water-flow-01","model":"YF-S201","sw":"1.0.0"},"entities":[{"key":"water_flow_rate","group":"tele","type":"sensor","name":"Water Flow Rate","unit":"L/min"},{"key":"water_total","group":"tele","type":"sensor","name":"Water Total","unit":"L"}]}'
          retain: true

sensor:
  # Instantaneous flow rate
  - platform: pulse_counter
    pin:
      number: GPIO32
      mode:
        input: true
        pullup: true  # Internal pull-up (external 10kΩ recommended for reliability)
    name: "Water Flow Rate"
    id: water_flow_rate
    unit_of_measurement: "L/min"
    update_interval: 10s
    filters:
      # YF-S201: 450 pulses/min = 1 L/min
      # pulse_counter reports pulses/min by default
      - lambda: return x / 450.0;
    on_value:
      - mqtt.publish:
          topic: "elaris/water-flow-01/tele/water_flow_rate"
          payload: !lambda |-
            return str_sprintf("%.2f", x);

  # Total water consumption (integrated over time)
  - platform: total_daily_energy
    name: "Water Total Today"
    id: water_total_daily
    power_id: water_flow_rate
    unit_of_measurement: "L"
    accuracy_decimals: 1
    # This integrates L/min over time to get total liters
    # Note: total_daily_energy resets at midnight

  # Alternative: use integration sensor for cumulative total
  - platform: integration
    sensor: water_flow_rate
    name: "Water Total Cumulative"
    id: water_total_cumulative
    unit_of_measurement: "L"
    time_unit: min  # Input is L/min, integrate over minutes
    accuracy_decimals: 1
    on_value:
      - mqtt.publish:
          topic: "elaris/water-flow-01/tele/water_total"
          payload: !lambda |-
            return str_sprintf("%.1f", x);
```

### Elaris Notes

- The `pulse_counter` platform reports **pulses per minute** by default. The `lambda` filter converts to L/min using the YF-S201 factor (÷ 450)
- The `integration` sensor provides a cumulative total that persists (stored in ESP32 flash)
- `total_daily_energy` resets at midnight — useful for daily consumption tracking
- For other flow sensors, adjust the divisor:
  - YF-S201: ÷ 450 (pulses/min per L/min)
  - YF-B4: ÷ 225
  - YF-B5: ÷ 330
  - Generic: `pulses_per_liter / 60` for Hz → L/min
- Elaris peripheral injection supports `pulse_counter` with `scale: yfs201` which auto-generates the correct filter
- The internal `pullup: true` works but an external 10kΩ pull-up is more reliable for long cable runs
- For Elaris MQTT mapping: flow rate goes to `elaris/<device>/tele/water_flow_rate`, total to `elaris/<device>/tele/water_total`

---

## Quick Reference: Elaris MQTT Topic Structure

| Topic Pattern | Purpose | Retained |
|---|---|---|
| `elaris/<device>/config` | Device discovery payload (JSON) | Yes |
| `elaris/<device>/state/<key>` | Relay/switch state (ON/OFF) | Yes |
| `elaris/<device>/tele/<key>` | Telemetry (sensor readings) | No |
| `elaris/<device>/cmnd/<key>` | Commands (send ON/OFF/value) | No |

## Quick Reference: Elaris Entity Types

| Entity Type | ESPHome Platform | MQTT Topic |
|---|---|---|
| `ds18b20` | `dallas_temp` | `tele/<key>` |
| `dht` / `dht11` | `dht` | `tele/<key>`, `tele/<key>_hum` |
| `bme280` | `bme280_i2c` | `tele/<key>`, `tele/<key>_hum`, `tele/<key>_press` |
| `bh1750` | `bh1750` | `tele/<key>` |
| `sht3x` | `sht3xd` | `tele/<key>`, `tele/<key>_hum` |
| `ina219` | `ina219` | `tele/<key>`, `tele/<key>_power`, `tele/<key>_voltage` |
| `ccs811` | `ccs811` | `tele/<key>`, `tele/<key>_tvoc` |
| `mhz19` | `mhz19` | `tele/<key>`, `tele/<key>_temp` |
| `pzem004t` | `pzemac` | `tele/<key>`, `tele/<key>_voltage`, `tele/<key>_current`, `tele/<key>_energy` |
| `pulse_counter` | `pulse_counter` | `tele/<key>` |
| `analog` | `adc` | `tele/<key>` |
| `relay` | `gpio` (switch) | `state/<key>` |
| `di` | `gpio` (binary_sensor) | `tele/<key>` |

## Elaris-Specific Rules

1. **No `!secret` tags** — All passwords, SSIDs, and API keys must be literal values in the YAML
2. **MQTT discovery is disabled** (`discovery: false`) — Elaris uses its own discovery mechanism via the `elaris/<device>/config` topic
3. **All sensor values are published via MQTT** on every update using `on_value` triggers
4. **Board profiles** define pin mappings, I2C buses, and PCF8574 expanders — the generator auto-includes these
5. **OTA peripheral injection** uses `addPeripheralToYaml()` to add sensors to existing YAML files without full re-flash
6. **Entity keys** must be lowercase, alphanumeric with underscores (auto-sanitized by `safeName()`)
7. **Relay commands** are received via `on_message` handlers that parse the payload and call `turn_on()`/`turn_off()`
