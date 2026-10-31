# AI-Hydro (extension) — Decisions (ADR-style)

Append-only. Newest first. One entry per non-obvious choice, with the **why**.

---

## 2026-10-31 — Explorer subagents are in-process, profile-scoped and asked every time

Branches `vision2040/subagents-pr0` to `-pr3` (owner decision H1, 2026-10-28: explorer-only; PR-4, a `general` or
`data-runner` profile, is NOT approved and needs its own decision).

- **Shape.** A child is a headless model loop in the extension host (`SubagentRunner`) with its own conversation, state and
  API handler. It runs tools through a `ToolExecutor` built for one profile. The profile is per executor, never a
  process-wide switch: the extension host is one process, so an environment variable would restrict the parent too, or
  nothing. The retired `aihydro "..."` CLI path stays denied in every setting. *Why not a CLI:* a separate process moves
  approvals out of the host's sight, needs signed per-platform binaries, and would run its own MCP server and trust.
- **A child is never more capable than its parent** (`capFor`): the intersection of the profile and what the parent can call
  now; no auto-approve at all in an untrusted workspace; no spawning from a child. A child ignores YOLO, "execute all
  commands" and edit grants. It auto-approves only its own reads and MCP, and only when the user's own settings approve them.
- **Every child approval is the parent's ask.** One pending at a time, first in first out, bound to its `ask_ts`, stamped by
  the host with the child's name. A child's `say` never reaches the parent, because moving `lastMessageTs` supersedes the
  pending ask. Only `tool` and `use_mcp_server` asks are allowed from a child.
- **The launch is asked every time (H2)**, even in YOLO and with auto-approve on, and has no "Always". *Why:* children cost
  money and the user judges the installed build.
- **Explorer allowlist v2.** `read_file`, `search_files`, `list_files`, `load_mcp_documentation`, `use_mcp_tool` (READ class
  on a trusted server only), `access_mcp_resource` (trusted server only), and `report_findings`. Removed from the old
  process-based list: `web_fetch` (an open-world egress channel for an agent that can read the workspace),
  `ask_followup_question`, `attempt_completion`, `plan_mode_respond`, `condense`, `summarize_task`, `focus_chain` (they
  reach the parent's state or its asks). Everything else is refused before a handler or an ask runs.
- **Child output is untrusted text.** Reports are validated, size-capped, wrapped in `<subagent_reports untrusted="true">`
  with no `<` surviving from the child, and the tool description tells the parent to check the source a report names.
- **No claim authority.** No claim, promotion, pre-registration or approval tool is reachable (none is READ class), and a
  source test fails if a subagent module names one. Promotion stays the owner's signature outside the agent.
- **Provenance is partial, on purpose.** Each child writes `<task dir>/subagents/<id>.json` (arguments hashed). Each MCP call
  a child makes carries `_meta["aihydro/context"].agent = {agent_id, parent_agent_id, role}` with the parent's `chat_id` and
  `client: "vscode"`. The server reads only `study_id`, `workspace`, `chat_id` and `client` today, so the agent block is
  **not sealed in server RunRecords**; do not call child calls agent-attributed there until the server seals it (audit
  WP-H8, an aihydro-tools change). The capsule and defensibility exports are server-side over `~/.aihydro/sessions` and do
  not read the extension's task directory, so `subagents/` is not in them; including it needs a tools-side change.
- **Known limit.** `ApiHandler` has no abort signal. Stop and cancel drop a child's stream without waiting for it
  (`iterator.return()`); a provider request that hangs on the network cannot be torn down from here. Children stop
  being awaited within one poll interval, and their budgets and records are unaffected.

---

## 2026-10-28 — HistoryItem has one writer and a field-owner table; each chat is bound to its study by the host

Branch `vision2040/x0-binding-history` (UX program Wave 0, X0-1 and X0-2).

- **Field owners (`src/core/storage/historyPatch.ts`).** Every write to a history item is a patch from a named writer.
  Loop-owned: `ts`, `task`, tokens, cache counters, `totalCost`, `size`, `shadowGitConfigWorkTree`,
  `conversationHistoryDeletedRange`, `checkpointManagerErrorMessage`. Creation (first value wins, any writer): `ulid`,
  `cwdOnTaskInitialization`, `projectId`, `origin`, `userQuestion`. User-only: `isFavorited`, `pinned`, `description`,
  `memoryMode`. Title: `title` and `titleSource` (user always; system only while `titleSource` is not "user"). Binding-only:
  `activeStudyId`. Unknown stored fields are preserved; an unowned key from a non-system writer is dropped with a warning.
  *Why:* the loop rebuilt the whole item on each save and `toggleTaskFavorite` was a second writer, so each lost the other's
  fields; every later feature (titles, projects, study mirror) would have been wiped by the next message.
- **`cwdOnTaskInitialization` is first-write-wins, not "the cwd at creation".** The first save that reaches the store sets
  it, from the folder at that moment (resolved once per task handler). A chat created before this build keeps the value its
  last save wrote (possibly a later folder). Nothing can reconstruct the true creation folder for those, so
  `projectId` derivation from it (X1-P1) is lossy for moved chats; that migration must say so.
- **Limits.** The merge is atomic within one extension host (synchronous read-modify-write). Two VS Code windows sharing the
  same `taskHistory.json` still last-writer-win at the list level: window B's save of the whole list can overwrite window A's
  patch to a different item. Not fixed here; a per-item store would be needed.
- **Deleted chats stay deleted.** A save that was in flight when its chat was deleted is a no-op (a per-session tombstone in
  `patchTaskHistory`), so the deleted chat is not recreated as an empty row. The tombstone does not survive a restart.
- **Binding is the host's job, through the server only.** The extension binds at launch (resume, the layer's study id, the
  artifact manifest, the only study in the folder), shows a picker when it is ambiguous, and never binds on a guess. Signals
  that change the chip or the history mirror (`session_binding`, `session_binding_skipped`, a candidates error) are accepted
  only from the trusted, connected first-party server, not from any server that carries its name. An unresolved result never
  drops a known binding. Declining the picker says only what the host can guarantee ("not bound by you; the server may still
  resolve a study") and re-reads the server's binding.
- **Status of the owner failure (map-launched chat on `try`, `measure_feature`, `SESSION_RESOLUTION_FAILED`):** fixed in
  tests (a fake server written from the tools 2.8.2 contract; no real 2.8.2 server and no installed build was used). Owner
  checkpoint pending: it must be reproduced on the installed build against published tools 2.8.2 before it is called fixed.

---

## 2026-10-20 — Studio catalogue: raw-origin policy, unsigned entries, installed is not trusted

Branch `vision2040/studio-p1p2` (Studio P1/P2; implements ADR-004 step 1 for user-facing names).

- **Modules raw-origin policy is an exact repo + branch prefix, not org-wide.** The live
  index lists every `downloadUrl`/`manifestUrl` on `raw.githubusercontent.com`. The
  allowlist admits only `https://raw.githubusercontent.com/AI-Hydro/Modules/main/` (https;
  no userinfo, port, query, fragment, percent-encoding or dot segments). An
  `AI-Hydro/`-wide rule is rejected because GitHub serves commits from forks and unmerged
  PRs under the upstream repo path by SHA, so it would accept unreviewed content. The prefix
  applies to module and course installs only (`assertTrustedModuleContentUrl`); skills keep
  their own repo-by-repo table (`skillUrlPolicy.ts`) and a test refuses a skill URL under
  `AI-Hydro/Modules/main/`. Adding a repo or branch is a code change with a test.
- **Catalogue entries are unsigned and carry no default licence.** The index has no
  signature or content hash, so every card says "Unsigned catalogue module/course". A licence
  is shown only if the entry declares one ("License not declared" otherwise); the mapper no
  longer fills in CC-BY-4.0. Install/star counts that are zero or unknown are hidden rather
  than shown as a fake zero. A failed catalogue fetch is an error with Retry, never an empty
  list.
- **Installed does not mean trusted to execute.** A catalogue module on disk is still
  subject to the Studio trust model (`docs/studio-trust-model.md`): execution and agent
  hand-off are gated by workspace trust and the artifact's identity, not by having been
  installed from the catalogue. Only signed Learning Packs carry a publisher signature.
- **One user-facing name: "AI-Hydro Studio".** Command ids, `preview_html`,
  `show_html_preview`, `aihydro.htmlPreview.*` and proto names are unchanged (ADR-004
  policy 3). A case-insensitive guard test covers package.json contributes, webview
  strings, extension/agent-facing text, README and `docs/guide/**`, with those ids
  allow-listed.

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
- **Answer-audit gate (W2-C) shipped default-OFF; flipped to default-ON with A2/B-web (W2-B-web) and scoped to graded hard findings** (`finalAnswerAuditGate`;
  turning the audit off turns the gate off). It fires only on a graded audit outcome with `hardCount > 0`,
  at most 2 silent revisions per completion cycle, never on legacy/unavailable/skipped, never on
  `plan_mode_respond`. Eligibility is computed from cached state before streaming (setting, trusted
  first-party server, audit tool description that speaks of advisories or a graded outcome seen earlier in the
  task, study known to be bound); when not eligible the answer streams exactly as before. The gate runs first in
  `AttemptCompletionHandler`, feedback is a non-error result (never `recentToolErrors`/`execOutcome`/the mistake
  count), and every non-success exit reveals the hidden draft as "Unchecked draft (audit interrupted: ...)".
  aihydro-tools 2.6.0 has no `previous_prose` input and no `[unverified]` marker, so removed values are found by
  an approximate extension-side token diff (signed values, ²/³ normalised, `.7`, scientific notation) and the
  revision message offers no unverified path. The gate audits ALL non-empty narration
  since the last user message plus the result (plan M4). Narration from earlier turns of the cycle cannot be
  revised, so findings whose excerpt sits only there are NOT counted toward the hard gate and are NOT sent to the
  model as revision instructions; they are disclosed in the footer ("N earlier-narration findings not revisable",
  listed) via `AnswerAuditPayload.unrevisableFindings`. An excerpt that cannot be located counts as revisable.
  The removed-value footer is cumulative over the
  cycle. The gate audits only on the server it judged eligible, and requires it to be trusted.
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
