# AI-Hydro

## What It Is

AI-Hydro is an agent-native hydrology research platform built around a VS Code extension, map workspace, Python/MCP tools, and reproducible analysis artifacts. It helps researchers move from hydrologic data discovery and watershed delineation to analysis, visualization, provenance, and publication-ready outputs without leaving one research environment.

## Status

Active product hardening — last updated 2026-09-08.

## Where To Read Next

- Continue work: read [PROGRESS.md](PROGRESS.md) and the newest relevant plan or issue.
- Understand decisions: read `DECISIONS.md` if present, otherwise inspect recent commits and `docs/`.
- Modify map or extension behavior: inspect `src/hosts/vscode/`, `webview-ui/src/components/map/`, and `src/config.ts`.
- Modify Python/MCP tools: inspect the editable `aihydro-tools` workspace used by the platform.

## Current State

- Active phase: research-grade integration and scientific hardening.
- Local/uncommitted: Replay, Experiment Table and Evidence Board now consume
  the backend-owned persisted snapshot resource. Repeated tool runs keep their
  true IDs; current nested experiments load; capsule history stays capsule-local.
- Backend errors are visible. Async old responses and foreign-study claim
  events cannot overwrite the current selection. Replay shows unvalidated runs
  as not checked and exposes recorded inputs and uncertainty.
- Validation: 18 extension tests and 16 related webview tests passed; host and
  webview TypeScript checks passed. Includes a real Python-written persistence
  fixture. The running VSIX/backend has not been restarted or smoke-tested.
- Requires the matching tools backend resource from
  `MCP/aihydro-tools/docs/research-snapshots.md` in the ecosystem workspace.
- Next: automatic refresh/pagination and event revision ordering; a study-level
  comprehension workspace remains broader work. Scientific scope/lineage gates
  remain in the canonical packages.

## Non-Goals

- Do not replace the hydrology-specific map with a generic GIS viewer.
- Do not silently download global datasets when a regional or viewport-scoped asset is sufficient.
- Do not bypass provenance, citation, license, or readiness checks for agent convenience.

## How To Run / Test

Use the repository scripts in `package.json`; common checks are TypeScript compilation, targeted Mocha tests under `src/hosts/vscode/__tests__/`, and packaging through the existing VSIX build workflow.

2026-09-08 continuation: joint-validity scoring repair and first Map inspection slice complete locally. User priority is now substantial Map research-workspace improvement: see AI-Hydro/plans/map-research-workspace-2026-09-08.md from ecosystem root. Layer lifecycle and real runtime verification are next; scientific support/uncertainty and live-data gates remain open.

Map stream lifecycle is now repaired locally (3 host and 14 React tests; both TypeScript checks passed). Raster/tile failure and retry, export accuracy, and cluster source invalidation are now implemented locally (54 Map/context tests, TypeScript and production webview build passed). Actual MapView StrictMode browser smoke passes with controlled host/network fixtures, including PNG/provenance transfer. Renderer dependencies are aligned and pinned at deck.gl 9.3.11 (luma.gl 9.3.6 resolved). Real persisted backend/installed runtime walkthrough remains open. See plans/map-stream-lifecycle-2026-09-08.md.

ROI continuation (2026-09-09): client mutation/refresh lifecycle slice completed with 12 provider tests and TypeScript passing; queued stale requests are rejected before dispatch. Active backend slice: `../MCP/aihydro-tools/plans/map-roi-workspace-boundary-2026-09-09.md`, aligning Map/GEE basin selection with explicit workspace ownership. Implementation delegated to one Sol worker; Astra performs boundary review.
