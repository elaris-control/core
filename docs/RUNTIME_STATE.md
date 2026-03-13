# ELARIS runtime state persistence

## Persisted across restart
- User sessions (`user_sessions`)
- Module pause / override state (`module_runtime_overrides`)
- IO force/hold overrides (`io_runtime_overrides`)
- Module settings (`module_settings`)
- Notification channels / logs
- Scenes / scene logs

## Ephemeral (in-memory by design for now)
- OAuth anti-CSRF state map during callback window
- Smart lighting active scenario runtime marker
- Notification cooldown map
- WebSocket client state

## Why this split
- Commissioning-critical force/hold and pause state should survive restart.
- Short-lived flow control / cache-like state stays in memory to keep the design simple.
