// ── Peripheral Library ─────────────────────────────────────────────────────
(function() {

var PL_TEMPLATES = [
  // ── Weather / Environment ──────────────────────────────────────────────
  {
    id: 'anemometer', name: 'Wind Speed (WH-SP-WS01)', category: 'Weather / Environment',
    icon: '💨', description: 'Pulse-counter anemometer, outputs km/h',
    fields: [
      { id: 'gpio', label: 'GPIO Pin', type: 'number', default: 47 },
      { id: 'update_interval', label: 'Update Interval', type: 'text', default: '5s' }
    ],
    generate: function(c, f) {
      var s = safePlName(f._dn);
      return c + 'sensor:\n' +
        '  - platform: pulse_counter\n' +
        '    pin: ' + f.gpio + '\n' +
        '    name: "Wind Speed"\n' +
        '    id: wind_speed\n' +
        '    unit_of_measurement: "km/h"\n' +
        '    update_interval: ' + f.update_interval + '\n' +
        '    filters:\n' +
        '      - lambda: return x * (0.666 / 60.0 * 3.6);\n' +
        plTele(s, 'wind_speed', '%.1f');
    }
  },
  {
    id: 'rain_digital', name: 'Rain Sensor (digital)', category: 'Weather / Environment',
    icon: '🌧️', description: 'Digital on/off rain detection',
    fields: [
      { id: 'gpio', label: 'GPIO Pin', type: 'number', default: 34 }
    ],
    generate: function(c, f) {
      var s = safePlName(f._dn);
      return c + 'binary_sensor:\n' +
        '  - platform: gpio\n' +
        '    pin: ' + f.gpio + '\n' +
        '    name: "Rain Sensor"\n' +
        '    id: rain_sensor\n' +
        '    device_class: moisture\n' +
        plTeleBin(s, 'rain_sensor');
    }
  },
  {
    id: 'dht22', name: 'DHT22 Temperature + Humidity', category: 'Weather / Environment',
    icon: '🌡️', description: 'Single-wire DHT22 sensor',
    fields: [
      { id: 'gpio', label: 'GPIO Pin', type: 'number', default: 4 }
    ],
    generate: function(c, f) {
      var s = safePlName(f._dn);
      return c + 'sensor:\n' +
        '  - platform: dht\n' +
        '    model: DHT22\n' +
        '    pin: ' + f.gpio + '\n' +
        '    update_interval: 30s\n' +
        '    temperature:\n' +
        '      name: "Temperature"\n' +
        '      id: temperature\n' +
        plTele(s, 'temperature', '%.1f', '      ') +
        '    humidity:\n' +
        '      name: "Humidity"\n' +
        '      id: humidity\n' +
        plTele(s, 'humidity', '%.1f', '      ');
    }
  },
  {
    id: 'bme280', name: 'BME280 Temp / Humidity / Pressure', category: 'Weather / Environment',
    icon: '📡', description: 'I2C BME280 multi-sensor',
    fields: [
      { id: 'sda', label: 'SDA Pin', type: 'number', default: 21 },
      { id: 'scl', label: 'SCL Pin', type: 'number', default: 22 },
      { id: 'address', label: 'I2C Address (hex)', type: 'text', default: '0x76' }
    ],
    generate: function(c, f) {
      var s = safePlName(f._dn);
      return c + 'i2c:\n  sda: ' + f.sda + '\n  scl: ' + f.scl + '\n\n' +
        'sensor:\n' +
        '  - platform: bme280_i2c\n' +
        '    address: ' + f.address + '\n' +
        '    update_interval: 60s\n' +
        '    temperature:\n' +
        '      name: "Temperature"\n' +
        '      id: temperature\n' +
        plTele(s, 'temperature', '%.1f', '      ') +
        '    humidity:\n' +
        '      name: "Humidity"\n' +
        '      id: humidity\n' +
        plTele(s, 'humidity', '%.1f', '      ') +
        '    pressure:\n' +
        '      name: "Pressure"\n' +
        '      id: pressure\n' +
        plTele(s, 'pressure', '%.1f', '      ');
    }
  },
  {
    id: 'bh1750', name: 'BH1750 Lux Sensor', category: 'Weather / Environment',
    icon: '☀️', description: 'I2C BH1750 light sensor',
    fields: [
      { id: 'sda', label: 'SDA Pin', type: 'number', default: 21 },
      { id: 'scl', label: 'SCL Pin', type: 'number', default: 22 },
      { id: 'address', label: 'I2C Address (hex)', type: 'text', default: '0x23' }
    ],
    generate: function(c, f) {
      var s = safePlName(f._dn);
      return c + 'i2c:\n  sda: ' + f.sda + '\n  scl: ' + f.scl + '\n\n' +
        'sensor:\n' +
        '  - platform: bh1750\n' +
        '    address: ' + f.address + '\n' +
        '    name: "Illuminance"\n' +
        '    id: illuminance\n' +
        '    update_interval: 60s\n' +
        plTele(s, 'illuminance', '%.1f');
    }
  },
  // ── Temperature ────────────────────────────────────────────────────────
  {
    id: 'ds18b20', name: 'DS18B20 Temperature (1-Wire)', category: 'Temperature',
    icon: '🌡️', description: 'Dallas 1-Wire temperature probe',
    fields: [
      { id: 'gpio', label: 'GPIO Pin', type: 'number', default: 14 }
    ],
    generate: function(c, f) {
      var s = safePlName(f._dn);
      return c + 'one_wire:\n' +
        '  - platform: gpio\n' +
        '    pin: GPIO' + f.gpio + '\n\n' +
        'sensor:\n' +
        '  - platform: dallas_temp\n' +
        '    index: 0\n' +
        '    name: "Temperature"\n' +
        '    id: temperature\n' +
        '    unit_of_measurement: "°C"\n' +
        '    update_interval: 30s\n' +
        plTele(s, 'temperature', '%.1f');
    }
  },
  {
    id: 'ntc', name: 'NTC Thermistor (analog)', category: 'Temperature',
    icon: '🔥', description: 'Analog NTC thermistor via ADC',
    fields: [
      { id: 'gpio', label: 'GPIO Pin (ADC)', type: 'number', default: 34 }
    ],
    generate: function(c, f) {
      var s = safePlName(f._dn);
      return c + 'sensor:\n' +
        '  - platform: ntc\n' +
        '    sensor: ntc_source\n' +
        '    name: "NTC Temperature"\n' +
        '    id: ntc_temp\n' +
        '    calibration:\n' +
        '      b_constant: 3950\n' +
        '      reference_resistance: 10k\n' +
        '      reference_temperature: 25\n' +
        '      nominal_resistance: 10k\n' +
        plTele(s, 'ntc_temp', '%.1f') +
        '\n  - platform: adc\n' +
        '    id: ntc_source\n' +
        '    pin: GPIO' + f.gpio + '\n' +
        '    update_interval: 60s\n';
    }
  },
  // ── Motion / Security ──────────────────────────────────────────────────
  {
    id: 'pir', name: 'PIR Motion Sensor', category: 'Motion / Security',
    icon: '🚶', description: 'Passive infrared motion detector',
    fields: [
      { id: 'gpio', label: 'GPIO Pin', type: 'number', default: 23 }
    ],
    generate: function(c, f) {
      var s = safePlName(f._dn);
      return c + 'binary_sensor:\n' +
        '  - platform: gpio\n' +
        '    pin: ' + f.gpio + '\n' +
        '    name: "Motion"\n' +
        '    id: motion\n' +
        '    device_class: motion\n' +
        plTeleBin(s, 'motion');
    }
  },
  {
    id: 'door_contact', name: 'Door / Window Contact', category: 'Motion / Security',
    icon: '🚪', description: 'Magnetic reed switch contact sensor',
    fields: [
      { id: 'gpio', label: 'GPIO Pin', type: 'number', default: 25 }
    ],
    generate: function(c, f) {
      var s = safePlName(f._dn);
      return c + 'binary_sensor:\n' +
        '  - platform: gpio\n' +
        '    pin:\n' +
        '      number: ' + f.gpio + '\n' +
        '      mode: INPUT_PULLUP\n' +
        '    name: "Door Contact"\n' +
        '    id: door_contact\n' +
        '    device_class: door\n' +
        plTeleBin(s, 'door_contact');
    }
  },
  {
    id: 'vibration', name: 'Vibration Sensor (SW-420)', category: 'Motion / Security',
    icon: '📳', description: 'SW-420 digital vibration switch',
    fields: [
      { id: 'gpio', label: 'GPIO Pin', type: 'number', default: 26 }
    ],
    generate: function(c, f) {
      var s = safePlName(f._dn);
      return c + 'binary_sensor:\n' +
        '  - platform: gpio\n' +
        '    pin: ' + f.gpio + '\n' +
        '    name: "Vibration"\n' +
        '    id: vibration\n' +
        '    device_class: vibration\n' +
        plTeleBin(s, 'vibration');
    }
  },
  // ── Air Quality ────────────────────────────────────────────────────────
  {
    id: 'mhz19', name: 'MH-Z19 CO2 Sensor (UART)', category: 'Air Quality',
    icon: '💨', description: 'NDIR CO2 + temperature over UART',
    fields: [
      { id: 'tx_pin', label: 'TX Pin', type: 'number', default: 17 },
      { id: 'rx_pin', label: 'RX Pin', type: 'number', default: 16 },
      { id: 'update_interval', label: 'Update Interval', type: 'text', default: '60s' }
    ],
    generate: function(c, f) {
      var s = safePlName(f._dn);
      return c + 'uart:\n' +
        '  rx_pin: ' + f.rx_pin + '\n' +
        '  tx_pin: ' + f.tx_pin + '\n' +
        '  baud_rate: 9600\n\n' +
        'sensor:\n' +
        '  - platform: mhz19\n' +
        '    update_interval: ' + f.update_interval + '\n' +
        '    automatic_baseline_calibration: false\n' +
        '    co2:\n' +
        '      name: "CO2"\n' +
        '      id: co2\n' +
        plTele(s, 'co2', '%.0f', '      ') +
        '    temperature:\n' +
        '      name: "MHZ19 Temperature"\n' +
        '      id: mhz19_temp\n' +
        plTele(s, 'mhz19_temp', '%.1f', '      ');
    }
  },
  {
    id: 'ccs811', name: 'CCS811 eCO2 + TVOC', category: 'Air Quality',
    icon: '🧪', description: 'I2C CCS811 air quality sensor',
    fields: [
      { id: 'sda', label: 'SDA Pin', type: 'number', default: 21 },
      { id: 'scl', label: 'SCL Pin', type: 'number', default: 22 },
      { id: 'address', label: 'I2C Address (hex)', type: 'text', default: '0x5A' }
    ],
    generate: function(c, f) {
      var s = safePlName(f._dn);
      return c + 'i2c:\n  sda: ' + f.sda + '\n  scl: ' + f.scl + '\n\n' +
        'sensor:\n' +
        '  - platform: ccs811\n' +
        '    address: ' + f.address + '\n' +
        '    update_interval: 60s\n' +
        '    eco2:\n' +
        '      name: "eCO2"\n' +
        '      id: eco2\n' +
        plTele(s, 'eco2', '%.0f', '      ') +
        '    tvoc:\n' +
        '      name: "TVOC"\n' +
        '      id: tvoc\n' +
        plTele(s, 'tvoc', '%.0f', '      ');
    }
  },
  // ── Soil / Water ───────────────────────────────────────────────────────
  {
    id: 'soil_moisture', name: 'Soil Moisture (capacitive)', category: 'Soil / Water',
    icon: '🌱', description: 'Analog capacitive soil moisture sensor',
    fields: [
      { id: 'gpio', label: 'GPIO Pin (ADC)', type: 'number', default: 36 },
      { id: 'min_voltage', label: 'Min Voltage (dry)', type: 'number', default: 1.2 },
      { id: 'max_voltage', label: 'Max Voltage (wet)', type: 'number', default: 2.8 }
    ],
    generate: function(c, f) {
      var s = safePlName(f._dn);
      return c + 'sensor:\n' +
        '  - platform: adc\n' +
        '    pin: GPIO' + f.gpio + '\n' +
        '    name: "Soil Moisture"\n' +
        '    id: soil_moisture\n' +
        '    unit_of_measurement: "%"\n' +
        '    update_interval: 60s\n' +
        '    filters:\n' +
        '      - calibrate_linear:\n' +
        '          - ' + f.min_voltage + ' -> 100.0\n' +
        '          - ' + f.max_voltage + ' -> 0.0\n' +
        '      - clamp:\n' +
        '          min_value: 0\n' +
        '          max_value: 100\n' +
        plTele(s, 'soil_moisture', '%.1f');
    }
  },
  {
    id: 'water_leak', name: 'Water Leak Sensor (digital)', category: 'Soil / Water',
    icon: '💧', description: 'Digital water leak/flood detector',
    fields: [
      { id: 'gpio', label: 'GPIO Pin', type: 'number', default: 27 }
    ],
    generate: function(c, f) {
      var s = safePlName(f._dn);
      return c + 'binary_sensor:\n' +
        '  - platform: gpio\n' +
        '    pin: ' + f.gpio + '\n' +
        '    name: "Water Leak"\n' +
        '    id: water_leak\n' +
        '    device_class: moisture\n' +
        plTeleBin(s, 'water_leak');
    }
  },
  // ── Power / Energy ─────────────────────────────────────────────────────
  {
    id: 'pzem004t', name: 'PZEM-004T AC Power Meter', category: 'Power / Energy',
    icon: '⚡', description: 'AC voltage, current, power, energy — UART',
    fields: [
      { id: 'tx_pin', label: 'TX Pin', type: 'number', default: 17 },
      { id: 'rx_pin', label: 'RX Pin', type: 'number', default: 16 },
      { id: 'update_interval', label: 'Update Interval', type: 'text', default: '10s' }
    ],
    generate: function(c, f) {
      var s = safePlName(f._dn);
      return c + 'uart:\n' +
        '  tx_pin: ' + f.tx_pin + '\n' +
        '  rx_pin: ' + f.rx_pin + '\n' +
        '  baud_rate: 9600\n' +
        '  stop_bits: 1\n\n' +
        'sensor:\n' +
        '  - platform: pzemac\n' +
        '    current:\n' +
        '      name: "' + f._dn + ' Current"\n' +
        '      id: ' + s + '_current\n' +
        '      unit_of_measurement: "A"\n' +
        plTele(s, s + '_current', '%.3f', '      ') +
        '    voltage:\n' +
        '      name: "' + f._dn + ' Voltage"\n' +
        '      id: ' + s + '_voltage\n' +
        '      unit_of_measurement: "V"\n' +
        plTele(s, s + '_voltage', '%.1f', '      ') +
        '    energy:\n' +
        '      name: "' + f._dn + ' Energy"\n' +
        '      id: ' + s + '_energy\n' +
        '      unit_of_measurement: "Wh"\n' +
        plTele(s, s + '_energy', '%.1f', '      ') +
        '    power:\n' +
        '      name: "' + f._dn + ' Power"\n' +
        '      id: ' + s + '_power\n' +
        '      unit_of_measurement: "W"\n' +
        plTele(s, s + '_power', '%.1f', '      ') +
        '    frequency:\n' +
        '      name: "' + f._dn + ' Frequency"\n' +
        '      id: ' + s + '_freq\n' +
        '      unit_of_measurement: "Hz"\n' +
        plTele(s, s + '_freq', '%.1f', '      ') +
        '    power_factor:\n' +
        '      name: "' + f._dn + ' Power Factor"\n' +
        '      id: ' + s + '_pf\n' +
        plTele(s, s + '_pf', '%.3f', '      ') +
        '    update_interval: ' + f.update_interval + '\n';
    }
  },
  {
    id: 'ina219', name: 'INA219 DC Current/Power (I2C)', category: 'Power / Energy',
    icon: '🔋', description: 'DC voltage, current, power — I2C',
    fields: [
      { id: 'sda', label: 'SDA Pin', type: 'number', default: 21 },
      { id: 'scl', label: 'SCL Pin', type: 'number', default: 22 },
      { id: 'address', label: 'I2C Address (hex)', type: 'text', default: '0x40' },
      { id: 'update_interval', label: 'Update Interval', type: 'text', default: '10s' }
    ],
    generate: function(c, f) {
      var s = safePlName(f._dn);
      return c + 'i2c:\n  sda: ' + f.sda + '\n  scl: ' + f.scl + '\n\n' +
        'sensor:\n' +
        '  - platform: ina219\n' +
        '    address: ' + f.address + '\n' +
        '    shunt_resistance: 0.1 ohm\n' +
        '    current:\n' +
        '      name: "' + f._dn + ' Current"\n' +
        '      id: ' + s + '_current\n' +
        plTele(s, s + '_current', '%.3f', '      ') +
        '    power:\n' +
        '      name: "' + f._dn + ' Power"\n' +
        '      id: ' + s + '_power\n' +
        plTele(s, s + '_power', '%.2f', '      ') +
        '    bus_voltage:\n' +
        '      name: "' + f._dn + ' Bus Voltage"\n' +
        '      id: ' + s + '_bus_v\n' +
        plTele(s, s + '_bus_v', '%.2f', '      ') +
        '    shunt_voltage:\n' +
        '      name: "' + f._dn + ' Shunt Voltage"\n' +
        '      id: ' + s + '_shunt_v\n' +
        plTele(s, s + '_shunt_v', '%.4f', '      ') +
        '    update_interval: ' + f.update_interval + '\n';
    }
  },
  {
    id: 'ct_clamp', name: 'CT Clamp Non-Invasive AC Current', category: 'Power / Energy',
    icon: '〰️', description: 'Non-invasive AC current via ADC — no wire cutting',
    fields: [
      { id: 'gpio', label: 'GPIO Pin (ADC)', type: 'number', default: 36 },
      { id: 'update_interval', label: 'Update Interval', type: 'text', default: '5s' }
    ],
    generate: function(c, f) {
      var s = safePlName(f._dn);
      return c + 'sensor:\n' +
        '  - platform: ct_clamp\n' +
        '    sensor: adc_sensor\n' +
        '    name: "' + f._dn + ' Current"\n' +
        '    id: ' + s + '_current\n' +
        '    update_interval: ' + f.update_interval + '\n' +
        '    filters:\n' +
        '      - calibrate_linear:\n' +
        '        - 0 -> 0\n' +
        '        - 0.11 -> 4.0\n' +
        plTele(s, s + '_current', '%.3f') +
        '\n  - platform: adc\n' +
        '    pin: GPIO' + f.gpio + '\n' +
        '    id: adc_sensor\n' +
        '    attenuation: 11db\n';
    }
  },
  // ── Level / Flow ───────────────────────────────────────────────────────
  {
    id: 'hcsr04', name: 'HC-SR04 Ultrasonic Tank Level', category: 'Level / Flow',
    icon: '📡', description: 'Ultrasonic distance → tank fill percentage',
    fields: [
      { id: 'trigger_pin', label: 'Trigger Pin', type: 'number', default: 5 },
      { id: 'echo_pin', label: 'Echo Pin', type: 'number', default: 18 },
      { id: 'tank_empty_cm', label: 'Tank Empty Distance (cm)', type: 'number', default: 200 },
      { id: 'tank_full_cm', label: 'Tank Full Distance (cm)', type: 'number', default: 20 },
      { id: 'update_interval', label: 'Update Interval', type: 'text', default: '10s' }
    ],
    generate: function(c, f) {
      var s = safePlName(f._dn);
      var dnid = f._dn.replace(/-/g, '_');
      return c + 'sensor:\n' +
        '  - platform: ultrasonic\n' +
        '    trigger_pin: GPIO' + f.trigger_pin + '\n' +
        '    echo_pin: GPIO' + f.echo_pin + '\n' +
        '    name: "' + f._dn + ' Distance"\n' +
        '    id: ' + dnid + '_distance\n' +
        '    unit_of_measurement: "cm"\n' +
        '    update_interval: ' + f.update_interval + '\n' +
        '    filters:\n' +
        '      - lambda: return x * 100.0;  # m to cm\n' +
        plTele(s, dnid + '_distance', '%.1f') +
        '\n  - platform: template\n' +
        '    name: "' + f._dn + ' Level"\n' +
        '    id: ' + dnid + '_level\n' +
        '    unit_of_measurement: "%"\n' +
        '    update_interval: ' + f.update_interval + '\n' +
        '    lambda: |-\n' +
        '      float empty = ' + f.tank_empty_cm + ';\n' +
        '      float full  = ' + f.tank_full_cm + ';\n' +
        '      float dist  = id(' + dnid + '_distance).state;\n' +
        '      if (isnan(dist)) return {};\n' +
        '      float pct = (empty - dist) / (empty - full) * 100.0;\n' +
        '      return std::max(0.0f, std::min(100.0f, pct));\n' +
        plTele(s, dnid + '_level', '%.1f');
    }
  },
  {
    id: 'yfs201', name: 'YF-S201 Water Flow Meter', category: 'Level / Flow',
    icon: '💧', description: 'Pulse counter → flow rate L/min and total litres',
    fields: [
      { id: 'gpio', label: 'GPIO Pin', type: 'number', default: 23 },
      { id: 'update_interval', label: 'Update Interval', type: 'text', default: '5s' }
    ],
    generate: function(c, f) {
      var s = safePlName(f._dn);
      return c + 'sensor:\n' +
        '  - platform: pulse_counter\n' +
        '    pin:\n' +
        '      number: GPIO' + f.gpio + '\n' +
        '      mode: INPUT_PULLUP\n' +
        '    name: "' + f._dn + ' Flow Rate"\n' +
        '    id: ' + s + '_flow_rate\n' +
        '    unit_of_measurement: "L/min"\n' +
        '    update_interval: ' + f.update_interval + '\n' +
        '    filters:\n' +
        '      - lambda: return x / 7.5;  # YF-S201: 7.5 pulses per second per L/min\n' +
        plTele(s, s + '_flow_rate', '%.2f') +
        '\n  - platform: pulse_meter\n' +
        '    pin:\n' +
        '      number: GPIO' + f.gpio + '\n' +
        '      mode: INPUT_PULLUP\n' +
        '    name: "' + f._dn + ' Total"\n' +
        '    id: ' + s + '_total\n' +
        '    unit_of_measurement: "L"\n' +
        '    filters:\n' +
        '      - lambda: return x / 450.0;  # 450 pulses per litre\n' +
        plTele(s, s + '_total', '%.2f');
    }
  },
  {
    id: 'float_switch', name: 'Float Switch (Tank Full/Empty)', category: 'Level / Flow',
    icon: '🪣', description: 'Digital float switch — HIGH when water reaches sensor',
    fields: [
      { id: 'gpio', label: 'GPIO Pin', type: 'number', default: 27 }
    ],
    generate: function(c, f) {
      var s = safePlName(f._dn);
      return c + 'binary_sensor:\n' +
        '  - platform: gpio\n' +
        '    pin:\n' +
        '      number: GPIO' + f.gpio + '\n' +
        '      mode: INPUT_PULLUP\n' +
        '      inverted: true\n' +
        '    name: "' + f._dn + ' Float"\n' +
        '    id: ' + s + '_float\n' +
        '    device_class: moisture\n' +
        plTeleBin(s, s + '_float');
    }
  },
  // ── Gas / Safety ───────────────────────────────────────────────────────
  {
    id: 'mq2', name: 'MQ-2 Smoke / LPG / CO', category: 'Gas / Safety',
    icon: '💨', description: 'Analog gas sensor — smoke, LPG, CO detection',
    fields: [
      { id: 'gpio', label: 'GPIO Pin (ADC)', type: 'number', default: 34 },
      { id: 'update_interval', label: 'Update Interval', type: 'text', default: '10s' }
    ],
    generate: function(c, f) {
      var s = safePlName(f._dn);
      var dnid = f._dn.replace(/-/g, '_');
      return c + 'sensor:\n' +
        '  - platform: adc\n' +
        '    pin: GPIO' + f.gpio + '\n' +
        '    id: ' + dnid + '_mq2_raw\n' +
        '    name: "' + f._dn + ' MQ2 Raw"\n' +
        '    unit_of_measurement: "V"\n' +
        '    attenuation: 11db\n' +
        '    update_interval: ' + f.update_interval + '\n' +
        '    filters:\n' +
        '      - lambda: return x;\n' +
        plTele(s, dnid + '_mq2_raw', '%.3f') +
        '\nbinary_sensor:\n' +
        '  - platform: template\n' +
        '    name: "' + f._dn + ' Gas Alert"\n' +
        '    id: ' + dnid + '_gas_alert\n' +
        '    device_class: gas\n' +
        '    lambda: |-\n' +
        '      return id(' + dnid + '_mq2_raw).state > 1.5;\n' +
        plTeleBin(s, dnid + '_gas_alert');
    }
  },
  {
    id: 'mq7', name: 'MQ-7 Carbon Monoxide (CO)', category: 'Gas / Safety',
    icon: '☁️', description: 'CO gas sensor — analog',
    fields: [
      { id: 'gpio', label: 'GPIO Pin (ADC)', type: 'number', default: 35 },
      { id: 'update_interval', label: 'Update Interval', type: 'text', default: '10s' }
    ],
    generate: function(c, f) {
      var s = safePlName(f._dn);
      var dnid = f._dn.replace(/-/g, '_');
      return c + 'sensor:\n' +
        '  - platform: adc\n' +
        '    pin: GPIO' + f.gpio + '\n' +
        '    id: ' + dnid + '_co_raw\n' +
        '    name: "' + f._dn + ' CO Raw"\n' +
        '    unit_of_measurement: "V"\n' +
        '    attenuation: 11db\n' +
        '    update_interval: ' + f.update_interval + '\n' +
        plTele(s, dnid + '_co_raw', '%.3f') +
        '\nbinary_sensor:\n' +
        '  - platform: template\n' +
        '    name: "' + f._dn + ' CO Alert"\n' +
        '    id: ' + dnid + '_co_alert\n' +
        '    device_class: carbon_monoxide\n' +
        '    lambda: |-\n' +
        '      return id(' + dnid + '_co_raw).state > 1.2;\n' +
        plTeleBin(s, dnid + '_co_alert');
    }
  },
  {
    id: 'mq135', name: 'MQ-135 Air Quality', category: 'Gas / Safety',
    icon: '🌫️', description: 'General air quality / ammonia / benzene — analog',
    fields: [
      { id: 'gpio', label: 'GPIO Pin (ADC)', type: 'number', default: 36 },
      { id: 'update_interval', label: 'Update Interval', type: 'text', default: '10s' }
    ],
    generate: function(c, f) {
      var s = safePlName(f._dn);
      var dnid = f._dn.replace(/-/g, '_');
      return c + 'sensor:\n' +
        '  - platform: adc\n' +
        '    pin: GPIO' + f.gpio + '\n' +
        '    id: ' + dnid + '_air_quality_raw\n' +
        '    name: "' + f._dn + ' Air Quality Raw"\n' +
        '    unit_of_measurement: "V"\n' +
        '    attenuation: 11db\n' +
        '    update_interval: ' + f.update_interval + '\n' +
        plTele(s, dnid + '_air_quality_raw', '%.3f') +
        '\nbinary_sensor:\n' +
        '  - platform: template\n' +
        '    name: "' + f._dn + ' Air Quality Alert"\n' +
        '    id: ' + dnid + '_air_alert\n' +
        '    device_class: smoke\n' +
        '    lambda: |-\n' +
        '      return id(' + dnid + '_air_quality_raw).state > 1.8;\n' +
        plTeleBin(s, dnid + '_air_alert');
    }
  },
  // ── Display ────────────────────────────────────────────────────────────
  {
    id: 'ssd1306', name: 'SSD1306 OLED Display (I2C)', category: 'Display',
    icon: '🖥️', description: '128x64 OLED local status display',
    fields: [
      { id: 'sda', label: 'SDA Pin', type: 'number', default: 21 },
      { id: 'scl', label: 'SCL Pin', type: 'number', default: 22 },
      { id: 'address', label: 'I2C Address (hex)', type: 'text', default: '0x3C' }
    ],
    generate: function(c, f) {
      return c + 'i2c:\n  sda: ' + f.sda + '\n  scl: ' + f.scl + '\n\n' +
        'font:\n' +
        '  - file: "gfonts://Roboto"\n' +
        '    id: roboto\n' +
        '    size: 14\n\n' +
        'display:\n' +
        '  - platform: ssd1306_i2c\n' +
        '    model: "SSD1306 128x64"\n' +
        '    address: ' + f.address + '\n' +
        '    lambda: |-\n' +
        '      it.print(0, 0, id(roboto), "' + f._dn + '");\n' +
        '      it.print(0, 20, id(roboto), "Online");\n';
    }
  },
  // ── Misc ───────────────────────────────────────────────────────────────
  {
    id: 'hx711', name: 'HX711 Load Cell / Weight', category: 'Misc',
    icon: '⚖️', description: '24-bit ADC for load cells — weight measurement',
    fields: [
      { id: 'dout_pin', label: 'DOUT Pin', type: 'number', default: 3 },
      { id: 'clk_pin', label: 'CLK Pin', type: 'number', default: 2 },
      { id: 'update_interval', label: 'Update Interval', type: 'text', default: '1s' }
    ],
    generate: function(c, f) {
      var s = safePlName(f._dn);
      return c + 'sensor:\n' +
        '  - platform: hx711\n' +
        '    name: "' + f._dn + ' Weight"\n' +
        '    id: ' + s + '_weight\n' +
        '    dout_pin: GPIO' + f.dout_pin + '\n' +
        '    clk_pin: GPIO' + f.clk_pin + '\n' +
        '    gain: 128\n' +
        '    update_interval: ' + f.update_interval + '\n' +
        '    unit_of_measurement: kg\n' +
        '    filters:\n' +
        '      - calibrate_linear:\n' +
        '        - 0 -> 0\n' +
        '        - 430000 -> 1.0\n' +
        '      - delta: 0.01\n' +
        plTele(s, s + '_weight', '%.3f');
    }
  },
  {
    id: 'rotary_encoder', name: 'Rotary Encoder', category: 'Misc',
    icon: '🎛️', description: 'Rotary encoder for manual input / volume / dimmer',
    fields: [
      { id: 'pin_a', label: 'Pin A', type: 'number', default: 18 },
      { id: 'pin_b', label: 'Pin B', type: 'number', default: 19 },
      { id: 'pin_btn', label: 'Button Pin', type: 'number', default: 23 }
    ],
    generate: function(c, f) {
      var s = safePlName(f._dn);
      return c + 'sensor:\n' +
        '  - platform: rotary_encoder\n' +
        '    name: "' + f._dn + ' Position"\n' +
        '    id: ' + s + '_position\n' +
        '    pin_a: GPIO' + f.pin_a + '\n' +
        '    pin_b: GPIO' + f.pin_b + '\n' +
        '    resolution: 1\n' +
        plTele(s, s + '_position', '%d') +
        '\nbinary_sensor:\n' +
        '  - platform: gpio\n' +
        '    pin:\n' +
        '      number: GPIO' + f.pin_btn + '\n' +
        '      mode: INPUT_PULLUP\n' +
        '      inverted: true\n' +
        '    name: "' + f._dn + ' Button"\n' +
        '    id: ' + s + '_btn\n' +
        plTeleBin(s, s + '_btn');
    }
  }
];

var plSelectedTemplate = null;

function safePlName(name) {
  return String(name||'').toLowerCase().replace(/[^a-z0-9]/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,'');
}

// Generates on_value mqtt.publish block (4-space indent for sensor sub-key)
function plTele(sname, key, fmt, indent) {
  var pad = indent || '    ';
  return pad + 'on_value:\n' +
    pad + '  - mqtt.publish:\n' +
    pad + '      topic: "elaris/' + sname + '/tele/' + key + '"\n' +
    pad + '      payload: !lambda |-\n' +
    pad + '        return str_sprintf("' + (fmt||'%.2f') + '", x);\n';
}

// Generates on_state mqtt.publish block for binary_sensor
function plTeleBin(sname, key) {
  return '    on_state:\n' +
    '      - mqtt.publish:\n' +
    '          topic: "elaris/' + sname + '/tele/' + key + '"\n' +
    '          payload: !lambda |-\n' +
    '            return x ? "ON" : "OFF";\n';
}

function plCommonHeader(deviceName, wifiSsid, wifiPassword, mqttBroker) {
  var sname = safePlName(deviceName);
  var cfgPayload = JSON.stringify({
    device: { name: deviceName, hostname: sname, model: 'ELARIS Peripheral', sw: '1.0.0' },
    capabilities: {},
  }).replace(/'/g, "''");
  return 'esphome:\n' +
    '  name: ' + sname + '\n' +
    '  friendly_name: "' + deviceName + '"\n\n' +
    'esp32:\n' +
    '  board: esp32dev\n' +
    '  framework:\n' +
    '    type: arduino\n\n' +
    'logger:\n\n' +
    'ota:\n' +
    '  - platform: esphome\n\n' +
    'wifi:\n' +
    '  ssid: "' + wifiSsid + '"\n' +
    '  password: "' + wifiPassword + '"\n\n' +
    'mqtt:\n' +
    '  broker: ' + mqttBroker + '\n' +
    '  port: 1883\n' +
    '  discovery: false\n' +
    '  on_connect:\n' +
    '    then:\n' +
    '      - mqtt.publish:\n' +
    '          topic: "elaris/' + sname + '/config"\n' +
    "          payload: '" + cfgPayload + "'\n" +
    '          retain: true\n\n';
}

function plBuildSensorList() {
  var el = document.getElementById('plSensorList');
  if (!el) return;
  var categories = {};
  PL_TEMPLATES.forEach(function(t) {
    if (!categories[t.category]) categories[t.category] = [];
    categories[t.category].push(t);
  });

  el.replaceChildren();
  Object.keys(categories).forEach(function(cat) {
    var head = document.createElement('div');
    head.style.cssText = 'padding:6px 10px 2px;font-size:10px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;border-top:1px solid var(--line)';
    head.textContent = cat;
    el.appendChild(head);

    categories[cat].forEach(function(t) {
      var row = document.createElement('div');
      row.className = 'pl-sensor-item';
      row.dataset.id = t.id;
      row.style.cssText = 'padding:8px 12px;cursor:pointer;font-size:12px;border-bottom:1px solid rgba(255,255,255,.04);display:flex;align-items:center;gap:6px';
      row.addEventListener('click', function() { plSelectSensor(t.id); });

      var icon = document.createElement('span');
      icon.textContent = t.icon;
      var name = document.createElement('span');
      name.textContent = t.name;
      row.append(icon, name);
      el.appendChild(row);
    });
  });
}

window.plSelectSensor = function(id) {
  plSelectedTemplate = PL_TEMPLATES.find(function(t) { return t.id === id; });
  if (!plSelectedTemplate) return;

  // Highlight selected item
  document.querySelectorAll('.pl-sensor-item').forEach(function(el) {
    el.style.background = el.dataset.id === id ? 'rgba(29,140,255,.15)' : '';
    el.style.color = el.dataset.id === id ? 'var(--blue)' : '';
  });

  // Build sensor-specific fields
  var fieldsWrap = document.getElementById('plSensorFields');
  fieldsWrap.replaceChildren();
  plSelectedTemplate.fields.forEach(function(f) {
    var row = document.createElement('div');
    row.className = 'form-row';

    var label = document.createElement('label');
    label.textContent = f.label;

    var input = document.createElement('input');
    input.type = f.type;
    input.id = 'plf_' + f.id;
    input.value = f.default;

    row.append(label, input);
    fieldsWrap.appendChild(row);
  });
  document.getElementById('plSensorTitle').textContent = plSelectedTemplate.icon + ' ' + plSelectedTemplate.name;
  document.getElementById('plFormArea').style.display = '';
  document.getElementById('plYamlArea').style.display = 'none';
  document.getElementById('plYamlOutput').value = '';
};

window.plGenerateYaml = function() {
  if (!plSelectedTemplate) return;
  var deviceName = document.getElementById('plDeviceName').value.trim() || 'my-sensor';
  var mqttBroker = document.getElementById('plMqttBroker').value.trim() || '192.168.1.x';
  var wifiSsid = document.getElementById('plWifiSsid').value.trim();
  var wifiPassword = document.getElementById('plWifiPassword').value.trim();
  var fields = {};
  plSelectedTemplate.fields.forEach(function(f) {
    var el = document.getElementById('plf_' + f.id);
    fields[f.id] = el ? el.value : f.default;
  });
  fields._dn = deviceName;
  var header = plCommonHeader(deviceName, wifiSsid, wifiPassword, mqttBroker);
  var yaml = plSelectedTemplate.generate(header, fields);
  document.getElementById('plYamlOutput').value = yaml;
  document.getElementById('plYamlArea').style.display = 'flex';
  document.getElementById('plYamlArea').style.flexDirection = 'column';
};

window.plCopyYaml = function() {
  var val = document.getElementById('plYamlOutput').value;
  if (!val) return;
  navigator.clipboard.writeText(val).then(function() {
    alert('YAML copied to clipboard!');
  }).catch(function() {
    alert('Copy failed — please select and copy manually.');
  });
};

window.plDownloadYaml = function() {
  var val = document.getElementById('plYamlOutput').value;
  if (!val) return;
  var deviceName = document.getElementById('plDeviceName').value.trim() || 'my-sensor';
  var blob = new Blob([val], { type: 'text/yaml' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = deviceName + '.yaml';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

window.togglePeripheralLibrary = function() {
  var panel = document.getElementById('peripheralLibraryPanel');
  var showing = panel.style.display !== 'none';
  panel.style.display = showing ? 'none' : '';
  if (!showing) plBuildSensorList();
};

})();
