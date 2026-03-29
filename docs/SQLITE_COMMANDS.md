# ELARIS SQLite Debug Commands

Useful queries for debugging ELARIS. The database file is at `data/elaris.db`.

## Connect

```bash
# Linux / Raspberry Pi
sqlite3 data/elaris.db

# Windows (from project root)
sqlite3.exe data/elaris.db
```

**Tip:** Use `.mode column` and `.headers on` for readable output.

---

## Users & Auth

```sql
-- List all users
SELECT id, email, name, active,
  datetime(created_ts/1000, 'unixepoch') AS created,
  datetime(last_login/1000, 'unixepoch') AS last_login
FROM users;

-- Active sessions
SELECT s.token, u.email, u.name,
  datetime(s.created_ts/1000, 'unixepoch') AS created,
  datetime(s.expires_ts/1000, 'unixepoch') AS expires,
  s.ip
FROM user_sessions s
JOIN users u ON u.id = s.user_id
ORDER BY s.created_ts DESC;

-- Expired sessions (cleanup candidates)
SELECT COUNT(*) AS expired_sessions
FROM user_sessions
WHERE expires_ts < (strftime('%s','now') * 1000);

-- Delete expired sessions
DELETE FROM user_sessions
WHERE expires_ts < (strftime('%s','now') * 1000);

-- OAuth linked accounts
SELECT o.provider, o.email, u.name
FROM user_oauth o
JOIN users u ON u.id = o.user_id;

-- Reset a user's password (use the recover-admin script instead)
-- npm run recover-admin
```

---

## Devices

```sql
-- All devices with last seen
SELECT id, name,
  datetime(last_seen/1000, 'unixepoch') AS last_seen
FROM devices
ORDER BY last_seen DESC;

-- Devices per site
SELECT d.id, d.name, s.name AS site,
  datetime(d.last_seen/1000, 'unixepoch') AS last_seen
FROM devices d
JOIN device_site ds ON ds.device_id = d.id
JOIN sites s ON s.id = ds.site_id
ORDER BY s.name, d.name;

-- Devices not seen in last hour
SELECT id, name,
  datetime(last_seen/1000, 'unixepoch') AS last_seen
FROM devices
WHERE last_seen < (strftime('%s','now') * 1000 - 3600000);

-- Current device state (all keys)
SELECT device_id, key, value,
  datetime(ts/1000, 'unixepoch') AS updated
FROM device_state
WHERE device_id = 'YOUR_DEVICE_ID'
ORDER BY key;
```

---

## IOs (Inputs/Outputs)

```sql
-- All approved IOs
SELECT id, device_id, key, type, name, unit, enabled
FROM io
ORDER BY device_id, key;

-- IOs for a specific device
SELECT id, key, type, name, unit, enabled, stale
FROM io
WHERE device_id = 'YOUR_DEVICE_ID';

-- Pending IOs (waiting for approval)
SELECT device_id, key, group_name, last_value,
  datetime(first_seen/1000, 'unixepoch') AS first_seen,
  datetime(last_seen/1000, 'unixepoch') AS last_seen
FROM pending_io
ORDER BY last_seen DESC;

-- Blocked IOs
SELECT device_id, key, reason,
  datetime(created_ts/1000, 'unixepoch') AS blocked_at
FROM blocked_io;

-- Stale IOs (no recent data)
SELECT id, device_id, key, name
FROM io
WHERE stale = 1 AND enabled = 1;

-- IO override (force/hold) status
SELECT o.io_id, i.name, o.value, o.active,
  datetime(o.ts/1000, 'unixepoch') AS set_at,
  datetime(o.expires_at/1000, 'unixepoch') AS expires
FROM io_runtime_overrides o
JOIN io i ON i.id = o.io_id
WHERE o.active = 1;
```

---

## Modules

```sql
-- All module instances
SELECT m.id, m.module_id, m.name, m.active, s.name AS site,
  datetime(m.created_ts/1000, 'unixepoch') AS created
FROM module_instances m
JOIN sites s ON s.id = m.site_id
ORDER BY s.name, m.module_id;

-- Module IO mappings
SELECT m.name AS module, mm.input_key, i.device_id, i.key AS io_key, i.name AS io_name
FROM module_mappings mm
JOIN module_instances m ON m.id = mm.instance_id
JOIN io i ON i.id = mm.io_id
ORDER BY m.name, mm.input_key;

-- Paused modules
SELECT m.name, m.module_id,
  datetime(o.ts/1000, 'unixepoch') AS paused_at
FROM module_runtime_overrides o
JOIN module_instances m ON m.id = o.instance_id
WHERE o.paused = 1;

-- Module config (JSON)
SELECT id, module_id, name, config
FROM module_instances
WHERE id = YOUR_INSTANCE_ID;
```

---

## Automation Log

```sql
-- Recent automation actions (last 50)
SELECT a.id, m.name AS module, a.action, a.reason,
  datetime(a.ts/1000, 'unixepoch') AS time
FROM automation_log a
JOIN module_instances m ON m.id = a.instance_id
ORDER BY a.ts DESC
LIMIT 50;

-- Actions for a specific module
SELECT action, reason,
  datetime(ts/1000, 'unixepoch') AS time
FROM automation_log
WHERE instance_id = YOUR_INSTANCE_ID
ORDER BY ts DESC
LIMIT 20;

-- Action counts per module (last 24h)
SELECT m.name, m.module_id, COUNT(*) AS actions
FROM automation_log a
JOIN module_instances m ON m.id = a.instance_id
WHERE a.ts > (strftime('%s','now') * 1000 - 86400000)
GROUP BY a.instance_id
ORDER BY actions DESC;
```

---

## Events & History

```sql
-- Recent raw events (last 20)
SELECT device_id, topic, payload,
  datetime(ts/1000, 'unixepoch') AS time
FROM events
ORDER BY ts DESC
LIMIT 20;

-- Events for a device (last hour)
SELECT topic, payload,
  datetime(ts/1000, 'unixepoch') AS time
FROM events
WHERE device_id = 'YOUR_DEVICE_ID'
  AND ts > (strftime('%s','now') * 1000 - 3600000)
ORDER BY ts DESC;

-- Event count per device (last 24h)
SELECT device_id, COUNT(*) AS events
FROM events
WHERE ts > (strftime('%s','now') * 1000 - 86400000)
GROUP BY device_id
ORDER BY events DESC;

-- History rollup status per IO
SELECT r.io_id, i.name, r.bucket_size, COUNT(*) AS buckets,
  datetime(MIN(r.bucket_start_ts)/1000, 'unixepoch') AS earliest,
  datetime(MAX(r.bucket_start_ts)/1000, 'unixepoch') AS latest
FROM io_history_rollups r
JOIN io i ON i.id = r.io_id
GROUP BY r.io_id, r.bucket_size
ORDER BY r.io_id;

-- Total DB size
SELECT
  (SELECT COUNT(*) FROM events) AS events,
  (SELECT COUNT(*) FROM io_history_rollups) AS rollups,
  (SELECT COUNT(*) FROM automation_log) AS actions;
```

---

## Scenes

```sql
-- All scenes
SELECT id, name, icon, color,
  datetime(created_ts/1000, 'unixepoch') AS created
FROM scenes;

-- Scene activation log
SELECT s.name, l.triggered_by,
  datetime(l.ts/1000, 'unixepoch') AS triggered_at
FROM scene_log l
LEFT JOIN scenes s ON s.id = l.scene_id
ORDER BY l.ts DESC
LIMIT 20;

-- Scene schedules
SELECT s.name, ss.time, ss.days, ss.enabled
FROM scene_schedules ss
JOIN scenes s ON s.id = ss.scene_id;
```

---

## Sites & Zones

```sql
-- All sites
SELECT id, name, timezone, address,
  datetime(created_ts/1000, 'unixepoch') AS created
FROM sites;

-- Zones per site
SELECT z.id, z.name, s.name AS site
FROM zones z
JOIN sites s ON s.id = z.site_id
ORDER BY s.name, z.name;
```

---

## App Settings

```sql
-- All settings
SELECT key, value,
  datetime(updated_ts/1000, 'unixepoch') AS updated
FROM app_settings
ORDER BY key;

-- Check MQTT debug
SELECT value FROM app_settings WHERE key = 'mqtt_debug_enabled';

-- Check stale threshold
SELECT value FROM app_settings WHERE key = 'esphome_stale_threshold_ms';
```

---

## Notifications

```sql
-- Configured channels
SELECT id, name, type, enabled FROM notification_channels;

-- Recent notifications
SELECT n.title, n.body, c.name AS channel,
  datetime(n.ts/1000, 'unixepoch') AS sent_at
FROM notification_log n
LEFT JOIN notification_channels c ON c.id = n.channel_id
ORDER BY n.ts DESC
LIMIT 20;
```

---

## ESPHome

```sql
-- ESPHome devices
SELECT id, name, chip, status, ip_address, mac_address,
  ownership_mode, read_only, last_seen_at
FROM esphome_devices
WHERE deleted_at IS NULL
ORDER BY name;

-- Board profiles
SELECT id, label, platform, board, family
FROM esphome_board_profiles
ORDER BY label;

-- Recent flash jobs
SELECT j.id, d.name, j.job_type, j.status, j.exit_code,
  j.created_at, j.finished_at
FROM esphome_install_jobs j
JOIN esphome_devices d ON d.id = j.esphome_device_id
ORDER BY j.created_at DESC
LIMIT 10;
```

---

## Maintenance

```sql
-- Database file size (run from shell)
-- ls -lh data/elaris.db

-- Vacuum (reclaim space)
VACUUM;

-- Check migrations
SELECT name, datetime(applied_ts/1000, 'unixepoch') AS applied
FROM schema_migrations
ORDER BY applied_ts;

-- Table row counts
SELECT 'devices' AS tbl, COUNT(*) AS rows FROM devices
UNION SELECT 'io', COUNT(*) FROM io
UNION SELECT 'events', COUNT(*) FROM events
UNION SELECT 'automation_log', COUNT(*) FROM automation_log
UNION SELECT 'io_history_rollups', COUNT(*) FROM io_history_rollups
UNION SELECT 'users', COUNT(*) FROM users
UNION SELECT 'user_sessions', COUNT(*) FROM user_sessions
UNION SELECT 'module_instances', COUNT(*) FROM module_instances
ORDER BY tbl;
```
