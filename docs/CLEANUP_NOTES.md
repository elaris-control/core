# Cleanup Notes (current build)

## What was cleaned already

- removed old temp packaging artifacts from release zips
- removed obsolete `migrations_001_sites.sql`
- removed obsolete `migrations_002_io_kinds.sql`
- unified current-user payload logic through `src/session_info.js`
- unified modern automation modules on the engine-owned dry-run path
- expanded module-level logic tests across the core automation set

## Dry-run / test refactor status

### Completed

- engine-level dry-run intercept / logging / broadcast path lives in `src/automation/engine.js`
- standard `test_mode` injection lives in `src/modules/common.js`
- registry normalization lives in `src/modules/index.js`
- modern module handlers aligned to engine dry-run behavior:
  - `thermostat`
  - `solar_v2`
  - `irrigation`
  - `water_manager`
  - `custom`
  - `energy`
  - `maintenance`
  - `load_shifter`
  - `presence_simulator`
  - `hydronic_manager`
- wrapper-only modules already cleaned in this repo state:
  - `awning`
  - `lighting`
  - `smart_lighting`
  - `pool_spa`

### Current test coverage

The project currently includes passing tests for:

- `tests/unit/engine.dry-mode.test.js`
- `tests/unit/modules.common.test.js`
- `tests/unit/thermostat.logic.test.js`
- `tests/integration/thermostat.engine-dry-mode.test.js`
- `tests/unit/solar_v2.logic.test.js`
- `tests/unit/irrigation.logic.test.js`
- `tests/unit/water_manager.logic.test.js`
- `tests/unit/hydronic_manager.logic.test.js`
- `tests/unit/custom.logic.test.js`

Current result:
- **79 passing tests**

### Legacy / compatibility note

- `src/automation/solar.js` is kept as a deprecated compatibility path for now
- the active Solar application path uses `src/modules/solar.js` → `src/automation/solar_v2.js`
- some solar-specific API routes remain because the solar dashboard widget still uses richer status/history behavior than generic modules

## What remains intentionally

- OAuth state is still runtime-only

## Next cleanup candidates

- remove unused legacy `src/automation/solar.js` helper exports after one more conservative deprecation window
- consolidate any remaining overlapping `/api/me` consumers to one response contract
- normalize manual cache-busting versions in public assets
- add more edge-case tests for `custom` PID / feedback / lock escalation and deeper hydronic mixing/cascade cases
