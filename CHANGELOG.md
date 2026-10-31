# Changelog — AI-Hydro VS Code Extension

All notable changes to the AI-Hydro VS Code extension are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

The companion Python package (`aihydro-tools`) has its own changelog at
`github.com/AI-Hydro/aihydro-tools/CHANGELOG.md`.

---

## [0.4.5] — unreleased (owner feedback on 0.4.4: chat polish)

### Fixed — no empty "Worked <1s" rows, no "Resumed a completed task" above a follow-up (branch `vision2040/polish-transcript`)

Reported on the installed 0.4.4 build: a stray "Worked <1s" row after every answer (also after a task completed), and "Resumed a completed task" above a new question.

- Cause: the presenter folds every non-prose message (model requests, checkpoints) into a work group, so a plain answer produced one or two groups whose facts were all zero except cost; the group after the answer is the checkpoint and request that close the turn.
- A group with no tool work (no tool, not-run call, lifted line, retry, failed request, reuse or revision) is no longer a row, at Focus and Normal. The live tail group stays while the task runs (it is the "Working" row). Verbose is unchanged. A group that did anything (including a failed or retried request) still shows.
- "Rewind to this message" is computed before the empty groups are dropped, so a chat-only turn still has its rewind target. Its cost remains in the task header (the total is computed from the messages, not from the rows; a test covers it). Known loss: a checkpoint that sits in a dropped group after the first one in a turn (for example the one taken as the answer completes) no longer has a "Rewind this work" row; the turn's first checkpoint still backs "Rewind to this message", and a group that ran tools still shows its own rewind.
- The "Resumed a completed task" divider is no longer drawn at Focus and Normal (the question follows at once and nothing was lost; the presenter still emits it, the view hides it). "Resumed from an interrupted task" still shows, and Verbose is unchanged.

## [0.4.4] — 2026-10-31 (owner feedback on 0.4.3: the "5 paused" chip; pairs with aihydro-tools 2.8.5)

### Changed — the paused-tools chip says which tools, which servers, and why, and offers Trust only where it applies (branch `vision2040/paused-chip`)

Reported on the installed 0.4.3 build: the chip read "5 paused" and its popover said "5 MCP tools paused... 3 tools: the server declares the tool may be destructive; 2 tools: the server is not trusted (its launcher changed or is not registered). To fix it, ..." with a "Trust this launcher..." action. It named no tool and no server. The real causes, from the owner's settings: `aihydro-tools` (launcher already confirmed) holds 3 grants on tools it declares destructive, and `swatplus-builder` (a third-party server, `swat mcp`) holds 2. Both are paused by design. A third-party server is never trusted (`not_first_party_name`), and for an untrusted server the tool annotations are never read, so a third-party tool is paused as "not trusted" whatever it declares. The first-party launcher was fine, so there was nothing to fix and the Trust action did not apply (the host would only have said "not an enabled AI-Hydro Tools launcher").

- **The popover lists the paused tools by name, grouped by server and cause**, each with a plain reason: "swatplus-builder: run_workflow, workflow_status: third-party server, so each run asks you"; "aihydro-tools: ...: may change or delete data, so each run asks you". More than 8 names show "and N more" (all names are in the hover title).
- **"Trust this launcher..." appears only when it can fix the cause**: the server has a first-party name, is enabled, and is launched the first-party way (`trustActionFixesServer`, mirroring the host's `firstPartyCandidates`). It sits under that server's group, names it (also in its accessible name) and says what a click does: it opens a confirmation showing the exact command, and nothing is trusted unless you confirm it there. A third-party server never gets it. The host still re-validates and records trust only on your confirmation; no new path records trust.
- **By design is not a warning.** When every paused tool is paused on purpose (destructive declaration, undeclared effect, third-party server) the chip reads "N ask first" without the warning border, the popover says "there is nothing to fix", and "To lift a pause..." is gone. When something can be fixed (a first-party launcher not confirmed, a server not connected) the chip still reads "N paused" with the warning border. "Paused" suggests something stopped that you can restart; for a tool that was never going to auto-run, "ask first" says what actually happens.
- **No per-tool control was added.** The only safe per-tool change is removing a grant, which is already in Hydro Tools & Data Sources (linked from the popover). Nothing here grants, widens or auto-approves anything; destructive and third-party tools stay on ask.
- **Tool auto-run settings popover.** "Toggle all" was a checkbox row inside the list of settings; it is now a "Turn all on" / "Turn all off" button above the list (same action, same defaults). The header no longer repeats the always-allowed MCP count that the "Risky:" line already states; only the paused part is added there ("5 MCP tools ask first").
- **Harness.** New screen `composer-paused-by-design` (the owner's mixed-cause session with synthetic tool names); `composer-paused-grants` now also asserts the Trust action.

## [0.4.3] — unreleased (owner feedback on 0.4.2: trust this launcher, map pins, composer footer, audit findings; sharded screens CI)

### Changed — map pins: one concept, a pin card, a clean context menu, and double-click zooms again (UX program Wave 1, PR X1-M2, branch `vision2040/x1-m2-pins`)

Reported on the installed 0.4.2 build: the right-click menu offered "Drop pin here" and "Add annotation here" (the same action twice), double-click dropped a pin instead of zooming, and clicking a pin showed the raw feature inspector with the internal layer name `__annotations-overlay`, `color: #f97316` and no way to rename or remove it.

- **One concept: Pin.** A pin is a saved point with an editable name and an optional note. Every "annotation" string in the pin path is now "pin" (the default name is `Pin N`; pins saved as `Annotation N` are renamed `Pin N` on load). Lines and areas are no longer in the Pins panel: they are "Sketches", under the Draw tool.
- **Double-click zooms.** The capture-phase double-click pin is deleted and deck's `doubleClickZoom` is on (it is off only while Measure or Draw is active, where double-click finishes the shape). Pins are added from the right-click menu ("Add pin"), the pin tool (press `P`, click the map; it stays armed until `Esc`) or the Pins panel ("Add pin"). The menu footer tip is gone.
- **Clicking a pin opens a pin card**, not the inspector: name (inline editable), note, coordinates, and Ask AI-Hydro / Delineate here / Copy coordinates / Delete. It never shows the layer id or a colour field. Hovering a pin shows its name, not the layer id.
- **Delete is undoable.** Delete from the card, a Pins panel row, the menu, or `Delete`/`Backspace` on the selected pin; a toast offers Undo, and `Ctrl/Cmd+Z` undoes the last pin change (add, rename, note, delete, clear all).
- **Context menu.** `role="menu"` with groups (AI-Hydro, then the object under the pointer, then Map), codicons instead of emoji, arrow-key navigation, and the coordinates as the header. "Drop pin here" and "Add annotation here" are one "Add pin". On a pin there is a pin section (Rename pin, Ask about this pin, Remove pin); on a layer feature the layer section keeps Inspect, Export and "Remove layer". The two delineate actions are labelled for what they do: **"Delineate with AI-Hydro"** opens a chat and the agent runs `delineate_watershed_from_point` (so the run is recorded); **"Quick delineate (no chat)"** runs the interactive MERIT delineation directly (`delineate-point` CLI, method `auto`), refuses outside CONUS without MERIT rivers on the map and above the interactive size limit, and adds the basin to the map without a chat.
- **Pins panel (rail).** List with name and coordinates, rename, zoom to, delete, "Clear all" with a confirm (undoable), Export (GeoJSON), "From layer", and the pin tool toggle.
- **Pins belong to the project, and are written only where they were loaded.** Each project has its own host key (`aihydro.map.pins.v1:<projectKey>`; `prj_...`, or `dir:<hash>` until the tools server knows the folder). The map sends the key it loaded with every save, and the host writes only to that key and only while it still belongs to the open folder; after a folder reorder, add or remove it asks the map to reload instead of writing. `dir:` to `prj_` is an explicit step at load (never a side effect of a save): the two buckets are merged by id, deletions are remembered (tombstones) so a deleted pin does not come back, and collections are merged too. Pins from project A are absent in project B, and collections are per project. Pins added before the project is known stay on this machine, marked, until the host acknowledges it has saved them (`aihydro-map-save-ack`); an unacknowledged pin is shown in the next project that opens the map. Known limitation: if a save's acknowledgement is lost and a different project opens next, that pin can appear in both projects.
- **The pre-project list is never lost.** The old global list (kept on the host, never deleted) goes once to the first real project, marked imported, with a Keep / Clear banner; "Clear them" asks first. Opening the map with no folder never claims it (an earlier claim by "no folder" counts as unclaimed), and two windows cannot both import it (the claim is written and read back before importing). The local copy is removed only when the host's list holds all of its ids. Pins added before the host's first reply are merged in by id; the undo history resets when a project's list is loaded.
- **A slow host cannot hide pins.** The map waits 9 s for the host (its project lookup can take 5 s), keeps retrying with backoff, and sends any save made meanwhile once the project is known. Pins saved while no project was known are marked, and are carried into the project's list the next time instead of being treated as part of the old global list. When the host asks for a reload because the open folder changed, a toast says the last change was not saved.
- **Unreadable pins are set aside, not deleted.** A stored pin with numeric-string coordinates is repaired; one that cannot be read is kept verbatim in `aihydro.map.pins.quarantine.v1`, with a console warning, instead of disappearing on the next save.
- **Harness.** Five screens (`map-pins-list`, `map-pin-card`, `map-pins-imported-banner`, `map-context-menu-empty`, `map-context-menu-pin`); steps may be `{ contextClick }`. The smoke test (`scripts/map-browser-smoke.mjs`) now double-clicks the real map and checks it zooms and creates no pin, then drives P, click, card, Delete, Undo.

### Changed — CI screen harness sharded so it stops timing out (branch `vision2040/ci-shard-screens`)

- **`ui-screens.yml` renders in 4 parallel shards.** The single 714-cell job hit its 60-minute limit on slow runners. `run.mjs --shard i/n` checks a deterministic slice of the registry (sorted ids, striped), with the same `--check`, `--require-matrix-budget` and budgets applied to its screens. Budget-shrink, self-test, bundle guards run once in a `guards` job.
- **Same required check name, stronger coverage proof.** "Screens, budget and bundle guard" is now an aggregator that fails if any job failed or was skipped and verifies the union of the shards' screens equals `run.mjs --list` (each exactly once). `--list` and `--shard` are documented in `scripts/ui-screens/README.md`.

### Fixed — AI-Hydro tools untrusted after the launcher moved, with no visible way to fix it (branch `vision2040/trust-ux`)

- **One action, where trust is the reason.** "Trust this launcher…" now sits on the paused-grant card ("Always for X is paused"), under the transcript's "server not trusted" line, and under the header when the study is unavailable because the launcher is not confirmed. It only asks the host to show its modal confirmation (exact command and path); trust is recorded only after that confirmation, and nothing is trusted automatically. Fail-closed semantics are unchanged.
- **Plain wording.** "AI-Hydro Tools is running from a new location (`<command>`). Your auto-run settings are paused until you confirm it." replaces "not the registered first-party server, or its launch identity changed". The study chip's tooltip says the same instead of "not connected".
- **Stale record.** When the recorded launcher belongs to a disabled or removed server entry and exactly one enabled first-party entry exists, the tools status chip and the confirmation say "Previously trusted: ai-hydro (disabled)." The click is still required.
- **The right entry.** The tools status and "Trust this launcher…" now look at the enabled first-party entry first. A disabled legacy `ai-hydro` entry no longer shadows the running `aihydro-tools` (the chip could read "trusted" while the real server was not).
- **No silent pick between launchers.** The buttons send the server they are about; the host re-validates it (enabled, first-party name and shape) and ignores anything else. With no name and two or more enabled first-party launchers, you choose by exact command, and the dialog says another enabled launcher is registered. The dialog says "AI-Hydro previously recorded" (the first record is written at registration, not by a confirmation).
- **Immediate.** After you confirm, auto-run grants apply to the next call, the servers list refreshes, and the study chip re-resolves, with no reload.

### Changed — answer audit: one human summary line, underlined numbers, plain-language review list (branch `vision2040/audit-findings-ux`)

- **One collapsed line, written for a reader.** The footer under a final answer now reads "3 numbers aren't linked to a recorded run · Review" (neutral note tone for advisory-only: "2 notes to review") instead of "Audit: 0/13 numbers traced · 13 hard · 0 advisory" plus an inline findings list. It is a button with `aria-expanded`; the review list stays closed until opened, and the traced count ("10 of 13 are traced") appears only inside it. The counts are the audit's own (`hardCount`, `advisoryCount`), unchanged.
- **Numbers are marked in the answer.** An untraced number in the prose gets a subtle dotted underline. Hover or keyboard focus shows "Not linked to a run" and, when the audit named a likely run, "Likely from run watershed.0b12… (area_km2)" with the existing run-reference chip. Each marked number has an accessible description. Only the first N occurrences of a number that N findings name are marked, and a number directly followed by a citation chip is never marked.
- **Review list in plain language.** One row per finding: the number, what is wrong ("Not linked to a run", "Link points to a run that is not recorded", "Value differs from the run"), and the text around it. The auditor's repair instructions ("Fix: Add [run:…] immediately after …"), the raw marker and the kind name show only at Verbose.
- **Primary action.** "Ask AI-Hydro to link these" (was "Ask agent to cite", in the action row) sits beside the summary and sends the same fixed follow-up as before. The gate's revision loop is not changed: this is the existing reply path.
- **Clean answers.** "All N numbers traced" as a tiny check line at Normal and Verbose; nothing at Focus. It still appears only when the audit ran and found nothing.
- **Unchanged:** what the gate blocks or allows, every disclosure line (silent revisions, findings that remain, removed values, unavailable audit, held-back drafts).
- **Harness.** New screens `chat-answer-audit-hard`, `chat-answer-audit-advisory`, `chat-answer-audit-clean`; `chat-answer-audit-graded` now expects the new line.

### Changed — the composer footer is one 28 px row of chips; Send, Stop and Add are flat codicon controls (UX program X1-C4, branch `vision2040/composer-footer`)

- **One status row instead of two lines and a paragraph.** Under the input there is one row: an **Auto-run** chip ("Auto-run: 5 on"), a separate **N paused** chip that exists only when MCP "always allow" grants are paused, and the context ring. The row is 28 px tall at every width (it was 47 px at 800 px and 99 px at 400 px).
- **Risk stays visible at rest.** When a risky class is on (all actions, edit any file, run any command, an MCP tool set to always allow, or YOLO) the Auto-run chip shows a warning icon and the word "risky", takes the warning border, and names the risk in its accessible name. The popover lists each reason as a line with a warning icon.
- **The claim sentence moved into the auto-run popover.** "Does not approve claims. Claim approval is a signed step you perform in a terminal (aihydro-approve)." is no longer a permanent row; it heads the auto-run popover, one click from the chip (it also stays in the popover title tooltip). Wording unchanged. This is the owner decision O2 the plan left open, now taken on the owner's 0.4.2 feedback.
- **Paused grants explain themselves.** The "N paused" popover says these tools ask first and nothing runs without you, counts the tools by reason (server not trusted, not connected, effect not declared, declared destructive), and links to Hydro Tools & Data Sources. When the pause is about trust, the popover carries the same host-owned "Trust this launcher…" action as the paused-grant card (`TrustLauncherButton`); it only asks the host to show its confirmation.
- **Send and Stop** are flat 28 px buttons on `--vscode-button-background` with the `send` and `debug-stop` codicons, theme radius and the standard focus ring; no gradient, shadow, scale or fixed blue. Send is disabled while the input is empty.
- **"Start New Task" is "New chat"**, a modest secondary button at the right of the footer instead of a full-width primary bar (owner decision O-P4: demoted and renamed). It still goes through `clearTask`, so the confirm-before-stopping guard applies. Error states keep both buttons (Retry or Proceed, and New chat).
- **One Add menu.** The `@`, `+`, MCP-servers and rules icons are replaced by one **Add** button (codicon `add`, a plus) whose menu holds "Add context (@)", "Attach files & images" and "Rules & workflows". The composer row is now Add, model, Plan/Act and Send at 400 px. The MCP-servers popover is removed from the composer (Hydro Tools & Data Sources owns it). `lucide-react` is no longer imported by `ChatTextArea.tsx`.
- **Tokens.** The composer's new chrome (`composer/composer.css`) uses only design tokens and theme variables on the 4 px grid; the context ring caption uses `--aih-text-caption`.
- **Harness.** New screens `composer-add-menu` and `composer-paused-grants`; `composer-danger-policy` now asserts the visible "risky" marker, the New chat button, and the absence of the old paragraph.

---

## [0.4.2] — unreleased (UX program Wave 1: projects on chats, chat titles, real Focus, project context, map provenance and map chrome; plus the abort-confirm guard and the Wave 0 leftovers)

### Changed — map chrome: a 40 px rail, three states, one panel width (UX program Wave 1, PR X1-M1, branch `vision2040/x1-m1-map-chrome`)

- **The labelled 188 px ribbon is gone.** A 40 px icon rail holds Layers, Search, Pins, Measure and Draw ROI, then More. Labels are tooltips, and text only inside the More menu. Layers now has three tabs (Layers, Basemap, Reference), so Basemap and Reference vectors no longer take rail slots. Fit to layers moved to the zoom cluster. All chrome uses codicons (the emoji panel headers and buttons are gone).
- **Three states, one control.** Rail (default from 800 px), Collapsed (one 32 px "Map tools" button, the default below 800 px, with a badge for the open tool) and Hidden (a 24 px edge tab; Ctrl/Cmd+. toggles it and brings the open panel back unchanged). The chevron at the bottom of the rail collapses it in one click; the edge tab goes to Collapsed in one click. The choice is saved per user (`chrome` in the map workspace).
- **Nothing covers the map.** Panels dock beside the canvas from 960 px (the canvas shrinks by the panel and rail), float over it at 600-959 px, and become a bottom sheet with a drag handle (keyboard: arrows, Home, End) below 600 px, where the rail is forced to Collapsed. One panel width: 300 px, never more than 40% of the map (per-tool sizes and resize grips are deleted). Export and Gallery are centred modal sheets with a scrim, focus trap, Escape and focus return.
- **Conditional tools.** Swipe, Time and Flood sit in More and are disabled, with the reason as visible text ("No time-tagged layers", "No flood layers", "Needs a layer to compare with the basemap"), when there is nothing to act on. Swipe needs one layer, not two (the panel compares a layer with the basemap), a deliberate difference from the plan text.
- **Pins** opens the existing Annotations panel unchanged. Double-click pins, pin removal and the P tool are MP2 (X1-M2) and are not in this PR.
- **History** (the shared map and chat log) is not in the rail: it needs the MP5 timeline and has no panel to open.
- **Layer rows fit the 300 px panel.** The row header and the icon toolbar wrap instead of cutting off controls; long layer names keep their ellipsis and full-name tooltip.
- **Bottom bar.** The attribution text no longer runs under the zoom readout: it ends in an ellipsis with the full text as a tooltip, and the zoom, scale, coordinate and compass controls keep their width.
- **Accessibility.** Rail buttons are toggles (`aria-pressed`, exactly one lit); More and the collapsed button use `aria-expanded`; menus are `role="menu"` with arrow keys, Home/End, Escape returning focus; tabs follow the tablist pattern; disabled menu items stay focusable and describe their reason.
- **Harness.** A chrome coverage rule (`scripts/ui-screens/coverage.mjs`, self-test `coverage.selftest.mjs`) measures the `[data-map-chrome]` boxes over the canvas on every map screen: closed at most 6% (3% below 800 px), docked 0%, overlay at most 40%, sheet at most 60%. Eight new screens (`map-chrome-collapsed`, `-rail`, `-hidden`, `map-panel-docked-layers`, `map-panel-overlay-pins`, `map-panel-sheet-400`, `map-more-flyout`, `map-export-sheet`); steps may be `optional`. `scripts/map-browser-smoke.mjs` measures requestAnimationFrame frame times and tile requests around docked panel toggles against a floating control.

### Changed — one confirm guard on every navigation path that can stop a running chat (UX program Nav-1, branch `vision2040/nav-1-abort-guard`)

- **Navigation no longer silently aborts a running chat.** "New Task" in the view title, "New task" in the chat header, opening a chat from History, the standalone Navbar Chat tab, starting a task from a quick win, the Fix / Explain / Improve code actions, the MCP marketplace install, the `aihydro://` task link and "Delete all history" now ask "A chat is still running. Stop it and start a new one?" (Stop and continue / Cancel). Cancel leaves the chat exactly as it was and shows it.
- **What counts as running.** A live task that is not aborted and whose last message is not `completion_result`, `resume_task` or `resume_completed_task`: streaming, running a tool, or waiting on an approval or follow-up ask. Finished, aborted, absent and just-reopened (resume) chats proceed without a prompt.
- **One implementation.** `confirmAbortRunningTask` (`src/core/controller/abortGuard.ts`) replaces the map launcher's private modal; the map, ledger and preview launches use the same text and button. Pressing the agent's own "Start new task" button on its `new_task` ask does not prompt (the user is answering that question). A host that cannot show a modal keeps the chat, logs a warning and posts a non-modal notice.
- **Deliberately not guarded:** extension shutdown (`Controller.dispose`), the webview re-resolve, cancel-and-resume, deleting a single history item, "Reset state" (an explicit destructive reset), the programmatic `startNewTask` extension API, and the test server.

### Added — chat titles: data layer, History rename, opt-in bulk titling (UX program Wave 1, PR X1-P2, branch `vision2040/x1-p2-titles`)

- **A title is a short label, never an id or a result.** `src/shared/chatTitle.ts`: `checkTitle` refuses a bare gauge or site id (7 or more digits, bare or inside the text), a `basin_` key, `prj_`/`st_` ids, a chat ULID, any decimal number, a number with a unit (`%`, `mm`, `cfs`, `km2`, ...), a metric followed by a number (`NSE 80`), markup, line breaks, empty text and more than 60 characters (140 for a description). A name the user types (`checkUserTitle`) may carry a number but not be only an id, empty, long, multi-line or markup.
- **Deterministic fallback.** `fallbackTitle` builds the title from stored fields only: the recorded `userQuestion` for a map launch (the wrapped prompt is never read), the study's name without its id, else the first 8 meaningful words of the first message (openers such as "please can you" dropped, ids and results dropped). An earlier map prompt with no `origin` is recognised by its opening line and gets "Map location question" rather than a parsed title. It always passes `checkTitle`; a property test over 4,000 seeded random inputs checks that. `displayTitle(item)` is what every surface shows: a user title as typed, a stored title that passes the check, else the fallback; never the raw first prompt.
- **Model-written title, cheap and cancellable.** After the first assistant reply of a chat, and once more at its first `attempt_completion` (two calls at most, counted in `titleRuns`), one request asks the chat's own provider for `{title, description}`. The input is bounded (about 6,000 characters, the plan's 1,500 tokens): the first message (the recorded question for a map launch), the first reply cut to 1,800 characters, the study name, tool names; no tool arguments and no tool results. The reply is read only as far as a title needs, stops when cancelled (the chat is renamed or deleted) and times out after 20 s. A failed call, a timeout or a reply that fails `checkTitle` leaves the deterministic title. Never blocks the task loop.
- **What the model sees, and the default.** `autoTitle` is on by default (the plan's default). For each call the chat's own provider receives the first user message (up to 2,500 characters; for a map launch the recorded question), the first assistant reply (up to 1,800 characters), the study name and up to 8 tool names. No tool arguments or results. The first time a model writes a title a one-time, non-modal notice says so and offers "Turn off" (`titleNoticeShown`).
- **Cancellation, stated plainly.** `ApiHandler.createMessage` takes no `AbortSignal`, so cancelling (rename, delete, timeout at 20 s) stops reading and closes the stream (`iterator.return()`); whether the provider's HTTP request stops at once depends on the provider SDK. It is not guaranteed.
- **Unicode and split ids.** The checks read text after NFKC and with every Unicode decimal digit mapped to ASCII, and treat 8 or more digits across groups split by spaces or hyphens as an id. `prj_`/`st_`/`basin_` tokens are removed whole before the fallback builds a title. Also: format characters (`\p{Cf}`) are removed; 8 or more digits across any run of up to 3 non-letter separators (`_ / – — ー`, spaced dash, parentheses) count as an id; CJK numerals count only as a run of 4 or more; a digit sequence made only of 4-digit groups between 1800 and 2100 (`2020-2023`) is a year range, not an id (`20202023` still is); empty brackets left by a removed id are dropped. Bare numbers: the strict check refuses 5- and 6-digit numbers (station numbers in some networks) as well as 7+ digits, split or not (year pairs excepted); the fallback keeps a bare number only with 3 digits or fewer or as a year 1800 to 2100. CJK numerals are read as digits only by the checks; a stored title keeps its own characters.
- **Settings.** `autoTitle` (default on; off means no model call is ever made for a title, including by bulk titling) and `titleModel` (a model id on the chat's own provider; empty uses the chat's model). Under Settings, Features. Title calls are not counted in a chat's token totals.
- **The user lock.** `renameChat` (new RPC) stores a checked title with `titleSource: "user"` through `patchTaskHistory`. The merge rule (historyPatch.ts) is the lock: the loop writer cannot write a title, and the system writer cannot write one over a user title, so an automatic title that finishes after a rename is dropped at write time. `description` now follows the title's lock (owner "title"), so an edited description is not rewritten either. An empty title resets to automatic (clears the lock, stores the fallback, asks for one new automatic title).
- **History.** Rows show the checked title (search covers it); the pencil button or **F2** opens an inline rename (Enter saves, Esc cancels, a refused name stays with the reason, focus returns to the name); **Reset to automatic** appears for a name the user set. No header UI: the task header is X1-C2.
- **M2 fallback titles.** On the first start (3 s after activation, once per window), every chat with no title gets the deterministic one with `titleSource: "fallback"`: free, additive, idempotent, no network. One backup `taskHistory.json.bak-pre-titles-<timestamp>` is taken before the first write (none is written if it cannot be taken).
- **Opt-in bulk titling.** History shows "N earlier chats have only a short automatic name", with the count, a token estimate (N x 1,580: the plan's 1.5k in plus 80 out per chat, an estimate) and where it goes. Nothing is sent until "Generate titles for N chats" is clicked; it runs one chat at a time, can be cancelled, skips a chat the user renames meanwhile, never touches a user title, and is hidden with `autoTitle` off. "Not now" hides it (a per-viewer `localStorage` flag).
- **Telemetry.** `TelemetryService` removes `title`, `description`, `titleSource`, `titleRuns` and `userQuestion` (any depth) from every event at the single point every event passes through. Tests drive every `capture*` method and `capture`/`captureRequired` and assert no payload carries them.
- **No server mirror.** aihydro-tools 2.8.3 has `rename_project` (projects) and no tool that stores a chat title, so `renameChat` writes the host copy only. Nothing is sent to the server, and a downgrade keeps the new fields on disk but ignores them (`taskHistory.json.bak-pre-titles-*` holds the earlier copy). A chat-title mirror waits for a server tool.
- **Not in this PR:** the task header's title and inline rename (X1-C2), the History page's project grouping and FTS (X1-P3), a "Suggest new title" action.


### Changed — Wave 0 leftovers: research wording, About, Plan/Act hint, Cursor/Windsurf rule dialects removed (UX program PR X0-4b/X0-6b, branch `vision2040/x0-4b-copy-leftovers`)

- **Auto-run popover wording only.** "Enable auto-approve" is now "Enable tool auto-run", "Execute all commands" is "Run any command" and "Use the browser" is "Browse websites". The descriptions say what each grant allows. The policy classes, defaults and fail-closed behaviour are unchanged, and the chip's short names are unchanged. The docs page `docs/features/auto-approve.mdx` follows.
- **Plan/Act hint.** Plan: "gathers information and drafts a plan for you to review". Act: "carries out the task and asks before any action your auto-run settings do not allow".
- **Settings > About** describes AI-Hydro as a hydrology research agent with a recorded evidence trail, and no longer lists the browser among its tools.
- **Removed: the Cursor and Windsurf rule dialects.** The Rules modal no longer lists or toggles them, the two Cursor and Windsurf toggle RPCs, the two toggle state keys and `external-rules.ts` are gone, and the stored toggles are cleared once (idempotent). **Prompt impact:** `.cursorrules`, `.cursor/rules/**/*.mdc` and `.windsurfrules` in a workspace are no longer added to the system prompt's "USER'S CUSTOM INSTRUCTIONS" section. `.aihydrorules` (file or directory), global rules, workflows, `.aihydroignore`, skills and the language preference are unchanged. A workspace that relied on those files should move the text into `.aihydrorules`. The workspace "New rule file" button now sits under the AI-Hydro workspace rules (it used to hang off the Windsurf list).
- **Harness only.** The long diagonal line across the auto-run popover in the screen PNGs came from the harness, not the product: its viewport shim stretched any element whose inline style mentioned `100vh`, including the 10 px popover arrow. The shim now matches only a declared `height: 100vh`.

### Changed — host-assembled project context replaces the `research.md` injection (UX program Wave 1, PR X1-P4, branch `vision2040/x1-p4-context-section`)

- **Project and study context comes from the server, once.** At task start the host reads `aihydro://project/{project_id}/context?chat={chat_id}` (aihydro-tools >= 2.8.3, trusted first-party server only, the chat's stored `projectId`) and appends the returned `text` to the end of the system prompt, in the cached prefix, not in per-turn `<environment_details>`. The read happens again only when the key (project, chat, active study) changes: the study chip's binding changing, or the project arriving late. A turn with an unchanged key does no read and builds the identical string. A mid-task run does not refresh it; the next binding change or task does.
- **At most 2 KB (UTF-8), whole section.** Longer text is cut on a line boundary, never inside a `[run:]`/`[claim:]` marker or a multi-byte character, and ends with `[context truncated]`.
- **The text is passed through as given.** The host does not reinterpret the server's number gate, and the frame says the section is reference data that grants no permission.
- **`.aihydrorules/research.md` is no longer injected.** A rules file that is the 2.8.3 stub, or a digest older servers generated, is skipped when the rules directory is read. Other rule files are untouched.
- **Refresh is on binding changes, not after each tool run.** Values in the section carry their `[run:]`/`[claim:]` markers from the server; a run made mid-task shows up after the next binding change or in the next task.
- **Bounded and retried.** The read has a 4 s host timeout. A timeout or error is not remembered as the answer: the next turn retries (one read per turn, after a doubling backoff from 2 s, capped at 30 s). Definitive answers (`found:false`, no context template, empty text) are cached for the key.
- **Nothing to inject, nothing happens.** No project on the chat, no connected trusted server, a server that lists resource templates without the context one (older than 2.8.3), a failed or empty read: no section and no error.

### Added — projects on chats: `ensure_project`, immutable `projectId`, `_meta.project_id`, migration M1 (UX program Wave 1, PR X1-P1, branch `vision2040/x1-p1-projects-on-chats`)

- **A new chat gets a project.** Before its first tool call the host calls the server's host-audience `ensure_project(root_dir)` for the workspace folder (directly, not through the model; within a 5 s budget, retried a few times in the background if the server is still starting) and stores the returned `prj_<ULID>` on the chat's `HistoryItem` as `projectId`. The extension never mints the id. `projectId` is a creation field in `historyPatch.ts`: the first value wins, no later save, rename, favourite or migration changes it, and a loop save that omits it does not erase it. A resumed chat keeps the one stored on its item and is not guessed into today's folder.
- **Every call to the AI-Hydro server carries `_meta["aihydro/context"].project_id`**, beside the chat id and workspace: the tool-call handler, the final-answer audit and its gate, and the binding calls (`aihydro_chat_status`, `aihydro_rebind_chat`). It is `_meta` only (there is no legacy argument for it) and is omitted when the chat has no project.
- **The study chip lists the project's studies.** At launch and in the picker the candidates come from `aihydro://project/{id}` (labelled, hidden/test studies left out); the "only study" rule and the "pick one" copy now say "project" instead of "folder" when that is the source. A project with no studies yet, or a server that cannot read it, falls back to the folder's studies as before. The chip tooltip names the project (never the `prj_` id).
- **Migration M1 (earlier chats).** In the background, on the first start with a connected 2.8.3 server (it waits up to two minutes for the server), chats with no `projectId` are placed by the folder they were started in: `cwdOnTaskInitialization` (a creation field, written once since X0-1; on an item saved by an older build it may be the folder at its last save), else the checkpoint worktree `shadowGitConfigWorkTree` (a loop field rewritten on every save, so only a fallback). One `ensure_project` call per distinct folder. **Lossy by design:** a chat with no recorded folder, or whose folder no longer exists (moved or deleted), stays in "Unsorted" (no `projectId`) and is never guessed into another project. Idempotent: an item that has a `projectId` is never looked at again, a second activation finds nothing to assign and makes no server call, and a failed folder is simply retried next time. Nothing is deleted. **Safety:** before M1 writes anything it takes one backup, `taskHistory.json.bak-pre-projects-<UTC timestamp>` beside the history file (written once, never overwritten; if it cannot be taken nothing is written), and it patches only chats still present in the history, so a chat deleted in another window is not brought back. The one-time notice (how many chats were grouped, how many stay in Unsorted) is shown by the run that took the backup, so a second window stays quiet.
- **Dry run.** `scripts/project-migration-dry-run.ts` reads a copy of `taskHistory.json`, never writes and never calls the server, and prints counts and folder names only.
- **Older or absent server.** Needs aihydro-tools 2.8.3 (capability flags `project.host_ops`, `project.registry_v2`). Below that, or with no connected trusted server, there is no `projectId`, nothing crashes, the chat works as before, and the chip tooltip says "Projects need AI-Hydro tools >= 2.8.3". Chats are not migrated until a capable server is connected.
- **Overlap with X1-M0 (PR 98).** X1-M0 owns `src/core/project/projectIdentity.ts` (`getProjectKey(rootDir, hub?)` returns the `prj_` key read from `aihydro://project/by-dir`, never creating one, else the `dir:` fallback). This PR adds no key helper and no realpath/sha logic: creation stays with `ensure_project`, and the chat's key is the stored `HistoryItem.projectId`. Nothing here needs `getProjectKey`; map code keeps using it for the `dir:` fallback, and for a chat whose `projectId` is set the two agree because the server mints one id per folder.
- **Host-audience tools are refused to the model.** `use_mcp_tool` on a first-party AI-Hydro server looks the tool up in the server's tool list and, when its `_meta["aihydro/audience"]` is `"host"`, returns an error before any approval ask and before the server is called. It keys off the annotation, not tool names, so `ensure_project`, `set_project_default_study` and any future host operation are covered; without it the model could confirm its own default study. The host's own `ensureProject()` is unaffected. Hiding these tools from the system-prompt tool list is left to X1-A1.
- **Portable backup.** The backup reads the file and writes it with an exclusive create (`wx`) rather than `copyFile(COPYFILE_EXCL)`, which fails with EPERM on Windows runners; the migration tests build their folder paths with `path.resolve`, so they hold on Windows. (`mapLayerCatalog`'s legacy backup probably has the same latent Windows problem; not changed here.)
- **Capabilities read is retried.** A transient failure reading `aihydro://capabilities` (timeout, closed connection) is retried (0.3 s, 0.9 s) and, if it persists, is a retryable failure, not "server too old"; only a missing resource or flag means below 2.8.3.
- **Not in this PR:** project grouping in the History view, and any "Unsorted" UI beyond the notice.

### Changed — map provenance, host half: one `_run_id` key, honest "no run record", project identity (UX program Wave 1, PR X1-M0, branch `vision2040/x1-m0-map-provenance-host`)

- **One run key.** `MapCommandWatcher` no longer writes a layer metadata key spelled `run_id`. An `add_layer_from_run` command now copies the `provenance` envelope from aihydro-tools 2.8.3 (`chat_id`, `study_id`, `_run_id`, `tool`, `retrieved_at`, `source`; any other key is dropped by the schema) onto the layer, with `_run_id` as the only run key. A tools server older than 2.8.3 sends no `provenance`; the command's own `run_id` then fills `_run_id`, and with neither the layer has no `_run_id`. `study_id` is written, and `session_id` is kept as an alias because the symbology and 3-D inundation readers still use it.
- **Layer panel, chip and catalogue read that one key.** The run chip, its tooltip and the inspector's "Run ID" row use `_run_id`; a layer without it says "No run record" and never shows a guessed run. The tool and time rows read the envelope keys `tool` and `retrieved_at` (the older `tool_name` and `timestamp` are read only when the envelope key is absent), which the panel previously missed for server-stamped layers. `mapLayerCatalog` uses the same helper.
- **Older persisted layers.** Layers saved by the previous watcher carry only the `run_id` key, which is no longer read, so they now show "No run record". That is the honest answer for a layer whose run was never recorded under `_run_id`, not a regression.
- **`update_layer` cannot touch provenance.** Envelope keys, `project_id`, `item_id` and the `session_id` alias are dropped from an `update_layer` metadata patch, so a command can neither forge nor erase them.
- **TypeScript envelope types** in `src/shared/map/provenanceEnvelope.ts` (`MapProvenanceEnvelope`, `ENVELOPE_KEYS`, `RUN_ID_KEY`, `layerRunId`, `layerTool`, `layerRetrievedAt`, `runLayerMetadata`).
- **`projectIdentity.ts`** (`src/core/project/`): `getProjectKey(rootDir, hub?)` returns `{ key, kind: "prj" | "dir" }`. With the MCP hub it reads `aihydro://project/by-dir` (read only, never creates a project) and returns the `prj_...` id when the registry has one; in every other case it returns `dir:<sha256(realpath)>`, byte for byte the server's `project_key`. `dirProjectKey(rootDir)` is the `dir:` form alone. On Windows it hashes the same `os.path.realpath` string as the server (native realpath on Windows only, as Python's `ntpath.realpath`; on POSIX the plain JS realpath, which keeps the input's case like Python; backslashes, drive letter as the system reports it, no case folding, which `project_key` does not do either); tests pin POSIX and Windows values computed with Python `ntpath`.
- **Tests.** A grep test fails if `src/core/map` spells a metadata key `run_id`; watcher tests cover the envelope, the pre-2.8.3 fallback and the no-run case; `projectIdentity` tests pin two known paths to the values the Python function produces.

### Changed — chat polish P1: aggregated lifts, a real Focus, level reset (UX program Wave 1, PR X1-C1, branch `vision2040/x1-c1-chat-focus`)

- **Repeated lifts are said once, with a count.** Calls to one MCP server that declares no effect hints (or declares hints it is not trusted for) are one line, "<server> declares no effect hints (8 calls: a, b, c, +5)" / "<server>: effect unverified, server not trusted (n calls: ...)", with a disclosure that lists every call. Commands run under the same non-protected policy class (for example All Commands) and asks with no recorded decision merge the same way. The presenter's `LiftedLine` gains `count` and `members`; every lifted source message is in exactly one line's `members`, and the header's lifted count is the sum, so aggregation changes rows, never facts.
- **Never merged, at any level:** errors, refusals, denials, non-zero exits, protected paths, outside-workspace and DESTRUCTIVE findings, limits, truncation and cancellations stay one line per fact. A pending ask is its own item and is never folded.
- **Focus now differs from Normal.** At Focus the "no declared effect" notices leave the row list and are counted in the group header ("8 calls with no declared effect"); expanding the group lists them in full (`WorkGroup.absorbed`). Row counts (header plus lifted lines, per `chat-detail-rows.json`): owner shape 7 to 5 at Focus and 7 to 6 at Normal; 12 unannotated calls 15 to 3 at Focus and 15 to 4 at Normal; 8 unannotated calls 11 to 3 and 11 to 4; turn machinery 7 to 5 and 7 to 6. Fixtures that hold only errors or warnings are unchanged (Focus has nothing it may fold there). Verbose still shows every message.
- **Per-item risk flags exclude a line from merging.** A command or ask flagged outside the workspace, destructive or touching a protected path stays its own line with the risk named in its text (for example "Ran (auto run all, outside the workspace): rm /etc/hosts"), so it can never hide inside a count or a "+N". The Focus header also says how many servers its undeclared-effect count spans.
- **Switching the detail level clears the reader's open/closed choices for work groups** (`useGroupExpansion`), so Focus no longer inherits a group opened at Normal. Only groups are affected; a pending ask, error or answer is not a group.
- **Tests.** `chatDetailBaseline.test.ts` no longer pins "Focus equals Normal"; it asserts Focus has strictly fewer rows than Normal on the clutter fixtures and keeps every error, refusal and pending ask. New presenter property tests and webview DOM tests cover aggregation, the Focus/Normal DOM difference, the disclosure and the level reset. Header compaction at Focus (time and cost to the tooltip), prose clamping and the other chat-polish items remain in later PRs.

### Added — chat-polish P0 fixtures: the "before" images and row counts (UX program Wave 1, PR X1-C0, branch `vision2040/x1-c0-chat-fixtures`)

- **Dev-only; no product change.** Five new harness screens render today's chat so X1-C1 (aggregation, a real Focus, level reset) is measured against them: `chat-owner-approval-pending` and `chat-owner-approval-pending-focus` (the reviewed session's shape: two answered calls to a server without annotations, a `SESSION_RESOLUTION_FAILED` refusal, a pending `list_features` approval, a risky auto-run policy, 45 always-allowed tools, a to-do 2/4), `chat-auto-run-all-commands` (four commands under All Commands, one exiting non-zero), `chat-many-unannotated` (twelve unannotated calls at Focus) and `chat-map-launched-first-turn` (a map-launched chat whose first turn is the whole wrapped template). All data is invented layout data.
- **Focus equals Normal, now measurable.** `chatDetailBaseline.test.ts` runs the real presenter at every detail level over these and three older fixtures and compares the row counts with `webview-ui/screens-baseline/chat-detail-rows.json`. On every fixture Focus and Normal produce identical rows; a test pins that defect and X1-C1 is expected to replace it. Checker budgets exist for the new screens only; no existing entry changed.

## [0.4.1] — unreleased (Wave 0. Version 0.4.0 was set on 2026-10-17 and never published; by owner decision on 2026-10-29 the extension stays on the 0.4.x line, so Wave 0 ships as 0.4.1 instead of 0.5.0)

### Added — managed AI-Hydro tools environment and tools status (UX program Wave 0, PR X0-3, branch `vision2040/x0-tools-env`)

- **Network disclosure and consent.** The install downloads `aihydro-tools` and its dependencies from PyPI (pypi.org and files.pythonhosted.org); the size is typically several hundred MB (an estimate, not measured). It runs automatically only for a fresh, missing environment at the default path, only after a one-time consent that names PyPI, the size and the venv path, and only while `aihydro.tools.autoInstall` is true (machine scope). An unhealthy or outdated environment is never touched automatically: the Repair action upgrades it, and only Repair may `--force-reinstall`. Auto-install is off in test hosts.
- **Safety.** pip runs only after `pyvenv.cfg` exists and the interpreter reports `sys.prefix != sys.base_prefix` (otherwise `NOT_A_VENV`); an interpreter that exists but fails or times out is "unhealthy", never recreated; `venv --clear` happens only for the exact default directory whose interpreter file is gone, after a confirmation. An `O_EXCL` lock (`.install.lock`, stale-pid aware) serialises installs across windows; the MCP settings, the launcher record and the tools state are written atomically; probes and the MCP handshake run without `PYTHONPATH`/`PYTHONHOME` (`python -I`); children that ignore termination are force-killed after 2 s; the startup handshake times out after 30 s. A launcher record that existed and went missing is reported and needs confirmation instead of being re-recorded silently, and the explicit "trust" action always shows the modal.
- **A fresh profile reaches "ready and trusted" without a terminal.** The one-shot `pip install aihydro-tools` prompt and its permanent `aihydroToolsPromptDismissed` flag are gone. The extension now owns a venv (`<aihydro_home>/venvs/tools-2.8`, setting `aihydro.tools.venvPath`), created with Python 3.10 or newer (setting `aihydro.tools.pythonPath`, else `python3`/`python`) and installed with `<venv>/python -m pip install --upgrade "aihydro-tools[data,analysis,mcp,viz,gee,delineation]~=2.8.2"`. Nothing is ever installed into the system or base interpreter, and a directory that is not a virtualenv is never overwritten. Progress is a cancellable notification; a failure (no Python, offline, pip error, unhealthy result) leaves a visible, retryable state.
- **Adopt, repair, upgrade.** An existing environment at the path that imports `ai_hydro.mcp` and answers an MCP `initialize` + `tools/list` handshake with `aihydro-mcp` is adopted as is (no pip, no recreation); one below 2.8.2 is upgraded within `~=2.8.2`; an unhealthy one is repaired in place (Repair also forces a pip run).
- **Trust.** The managed `aihydro-mcp` is registered as the first-party server and recorded through `recordFirstPartyLauncher` on first registration (no record yet). If the command differs from the recorded launcher, the modal "Trust this launcher" confirmation is required, as before; declining leaves it registered and untrusted. A legacy first-party entry under another name (for example `aihydro-tools`) is now recognised, so no second `ai-hydro` server is created next to it. A working launcher registered elsewhere is switched only after a one-time "Switch to the managed environment / Keep current" choice (PYTHONPATH/PYTHONHOME are dropped from the entry's env on a switch).
- **Status, three places.** One chip on Welcome and the chat home (version, healthy/unhealthy, trusted/not trusted; Install, Repair, Retry, Cancel, Trust this launcher, Show log); a status bar item with the compact state; Settings > About diagnostics (interpreter, venv path, version, server command, trust verdict, requirement, Copy). New commands: Tools Status, Install or Update Tools, Repair Tools, Show Tools Log, Copy Tools Diagnostics. New RPCs `getToolsEnvStatus`, `subscribeToToolsEnvStatus`, `runToolsEnvAction` on `McpService`; the webview can request "trust" but only the host's modal records it.

### Changed — map context in prompts (vision-2040 X0-8, stop-gap, branch `vision2040/x0-map-context`)

- **The map block in `environment_details` is gated.** It is sent only when the map session's workspace matches the chat's folder (a home directory, drive root or folder shallower than three levels never claims its children), or the chat was started from the map, or the user's message refers to the map. A basemap alone no longer qualifies. Pan, zoom and fit events and the view line are gone; the whole block is capped at 600 characters; an identical block is not re-sent unless the user mentions the map, and is sent again after context truncation or compaction. On a stale-map fixture (12 layers, 35 mostly pan/zoom events) a 12-turn chat drops from 1949 characters every turn to 0 in an unrelated workspace and 483 once in the map's own; the fixture is `MapContextMeasurement.test.ts`. The deleted range of every chat is now changed only through `TaskState.setConversationHistoryDeletedRange` (the field is read-only to the compiler), which also resets the map dedup; condense, summarise, checkpoint restore and both truncation paths all use it. A map root that is the home directory (symlinks resolved), a drive root or shallower than three levels matches only an identical folder, never its subfolders. "The user referred to the map" now needs a map word (map, basemap, selected feature, this basin); generic words such as layers or drawing no longer count. This is a stop-gap that the MAP digest (MP3) supersedes.

### Removed / Changed — Wave 0 clean-up of inherited Cline features (vision-2040 X0-4 to X0-7, branch `vision2040/x0-cleanup`)

- **Removed: the account, credits and dictation stack.** The webview Account views, credits tables, `AiHydroAuthContext`, `AiHydroAccountInfoCard`, the `AiHydroProvider` form and `CreditLimitError`; on the host `AuthService`, `FirebaseAuthProvider`, `AiHydroAuthProvider`, `AiHydroAccountService`, the `AccountService` and `DictationService` RPCs, the remote-config fetch that depended on them, the unreferenced `AiHydroHandler` API handler, the `/auth` URI route, voice dictation (settings card, recorder, audio and transcription services, telemetry) and its `dictationSettings` state. The cloud-account path was already off unless `AI_HYDRO_ENABLE_CLOUD_ACCOUNT=true` (that switch, the `firebase` config block and the `firebase` npm dependency are gone too). The webview CSP no longer allows the Firebase or googleapis hosts. The dead tree-sitter payload (`src/services/tree-sitter`, 15 wasm files, `web-tree-sitter`, `tree-sitter-wasms`) is removed, and `proto/descriptor_set.pb` (used by the standalone core) is regenerated. No provider form changed: Anthropic, OpenAI, Google, OpenRouter, DeepSeek, Ollama and the others are untouched.
- **Secrets migration.** The two secrets `clineAccountId` and `cline:clineAccountId` (third-party sign-in tokens nothing reads any more) are deleted once, on first start, by `removeRetiredAccountSecrets`; it is idempotent (marker `migrations.retiredAccountSecrets.v1`) and touches no provider key.
- **Removed: Generate Commit Message** (SCM button, keybinding, handler, palette entries).
- **Removed: the `aihydro "…"` CLI subagent path** (SUB PR-0): the `/subagent` slash command, the `CLI_SUBAGENTS` prompt sections, `checkCliInstallation`, `cli-detector`, `subagent_command`, the Settings card and its output-line slider. Any command that runs a program named `aihydro` is now denied with a message, in every setting (`subagentsEnabled` no longer re-enables it). The explorer policy file stays for the in-process explorer; nothing reads `AIHYDRO_PROFILE` any more (the approval terminal still clears it).
- **Removed: the code-definition tool** (`list_code_definition_names`) from the tool list, the system prompts, auto-approve and the explorer allowlist.
- **Changed: the browser tool is off by default** (`browserSettings.disableToolUse` now defaults to true; a stored value is kept). A `browser_action` call is refused by the host while it is off. Settings > Browser now has a positive "Enable browser tool" checkbox.
- **Fixed: audit settings copy.** It said the answer audit is "Display only: it never blocks"; the gate is on by default. The copy now says an answer with uncited numbers can cost up to 2 extra model requests.
- **Changed: command palette.** Every command has the category "AI-Hydro" and no title repeats it; "New Analysis" is "New Task" (the word the sidebar button uses); "Create Test Tasks" is hidden outside dev mode through `menus.commandPalette`; the duplicate "Test Google Earth Engine Connection" is hidden from the palette (the Connectors panel still calls it). There is no capsule-export command yet, so no palette entry was added.
- **Changed: "AI Hydro" is now "AI-Hydro"** in every user-visible string, including approval headers; `docs/ui-naming.md` records the words and `src/shared/__tests__/uiContract.test.ts` fails on a new "AI Hydro" in source, webview source, the walkthrough or `package.json`. The settings privacy text links to `PRIVACY.md`.
- **Changed: the walkthrough is now hydrology** (connect a model, tools ready, delineate a basin, compute signatures, record and approve a claim), with local SVG images and no network fetch. `openWalkthrough` from the webview now uses the real walkthrough id.

### Changed — one writer for chat history; each chat is bound to its study at launch (UX program Wave 0, PRs X0-1 and X0-2, branch `vision2040/x0-binding-history`)

- **X0-1: a single writer for `HistoryItem`.** The task loop used to rebuild the whole item on every save, and the favourite toggle was a second writer, so a favourite set while a task ran was reverted by the next message. Every write is now a patch from a named writer (`src/core/storage/historyPatch.ts`) with one owner per field: the loop owns tokens, cost, size and timestamps; creation fields (`ulid`, `cwdOnTaskInitialization`, `origin`, `userQuestion`, `projectId`) are first-write-wins, so `cwdOnTaskInitialization` is no longer recomputed from the current folder on each save; user fields (favourite, pin, description, memory mode, a renamed title) and the study mirror (`activeStudyId`) are never written by the loop. Fields a newer build wrote are preserved. `title`, `titleSource`, `description`, `pinned`, `memoryMode`, `projectId`, `origin`, `userQuestion` and `activeStudyId` are declared as optional types now. A build older than this one keeps them on disk and ignores them. No rename UI ships here; `renameTaskHistory` is the entry point it will use.
- **X0-2: the chat is bound before its first tool call.** The host mints the chat id before the task, then asks the server which study the chat is about: a resumed chat keeps its binding; a map launch uses the clicked layer's study id, then the server's artifact manifest (`aihydro://study/by-artifact`); otherwise the only study in the folder (`aihydro://study/list`). When more than one study could be meant, nothing is bound and a **study picker** lists them by the server's labels; the chat is bound once, to the one you click. "New study (delineate)" and "No study" close it without binding. A `SESSION_RESOLUTION_FAILED` result that carries candidates opens the same picker, so a read-only call on an unbound chat no longer ends without a way out. This fixes the 2026-10-28 failure (a map-launched chat on study `try` calling `measure_feature`).
- **Study chip.** The task header shows the bound study (id first, then the server's label) as a button; clicking it opens the picker to switch. It follows the server's `session_binding` field on tool results and shows why a study is or is not bound.
- **A map action no longer silently stops a running chat.** "Ask" and "Delineate here" (and the transect and annotation actions) ask for confirmation before replacing a chat that is working or waiting for you; declining keeps the chat. A finished chat is replaced without a prompt.
- **The extension no longer reads the server's files for studies.** The header chip, the Replay and Experiment session lists, and the launch binding all go through the server's resources and tools. `src/integrations/aihydro-session/` has no filesystem import (guarded by a test). `boundStudy.ts` is removed.
- **Replay and Experiment panels on aihydro-tools older than 2.8.2** show "Study list needs AI-Hydro tools >= 2.8.2." instead of an empty session list, and say when the server is not connected or the list could not be read.
- **Scope of the fix.** The 2026-10-28 owner failure is fixed in tests (a fake server written from the tools 2.8.2 contract); owner checkpoint pending on the installed build with published tools 2.8.2.
- **Ledger and preview launchers** ask before replacing a chat that is working or waiting, like the map actions, and record their origin.
- **Older servers.** Features are detected from `aihydro://capabilities` flags, never version numbers. With aihydro-tools 2.8.1 (no capabilities resource) the extension cannot list studies: the chip is read-only, the picker is off, a layer's own study id is still bound through `aihydro_rebind_chat`, and nothing is guessed. Full behaviour needs aihydro-tools 2.8.2.

### Security — zod 4 to clear GHSA-mrhx-c7xc-m3w5 (branch `vision2040/zod-advisory`, PR #88)

- `zod` moves from ^3.24.2 to ^4.6.7 (every 3.x release is in the advisory range; no patched 3.x exists). `z.record` now takes key and value schemas. `body-parser` 2.3.0 to 2.4.0.
- **Overrides outside declared ranges.** `package.json` `overrides` force `openai` (declares zod ^3), `@sap-ai-sdk/prompt-registry` 1.x (zod ^3) and `chromium-bidi` (zod 3.23.8) onto the root zod 4. Remove each entry once that package declares zod 4.
- **Runtime-tested on zod 4.6.7:** MCP SDK 1.32.1 stdio round trip (listTools with annotations, callTool, listResources, `notifications/message`; now `zodMcpRoundTrip.test.ts`), mistral, and construction of all SAP prompt-registry schemas. **Not tested:** SAP orchestration against a live AI Core tenant, openai's zod helpers (unused), the chromium-bidi parser (not in the bundle).
- **Behaviour change:** zod 4 injects `autoApprove: []` when the field is absent from a server config (pinned by a test); `policyGate` treats absent and `[]` alike, so this is not reported as a policy loosening.
- SAP AI SDK 2.x was rejected: it pulls node-forge/node-rsa into the bundle, whose PEM header constants trip the VSIX private-key scan.

### Changed — Run / Deny / Always on the card that asks; a view badge and a focus command (vision-2040 Wave 2, PR W2-E2, branch `vision2040/w2-e2`)

- **Approvals are answered on their own card.** A pending tool, command, MCP or browser-launch ask shows Run (Save, Run Command), Deny and, where eligible, Always on the card, at every transcript detail level. The footer shows no buttons for these asks; every other ask (retry, completion, resume, new task, condense, install, workspace setup) and any ask kind the UI does not know keeps its footer buttons. The buttons answer with their own card's ask ts through the same `executeButtonAction` -> `askResponse` path, so an answer for an ask that has since changed is dropped by the host and "That request changed — review again" appears next to the card. The composer draft is still sent as feedback with Run, Deny and Always; a line says so ("Your draft will be sent with your choice.").
- **"Always" is offered only for an MCP tool call** (never resource access or a native tool, command or browser launch) on the trusted first-party server whose tool declares a read, write or network effect, with no security stamp, and not already auto-approved. It saves the grant through the policy-gated `toggleToolAutoApprove`, checks that the returned settings show the tool marked, and only then approves. A host refusal or a reply that does not show the tool marked approves nothing and shows the reason inline. After a saved grant a line above the composer says where to revoke it (MCP settings; dismissible, it stays when the card folds into a work group). If the grant saved but the approval did not send, the card says so and asks you to press Run. When MCP auto-run is off the button stays and says in text "Always is inactive while MCP auto-run is off" (the composer chip's wording). With aihydro-tools older than 2.5.0 (no annotations) or a third-party server, Always is not shown.
- **Fix:** a pending browser-launch ask rendered an empty card in the Normal and Focus views; it now shows "AI Hydro wants to launch a browser:" and the URL, and can be answered.
- **Reply to deny.** While an approval is pending the composer placeholder reads "Reply to deny with a note…" and the send button's tooltip says it denies the call with your note (behaviour unchanged).
- **"Approval waiting" pill.** Whenever an approval is pending and the list is not at the bottom (wheel, keyboard or scrollbar), the scroll button becomes a labelled "Approval waiting" pill. It scrolls; it never answers.
- **Sidebar badge and command.** While the agent is blocked on you the AI-Hydro view shows a badge. The new command "AI-Hydro: Focus Pending Prompt" (palette only while something is pending; no default key) scrolls to the pending request and focuses its approval group, never the Run button. If another view (History, Settings) is open, the command switches back to the chat first. Nothing is focused automatically. After an inline answer, focus returns to the composer if it was in the group, including when the answered call folds into a work group.
- **Screen reader.** The status line announces "Waiting for your approval: ..." once per request.
- Dev: `src/shared/aihydro/pendingAsk.ts`, `src/core/controller/ui/pendingAskBadge.ts`, `src/hosts/vscode/pendingAskSink.ts`, `webview-ui/src/components/chat/approval/`; new streaming rpc `subscribeToFocusPendingPrompt`. Known limit unchanged: a grant is checked when written, not at call time (M-3).

### Security — "Always" grants are rechecked when the tool runs; a launch-identity change counts as a loosening (vision-2040, M-3, branch `vision2040/m3-runtime-recheck`)

Closes M-3 of `docs/vision-2040/plans/w2e-inline-approval.md`, the condition for shipping tool annotations (aihydro-tools 2.6.0).

- **Run-time recheck.** A per-tool entry in `autoApprove` now auto-runs a `use_mcp_tool` call only if `alwaysAllowVerdict` is ok against the live connection at call time: the server is still trusted (`isServerTrusted`: name, recorded launcher and launch hash), connected, lists the tool exactly once, and the tool's effect class is read, write or network. Otherwise the call is **asked**, as if there were no grant. This fails closed and the stored grant is **not deleted**: it resumes by itself if the conditions hold again (for example after the launcher record is restored). Decided in `mcpAutoApproveDecision` (`src/core/task/tools/mcpAutoApprove.ts`), the one place `UseMcpToolHandler` reads a grant; no tool or server names are special-cased.
- **The ask says why.** The `use_mcp_server` ask carries `autoApprovePaused` (a JSON field of the existing ask text, no proto change), shown above the call: "Always for X is paused: the server's launch identity changed or it is no longer the registered first-party server." / "...the tool is now marked destructive." / "...the tool no longer declares what it does." / "...the server no longer lists this tool exactly once." / "...the server is not connected." (`alwaysPausedText` in `src/shared/aihydro/alwaysAllowPolicy.ts`).
- **Composer chip.** The auto-run chip no longer counts a grant the host would pause as an "always allowed" risk. It shows "N MCP tools paused (asks first)" instead. This uses the server trust verdict and tool annotations the webview already receives; when the trust verdict is absent the grant still counts as active (over-warn).
- **Launch-identity change is a loosening.** In the settings policy gate, an external edit that changes `command`, `args`, `env`, `cwd` or `url` of a server while at least one of its existing `autoApprove` grants survives the edit needs the same confirmation as other loosenings ("Apply changes" / "Revert"; Revert restores the accepted launch identity). Changing those fields on a server with no grants, or dropping the grants in the same edit, needs none; `timeout` and `headers` are not part of the identity. This is defence in depth: the run-time recheck already stops a changed launcher from being honoured.
- **Behaviour change visible to users.** A stored grant on a server that is not the recorded first-party launcher (for example third-party grants hand-edited into the file, kept working by the previous entry) no longer auto-runs: those calls ask. Nothing in `aihydro_mcp_settings.json` is removed.
- Tests: host mocha against the real stub stdio server and the real `UseMcpToolHandler` (`toggleAutoApproveRefusal.test.ts`: auto-runs when trusted; asks after the launcher record or launch hash changes, after annotations flip to destructive or are dropped on reconnect, with a duplicated tool, on a disconnected server; the grant stays in the file), `McpHubPolicyGate.test.ts` and `policyGate.test.ts` (launch change with and without grants, revert), and the webview chip (`ComposerStatus.test.tsx`).

### Security — the host refuses "Always" for untrusted or unannotated MCP tools; ask responses are bound to their ask (vision-2040 Wave 2, PR W2-E1, branch `vision2040/w2-e1`)

- **Behaviour change from Cline.** The MCP settings panel's per-tool "Tool auto-run" and "Auto-run all tools" no longer accept every tool. The extension host now refuses to add a tool to a server's auto-approve list unless **all** of these hold: the server is the registered first-party AI-Hydro server (name AND the recorded launcher, `isServerTrusted`), it is connected, the tool is listed exactly once under that exact (case-sensitive) name, and its declared effect class is read, write or network. A **destructive** tool, a tool with **no declared effect** (no annotations), and **every tool of a third-party server** are refused, even if that server declares `readOnlyHint` (annotations count only on a trusted server). Removing a tool from the list is always allowed. A request is all-or-nothing: if any tool in it is refused, nothing is written. Existing grants in `aihydro_mcp_settings.json` are not touched (since the M-3 entry above they auto-run only while they pass the run-time recheck); edit the file by hand to keep a grant for a third-party server (an external edit is still confirmed by the policy gate). Cost: users who relied on auto-run for third-party servers must approve those calls one by one.
- **Settings panel.** Ineligible adds are disabled, with the reason as visible text ("Not available: only the registered first-party AI-Hydro server can be auto-approved ... not the registered first-party server ..."). "Auto-run all tools" sends only the eligible tools. A refusal from the host is shown inline instead of only logged.
- **Ask responses are bound to the ask they answer.** `AskResponseRequest.ask_ts` (new, field 1000) carries the ts of the ask message the click or reply was made for. The host compares it with the ask it is waiting on (`taskState.lastMessageTs`); on a mismatch it ignores the response, logs a warning and returns `AskResponseResult.stale = true` (`askResponse` now returns this instead of `Empty`). The webview shows "That request changed — review again" for a few seconds and keeps your draft and attachments. `ask_ts` 0 (older callers, the automatic API retry) is accepted as before. This closes a race where a click generated for one command or tool call could answer a different one that appeared in between.
- Dev: `src/shared/aihydro/alwaysAllowPolicy.ts` (verdict and refusal format shared by host and webview), `src/core/task/askResponseBinding.ts`, `src/core/task/tools/mcpAutoApprove.ts` (the one place `use_mcp_tool` reads a grant). The unused duplicate `McpHub.toggleToolAutoApprove` is removed.
- **What "Always" now needs, and what it costs.** It works only when the server is the recorded trusted first-party launcher **and** the tool is annotated by the server. The real aihydro-tools annotates every registered tool (annotations shipped in 2.5.0; origin/main, version 2.6.0, has 173 rows: 76 read-only, 84 write non-destructive, 13 destructive, and the unreleased "no row is served unannotated" change makes a tool without a row conservative). So with aihydro-tools >= 2.5.0 launched by the extension's recorded launcher, 160 of 173 tools can be auto-approved and the 13 destructive ones cannot; an older aihydro-tools (no annotations) gets no "Always" at all, and neither does any third-party server.
- **M-3 (a stored grant outliving its conditions) is closed by the entry above.**
- **Bound senders.** The chat footer buttons, replies, followup/plan option buttons and the credit-limit Retry all send the ask's ts. A `command_output` response stays valid across the chunks of the same running command's output (the host tracks the command's output stream explicitly), but never answers a different ask. A second response for an ask that was already answered is dropped. The `exports` API and internal callers (the automatic API retry, slash commands, plan/act switch) send no ts and remain unbound by design.
- Run-time of this entry was unchanged: a grant was checked when written, not when the tool was called. The entry above changes that.

### Changed — the composer's auto-run bar, hint line and full-width Cancel become one status footer (vision-2040 Wave 2, PR W2-D, branch `vision2040/w2-d`)

- **One status line.** `ComposerStatus` replaces the 3-line "Tool auto-run" bar: a policy chip such as "Auto-run: Read, Edit, MCP" (derived from the action ids in `auto-approve-menu/constants.ts`), the context ring, and the claim disclaimer. The chip opens the existing auto-run settings as a popover.
- **Risk is text and an icon, not colour.** A warning icon and "(risky)" appear when the global YOLO mode is on (chip text "YOLO: everything auto-runs"; core honours YOLO even when auto-run is off), or "Edit (all)", "All Commands" (with read-only commands, as core gates it), every menu action at once, or any per-server MCP tool "always allow" grant is set. MCP grants show their count ("2 MCP tools always allowed"); when they cannot fire (auto-run or MCP auto-run off) they are still flagged and labelled "set to always allow (inactive while auto-run is off)". The chip's accessible name states the full policy.
- **Disclaimer kept.** "Does not approve claims…" stays visible as one muted line and also heads the popover. Removing the always-visible line (owner decision O2) awaits owner sign-off.
- **Context ring** (per-request context over the model window, same data as the task header) with `role="img"` and an "unknown" state.
- **Compact stop.** While a request is in flight the send button is replaced by a 28 px stop button ("Stop task"); the full-width Cancel is removed from `partial` and `api_req_active`. Task-level buttons (Retry, Resume, Start New Task, Proceed) are unchanged.
- **Hint line removed** from under the prompt; the `@` / `/` hint lives in the placeholder while there is no task.
- The favourites quick-toggles are removed with the bar, and the popover's star controls are removed (they had no visible effect). The persisted `favorites` setting is left untouched.
- **Stop is latched.** Both the stop button and Escape share one guard; the button shows "Stopping…" (disabled, `aria-busy`) until the task stops, so a double cancel cannot re-initialise the task twice.
- **Popover accessibility.** `role="dialog"` with a label, focus moves in on open, Escape closes it and returns focus to the chip without cancelling the task.

### Changed — answer card, audit footer, "this turn" summary; pre-completion gate on by default (vision-2040 Wave 2, PR W2-B-web, branch `vision2040/w2-b-web`)

- **AnswerBlock.** The completion answer is one neutral card: an "Answer" header (not green; finishing a task is not evidence), normal-foreground prose, then an evidence strip, a "This turn" line, actions and the audit footer. Markers stay inline chips in the prose, at the citation they back; below the body a de-duplicated evidence row lists each distinct claim (only an `approved` claim is green), run and literature reference once, collapsing to a count with "Show all (n)" above 4. Markers are found by one shared helper (`src/shared/aihydro/evidenceMarkers.ts`) that the markdown renderer also uses.
- **This turn.** "Referenced this turn: 3 runs · 2 claims (none approved) · 1 file changed · See new changes", from the recorded messages of the turn (run and claim ids named by tool results or cited in the answer, file edits). It counts references, not creations. Claims are always listed with their approval state, so the line never implies approval. "See new changes" is the old full-width button, now inline.
- **Actions.** Copy; "Ask agent to cite" (only when the audit has hard findings, or any finding from an ungraded server) sends one fixed request as your reply; the rating buttons moved into a "more" menu.
- **AnswerAuditFooter.** One line ("Audit: 4/6 numbers traced · 1 hard · 2 advisory", "Audit (ungraded server): n findings", "Audit not run: reason"; nothing when skipped), with the disclosures always visible (unresolved findings, removed quantities, "no longer reported", earlier-narration findings, revision requests) and the findings list (hard first) and "Show draft (n)" behind disclosures. It says "passed" only for an audit that ran and found nothing, is never green, and draft text is plain text. The claim-chip popover now also says that nothing in chat approves a claim (the auto-run bar keeps its sentence).
- **Gate default ON.** `finalAnswerAuditGate` now defaults to on (Settings > Features). Eligibility is unchanged: audit on, a trusted first-party AI-Hydro server with the graded audit (aihydro-tools >= 2.6.0), study bound, Act mode. Any other setup streams the answer exactly as before.
  **Upgrade note:** installs that never touched this setting switch from off to on (an unset value now reads as on). To turn it off, clear "Check answers before showing them" in Settings > Features; turning off "Audit final answers" there also turns the gate off. Inline chips are compact (24px hit area, 11px text, line rhythm kept); the evidence row skips markers inside code, like the inline chips. Old tasks show the card without a footer; the old "**Answer audit" prose rows stay prose.

### Changed — the chat transcript renders through the presenter (vision-2040 Wave 2, PR W2-A2, branch `vision2040/w2-a2`)

At Normal detail (the default) the per-request cost rows, "Thinking:" rows, tool-call rows, results and the checkpoint marker line fold into one collapsed **work group** per stretch of work. Prose, pending approvals, errors and the final answer stay top level; `ActionButtons` and the approval flow are unchanged.

- **Group header.** One real `<button aria-expanded aria-controls>`: "Worked 1m 52s · 8 tools · $0.0535", built only from presenter facts: agent time and time waiting for you are separate, cost reads through its honesty label ("no cost recorded", "at least ..."), and retries, reused results, calls that did not run and answer revisions are counted. Its accessible name leads with problems ("Ran 8 tools, 1 failed").
- **Nothing the reader must not miss is folded.** Failures, refusals, cancellations, truncation, condense, "malformed tool call; retried", security-relevant approvals and the checked-out checkpoint state are real text lines (codicon plus words, never colour alone) under the collapsed header, and are counted in it.
- **Detail setting.** `transcriptDetail`: `focus` | `normal` | `verbose`, default `normal`, stored with the other UI settings (`UpdateSettingsRequest.transcript_detail`), a three-way control above the transcript, and the command "AI-Hydro: Cycle transcript detail" (`aihydro.cycleTranscriptDetail`, no default keybinding). `verbose` shows the same rows as the previous version and adds the detail bar.
- **Resolvers.** The webview passes the presenter its two required resolvers. MCP effect class is read from tool annotations only for a server the host reports as trusted (`McpServer.trust`); an untrusted server's `readOnlyHint` never folds a call. Tool annotations now cross the proto boundary (`McpTool.read_only_hint` and three siblings, all optional) so the webview can read them. Protected paths: the host is authoritative. When a tool row (native file tool or MCP call with path-like arguments) names a path that the real `isProtectedPath` check resolves into protected state (symlinks, every workspace base), the host stamps the row `policyClass: "protected_path"` (`src/core/task/protectedStamp.ts`, applied when messages are saved) and the transcript lifts on the stamp. MCP path detection is heuristic: it checks values under path-like argument names (matched as a case-insensitive suffix: `outputPath`, `outDir`, `target`, `uri`, ...) and any absolute, `~` or `file://` value under any key, and a call too large to walk is stamped as uninspected. It can only over-lift. The whole message list is stamped once when a task is loaded or resumed, so protected writes in old tasks are marked too. The webview matcher (`protectedPathMatch.ts`, roots from `ExtensionState.protectedRoots`) is best-effort display only: it adds lifts for unstamped rows (old tasks), can over-lift, and does not follow symlinks. With current aihydro-tools (every tool annotated) reads and session writes fold and only a destructive call is listed. A server without annotations (an old install) or an untrusted one has an undeclared effect: each call is listed as a neutral-tone line ("effect not declared by the server") rather than folded, because a missing fact must not hide a call. An untrusted server that did declare annotations reads "effect unverified" instead (its hints are not believed and never fold a call).
- **Rewind replaces the checkpoint row.** A "Rewind" action on the group header and on each user turn (visible on hover or focus, always in the tab order) opens a disclosure with Compare and three separately labelled restores (files, task, both). Each says it does not undo recorded claims, runs or MCP side effects (`~/.aihydro`). It runs the same RPCs as the old row (`useCheckpointActions`, shared with `CheckmarkControl`).
- **Accessibility.** The transcript is `role="log"` with `aria-live="off"`; one throttled polite status region announces "Running ...", "Thinking" and "Answer ready", never streamed text; the live activity line is static under `prefers-reduced-motion`; when a live group collapses with focus inside it, focus moves to its header.
### Added — pre-completion answer-audit gate with silent self-revision (vision-2040 Wave 2, PR W2-C, branch `vision2040/w2-c`)

- **Setting `finalAnswerAuditGate`** (Settings > Features, shipped off; default on since W2-B-web). Requires the answer audit. When on and eligible, the audit runs before the answer is shown; a graded outcome with hard findings sends the model one non-error revision request (at most 2 per completion cycle, not counted toward the mistake limit). The draft is not streamed while eligible: one updating line ("Drafting answer…" / "Checking answer against evidence…") is shown instead.
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

### Changed — `aihydro-pack` release builds also require `pack.config.json` to be a committed file inside the source root (same tracked-and-byte-identical check as the course files).

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
