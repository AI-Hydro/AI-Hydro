# UI screens: before (S0, 2026-10) checker baseline

All screens are synthetic FIXTURE renders from `webview-ui/src/screens/registry.tsx` (harness: `docs/ui/README.md`). Nothing here is a research result. Theme tokens are approximate hand-authored sets, so contrast counts are indicative.

- Screens: 42; cells rendered: 1680 (themes dark, light, hc-dark, hc-light; widths 320, 400, 800, 1280, 1920; font px 13, 20; motion reduce).
- Uncaught page errors: 0. Unrouted external requests: 0. External hosts the app tried to reach (all answered from fixtures): server.arcgisonline.com (1549), basemap.nationalmap.gov (8717), fonts.googleapis.com (40).
- axe-core: unavailable (axe-core not installed).
- Budget file: `webview-ui/screens-baseline/checker-budget.json`. Counts can only shrink: `--write-budget` keeps min(old, new) per rule and `--check` fails above the budget.
- Reference cell: dark theme, 13 px, native width (sidebar 400, panel 800, editor 1280). Matrix total = sum over every cell of that screen.
- Rules: noName = button/link without accessible name; smallTarget = interactive target under 24x24 px; smallText = text under 11 px; contrast = WCAG ratio below 4.5 (3 for large text). Text over canvas/gradients is counted separately as indeterminate and excluded here.

## Totals

| Scope | noName | smallTarget | smallText | contrast |
|---|---|---|---|---|
| Reference cells | 6 | 950 | 1136 | 351 |
| Whole matrix | 240 | 36252 | 42432 | 23347 |

## Per screen (reference cell, then matrix total)

| Screen | Group | noName | smallTarget | smallText | contrast | matrix: noName | smallTarget | smallText | contrast |
|---|---|---|---|---|---|---|---|---|---|
| `chat-history-list` | chat | 0 | 54 | 0 | 5 | 0 | 2056 | 0 | 250 |
| `chat-home-empty-history` | chat | 1 | 21 | 2 | 0 | 40 | 840 | 80 | 40 |
| `chat-home-history` | chat | 1 | 59 | 2 | 3 | 40 | 2360 | 80 | 220 |
| `chat-task-answer` | chat | 1 | 73 | 11 | 9 | 40 | 2752 | 440 | 455 |
| `chat-task-mcp` | chat | 1 | 66 | 6 | 4 | 40 | 2584 | 240 | 270 |
| `chat-task-refusal` | chat | 1 | 69 | 7 | 5 | 40 | 2632 | 280 | 310 |
| `chat-task-text` | chat | 1 | 49 | 4 | 2 | 40 | 1944 | 160 | 130 |
| `chat-welcome` | chat | 0 | 5 | 0 | 0 | 0 | 188 | 0 | 0 |
| `evidence-all-statuses` | evidence | 0 | 12 | 79 | 22 | 0 | 424 | 2948 | 815 |
| `evidence-approval-approved` | evidence | 0 | 8 | 33 | 4 | 0 | 264 | 1108 | 283 |
| `evidence-approval-consumed` | evidence | 0 | 8 | 33 | 7 | 0 | 264 | 1108 | 325 |
| `evidence-approval-integrity-only` | evidence | 0 | 8 | 33 | 5 | 0 | 264 | 1108 | 259 |
| `evidence-approval-revision-mismatch` | evidence | 0 | 8 | 34 | 5 | 0 | 264 | 1148 | 303 |
| `evidence-approval-stale-evidence` | evidence | 0 | 8 | 35 | 5 | 0 | 264 | 1188 | 323 |
| `evidence-approval-stale-revision` | evidence | 0 | 8 | 35 | 5 | 0 | 264 | 1188 | 323 |
| `evidence-approval-unreported` | evidence | 0 | 8 | 33 | 5 | 0 | 264 | 1108 | 295 |
| `evidence-approval-unverifiable` | evidence | 0 | 8 | 35 | 5 | 0 | 264 | 1188 | 323 |
| `evidence-drift-states` | evidence | 0 | 10 | 47 | 9 | 0 | 344 | 1668 | 381 |
| `evidence-empty` | evidence | 0 | 5 | 7 | 6 | 0 | 160 | 260 | 185 |
| `evidence-error` | evidence | 0 | 5 | 2 | 4 | 0 | 160 | 80 | 130 |
| `experiment-empty` | experiment | 0 | 4 | 2 | 2 | 0 | 160 | 80 | 80 |
| `experiment-failed-rows` | experiment | 0 | 58 | 93 | 25 | 0 | 2240 | 3700 | 895 |
| `experiment-no-ci` | experiment | 0 | 50 | 88 | 18 | 0 | 1872 | 3500 | 655 |
| `experiment-with-ci` | experiment | 0 | 62 | 100 | 24 | 0 | 2352 | 3980 | 835 |
| `map-empty-default` | map | 0 | 1 | 1 | 0 | 0 | 40 | 40 | 260 |
| `map-empty-esri` | map | 0 | 1 | 1 | 0 | 0 | 40 | 40 | 260 |
| `map-export-success` | map | 0 | 33 | 18 | 1 | 0 | 1320 | 720 | 1320 |
| `map-export-zero-output` | map | 0 | 33 | 18 | 1 | 0 | 1320 | 720 | 1320 |
| `map-features` | map | 0 | 1 | 6 | 0 | 0 | 40 | 240 | 280 |
| `map-layer-manager` | map | 0 | 57 | 46 | 26 | 0 | 2280 | 1840 | 2610 |
| `map-layer-provenance` | map | 0 | 60 | 51 | 50 | 0 | 2400 | 2040 | 3870 |
| `map-swipe` | map | 0 | 3 | 6 | 0 | 0 | 120 | 240 | 340 |
| `map-time-slider` | map | 0 | 4 | 6 | 0 | 0 | 160 | 240 | 380 |
| `replay-capsule` | replay | 0 | 9 | 38 | 13 | 0 | 312 | 1400 | 660 |
| `replay-mismatch` | replay | 0 | 9 | 40 | 13 | 0 | 312 | 1460 | 676 |
| `replay-missing` | replay | 0 | 9 | 40 | 13 | 0 | 312 | 1460 | 676 |
| `replay-no-timezone` | replay | 0 | 9 | 38 | 13 | 0 | 312 | 1400 | 660 |
| `replay-session` | replay | 0 | 9 | 38 | 13 | 0 | 312 | 1400 | 660 |
| `replay-warnings` | replay | 0 | 9 | 38 | 13 | 0 | 312 | 1400 | 660 |
| `studio-course-progress` | studio | 0 | 15 | 15 | 7 | 0 | 600 | 584 | 280 |
| `studio-executable-module` | studio | 0 | 11 | 8 | 4 | 0 | 440 | 304 | 170 |
| `studio-static-doc` | studio | 0 | 11 | 7 | 5 | 0 | 440 | 264 | 180 |

## Ten worst screens by reference-cell violations

1. `experiment-with-ci`: 186 (noName 0, smallTarget 62, smallText 100, contrast 24)
2. `experiment-failed-rows`: 176 (noName 0, smallTarget 58, smallText 93, contrast 25)
3. `map-layer-provenance`: 161 (noName 0, smallTarget 60, smallText 51, contrast 50)
4. `experiment-no-ci`: 156 (noName 0, smallTarget 50, smallText 88, contrast 18)
5. `map-layer-manager`: 129 (noName 0, smallTarget 57, smallText 46, contrast 26)
6. `evidence-all-statuses`: 113 (noName 0, smallTarget 12, smallText 79, contrast 22)
7. `chat-task-answer`: 94 (noName 1, smallTarget 73, smallText 11, contrast 9)
8. `chat-task-refusal`: 82 (noName 1, smallTarget 69, smallText 7, contrast 5)
9. `chat-task-mcp`: 77 (noName 1, smallTarget 66, smallText 6, contrast 4)
10. `evidence-drift-states`: 66 (noName 0, smallTarget 10, smallText 47, contrast 9)

## Notes recorded with the baseline

- The "before" gallery was rendered from the S0 harness commit plus the determinism fixes listed in `git log` (settle/freeze/resume, storage reset, scroll-to-end, welcome mounted directly). Contact sheet and PNGs are not committed (owner decision pending); regenerate with `npm run ui:screens`.
- After S1 (`design/tokens.css` wired into `index.css`), the full matrix was re-rendered (43 screens, 1720 cells): 0 page errors, 0 unrouted requests, checker totals identical to this baseline, budget check passed, and pixel diffs against the baseline within threshold for every compared cell except the four `chat-task-*` screens, which now assert structure (final message visible, list pinned to its end) instead of pixels because the virtualised chat list settles about 20 px apart depending on machine load.
- `design-primitives` (added in S1) has 0 violations in every cell of the matrix.
- Findings surfaced while building the harness (not fixed here):
  - `ExtensionStateContext` force-sets `showWelcome=false` two seconds after mount (the "ref to avoid stale closure" is never read), so the first-run welcome view disappears after about 2 s when mounted through `App`.
  - The webview requests `fonts.googleapis.com` (40 requests across the matrix); the harness answers them from the fixture router.
  - Production CSS keeps always-on keyframes under `prefers-reduced-motion`.
- Theme tokens are approximate; real-token capture is still required before any accessibility sign-off.
