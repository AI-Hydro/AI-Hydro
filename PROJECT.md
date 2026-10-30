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

- Wave 0 X0-8 (PR #93, stop-gap until the MAP digest MP3): the map block in `environment_details` is gated to the
  chat's own workspace, a map-launched chat or a user map mention, capped at 600 characters and sent only when changed.
  The deleted range is changed only via `TaskState.setConversationHistoryDeletedRange`, which resets that dedup.
- Wave 0 clean-up (vision-2040 X0-4 to X0-7, PR #92): the inherited Cline account/credits/Firebase
  stack, voice dictation, "Generate Commit Message", the code-definition tool, the `aihydro` CLI
  subagent path and the coding walkthrough are removed; the walkthrough is hydrology; the browser
  tool is off by default; "AI-Hydro" spelling and palette titles are guarded by
  `src/shared/__tests__/uiContract.test.ts` (words in `docs/ui-naming.md`). Running a program named
  `aihydro` is always denied. The two retired `clineAccountId` secrets are deleted once on start.
- Explorer subagents (owner decision H1, 2026-10-28; PRs #114, #119, #124 and the PR-3 branch, in review):
  in-process, read-only, off by default (Settings > Features > Subagents). `spawn_subagents` asks every time; each
  child is a `SubagentRunner` (src/core/task/subagents/) with a profile-scoped `ToolExecutor`, its approvals are the
  parent's asks (`ParentAskBridge`), and it writes `<task dir>/subagents/<id>.json`. A `general`/`data-runner`
  profile (PR-4) is not approved. Agent identity in `_meta` is sent but not yet sealed by the server (WP-H8).
  Decision record in DECISIONS.md; user guide in docs/guide/subagents.md.
- Managed tools environment (vision-2040 X0-3, PR #94, in review): the extension owns a venv
  `<aihydro_home>/venvs/tools-2.8` with `aihydro-tools[...]~=2.8.2` (src/core/mcp/toolsEnv/). Install
  is automatic only for a fresh, missing default venv after one consent that names PyPI; an unhealthy
  or outdated venv is repaired only by the Repair action; pip runs only in a verified virtualenv. A
  launcher differing from the recorded one, or a missing record, always needs the modal "Trust this
  launcher". Status chip (Welcome, chat home), status bar item, Settings > About diagnostics.
- Active phase: research-grade integration and scientific hardening.
- Chat transcript (vision-2040 Wave 2, W2-A2, PR #81): the chat renders through
  `src/shared/aihydro/transcriptPresenter.ts` (work groups, lifted lines, Rewind,
  `transcriptDetail` focus/normal/verbose; command "AI-Hydro: Cycle transcript
  detail"). Verbose is the previous row list plus the detail bar. Servers without
  annotations (old installs, untrusted servers) have their calls listed (neutral tone), not folded.
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
- Chat redesign Wave 2 (extension): W2-C pre-completion answer-audit gate is on
  branch `vision2040/w2-c` (PR #80, draft). Default OFF (`finalAnswerAuditGate`);
  it is flipped on later with A2/B-web. Plan: `docs/vision-2040/plans/wave2-chat-redesign.md`
  in the ecosystem workspace.
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
