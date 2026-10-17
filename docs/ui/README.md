# UI screen harness

Headless "see it first" renderer for the extension webview (plan: `docs/vision-2040/plans/ui-w-world-class-client.md`, slice S0).

```
npm run ui:screens -- --out <dir> --themes dark,light,hc-dark,hc-light \
  --widths 320,400,800,1280,1920 --font 13,20 --check
```

- Renders each screen registered in `webview-ui/src/screens/registry.tsx` with the real components, real contexts, and a mocked host (`services/grpc-client`, `context/MapContext`, `acquireVsCodeApi`). Nothing under `webview-ui/src/screens` is imported by the production entry; `npm run ui:screens:verify-bundle` (after `npm run build:webview`) fails if it leaks into `webview-ui/build/assets`.
- Every page carries a red "FIXTURE" badge. Fixtures are synthetic, typed against the generated proto types, and must never be quoted as results.
- All non-local traffic is routed to fixtures (deterministic 256 px basemap tiles, 404 for anything else). The summary reports `unroutedRequests` (must be 0) and the external hosts the app attempted to reach.
- Themes in `scripts/ui-screens/themes/*.css` are APPROXIMATE hand-authored token sets, not a VS Code capture. Contrast numbers derived from them are indicative only.
- The built-in checker (`scripts/ui-screens/checker.mjs`) counts: missing accessible names, targets under 24x24 px, text under 11 px, and WCAG contrast failures (text over canvas/images/gradients is reported as indeterminate, never as a pass). axe-core runs automatically if `axe-core` is resolvable; it is not installed here.
- `--check` fails on page errors, unrouted requests, per-screen counts above `webview-ui/screens-baseline/checker-budget.json` (reference cell only: dark, 13 px, native width), and pixel diffs over 0.2% against `webview-ui/screens-baseline/<os>/` when that directory exists. Image baselines are not committed (owner decision pending); create them locally with `--update-baseline`. Map canvases are masked in pixel diffs.
- `--write-budget` rewrites the budget; use it only in a slice that lowers counts.
- `--resume` keeps clean cells from an earlier run in the same `--out` and renders only the rest (a failed cell gets one automatic retry).
- Animations are fast-forwarded to their end state before measuring (`--no-freeze` disables this) so checks and pixels are deterministic. Production CSS still runs always-on keyframes under `prefers-reduced-motion`; that is an S2 fix, not hidden by this.
- `node scripts/ui-screens/write-baseline-doc.mjs <summary.json> <out.md>` renders the committed baseline doc from a run.

Outputs: `<out>/png/*.png`, `<out>/index.html` (contact sheet), `<out>/summary.json`.
