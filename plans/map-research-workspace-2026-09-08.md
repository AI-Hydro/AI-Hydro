# Map research workspace — 2026-09-08

User priority: substantial Map work after scientific prerequisites. Work in the existing extension and Python map/runtime contracts; no second workspace store.

## Initial inspection
MapView is 2,656 lines; provider is 1,126 lines. Existing layers, inspectors, probes, exports and metadata are executable code, but need integrated workflow validation. Raw raster availability currently receives an 'Analysis-ready' label; absent source freshness is shown as 'Current'; dataset names substitute for missing citations in the inspector. These claims outrun their evidence.

## First slice: honest layer inspection
Show raw-value capability separately from scientific adequacy. Missing freshness/citation remains unknown; inspector exposes units, recorded validity/uncertainty and run/product identity without manufacturing them. Acceptance: labels do not certify scientific readiness, undeclared freshness cannot become current, identifier is not citation, tests cover unknown/stale/provisional and available-value states; TypeScript passes.

## Subsequent executable slices
1. Layer lifecycle: loading/error/stale states, tile failure propagation, reconnect/reopen behavior; real backend-to-map smoke tests.
2. Scientific inspection: pixel value/unit/nodata/CRS/scale, temporal support, product/version, run/artifact lineage and quality masks from canonical packages.
3. Linked research workflow: basin/time selection linking map, plots, experiments and evidence, retaining study identity and avoiding stale response overwrite.
4. Comparison and uncertainty: aligned layer comparison, common masks/scales, explicit ensemble/range meanings, reproducible legend/export.
5. Interaction and performance: profile actual basin/raster workloads, viewport-bound work, cancellation and responsiveness. Measure before claiming performance gains.

Release gate: reproducible basin/event walkthrough with real persisted artifacts and unknown/error cases; installed extension smoke test and user comprehension review. Prior defects are not all resolved by the first inspection slice.

## First-slice outcome
Implemented initial inspection labels/recorded metadata. Six targeted tests and webview TypeScript passed; no installed runtime or screenshot walkthrough. Next: layer lifecycle failure/reconnect/stale behavior, including authoritative backend state.

## Layer lifecycle continuation
Ordered bootstrap/disposal/reconnect slice implemented locally; see plans/map-stream-lifecycle-2026-09-08.md. Next is raster/tile-level loading, failures and stale sources. Transport readiness must remain separate from render/scientific readiness.

## Execution routing — 2026-09-09
User requests prudent model use after rapid Astra quota depletion. Delegate bounded implementation and tests to gpt-5.6-sol, normally one worker at a time, with a concise brief instead of full-history forks. Briefs must specify file ownership, scientific invariants, acceptance checks and explicit exclusions. Reserve Astra for scientific/architectural decisions and milestone integration review. Do not duplicate implementation or repeat green checks without a changed input or unresolved risk. Current parent remains Astra unless separately switched; no quota-reduction factor is assumed.
