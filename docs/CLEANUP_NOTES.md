# Cleanup Notes (current build)

## What was cleaned already

- removed old temp packaging artifacts from release zips
- removed obsolete `migrations_001_sites.sql`
- removed obsolete `migrations_002_io_kinds.sql`
- unified current-user payload logic through `src/session_info.js`

## What remains intentionally

- `src/automation/solar.js` still exports legacy helpers alongside `solarEngineHandler` for backward compatibility
- some solar-specific API routes remain because the solar dashboard widget still uses richer status/history behavior than generic modules
- OAuth state is still runtime-only

## Next cleanup candidates

- remove unused legacy solar helper exports after dashboard endpoints fully use generic engine paths
- consolidate any remaining overlapping `/api/me` consumers to one response contract
- normalize manual cache-busting versions in public assets
