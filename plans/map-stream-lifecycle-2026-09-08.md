# Map stream lifecycle — 2026-09-08

Replace concurrent snapshot-fetch/layer-stream bootstrap with an ordered stream snapshot: start marker, retained layers, complete marker, then buffered live changes. Stage snapshot in the UI; commit only when complete. Cleanup disposes controller listener and suppresses late callbacks. A failed/incomplete connection retains the previous map with an explicit stale-state warning and a reconnect action; timeout prevents indefinite loading. Session ROI uses its initial stream snapshot, not a competing unary read.

Acceptance: old snapshots cannot overwrite live updates; mutations during host snapshot transmission arrive in order; reconnect replaces stale layers including removals; failed refresh preserves previous visible state, late/disposed generations ignored; empty snapshot ready; streams and timeout cleaned up; UI recovery visible. Verify host stream tests, React provider tests and host/webview TypeScript. Tile loading is a separate remaining lifecycle slice; connection readiness does not certify rendered tiles or scientific adequacy.

## Outcome
Implemented ordered host layer/session streams and staged UI initialization with explicit stale/recovery states. Three host and 14 React tests passed, plus both TypeScript checks and formatting/diff checks. Host tests require programmatic Mocha loadFiles under ts-node to avoid CLI ESM discovery for the dynamic module mock. No installed runtime or live tile verification. Cross-stream atomicity and undetected silent disconnects remain limitations.
