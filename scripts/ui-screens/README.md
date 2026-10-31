# UI screen harness

`node scripts/ui-screens/run.mjs` renders every registered screen (`webview-ui/src/screens/registry.tsx`) over
synthetic FIXTURE data in headless Chromium, runs the built-in checker (missing accessible names, sub-24 px targets,
sub-11 px text, contrast) and writes PNGs, `index.html` and `summary.json`. Dev-only; nothing ships in the VSIX.

## Offline guarantee

Only the harness server's own origin (exact host and port, plus its `ws:` twin) is local. Every other `http(s)`
request is answered from fixtures. The run fails ("unrouted") on a non-local response that did not come from the
harness, a non-local `requestfailed`, or any non-local WebSocket.

`externalRoutedRequests` in `summary.json` counts the external requests the harness *answered from fixtures* (tiles get a generated PNG, anything else a 404): a large number there is the harness working, not traffic leaving. A cancelled tile (`net::ERR_ABORTED`, from a pan, an unmount or page teardown, including one cancelled before the router was handed it) is not an escape: it delivers no response, and a live response would still fail the run.

## Map chrome coverage

Every `map` screen that renders the map chrome (`[data-map-chrome-root]`) is checked against the coverage budget in
`map-polish.md` §4.3: the union of the `[data-map-chrome]` boxes (rail, collapsed button, edge tab, panel), clipped to
the canvas, divided by the canvas area. A docked panel and the rail own their own columns, so they cover 0%.

| State | Limit |
|---|---|
| panel closed, map >= 800 px | 6% |
| panel closed, map < 800 px | 3% |
| panel open, docked | 0% (0.1% for rounding) |
| panel open, overlay | 40% |
| panel open, bottom sheet | 60% |

Panels the user resizes (`PanelResizer.tsx`, sizes in `panelSizes.ts`) keep these rows true at every size, not only at the
default: a floating panel is clamped so its width times its height never exceeds 40% of the canvas (`clampOverlay`), a
docked panel always leaves the canvas 360 px, and a stored size is re-clamped against the current map on every use. The
`coverage.mjs` limits are unchanged. The `map-panel-docked-resized`, `map-panel-overlay-resized` and
`map-panel-resize-keyboard` screens measure resized panels; a resize needs a drag, so a screen starts from a saved size
(`framedWorkspace(..., { panelSizes })`) or from the keyboard (`{ press: "Shift+ArrowLeft" }` on a focused separator).

Menus (`data-map-chrome="menu"`) and modal sheets (`data-map-chrome="modal"`) are transient and not counted.
The rule measures the tool chrome only: in-canvas overlays (legend, feature identifier, bottom bar, claim chip,
empty-state card, drag overlay) carry no `data-map-chrome` attribute and are not counted, so a screen can pass while
one of them covers the map. The rule
is in `coverage.mjs`; `coverage.selftest.mjs` runs it on synthetic boxes (`npm run ui:screens:selftest`). A run fails
with `ASSERT chrome covers ...` and records the measured ratio per cell in `summary.json` (`chromeCoverage`).

A step may be `{ contextClick: selector, at?: [x, y] }`: a right-click, optionally at an offset inside the element (the map's
context menu).

A step may be `{ click, optional: true }`: it is skipped when the control is absent. Map screens use it to open the same
tool through a rail button (800 px and up) or the collapsed "Map tools" menu (below 600 px).

## Sharding (CI)

The CI matrix (about 120 screens, 700+ cells) does not fit one job's time limit, so `.github/workflows/ui-screens.yml`
splits the render step over `SHARD_COUNT` (4) parallel jobs.

- `--shard i/n` (1-based) renders and checks only one slice of the registry: screens sorted by id, then every n-th
  starting at i. Slices are disjoint and exhaustive, differ in size by at most one screen, and do not depend on
  registry order. Each shard logs its screen ids and writes `<out>/shard.json` (`shard`, `of`, `screens`, `registry`).
- A shard is a full-run check, not a `--screens` subset: the budget must still list exactly the registered screens,
  and `--require-matrix-budget` plus the per-screen and per-matrix budgets apply to every screen in the shard.
- `--list [file]` prints the registered screen ids as JSON (`{"screens": [...]}`) and exits without rendering.
- The one-time steps (budget may only shrink, harness self-test, webview build, bundle guards, registry listing) run
  once in the `guards` job, not per shard.
- The `Screens, budget and bundle guard` job (same name as before the split) `needs` both and fails if any of them
  failed, was cancelled or was skipped. It then runs `check-shard-coverage.mjs`, which compares the independently
  listed registry with the shards' `shard.json` records and fails if a screen was covered by no shard or by two,
  a shard report is missing, the shards disagree on `n`, or the number of reports differs from `SHARD_COUNT`.
  A screen therefore cannot silently fall out of every shard.
- To add capacity, extend the matrix `shard` list and `SHARD_COUNT` together. Partition and coverage logic is
  self-tested without a browser in `shard.selftest.mjs` (`npm run ui:screens:selftest`).

## `--check` and the budget

`webview-ui/screens-baseline/checker-budget.json` holds per-screen counts that may only shrink
(`--write-budget` keeps `min(old, new)`; CI runs `check-budget-monotonic.mjs` against the PR base branch).

`--check` fails when:

- a full run's screen ids differ from the budget's screen ids (rendered but unbudgeted, or budgeted but gone);
- under `--screens`, a requested id/group matches no screen, or a rendered screen has no budget entry;
- a screen's reference cell (dark, 13 px, native width) was not rendered or has no checker result, or its budget
  entry has no `ref`. A missing `ref` is a failure, never a skip;
- any reference or matrix count is above the budget.

### Which cells the budget covers

- `screens[id].ref`: the reference cell, always checked.
- `screens[id].matrixTotal` + `cells`: the full default matrix (4 themes x 5 widths x 2 fonts).
- `subsets[signature].screens[id]`: per-screen totals for a reduced cell set, keyed by the signature
  `themes=...;widths=...;fonts=...;motion=...`. CI renders `dark,hc-light` x `400,800,1280` x `13` and passes
  `--require-matrix-budget`, which fails any screen with no recorded total for exactly that cell set. This is how
  the hc-light cells are gated without committing images.

Record or tighten the CI subset after a UI change that improves counts:

```sh
node scripts/ui-screens/run.mjs --out /tmp/ui-screens --themes dark,hc-light --widths 400,800,1280 \
  --font 13 --write-budget --no-pixel
```

If you change the CI matrix in `.github/workflows/ui-screens.yml`, record the new signature the same way.
