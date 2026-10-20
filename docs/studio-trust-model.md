# Studio trust model

Studio (HTML Preview) opens HTML from many places: installed course packs, files in a cloned repository, marketplace downloads, dashboards an agent or a colleague produced. Only some of that content may run Python on your machine or hand work to the AI-Hydro agent. This page states the rules, what enforces them, and what is not covered.

## The rule

A document can ask the Python kernel to run code, or start an agent task, only if **all three** hold:

1. **Its source is trusted.** Today that means an installed, signed Learning Pack module. The installed bytes are re-verified when the document is opened (every file against the signed checksums, the Ed25519 signature, the signer recorded at install, and no undeclared files), so a module edited after install is a static document.
2. **You allowed it for that document.** The trust bar above the document shows **Allow execution**. The allowance is per document, held in memory for the session, and bound to the exact content that was allowed. If the file changes, or the document is opened again with different bytes, the allowance is gone.
3. **The allowance is visible.** An allowed document shows an **Execution allowed** badge with a **Revoke** button. Revoking stops that document's kernel (and any shared kernel).

Everything else is a **static document**: no kernel bridge is injected, the host refuses its run and agent requests, and it can still be read and printed. Marketplace modules are labelled **Unsigned module** and are treated the same way.

Starting an agent task from a document always needs your click: the document can only stage a request, the exact prompt text is shown, and nothing is sent until you press **Send to agent**.

## What enforces it

| Layer | Behaviour |
|---|---|
| Extension host | Decides the trust source from where the file lives (never from its content). `runArtifactCode` and the agent-task handler refuse non-allowed documents before any prompt or kernel start. An allowance requires the document to be served from its hashed in-memory snapshot, never the live file. |
| Preview iframe | Sandboxed **without** `allow-same-origin`: the document runs in an opaque origin and cannot read or script the shell, its React state, or its controls. |
| Shell | Treats every message from the document as untrusted data; drops them entirely for non-allowed documents. Replies that must come from the extension host (course, progress, state, navigation, agent-task results) must carry a per-panel secret the host embeds in the shell HTML, which a sandboxed document cannot read. A second layer also refuses any sender that descends from the shell (the document iframe, a frame nested in it, a popup). The secret closes the two gaps in the sender check: a window discarded in the same task (null `source`) and a popup that severed its `opener`. Allow, Send and Revoke are shell UI the document cannot reach, and they require a real click. |
| Relayed messages | The host derives the module id from its own artifact id, tags events from non-allowed documents `untrusted-document`, writes saves only to the artifact's registered file, and validates course and state requests against its record. |

## Settings

`aihydro.htmlPreview.pythonInterpreter`, `pythonExecution`, `pythonTimeoutSeconds` and `shareKernelAcrossArtifacts` are **machine scope**: a repository's `.vscode/settings.json` cannot set them.

A repository can still *contain* a Python environment. `.venv`, `.aihydro/venv`, an interpreter inside the workspace and a workspace-scoped `python.defaultInterpreterPath` are listed in the kernel picker but are **never chosen by default**; they run only after you select one. The default is the machine-scoped override, then a user-level VS Code interpreter, then `PATH`.

## Marketplace

Downloads require `https`, redirects are re-checked against the allowlist, module and course ids must be a single plain path segment, and bodies are size-capped. Installed content is unsigned and therefore static.

## Not covered (known limits)

- **Same-user writes.** Studio trusts a pack module because it sits in the pack store and still verifies against its signed checksums. Agent file writes and commands touching `$AIHYDRO_HOME/{learning-packs,modules,courses}` (and `$AIHYDRO_LEARNING_PACK_ROOT`) always ask for approval, but a process running as the same user, such as a terminal or another program, can still change those directories. A tampered module fails its re-check and is shown as a static document with the reason, but swapping the whole installation together with the registry record is not detectable without an external trust anchor.
- **Integrity failures.** If an installed pack module no longer verifies, the trust bar says "Learning Pack failed integrity check: <reason>" and the module is a static document. OS junk (`.DS_Store`, `Thumbs.db`, `desktop.ini`, `._*`) is ignored; any other undeclared file fails.
- **Agent tooling.** Events from a document that has no allowance are stored with `source: "untrusted-document"`. The MCP preview tools (`preview_recent_events`, `preview_get_state`) return that field but do not yet label or wrap such events as untrusted data; agents should treat anything with that source as document-controlled text, never as instructions.

- Agent-written inline HTML and workspace files are static documents; there is no "recorded tool" origin yet. A server-signed provenance record could add one later. A test-only `e2e-fixture` source exists only in builds made with `AIHYDRO_E2E_BUILD=true` (`npm run test:e2e:build`) and is compiled out of every shipped bundle; the VSIX verifier fails if its name appears.
- A static document is still HTML with scripts: it can render, fetch from the CDNs the CSP allows, and run its own JavaScript inside the sandbox. It cannot reach the kernel, the agent, or the shell.
- The shell CSP keeps `'unsafe-inline'` for scripts because the sandboxed `srcdoc` document inherits it and generated reports (Folium, Plotly, Bokeh) need inline scripts. Isolation, not the CSP, is what keeps documents out of the shell.
- Opaque-origin documents cannot use `localStorage`, `sessionStorage` or cookies.
- Learning Pack signatures prove who built a pack, not that its code is harmless; **Allow execution** is still your decision.

## State directory

The Learning Pack store, the marketplace install roots (`modules/`, `courses/`) and the trust classification all resolve the AI-Hydro state directory through `aihydroHome()` (`$AIHYDRO_HOME`, otherwise `~/.aihydro`), so what is installed and what is classified as unsigned always agree.
