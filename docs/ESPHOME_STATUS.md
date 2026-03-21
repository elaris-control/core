# ESPHome Status Checkpoint

This note summarizes the current ESPHome status in ELARIS after the latest offline testing pass.

---

## What is now tested

### Core adapter / helper layer

Covered by tests:
- `tests/unit/esphome.adapter.test.js`
- `tests/unit/esphome.helpers.test.js`
- `tests/unit/esphome.native-import.test.js`
- `tests/unit/esphome.generator.test.js`
- `tests/unit/esphome.validator.test.js`
- `tests/unit/esphome.yaml-importer.test.js`

What this means:
- adapter capabilities and ownership defaults are covered
- local ESPHome binary / venv detection is covered
- native import payload normalization is covered
- YAML generation / override logic is covered
- validator behavior for supported vs unsupported shared-pin patterns is covered
- importer shape is covered at least for current common YAML parsing paths

---

### Route / installer-adjacent layer

Covered by tests:
- `tests/unit/esphome.catalog-routes.test.js`
- `tests/unit/esphome.device-routes.test.js`
- `tests/unit/esphome.peripheral-preview-routes.test.js`

What this means:
- `/api/esphome/check` is covered
- `/api/esphome/catalog/parse-yaml` is covered
- `/api/esphome/add-peripheral-to-draft` is covered
- `/api/esphome/validate` is covered for:
  - failure when `board_profile_id` is not catalog-backed
  - success when `board_profile_id` resolves from catalog/DB
- saved config routes are covered
- device YAML read route is covered
- peripheral preview add/edit flows are covered

Important confirmed behavior:
- `/api/esphome/validate` does **not** use an inline profile object as source of truth
- it expects `board_profile_id` that resolves through the catalog/DB path

---

### Native live / client layer

Covered by tests:
- `tests/unit/esphome.native-live.test.js`
- `tests/unit/esphome.native-client.test.js`

What this means:
- runtime payload merge against existing device records is covered
- TCP reachability probe behavior is covered
- profile-assisted entity discovery is covered
- sync handoff into native import step is covered
- native client connect flow is covered with mocked client module
- native client fallback mode is covered when `esphome-client` is unavailable
- native client command execution is covered for representative command types

Important confirmed behavior:
- `syncNativeAssist()` returns the **import-step summary**, not the raw discovery payload
- native command execution depends on resolved live entities from the connected session

---

## Current tested result

Current suite result after this pass:
- **20 test files passed**
- **74 tests passed**

---

## What remains unverified / weaker

### 1. Real ESPHome binary / flash execution
Not fully verified offline:
- actual `esphome run` execution
- USB/serial flashing
- OTA flashing
- install job execution against a real device

Reason:
- this needs a real ESPHome binary / venv plus a real device or target environment

### 2. Real authenticated browser flows
Not fully verified here:
- full engineer-authenticated UI workflow
- browser interaction path across all ESPHome pages
- end-to-end installer UI behavior

Reason:
- current work focused on route contracts and offline logic coverage, not full browser automation

### 3. Real native hardware / real network behavior
Not fully verified offline:
- real ESPHome native API session against a real device
- real entity stream timing and reconnect behavior
- real encrypted API / Noise behavior against actual device firmware

Reason:
- current tests cover logic and contracts, not live device behavior

### 4. Flash / install mutation routes
Still lighter coverage than the preview side:
- add/edit/remove with actual flash runner path
- install jobs, rollback on failed flash, streamed logs, ws notifications

Reason:
- these are much closer to real binary + real device orchestration

---

## Practical conclusion

ESPHome in ELARIS is now in a much better state from a code-quality and regression perspective.

### Strong offline confidence now exists for:
- adapter wiring
- YAML/config generation and validation
- importer/import normalization
- installer-adjacent route behavior
- native live helper behavior
- native client session/command behavior

### What still needs real environment confidence:
- real flash/install execution
- real device/native session behavior
- real authenticated UI path

---

## Suggested next steps (when desired)

### Highest-value real-world checks
1. verify ESPHome toolchain install (`esphome` binary / local venv)
2. run one real preview → flash flow on a non-critical test board
3. verify one real native API device session
4. verify one engineer-authenticated browser path end-to-end

### Highest-value remaining code tests
1. flash/install job route tests with heavier mocking
2. websocket/log streaming tests around install jobs
3. more importer coverage for richer bus / multi-entity YAML cases

---

## Short summary

- ESPHome is **not fully end-to-end proven** without real hardware/toolchain
- ESPHome **is now well-covered offline** across helper, route, and native runtime layers
- current checkpoint: **79 passing tests**
