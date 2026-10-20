# AI-Hydro (extension) — Decisions (ADR-style)

Append-only. Newest first. One entry per non-obvious choice, with the **why**.

---

## 2026-10-17 — Harness quick wins: honest models, display-only answer audit, explorer allowlist

Branch `vision2040/harness-quickwins` (from the SOTA harness/model audit, items C/D/F).

- **Unknown model ids fail loudly.** A silent fallback to the default model is a
  provenance defect (the model that produced a result must be the one the user chose).
  Static-registry providers throw `UnknownModelError` at request time; dynamic-list
  providers send the user's id verbatim with flagged stand-in info (cost "unavailable").
  `getModel()` stays non-throwing and never reports a different model's id.
- **Prompt caching is default-on for every model flagged `supportsPromptCache`** (previously
  only 10 hard-coded ids; the default `claude-sonnet-4-6` and 4.6/4.7 were uncached).
  Cost: where a cache price is undefined the cost is shown as a lower bound, never as an
  exact figure.
- **Adaptive thinking on 4.6+** (`supportsAdaptiveThinking`), `budget_tokens` only on models
  that require it, no explicit temperature with thinking or on models that reject it.
  Capability flags for the Claude 5.x ids are intentionally NOT set (not traceable to a
  committed source); only the ids are (see `docs/model-config/claude-5x-models.md`).
- **Final-answer audit is display-only, default-on, opt-out** (`finalAnswerAuditEnabled`).
  Mechanism over prompt: it never blocks or alters the answer; failures show as "audit
  unavailable"; it audits only the study bound to the current chat (it will not fall back to
  the most recent study on disk). The server-side `recent_fallback` in `_resolve_session`
  remains and should be disabled for `audit_interpretation` in aihydro-tools.
- **Explorer subagent is an allowlist**, with `use_mcp_tool` gated on `readOnlyHint === true`
  (unannotated = not read-only). New tools are closed by default.

---

## 2026-07-08 — Cline-fork sync cadence: quarterly batches + a security fast-path

**Context.** AI-Hydro's VS Code extension is a fork of Cline. `UPSTREAM_SYNC.md`
tracks a 48-minor-release gap (v3.34 fork point → v3.82 at time of the last
triage) — a growing, permanent tax: upstream security fixes (action-injection,
dependency CVEs, secrets-file permissions) arrive on this fork's timeline, not
Cline's, until someone manually ports them. Two batches have been ported so
far (Batch 1 + Batch 2, commit `592293271` et al., **2026-05-10**) — 16 items
across OOM fixes, tool-call robustness, and 3 named security fixes (action
injection, secrets.json permissions, plus the dependency/yaml items called out
in the "Priority Port List" below). No sync has landed since; per
`UPSTREAM_SYNC.md`'s own conflict-heatmap, remaining bucket-A items include a
17-CVE dependency bump (v3.62.0) that has NOT been confirmed ported — this
needs re-verification at the next sync (see Follow-up below), not assumed done.

**Decision: quarterly sync batches, with an explicit security fast-path.**
- **Quarterly:** review `UPSTREAM_SYNC.md`'s bucket A/B classification against
  the then-current Cline release, re-run the conflict-heatmap exercise for
  anything new, and port a batch — prioritized by the existing "Priority Port
  List" ordering (security > robustness > UX). Each batch gets its own
  `UPSTREAM_SYNC.md` entry with commit SHAs, matching the Batch 1/2 format.
- **Fast-path:** a security-shaped upstream fix (CVE, credential handling,
  injection, auth) is not deferred to the next quarterly window — it's
  triaged and ported (or explicitly deferred with a stated reason) within the
  same week it's identified, independent of the quarterly cadence.
- **Next scheduled sync: 2026-08-10** (3 months from the last batch). Whoever
  picks this up should first **re-verify** which "Priority Port List" items
  are actually still outstanding — the list as of 2026-07-08 was not updated
  after Batch 1/2 landed, so some entries (e.g. items 3 and 9, which overlap
  with already-ported Batch-1 fixes) may already be done and just need the
  list corrected, not re-ported.

**Alternative rejected: freeze the fork.** Considered accepting permanent
divergence and stopping upstream sync entirely. Rejected because the fork
still receives real security value from Cline's much larger contributor base
(dependency CVE fixes alone justify staying connected), and the existing
conflict-heatmap analysis (`UPSTREAM_SYNC.md`) is a sunk-cost asset that a
freeze would waste — it already maps exactly where future ports will
conflict (`webview-ui/src/components/chat/`, `src/core/task/`,
`src/core/prompts/`, `src/core/mcp/` are named as high-conflict zones).

**Why this isn't a bigger, formal process:** a fixed cadence with a named
next date is enough structure to prevent indefinite drift (the actual
problem — 2 months already elapsed with no tracked next step) without
inventing process overhead for a single-maintainer fork.

**Follow-up (not done here, tracked in `audits/STATUS.md` N-16 at the
AI-Hydro ecosystem root):** verify whether v3.62.0's 17 dependency-
vulnerability fixes actually landed — `UPSTREAM_SYNC.md`'s Batch 1/2 lists
don't mention it despite the Priority Port List citing it as still
outstanding. Spot check done here: `package.json` has `axios@^1.12.0` (a
recent major version, plausibly already past the CVE window), but
`body-parser`/`qs`/`tar` don't appear as direct dependencies — they may be
transitive (would need a `package-lock.json` / `npm audit` pass, not done in
this session, to confirm). Treat this as unverified, not resolved.


## 2026-09-07 — Research panels consume backend-owned snapshots

Replay, Experiment Table and Evidence Board use the versioned MCP resource
`aihydro://research/snapshot/{reference}` advertised by the connected AI-Hydro
backend. Python owns SQLite, legacy and capsule storage interpretation. This
replaces JSON-only readers and synthetic current-slot history, which could
lose actual run IDs and hide repeated executions. No second store, interpreter
discovery mechanism or Node SQLite schema is introduced.

Missing/ambiguous/incompatible backends fail visibly; old completed snapshots
are not reused as fresh. Claim events stay within the selected study. Replay
shows absent validation as not checked and exposes retained evidence. The
resource provides inspection, not scientific recomputation or an atomic
cross-store transaction. Contract: ecosystem
`MCP/aihydro-tools/docs/research-snapshots.md`.


## 2026-09-08 — Map capability is not scientific validity

Raw raster access now describes value availability rather than analysis readiness. Unrecorded freshness is not checked; dataset IDs cannot substitute for missing citations. Inspector lists recorded scientific support and identity explicitly. Metadata remains producer-declared, not independently validated by the UI. Keep existing runtime/layer storage; the major Map workflow plan is plans/map-research-workspace-2026-09-08.md.

## 2026-09-08 — Ordered Map initialization and explicit recovery

The layer subscription now owns initialization: snapshot_start, retained layers, snapshot_complete, then buffered live mutations. The host serializes sends and removes controller listeners on disposal/failure. The UI stages the snapshot and only replaces layers after completion; it no longer races a unary snapshot request against live events. Session ROI also uses its initial streamed state and ordered delivery, including explicit empty visible-layer lists.

Loading, detected interruption and completion-before-readiness are visible. A 15-second initialization timeout and Reconnect action recover with a new snapshot; disposed connection callbacks cannot mutate state. Previous complete layers remain visible during incomplete refresh with a stale warning. This is transport synchronization, not scientific validity or proof that all raster tiles rendered. No heartbeat/liveness proof or cross-stream atomic transaction is provided. Host and webview require the matching extension build; the protocol markers use existing reserved __operation metadata.

Next: raster/tile loading and error propagation; avoid equating connection readiness with data/render readiness. Canonical plan: plans/map-stream-lifecycle-2026-09-08.md.


## 2026-09-08 — Map captures preserve uncertainty about rendering

A captured canvas cannot certify tile completeness or scientific validation. Known load/render/transport failures block research plates; diagnostic captures retain limitations. Raster legend scales come only from recorded metadata or the current raw raster renderer, never layer-name heuristics. Freeze pixels and metadata before asynchronous destination selection. Display clusters must not present a single member's measurements as an aggregate; source identity must participate in cache validity.


## 2026-09-08 — Coordinated renderer versions and StrictMode acceptance

Pin all direct deck.gl modules to 9.3.11 and retain the resolved luma.gl 9.3.6 lock graph. Actual MapView StrictMode testing reproduced the old observer/device initialization failure; upstream fix: https://github.com/visgl/luma.gl/pull/2540. Do not suppress browser errors or disable StrictMode. The browser harness must verify settled recovery and actual rendered pixels, not merely the transient disappearance of an alert or existence of a canvas.


## 2026-10-19 — Approval AP1: the host classifies, the model never attests

`execute_command` auto-runs only when a host-side allowlist says read-only; `requires_approval` can only tighten. Claim approval commands are hard-denied by text match (best effort, indirection documented), subagents never start in YOLO, protected state (MCP settings, extension storage, approval/trust/registry, ~/.ssh) always asks, settings-file edits that loosen policy need UI confirmation, and a single `isServerTrusted` (name plus recorded launcher) replaces three name-based trust checks. Every layer is a speed bump against a same-user process; the boundary is a touch-required signature. Not done in AP1 (AP2): annotation-driven MCP auto-run, the inline prompt UI, the consecutive-read ceiling (M6, nothing auto-runs reads yet). Plan and limits: plans/approval-redesign-ap1-2026-10-19.md.
