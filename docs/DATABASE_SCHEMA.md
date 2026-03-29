# ELARIS Database Schema

SQLite database managed by `better-sqlite3`. All tables are created on first run in `src/db.js` and `src/users.js`.

---

## Core Tables

### devices
Device registry — every MQTT device that has announced itself.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | Device ID (from MQTT announce) |
| name | TEXT | Friendly name |
| last_seen | INTEGER | Unix timestamp of last message |

### device_state
Cached current values for each device key (sensor reading, relay state, etc).

| Column | Type | Description |
|--------|------|-------------|
| device_id | TEXT | FK → devices.id |
| key | TEXT | IO key (e.g. `relay_1`, `ht_1`) |
| value | TEXT | Current value |
| ts | INTEGER | Last update timestamp |

PK: `(device_id, key)`

### device_site
Maps devices to sites.

| Column | Type | Description |
|--------|------|-------------|
| device_id | TEXT PK | FK → devices.id |
| site_id | INTEGER | FK → sites.id |
| assigned_ts | INTEGER | When assigned |

### io
Approved Input/Output entities — sensors, relays, dimmers, etc.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| device_id | TEXT | Parent device |
| key | TEXT | IO key (e.g. `relay_1`) |
| group_name | TEXT | Group (e.g. `switch`, `sensor`) |
| type | TEXT | `sensor`, `relay`, `analog`, `dimmer`, `ao`, `ai`, `di` |
| name | TEXT | Friendly name |
| zone_id | INTEGER | FK → zones.id |
| enabled | INTEGER | 1 = active |
| stale | INTEGER | 1 = no recent data |
| hw_type | TEXT | Hardware type hint |
| kind | TEXT | Sub-classification |
| unit | TEXT | Unit string (°C, %, lux, etc.) |
| device_class | TEXT | Device class hint |
| pinned | INTEGER | 1 = pinned to dashboard |
| source | TEXT | Origin (discovery, manual, etc.) |
| port_id | TEXT | Physical port reference |
| bus_id | TEXT | Bus reference |
| board_profile_id | TEXT | FK → esphome_board_profiles.id |
| created_ts | INTEGER | Creation timestamp |

UNIQUE: `(device_id, group_name, key)`

### pending_io
Discovered but not yet approved IO entities.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| device_id | TEXT | Parent device |
| key | TEXT | IO key |
| group_name | TEXT | Group |
| first_seen | INTEGER | First discovery timestamp |
| last_seen | INTEGER | Last seen timestamp |
| last_value | TEXT | Most recent value |
| site_id | INTEGER | FK → sites.id |

### blocked_io
Explicitly blocked IO entities (hidden from approval).

| Column | Type | Description |
|--------|------|-------------|
| device_id | TEXT | Device |
| group_name | TEXT | Group |
| key | TEXT | IO key |
| created_ts | INTEGER | When blocked |
| reason | TEXT | Why blocked |
| hidden | INTEGER | 1 = hidden from UI |

PK: `(device_id, group_name, key)`

### events
Raw MQTT event log — every state change and telemetry message.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| device_id | TEXT | Source device |
| topic | TEXT | Full MQTT topic |
| payload | TEXT | Message payload |
| ts | INTEGER | Timestamp |

### io_history_rollups
Pre-aggregated time-series data for history charts.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| io_id | INTEGER | FK → io.id |
| bucket_start_ts | INTEGER | Bucket start timestamp |
| bucket_size | TEXT | `5min`, `1hour`, `1day` |
| min_value | REAL | Min in bucket |
| max_value | REAL | Max in bucket |
| avg_value | REAL | Average in bucket |
| last_value | REAL | Last value in bucket |
| sample_count | INTEGER | Number of samples |
| created_ts | INTEGER | When created |

UNIQUE: `(io_id, bucket_start_ts, bucket_size)`

---

## Sites & Zones

### sites
Multi-site support — each site is an independent location.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| name | TEXT | Site name (unique) |
| note | TEXT | Description |
| is_private | INTEGER | 1 = private site |
| lat | TEXT | Latitude |
| lon | TEXT | Longitude |
| timezone | TEXT | Timezone string |
| address | TEXT | Physical address |
| created_ts | INTEGER | Creation timestamp |

### zones
Logical groupings within a site (rooms, floors, areas).

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| name | TEXT | Zone name |
| site_id | INTEGER | FK → sites.id |

---

## Users & Authentication

### users
User accounts.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| email | TEXT | Email (unique) |
| name | TEXT | Display name |
| password_hash | TEXT | Hashed password |
| password_salt | TEXT | Salt |
| active | INTEGER | 1 = active account |
| created_ts | INTEGER | Creation timestamp |
| last_login | INTEGER | Last login timestamp |

### user_sessions
Active login sessions (cookie-based).

| Column | Type | Description |
|--------|------|-------------|
| token | TEXT PK | Session token |
| user_id | INTEGER | FK → users.id |
| created_ts | INTEGER | Session start |
| expires_ts | INTEGER | Expiry timestamp |
| ip | TEXT | Client IP |

### user_oauth
OAuth provider linkages (Google, etc).

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| user_id | INTEGER | FK → users.id |
| provider | TEXT | Provider name |
| provider_id | TEXT | Provider user ID |
| email | TEXT | Provider email |
| created_ts | INTEGER | When linked |

UNIQUE: `(provider, provider_id)`

---

## Automation

### module_instances
Running automation module instances (one per module per site).

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| site_id | INTEGER | FK → sites.id |
| module_id | TEXT | Module type (e.g. `lighting`, `thermostat`) |
| name | TEXT | Instance name |
| active | INTEGER | 1 = enabled |
| config | TEXT | JSON config blob |
| created_ts | INTEGER | Creation timestamp |

### module_mappings
Maps module input keys to IO entities.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| instance_id | INTEGER | FK → module_instances.id |
| input_key | TEXT | Module input (e.g. `pir_sensor`, `light_relay`) |
| io_id | INTEGER | FK → io.id |

UNIQUE: `(instance_id, input_key)`

### module_runtime_overrides
Pause/resume state for module instances (persists across restart).

| Column | Type | Description |
|--------|------|-------------|
| instance_id | INTEGER PK | FK → module_instances.id |
| paused | INTEGER | 1 = paused |
| ts | INTEGER | When changed |

### io_runtime_overrides
Manual force/hold overrides on IO values.

| Column | Type | Description |
|--------|------|-------------|
| io_id | INTEGER PK | FK → io.id |
| value | TEXT | Forced value |
| active | INTEGER | 1 = override active |
| ts | INTEGER | When set |
| expires_at | INTEGER | Auto-expire timestamp |

### automation_log
Action history for all modules.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| instance_id | INTEGER | FK → module_instances.id |
| action | TEXT | Action name (e.g. `Light_PIR_Calling_ON`) |
| reason | TEXT | Why triggered |
| ts | INTEGER | Timestamp |

---

## Scenes

### scenes
Saved multi-device action sequences.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| name | TEXT | Scene name |
| icon | TEXT | Emoji icon |
| color | TEXT | Hex color |
| actions_json | TEXT | JSON array of actions |
| created_ts | INTEGER | Creation timestamp |

### scene_log
Scene activation history.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| scene_id | INTEGER | FK → scenes.id |
| scene_name | TEXT | Scene name at time of trigger |
| triggered_by | TEXT | Who/what triggered |
| ts | INTEGER | Timestamp |

### scene_schedules
Scheduled scene triggers.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| scene_id | INTEGER | FK → scenes.id |
| time | TEXT | Time (HH:MM) |
| days | TEXT | Comma-separated day numbers (1=Mon, 7=Sun) |
| enabled | INTEGER | 1 = active |

---

## Notifications

### notification_channels
Configured notification outputs (email, webhook, etc).

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| name | TEXT | Channel name |
| type | TEXT | Channel type (email, webhook, etc.) |
| config_json | TEXT | JSON configuration |
| enabled | INTEGER | 1 = active |
| created_ts | INTEGER | Creation timestamp |

### notification_log
Sent notification history.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| channel_id | INTEGER | FK → notification_channels.id |
| tag | TEXT | Notification tag/category |
| title | TEXT | Message title |
| body | TEXT | Message body |
| ts | INTEGER | Timestamp |

---

## Navigation

### nav_pages
Custom user dashboard pages.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| user_id | INTEGER | FK → users.id |
| name | TEXT | Page name |
| icon | TEXT | Icon key |
| sort_order | INTEGER | Display order |
| instances_json | TEXT | JSON — module instances shown on this page |
| page_type | TEXT | `custom` or other |
| pinned_home | INTEGER | 1 = show on home |
| featured_home | INTEGER | 1 = featured on home |
| hero_order | INTEGER | Display order on home |
| summary_config | TEXT | JSON summary config |
| created_ts | INTEGER | Creation timestamp |

---

## ESPHome

### esphome_devices
Registry of ESPHome device installations.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| site_id | INTEGER | FK → sites.id |
| name | TEXT | Device name |
| friendly_name | TEXT | Display name |
| board_profile_id | TEXT | FK → esphome_board_profiles.id |
| chip | TEXT | Chip type (ESP32, ESP8266) |
| framework | TEXT | arduino / esp-idf |
| transport | TEXT | wifi / ethernet |
| network_mode | TEXT | Network mode |
| status | TEXT | `new`, `flashed`, `online`, etc. |
| serial_port | TEXT | USB serial port |
| mac_address | TEXT | MAC address |
| ip_address | TEXT | IP address |
| hostname | TEXT | mDNS hostname |
| mqtt_topic_root | TEXT | MQTT topic prefix |
| firmware_version | TEXT | Installed firmware version |
| yaml_path | TEXT | Path to YAML file |
| yaml_hash | TEXT | Hash of YAML content |
| integration_key | TEXT | Default: `esphome` |
| ownership_mode | TEXT | `managed_internal`, `external`, etc. |
| config_source | TEXT | Where config came from |
| read_only | INTEGER | 1 = monitor only |
| encryption_key | TEXT | Native API encryption key |
| last_seen_at | TEXT | Last online timestamp |
| deleted_at | TEXT | Soft-delete timestamp |
| deleted_reason | TEXT | Why deleted |
| created_at | TEXT | Creation timestamp |
| updated_at | TEXT | Last update |

### esphome_board_profiles
Board profile catalog (hardware definitions).

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | Profile ID |
| label | TEXT | Display name |
| platform | TEXT | Platform (ESP32, ESP8266) |
| board | TEXT | Board identifier |
| framework_default | TEXT | Default framework |
| description | TEXT | Description |
| image_url | TEXT | Image URL |
| family | TEXT | Product family |
| features_json | TEXT | JSON feature flags |
| created_at | TEXT | Creation timestamp |
| updated_at | TEXT | Last update |
| last_seeded_at | TEXT | Last seed from defaults |

### esphome_profile_capabilities
Capability matrix for board profiles.

| Column | Type | Description |
|--------|------|-------------|
| profile_id | TEXT | FK → esphome_board_profiles.id |
| capability_key | TEXT | Capability (relay, di, ai, etc.) |
| channel_count | INTEGER | Number of channels |
| meta_json | TEXT | Additional metadata |

PK: `(profile_id, capability_key)`

### esphome_generated_configs
Generated YAML configurations.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| esphome_device_id | INTEGER | FK → esphome_devices.id |
| config_mode | TEXT | Config type |
| board_profile_id | TEXT | Board profile used |
| yaml_text | TEXT | Full YAML content |
| yaml_hash | TEXT | Content hash |
| validation_json | TEXT | Validation result |
| integration_key | TEXT | Default: `esphome` |
| ownership_mode | TEXT | Ownership mode |
| config_source | TEXT | Config origin |
| read_only | INTEGER | 1 = read only |
| generated_by | TEXT | Generator ID |
| created_at | TEXT | Creation timestamp |

### esphome_install_jobs
Flash/install job queue.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| esphome_device_id | INTEGER | FK → esphome_devices.id |
| config_id | INTEGER | FK → esphome_generated_configs.id |
| job_type | TEXT | `flash_usb`, `flash_ota`, etc. |
| target_port | TEXT | USB port |
| target_ip | TEXT | OTA target IP |
| status | TEXT | `queued`, `running`, `done`, `error` |
| started_at | TEXT | Start timestamp |
| finished_at | TEXT | End timestamp |
| exit_code | INTEGER | Process exit code |
| output_log | TEXT | Full output |
| error_text | TEXT | Error message |
| created_at | TEXT | Creation timestamp |

### esphome_device_overrides
Per-device configuration overrides.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| esphome_device_id | INTEGER | FK → esphome_devices.id |
| override_key | TEXT | Setting key |
| override_value | TEXT | Setting value |
| created_at | TEXT | Creation timestamp |
| updated_at | TEXT | Last update |

UNIQUE: `(esphome_device_id, override_key)`

---

## System

### app_settings
Global key-value configuration store.

| Column | Type | Description |
|--------|------|-------------|
| key | TEXT PK | Setting key |
| value | TEXT | Setting value |
| updated_ts | INTEGER | Last update |

### schema_migrations
Tracks applied database migrations.

| Column | Type | Description |
|--------|------|-------------|
| name | TEXT PK | Migration name |
| applied_ts | INTEGER | When applied |
