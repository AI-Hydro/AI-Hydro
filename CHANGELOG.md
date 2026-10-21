# Changelog — AI-Hydro VS Code Extension

All notable changes to the AI-Hydro VS Code extension are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

The companion Python package (`aihydro-tools`) has its own changelog at
`github.com/AI-Hydro/aihydro-tools/CHANGELOG.md`.

---

## [0.4.0] — unreleased (version set 2026-10-17; not published)

### Changed — the chat transcript renders through the presenter (vision-2040 Wave 2, PR W2-A2, branch `vision2040/w2-a2`)

At Normal detail (the default) the per-request cost rows, "Thinking:" rows, tool-call rows, results and the checkpoint marker line fold into one collapsed **work group** per stretch of work. Prose, pending approvals, errors and the final answer stay top level; `ActionButtons` and the approval flow are unchanged.

- **Group header.** One real `<button aria-expanded aria-controls>`: "Worked 1m 52s · 8 tools · $0.0535", built only from presenter facts: agent time and time waiting for you are separate, cost reads through its honesty label ("no cost recorded", "at least ..."), and retries, reused results, calls that did not run and answer revisions are counted. Its accessible name leads with problems ("Ran 8 tools, 1 failed").
- **Nothing the reader must not miss is folded.** Failures, refusals, cancellations, truncation, condense, "malformed tool call; retried", security-relevant approvals and the checked-out checkpoint state are real text lines (codicon plus words, never colour alone) under the collapsed header, and are counted in it.
- **Detail setting.** `transcriptDetail`: `focus` | `normal` | `verbose`, default `normal`, stored with the other UI settings (`UpdateSettingsRequest.transcript_detail`), a three-way control above the transcript, and the command "AI-Hydro: Cycle transcript detail" (`aihydro.cycleTranscriptDetail`, no default keybinding). `verbose` shows the same rows as the previous version and adds the detail bar.
- **Resolvers.** The webview passes the presenter its two required resolvers. MCP effect class is read from tool annotations only for a server the host reports as trusted (`McpServer.trust`); an untrusted server's `readOnlyHint` never folds a call. Tool annotations now cross the proto boundary (`McpTool.read_only_hint` and three siblings, all optional) so the webview can read them. Protected paths: the host is authoritative. When a tool row (native file tool or MCP call with path-like arguments) names a path that the real `isProtectedPath` check resolves into protected state (symlinks, every workspace base), the host stamps the row `policyClass: "protected_path"` (`src/core/task/protectedStamp.ts`, applied when messages are saved) and the transcript lifts on the stamp. MCP path detection is heuristic: it checks values under path-like argument names (matched as a case-insensitive suffix: `outputPath`, `outDir`, `target`, `uri`, ...) and any absolute, `~` or `file://` value under any key, and a call too large to walk is stamped as uninspected. It can only over-lift. The whole message list is stamped once when a task is loaded or resumed, so protected writes in old tasks are marked too. The webview matcher (`protectedPathMatch.ts`, roots from `ExtensionState.protectedRoots`) is best-effort display only: it adds lifts for unstamped rows (old tasks), can over-lift, and does not follow symlinks. With current aihydro-tools (every tool annotated) reads and session writes fold and only a destructive call is listed. A server without annotations (an old install) or an untrusted one has an undeclared effect: each call is listed as a neutral-tone line ("effect not declared by the server") rather than folded, because a missing fact must not hide a call. An untrusted server that did declare annotations reads "effect unverified" instead (its hints are not believed and never fold a call).
- **Rewind replaces the checkpoint row.** A "Rewind" action on the group header and on each user turn (visible on hover or focus, always in the tab order) opens a disclosure with Compare and three separately labelled restores (files, task, both). Each says it does not undo recorded claims, runs or MCP side effects (`~/.aihydro`). It runs the same RPCs as the old row (`useCheckpointActions`, shared with `CheckmarkControl`).
- **Accessibility.** The transcript is `role="log"` with `aria-live="off"`; one throttled polite status region announces "Running ...", "Thinking" and "Answer ready", never streamed text; the live activity line is static under `prefers-reduced-motion`; when a live group collapses with focus inside it, focus moves to its header.
### Added — pre-completion answer-audit gate with silent self-revision (vision-2040 Wave 2, PR W2-C, branch `vision2040/w2-c`)

- **Setting `finalAnswerAuditGate`** (Settings > Features, default **off**; flipped on later with A2/B-web). Requires the answer audit. When on and eligible, the audit runs before the answer is shown; a graded outcome with hard findings sends the model one non-error revision request (at most 2 per completion cycle, not counted toward the mistake limit). The draft is not streamed while eligible: one updating line ("Drafting answer…" / "Checking answer against evidence…") is shown instead.
- **What the user sees.** "Answer revised after audit (attempt n/2)" with the held-back draft behind "Show draft (n)"; the shown answer's footer states revision requests, quantities and evidence markers the revision removed, and "Shown with N unresolved hard audit findings after 2 revisions." when findings remain. Any non-success exit (stop, API failure, mistake or approval limit, switch to Plan, VS Code reload) reveals the hidden draft as "Unchecked draft (audit interrupted: reason)".
- **Details.** A draft is persisted hidden (`stage: "pending"`, renders as nothing) before its audit, so a reload during the first audit can reveal it. The final record is written right after the answer is shown, before any completion command ask, so a denied command cannot drop it. The audit runs only on the trusted server the gate judged eligible; the display-only audit now also prefers a trusted server over an untrusted alias listed first. The gate audits all narration since the last user message plus the result; findings only in earlier-turn narration (which a revision cannot change) are not sent to the model and are listed in the footer as "earlier-narration findings not revisable". `pending` rows lose their draft text once the final row exists. A trusted audit server lost mid-gate shows as "Audit not run", not a silent skip. Removed values are cumulative over the cycle and keep sign, superscript-normalised units, `.7` and scientific notation.
- **Limits stated plainly.** Overall gate deadline 45 s (then the answer shows with "Audit not run: timed out"). Removed-value detection is an approximate extension-side match because aihydro-tools 2.6.0 has no `previous_prose` input; there is no `[unverified]` path because the tools citation grammar has none. A draft that was never rejected is not persisted, so a reload mid-audit cannot reveal it.

### Changed — the final-answer audit is a structured `answer_audit` row (vision-2040 Wave 2, PR W2-B-host, branch `vision2040/w2-b-host`)

Host side only; the AnswerBlock footer (W2-B-web) comes later.

- **Structured row.** `attempt_completion` now emits `say: "answer_audit"` (proto `ClineSay.ANSWER_AUDIT = 1001`) whose `text` is the frozen v1 `AnswerAuditPayload` JSON. No path emits the audit as `say: "text"` any more. A failed or timed-out audit emits `status: "unavailable"` with the reason. A skipped audit (no AI-Hydro server, nothing to audit, no research session bound) still emits no row.
- **No 10-item cap in the data.** Every violation is kept in the outcome and the payload; `formatFinalAnswerAudit` is now only a plain-text fallback and keeps its own display cap.
- **Graded schema.** With aihydro-tools >= 2.6.0 each violation has `severity` (`hard` | `advisory`), plus `category`, `suggested_marker` and `resolved_path`; the response has `hard_count`, `advisory_count`, `exempt_by_reason`. Responses without `hard_count` are `schema: "legacy"` and every violation is severity `unknown`: hard is never inferred. A response with findings is never `status: "passed"`, even when it has no hard finding.
- **Interim rendering.** `AnswerAuditSummary` shows one line ("Audit: n/m quantities cited · h hard · a advisory", "Audit (ungraded server): n findings", or "Audit not run: reason") with an expandable list and fix hints as code. It is never green and says "passed" only for `status: "passed"`. W2-B-web replaces it.
- **Old tasks (downgrade).** Saved tasks keep their legacy `**Answer audit ...**` `say: "text"` rows and render as prose; they are not parsed or rewritten. A task written by this version and opened in an older extension shows an unknown say kind (the old build maps unknown kinds to plain text, so the raw payload JSON may appear as prose there).

### Added — host evidence for the chat transcript (vision-2040 Wave 2, PR W2-0h, branch `vision2040/w2-0h`)

Events that were silent or indistinguishable now leave honest data on their rows, so the transcript presenter can lift them. No redesign: each shows as one muted line or a colour change.

- **Context truncation is no longer silent.** When the provider rejects a request as too large and history is dropped, an `info` row says how many earlier messages were dropped and how many of the total are kept (`context_truncated`, warning; detail carries the deleted range and counts).
- **Structured `info` notices.** `say: "info"` rows carry `infoNotice {class, severity, detail?}` beside the unchanged `text`. Classes: `context_truncated`, `malformed_tool_call`, `native_call_not_run` (warnings), `native_call_repaired` (info), `unknown_tool` and `server_not_connected` (warnings). Old tasks keep plain-string `info` rows and render exactly as before. Types live in `src/shared/aihydro/infoNotice.ts`; W2-0's legacy-prefix registry should import them from there (whichever PR merges second reconciles).
- **MCP notification level** is carried on `mcp_notification` rows (`mcpLevel`); warning and above use the warning colour.
- **Command exit code.** The VS Code terminal path records the exit code (shell-integration end event, falling back to the OSC 633;D mark) on the command row as `exitCode`. A non-zero code sets `execOutcome: "failed"`. When the code cannot be observed (no shell integration, detached or cancelled command, standalone host) the row records `exitCode: "unknown"` and `execOutcome: "unknown"`, never success. The model-facing result now reads "Command executed (exit code N)." or "(exit code unavailable)".
- **Policy class on commands.** Command rows the host policy flagged carry `policyClass`: `subagent_launch`, `protected_path`, `auto_run_all`, `model_requested_approval`, `not_read_only`. Unflagged: "auto-run off" asks and host-classified read-only runs.
- **Proto path.** Additive `ClineMessage` fields 1004-1010 (`info_class`, `info_severity`, `info_detail_json`, `mcp_level`, `exit_code_state`, `exit_code`, `policy_class`) round-trip through `convertAiHydroMessageToProto` / `convertProtoToAiHydroMessage`. `execOutcome` gains the value `"unknown"`; W2-0's mapper fix must carry it.

### Added — Learning Pack authoring tool `aihydro-pack` (vision-2040, branch `vision2040/aihydro-pack`; plan `docs/vision-2040/plans/learning-pack-signing-tool.md`)

- **Build and sign a course as a `.aihydropack`.** `npm run build:pack-cli` builds `dist/aihydro-pack.cjs` (a separate bundle; it is excluded from the VSIX and a bundle guard fails the build if any authoring code reaches `extension.js`). Commands: `init-key`, `fingerprint`, `build`, `sign`, `verify`, `inspect`. Guide: `docs/learning-pack-authoring.md`.
- **`build` is separate from `sign`.** `build` writes an unsigned, byte-deterministic archive (stored ZIP, fixed 1980 timestamp, `generatedAt` from `SOURCE_DATE_EPOCH` or the commit time) and aborts before writing anything unless the extension's own verifier accepts it. A release build needs the publisher public key and a clean git work tree. `pack.config.json` is parsed fail-closed (unknown keys are errors). `idMap` / `idPrefix` give a signed pack namespaced course and module IDs (so it does not collide with the unsigned catalogue install); only the module `id` inside the `vnd.aihydro.module+json` block is rewritten and each change is recorded in `provenance.transforms`. `course.json` is rebuilt from an allowlist (`downloadUrl` and `trustLevel` are dropped).
- **`sign` verifies before it writes.** It checks the key fingerprint against the pack's key ID, signs the exact `checksums.json` bytes, runs the full verifier, and writes only a `valid` result. `sign --ephemeral` (development builds only) signs with a throwaway key and always installs as signed-untrusted.
- **Key handling is for the owner, not an agent.** `init-key` and `sign --key` exit 3 and write nothing when `AIHYDRO_AGENT_CONTEXT`, `AIHYDRO_ACTIVE` or `CLAUDECODE` is set or there is no terminal. The key is an Ed25519 encrypted PKCS#8 file (scrypt + AES-256-CBC), created exclusively with mode 0600 in a 0700 directory, never overwritten, refused inside a git work tree; the passphrase is read from the terminal only (no flag, environment variable, file or stdin path) and nothing about the key is printed. The command policy denies `aihydro-pack sign` / `init-key` (and the `authoring/` signer sources) to the agent with the same escape-variant handling as `aihydro-approve`; `build`, `verify` and `inspect` stay allowed. This is a guard, not a boundary: the passphrase is the real protection.
- **Release provenance cannot be false.** A release build refuses any included file that git does not track (including gitignored files; names are matched literally, not as pathspec globs) or whose bytes differ from the blob committed at HEAD (so `--assume-unchanged` / `--skip-worktree` edits cannot ship), requires `--source-commit` to equal HEAD, and `provenance.sourceDirty` is `null` (unknown) outside git or for a non-HEAD commit, never `false`. Output files are written to a temp file and moved into place, and a symlink at the target is refused. The passphrase reader turns echo off before it writes the prompt. The command policy also denies commands that name `~/.ssh/aihydro-learning-pack` or `ed25519.key.pem`; `init-key --no-passphrase` prints an UNENCRYPTED warning. The `openInstallLearningPack` RPC is debounced on the host.
- Shared contract primitives (`compareContractPaths`, checksums, fingerprint, signature document, deterministic ZIP writer) now back both the authoring tool and the test fixtures. The verifier uses the same `compareContractPaths` (code-unit order, identical to the previous default `sort()`), which fixes the fixtures' `localeCompare` ordering drift.

### Changed — Studio: honest copy for unsigned catalogue modules

- A catalogue module's trust bar now reads **Read-only course copy**: "This copy was downloaded without a signature, so AI-Hydro will not run its Python. Install the signed Learning Pack to run cells." It carries a host-chrome **Install Learning Pack…** button (real click only; page content cannot trigger it) that opens the normal install flow. `docs/studio-trust-model.md` now says a pack is "signed by the key with this fingerprint" instead of claiming signatures prove who built it.

### Fixed — Learning Pack verifier rejects a leading UTF-8 BOM (vision-2040, branch `vision2040/verifier-bom`)

- `parseCanonicalJson` decoded with a `TextDecoder` that strips a leading BOM by default, so its "must not contain a UTF-8 BOM" check never fired and a BOM-prefixed contract JSON file (for example `pack.json`) verified. It now decodes with `ignoreBOM: true`, so such a pack is `invalid` (`BOM`). **This tightens acceptance:** a pack that was previously accepted only because its BOM was ignored is now rejected. The signature and checksums always covered the exact bytes, so no valid-signature pack becomes forgeable either way; the vector in the test is re-checksummed and re-signed so the BOM is its only defect.

### Fixed — keyless basemaps (vision-2040, branch `vision2040/basemap-keyless`)

- **Default basemap was a watermark.** CARTO now answers every keyless tile request (any style, any location) with one "API KEY REQUIRED" image, so the default and the Carto Light/Dark/Voyager entries were unusable. The default "Hydrology default (muted)" now uses Esri Light/Dark Gray Canvas (global, keyless, attribution shown); the Carto entries are removed (no CARTO key setting exists).
- A dismissed coverage notice re-arms only after the view has stayed in coverage for 1.5 s, so panning along the border does not re-show it.
- A saved choice that no longer exists (Carto, Stadia, Mapbox, Humanitarian OSM, unknown) moves to the default with a one-time notice that names the reason.
- **No more silent blank map.** US-only basemaps (USGS Topo/Imagery/Shaded Relief) carry coverage metadata; when the view is outside coverage a non-blocking notice says so and offers "Use Hydrology default". A basemap that answers every tile in view with one identical image and returns the same image for a fixed land control tile (z3, 45-90E, 0-41N) shows a "Basemap unavailable" notice (a general placeholder check, not per-provider; open ocean alone never triggers it; a control tile that cannot be fetched or hashed claims nothing and is not retried).
- The in-chat Leaflet preview bridge: `carto-dark` is now an alias of `esri-dark-gray` and `osm` an alias of `esri-topo`; CARTO is dropped from the artifact-preview CSP. Humanitarian OSM (OSM France) is removed: its usage page limits use to non-profit sites and apps sending an identifying user-agent, which a webview cannot do; a saved choice migrates with a notice.
- Provider verification (keyless, coverage, max zoom, attribution, terms) is recorded in `webview-ui/src/components/map/basemaps.ts` and enforced by the catalogue tests.

### Changed — Wave 2 chat redesign groundwork, W2-0 (vision-2040, branch `vision2040/w2-0`; no user-visible change)

- **Proto round trip.** `convertAiHydroMessageToProto`/`convertProtoToAiHydroMessage` now preserve every say and ask kind and the `askOutcome`, `execOutcome` and `commandCompleted` fields (the partial-update path used to drop them, and `html_preview`, `shell_integration_warning_with_suggestion`, `install_dependencies` and `workspace_env_setup` were mapped to other kinds). AI-Hydro-only kinds use enum numbers of 1000 or more and the new fields use numbers 1001 to 1003, so upstream Cline additions cannot collide; `ANSWER_AUDIT = 1001` is reserved and not emitted yet. Tested over every enum value.
- **Frozen contracts** in `src/shared/aihydro/transcriptContracts.ts`: `AnswerAuditPayload` v1 (with `AnswerRevisionEvent` and the draft-storage decision), the `InfoNotice {class, severity}` shape and a legacy prefix registry for existing plain-string info notices (unmatched text is lifted).
- **Screen harness.** `expectAbsent` assertion (with a self-test), plus synthetic transcript screens for the turn machinery, lifted failures, long tool runs, approvals, claims, the legacy audit text, truncation, condense, non-zero exit, cancel, resume, rewind, checked-out checkpoint and an old task without outcome fields. Their budgets record today's counts (new entries only).

### Fixed — DeepSeek unclosed envelope and task_progress (vision-2040, branch `vision2040/deepseek-unclosed-envelope`)

- A DeepSeek native envelope that ends without `</tool_calls>` is now repaired when every `<invoke>` is closed and only whitespace follows the last `</invoke>` (an unclosed invoke or trailing text stays malformed).
- A Cline `task_progress` parameter inside an MCP invoke is no longer sent to the MCP server: it is carried as the call's own task_progress so the focus chain updates. A tool that declares `task_progress` in its own schema keeps it as an argument.
- Only an envelope that starts its line is repaired; one after prose on the same line (for example a message that ends mid-quote) is neutralised and never runs.

### Fixed — native tool-call repair follow-up (vision-2040, branch `vision2040/native-repair-followup`)

- A DeepSeek native envelope that is not the last thing in the message (prose or a closing fence after it) or is unclosed no longer vanishes: the text is shown, nothing runs, and one muted line says "Native tool call not at end of message; not run." (or the malformed notice).
- A first-party-named but untrusted server is no longer a routing target for a repaired call while a trusted first-party server is connected (anti-confusion, not a security control; approval is the control).
- Security fix: a non-trailing envelope is now neutralised (`<` escaped) before the transcript is re-parsed, so protocol tags nested inside it (for example `<execute_command>` in a parameter) can never become a tool call; its raw text is shown behind the muted notice.
- Documented: built-in parameters with tags are refused in the envelope, a repaired call can reach a lone untrusted owner (approval names the server), and the trust hash does not cover a process-inherited PATH.

### Fixed — session-study quick fixes (vision-2040, branch `vision2040/session-study-quick`; study items U1 U2 U5 U6 M2 S6 M5)

- **Scroll to bottom no longer hides the buttons.** It is a 24px floating round button (bottom right of the transcript, accessible name "Scroll to bottom"); Run / Deny, Start New Task and other asks always render their buttons.
- **Citation markers.** A backticked whole marker (`` `[run:id#key_outputs.q_mean]` ``) renders as a chip; ids must start alphanumeric, so `[lit:...]` and `[lit:<tag>]` are plain text; audit fix hints are shown as code. The canonical run path is `key_outputs.<field>` (the extension ships no marker grammar of its own; a guard test fails if prompt text teaches `#data.`).
- **No approval for a tool that does not exist.** `use_mcp_tool` checks the server and tool name before asking. The model gets a structured error with the closest names; you see one muted line. A server whose tool list is unknown (failed `tools/list`, not connected) is never blocked.
- **First-party trust.** The recorded launcher now also covers the server's `env` and `cwd` (hash only, no values stored). If the recorded server is disabled and exactly one enabled server has a first-party name and launch shape, AI-Hydro re-points the trust record silently only for an identical launch (command, args, env, cwd); anything else asks you, and a look-alike or an ambiguous pair is never trusted. Records written before this change read as an empty context, so an entry with environment variables asks once. The MCP servers list shows **Trusted** / **Not trusted** with the reason.
- **Agent to-do (self-reported).** The header says "Agent to-do (self-reported) n/m" (items checked), a complete list reads "All items checked" (no exclamation), and a `task_progress` row is posted only when the list changes.
- **Task header.** The study chip shows the gauge/study id first and untruncated; the bare X is now a labelled **New task** button (accessible name changed from "Start a New Task"; e2e specs updated).
- **Native tool-call repair (DeepSeek).** For DeepSeek models only, a trailing `<tool_calls><invoke name=...>` envelope is rewritten into a real tool call after the message completes and goes through the normal approval flow; a muted line says which server it was routed to. Values are inert (MCP arguments JSON-escaped, built-in parameters containing protocol tags refused), shared tool names prefer the single trusted server, and quoted, indented, fenced or non-trailing envelopes are left as text. An unparseable envelope shows one muted "malformed tool call; retried" line with the raw text behind a disclosure.

### Changed — Studio: one name, honest sidebar, working catalogue installs (vision-2040, branch `vision2040/studio-p1p2`)

- **One name: "AI-Hydro Studio".** Toolbar tooltip, Explorer menu ("Add to AI-Hydro Studio"), settings descriptions, panel and webview titles, chat card, error and confirmation messages and the `preview_html` tool description no longer say "HTML Preview" or "AI-Hydro Preview panel". Command ids, `preview_html`, `aihydro.htmlPreview.*` and proto names are unchanged. A guard test (`studioNamingGuard.test.ts`) fails if an old name returns in `package.json` contributes, webview strings or extension/agent-facing text.
- **Catalogue installs work against the live index.** The live index lists every `downloadUrl`/`manifestUrl` on `raw.githubusercontent.com`, which the allowlist denied. It now admits that host for module and course installs only (skills keep their own table) under the exact prefix `https://raw.githubusercontent.com/AI-Hydro/Modules/main/` (repo plus named branch, same shape as the skills policy; no org-wide rule, SHA/fork paths, query, fragment, port, userinfo or percent-encoding). https stays required.
- **Network failures are errors.** A failed catalogue fetch rejects the RPC and the marketplace keeps its tabs and shows the error with Retry inline (also on a partial failure); it no longer shows "No courses found".
- **No invented licence.** A catalogue entry that declares no licence shows "License not declared" (it used to show CC-BY-4.0). Every catalogue card states "Unsigned catalogue module" (course cards: "Unsigned catalogue course"); zero or unknown install/star counts are hidden.
- **Honest sidebar.** The static Skills section is removed (the Skills toolbar button remains). "Comments" is now "Requests to agent" and no longer shows Send/Clear buttons that did nothing; sending stays in the Edit Mode bar. The empty state offers real starting points (Browse courses, Add a document, Install Learning Pack, ask the agent for a report) instead of HTML-file instructions.
- Known gap: the server-side docstrings of `show_html_preview` (aihydro-tools) still say "HTML Preview panel"; that repository is out of this change.
### Fixed — Chat honesty and header icons (vision-2040, branch `vision2040/chat-c1-c7`; audit C1 + C7)

- **No green except an approved claim, across everything a transcript can reach** (chat rows, task header, common, browser, history, MCP chat display, the design module and the global stylesheet). The answer is a neutral "Answer" (was a green "Task Completed") with normal-colour text and a neutral "See new changes" button. Finished API requests, the plan bar and badge, to-do checkmarks, the timeline completion colour, the context bar, the auto-run chip, the browser connected status, the Act mode colour (now the theme button colour) and the Tailwind `success` colour no longer use green. Claim chips take colour, icon and shape from `design/evidenceStates.ts`. `colorBan.test.ts` scans those surfaces for green theme tokens, `emerald`/`green`, `success` classes and green-hue hex/rgb literals. Other panels (Studio, settings, maps, boards) are separate surfaces and are not covered by that scan.
- **Tense comes from evidence, never from row position or from the approval alone.** The host records the user's decision (`askOutcome`) and, when a tool's result comes back, `execOutcome` ("completed" or "failed"). A row reads "wants to ..." only while pending; "Approved: ..." once allowed but with no result yet; "Running: ..." for an auto-run call (a `say` row is written before the tool starts) until completion evidence arrives; past tense ("ran", "edited", "used a tool") only with execution evidence (recorded completion, command output or completion, an MCP response); "Failed: ..." on an error row, a failure result or an MCP response that starts "Error:"; "Denied: ... (not run)" when denied; and "asked to ..." when nothing proves what happened (superseded, cancelled, resumed, or recorded before this change). A science card says "Not run yet: waiting for your permission.", "Approved. No result recorded yet.", "Not run: you denied this call." or "Failed: no result was recorded." accordingly.
- **Vocabulary.** Tool, MCP and browser asks use "Run" / "Deny" (edits "Save" / "Deny"; commands "Run Command" / "Deny"). "Approve" is reserved for claims.
- **Escape stops a task only when it is running and the prompt has focus.** The window-wide listener is gone; Escape does nothing while idle, and in an open slash or @ menu it only closes the menu.
- **Header icons: 11 become 4 inline.** New Analysis, Map View and Analysis History stay inline; Evidence Board, Experiment Table, Session Replay and HTML Preview are in a "Science views" submenu; Hydro Tools & Data Sources, External Connectors, Skills and Settings are in the "..." overflow. Command ids and titles are unchanged.

### Fixed — release-blocking trust and leak issues (vision-2040, branch `vision2040/trust-leaks`)

- **Removed every `npm install -g` suggestion (P0-1; the package name was unregistered when found, and the CLI it installs is not a shipped, reviewed product).** The home-screen CLI banner, the `installAiHydroCli`/`installClineCli`/`updateCliBannerVersion` RPCs and handlers, the Settings "Install Now" button and the `lastDismissedCliBannerVersion` state key are gone. The subagents toggle stays disabled with a plain explanation. A source-tree test and the new bundle guard fail if the string returns.
- **Connectors cannot inject prompts and the Earth Engine card works again (P0-2).** A remote `setupPrompt` is always discarded; only built-in prompts reach the chat. The live `actions[]` schema is supported through a hard-coded allowlist (`connect|test|configure|disconnect`): the webview sends only an action id (new `runGeeAction` RPC) and the host maps it to a built-in command; unknown command ids are dropped. Remote entries can update display text only. GEE `connect` now allows 5 minutes for the browser sign-in. Duplicate palette title fixed ("Show Google Earth Engine Status").
- **Release leak guard** `scripts/check-bundle-leaks.mjs` (run by `check:extension-bundle`, `ci:check-all` via `test:leak-guard`, and the UI-screens workflow on the webview build) fails on `cline.bot`, the global npm install command, Cline repo/wiki links, `HTTP-Referer` values pointing to Cline and any `workers.dev` host except the recognition host, which is allowed only with its telemetry gate.
- **Cline identity removed.** `HTTP-Referer`/`X-Title` in OpenRouter, Requesty, Vercel AI Gateway, Z AI and the AI-Hydro provider now identify AI-Hydro (`https://github.com/AI-Hydro/AI-Hydro`); the link-preview User-Agent likewise; `*.cline.bot` is out of the webview CSP; the truncation warning no longer links to the Cline wiki; the dictation error points to this repository.
- **Recognition respects telemetry consent.** No request (events, counts, stars) is made to the recognition host unless VS Code's telemetry setting (`vscode.env.isTelemetryEnabled`, via the host bridge) and AI-Hydro's own telemetry setting both allow it; it fails closed. `PRIVACY.md` now says this is telemetry with a stable pseudonymous client hash. Retiring the call is a later work package.
- **Map search no longer autocompletes against public Nominatim.** Place names are geocoded only on Enter or the Search button, cached, and spaced at least 1 s apart; typing still looks up coordinates and USGS gauges/NID dams. The 7 hard-coded gauges are removed, and the server's `problems` list (or a failed command) is shown as "USGS lookup incomplete: ..." instead of an empty list. Stale lookups are discarded. Limitation: a webview cannot set `User-Agent`, so OSMF's application-identification requirement is not fully met until geocoding moves behind the extension host or a compliant provider.

### Fixed — Evidence: green means approved, no Demo, one AI-Hydro home (vision-2040, branch `vision2040/evidence-wp01`)

- **Green means a verified human approval, nothing else.** The Evidence Board and Session Replay now take their colours from `design/evidenceStates.ts`. An agent-asserted `supported` claim is labelled "Supported (agent-asserted)" in a neutral colour (lane "Supported, not approved", no longer "Citable"). "In sync", "0 need review", "recorded checks passed" and "0 failed" are neutral. Scientific status and approval authority are separate axes on every card.
- **`describeApproval` fails closed.** A claim renders as Approved only when the verifier stamp passes an allowlist: a signed channel (`ssh_sig[_sk]_system_trust` or `ssh_sig[_sk]_supplied`) matching a system or supplied trust root, policy `signed_required`, and both revision digests present and equal. A missing, empty or unknown channel, policy, trust root or digest is "Accepted (integrity only)" with the gaps listed. An approved claim that a registry row cites (`consumed`) reads "Approved · promoted" instead of "Approval already used" when its stamp passes the same allowlist.
- **Runs are not claims.** Runs that no claim cites are no longer shown as `tested` "evidence candidate" claims or counted in the claim total (they stay in Session Replay). The client no longer rewrites a server `supported` status to `weakly_supported`; a supported claim with no evidence carries a "no evidence linked" flag instead.
- **Demo buttons removed** (Evidence Board, Session Replay, Experiment Table), together with the guide instruction to copy a fixture into `~/.aihydro/sessions` and the unreferenced fixture file. The installed build never contained the fixture.
- **`AIHYDRO_HOME` is honoured end to end** (extension side). One helper, `src/shared/aihydro/aihydroHome.ts`, resolves it (default `~/.aihydro`) for sessions, ledger events, map and preview events, caches, skills, modules and the rest; the server side is done separately.
- **Replay arrow keys** move the run selection only while focus is in the run list, so the session list and filter input keep their own keys.

### Security — Approval redesign AP1 (vision-2040, branch `vision2040/approval-ap1`)

This slice only tightens behaviour. Some things that auto-ran before now ask; nothing that asked before runs without asking. Design and acceptance tests: `docs/vision-2040/findings/critique-approval-policy-2026-10-19.md` (ecosystem repo); plan and known limits: `plans/approval-redesign-ap1-2026-10-19.md`.

- **Commands: the host decides what is read-only (B1).** "Execute safe commands" is now **"Run read-only commands"**. A command auto-runs only if AI-Hydro itself classifies it as read-only from a short allowlist (`ls`, `cat`, `grep`, `git status` and similar, optionally piped into other read-only commands) with a per-program flag allow-list. `;`, `&&`, `||`, redirection, `$(...)`, backticks, here-docs, `$VAR`, globs, braces, comments, `python -c`, `sh -c`, `curl`, unknown programs and any unlisted flag ask. On Windows, or when your shell is not bash/zsh/sh/dash, nothing auto-runs as read-only. `git` auto-runs only in a trusted workspace (a repository's own config can make git run programs) and runs with a hardened environment; in Restricted Mode git always asks. The model's `requires_approval` can only make a command ask more. This is a filter, not a sandbox. **Behaviour change:** with default settings, commands the model called "safe" but the allowlist does not know (for example `python script.py`, `npm test`) now ask.
- **Claim approval is hard-denied for the agent.** A command mentioning `aihydro-approve`, `ai_hydro.approval` or `ai_hydro/approval` (after quotes and backslashes are stripped) is refused in every mode, YOLO included, with a message telling you to run claim approval in your own terminal. A text match cannot catch indirection (a variable that builds the name, a script file, an encoded payload); the approval CLI's own refusal in agent-marked contexts and a touch-required (`sk-`) signature are the other layers.
- **Subagents (B2).** Launching an `aihydro` subagent always asks, is refused when subagents are disabled, and no longer injects `yolo_mode_toggled=true` / `-y`. The subagent now runs under the aihydro CLI's own approval policy and may pause for approval in its terminal; the parent's policy is not forwarded because the CLI's settings keys could not be verified. The launch notice says so.
- **Protected paths (B3).** File writes to the MCP settings file, the extension's global storage (settings and state), `$AIHYDRO_HOME/{approvals,trust,registry}` and `~/.ssh` ask even with Edit auto-run, "Edit all files" or YOLO; commands that mention them ask too. Edits to the MCP settings file made outside the AI-Hydro UI that would let tools run without asking (new `autoApprove` entry, trust turned on, `deny`/`alwaysAsk` entry removed) are applied only after you confirm; declining rewrites the file without them. Tightening edits apply immediately.
- **One trust test (B4).** `isServerTrusted` (used by claim-approval prompts, the explorer profile and `firstPartyServers.ts`) trusts the first-party server only if its name AND its launch command/args match the launcher recorded when the extension registered it (`aihydro_first_party_launcher.json` in the extension settings directory). Servers registered before this version are recorded from their existing entry if it has the `aihydro-mcp` / `python -m ai_hydro.mcp` shape. If the launcher later changes you are asked to trust it again.
- **Agent context marker (B4).** `AIHYDRO_AGENT_CONTEXT=1` is set in agent terminals, background/test-mode command execution, CLI subagents and every MCP stdio server the extension launches. The approval terminal never sets it and explicitly clears it (`env` value `null`).
- **Explorer (M4).** Explorer MCP calls need a trusted server AND a read-only, closed-world tool (`readOnlyHint=true` and `openWorldHint=false`).
- The settings file schema now recognises reserved `trustAnnotations`, `alwaysAsk` and `deny` fields. Nothing enforces them yet (AP2).

### Added / Fixed — Harness quick wins (vision-2040, branch `vision2040/harness-quickwins`)

- **Model layer honesty.** An unknown model id no longer silently falls back to the provider default: static-registry providers raise a clear error naming the id (and how to select or add a model); dynamic-list providers (OpenRouter, Requesty, Groq, Baseten, Hugging Face, Huawei MaaS, Vercel AI Gateway, AI-Hydro) send the id you chose.
- **New model ids** `claude-fable-5-1`, `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5` (Anthropic, Bedrock; Opus/Sonnet 5.5 on Vertex). Prices and limits are not verified, so cost shows "cost unavailable (pricing not verified)" for them. See `docs/model-config/claude-5x-models.md`.
- **Prompt caching and thinking are driven by model flags**, not a hard-coded id list: caching now applies to the default model and all 4.5+ models; 4.6+ uses adaptive thinking + effort instead of `budget_tokens`; no explicit temperature when thinking is on or the model rejects it. Cost display marks a lower bound when a cache price is unknown.
- The provider-reported model id is passed to ai-hydro MCP calls as `_meta["aihydro/context"].model_id_returned`. Claude 5.x and Gemini 3.x are recognised as next-gen families.
- **Prompts.** Removed "assume the terminal executed the command successfully" (all variants incl. compact), unified the skills policy (consult when relevant, not a mandatory pre-flight), removed web-development advice, added a shared "Scientific conduct" section to every variant. Removed the unused `system-prompt-legacy/` copy.
- **Explorer subagent is now genuinely read-only**: tool allowlist, and MCP tools only if read-only and closed-world (`readOnlyHint=true`, `openWorldHint=false`) on the trusted first-party server (see Approval redesign AP1).
- **Final-answer audit** (Settings > Features > "Audit final answers", default on): on completion the answer is checked by the connected AI-Hydro server's `audit_interpretation` against the study bound to the chat and the result is shown (display only; "audit unavailable" on failure). The answer text is sent to that server (see PRIVACY.md).

### Fixed — UI S2 review conditions (vision-2040, branch `vision2040/ui-s2`)

- **History titles are rendered as React text, never HTML.** `HistoryView` no longer uses `dangerouslySetInnerHTML`; search matches are `<span>` text nodes. `stripMarkdown` strips tags until stable (nested `<<b>img ...>` payloads) and no longer eats `_`/`*` inside identifiers (`snake_case_name`, `a_b_c`).
- **UI screen budget is a real gate.** `--check` requires rendered ids == budget ids (or, under `--screens`, a budget entry per requested screen), fails on an absent `ref` cell, and CI's `dark,hc-light` subset has its own recorded per-screen totals (`--require-matrix-budget`). A new CI step (`check-budget-monotonic.mjs`) fails a PR whose budget counts exceed the base branch. The unrouted-request detector now also covers `requestfailed` and WebSockets, and "local" means only the harness origin and port. `actions/upload-artifact` is SHA-pinned. See `scripts/ui-screens/README.md`.
- **Wording.** Auto-approve text now says it "Does not approve claims" (claim approval is a signed step performed in a terminal, `aihydro-approve`); legacy MCP labels read "Tool auto-run" / "Auto-run all tools" (setting keys unchanged); history cards read "Investigation record not linked yet"; starter cards say "USGS water data services (as configured)". **`describeInvestigation` is a stub** until the host exposes the task-to-session mapping, so every history card shows that line.
- **Reduced motion.** Working cues (spinners, typing dots, running-status pulses; opt in with `.motion-essential`) keep looping; decorative animation is still collapsed. The map fly-to jumps instead of animating under `prefers-reduced-motion`.
- **Plan/Act switch is keyboard operable**: a `radiogroup` of two `radio` buttons with roving tabindex and arrow keys; focus stays on the switch when switched from the keyboard.

### Added — UI screen harness and design-system foundation (UI-W S0/S1)

- Headless screen harness (`npm run ui:screens`, `scripts/ui-screens/`): renders the real webview panels over synthetic, visibly badged FIXTURE data with the host mocked and all non-local traffic answered from fixtures, across themes, widths and font sizes. A built-in checker records missing accessible names, sub-24 px targets, sub-11 px text and contrast; a committed budget (`webview-ui/screens-baseline/checker-budget.json`) can only shrink. `npm run ui:screens:verify-bundle` fails if the harness reaches the production bundle. Dev-only; nothing ships in the VSIX.
- `webview-ui/src/design/`: theme-derived tokens (`tokens.css`, imported by `index.css` as custom properties only, no visual change), a single evidence-state table (`evidenceStates.ts`: only `approved` can use the success colour, every state has a label, icon and shape) and accessible primitives. A lint guard prevents new sub-11 px text and emoji in science-facing components.

### Fixed — `q5` / `q95` documentation follows CAMELS (defect P2-D0)

- `docs/tools/analysis.md` and `docs/glossary.md` described `q5` as the high flow and `q95` as the low flow. CAMELS (Addor et al. 2017, Table 3) defines `q5` as the 5% flow quantile (low flow) and `q95` as the 95% flow quantile (high flow); `aihydro-tools` computed them the other way round until the matching fix (branch `vision2040/q5-q95` in aihydro-watershed, aihydro-tools, aihydro-lsh, camels-attrs). Documentation only; no extension code reads `q5`/`q95`.

### Fixed — Author-machine hard-codes in Python interpreter resolution (vision-2040 G0, ADR-006)

- Map hydrology (`MapHydrologyService`) and GEE (`GeeService`) CLIs no longer probe
  `/opt/miniconda3` / `/opt/homebrew` first and no longer inject
  `PYTHONPATH=~/Documents/AI-Hydro/MCP/aihydro-tools`. They share one resolver
  (`resolveAiHydroPython`): explicit `aihydro.hydro.pythonPath` / `aihydro.gee.pythonPath`
  setting, then the interpreter behind the registered `ai-hydro` MCP server (command or
  `aihydro-mcp` shebang), then `VIRTUAL_ENV`, then `python3`/`python` on PATH; the first that
  can import the package wins. If none can, the error says to `pip install aihydro-tools` or
  set the setting. New setting `aihydro.hydro.pythonPath`; `aihydro.gee.pythonPath` now
  defaults to empty. Failed resolutions are not cached.
- Security hardening: both interpreter settings are `"scope": "machine"` and are read from
  user/machine scope only (workspace `.vscode/settings.json` values are ignored with a logged
  note), so an opened repository cannot choose the executable the extension spawns. Bare
  interpreter names are resolved to absolute paths through PATH entries only (never the cwd, no
  relative PATH entries), closing Windows' implicit current-directory lookup.
### Added — Revision/approval surfaces and MCP context `_meta` (vision-2040 slice 2 P4, ADR-002b A4)

- Evidence Board shows each claim's sealed revision, drift state and approval
  state. Only an explicit `approved` state is styled as approved (with
  channel and trust root, e.g. "signed · system trust"); `none`, `consumed`,
  `unverifiable`, unreported, or an approval issued for a different revision
  digest are never shown as approved.
- Session Replay hides minimal recorded-call rows by default behind a
  "Show N recorded calls" toggle; run/claim normalisation carries the new
  backend fields additively and tolerates their absence.
- ai-hydro tool calls now also send MCP request `_meta["aihydro/context"]`
  (`chat_id`, `workspace`, `client: "vscode"`); the legacy hidden
  `_chat_id`/`_workspace` arguments are kept for one release.
- When a tool result is `APPROVAL_REQUIRED`, an "Approve in terminal" action
  opens a terminal with the backend-provided `approval_command` typed but not
  run; a human presses Enter. The extension never signs, holds keys, or
  writes approvals. The command is rebuilt client-side as
  `aihydro-approve <session_id> <claim_id>` from the top-level refusal
  envelope of an ai-hydro result only, after charset validation; the
  backend-supplied `approval_command` is never used, and invalid ids show an
  explanation with no pre-filled command.
- Approved styling requires a `system` or `supplied` trust root, no
  `unsigned_opt_out` policy and no same-user channel; everything else the gate
  accepts renders as "Accepted (integrity only)" with the policy shown. New
  backend states `stale_evidence`, `stale_revision`, `evidence_unchecked`
  (and drift `evidence_unchecked`) are labelled explicitly as not approved.
  Hidden minimal rows with a `record_error` still count as failed.

### Fixed — Skill installer integrity (vision-2040 slice 1c, ADR-005)

Skill `SKILL.md` text is concatenated into the system prompt, so the install
path is now verified before any content reaches disk or a prompt.

- `installSkill` validates `skillId` against `^[a-z0-9][a-z0-9-_]{0,63}$` and
  proves the resolved directory stays inside `~/.aihydro/skills/marketplace`
  (path traversal such as `../x` is rejected before any network or disk work).
- `skillUrl` must pass the marketplace origin allowlist (the same
  `assertTrustedMarketplaceUrl` used by modules/courses). Because the live
  Skills catalog serves `skill_url` from `raw.githubusercontent.com`, that
  host is accepted only under an explicit repo + named-branch table:
  `AI-Hydro/Skills/main/` and `AI-Hydro/swatplus-builder/main/`. Other repos,
  other refs (including 40-hex SHAs, which GitHub serves for unmerged fork
  PRs under the upstream path), percent-encoding, dot segments, ports,
  userinfo, queries and fragments are rejected. Redirects are re-checked
  against the same policy (fail closed), and downloads are capped at 1 MiB.
- Digest: the install request and `Skills/api/skills.json` carry no sha256 yet,
  so installs are recorded in `installed.json` with the downloaded `sha256` and
  `verified: false` (and logged as UNVERIFIED). The installer already verifies
  a supplied digest and refuses a mismatch before writing; it activates when a
  catalog provides one.
- Injection-time re-check (`skills.ts`): before a skill's text enters the
  system prompt its file must resolve (symlinks included) inside
  `~/.aihydro/skills/<source>/`, and if `installed.json` recorded a `sha256`
  the file must still hash to it; otherwise the skill is skipped and logged.
  Skills installed without a catalog digest (`verified: false`, i.e. all
  installs until the Skills catalog ships sha256) are still injected, with a
  one-time UNVERIFIED log line per skill. This is integrity against later
  tampering, not authenticity: an unverified download is only as trusted as
  its origin.
- `deleteSkill` and `saveSkill` now also refuse ids that resolve outside their
  source directory (`deleteSkill` previously `rm -rf`'d an unvalidated path).

### Added — AI-Hydro Studio naming (ADR-004)

- The HTML Preview panel's VS Code tab now reads **AI-Hydro Studio**.
- New command-palette entries `AI-Hydro: Open in Studio`, `AI-Hydro: Show
  Studio`, and `AI-Hydro: Add Artifact to Studio`, alongside the existing
  `HTML Preview` toolbar button and `Add to AI-Hydro HTML Preview` context
  menu item, which keep working unchanged. No command, setting, or message
  IDs were renamed.

### Changed — Reconciled the shipped 0.3.x line (`feat/deepseek-harness-hardening`) into `main`

The Marketplace 0.3.0 was built from the `feat/deepseek-harness-hardening` line and never merged, so `main` (0.2.7) lacked everything it shipped. That line (head `ba06b214f`) is now merged, which makes every shipped commit an ancestor of `main`. `package.json` still reads 0.2.7: the version number is an owner decision (it must be above 0.3.0). The entry below under `[0.3.0]` was backfilled on 2026-07-01 from the branch and is **not** claimed to match the published bundle exactly; the published bundle contains no Inundation 3D or time-slider UI strings.

Brought onto `main`: capability-aware model routing and tool-input repair (including multi-line JSON repair), the offline harness-resilience scorecard (`npm run eval:harness`), the batch `edit_files` tool and real stop, native-platform-primacy MCP prompt grouping, the session-binding chip and cloud-storage warning, terminal-reuse and alias-binding freeze fixes, map swipe / transect / annotation / context-menu / photo-strip panels and the Map Plate templates, Inundation 3D and the time slider, WebGL context-loss recovery, the black-screen fixes, catalog hydration and large-layer lazy loading, agent-native map control (`fly_to`, `add_layer_from_run`, `set_time_range`), reactive HTML-preview parameters, the inline custom-answer field, chat scroll-to-bottom, and the course marketplace search / sort / recognition UI.

Fixed on `main` as part of the reconciliation:
- Chat run chips (`[run:id#path]`) no longer render a green check, "verified" or "Value verified by Answer Auditor" for any text the model writes; they are a neutral "run reference" until a host-supplied auditor result exists.
- `command.set_time_range` was a no-op end to end (it set the brush, nothing read it). `TimeSliderPanel` now adopts an externally set brush as its date range and applies the layer filter; tested.
- Agent map commands (`fly_to`, `fit_*`, `set_time_range`) are de-duplicated across layer changes (the host replays recent events on every subscribe); hover tooltips escape layer names and property values.
- `isAiHydroServerName` no longer matches any server starting with "aihydro": it was sending the workspace path and chat id (`_meta["aihydro/context"]`) to such third-party servers. It now matches an explicit first-party set (`ai-hydro`, `aihydro`, `aihydro-tools`, `ai-hydro-tools`, `aihydro_tools`) plus names listed in the `AIHYDRO_TRUSTED_MCP_SERVERS` environment variable (comma separated). Anyone who registered the server as `aihydro-core`, `aihydro-data` or `aihydro_core` must list that alias.
- `set_time_range` timestamps are strict ISO-8601 (date or date-time with optional Z/offset), `end_iso` must not precede `start_iso`, and `layer_id` is length-bounded. Course and module card links (author, discussion, GitHub, citation) render only for http(s).
- `mapCommandSchema` now accepts the agent map-control fields with bounds (longitude -180..180, latitude -90..90, zoom 0..24, `duration_ms` ≤ 60 s, string-length caps, ISO-8601 `start_iso`/`end_iso`); previously `main` stripped these fields and logged "Unknown command type", so agent map control did nothing.
- Chat claim chips gained the `stale` status and no longer imply approval: only an explicit, verified `approved` state (same helper as the Evidence Board) is styled as approved; "supported" is no longer green.
- `buildTransectAgentPrompt` and the batch-transect prompt called an undefined `formatVisibleLayers` (a defect on the release branch); it is now defined.
- Catalog-supplied contributor links in the course cards are only rendered as anchors when they are http(s).
- Webview CSP `connect-src` now includes the webview resource origin so large layers and 3D manifests (which are stripped from the gRPC snapshot) can be loaded from disk. Rationale: the map webview `fetch()`es `asWebviewUri` URLs for files the host has already authorised through `localResourceRoots`; the origin can reach nothing outside those roots and no remote host is added. Considered alternative: have the host read and stream the files over gRPC, which re-introduces the multi-MB payloads (and webview OOM / blank map) that the snapshot sanitising exists to avoid. Script loading is unaffected (`inlineDynamicImports`).

Branch behaviour deliberately dropped or replaced by `main`'s later implementation (none of these is silently lost):
- Reproducibility panels (`395b79ccf` and the ledger / panel parts of `682dd3498`): `main`'s re-port plus the P4/E5 approval work is kept wholesale (`sessionSurfaces`, the three providers and panels, `LedgerContext`, `ledger.proto`, `LedgerEventWatcher`, `getLedgerState`, their docs and the demo fixture). Branch behaviours not found on `main`: the Evidence Board manual-session text controls and recent-session suggestions in the Evidence Board (Experiment Table and Replay already suggest recent sessions). Follow-up, not ported here.
- `7dc3e0674` (v0.3.1 CSSStyleSheet polyfill, lazy panels, version bump): superseded by `main`'s `b1d22c0f9` and lazy panels; the 0.3.1 version number is not adopted. `67f037502` is patch-identical to `e8f0e4875`.
- DeepSeek legacy aliases: the branch removed `deepseek-chat` / `deepseek-reasoner`; `main` deliberately keeps them (`26b5003a5`), so `deepseek.ts`, `src/shared/api.ts` and the R1 message conversion follow `main`.
- Dependencies and metadata: `package-lock.json`, `webview-ui/package-lock.json`, `PROJECT.md` and `package.json` (version 0.2.7, `main`'s contributed commands) follow `main`; the `puppeteer` devDependency, `webview-ui/test_crash.cjs` and `.claude/launch.json` are not carried over. The `eval:harness` script is added.
- HTML preview (`HtmlPreviewView`, `HtmlPreviewPanel`): `main`'s Studio / Learning-Pack CSP and trailing-edge re-run are authoritative. Dropped from the branch: the double-buffered cross-fade iframe, the saved-live-app banner and `<base href>` injection (`main`'s `applyArtifactBaseHref` replaces it), the kernel-profile notice banner, the diagnostics error total, and the quiz-complete progress loop. Kept: reactive parameters (`notifyParamChanged`) and the `KernelStatusChip` / toolbar changes.
- Map: `main`'s ordered snapshot stream and atomic persistence (`16af78342`), `useRasterResources`, `LayerClusterCache`, `MapConnectionStatus`, `mapCapture` and explicit tile-error surfacing are authoritative. Dropped from the branch: its unordered subscription set, the initial `getMapState` fetch, the raster preload effect (its `raster_path` and stretch handling were ported into `useRasterResources`), the name-heuristic legend swatches and colour ramps in `MapExport` (`main`'s geometry-based legend is kept), and silent null-on-failure tile loading (only the `createImageBitmap` fallback was ported).
- `MapSessionService` keeps `main`'s error-propagating event mirror; the `active_workspace.json` pointer sync and outbound-event rotation were ported on top of it.

Known follow-ups: Evidence Board manual-session controls; `set_time_range` timestamps accept dates and date-times only (no free-form text); integration and E2E suites were not run (they download VS Code).

---

## [0.3.0] — 2026-06-14 (Marketplace)

### Fixed — Reproducibility panels revived

Evidence Board, Experiment Table, and Session Replay are no longer stale/dead-end UI surfaces. The extension now has a shared, tested session-surface reader (`src/integrations/aihydro-session/sessionSurfaces.ts`) that resolves canonical sessions, explicit JSON paths, and capsule `session.json` exports; normalizes `_experiments`, `_run_log`, and persisted `claims`/`_claims`; and powers Experiment Table, Session Replay, and ledger snapshots. Host-initiated replay loads now work, local panel loading no longer depends on the main sidebar webview being available, recent session ids are suggested from `~/.aihydro/sessions/`, and Evidence Board now exposes loading/error/manual-session controls instead of silently rendering an empty board on ledger failures. The panels also ship with a populated `demo-reproducibility-cockpit` fixture, cross-panel run links (experiment/evidence → replay), compact metric+CI cells, review filters, and clearer empty states. *(Reconciled: main's re-port is kept; the manual-session text controls and Evidence Board recent-session suggestions described here are not on main yet.)* Regression test: `sessionSurfaces.test.ts`; docs: `docs/guide/reproducibility-panels.md`.

### Added — Agent-native map control

The map panel is now directly drivable by the AI agent. Three new MCP tools in `aihydro-tools` write commands that `MapCommandWatcher` picks up and executes:
- **`map_fly_to`** — smooth `FlyToInterpolator` camera animation to any coordinate/zoom (agent can focus the map on a delineated basin automatically).
- **`map_add_layer_from_run`** — adds a GeoJSON run output as a provenance-tagged map layer, with automatic geometry-type sniffing (polygon/line/point) for correct legend icons and styling.
- **`map_set_time_range`** — drives the time slider via `BrushContext` so the agent can synchronise the map's temporal view with a modelling run.

### Added — Session Replay panel

New `ReplayPanel` webview + `VscodeReplayProvider` host panel. Loads a session's recorded `_run_log` from `~/.aihydro/sessions/<id>.json` and renders each tool invocation as a collapsible timeline step — step number, status badge (pass/warn/fail from quality flags), tool name, key-outputs table, per-validator quality-flag badges, timestamp. Supports filtering by tool or run_id and keyboard navigation (↑↓ / Esc). Open via the **AI-Hydro: Session Replay** command or the `$(debug-rerun)` icon in the sidebar.

### Added — Experiment ↔ map linkage

Clicking any row in the `ExperimentTable` panel highlights the corresponding basin on the map (`fit_layer`/`fit_extent` command). The aggregate stats panel gains sample standard deviation alongside mean/min/max.

### Added — Panel accessibility

Evidence Board, Experiment Table, and Session Replay panels are now reachable from the Command Palette and the sidebar toolbar (`$(checklist)`, `$(table)`, `$(debug-rerun)` icons) — previously their commands were registered but never surfaced in `package.json contributes`.

### Added — Token-efficient waiting for long jobs (`wait_for_job`)

New `wait_for_job(job_id)` MCP tool in `aihydro-tools`. Previously, after starting an async job (training, background data fetch) the agent had to call `get_job_status` in a loop — and **every poll is a full LLM turn that re-reads the entire context**, so babysitting a 5-minute job could cost dozens of turns and a large token bill. `wait_for_job` blocks **server-side**, polling the job's `status.json` every few seconds at zero token cost, and returns only when the job finishes (or after a ~280 s budget, just under the MCP transport timeout — in which case the agent makes one more call). Most jobs now complete in a single tool call. Returns a terse status plus a `retrieve_with` hint. The async-start tools (`train_hydro_model`, `data_fetch_background`) now point at `wait_for_job` in their guidance, and the system persona instructs the agent to wait efficiently rather than poll in a tight loop.

### Fixed — Basemap tiles rendering black

All basemap tiles were silently failing, leaving the map as a dark canvas. Root cause: `getTileData` returned `createImageBitmap(blob)` without `await` inside a `try-catch`; without `await`, a Promise rejection escapes the catch block and propagates to deck.gl, marking every tile as null. Fixed: `createImageBitmap` is now awaited inside a nested try-catch; if it fails (can occur for JPEG blobs in some Electron webview contexts), an `HTMLImageElement` fallback loads the tile via object URL. Also added explicit `mode: "cors", credentials: "omit"` on the fetch and `console.error` logging so future failures are diagnosable via webview DevTools. *(Reconciled: only the `createImageBitmap` → `HTMLImageElement` fallback was ported; the `mode: "cors", credentials: "omit"` fetch options and the return-null-on-failure tile loading are not on main, which surfaces tile errors instead.)*

### Fixed — Map going black after loading a projected (non-WGS84) layer

The map could turn entirely black — basemap included — after a layer in a projected CRS (e.g. a SWAT+ UTM shapefile loaded without its `.prj`) was added. Root cause: `fitViewStateToBounds` auto-fit the camera to the layer's raw bounds without checking they were lon/lat. UTM eastings/northings (e.g. 425000, 4425000) became `longitude/latitude`, collapsing zoom to 1 (the tell-tale "z 1.00" with a nonsensical "1 m" scale) and producing an invalid Web Mercator viewport that renders nothing. The bad camera was then persisted to `localStorage`, so the map stayed black on every reopen. Fixes: (1) `fitViewStateToBounds` now refuses to fly to non-WGS84 bounds and keeps the current valid camera; (2) the persisted view is sanitized on restore (out-of-range latitude/longitude and a UTM-collapsed zoom fall back to the default), so an already-corrupted saved view self-heals on reload; (3) loading a projected layer now shows a clear warning ("reproject to EPSG:4326 or include its .prj") instead of silently black-screening. No layer, however badly projected, can black-screen the map again. *(Reprojecting projected vector layers so they actually display is a separate follow-up; for now they are detected and reported rather than rendered off-world.)*

### Fixed — Map going black after switching panels (WebGL context loss)

The map could render correctly and then turn black after the panel was backgrounded and reopened. VS Code webviews — especially on macOS with several panels open — can have their GPU context reclaimed while hidden; deck.gl/luma does not reliably rewire to a restored context, so the canvas paints black while the toolbar, legend, and scale bar (plain DOM) survive. `MapView` now listens for `webglcontextlost` (preventDefault, to allow restoration) and `webglcontextrestored`, and remounts `<DeckGL>` via a key bump to acquire a fresh context. It also remounts on `visibilitychange → visible` when a loss was recorded (hidden webviews often never fire `restored`). `viewState` and layers are controlled props, so the camera and overlays are preserved — recovery is seamless.

### Fixed — Agent routing robustness (MCP prompt grouping)

Connected MCP servers are now grouped by role in the system prompt. When the host platform's server (any server that opts into progressive disclosure via `_meta.hot`) is connected alongside third-party MCP servers, the system prompt renders the native server first under **"# Native Platform (primary toolset)"** and third-party servers under **"# Additional Connected Servers (supplementary)"**. This corrects an asymmetry where progressive disclosure made native tools appear as terse summaries while third-party servers dumped full schemas, biasing agents toward name-association routing to third-party tools. The discriminator is general (no server named); framing activates only when both groups are present, so single-server output is byte-identical. Test: `mcpNativePrimacy.test.ts`.

### Fixed — Agent routing robustness (persona)

Added two general rules to the AI-Hydro persona: (1) **discover-before-commit** — do not infer a server's capabilities from its name; verify via `aihydro_describe_capability` or `list_available_tools` first; (2) **scope-matching** — prefer the most direct tool; do not launch a long-running multi-stage pipeline unless the request requires it. Also added a structural stop rule: if several different tools fail with the same structural error (same unexpected-keyword / connection / auth message), the cause is the server or its config — stop after two failures and report the blocker rather than silently switching servers.

### Fixed — MCP tool calls lost due to context-variable injection

All aihydro-tools MCP calls were failing with `ValidationError: Unexpected keyword argument _chat_id` because the VS Code extension injects `_chat_id` / `_workspace` into every tool call and the previous monkeypatch on `mcp._call_tool_mcp` was dead code (FastMCP 3.x binds the original handler at init). Replaced with `_ContextInjectionMiddleware` via `mcp.add_middleware()` — the correct extension point. The middleware strips injected keys before Pydantic validation and stores them in `contextvars.ContextVar` for tool access.

### Fixed — Multi-line tool arguments ("invalid JSON argument. Retrying…")

Weaker models emit multi-line values (e.g. `run_python`'s `code`) with raw unescaped newlines inside JSON strings, which strict parsing rejects. The argument-repair layer now runs `escapeControlCharsInStrings()` as a final fallback — a state-machine that escapes control characters only inside string literals. Guarded no-op on already-valid JSON. New `json_control_char_escape` repair kind and tests.

### Fixed — "Let me answer in my own words…" inline text field

Previously only fired a `focusChatInput` event at the distant bottom chat box, which was unreliable while a question was pending. Now reveals an inline autofocused textarea right inside the options (Enter to send, Shift+Enter for newline, Esc/Cancel to dismiss) — mirroring Claude Code's "Other" affordance so a custom answer is always typeable regardless of the main input's state.

### Fixed — map_fly_to camera jumping instead of flying

deck.gl's controlled `viewState` requires both `transitionDuration` **and** `transitionInterpolator`; adding only `transitionDuration` causes an instant jump. Fixed by adding `FlyToInterpolator({ speed: 1.2 })` from `@deck.gl/core`.

---

## [0.2.8] — 2026-06-01 (internal, not published)

### Fixed — Saved-page local assets broken (missing `<base href>` in srcdoc)

HTML files loaded via srcdoc had no base URL, so every relative `./…_files/…`
reference (CSS, images, JS) resolved to the webview build origin and 404ed — producing
an unstyled text skeleton with broken-image placeholders. A `<base href>` is now injected
as the **first child of `<head>`** before all bridge/diagnostic scripts, pointing at the
artifact's parent directory WebView URI. The injection is skipped when the HTML already
contains a `<base>` tag (author intent is preserved). Folium/Plotly previews are
unaffected — they use absolute CDN URLs or inline data URIs.

### Added — Saved live-app snapshot detection banner *(dropped in the reconciliation; main's static-document notice and `applyArtifactBaseHref` replace it, as they do the `<base href>` injection above)*

When a `<!-- saved from url=… -->` marker + a known live-app host
(`google.com/maps`, `maps.googleapis.com`) is detected in srcdoc content, a dismissible
warning banner appears above the iframe: *"This looks like a saved copy of a live web
page — the interactive map needs the original site and can't render offline."* An
**Open in browser** button routes through the host to open the original file in the
system browser. The iframe still renders beneath the banner (local assets partially show
after the base-href fix above).

### Fixed — Edit-mode pending-edits badge persisted across module navigation

`hasPendingTextEdits` and `pendingChangeCount` were not cleared when switching modules
in the HTML Preview panel. Navigating away while an edit was pending left the badge
showing stale unsaved-changes state on the new module.

### Fixed — Kernel profile change had no success/error feedback

The toolbar profile dropdown changed the kernel silently. The extension now listens for
the host response and displays a brief notice bar: green "Profile changed" on success,
red error message (with dropdown revert) on failure.

### Added — Send Batch "Sent" confirmation flash

The **Send N changes to agent** button in Edit Context Ribbon now flashes green with a
"Sent ✓" label for 1.6 s after dispatch, giving clear confirmation that the batch was
queued.

### Added — Diagnostic strip overflow indicator

The diagnostic strip was silently capping at 6 errors. It now appends
`+N more…` (clickable to open the full diagnostics panel) when the error count
exceeds the visible cap.

### Added — Mark Complete spinner during auto-advance

The **Mark complete** button in `CourseHeader` now shows a spinning "Saving…" state
during the 350 ms auto-advance delay, preventing double-clicks and providing clear
in-progress feedback.

### Improved — ARIA labels on all icon-only buttons

Every icon-only button and status chip in the HTML Preview panel now carries an
`aria-label` and `title`:
`HtmlPreviewToolbar` (rescan, zoom, export, run/run-all/restart/stop, edit, profile
select), `EditContextRibbon` (format tools, exit), `CourseHeader` (kebab menu),
`CollapseToggleButton`, `KernelStatusChip` (`role="status"` + `aria-label`).

### Improved — Removed redundant `activeBuffer` React state

`activeBuffer` state was duplicating `activeBufferRef` and forcing an extra render on
every cross-fade swap. Pointer-events on the two double-buffer iframes are now derived
directly from `opacityA`/`opacityB` (whichever is at opacity 1 receives
`pointer-events: auto`); `activeBufferRef` is retained for stale-closure-safe routing.

---

## [0.2.6] — 2026-07-09

### Fixed — Security findings from the extension audit

Nine findings from a focused security + product audit of the extension
(`audits/extension-audit-2026-07-09.md`, ecosystem root) were closed:

- **Dependency vulnerabilities**: `npm audit fix` (79 → 27 vulns); removed
  two OpenTelemetry packages (`exporter-prometheus`, `sdk-node`) that were
  the last remaining high-severity issues after confirming they were
  imported nowhere in the codebase. Production dependency tree is now at
  22 vulnerabilities, all moderate, zero high/critical. CI now hard-gates
  on `npm audit --omit=dev --audit-level=high`.
- **Marketplace download integrity**: module/course installs now validate
  `downloadUrl`/`manifestUrl` against an allowlist of the configured
  marketplace origins before fetching, instead of trusting any URL the
  remote index returns.
- **HTML preview iframe**: narrowed the Content-Security-Policy
  `connect-src` from an unrestricted `https:` to the specific CDN/tile
  origins already trusted for scripts and tiles, closing an exfiltration
  channel for data rendered into preview artifacts.
- **Artifact kernel**: the Python subprocess backing HTML Preview cells no
  longer inherits the full host environment — secret-shaped variables
  (API keys, tokens, cloud credentials) are scrubbed before spawn, matching
  the hardening already applied on the Python `run_python` MCP tool.
- **GEE tile proxy**: now allowlists the tile-template host to
  `earthengine.googleapis.com` and reflects the CORS origin only for
  `vscode-webview://*` callers instead of a wildcard `*`.
- **Local command IPC**: the file-based command channel used by MCP tools
  to drive the Map and HTML Preview panels now validates every command
  against a schema before dispatch.
- **Privacy documentation**: added `PRIVACY.md` describing exactly what
  telemetry is collected by default (PostHog, opt-out via Settings), what's
  opt-in only (OpenTelemetry), and what isn't telemetry at all (Firebase is
  the auth backend). Removed the unused `@sentry/browser` dependency.
- **Accessibility**: re-enabled Biome's `a11y` rule set for AI-Hydro-authored
  components (map, HTML preview, connectors, skills panels) — found zero
  violations.
- Removed a stray, broken demo script at the repo root that was silently
  breaking Python test collection.

See `audits/STATUS.md` (ecosystem root) for the full finding-by-finding
evidence trail.

---

## [0.2.5] — 2026-05-30

### Fixed — Ghost file-ID session entries

Eliminated the last source of duplicate / stale entries in `preview_list_modules`.
Events fired before `manifest.loaded` (e.g. cell-status updates on module open) were
written to disk under the VS Code internal file ID (`file_ef26b9af…`). Once
`manifest.loaded` fired, a second correctly-named file was also written, leaving
both on disk. Three-layer permanent fix:

1. **Retroactive cleanup** — when `manifest.loaded` establishes the `fileId → moduleId`
   mapping, any file-ID disk entry written earlier is immediately deleted.
2. **Removal-time cleanup** — `removeHtmlPreview(id)` now resolves VS Code file IDs to
   manifest module IDs via a pluggable `registerModuleIdResolver()` callback (registered
   by `VscodeHtmlPreviewProvider.initialize()`) and clears both the module-ID session and
   any leftover file-ID disk files when a tab is closed.
3. **`cleanupDiskFiles(id)`** extracted from `clearModule()` for reuse in both paths.

---

## [0.2.4] — 2026-05-30

### Fixed — Manim namespace pollution (root cause of "produced no MP4")

`from manim import *` injects 6 framework `Scene` subclasses (`MovingCameraScene`,
`ThreeDScene`, `VectorScene`, `ZoomedScene`, …) into the cell namespace. The renderer
was iterating every `Scene` subclass and calling `.render()` on `MovingCameraScene`
first — it has no `construct()`, emits no frames, and the render finished with an empty
media directory before the user's scene was ever attempted. Fixed by filtering on
`obj.__module__ == namespace["__name__"]` — only classes *defined in the executed cell*
are rendered. Also:

- Each Scene now renders into its own fresh `tempfile.TemporaryDirectory()` to avoid
  cross-scene glob collisions.
- Final MP4 is chosen by preferring candidates outside `partial_movie_files/` so the
  assembled movie, not an intermediate chunk, is returned.

### Fixed — Session-file accumulation (permanent)

`~/.aihydro/preview_session/` and `~/.aihydro/preview_events/` are ephemeral live-state
directories but were never cleaned, causing unlimited growth and stale cross-session
entries. Fixed:

- `PreviewSessionService` now purges both directories in its constructor — every VS Code
  launch starts with a clean slate.
- `clearAll()` added (called by "Clear all previews") wipes both in-memory and on-disk
  state instantly.
- `clearModule()` refactored to call the shared `cleanupDiskFiles()` helper.

---

## [0.2.3] — 2026-05-30

### Fixed — `preview_list_modules` returning VS Code file IDs

`preview_list_modules()` was listing entries like `file_0155f6f2094bdd2f` instead of
`terrain-to-wetness-twi`. Root cause: the webview reports `item.id` (the VS Code
artifact registry ID) as `moduleId` for every event. `PreviewSessionService` was writing
session files under that opaque ID. Fixed with a `fileIdToModuleId: Map<string, string>`
in `VscodeHtmlPreviewProvider`. The first `manifest.loaded` event carries the manifest's
canonical `id`; subsequent events for the same panel are resolved through the map before
`appendEvent` is called.

### Fixed — Manim `FileNotFoundError: movie_file_path`

`scene.renderer.file_writer.movie_file_path` is unreliable across Manim CE versions and
can point to a path that differs from where the file actually landed. Fixed by globbing
the temp dir for `*.mp4` after render and falling back to `movie_file_path` only when
glob finds nothing.

---

## [0.2.2] — 2026-05-30

### Added — Unified Learners' Hub (HTML Preview Phases 1–4)

A comprehensive upgrade to the HTML Preview panel turning it into a polished
"learners' hub": tighter first-run UX, a reusable interactivity block layer,
Manim video cells, 3D/manipulable simulations, deterministic module validation,
and a live agent↔preview session bridge.

#### Phase 1 — Foundations

- **Quiz → course-progress wiring** — `.aihydro-quiz` radio blocks now post
  `aihydro-quiz-complete` on pass; the host wires this to `courseProgress.markComplete()`.
  `aihydro.quiz()` is a back-compat alias that normalises legacy `aihydro-question` markup.
  Completion % now surfaces in `CourseNavigator` and `CourseHeader`.
- **Kernel pre-warm** — kernel session starts and pre-imports numpy/matplotlib as soon as
  a module opens, so the first cell executes without a cold-start delay. Per-cell status
  cycles through `queued → warming → running → done/error` (animated stripe + status pill).
- **Control-state persistence** — `bindParam` values are persisted to
  `~/.aihydro/module_state/<key>.json`. Module reloads restore saved state. Toolbar kebab
  menu adds **Reset controls to defaults** and **Copy control state**.
- **`AI-Hydro: Validate Module` command** — `validateModule.ts` encodes the
  `interactive-module-builder` 50-item checklist as code: manifest, cell IDs/languages,
  Python cell anti-patterns, CDN version pinning, sim/scene3d canvas wiring, Manim Scene
  subclass presence. Advisory findings listed by error code; integrated into the skill's
  pre-publication step.

#### Phase 2 — Interactivity primitives

All primitives injected into `window.aihydro` via the cell bridge; pure DOM, no kernel
dependency, `prefers-reduced-motion` aware:

- **`aihydro.timeline()`** — play/pause/step/scrub control over N animation frames;
  drives `bindParam` slots or custom `onTick` callbacks.
- **`aihydro.compare(selector)`** — before/after wipe slider over an `.aihydro-compare`
  block (first child = before, second = after).
- **`aihydro.sim({ canvas, step, params })`** — `requestAnimationFrame` loop over a
  `<canvas data-aihydro-sim>` for real-time hydrology simulations (e.g. rain → hydrograph).
- **`aihydro.plot({ mount, data, layout })`** — branded Plotly wrapper; lazy-loads
  Plotly from the CSP-whitelisted CDN and applies the AI-Hydro dark palette.

#### Phase 3 — Manim video cells

- `data-aihydro-render="video"` (or `data-language="manim"`) on a `.aihydro-cell` marks it
  as a video cell.
- Kernel renders each user-defined `Scene` to a low-quality MP4, returns it as
  `video/mp4` base64 output. Bridge plays it inline in `<video controls>`.
- Graceful degradation when Manim/ffmpeg absent — rest of module still works.
- `media-src` directive added to CSP (`buildPreviewCsp.ts`).

#### Phase 4 — 3D / manipulable simulations

- **`aihydro.scene3d({ canvas, dem, setup, onFrame })`** — three.js helper for terrain
  flythroughs, 3D DEM/TWI surfaces, watershed views. Lazy-loads three.js **r128** (pinned
  UMD release) from the CSP-whitelisted jsdelivr CDN. `setup(ctx)` receives a branded
  `{ THREE, scene, camera, renderer, controls, canvas, dem }` context; `onFrame(ctx)` runs
  per animation frame. Reduced-motion renders a single static frame.

#### Skill + exemplars

- `interactive-module-builder` skill bumped to v0.3.0: added INTERACTIVITY PRIMITIVES
  section (decision matrix, exact API contracts, anti-patterns), MANIM VIDEO CELLS
  section, pre-publish checklist lines for all new primitives.
- Recipe cookbook added (`assets/recipes/`): one verified, pinned snippet per primitive.
- Three gold-standard exemplar modules published:
  - **master-recession-curve** — timeline + sim + bindParam
  - **flow-duration-curve** — Plotly + compare + bindParam
  - **terrain-to-wetness-twi** — scene3d + compare + Manim video

---

## [0.2.0] — 2026-05-25

A focused release on the HTML Preview panel: full course-mode (multi-module
guided learning paths), production-grade visual edit mode, and the DeepSeek
V4 model family in the API picker.

### Added — Course mode (HTML Preview)

End-to-end teaching-and-learning support for HTML modules grouped under a
`course.json` manifest. The student sees a curriculum + progress bar; the
agent (via `aihydro-tools` 1.7.0) sees the same state and can navigate,
gate, or unlock modules on the student's behalf.

- **`CourseHeader`** — strip above the toolbar showing course title, authors,
  module-N-of-M, ✓ / 🔒 status, completion %, prev/next navigation, "Mark
  complete & continue", and a kebab menu with two-step Reset Progress.
- **`CourseNavigator`** — sidebar accordion replacing the Files panel when
  a course is open. Numbered module list, cyan stripe on current, green ✓
  on completed, locked rows greyed with prereq tooltip, mini progress bar.
- **`useCourse` + `useCourseProgress`** — webview hooks fetching the
  course manifest (via host walk-up from any module's path) and per-course
  progress (round-tripped through the extension host, persisted to
  `~/.aihydro/course_progress/<id>.json`).
- **Agent ↔ Preview bridge:**
  - Webview writes `~/.aihydro/active_course.json` whenever a course is
    in view, so the agent's `course_get_state` MCP tool knows which course
    without the user pasting paths.
  - Extension host watches `~/.aihydro/course_nav_intent.json` (written by
    the agent's `course_navigate` MCP tool); fresh intents trigger a tab
    switch through the same prerequisite gate the Next button uses.
- **`examples/courses/intro-to-hydrology/`** — three-module reference
  course (Reading a hydrograph → Exploring CONUS streamflow → DEM to TWI)
  demonstrating prerequisites, estimated minutes, and abstracts.

### Added — Production-grade visual edit mode

- **Real-change detection** — `input` event + `MutationObserver` on
  `[data-aihydro-editable="prose"]` elements (replaces the false-positive
  "Save activates on every toolbar click" behaviour of the prior build).
- **Undo / redo** — keyboard (`⌘Z` / `⌘⇧Z` / `Ctrl+Y`) + toolbar buttons
  tied to `document.queryCommandEnabled('undo'|'redo')` for accurate
  enabled/disabled state.
- **Save button** — only activates when there are pending text edits AND
  no save is in flight; shows "Saving…" mid-flight.
- **Edit-context ribbon** — replaces the per-comment modal dialog with a
  persistent toolbar (B / I / U / H1-3 / list / link / Undo / Redo / Save).

### Fixed — Prev / Next navigation

- **`loadWorkspaceFile`** — previously created a new tab but never
  activated it, so Next ▶ appeared to do nothing. Now fetches updated
  items, finds the target by path, and explicitly activates it.
- **Tolerant path matching** — `pathsEqual()` normalises slashes, trims
  trailing separators, and is case-insensitive (macOS HFS+ / NTFS) so a
  freshly-resolved navigation target matches its already-open tab even
  when the path string isn't byte-identical. Fast path skips the
  `previewHtml` round-trip entirely when the tab is already open.

### Added — DeepSeek V4 model family

- **`deepseek-v4-flash`** (new default) — 1M context, 384K max output,
  $0.28/M output, $0.0028/M cache reads.
- **`deepseek-v4-pro`** — premium V4 with thinking mode for complex
  reasoning; same 1M context.
- **`deepseek-chat` / `deepseek-reasoner`** retained as deprecated aliases
  with accurate v4-flash pricing surfaced in the picker.
- Provider code unchanged — the legacy R1-format conversion still
  triggers for the `deepseek-reasoner` alias.

### Companion releases

- **`aihydro-tools` 1.7.0** on PyPI — five new `course_*` MCP tools
  (`get_state`, `get_curriculum`, `set_progress`, `navigate`, `scaffold`).
- **`AI-Hydro/Skills`** — new `course-authoring` skill broadcast via the
  GitHub Pages marketplace; pairs with `course_scaffold` per the
  established skill+tool pattern.

### System prompt

- `aihydro-tools` 1.7.0 ships a new COURSE MODE section directing the
  agent to treat itself as a teaching assistant when a course is active
  and require explicit user agreement before mutating progress.

---

## [0.1.8] — 2026-05-09

### Map — Multi-format file loading, drag-and-drop, symbology editor

#### Format adapters
- **GeoJSON / TopoJSON** — client-side parsing; TopoJSON converted via `topojson-client`
- **KML / KMZ** — converted via `@tmcw/togeojson`; KMZ ZIP extracted via `jszip`
- **GPX** — converted via `@tmcw/togeojson`
- **Shapefile (.zip)** — zipped `.shp + .dbf + .shx + .prj` bundle via `shpjs`
- **GeoTIFF** — read via `geotiff.js`; rendered with viridis ramp to base64 PNG; rejects non-WGS84 with helpful error
- **CSV** — auto-detects `lon`/`lat`/`longitude`/`latitude`/`x`/`y` columns; handles quoted fields

#### Drag-and-drop
- Drop any supported file directly onto the map — blue dashed drop zone appears while dragging
- `dragDepthRef` counter prevents false `dragLeave` events from child elements
- Result toast (bottom-centre) reports `n loaded, n skipped` with error details

#### Layer panel additions
- **`+ Add Layer…` button** — opens native file picker filtered to supported extensions
- **Empty state** — when no layers are present, a `🗺️` placeholder lists supported formats
- **Source badges** — 📁 workspace file, 🐍 Python tool output, 📥 user-loaded file, 📤 manually pushed
- **Layer name disambiguation** — `buildDisplayNames()` appends parent folder when two layers share the same basename (e.g. two `watershed.geojson` files)

#### Symbology editor
- Per-layer inline editor (click swatch or 🎨 icon to open):
  - **Vector**: fill colour + opacity, stroke colour + width
  - **Raster**: colormap selector (8 options: viridis, plasma, inferno, magma, cividis, Greens, YlOrRd, RdBu) + opacity
- Changes applied immediately via `MapServiceClient.addMapLayer`

#### Dependencies added
- `shpjs ^6.2.0`, `@tmcw/togeojson ^7.1.2`, `geotiff ^3.0.5`, `jszip`, `topojson-client`, `@types/geojson`, `@deck.gl/widgets ~9.2.0`

#### Dependencies removed
- `mapbox-gl`, `react-map-gl`, `kepler.gl` (were unused)

---

## [0.1.7] — 2026-05-08

### Map — Panel redesign, status bar, basemap overhaul, persistence

#### Resize fix
- **ResizeObserver** on the map container div replaces `window.addEventListener("resize")` — map now resizes correctly when VS Code panels are resized or split, not just on window resize

#### Layer panel
- Panel is always visible — collapsed state shows a `📑 +` icon button so layers can always be added even after clearing all layers
- Drag-resize handle on left edge (220–480 px range)
- Collapsible details section for per-layer metadata
- Panel state (dock, width, expanded) persisted to `localStorage`

#### Map status bar
- Scale bar using Mercator ground-resolution formula: `156543 × cos(lat) / 2^zoom` m/px
- Coordinate readout from `onHover` (`45.4981°N, 69.6018°W` format)
- Styled with VS Code CSS variables for theme consistency

#### Basemap overhaul (13 free basemaps, no token needed)
- **Hydrology-focused** (top of list): USGS Imagery, USGS Topo, USGS Shaded Relief, Esri Hillshade, Esri Ocean
- **General purpose**: Carto Voyager, Carto Dark, Carto Light, Stadia Terrain, Esri World Topo, Esri Satellite, Humanitarian (HOT)
- **OSM direct** — demoted to last slot with ⚠️ warning (volunteer servers; disallows embedded app traffic)
- Removed Mapbox dependency entirely

#### Workspace persistence
- `mapWorkspace.ts` — `localStorage` key `aihydro.map.workspace.v1` saves: active basemap, view state (center + zoom), visible layer IDs, panel layout

---

## [0.1.6] — 2026-05-05

### Map — Python ↔ VS Code layer bridge

- **`MapEventWatcher`** — TypeScript class polls `~/.aihydro/map_events/` every 600 ms and forwards layer events to the map panel via `controller.addMapLayer()`. Starts on extension activation; stops on dispose
- **`delineate_watershed` auto-push** — watershed boundary polygon and gauge station point pushed automatically after every successful delineation; map panel opens side-by-side if closed
- **`show_on_map` MCP tool** — explicit tool for pushing any GeoJSON to the map. Accepts style presets (`watershed`, `flowlines`, `gauge`, `default`) and per-key overrides (`fill_color`, `stroke_color`, `fill_opacity`)
- **`compute_twi` auto-push** — pushes `viridis_r` raster tile as layer `twi_<session_id>` after TWI computation
- **`create_cn_grid` auto-push** — pushes `YlOrRd` tile as layer `cn_<session_id>` after CN grid generation
- **`BitmapLayer`** — raster layers routed through deck.gl `BitmapLayer`; vector layers through `GeoJsonLayer`
- **`plot_raster_tile()`** in `analysis/plots.py` — renders numpy array as decoration-free PNG with NaN-transparent cells; percentile clipping (P2–P98) prevents outlier wash-out
- **`_bounds_to_wgs84()`** — reprojects raster bounds from any CRS to EPSG:4326 via pyproj; falls back silently if pyproj is unavailable

---

## [0.1.5] — 2026-04-18

### Added
- **Three-tier citation system** — every tool call automatically accumulates BibTeX citations.
  `sync_research_context` writes `citations.bib`; `export_session` embeds citations in every format.
- **LLM interpretation layer** — `research.md` gains a science-prose section written by the model via `sync_research_context` (two-phase: Phase 1 returns raw data; Phase 2 accepts prose).
- **PNG diagnostic outputs** — watershed map, daily hydrograph, and log-scale FDC saved to workspace automatically.
- **`analysis/plots.py`** — headless matplotlib plots via Agg backend.
- **Lean session JSON** — watershed GeoJSON stored separately at `~/.aihydro/sessions/<gauge_id>.geojson` (was embedded inline, 200–800 KB per gauge).

### Fixed
- `.aihydrorules/research.md` path corrected (was `.clinerules/research.md`)
- Shadow `ai_hydro/session.py` deleted — was silently writing to wrong path
- `fetch_streamflow_data` positional-arg error corrected to use `start_date=`/`end_date=` kwargs

---

## [0.1.4] — 2026-04-15

### Added
- **Python env context in `start_session`** — response includes `mcp_python`, `mcp_pip`, `available_packages`
- **`list_available_tools` tool** — runtime tool registry with schemas; includes plugin tools
- **`get_library_reference` tool** — reference cards for 8 core hydrological libraries
- **`aihydro.knowledge` entry point** — community plugins can contribute additional library cards

---

## [0.1.3] — 2026-04-11

### Fixed
- **Security**: Path traversal in `ProjectSession` — `project_name` validated against `^[a-zA-Z0-9_-]{1,64}$`
- **Critical**: `fetch_streamflow_data` broken on pandas 3.0 — replaced `hydrofunctions` with `dataretrieval` (official USGS Python client)
- Geomorphic outlet elevation NaN silently coerced to 0.0 — fixed with nearest-pixel fallback
- `research.md` / `tools.md` written to `.clinerules/` instead of `.aihydrorules/` — agent context was not being injected

---

## [0.1.2] — 2026-04-10

### Added
- **v1.2 Python backend** (aihydro-tools v1.2.0) integrated:
  - `ProjectSession`: project-scoped research state spanning multiple gauges/topics
  - `ResearcherProfile`: persistent researcher persona built from interactions
  - 10 new MCP tools → 26 total
  - Folder-based literature indexing (`index_literature`, `search_literature`)
  - Cross-session experiment search (`search_experiments`)
  - Project experiment journal (`add_journal_entry`)
  - Researcher profile tools (`get/update_researcher_profile`,
    `log_researcher_observation`)
- **Memory hierarchy** fully documented in agent instructions:
  `ResearcherProfile → ProjectSession → HydroSession → research.md`
- Agent now calls `get_researcher_profile()` at conversation start to recall
  who the researcher is and tailor responses accordingly.

### Changed
- `python/ai_hydro/mcp/app.py`: agent instructions rewritten with memory
  hierarchy, project workflow, and literature workflow sections.
- `python/ai_hydro/session/__init__.py`: exports `ProjectSession`,
  `ResearcherProfile` alongside `HydroSession`.
- `python/ai_hydro/session/store.py`: `write_research_context()` now appends
  researcher profile block to `.clinerules/research.md`.

---

## [0.1.1] — 2026-04-09

### Changed
- Bumped version 0.1.0 → 0.1.1 for VSIX distribution.

### Python backend (aihydro-tools v1.1.0)
- RAG system removed; `query_hydro_concepts` tool removed.
- Hardcoded "17 tools" references replaced with generic language throughout.
- RAG files archived to `github.com/AI-Hydro/aihydro-rag`.

---

## [0.1.0] — 2026-03-31

### Added
- Initial public release of AI-Hydro VS Code extension.
- Full TypeScript rebranding from Cline → AI-Hydro:
  - Types: `ClineMessage` → `AiHydroMessage`, `ClineAsk` → `AiHydroAsk`, etc.
  - Config files: `.clinerules` / `.aihydroignore` / `.aihydrorules`
  - VS Code config keys: `cline.*` → `aihydro.*`
  - 25 source files renamed, 8 webview files renamed
- Auto-registration of `ai-hydro` MCP server on extension activation
  (`src/core/mcp/ensureDefaultMcpServer.ts`): detects `aihydro-mcp` on PATH
  and writes server config automatically.
- MCP settings file: `aihydro_mcp_settings.json`
  (at `~/Library/Application Support/Code/User/globalStorage/aihydro.ai-hydro/`)
- Custom agent system prompt for hydrological research workflows.
- Python backend: aihydro-tools v1.1.0 (16 MCP tools via `aihydro-mcp`).
- Latest AI model support added to `src/shared/api.ts`:
  Claude 4.6 (Opus/Sonnet), GPT-5.4, Gemini 3.1, and others.
- Documentation: `PLUGIN_GUIDE.md`, `docs/tools-reference.md`,
  `docs/installation.md`, `docs/architecture.md`.
- Community contribution guide: `python/CONTRIBUTING.md`.

### Notes
- Proto/generated code preserved from upstream Cline (untouched):
  `src/shared/proto/cline/`, `src/generated/`, `proto/`
- Proto-conversion layer bridges `AiHydroMessage` (app) ↔ `ClineMessage` (proto)

---

[Unreleased]: https://github.com/AI-Hydro/AI-Hydro/compare/v0.1.8...HEAD
[0.1.8]: https://github.com/AI-Hydro/AI-Hydro/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/AI-Hydro/AI-Hydro/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/AI-Hydro/AI-Hydro/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/AI-Hydro/AI-Hydro/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/AI-Hydro/AI-Hydro/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/AI-Hydro/AI-Hydro/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/AI-Hydro/AI-Hydro/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/AI-Hydro/AI-Hydro/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/AI-Hydro/AI-Hydro/releases/tag/v0.1.0
