# ESPHome Profile Catalog

This project now keeps a **DB-backed board profile catalog** for ESPHome devices.

## Why this exists

We do **not** copy a Home Assistant database into ELARIS.
Instead, we mirror the good ideas:

- one registry for physical devices
- one registry for entities / IO points
- reusable device/profile templates

That matches Home Assistant's device + entity registry split and ESPHome's reusable template/package approach.

## Current catalog source

The catalog is seeded from:

- bundled ELARIS board profiles in `src/esphome/board_profiles/`
- optional JSON overrides in `src/esphome/catalog_profiles/`

At runtime, the rows live in:

- `esphome_board_profiles`
- `esphome_profile_capabilities`

## Tables

### `esphome_board_profiles`
Stores one row per supported board.

Important fields:
- `id`
- `label`
- `platform`
- `board`
- `framework_default`
- `supports_json`
- `notes_json`
- `definition_json`
- `source`
- `source_url`

### `esphome_profile_capabilities`
Stores normalized capability counts such as:
- relay
- di
- analog
- ds18b20
- dht

## How the installer uses it

The ESPHome installer now reads boards from the catalog instead of a hardcoded runtime-only list.

That means later you can extend the catalog without rewriting the installer flow.

## How to add another board later

### Option A — add a JSON profile
1. Create a JSON file in `src/esphome/catalog_profiles/`
2. Use the demo file as a starting point
3. Run the reseed script

### Option B — import a single JSON file
```bash
node scripts/import_esphome_profile.js path/to/my_board.json
```

### Option C — reseed everything
```bash
node scripts/reseed_esphome_catalog.js
```

## Recommended future data sources

Use these as **sources/templates**, not as something to blindly copy into runtime:

- ESPHome Devices templates / setup guides
- vendor docs / reference YAMLs
- ELARIS-tested board manifests

## Important rule

Never package runtime DB files into deploy zips:
- `data/elaris.db`
- `data/elaris.db-wal`
- `data/elaris.db-shm`

Only ship code/docs/scripts.
