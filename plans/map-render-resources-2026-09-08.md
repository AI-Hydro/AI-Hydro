# Map render resources — 2026-09-08

Make raster/tile failures visible and recoverable. Source changes under an existing layer ID must invalidate old raster imagery; obsolete decodes/recolors cannot overwrite newer data. Respect tile cancellation, report HTTP/decode failures, distinguish tile failure from successful empty observations, and retain failure indication until explicit retry. Provide per-resource loading/errors with bounded image decode time and generation-safe retry. No scientific readiness inferred from successful rendering.

Acceptance: tests cover missing/invalid bounds, decode failures, stale decode completion, same-ID source replacement, retry and cancelled/failed tile requests. Real React recovery control tested; host/webview TypeScript and relevant map tests pass. Continue to linked inspection/export/runtime verification after this slice; do not claim complete Map readiness from mocks alone.

## Export follow-through
Known rendering failures must reach export readiness. Bind export capture to its own Map container, freeze the image before the asynchronous destination chooser, and record unverified tile completeness rather than hard-coded basemap readiness. Exports from failed/loading state are blocked for research plates; quick captures remain explicit diagnostic captures with limitations.

## Renderer failure follow-through
Capture synchronous layer-construction errors without setting state during render. Surface asynchronous DeckGL failures and block research export until renderer retry. Retry remounts the renderer; successful construction is not scientific validation. Verify with TypeScript and status-control tests; real WebGL recovery remains a separate acceptance gate.

## Source replacement and cluster inspection
Inspection found equal-count source replacement reusing stale clusters, dropped singleton properties and discarded non-point features in mixed layers. Cache now binds exact source plus integer zoom, retaining at most one zoom per layer and pruning removed layers. Clustering is explicitly display-only; preserve singleton attributes and non-point features, omit uncomputed aggregate measurements. Acceptance: equal-count replacement, removed layers, singleton properties, mixed geometry and aggregate metadata regressions.

## Local verification
54 Map/context tests, host/webview TypeScript, production webview build, scoped Biome lint and diff check passed. Production bundler reports loaders.gl's browser-external spawn warning. Actual MapView browser smoke harness uses controlled synthetic station data and mocked host/provider boundaries; validation in progress. It cannot satisfy the real persisted-event walkthrough gate.

## Browser-discovered dependency repair
The actual StrictMode MapView smoke reproduces luma.gl `device.limits.maxTextureDimension2D` errors. Installed stack mixes deck.gl 9.2.2/9.2.11 and luma.gl 9.2.2/9.2.6. Upstream fixed observer startup before Device initialization (https://github.com/visgl/luma.gl/pull/2540); deck.gl discussion https://github.com/visgl/deck.gl/discussions/9857 confirms the 9.3 line fixes the reported StrictMode issue. Align all direct deck.gl packages to exact 9.3.11 with locked transitive dependencies. Acceptance: StrictMode mount/retry, actual station pixels, PNG/provenance bridge, Map regressions, TypeScript and production build. Do not suppress errors or disable StrictMode.


## 2026-09-08 — Browser and renderer dependency verification complete

All eight direct deck.gl packages are now pinned to 9.3.11; npm resolves a deduplicated luma.gl 9.3.6 graph with peer checks intact. The normal install initially failed against the old renderer graph; regenerated only renderer lock entries in an isolated temporary directory, then installed the resolved lock without force/legacy-peer flags.

`node scripts/map-browser-smoke.mjs` now passes with the real MapView in React StrictMode and Chromium WebGL: injected HTTP failures are visible and block research plates, retry recovers, actual red station pixels render, and PNG composition reaches the mocked host with provenance and unverified completeness recorded. Host/network data are controlled synthetic fixtures, not live provider or filesystem persistence validation. The script closes its browser/server. Screenshot inspected at `/tmp/aihydro-map-smoke.png`; initial invalid PNG fixture and premature recovery assertion were corrected before the final pass.

Post-upgrade: all 54 Map/context tests passed, webview TypeScript passed, production build passed (7,784.16 kB reported JS asset; not a runtime performance benchmark), dependency peer tree and diff check passed. Host TypeScript passed earlier in this slice. No installed VSIX rebuild/install/restart, real persisted-study roundtrip, or scientific accuracy certification.

Remaining: actual provider/retained-study walkthrough, source-revision verification, tile coverage/completion, scientific comparison alignment and masks, linked study selection, measured large-workload responsiveness and comprehension. Export remains a captured frame with explicit limitations.
