// public/help.js  v4
// Reads /api/modules/definitions and renders full documentation.
// Planned modules (15-21) are embedded as static data since they have no implementation yet.
(function () {
  'use strict';

  const state = { defs: [], filtered: [], selected: null };
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // ── Static data for planned modules (not yet implemented) ────────────────────
  const PLANNED_MODULES = [
    {
      id: 'grid_tie',
      name: 'Grid Tie / Next-to-Line',
      icon: '⚡',
      category: 'energy',
      color: '#f5c842',
      _planned: true,
      description: 'Monitors the main grid supply and manages automatic transfer switching (ATS) between grid and backup source (generator, UPS, second line). Detects undervoltage, overvoltage, and power loss. Handles transfer delays, re-transfer delays, and interlock logic to prevent both sources from being connected simultaneously.',
      inputs: [
        { key: 'grid_present',     label: 'Grid Present',        type: 'di',     required: true,  description: 'Digital input — grid presence signal (ON = grid OK).' },
        { key: 'grid_voltage',     label: 'Grid Voltage',        type: 'sensor', required: false, description: 'Analog input — grid voltage (V), optional.' },
        { key: 'grid_frequency',   label: 'Grid Frequency',      type: 'sensor', required: false, description: 'Analog input — grid frequency (Hz), optional.' },
        { key: 'backup_present',   label: 'Backup Ready',        type: 'di',     required: false, description: 'Digital input — backup source ready signal.' },
        { key: 'transfer_relay',   label: 'Transfer Relay',      type: 'relay',  required: true,  description: 'Switches load to backup source (ON = backup active).' },
        { key: 'grid_contactor',   label: 'Grid Contactor',      type: 'relay',  required: false, description: 'Grid contactor output (ON = grid connected).' },
        { key: 'backup_contactor', label: 'Backup Contactor',    type: 'relay',  required: false, description: 'Backup contactor output (ON = backup connected).' },
        { key: 'alarm_relay',      label: 'Alarm Output',        type: 'relay',  required: false, description: 'Optional alarm/siren output on grid failure.' },
        { key: 'generator_start',  label: 'Generator Start',     type: 'relay',  required: false, description: 'Optional start signal to auto-start generator.' },
      ],
      groups: [
        { id: 'timing',  label: '⏱ Transfer Timing' },
        { id: 'voltage', label: '⚡ Voltage & Frequency' },
      ],
      setpoints: [
        { group: 'timing',  key: 'transfer_delay_s',       label: 'Transfer delay',        type: 'number', unit: 's',  default: 5,     help: 'Seconds to wait after grid loss before switching to backup.' },
        { group: 'timing',  key: 'retransfer_delay_s',     label: 'Re-transfer delay',     type: 'number', unit: 's',  default: 30,    help: 'Seconds to wait after grid returns before switching back.' },
        { group: 'timing',  key: 'generator_warmup_s',     label: 'Generator warm-up',     type: 'number', unit: 's',  default: 10,    help: 'Seconds to allow generator to stabilize before transferring load.' },
        { group: 'timing',  key: 'auto_retransfer',        label: 'Auto re-transfer',      type: 'select', options: ['yes','no'], default: 'yes', help: 'Automatically return to grid when it recovers.' },
        { group: 'voltage', key: 'undervoltage_threshold', label: 'Undervoltage limit',    type: 'number', unit: 'V',  default: 195,   help: 'Grid voltage below this is treated as grid lost.' },
        { group: 'voltage', key: 'overvoltage_threshold',  label: 'Overvoltage limit',     type: 'number', unit: 'V',  default: 255,   help: 'Grid voltage above this is treated as a grid fault.' },
        { group: 'voltage', key: 'frequency_min',          label: 'Min frequency',         type: 'number', unit: 'Hz', default: 48,    help: 'Minimum acceptable grid frequency.' },
        { group: 'voltage', key: 'frequency_max',          label: 'Max frequency',         type: 'number', unit: 'Hz', default: 52,    help: 'Maximum acceptable grid frequency.' },
      ],
    },
    {
      id: 'alarm',
      name: 'Alarm System',
      icon: '🚨',
      category: 'security',
      color: '#ff4545',
      _planned: true,
      description: 'Full burglar alarm module with multiple zones (PIR, magnetic contacts, glass break), arm/disarm via keyswitch or digital input, entry/exit delays, siren control, and tamper detection. Supports stay-arm (perimeter only) and full-arm modes. Persistent alarm state survives restarts.',
      inputs: [
        { key: 'zone_1',          label: 'Zone 1',              type: 'di',    required: true,  description: 'Zone input — PIR, magnetic contact, glass break, etc.' },
        { key: 'zone_2',          label: 'Zone 2',              type: 'di',    required: false, description: 'Zone input.' },
        { key: 'zone_3',          label: 'Zone 3',              type: 'di',    required: false, description: 'Zone input.' },
        { key: 'zone_4',          label: 'Zone 4',              type: 'di',    required: false, description: 'Zone input.' },
        { key: 'zone_5',          label: 'Zone 5',              type: 'di',    required: false, description: 'Zone input.' },
        { key: 'zone_6',          label: 'Zone 6',              type: 'di',    required: false, description: 'Zone input.' },
        { key: 'zone_7',          label: 'Zone 7',              type: 'di',    required: false, description: 'Zone input.' },
        { key: 'zone_8',          label: 'Zone 8',              type: 'di',    required: false, description: 'Zone input.' },
        { key: 'tamper_1',        label: 'Tamper 1',            type: 'di',    required: false, description: 'Tamper input — enclosure open detection.' },
        { key: 'tamper_2',        label: 'Tamper 2',            type: 'di',    required: false, description: 'Tamper input.' },
        { key: 'tamper_3',        label: 'Tamper 3',            type: 'di',    required: false, description: 'Tamper input.' },
        { key: 'tamper_4',        label: 'Tamper 4',            type: 'di',    required: false, description: 'Tamper input.' },
        { key: 'keyswitch',       label: 'Keyswitch',           type: 'di',    required: false, description: 'Arm/disarm toggle input (key switch, RFID relay).' },
        { key: 'arm_away',        label: 'Arm Away',            type: 'di',    required: false, description: 'Digital input — arm in full mode.' },
        { key: 'arm_stay',        label: 'Arm Stay',            type: 'di',    required: false, description: 'Digital input — arm in perimeter (stay) mode.' },
        { key: 'disarm',          label: 'Disarm',              type: 'di',    required: false, description: 'Digital input — disarm signal.' },
        { key: 'siren_internal',  label: 'Internal Siren',      type: 'relay', required: false, description: 'Internal siren / buzzer relay.' },
        { key: 'siren_external',  label: 'External Siren',      type: 'relay', required: false, description: 'External weatherproof siren relay.' },
        { key: 'strobe',          label: 'Strobe Light',        type: 'relay', required: false, description: 'Strobe light relay.' },
        { key: 'alarm_output',    label: 'Alarm Output',        type: 'relay', required: false, description: 'General alarm output (e.g. to building BMS).' },
        { key: 'ready_led',       label: 'Ready LED',           type: 'relay', required: false, description: 'LED indicator — system ready to arm.' },
        { key: 'armed_led',       label: 'Armed LED',           type: 'relay', required: false, description: 'LED indicator — system armed.' },
      ],
      groups: [
        { id: 'timing', label: '⏱ Delays' },
        { id: 'zones',  label: '🔲 Zone Config' },
      ],
      setpoints: [
        { group: 'timing', key: 'entry_delay_s',     label: 'Entry delay',        type: 'number', unit: 's',  default: 30,  help: 'Seconds before alarm triggers after an entry zone is violated.' },
        { group: 'timing', key: 'exit_delay_s',      label: 'Exit delay',         type: 'number', unit: 's',  default: 45,  help: 'Seconds to exit the premises before arming completes.' },
        { group: 'timing', key: 'siren_duration_s',  label: 'Siren duration',     type: 'number', unit: 's',  default: 180, help: 'Seconds the siren runs on alarm.' },
        { group: 'timing', key: 'auto_rearm',        label: 'Auto re-arm',        type: 'select', options: ['yes','no'], default: 'no', help: 'Re-arm automatically after alarm clears.' },
        { group: 'timing', key: 'arm_mode',          label: 'Default arm mode',   type: 'select', options: ['away','stay'], default: 'away', help: 'away = all zones active, stay = perimeter only.' },
        { group: 'timing', key: 'tamper_alarm',      label: 'Tamper alarm',       type: 'select', options: ['yes','no'], default: 'yes', help: 'Trigger alarm on tamper input.' },
        { group: 'zones',  key: 'zone_1_type',       label: 'Zone 1 type',        type: 'select', options: ['instant','entry_exit','perimeter','24h','silent'], default: 'instant', help: 'Zone response type.' },
        { group: 'zones',  key: 'zone_1_bypass',     label: 'Zone 1 bypass',      type: 'select', options: ['no','yes'], default: 'no', help: 'Exclude this zone from arming.' },
        { group: 'zones',  key: 'zone_2_type',       label: 'Zone 2 type',        type: 'select', options: ['instant','entry_exit','perimeter','24h','silent'], default: 'instant' },
        { group: 'zones',  key: 'zone_2_bypass',     label: 'Zone 2 bypass',      type: 'select', options: ['no','yes'], default: 'no' },
      ],
    },
    {
      id: 'hvac_unit',
      name: 'HVAC Unit (KKM)',
      icon: '❄️',
      category: 'climate',
      color: '#00c8ff',
      _planned: true,
      description: 'Central HVAC / fan-coil unit controller. Manages multi-speed fan (low/medium/high), heating and cooling coil valves, and optional electric heat strip. Supports room temperature setpoint with hysteresis, occupancy-based setback, and schedule-based operation. Designed for typical KKM fan-coil installations.',
      inputs: [
        { key: 'temp_room',    label: 'Room Temperature',    type: 'sensor', required: true,  description: 'Room temperature sensor (°C).' },
        { key: 'temp_supply',  label: 'Supply Air Temp',     type: 'sensor', required: false, description: 'Optional supply air temperature sensor.' },
        { key: 'occupancy',    label: 'Occupancy Sensor',    type: 'di',     required: false, description: 'Optional occupancy sensor (PIR / BMS signal).' },
        { key: 'fan_low',      label: 'Fan — Low Speed',     type: 'relay',  required: false, description: 'Fan speed relay — low.' },
        { key: 'fan_medium',   label: 'Fan — Medium Speed',  type: 'relay',  required: false, description: 'Fan speed relay — medium.' },
        { key: 'fan_high',     label: 'Fan — High Speed',    type: 'relay',  required: false, description: 'Fan speed relay — high.' },
        { key: 'fan_speed_ao', label: 'Fan Speed (AO)',      type: 'analog_out', required: false, description: 'Analog output for EC fan motor (0–10V / 0–100%).' },
        { key: 'valve_cooling',label: 'Cooling Valve',       type: 'relay',  required: false, description: '2-way / 3-way cooling coil valve relay.' },
        { key: 'valve_heating',label: 'Heating Valve',       type: 'relay',  required: false, description: '2-way / 3-way heating coil valve relay.' },
        { key: 'heat_strip',   label: 'Heat Strip',          type: 'relay',  required: false, description: 'Optional electric heat strip relay.' },
        { key: 'alarm_filter', label: 'Filter Dirty Alarm',  type: 'di',     required: false, description: 'Filter dirty alarm input.' },
      ],
      groups: [
        { id: 'main',     label: '🌡️ Control' },
        { id: 'fan',      label: '💨 Fan' },
        { id: 'setback',  label: '🌙 Setback' },
        { id: 'timers',   label: '⏱ Timers' },
      ],
      setpoints: [
        { group: 'main',    key: 'mode',               label: 'Operating mode',       type: 'select', options: ['cooling','heating','fan_only','auto','off'], default: 'cooling', help: 'cooling, heating, fan_only, auto, or off.' },
        { group: 'main',    key: 'setpoint',           label: 'Setpoint',             type: 'number', unit: '°C', default: 24,  help: 'Target room temperature.' },
        { group: 'main',    key: 'hysteresis',         label: 'Hysteresis',           type: 'number', unit: '°C', default: 0.5, help: 'Dead band around setpoint.' },
        { group: 'fan',     key: 'fan_mode',           label: 'Fan mode',             type: 'select', options: ['auto','continuous'], default: 'auto', help: 'auto = follows demand, continuous = always on.' },
        { group: 'fan',     key: 'fan_default_speed',  label: 'Default fan speed',    type: 'select', options: ['low','medium','high'], default: 'low', help: 'Default fan speed in auto mode.' },
        { group: 'setback', key: 'setback_temp_cool',  label: 'Setback (cooling)',    type: 'number', unit: '°C', default: 28,  help: 'Setback setpoint when unoccupied in cooling mode.' },
        { group: 'setback', key: 'setback_temp_heat',  label: 'Setback (heating)',    type: 'number', unit: '°C', default: 18,  help: 'Setback setpoint when unoccupied in heating mode.' },
        { group: 'setback', key: 'schedule_enable',    label: 'Schedule enable',      type: 'select', options: ['no','yes'], default: 'no', help: 'Enable schedule-based setpoint switching.' },
        { group: 'timers',  key: 'min_run_time_s',     label: 'Min run time',         type: 'number', unit: 's', default: 120, help: 'Minimum run time before switching off valve.' },
        { group: 'timers',  key: 'min_off_time_s',     label: 'Min off time',         type: 'number', unit: 's', default: 120, help: 'Minimum off time before valve can reopen.' },
        { group: 'timers',  key: 'valve_open_delay_s', label: 'Valve open delay',     type: 'number', unit: 's', default: 30,  help: 'Wait for valve to open before starting fan.' },
      ],
    },
    {
      id: 'pressure_system',
      name: 'Pressure System',
      icon: '💧',
      category: 'hydraulic',
      color: '#1d8cff',
      _planned: true,
      description: 'Pressure booster system controller supporting 1–4 pumps in lead/lag configuration, with or without inverter (VFD) on the lead pump. Maintains system pressure within a configurable band using a pressure transducer or pressure switch. Implements automatic pump rotation, dry-run protection, and per-pump fault handling.',
      inputs: [
        { key: 'pressure',        label: 'Pressure Sensor',     type: 'sensor', required: true,  description: 'System pressure transducer (bar or PSI).' },
        { key: 'pressure_sw',     label: 'Pressure Switch',     type: 'di',     required: false, description: 'Optional digital pressure switch (low pressure = ON).' },
        { key: 'flow_sw',         label: 'Flow Switch',         type: 'di',     required: false, description: 'No-flow detection for dry-run protection.' },
        { key: 'level_ok',        label: 'Tank Level OK',       type: 'di',     required: false, description: 'Reservoir level OK signal — low level = dry-run lockout.' },
        { key: 'pump_1_run',      label: 'Pump 1',              type: 'relay',  required: true,  description: 'Pump 1 run relay.' },
        { key: 'pump_2_run',      label: 'Pump 2',              type: 'relay',  required: false, description: 'Pump 2 run relay.' },
        { key: 'pump_3_run',      label: 'Pump 3',              type: 'relay',  required: false, description: 'Pump 3 run relay.' },
        { key: 'pump_4_run',      label: 'Pump 4',              type: 'relay',  required: false, description: 'Pump 4 run relay.' },
        { key: 'pump_1_fault',    label: 'Pump 1 Fault',        type: 'di',     required: false, description: 'Pump 1 fault feedback from motor protection relay.' },
        { key: 'pump_2_fault',    label: 'Pump 2 Fault',        type: 'di',     required: false, description: 'Pump 2 fault feedback.' },
        { key: 'pump_3_fault',    label: 'Pump 3 Fault',        type: 'di',     required: false, description: 'Pump 3 fault feedback.' },
        { key: 'pump_4_fault',    label: 'Pump 4 Fault',        type: 'di',     required: false, description: 'Pump 4 fault feedback.' },
        { key: 'inverter_speed',  label: 'Inverter Speed (AO)', type: 'analog_out', required: false, description: 'Inverter frequency/speed setpoint (0–100% → 0–50Hz).' },
        { key: 'inverter_fault',  label: 'Inverter Fault',      type: 'di',     required: false, description: 'Inverter fault feedback.' },
        { key: 'alarm_relay',     label: 'Alarm Output',        type: 'relay',  required: false, description: 'General fault alarm output.' },
      ],
      groups: [
        { id: 'pressure', label: '📊 Pressure' },
        { id: 'pumps',    label: '🔧 Pumps' },
        { id: 'inverter', label: '⚡ Inverter / VFD' },
        { id: 'dryrun',   label: '🛡 Dry-Run Protection' },
      ],
      setpoints: [
        { group: 'pressure',  key: 'num_pumps',              label: 'Number of pumps',       type: 'number',            default: 1,   help: 'Installed pumps (1–4).' },
        { group: 'pressure',  key: 'pressure_setpoint',      label: 'Pressure setpoint',     type: 'number', unit: 'bar', default: 4.0, help: 'Target system pressure.' },
        { group: 'pressure',  key: 'pressure_hysteresis',    label: 'Pressure hysteresis',   type: 'number', unit: 'bar', default: 0.3, help: 'Pressure band around setpoint.' },
        { group: 'pumps',     key: 'lag_start_pressure',     label: 'Pump 2 start below',    type: 'number', unit: 'bar', default: 3.5, help: 'Pressure below which lag pump 2 starts.' },
        { group: 'pumps',     key: 'lag2_start_pressure',    label: 'Pump 3 start below',    type: 'number', unit: 'bar', default: 3.0, help: 'Pressure below which lag pump 3 starts.' },
        { group: 'pumps',     key: 'lag3_start_pressure',    label: 'Pump 4 start below',    type: 'number', unit: 'bar', default: 2.5, help: 'Pressure below which lag pump 4 starts.' },
        { group: 'pumps',     key: 'rotation_hours',         label: 'Pump rotation',         type: 'number', unit: 'h',  default: 24,  help: 'Lead pump rotation interval for equal wear.' },
        { group: 'pumps',     key: 'min_run_time_s',         label: 'Min run time',          type: 'number', unit: 's',  default: 30,  help: 'Minimum run time before a pump can stop.' },
        { group: 'pumps',     key: 'min_off_time_s',         label: 'Min off time',          type: 'number', unit: 's',  default: 30,  help: 'Minimum off time before a pump can restart.' },
        { group: 'inverter',  key: 'has_inverter',           label: 'Has inverter (VFD)',    type: 'select', options: ['no','yes'], default: 'no', help: 'Lead pump has inverter speed control.' },
        { group: 'inverter',  key: 'inverter_min_hz',        label: 'Min frequency',         type: 'number', unit: 'Hz', default: 25,  help: 'Minimum inverter frequency.' },
        { group: 'inverter',  key: 'inverter_max_hz',        label: 'Max frequency',         type: 'number', unit: 'Hz', default: 50,  help: 'Maximum inverter frequency.' },
        { group: 'inverter',  key: 'pid_kp',                 label: 'PID Kp',                type: 'number',            default: 2.0, help: 'Inverter PID proportional gain.' },
        { group: 'inverter',  key: 'pid_ki',                 label: 'PID Ki',                type: 'number',            default: 0.5, help: 'Inverter PID integral gain.' },
        { group: 'dryrun',    key: 'dry_run_delay_s',        label: 'Dry-run delay',         type: 'number', unit: 's',  default: 5,   help: 'Seconds with low level/no-flow before dry-run lockout.' },
        { group: 'dryrun',    key: 'dry_run_lockout_min',    label: 'Dry-run lockout',       type: 'number', unit: 'min',default: 10,  help: 'Lockout duration after a dry-run event.' },
      ],
    },
    {
      id: 'generator',
      name: 'Generator Manager',
      icon: '🔋',
      category: 'energy',
      color: '#ff6820',
      _planned: true,
      description: 'Automatic generator management — start/stop on grid failure, cooldown run before shutdown, load transfer interlock, battery charger control, and run-hour tracking for maintenance scheduling. Works in conjunction with the Grid Tie module for full ATS logic.',
      inputs: [
        { key: 'grid_ok',          label: 'Grid OK',              type: 'di',     required: true,  description: 'Grid present signal (from Grid Tie module or external ATS).' },
        { key: 'gen_running',      label: 'Generator Running',    type: 'di',     required: false, description: 'Generator running feedback (oil pressure / alternator signal).' },
        { key: 'gen_fault',        label: 'Generator Fault',      type: 'di',     required: false, description: 'Generator fault input.' },
        { key: 'battery_voltage',  label: 'Battery Voltage',      type: 'sensor', required: false, description: 'Battery/starter voltage (V).' },
        { key: 'gen_voltage',      label: 'Generator Voltage',    type: 'sensor', required: false, description: 'Generator output voltage (V).' },
        { key: 'gen_frequency',    label: 'Generator Frequency',  type: 'sensor', required: false, description: 'Generator output frequency (Hz).' },
        { key: 'start_relay',      label: 'Starter Relay',        type: 'relay',  required: true,  description: 'Momentary pulse to crank the engine.' },
        { key: 'stop_relay',       label: 'Stop / Fuel Cut',      type: 'relay',  required: false, description: 'Stop/fuel cut relay.' },
        { key: 'choke_relay',      label: 'Choke Relay',          type: 'relay',  required: false, description: 'Optional choke relay for cold start.' },
        { key: 'load_transfer',    label: 'Load Transfer',        type: 'relay',  required: false, description: 'Load transfer signal to ATS.' },
        { key: 'battery_charger',  label: 'Battery Charger',      type: 'relay',  required: false, description: 'Battery charger relay (ON when generator running).' },
        { key: 'alarm_relay',      label: 'Fault Alarm',          type: 'relay',  required: false, description: 'Fault alarm output.' },
      ],
      groups: [
        { id: 'start',    label: '🚀 Auto Start' },
        { id: 'transfer', label: '🔀 Load Transfer' },
        { id: 'battery',  label: '🔋 Battery' },
      ],
      setpoints: [
        { group: 'start',    key: 'start_delay_s',          label: 'Start delay',           type: 'number', unit: 's',  default: 10,   help: 'Delay after grid loss before auto-start.' },
        { group: 'start',    key: 'start_attempts',         label: 'Start attempts',        type: 'number',            default: 3,    help: 'Number of crank attempts before lockout.' },
        { group: 'start',    key: 'crank_duration_s',       label: 'Crank duration',        type: 'number', unit: 's',  default: 5,    help: 'Duration of each crank pulse.' },
        { group: 'start',    key: 'crank_pause_s',          label: 'Crank pause',           type: 'number', unit: 's',  default: 10,   help: 'Pause between crank attempts.' },
        { group: 'start',    key: 'warmup_s',               label: 'Warm-up time',          type: 'number', unit: 's',  default: 15,   help: 'Run time before transferring load to generator.' },
        { group: 'start',    key: 'cooldown_s',             label: 'Cool-down time',        type: 'number', unit: 's',  default: 120,  help: 'Run time after grid returns before stopping generator.' },
        { group: 'transfer', key: 'transfer_delay_s',       label: 'Transfer delay',        type: 'number', unit: 's',  default: 5,    help: 'Delay after generator is stable before transferring load.' },
        { group: 'transfer', key: 'retransfer_delay_s',     label: 'Re-transfer delay',     type: 'number', unit: 's',  default: 30,   help: 'Delay after grid returns before transferring back.' },
        { group: 'battery',  key: 'low_battery_threshold',  label: 'Low battery threshold', type: 'number', unit: 'V',  default: 11.5, help: 'Battery voltage below this triggers a low battery alarm.' },
      ],
    },
    {
      id: 'ev_charger',
      name: 'EV Charger Manager',
      icon: '🔌',
      category: 'energy',
      color: '#22d97a',
      _planned: true,
      description: 'Smart EV charging scheduler — enables, limits, or stops charging based on solar surplus, grid tariff schedule, or a configurable power budget. Supports EVSE pilot signal control (PWM duty cycle → current limit) or simple relay enable/disable for dumb chargers. Integrates with Energy Monitor to stay within the building\'s maximum demand limit.',
      inputs: [
        { key: 'charger_enable',  label: 'Charger Enable',        type: 'relay',  required: true,  description: 'Relay to enable/disable the EVSE or smart socket.' },
        { key: 'pilot_ao',        label: 'Pilot Signal (AO)',     type: 'analog_out', required: false, description: 'Analog output for PWM pilot current limit (6–32A → 0–100%).' },
        { key: 'charger_active',  label: 'Charger Active',        type: 'di',     required: false, description: 'Feedback — EV is plugged in and charging.' },
        { key: 'solar_surplus',   label: 'Solar Surplus (W)',     type: 'sensor', required: false, description: 'Available solar surplus power (W) — from Energy Monitor.' },
        { key: 'grid_power',      label: 'Grid Power (W)',        type: 'sensor', required: false, description: 'Current grid import/export (W).' },
        { key: 'grid_tariff',     label: 'Off-peak Tariff DI',   type: 'di',     required: false, description: 'Optional digital input — off-peak tariff active signal.' },
        { key: 'house_power',     label: 'House Power (W)',       type: 'sensor', required: false, description: 'Total house consumption (W).' },
      ],
      groups: [
        { id: 'mode',     label: '⚡ Charge Mode' },
        { id: 'current',  label: '🔌 Current Limits' },
        { id: 'schedule', label: '🕐 Schedule' },
      ],
      setpoints: [
        { group: 'mode',     key: 'mode',                     label: 'Charge mode',           type: 'select', options: ['solar','schedule','immediate','budget'], default: 'solar', help: 'solar = surplus only, schedule = off-peak, immediate = always on, budget = power limit.' },
        { group: 'mode',     key: 'min_solar_surplus_w',      label: 'Min solar surplus',     type: 'number', unit: 'W',  default: 1400, help: 'Minimum solar surplus before starting charge.' },
        { group: 'mode',     key: 'max_house_power_w',        label: 'Max house power',       type: 'number', unit: 'W',  default: 10000, help: 'Max total house power — reduce EV current to stay below this.' },
        { group: 'mode',     key: 'solar_smoothing_s',        label: 'Solar smoothing',       type: 'number', unit: 's',  default: 60,   help: 'Averaging window for solar surplus to avoid rapid cycling.' },
        { group: 'current',  key: 'min_current_a',            label: 'Min current',           type: 'number', unit: 'A',  default: 6,    help: 'Minimum charging current — EVSE minimum is typically 6A.' },
        { group: 'current',  key: 'max_current_a',            label: 'Max current',           type: 'number', unit: 'A',  default: 16,   help: 'Maximum charging current.' },
        { group: 'schedule', key: 'schedule_start',           label: 'Charge start',          type: 'text',               default: '23:00', help: 'Off-peak charge start time (HH:MM).' },
        { group: 'schedule', key: 'schedule_stop',            label: 'Charge stop',           type: 'text',               default: '06:00', help: 'Off-peak charge stop time (HH:MM).' },
      ],
    },
    {
      id: 'hw_recirc',
      name: 'Hot Water Recirculation',
      icon: '♻️',
      category: 'hydraulic',
      color: '#ff8c42',
      _planned: true,
      description: 'Hot water recirculation pump controller. Keeps hot water ready at taps without wasting water waiting for it to heat up. Supports timer-based, temperature-based, and demand-triggered (button/motion) activation.',
      inputs: [
        { key: 'recirc_pump',    label: 'Recirculation Pump',   type: 'relay',  required: true,  description: 'Recirculation pump relay.' },
        { key: 'temp_return',    label: 'Return Line Temp',     type: 'sensor', required: false, description: 'Return line temperature (cold = hot water has cooled, pump needed).' },
        { key: 'demand_trigger', label: 'Demand Trigger',       type: 'di',     required: false, description: 'Push button or motion sensor at tap.' },
      ],
      groups: [
        { id: 'mode',   label: '🔄 Mode' },
        { id: 'temps',  label: '🌡️ Temperature Control' },
        { id: 'demand', label: '👆 Demand Trigger' },
      ],
      setpoints: [
        { group: 'mode',   key: 'mode',             label: 'Control mode',         type: 'select', options: ['schedule','temperature','demand','combined'], default: 'schedule', help: 'schedule, temperature, demand, or combined.' },
        { group: 'mode',   key: 'schedule_on',      label: 'Active from',          type: 'text',   default: '06:00', help: 'Start time for schedule mode (HH:MM).' },
        { group: 'mode',   key: 'schedule_off',     label: 'Active until',         type: 'text',   default: '22:00', help: 'End time for schedule mode (HH:MM).' },
        { group: 'temps',  key: 'return_temp_on',   label: 'Start below',          type: 'number', unit: '°C', default: 40, help: 'Start pump when return line drops below this temperature.' },
        { group: 'temps',  key: 'return_temp_off',  label: 'Stop above',           type: 'number', unit: '°C', default: 55, help: 'Stop pump when return line reaches this temperature.' },
        { group: 'demand', key: 'demand_run_min',   label: 'Run after trigger',    type: 'number', unit: 'min', default: 3,  help: 'Minutes to run after a demand trigger.' },
        { group: 'demand', key: 'min_off_min',      label: 'Min off time',         type: 'number', unit: 'min', default: 10, help: 'Minimum off time between demand runs.' },
      ],
    },
  ];

  // ── Fetch definitions ────────────────────────────────────────────────────────
  async function fetchDefs() {
    try {
      const r = await fetch('/api/modules/definitions', { credentials: 'same-origin' });
      const data = await r.json();
      const raw = Array.isArray(data) ? data : (data.definitions || data.modules || []);
      state.defs = [...raw.map(normalize), ...PLANNED_MODULES.map(normalize)];
    } catch (e) {
      state.defs = PLANNED_MODULES.map(normalize);
    }
  }

  function normalize(m) {
    return {
      ...m,
      _inputs:    Array.isArray(m.inputs)    ? m.inputs    : [],
      _groups:    Array.isArray(m.groups)    ? m.groups    : [],
      _setpoints: Array.isArray(m.setpoints) ? m.setpoints : [],
      _commands:  m.commands ? Object.keys(m.commands) : [],
    };
  }

  // ── Category filter ──────────────────────────────────────────────────────────
  function buildCategories() {
    const cats = [...new Set(state.defs.map(m => m.category || 'general'))].sort();
    cats.forEach(c => {
      const o = document.createElement('option');
      o.value = c;
      o.textContent = c.charAt(0).toUpperCase() + c.slice(1);
      $('cat').appendChild(o);
    });
  }

  function filterDefs() {
    const q   = ($('q').value || '').trim().toLowerCase();
    const cat = $('cat').value || '';
    state.filtered = state.defs.filter(m => {
      const hay = JSON.stringify(m).toLowerCase();
      return (!q || hay.includes(q)) && (!cat || (m.category || '') === cat);
    }).sort((a, b) => {
      // Planned modules always go to the end
      if (a._planned && !b._planned) return 1;
      if (!a._planned && b._planned) return -1;
      return (a.name || a.id || '').localeCompare(b.name || b.id || '');
    });
    if (!state.selected || !state.filtered.find(m => m.id === state.selected.id)) {
      state.selected = state.filtered[0] || null;
    }
  }

  // ── Left panel — module list ─────────────────────────────────────────────────
  function renderList() {
    const list = $('moduleList');
    const liveCount    = state.filtered.filter(m => !m._planned).length;
    const plannedCount = state.filtered.filter(m =>  m._planned).length;
    let badge = `${liveCount} module${liveCount !== 1 ? 's' : ''}`;
    if (plannedCount) badge += ` · ${plannedCount} planned`;
    $('countBadge').textContent = badge;

    if (!state.filtered.length) {
      list.innerHTML = '<div class="emptyState">No modules match the current filter.</div>';
      return;
    }

    list.innerHTML = state.filtered.map(m => {
      const active  = state.selected && state.selected.id === m.id ? ' active' : '';
      const ioCount = m._inputs.length;
      const spCount = m._setpoints.filter(s => s.type !== 'hidden').length;
      const plannedTag = m._planned ? ' &middot; <span style="color:#a855f7;font-weight:700">Planned</span>' : '';
      return `
        <div class="help-item${active}" data-id="${esc(m.id)}">
          <div class="hiName">${esc(m.icon || '\u{1F9E9}')} ${esc(m.name || m.id)}</div>
          <div class="hiMeta">${esc(m.category || 'general')} &middot; ${ioCount} IO &middot; ${spCount} settings${plannedTag}</div>
          <div class="hiDesc">${esc(m.description || 'No description.')}</div>
        </div>`;
    }).join('');

    list.querySelectorAll('.help-item').forEach(el => {
      el.addEventListener('click', () => {
        const m = state.filtered.find(x => x.id === el.dataset.id);
        if (m) { state.selected = m; renderList(); renderDetail(); }
      });
    });
  }

  // ── Badges & chips ───────────────────────────────────────────────────────────
  const TYPE_COLORS = {
    sensor:     { bg: 'rgba(34,217,122,.12)',  border: 'rgba(34,217,122,.35)',  fg: '#22d97a' },
    relay:      { bg: 'rgba(29,140,255,.12)',  border: 'rgba(29,140,255,.35)',  fg: '#1d8cff' },
    analog:     { bg: 'rgba(245,158,11,.12)',  border: 'rgba(245,158,11,.35)',  fg: '#f59e0b' },
    analog_out: { bg: 'rgba(245,158,11,.12)',  border: 'rgba(245,158,11,.35)',  fg: '#f59e0b' },
    di:         { bg: 'rgba(168,85,247,.12)',  border: 'rgba(168,85,247,.35)',  fg: '#a855f7' },
  };

  function typeBadge(type) {
    const c = TYPE_COLORS[type] || { bg: 'rgba(100,116,139,.12)', border: 'rgba(100,116,139,.35)', fg: '#94a3b8' };
    return `<span class="type-badge" style="background:${c.bg};border-color:${c.border};color:${c.fg}">${esc(type || '?')}</span>`;
  }

  function unitChip(unit) {
    return unit ? `<span class="unit-chip">${esc(unit)}</span>` : '';
  }

  // ── IO card ──────────────────────────────────────────────────────────────────
  function renderInput(inp) {
    const desc = inp.description
      ? `<div class="io-desc">${esc(inp.description)}</div>` : '';
    return `
      <div class="io-card">
        <div class="io-card-top">
          <code class="io-key">${esc(inp.key)}</code>
          <span class="io-label">${esc(inp.label || inp.key)}</span>
          <div class="io-chips">${typeBadge(inp.type)}${unitChip(inp.unit)}</div>
        </div>
        ${desc}
      </div>`;
  }

  // ── Setpoint card ────────────────────────────────────────────────────────────
  function renderSetpoint(sp) {
    const defPart = (sp.default !== undefined && String(sp.default) !== '')
      ? `<span class="sp-default">default: ${esc(String(sp.default))}</span>` : '';
    const optPart = Array.isArray(sp.options) && sp.options.length
      ? `<span class="sp-options">${sp.options.map(esc).join(' / ')}</span>` : '';
    // Show sp.help first, fall back to sp.description (many modules use description instead of help)
    const helpText = sp.help || sp.description || '';
    const helpPart = helpText
      ? `<div class="sp-help"><span class="sp-help-icon">&#128161;</span>${esc(helpText)}</div>` : '';
    return `
      <div class="sp-card">
        <div class="sp-card-top">
          <code class="sp-key">${esc(sp.key)}</code>
          <span class="sp-label">${esc(sp.label || sp.key)}</span>
          <div class="sp-chips">
            <span class="sp-type">${esc(sp.type || '?')}</span>
            ${unitChip(sp.unit)}${defPart}${optPart}
          </div>
        </div>
        ${helpPart}
      </div>`;
  }

  // ── Settings section (grouped) ───────────────────────────────────────────────
  function renderSettings(m) {
    const visible = m._setpoints.filter(s => s.type !== 'hidden');
    if (!visible.length) return '';

    const grouped   = {};
    const ungrouped = [];
    visible.forEach(sp => {
      if (sp.group) {
        if (!grouped[sp.group]) grouped[sp.group] = [];
        grouped[sp.group].push(sp);
      } else {
        ungrouped.push(sp);
      }
    });

    const groupOrder  = m._groups.map(g => g.id);
    const extraGroups = Object.keys(grouped).filter(g => !groupOrder.includes(g));

    function renderGroup(id) {
      const items = grouped[id];
      if (!items || !items.length) return '';
      const def   = m._groups.find(g => g.id === id);
      const label = def ? esc(def.label || id) : esc(id);
      return `
        <div class="sp-group">
          <div class="sp-group-title">${label}</div>
          ${items.map(renderSetpoint).join('')}
        </div>`;
    }

    const groupsHtml = [
      ...groupOrder.map(renderGroup),
      ...extraGroups.map(renderGroup),
      ...(ungrouped.length
        ? [`<div class="sp-group"><div class="sp-group-title">&#9881;&#65039; General</div>${ungrouped.map(renderSetpoint).join('')}</div>`]
        : []),
    ].join('');

    return `
      <div class="doc-section">
        <div class="section-title">&#9881;&#65039; Settings</div>
        ${groupsHtml}
      </div>`;
  }

  // ── Commands section ─────────────────────────────────────────────────────────
  function renderCommands(m) {
    if (!m._commands.length) return '';
    return `
      <div class="doc-section">
        <div class="section-title">&#127918; Commands</div>
        <div class="commands-grid">
          ${m._commands.map(c => `<div class="cmd-chip"><code>${esc(c)}</code></div>`).join('')}
        </div>
        <div class="cmd-note">Commands can be triggered via Scenes or the API:
          <code>POST /api/automation/instances/:id/command</code>
        </div>
      </div>`;
  }

  // ── Planned module notice ─────────────────────────────────────────────────────
  function renderPlannedNotice() {
    return `
      <div class="doc-section" style="background:rgba(168,85,247,.06);border:1px solid rgba(168,85,247,.2);border-radius:10px;padding:14px 16px;margin-bottom:20px">
        <div style="font-size:12px;font-weight:700;color:#a855f7;margin-bottom:4px">🔮 Planned Module</div>
        <div style="font-size:11px;color:var(--muted2);line-height:1.6">This module is documented and designed but not yet implemented. The IO map and settings shown here are the planned specification and may change before release.</div>
      </div>`;
  }

  // ── Right panel — detail ─────────────────────────────────────────────────────
  function renderDetail() {
    const wrap  = $('detail');
    const m     = state.selected;

    if (!m) {
      wrap.innerHTML = '<div class="emptyState" style="padding:40px">&larr; Select a module to read its documentation.</div>';
      return;
    }

    const required = m._inputs.filter(i => i.required);
    const optional = m._inputs.filter(i => !i.required);
    const spCount  = m._setpoints.filter(s => s.type !== 'hidden').length;

    const ioSection = (required.length + optional.length) > 0 ? `
      <div class="doc-section">
        <div class="section-title">&#128268; Inputs &amp; Outputs</div>
        ${required.length ? `
          <div class="io-section-label io-required-label">&#9899; Required</div>
          ${required.map(renderInput).join('')}
        ` : ''}
        ${optional.length ? `
          <div class="io-section-label io-optional-label"${required.length ? ' style="margin-top:14px"' : ''}>&#9898; Optional</div>
          ${optional.map(renderInput).join('')}
        ` : ''}
      </div>` : '';

    const plannedBadge = m._planned
      ? `<span class="badge" style="background:rgba(168,85,247,.12);border-color:rgba(168,85,247,.35);color:#a855f7">🔮 Planned</span>`
      : '';

    wrap.innerHTML = `
      <div class="module-header">
        <div class="module-header-left">
          <div class="module-title">${esc(m.icon || '\u{1F9E9}')} ${esc(m.name || m.id)}</div>
          <div class="module-desc">${esc(m.description || '')}</div>
        </div>
        <div class="module-badges">
          <span class="badge">${esc(m.category || 'general')}</span>
          <span class="badge">id: ${esc(m.id)}</span>
          <span class="badge">${m._inputs.length} IO</span>
          <span class="badge">${spCount} settings</span>
          ${m._commands.length ? `<span class="badge">${m._commands.length} commands</span>` : ''}
          ${plannedBadge}
        </div>
      </div>
      ${m._planned ? renderPlannedNotice() : ''}
      ${ioSection}
      ${renderSettings(m)}
      ${renderCommands(m)}
    `;
  }

  // ── Boot ─────────────────────────────────────────────────────────────────────
  async function init() {
    await fetchDefs();
    buildCategories();
    $('q').addEventListener('input',   () => { filterDefs(); renderList(); renderDetail(); });
    $('cat').addEventListener('change',() => { filterDefs(); renderList(); renderDetail(); });
    filterDefs();
    renderList();
    renderDetail();
  }

  window.addEventListener('DOMContentLoaded', init);
})();
