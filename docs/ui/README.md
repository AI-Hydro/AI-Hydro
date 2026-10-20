# UI screen harness

Headless "see it first" renderer for the extension webview (plan: `docs/vision-2040/plans/ui-w-world-class-client.md`, slice S0).

```
npm run ui:screens -- --out <dir> --themes dark,light,hc-dark,hc-light \
  --widths 320,400,800,1280,1920 --font 13,20 --check
```

- Renders each screen registered in `webview-ui/src/screens/registry.tsx` with the real components, real contexts, and a mocked host (`services/grpc-client`, `context/MapContext`, `acquireVsCodeApi`). Nothing under `webview-ui/src/screens` is imported by the production entry; `npm run ui:screens:verify-bundle` (after `npm run build:webview`) fails if it leaks into `webview-ui/build/assets`.
- Every page carries a red "FIXTURE" banner. The banner says what the data is (`fixtureKind` on the screen): **synthetic** (invented, typed against the generated proto types), **recorded-call** (a recorded tool call and result inside an invented chat: the prompt, costs and token counts are synthetic), **recorded** (a body recorded from a real server run, replayed offline), or **spliced** (recorded pieces, or real code output on recorded inputs, combined offline). Provenance of the recorded ai-hydro bodies is in `webview-ui/src/screens/fixtures/aihydro/README.md`. None of it may be quoted as a result.
- All non-local traffic is routed to fixtures (deterministic 256 px basemap tiles, 404 for anything else). The summary reports `unroutedRequests` (must be 0) and the external hosts the app attempted to reach.
- Themes in `scripts/ui-screens/themes/*.css` are APPROXIMATE hand-authored token sets, not a VS Code capture. Contrast numbers derived from them are indicative only.
- The built-in checker (`scripts/ui-screens/checker.mjs`) counts: missing accessible names, targets under 24x24 px, text under 11 px, and WCAG contrast failures (text over canvas/images/gradients is reported as indeterminate, never as a pass). axe-core runs automatically if `axe-core` is resolvable; it is not installed here.
- `--check` fails on: page errors; unrouted requests; a rendered screen with no budget entry; any per-screen count above `webview-ui/screens-baseline/checker-budget.json` (reference cell: dark, 13 px, native width; and matrix totals whenever the same number of cells was rendered); a missing baseline directory or missing baseline image; and pixel diffs over 0.2% (per-screen override via `pixelDiffThreshold`). Image baselines are not committed (owner decision pending); create them locally with `--update-baseline`. `--no-pixel` is the explicit opt-out used by CI (structural checks only). Map canvases are masked in pixel diffs. Screens whose scroll offset depends on machine load assert structure instead (`expectVisible`, `scrollPinned`). `expectAbsent` is the inverse of `expectVisible`: selectors that must have no rendered match (not-rendered content such as `display:none` or a closed `<details>` counts as absent); its self-test is `npm run ui:screens:selftest`.
- `--write-budget` can only shrink the budget: existing entries keep min(old, new) per rule (matrix totals only when the cell count is unchanged); new screens take the measured values.
- `--resume` keeps clean cells from an earlier run in the same `--out` and renders only the rest (a failed cell gets one automatic retry).
- Animations are fast-forwarded to their end state before measuring (`--no-freeze` disables this) so checks and pixels are deterministic. Production CSS still runs always-on keyframes under `prefers-reduced-motion`; that is an S2 fix, not hidden by this.
- `node scripts/ui-screens/write-baseline-doc.mjs <summary.json> <out.md>` renders the committed baseline doc from a run.

Outputs: `<out>/png/*.png`, `<out>/index.html` (contact sheet), `<out>/summary.json`.

## Science tool-call cards: how a call is recognised

- `webview-ui/src/components/chat/ScienceToolCard.tsx` is used for calls on a first-party server, decided **by server name** against `src/shared/aihydro/firstPartyServers.ts`. The extension host's context injection (`src/core/task/tools/handlers/aiHydroServer.ts`) imports the same list, so the two cannot drift.
- Name identification is weaker than the `_meta` tool-tier test (`hot` tools) the explorer profile uses: a user-registered server that reuses one of these names would get first-party cards. The webview's proto state does not carry tool `_meta` (nor `annotations`), so the stronger test cannot be applied there yet. Follow-up: carry `_meta` through the `McpTool` proto and require it.
- A response is attributed to a call only when exactly one MCP call is outstanding and it is a first-party tool call. The message stream has no tool-use id. Otherwise the response row stays visible and the card says "Result not paired (concurrent calls)". The Replay link uses only a session id named by the call's own arguments or by the result itself.
