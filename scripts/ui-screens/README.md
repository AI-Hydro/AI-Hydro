# UI screen harness

`node scripts/ui-screens/run.mjs` renders every registered screen (`webview-ui/src/screens/registry.tsx`) over
synthetic FIXTURE data in headless Chromium, runs the built-in checker (missing accessible names, sub-24 px targets,
sub-11 px text, contrast) and writes PNGs, `index.html` and `summary.json`. Dev-only; nothing ships in the VSIX.

## Offline guarantee

Only the harness server's own origin (exact host and port, plus its `ws:` twin) is local. Every other `http(s)`
request is answered from fixtures. The run fails ("unrouted") on a non-local response that did not come from the
harness, a non-local `requestfailed`, or any non-local WebSocket.

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
