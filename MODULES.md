# ELARIS — Automation Modules Reference

Detailed documentation for all automation modules: features, IOs, settings, and suggested improvements.

---

## Table of Contents

1. [Thermostat](#1-thermostat)
2. [Lighting Control](#2-lighting-control)
3. [Smart Lighting](#3-smart-lighting)
4. [Awning / Blind Control](#4-awning--blind-control)
5. [Solar V2](#5-solar-v2)
6. [Pool & Spa](#6-pool--spa)
7. [Irrigation](#7-irrigation)
8. [Water Manager](#8-water-manager)
9. [Hydronic Manager](#9-hydronic-manager)
10. [Energy Monitor](#10-energy-monitor)
11. [Load Shifter](#11-load-shifter)
12. [Maintenance Tracker](#12-maintenance-tracker)
13. [Presence Simulator](#13-presence-simulator)
14. [Industrial Logic (Custom)](#14-industrial-logic-custom)
15. [Grid Tie / Next-to-Line](#15-grid-tie--next-to-line) *(planned)*
16. [Alarm System](#16-alarm-system) *(planned)*
17. [HVAC Unit (KKM)](#17-hvac-unit-kkm) *(planned)*
18. [Pressure System](#18-pressure-system) *(planned)*
19. [Generator Manager](#19-generator-manager) *(planned)*
20. [EV Charger Manager](#20-ev-charger-manager) *(planned)*
21. [Hot Water Recirculation](#21-hot-water-recirculation) *(planned)*

---

## 1. Thermostat

**ID:** `thermostat` | **Icon:** 🌡️ | **Category:** climate | **Color:** #00c8ff

### Description
Room thermostat with support for up to 6 independent zones, central circulation pump, and open window detection.

### Inputs / Outputs

| Key | Type | Description |
|-----|------|-------------|
| `temp_room` | sensor | Room temperature (legacy, zone 1) |
| `ac_relay` | relay | Heating/cooling output (legacy, zone 1) |
| `temp_outdoor` | sensor | Outdoor temperature (for pre-heat/cool) |
| `central_pump` | relay | Central circulation pump |
| `zone_1_temp` … `zone_6_temp` | sensor | Temperature sensor per zone |
| `zone_1_call` … `zone_6_call` | sensor/DI | Zone heating request (thermostat call) |
| `zone_1_output` … `zone_6_output` | relay | Zone valve / relay output |
| `zone_1_pump` … `zone_6_pump` | relay | Zone circulation pump |
| `humidity` | sensor | Room humidity sensor (%) — enables humidity control |
| `humidity_relay` | relay | Dehumidifier / humidifier relay output |

### Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `mode` | enum | `heating` | `heating` / `cooling` / `off` |
| `setpoint` | °C | 21 | Global target temperature (used by all zones unless overridden) |
| `hysteresis` | °C | 0.5 | Global dead band (used by all zones unless overridden) |
| `min_run_time` | s | 120 | Minimum ON time |
| `min_off_time` | s | 120 | Minimum OFF time |
| `pump_post_run` | s | 60 | Time central pump stays on after zone demand ends |
| `window_detect` | 0/1 | 1 | Open window detection (sudden temperature drop) |
| `window_drop` | °C | 0.5 | Drop threshold for window detection |
| `pre_enable` | 0/1 | 0 | Pre-heat/cool based on outdoor temperature |
| `pre_target_time` | HH:MM | `07:00` | Target ready time for pre-heat/cool |
| `zone_N_setpoint` | °C | — | Per-zone setpoint override (N = 1–6). Overrides global setpoint for that zone only. |
| `zone_N_hysteresis` | °C | — | Per-zone hysteresis override (N = 1–6). |
| `zone_N_schedule` | JSON | `""` | Per-zone time schedule. JSON array of slots: `[{"days":"weekday","start":"06:00","end":"22:00","setpoint":21},{"days":"all","start":"22:00","end":"06:00","setpoint":18}]`. Days: `all`, `weekday`, `weekend`, `mon`–`sun`. Overnight slots (start > end) are supported. |
| `holiday_mode` | on/off | `off` | When `on`, overrides ALL zone setpoints with the protection setpoint |
| `holiday_setpoint` | °C | 7 | Frost/heat protection setpoint used when holiday mode is active |
| `humidity_setpoint` | % | 55 | Target relative humidity |
| `humidity_hysteresis` | % | 3 | Dead band around humidity setpoint |

### Improvements

- [ ] **Adaptive setpoint** — auto-adjust based on history (e.g. +0.5°C if room never reaches setpoint)
- [ ] **Zone prioritization** — rank zones when heat source has limited capacity
- [ ] **Boost mode** — quick heat +X°C for N minutes (manual trigger)
- [x] **Per-zone scheduler** — different setpoint per time slot (night / day / away) ✓
- [x] **Holiday mode** — automatically switch to frost-protection setpoint when away ✓
- [x] **Humidity control** — room humidity as a secondary control parameter ✓

---

## 2. Lighting Control

**ID:** `lighting` | **Icon:** 💡 | **Category:** lighting | **Color:** #ffd700

### Description
Lighting control with PIR motion, lux sensor, dimmer, time/sunset schedules, and manual override.

### Inputs / Outputs

| Key | Type | Description |
|-----|------|-------------|
| `light_relay` | relay | Light on/off relay |
| `dimmer_output` | analog (AO) | Dimmer 0–100% |
| `switch_di` | sensor/DI | Wall switch |
| `pir_sensor` | sensor/DI | PIR motion sensor |
| `motion_ai` | sensor (AI) | Presence sensor 0–100% |
| `lux_sensor` | sensor (AI) | Ambient light sensor (lux) |

### Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `mode` | enum | `auto` | `auto` / `pir` / `lux` / `schedule` / `combined` / `manual` |
| `pir_timeout` | s | 300 | OFF delay after last motion |
| `motion_threshold` | % | 10 | Presence sensor (AI) threshold |
| `lux_threshold` | lux | 50 | Below this value is considered "dark" |
| `dim_on_level` | % | 100 | Brightness when ON |
| `dim_off_level` | % | 0 | Brightness when OFF |
| `schedule_on` | HH:MM / sunset±N | `""` | Turn-on time |
| `schedule_off` | HH:MM / sunrise±N | `""` | Turn-off time |
| `switch_toggle` | 0/1 | 1 | 1=toggle, 0=follow |
| `manual_timeout_s` | s | 0 | Manual override expiry (0=permanent) |

### Mode Logic

- **auto** — Priority stack: schedule OFF > bright override > motion+dark > lux only > schedule only
- **pir** — Motion → ON, timeout → OFF
- **lux** — Dark → ON, bright → OFF
- **schedule** — Fixed times only
- **combined** — Motion AND dark both required
- **manual** — Dashboard/switch control only

### Improvements

- [x] **Multi-relay support** — light_relay_2/3/4 controlled in parallel ✓
- [x] **Lux-based dimming** — `lux_dim_target` maintains target lux via dimmer auto-adjust ✓
- [x] **Double-tap switch** — two presses < 500ms → configurable `double_tap_level` ✓
- [ ] **Dim-to-wake** — gradual brightness ramp up (alarm clock mode)
- [ ] **Scene integration** — allow Scenes to activate lighting modes
- [ ] **Circadian rhythm** — color temperature shifts throughout the day

---

## 3. Smart Lighting

**ID:** `smart_lighting` | **Icon:** ✨ | **Category:** smart | **Color:** #f0c040

### Description
Scenario-based lighting. User defines moods (Evening, Cinema, Wake-up...) with triggers and dimming levels. Supports Panic Mode and Adaptive Dimming.

### Inputs / Outputs (Dynamic, max 20)

| Prefix | Type | Description |
|--------|------|-------------|
| `do_1` … `do_N` | relay | Relay output (on/off) |
| `ao_1` … `ao_N` | analog (AO) | Dimmer output 0–100% |
| `di_1` … `di_N` | sensor/DI | Digital input (switch, PIR, etc.) |
| `ai_1` … `ai_N` | sensor (AI) | Analog input (lux, presence) |

### Settings

| Key | Type | Description |
|-----|------|-------------|
| `scenarios` | JSON array | List of scenarios (see schema below) |
| `panic_enable` | 0/1 | Enable Panic Mode |
| `panic_input` | key | DI source for panic trigger |
| `_active_scenario` | JSON | (runtime) Currently active scenario |

### Scenario Schema

```json
{
  "id": "evening",
  "name": "Evening",
  "enabled": true,
  "priority": 10,
  "outputs": [{ "io_key": "ao_1", "level": 40 }],
  "fade_s": 3,
  "trigger": "sunset",
  "trigger_sun": "sunset+20",
  "off_after": 0,
  "adaptive_dimming": false,
  "lux_target": 400
}
```

**Trigger types:** `manual` / `time` / `pir` / `switch` / `sunset` / `sunrise` / `scene`

### Improvements

- [x] **Fade transitions** — smooth dimmer ramp over `fade_s` seconds using setInterval ✓
- [x] **Lux trigger** — `trigger: "lux"` + `trigger_lux_max` activates scenario when dark ✓
- [x] **Panic mode persistence** — `_panic` setting saved to DB, restored on restart ✓
- [ ] **Scenario sequencing** — chain scenarios (A → B after N minutes)
- [ ] **Conditional scenarios** — activate only if another IO is in a specific state
- [ ] **Multi-instance sync** — one scenario affects outputs of another instance

---

## 4. Awning / Blind Control

**ID:** `awning` | **Icon:** 🌬️ | **Category:** shading | **Color:** #94a3b8

### Description
Automatic awning/blind control. Safety retraction on wind or rain, deployment for sun shading.

### Inputs / Outputs

| Key | Type | Description |
|-----|------|-------------|
| `relay_open` | relay | Open/extend relay (required) |
| `relay_close` | relay | Close/retract relay (required) |
| `wind_sensor` | sensor (AI) | Wind speed km/h (required) |
| `rain_sensor` | sensor/DI | Rain detected (ON/OFF or mm) |
| `lux_sensor` | sensor (AI) | Solar radiation intensity (lux) |
| `temp_outdoor` | sensor (AI) | Outdoor temperature (reserved, unused) |
| `endstop_open` | sensor/DI | End-stop switch confirming fully open position (optional) |
| `endstop_close` | sensor/DI | End-stop switch confirming fully closed/retracted position (optional) |

### Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `wind_retract` | km/h | 40 | Retract above X km/h |
| `wind_deploy` | km/h | 20 | Re-deploy below X km/h |
| `rain_retract` | 0/1 | 1 | Retract on rain |
| `lux_deploy` | lux | 50000 | Deploy above X lux |
| `lux_retract` | lux | 20000 | Retract below X lux |
| `move_time` | s | 30 | Full travel duration (open → close). Set by installer on commissioning. |
| `gust_enable` | 0/1 | 1 | Wind gust detection |
| `gust_threshold` | km/h | 15 | Wind rise within 10s = gust |
| `night_retract` | 0/1 | 0 | Retract at sunset |
| `night_offset` | min | 0 | Minutes after sunset |
| `deploy_percent` | % | 100 | Target open position for auto/manual deploy (1–100). Allows partial deployment. |

### Improvements

- [x] **Position tracking** — position % (0=closed, 100=open) tracked via dead reckoning (elapsed time / move_time). Proportional travel on partial open/close. Persisted to DB. ✓
- [x] **Partial deployment** — `deploy_percent` setting stops motor at target % instead of always fully opening ✓
- [ ] **Temperature-based shading** — deploy based on outdoor temperature (input already mapped, logic missing)
- [x] **End-stop switches** — optional `endstop_open` / `endstop_close` DI inputs stop motor and lock position on rising edge ✓
- [ ] **Manual override expiry** — manual override expires after N hours
- [ ] **Multiple awnings** — currently only 1 per instance, requires duplication

---

## 5. Solar V2

**ID:** `solar_v2` | **Icon:** ☀️ | **Category:** solar

### Description
Solar thermal system with differential temperature (ΔT) control, variable-speed inverter pump, electric boiler backup, overheat protection, legionella cycle, anti-freeze pump protection, and collector stagnation detection.

### Inputs / Outputs

| Key | Type | Description |
|-----|------|-------------|
| `temp_solar` | sensor | Collector temperature |
| `temp_boiler` | sensor | Boiler temperature |
| `pump` | relay | Circulation pump (ON/OFF or inverter) |
| `pump_speed` | analog (AO) | Pump speed 0–100% (inverter mode) |
| `heater` | relay | Electric boiler (backup) |
| `backup` | relay | Alternative heat source |

### Settings — Basic Mode

| Key | Default | Description |
|-----|---------|-------------|
| `dt_on` | 8 | Pump start ΔT (°C) |
| `dt_off` | 3 | Pump stop ΔT (°C) |
| `max_boiler_temp` | 85 | Boiler safety cutoff (°C) |
| `min_solar_temp` | 40 | Minimum collector temp to start pump |
| `pump_min_on_s` | 60 | Minimum ON time |
| `pump_min_off_s` | 120 | Minimum OFF time |
| `force_pump_on` | false | Manual pump override |

### Settings — Inverter Mode (additional)

| Key | Default | Description |
|-----|---------|-------------|
| `profile` | `basic` | `basic` / `inverter_dt` |
| `dt_target` | 10 | Target ΔT for PI control |
| `min_speed` | 25 | Minimum pump speed % |
| `max_speed` | 100 | Maximum pump speed % |
| `kp` / `ki` | 2.0 / 0.05 | PI gains |
| `ema_alpha` | 0.25 | EMA smoothing factor |
| `kickstart_s` / `kickstart_pct` | 5 / 80 | Startup boost duration and level |
| `anti_cycle_s` | 60 | Minimum time between start/stop |

### Settings — Heater / Backup

| Key | Default | Description |
|-----|---------|-------------|
| `heater_enable` | 0 | Enable electric heater |
| `heater_on_below` | 45 | Heater ON below °C |
| `heater_off_above` | 55 | Heater OFF above °C |
| `heater_min_on_s` / `heater_min_off_s` | 300 / 300 | Minimum ON/OFF timers |
| `heater_lockout_when_pump_on` | 1 | Interlock with solar pump |
| `backup_enable` | 0 | Enable backup heat source |
| `backup_on_below` / `backup_off_above` | 40 / 50 | Backup hysteresis |
| `backup_lockout_when_pump_on` | 1 | Interlock with solar pump |

### Settings — Safety & Protection

| Key | Default | Description |
|-----|---------|-------------|
| `anti_freeze_enable` | 0 | Enable anti-freeze pump protection |
| `anti_freeze_temp` | 4 | Collector temp threshold to trigger (°C) |
| `anti_freeze_run_s` | 30 | Duration to run pump during anti-freeze (s) |
| `legionella_enable` | 0 | Enable legionella protection cycle |
| `legionella_temp` | 60 | Target boiler temp for legionella cycle (°C) |
| `legionella_interval_days` | 7 | Minimum days between legionella cycles |
| `legionella_max_days` | 3 | Force cycle if boiler hasn't reached legionella temp for this many days |
| `stagnation_temp` | 90 | Collector temp threshold for stagnation detection (°C) |
| `stagnation_min_s` | 600 | Seconds at stagnation temp before alert fires |

### Improvements

- [x] **Legionella protection** — weekly auto-heat to 60°C
- [x] **Anti-freeze** — run pump briefly at low collector temps to prevent freezing
- [x] **Collector stagnation alert** — detects when collector stays hot without producing useful energy
- [ ] **Night cooling** — cool the boiler overnight when overheated
- [ ] **Energy yield tracking** — kWh produced by solar (integration over time)

---

## 6. Pool & Spa

**ID:** `pool_spa` | **Icon:** 🏊 | **Category:** water

### Description
Full pool and spa management: filtration, heating (solar + heater + backup), water chemistry (pH/ORP), spa boost mode, anti-freeze.

### Inputs / Outputs

| Key | Type | Description |
|-----|------|-------------|
| `filter_pump` | relay | Main circulation/filtration pump |
| `solar_heater_pump` | relay | Solar loop pump |
| `heater` | relay | Electric/gas heater |
| `backup_source` | relay | Fallback heat source |
| `spa_jets` | relay | Spa jet pump |
| `spa_output` | relay | Spa circulation |
| `backwash_valve` | relay | Backwash selector valve |
| `pool_temp` | sensor | Pool water temperature |
| `spa_temp` | sensor | Spa water temperature |
| `buffer_tank_temp` | sensor | Buffer tank temperature |
| `flow_switch` | sensor/DI | Circulation flow proof |
| `ph_sensor` | sensor (AI) | pH value |
| `orp_sensor` | sensor (AI) | ORP / chlorine (mV) |
| `salt_cell_output` | analog (AO) | Salt cell control 0–100% |
| `filter_speed` | analog (AO) | Filter pump speed 0–100% (inverter mode) |

### Settings — Filtration & Variable Speed Pump

| Key | Default | Description |
|-----|---------|-------------|
| `filt_schedule_1` / `filt_schedule_1_dur` | `07:00` / 180 | Morning filtration window (HH:MM, minutes) |
| `filt_schedule_2` / `filt_schedule_2_dur` | `19:00` / 180 | Evening filtration window |
| `filter_profile` | `basic` | `basic` (ON/OFF relay) or `inverter` (variable speed AO) |
| `filter_speed_filt_pct` | 60 | Pump speed during normal filtration (%) |
| `filter_speed_heat_pct` | 80 | Pump speed during heating (%) |
| `filter_speed_af_pct` | 30 | Pump speed during anti-freeze run (%) |

### Settings — Spa Scheduling

| Key | Default | Description |
|-----|---------|-------------|
| `spa_schedule_enable` | 0 | Enable scheduled spa boost |
| `spa_schedule_time` | `18:00` | Daily boost start time (HH:MM) |
| `spa_schedule_days` | `daily` | `daily`, `weekdays`, or `weekends` |
| `spa_preheat_h` | 1 | Hours before schedule to start pre-heating filter |
| `spa_boost_hours` | 2 | Boost duration (hours) |

### Improvements

- [x] **Dosing pump control** — automatic pH+/pH- and chlorine dosing based on measured pH/ORP
- [x] **Variable speed filter pump** — inverter AO output with mode-based speed (filtration / heating / anti-freeze / spa)
- [x] **Spa scheduling** — daily/weekday/weekend scheduled boost with pre-heat
- [ ] **Turbidity sensor** — water clarity for scheduling backwash
- [ ] **Solar yield tracking** — energy output from solar heating
- [ ] **Water level sensor** — automatic water top-up
- [ ] **Flow-based backwash trigger** — backwash when pressure drop exceeds threshold

---

## 7. Irrigation

**ID:** `irrigation` | **Icon:** 🌱 | **Category:** water | **Color:** #22d97a

### Description
3-zone sequential irrigation with automatic lockouts (rain, frost, wind, soil moisture), ET-based skip, and cycle & soak mode.

### Inputs / Outputs

| Key | Type | Description |
|-----|------|-------------|
| `master_valve` | relay | Main water supply valve |
| `zone_1` / `zone_2` / `zone_3` | relay | Zone solenoid valves |
| `rain_sensor` | sensor/DI | Rain sensor |
| `soil_moisture` | sensor (AI) | Global soil moisture % (skips entire run if wet; ignored when per-zone sensors are mapped) |
| `soil_moisture_1` / `_2` / `_3` | sensor (AI) | Per-zone soil moisture % (optional; falls back to global sensor if not mapped) |
| `temp_outdoor` | sensor | Outdoor temperature |
| `wind_sensor` | sensor (AI) | Wind speed km/h |
| `lux_sensor` | sensor (AI) | Solar radiation (for ET calculation) |
| `flow_sensor` | sensor (AI) | Flow rate L/min |

### Settings

| Key | Default | Description |
|-----|---------|-------------|
| `schedule_1/2/3` | `06:00 / "" / ""` | Start times |
| `zone_N_name` | Garden/Lawn/Pots | Zone names |
| `zone_N_min` | 10/15/5 | Zone run duration (minutes) |
| `rain_delay_h` | 24 | Suspension after rain (hours) |
| `soil_skip_above` | 70 | Skip if soil moisture > % |
| `frost_temp` | 3 | Frost lockout below °C |
| `wind_skip_above` | 30 | Skip above km/h |
| `peak_sun_lockout` | 1 | Skip 11:00–16:00 |
| `cycle_soak_enable` | 0 | Cycle & Soak mode |
| `cycle_soak_on_min` | 5 | Run time per cycle (minutes) |
| `cycle_soak_off_min` | 15 | Soak time between cycles (minutes) |
| `cycle_soak_cycles` | 2 | Number of cycles |
| `et_enable` | 0 | ET-based skip |
| `et_skip_below_mm` | 2 | Skip if ET < mm/day |

### Improvements

- [ ] **More zones** — currently max 3, extend to 8–12
- [ ] **Per-zone schedule** — different times/days per zone
- [ ] **Smart ET** — proper Penman-Monteith calculation (current is an estimate)
- [x] **Per-zone soil moisture** — optional per-zone sensors (`soil_moisture_1/2/3`); falls back to global sensor if not mapped
- [ ] **Flow anomaly detection** — detect broken pipe or clogged nozzle
- [ ] **Water budget tracking** — L/month per zone

---

## 8. Water Manager

**ID:** `water_manager` | **Icon:** 💧 | **Category:** water | **Color:** #3ab8ff

### Description
Leak detection and automatic main valve shutoff. Flood sensors, night ghost-flow detection, pressure burst detection, per-sensor location labels, auto re-arm, and water meter with gradual leak tracking.

### Inputs / Outputs

| Key | Type | Description |
|-----|------|-------------|
| `main_valve` | relay | Main water shutoff valve (required) |
| `leak_sensor_1` … `leak_sensor_4` | sensor/DI | Flood / leak sensors |
| `flow_sensor` | sensor (AI) | Flow rate L/min |
| `pressure_sensor` | sensor (AI) | Pressure bar |

### Settings — Basic & Sensor Labels

| Key | Default | Description |
|-----|---------|-------------|
| `alert_cooldown_s` | 300 | Minimum time between alerts (s) |
| `leak_sensor_N_label` | — | Location label shown in alarm notifications (e.g. "Under Boiler") |

### Settings — Ghost Flow & Pressure

| Key | Default | Description |
|-----|---------|-------------|
| `night_flow_enable` | 1 | Ghost flow detection during night hours |
| `flow_leak_threshold` | 2 | Ghost flow threshold L/min |
| `night_start` / `night_end` | 23:00 / 06:00 | Night window |
| `pressure_drop_thresh` | 0.5 | Burst alarm threshold bar/min |

### Settings — Auto Re-arm

| Key | Default | Description |
|-----|---------|-------------|
| `auto_rearm_enable` | 0 | Automatically reopen valve after N minutes |
| `auto_rearm_min` | 60 | Minutes after shutoff before auto re-arm |

### Settings — Water Meter & Gradual Leak

| Key | Default | Description |
|-----|---------|-------------|
| `meter_enable` | 0 | Accumulate flow into total + daily m³ counters |
| `meter_offset_m3` | 0 | Starting value for meter reset |
| `gradual_enable` | 0 | Alert when daily usage exceeds 7-day average |
| `gradual_alert_pct` | 50 | Alert threshold: % above rolling average |

### Improvements

- [x] **Sensor location in notification** — `leak_sensor_N_label` shown in alarm message
- [x] **Auto re-arm** — automatic valve reopen after configurable timeout
- [x] **Water meter integration** — total + daily m³ with day-rollover history
- [x] **Gradual leak detection** — daily usage vs 7-day rolling average
- [ ] **Per-zone monitoring** — separate monitoring per circuit

---

## 9. Hydronic Manager

**ID:** `hydronic_manager` | **Icon:** 🌡️ | **Category:** hydraulic | **Color:** #ff6b35

### Description
Hydronic heating and cooling management: boiler / heat pump, mixing valve with PI control, up to 6 zones, weather compensation, solar integration, dew point protection.

### Inputs / Outputs

| Key | Type | Description |
|-----|------|-------------|
| `heat_source_1` | relay | Primary heat source (boiler/HP) |
| `heat_source_2` | relay | Fallback heat source |
| `flow_switch` | sensor/DI | Circulation flow detector |
| `hp_1_fault` / `hp_2_fault` | sensor/DI | Heat pump fault signal |
| `hp_defrost` | sensor/DI | Defrost active signal |
| `mixing_valve` | analog (AO) | Mixing valve 0–100% |
| `temp_supply` | sensor | Supply temperature after mixing valve |
| `temp_buffer` | sensor | Buffer tank temperature (single sensor fallback) |
| `temp_buffer_top` | sensor (opt) | Buffer top layer — hottest, used for overheat/thermal dump |
| `temp_buffer_mid` | sensor (opt) | Buffer middle layer |
| `temp_buffer_bottom` | sensor (opt) | Buffer bottom layer — coldest, used for source demand |
| `zone_1_thermostat` … `zone_6_thermostat` | sensor/DI | Zone heating request |
| `zone_1_pump` … `zone_6_pump` | relay | Zone pump |
| `main_pump` | relay | Central circulation pump |
| `resistance` | relay | Electric resistance backup |
| `temp_outdoor` | sensor | Outdoor temperature (weather compensation) |
| `temp_collector` | sensor | Solar collector temperature |
| `solar_pump` | relay | Solar loop pump |
| `humidity_room` | sensor | Room humidity (cooling dew point + heating anti-condensation) |
| `humidity_supply` | sensor | Supply air humidity (dew point protection) |
| `temp_room` | sensor (opt) | Room temperature for anti-condensation dew point (falls back to 20°C) |

### Settings — Basic

| Key | Default | Description |
|-----|---------|-------------|
| `topology` | `auto` | `auto` / `direct` / `mixing` |
| `mode` | `heating` | `heating` / `cooling` |
| `buffer_demand_min` | 45 | Source ON below °C (buffer bottom) |
| `buffer_overheat` | 70 | Thermal dump above °C (buffer top) |
| `supply_setpoint` | 38 | Manual supply setpoint (no weather comp) |
| `valve_manual_pct` | 50 | Valve % when no supply sensor |
| `mode_switch_purge_min` | 5 | Purge duration on mode switch |

### Settings — Heat Sources & Cascade

| Key | Default | Description |
|-----|---------|-------------|
| `heat_source_1_type` | `boiler` | `boiler` / `heatpump` |
| `heat_source_2_type` | `none` | `none` / `boiler` / `heatpump` |
| `cascade_enable` | 0 | Enable cascade control (source 2 on delay) |
| `cascade_delay_min` | 15 | Minutes source 1 runs under demand before source 2 activates |

### Settings — Mixing Valve / PI

| Key | Default | Description |
|-----|---------|-------------|
| `pi_kp` / `pi_ki` | 2.0 / 0.1 | PI gains for mixing valve |

### Settings — Weather Compensation

| Key | Default | Description |
|-----|---------|-------------|
| `weather_comp_enable` | 1 | Enable weather compensation |
| `wc_outdoor_min` | -5 | Outdoor min °C (2-point linear) |
| `wc_outdoor_max` | 15 | Outdoor max °C (2-point linear) |
| `wc_supply_max` | 45 | Supply at cold outdoor (heating) |
| `wc_supply_min` | 28 | Supply at mild outdoor (heating) |
| `wc_supply_max_cool` | 20 | Supply max (cooling) |
| `wc_supply_min_cool` | 16 | Supply min (cooling) |
| `wc_point_N_outdoor` | — | Custom curve point N outdoor °C (N = 1–4) |
| `wc_point_N_supply` | — | Custom curve point N supply °C (N = 1–4) — overrides 2-point linear when ≥2 points set |

### Settings — Cooling / Dew Point

| Key | Default | Description |
|-----|---------|-------------|
| `dewpoint_buffer` | 2 | Safety margin above dew point °C |
| `humidity_alert` | 70 | Pause cooling above RH% |
| `condensation_timeout_s` | 30 | Seconds before condensation shutdown |

### Settings — Anti-Condensation (Heating)

| Key | Default | Description |
|-----|---------|-------------|
| `anti_cond_enable` | 0 | Enable anti-condensation mode |
| `anti_cond_rh_threshold` | 60 | Raise supply SP when room RH exceeds this % |

### Settings — Backup Heat

| Key | Default | Description |
|-----|---------|-------------|
| `resistance_enable` | 0 | Enable electric resistance backup |
| `resistance_below` | 40 | Resistance ON below °C buffer |

### Improvements

- [ ] **COP monitoring** — track heat pump efficiency (based on kWh input vs thermal output)
- [ ] **Defrost compensation** — automatically raise supply setpoint during defrost cycle
- [x] **Buffer stratification** — use multiple sensors at different heights in the buffer tank
- [x] **Cascade control** — source 2 activates after source 1 runs under demand for configurable delay
- [x] **Heating curve editor** — piecewise-linear curve with up to 4 configurable outdoor/supply breakpoints
- [x] **Anti-condensation mode** — auto-raise supply setpoint when room humidity exceeds dew point risk threshold

---

## 10. Energy Monitor

**ID:** `energy` | **Icon:** ⚡ | **Category:** hydraulic | **Color:** #f59e0b

### Description
Power consumption monitoring. Accumulates kWh (daily / monthly / total), tracks cost, peak power, CO₂ footprint, solar export revenue, and sends alerts. Supports time-of-use tariffs, 3-phase monitoring, monthly budget alerts, and daily history for week-over-week comparison.

### Inputs / Outputs

| Key | Type | Description |
|-----|------|-------------|
| `power_w` | sensor (AI) | Import power in Watts (required) |
| `export_w` | sensor (opt) | Grid export / solar injection in Watts |
| `power_l1` | sensor (opt) | Phase L1 power (W) — 3-phase monitoring |
| `power_l2` | sensor (opt) | Phase L2 power (W) |
| `power_l3` | sensor (opt) | Phase L3 power (W) |
| `relay` | relay | Controlled relay output (optional) |

### Settings — Basic

| Key | Default | Description |
|-----|---------|-------------|
| `tariff` | 0.20 | Flat electricity tariff €/kWh |
| `reset_hour` | 0 | Daily reset hour (0–23) |

### Settings — Time-of-Use Tariff

| Key | Default | Description |
|-----|---------|-------------|
| `tariff_mode` | `flat` | `flat` or `tou` (time-of-use) |
| `tariff_peak` | 0.28 | Peak period rate €/kWh |
| `tariff_offpeak` | 0.12 | Off-peak rate €/kWh |
| `peak_start_h` | 7 | Peak period start hour |
| `peak_end_h` | 22 | Peak period end hour |

### Settings — Export / Solar

| Key | Default | Description |
|-----|---------|-------------|
| `export_tariff` | 0.08 | Feed-in / export rate €/kWh |

### Settings — Budget & CO₂

| Key | Default | Description |
|-----|---------|-------------|
| `budget_month_eur` | 0 | Monthly cost budget in € (0 = disabled) |
| `co2_factor_g_kwh` | 300 | Grid CO₂ emission factor g/kWh |

### Settings — Alerts

| Key | Default | Description |
|-----|---------|-------------|
| `alert_above_w` | 0 | Alert above X Watts (0 = disabled) |
| `alert_cooldown_s` | 900 | Minimum time between power alerts (s) |

### Persisted State

`_kwh_today`, `_kwh_month`, `_kwh_total`, `_kwh_export_today`, `_kwh_export_month`, `_kwh_export_total`, `_peak_w_today`, `_peak_w_month`, `_history_json`

### Improvements

- [x] **Multi-tariff** — time-of-use peak / off-peak rates with configurable hours
- [x] **Export monitoring** — track grid injection kWh and revenue (solar PV)
- [x] **Phase monitoring** — L1/L2/L3 optional sensors broadcast per-phase readings
- [x] **Budget alerts** — notify when monthly cost exceeds configured budget
- [x] **Carbon footprint** — daily/monthly kg CO₂ based on configurable emission factor
- [x] **Comparison view** — last 7 days history stored for week-over-week comparison (`daily_history`)

---

## 11. Load Shifter

**ID:** `load_shifter` | **Icon:** ⚡ | **Category:** hydraulic | **Color:** #f59e0b

### Description
Prevents fuse overload by shedding non-critical loads in priority order when power exceeds a threshold. Supports per-load protection schedules, soft shedding (grace period before cut), optional grid signal integration, and smart staged restoration.

### Inputs / Outputs

| Key | Type | Description |
|-----|------|-------------|
| `power_w` | sensor (AI) | Power reading in Watts (required) |
| `load_1` | relay | Load 1 — highest priority (last to shed) |
| `load_2` | relay | Load 2 |
| `load_3` | relay | Load 3 |
| `load_4` | relay | Load 4 — lowest priority (first to shed) |
| `grid_signal` | sensor (opt) | Dynamic grid signal (price, frequency) — triggers shedding when above threshold |

### Settings — Basic

| Key | Default | Description |
|-----|---------|-------------|
| `power_threshold` | 8000 | Shed above X Watts |
| `restore_below` | 6000 | Restore below X Watts (hysteresis) |
| `min_shed_time_s` | 60 | Global minimum shed duration (s) |

### Settings — Per Load (N = 1–4)

| Key | Default | Description |
|-----|---------|-------------|
| `min_shed_time_s_N` | -1 | Per-load min shed time (-1 = use global) |
| `load_N_protect_start_h` | -1 | Schedule protection start hour (-1 = disabled) |
| `load_N_protect_end_h` | -1 | Schedule protection end hour |
| `load_N_soft` | 0 | Soft shed flag (1 = grace period before cut) |
| `restore_delay_s_N` | 0 | Per-load restore delay in seconds (smart restoration) |

### Settings — Soft Shedding

| Key | Default | Description |
|-----|---------|-------------|
| `soft_shed_delay_s` | 10 | Grace period (s) before a soft load is actually cut |

### Settings — Grid Signal

| Key | Default | Description |
|-----|---------|-------------|
| `grid_signal_enable` | 0 | Enable grid signal override |
| `grid_signal_shed_above` | 0 | Shed when `grid_signal` exceeds this value |

### Improvements

- [x] **Per-load minimum shed time** — `min_shed_time_s_N` per load, falls back to global
- [x] **Scheduled load protection** — `load_N_protect_start/end_h` prevents shedding during configured hours
- [x] **Soft shedding** — grace period with notification before hard cut; configurable per load
- [x] **Grid signal integration** — optional `grid_signal` input triggers shedding on dynamic price/frequency
- [x] **Smart restoration** — per-load `restore_delay_s_N` staggers restores to avoid inrush current

---

## 12. Maintenance Tracker

**ID:** `maintenance` | **Icon:** 🔧 | **Category:** hydraulic | **Color:** #94a3b8

### Description
Tracks operating hours and start counts for pumps, boilers, AC units, and generators. Minor and major service intervals, service log with notes and parts, predictive next-service-date estimate, and "Service Done" reset from the UI.

### Inputs / Outputs

| Key | Type | Description |
|-----|------|-------------|
| `equipment_1` | relay/DI | Equipment 1 (required) |
| `equipment_2` | relay/DI | Equipment 2 |
| `equipment_3` | relay/DI | Equipment 3 |
| `equipment_4` | relay/DI | Equipment 4 |

### Settings — Per Equipment (N = 1–4)

| Key | Default | Description |
|-----|---------|-------------|
| `equipment_name_N` | — | Display name |
| `service_interval_h_N` | 500 | Minor service interval (hours) |
| `service_interval_major_h_N` | 0 | Major service interval (0 = disabled) |
| `_service_done_N` | 0 | Set to 1 to log service and reset counter |
| `_service_notes_N` | — | Free-text service notes (saved to log on reset) |
| `_service_parts_N` | — | Parts replaced (saved to log on reset) |

### Persisted State (per equipment N)

`_hours_N`, `_starts_N`, `_hours_at_service_N`, `_starts_at_service_N`, `_service_log_N` (JSON, last 10 entries), `_daily_h_json_N` (last 7 days for prediction)

### Broadcast (per equipment entry)

`hours`, `starts`, `hours_since_service`, `starts_since_service`, `minor_due`, `major_due`, `minor_due_in_h`, `major_due_in_h`, `avg_daily_h`, `predicted_service_days`, `service_log[]`

### Improvements

- [x] **Manual service log** — date, hours, starts, notes and parts saved on each reset
- [x] **Reset from UI** — `_service_done_N = 1` logs service and resets counter
- [x] **Multiple intervals** — separate minor and major service hour thresholds per equipment
- [x] **Start counter** — rising-edge detection counts equipment starts independently of run hours
- [x] **Predictive next date** — 7-day rolling average daily hours → `predicted_service_days`
- [x] **Parts tracking** — `_service_parts_N` saved into service log on each reset

---

## 13. Presence Simulator

**ID:** `presence_simulator` | **Icon:** 🏠 | **Category:** smart | **Color:** #a855f7

### Description
Simulates occupancy when away from home. Randomizes lights (staggered start, max concurrent limit), TV, radio relay, and awning. Auto-arms via presence sensor (geofence MQTT) or vacation date range.

### Inputs / Outputs

| Key | Type | Description |
|-----|------|-------------|
| `light_1` … `light_4` | relay | Light relays (min 1 required) |
| `tv_relay` | relay | TV relay — ON during evening window |
| `radio_relay` | relay | Radio / speaker relay — ON during morning window |
| `awning_relay` | relay | Awning relay — opens/closes at configured times |
| `presence_sensor` | sensor/DI (opt) | ON = someone home, OFF = nobody home (geofence MQTT trigger) |

### Settings — Basic

| Key | Default | Description |
|-----|---------|-------------|
| `armed` | 0 | Manual arm switch |

### Settings — Light Timing & Pattern

| Key | Default | Description |
|-----|---------|-------------|
| `light_min_on_min` / `light_max_on_min` | 20 / 90 | Light ON duration range (min) |
| `light_min_off_min` / `light_max_off_min` | 10 / 45 | Light OFF duration range (min) |
| `max_lights_on` | 0 | Max concurrent lights ON (0 = no limit) |

### Settings — Evening & TV

| Key | Default | Description |
|-----|---------|-------------|
| `evening_start` / `evening_end` | 18:00 / 23:00 | Evening window |
| `tv_enable` | 0 | Enable TV simulation |

### Settings — Radio

| Key | Default | Description |
|-----|---------|-------------|
| `radio_enable` | 0 | Enable radio relay |
| `radio_start` / `radio_end` | 09:00 / 13:00 | Radio ON window |

### Settings — Awning

| Key | Default | Description |
|-----|---------|-------------|
| `awning_enable` | 0 | Enable awning simulation |
| `awning_open_time` / `awning_close_time` | 08:00 / 20:00 | Open and close times |

### Settings — Smart Arming / Geofencing

| Key | Default | Description |
|-----|---------|-------------|
| `smart_arm_enable` | 0 | Auto-arm when `presence_sensor` = OFF, auto-disarm on return |

### Settings — Vacation Calendar

| Key | Default | Description |
|-----|---------|-------------|
| `vacation_start` | — | YYYY-MM-DD auto-arm start date |
| `vacation_end` | — | YYYY-MM-DD auto-arm end date |

### Improvements

- [x] **Smart arming** — auto-arm/disarm via `presence_sensor` DI (publish from any app to MQTT)
- [ ] **Learning mode** — learn normal behavior from history and replay it *(requires multi-day storage, not feasible yet)*
- [x] **Radio / music** — `radio_relay` optional output with configurable morning ON window
- [x] **Pattern randomization** — per-light staggered start (0–5 min) + `max_lights_on` concurrent limit
- [x] **Geofencing trigger** — same `presence_sensor` DI — geofence app publishes ON/OFF to MQTT
- [x] **Vacation calendar** — `vacation_start` / `vacation_end` YYYY-MM-DD auto-arms for full date range

---

## 14. Industrial Logic (Custom)

**ID:** `custom` | **Icon:** ⚙️ | **Category:** custom | **Color:** #a855f7

### Description
The most powerful module. Nested AND/OR logic groups, interlocks, feedback proof-of-run, anti-short-cycle, time/sun schedules, AO scaling, scene activation, and notifications.

### Inputs / Outputs (Dynamic, max 20)

| Prefix | Type | Description |
|--------|------|-------------|
| `in_ai_1` … `in_ai_N` | sensor (AI) | Analog input (temperature, pressure, etc.) |
| `in_di_1` … `in_di_N` | sensor/DI | Digital input |
| `out_do_1` … `out_do_N` | relay | Digital output (relay) |
| `out_ao_1` … `out_ao_N` | analog (AO) | Analog output 0–100% |

### Condition Types

| Type | Parameters | Description |
|------|-----------|-------------|
| `sensor_value` | io_id, operator, value | Compare sensor to a fixed value |
| `sensor_vs_sensor` | io_a, io_b, operator, offset | Differential between two sensors (ΔT) |
| `io_state` | io_id, equals | DI/relay equals ON/OFF |
| `time` | after, before (HH:MM) | Time window |
| `day` | days[] | Days of the week |
| `sun` | sun_event, offset_min, sun_when | Sunset/sunrise relative trigger |
| `duration` | inner_condition, min_minutes | Condition active for at least X minutes |

### Action Types

| Kind | Parameters | Description |
|------|-----------|-------------|
| `DO` | io_id, command (ON/OFF) | Activate relay |
| `AO` | io_id, min_pct, max_pct | Set analog output |
| `notify` | title, body, level | Send notification |
| `scene` | scene_id | Activate a Scene |

### Safety Features

- **Interlock** — if interlock_io equals active_state, block all actions
- **Feedback proof** — if feedback_io does not confirm expected_state within startup_delay_s → ALARM
- **Latch** — once ALARM, stays ALARM until manual reset
- **Anti-short-cycle** — min_on_s, min_off_s per rule
- **Lock escalation** — 3 consecutive ALARMs → LOCKED (requires reset_lock command)

### New Action Types

| Kind | Parameters | Description |
|------|-----------|-------------|
| `PID` | `pid_sensor_io_id`, `pid_setpoint`, `pid_kp`, `pid_ki`, `pid_kd`, `min_pct`, `max_pct`, `pid_inverse` | Closed-loop PID controller — runs every tick while rule is ON |
| `ramp` (AO with `ramp_time_s`) | `ramp_time_s` on any AO action | Gradually ramp AO from 0→target on ON, target→0 on OFF |

### New Condition Types

| Type | Parameters | Description |
|------|-----------|-------------|
| `counter` | `inner_condition`, `target_count`, `reset_after_s`, `reset_on_meet` | Fires after inner condition has rising-edged N times |
| `instance_status` | `instance_id`, `field`, `operator`, `value` | Compare broadcast state field of another module instance |

### Template Commands

| Command | Parameters | Description |
|---------|-----------|-------------|
| `save_template` | `name` | Save current rules as named template (stored in `_templates_json`) |
| `load_template` | `name` | Return template object |
| `apply_template` | `name` | Write template rules into the `rules` setting |
| `list_templates` | — | List all saved templates |
| `delete_template` | `name` | Delete a saved template |

### Improvements

- [x] **PID action** — `kind:"PID"` with `pid_sensor_io_id`, setpoint, Kp/Ki/Kd, min/max%; runs every tick in stateful mode
- [x] **Ramp action** — add `ramp_time_s` to any AO action; ramps UP on ON transition, DOWN (via timed steps) on OFF
- [x] **Counter condition** — `type:"counter"` with `target_count`, optional `reset_after_s` and `reset_on_meet`
- [x] **Cross-instance conditions** — `type:"instance_status"` reads broadcast state of any other module instance by id and field path
- [x] **Rule templates** — `save_template` / `apply_template` / `list_templates` / `delete_template` commands; stored in `_templates_json`
- [x] **Test mode** — `test_mode` setpoint; shadows `send` with no-op logger; broadcasts `test_log_recent`; `get_test_log` / `clear_test_log` commands
- [ ] **Visual logic builder** — drag-and-drop UI *(deferred — requires significant frontend work)*

---

## General Improvements (cross-module)

- [ ] **Module duplication** — copy an instance with all its settings
- [ ] **Import/Export settings** — JSON export/import of module configuration
- [ ] **Module health dashboard** — central page showing status of all running modules
- [ ] **Shared variables** — global variables readable and writable by all modules
- [ ] **Module dependencies** — define execution order between modules
- [x] **Test mode** — run logic without actual output commands (dry run) *(implemented in Module 14 Custom)*

---

---

## 15. Grid Tie / Next-to-Line

> **Status: planned**

**ID:** `grid_tie` | **Icon:** ⚡ | **Category:** energy | **Color:** #f5c842

### Description

Monitors the main grid supply and manages automatic transfer switching (ATS) between the grid and a backup source (generator, UPS, second line). Detects undervoltage, overvoltage, and power loss. Handles transfer delays, re-transfer delays, and interlock logic to prevent both sources from being connected simultaneously.

### Inputs / Outputs

| Key | Type | Description |
|-----|------|-------------|
| `grid_present` | DI | Digital input — grid presence signal (ON = grid OK) |
| `grid_voltage` | AI | Analog input — grid voltage (V), optional |
| `grid_frequency` | AI | Analog input — grid frequency (Hz), optional |
| `backup_present` | DI | Digital input — backup source ready signal |
| `transfer_relay` | DO | Output relay — switches load to backup (ON = backup active) |
| `grid_contactor` | DO | Output relay — grid contactor (ON = grid connected) |
| `backup_contactor` | DO | Output relay — backup contactor (ON = backup connected) |
| `alarm_relay` | DO | Optional alarm/siren output on grid failure |
| `generator_start` | DO | Optional start signal to auto-start generator |

### Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `transfer_delay_s` | number | 5 | Seconds to wait after grid loss before switching to backup |
| `retransfer_delay_s` | number | 30 | Seconds to wait after grid returns before switching back |
| `undervoltage_threshold` | number | 195 | Grid voltage below this → treat as grid lost (V) |
| `overvoltage_threshold` | number | 255 | Grid voltage above this → treat as grid fault (V) |
| `frequency_min` | number | 48 | Minimum acceptable frequency (Hz) |
| `frequency_max` | number | 52 | Maximum acceptable frequency (Hz) |
| `auto_retransfer` | select | yes | Automatically return to grid when it recovers |
| `generator_warmup_s` | number | 10 | Seconds to allow generator to stabilize before transferring load |

### Improvements

- [ ] **Voltage/frequency monitoring** — full waveform quality tracking
- [ ] **Transfer counter** — log number of grid failures and transfers
- [ ] **Notification on transfer** — push alert when switching to backup
- [ ] **Test transfer** — scheduled weekly test transfer to verify backup works
- [ ] **Three-phase support** — monitor L1/L2/L3 independently

---

## 16. Alarm System

> **Status: planned**

**ID:** `alarm` | **Icon:** 🚨 | **Category:** security | **Color:** #ff4545

### Description

Full burglar alarm module supporting multiple zones (PIR, magnetic contacts, glass break, etc.), configurable arm/disarm via keyswitch or digital input, entry/exit delays, siren control, and tamper detection. Supports stay-arm mode (perimeter only) and full-arm mode (all zones). Persistent alarm state survives restarts.

### Inputs / Outputs

| Key | Type | Description |
|-----|------|-------------|
| `zone_1` … `zone_8` | DI | Zone inputs — PIR, magnetic contact, glass break, etc. |
| `tamper_1` … `tamper_4` | DI | Tamper inputs — enclosure open detection |
| `keyswitch` | DI | Arm/disarm toggle input (e.g. key switch, RFID relay) |
| `arm_away` | DI | Digital input — arm in full mode |
| `arm_stay` | DI | Digital input — arm in perimeter (stay) mode |
| `disarm` | DI | Digital input — disarm signal |
| `siren_internal` | DO | Internal siren / buzzer relay |
| `siren_external` | DO | External weatherproof siren relay |
| `strobe` | DO | Strobe light relay |
| `alarm_output` | DO | General alarm output (e.g. to building BMS) |
| `ready_led` | DO | LED indicator — system ready to arm |
| `armed_led` | DO | LED indicator — system armed |

### Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `entry_delay_s` | number | 30 | Seconds before alarm triggers after entry zone violated |
| `exit_delay_s` | number | 45 | Seconds to exit before arming completes |
| `siren_duration_s` | number | 180 | Seconds the siren runs on alarm |
| `zone_1_type` … `zone_8_type` | select | instant | Zone type: `instant`, `entry_exit`, `perimeter`, `24h`, `silent` |
| `zone_1_bypass` … `zone_8_bypass` | select | no | Bypass (exclude) this zone from arming |
| `tamper_alarm` | select | yes | Trigger alarm on tamper input |
| `auto_rearm` | select | no | Re-arm automatically after alarm clears |
| `arm_mode` | select | away | Default arm mode: `away` (all zones) or `stay` (perimeter only) |

### Improvements

- [ ] **Zone names** — configurable label per zone for notifications and log
- [ ] **PIN disarm** — numeric PIN entry via keypad MQTT entity
- [ ] **Multiple users** — per-user PIN codes with access log
- [ ] **Photo verification** — link zone to IP camera snapshot on trigger
- [ ] **Alarm history** — dedicated alarm event log with zone detail
- [ ] **Arm/disarm schedule** — automatic arming at set times

---

## 17. HVAC Unit (KKM)

> **Status: planned**

**ID:** `hvac_unit` | **Icon:** ❄️ | **Category:** climate | **Color:** #00c8ff

### Description

Central HVAC / fan-coil unit controller. Manages a multi-speed fan (low/medium/high), heating and cooling coil valves, and optional electric heat strip. Supports room temperature setpoint with hysteresis, occupancy-based setback, and schedule-based operation. Designed for typical KKM (fan-coil) installations found in commercial and multi-room residential buildings.

### Inputs / Outputs

| Key | Type | Description |
|-----|------|-------------|
| `temp_room` | AI | Room temperature sensor (°C) |
| `temp_supply` | AI | Optional supply air temperature sensor |
| `occupancy` | DI | Optional occupancy sensor (PIR / BMS signal) |
| `fan_low` | DO | Fan speed relay — low |
| `fan_medium` | DO | Fan speed relay — medium |
| `fan_high` | DO | Fan speed relay — high |
| `fan_speed_ao` | AO | Optional analog output for EC fan motor (0–10V / 0–100%) |
| `valve_cooling` | DO | 2-way / 3-way cooling coil valve relay |
| `valve_heating` | DO | 2-way / 3-way heating coil valve relay |
| `heat_strip` | DO | Optional electric heat strip relay |
| `alarm_filter` | DI | Filter dirty alarm input |

### Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `mode` | select | cooling | Operating mode: `cooling`, `heating`, `fan_only`, `auto`, `off` |
| `setpoint` | number | 24 | Target room temperature (°C) |
| `hysteresis` | number | 0.5 | Dead band around setpoint (°C) |
| `fan_mode` | select | auto | Fan mode: `auto` (follows demand) or `continuous` |
| `fan_default_speed` | select | low | Default fan speed in auto mode: `low`, `medium`, `high` |
| `setback_temp_cool` | number | 28 | Setback setpoint when unoccupied in cooling mode |
| `setback_temp_heat` | number | 18 | Setback setpoint when unoccupied in heating mode |
| `min_run_time_s` | number | 120 | Minimum run time before switching off valve |
| `min_off_time_s` | number | 120 | Minimum off time before valve can reopen |
| `valve_open_delay_s` | number | 30 | Wait for valve to open before starting fan |
| `schedule_enable` | select | no | Enable schedule-based setpoint switching |

### Improvements

- [ ] **Auto mode** — switch between heating/cooling based on outdoor temp
- [ ] **Multi-speed auto selection** — choose fan speed based on demand delta
- [ ] **EC fan analog control** — smooth 0–10V ramp instead of stepped relays
- [ ] **Filter maintenance alert** — notify when filter alarm is active for >N minutes
- [ ] **Humidity control** — optionally link to dehumidifier output

---

## 18. Pressure System

> **Status: planned**

**ID:** `pressure_system` | **Icon:** 💧 | **Category:** hydraulic | **Color:** #1d8cff

### Description

Pressure booster system controller supporting 1 to 4 pumps in lead/lag configuration, with or without inverter (VFD) on the lead pump. Maintains system pressure within a configurable band using a pressure transducer (analog) or pressure switch (digital). Implements automatic pump rotation for equal wear, dry-run protection, and fault handling per pump.

### Inputs / Outputs

| Key | Type | Description |
|-----|------|-------------|
| `pressure` | AI | System pressure transducer (bar or PSI) |
| `pressure_sw` | DI | Optional digital pressure switch (low pressure = ON) |
| `flow_sw` | DI | Optional flow switch — no-flow detection for dry-run protection |
| `level_ok` | DI | Tank/reservoir level OK signal (DI) — low = dry-run lockout |
| `pump_1_run` | DO | Pump 1 run relay |
| `pump_2_run` | DO | Pump 2 run relay (optional) |
| `pump_3_run` | DO | Pump 3 run relay (optional) |
| `pump_4_run` | DO | Pump 4 run relay (optional) |
| `pump_1_fault` | DI | Pump 1 fault feedback (from motor protection relay) |
| `pump_2_fault` | DI | Pump 2 fault feedback |
| `pump_3_fault` | DI | Pump 3 fault feedback |
| `pump_4_fault` | DI | Pump 4 fault feedback |
| `inverter_speed` | AO | Inverter frequency/speed setpoint (0–100% → 0–50Hz) |
| `inverter_fault` | DI | Inverter fault feedback |
| `alarm_relay` | DO | General fault alarm output |

### Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `num_pumps` | number | 1 | Number of installed pumps (1–4) |
| `has_inverter` | select | no | Lead pump has inverter (VFD) speed control |
| `pressure_setpoint` | number | 4.0 | Target system pressure (bar) |
| `pressure_hysteresis` | number | 0.3 | Pressure band around setpoint (bar) |
| `lag_start_pressure` | number | 3.5 | Pressure below which lag pump 2 starts |
| `lag2_start_pressure` | number | 3.0 | Pressure below which lag pump 3 starts |
| `lag3_start_pressure` | number | 2.5 | Pressure below which lag pump 4 starts |
| `rotation_hours` | number | 24 | Lead pump rotation interval (hours) |
| `min_run_time_s` | number | 30 | Minimum run time before a pump can stop |
| `min_off_time_s` | number | 30 | Minimum off time before a pump can restart |
| `dry_run_delay_s` | number | 5 | Seconds with low level/no-flow before dry-run lockout |
| `dry_run_lockout_min` | number | 10 | Lockout duration after dry-run event (minutes) |
| `inverter_min_hz` | number | 25 | Minimum inverter frequency (Hz) |
| `inverter_max_hz` | number | 50 | Maximum inverter frequency (Hz) |
| `pid_kp` | number | 2.0 | Inverter PID proportional gain |
| `pid_ki` | number | 0.5 | Inverter PID integral gain |

### Improvements

- [ ] **PID inverter speed control** — closed-loop pressure regulation via VFD
- [ ] **Runtime hours per pump** — track wear and schedule maintenance
- [ ] **Fault auto-reset** — configurable retries before permanent lockout
- [ ] **Cascade efficiency** — prefer fewer pumps at higher speed vs more at low speed
- [ ] **Night mode** — reduced setpoint during low-demand hours

---

## 19. Generator Manager

> **Status: planned**

**ID:** `generator` | **Icon:** 🔋 | **Category:** energy | **Color:** #ff6820

### Description

Automatic generator management — start/stop on grid failure, cooldown run before shutdown, load transfer interlock, battery charger control, and run-hour tracking for maintenance scheduling. Works in conjunction with the Grid Tie module for full ATS logic.

### Inputs / Outputs

| Key | Type | Description |
|-----|------|-------------|
| `grid_ok` | DI | Grid present signal (from Grid Tie module or external ATS) |
| `gen_running` | DI | Generator running feedback (oil pressure, alternator signal) |
| `gen_fault` | DI | Generator fault input |
| `battery_voltage` | AI | Battery/starter voltage (V) |
| `gen_voltage` | AI | Generator output voltage (V) |
| `gen_frequency` | AI | Generator output frequency (Hz) |
| `start_relay` | DO | Starter relay (momentary pulse to crank) |
| `stop_relay` | DO | Stop/fuel cut relay |
| `choke_relay` | DO | Optional choke relay for cold start |
| `load_transfer` | DO | Load transfer signal to ATS |
| `battery_charger` | DO | Battery charger relay (on when generator running) |
| `alarm_relay` | DO | Fault alarm output |

### Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `start_delay_s` | number | 10 | Delay after grid loss before auto-start |
| `start_attempts` | number | 3 | Number of crank attempts before lockout |
| `crank_duration_s` | number | 5 | Duration of each crank pulse (seconds) |
| `crank_pause_s` | number | 10 | Pause between crank attempts |
| `warmup_s` | number | 15 | Run time before transferring load to generator |
| `cooldown_s` | number | 120 | Run time after grid returns before stopping generator |
| `transfer_delay_s` | number | 5 | Delay after generator stable before transferring load |
| `retransfer_delay_s` | number | 30 | Delay after grid returns before transferring back |
| `low_battery_threshold` | number | 11.5 | Battery voltage below this → low battery alarm (V) |

### Improvements

- [ ] **Run-hour log** — total engine hours for maintenance scheduling
- [ ] **Fuel level input** — analog or digital fuel sensor integration
- [ ] **Weekly exercise run** — scheduled test start for a configured duration
- [ ] **Multi-attempt crank logic** — glow plug pre-heat for diesel engines
- [ ] **Notification on start/stop/fault** — push alert for all generator events

---

## 20. EV Charger Manager

> **Status: planned**

**ID:** `ev_charger` | **Icon:** 🔌 | **Category:** energy | **Color:** #22d97a

### Description

Smart EV charging scheduler — enables, limits, or stops charging based on solar surplus, grid tariff schedule, or a configurable power budget. Supports EVSE pilot signal control (PWM duty cycle → current limit) or simple relay enable/disable for dumb chargers. Integrates with the Energy Monitor module to stay within the building's maximum demand limit.

### Inputs / Outputs

| Key | Type | Description |
|-----|------|-------------|
| `charger_enable` | DO | Relay to enable/disable the EVSE (or smart socket) |
| `pilot_ao` | AO | Analog output for PWM pilot current limit (6–32A → 0–100%) |
| `charger_active` | DI | Feedback — EV is plugged in and charging |
| `solar_surplus` | AI | Available solar surplus power (W) — from Energy Monitor |
| `grid_power` | AI | Current grid import/export (W) |
| `grid_tariff` | DI | Optional digital input — off-peak tariff active signal |
| `house_power` | AI | Total house consumption (W) |

### Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `mode` | select | solar | Charge mode: `solar` (surplus only), `schedule` (off-peak), `immediate`, `budget` |
| `min_solar_surplus_w` | number | 1400 | Minimum solar surplus before starting charge (W) |
| `min_current_a` | number | 6 | Minimum charging current (A) — EVSE minimum is typically 6A |
| `max_current_a` | number | 16 | Maximum charging current (A) |
| `schedule_start` | text | 23:00 | Off-peak charge start time (HH:MM) |
| `schedule_stop` | text | 06:00 | Off-peak charge stop time (HH:MM) |
| `max_house_power_w` | number | 10000 | Max total house power — reduce EV current to stay below this |
| `stop_on_export_threshold_w` | number | 0 | Stop charging if grid export drops below this (W) |
| `solar_smoothing_s` | number | 60 | Averaging window for solar surplus to avoid rapid cycling (s) |

### Improvements

- [ ] **OCPP support** — communicate with OCPP-compliant chargers
- [ ] **State of charge input** — stop at target SoC if battery SoC is available via MQTT
- [ ] **Cost tracking** — log kWh and cost per session
- [ ] **Multiple chargers** — priority queue for 2+ EVSEs
- [ ] **V2G / V2H mode** — discharge EV battery to house during peak demand

---

## 21. Hot Water Recirculation

> **Status: planned**

**ID:** `hw_recirc` | **Icon:** ♻️ | **Category:** hydraulic | **Color:** #ff8c42

### Description
Hot water recirculation pump controller. Keeps hot water ready at taps without wasting water while waiting for it to heat up. Supports timer-based, temperature-based, and demand-triggered (button/motion) activation.

### Inputs / Outputs

| Key | Type | Description |
|-----|------|-------------|
| `recirc_pump` | relay | Recirculation pump |
| `temp_return` | sensor | Return line temperature (cold = hot water has cooled, pump needed) |
| `demand_trigger` | sensor/DI | Push button or motion sensor at tap |

### Settings (planned)

| Key | Default | Description |
|-----|---------|-------------|
| `mode` | `schedule` | `schedule`, `temperature`, `demand`, or `combined` |
| `schedule_on` / `schedule_off` | 06:00 / 22:00 | Active hours |
| `return_temp_on` | 40 | Start pump when return line drops below °C |
| `return_temp_off` | 55 | Stop pump when return line reaches °C |
| `demand_run_min` | 3 | Minutes to run after demand trigger |
| `min_off_min` | 10 | Minimum off time between demand runs |

### Improvements

- [ ] **Energy tracking** — pump run hours and estimated energy cost
- [ ] **Legionella interlock** — pause recirculation during solar/boiler legionella cycle
