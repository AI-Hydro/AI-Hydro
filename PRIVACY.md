# Privacy & Telemetry

Written as part of the 2026-07-09 extension audit (`audits/extension-audit-2026-07-09.md`,
finding E-6) — the codebase had no written privacy documentation despite
carrying real data-collection code paths and a product pitch built on
provenance and defensibility. This corrects that gap by stating, plainly,
what is actually collected today, based on reading the code, not on what
the packaging implies.

## What's collected by default

**Anonymous usage/error telemetry (PostHog).** Enabled by default, controlled
by the **"Allow error and usage reporting"** checkbox under Settings → Privacy
& Telemetry (also honors VS Code's own global telemetry level — if you've
disabled telemetry at the IDE level, this extension respects that too).
Turning the checkbox off stops all outbound PostHog events immediately
(`TelemetryService.updateTelemetryState`).

What it captures: task lifecycle events (created/completed/mode-switched),
tool-usage counts, model selection, token usage, and error events. Error
messages are truncated to 500 characters before being sent
(`MAX_ERROR_MESSAGE_LENGTH` in `src/services/telemetry/TelemetryService.ts`)
— this bounds but does not eliminate the chance that a truncated error string
contains a fragment of a file path or other workspace-specific text if the
underlying error happened to include one. **Prompt content, file contents,
and API keys are not part of this event catalog** — see
`src/services/telemetry/TelemetryService.ts` for the exhaustive list of
capture methods; nothing there reads file bodies or model responses.

The distinct ID used to correlate events is either your host machine ID
(`node-machine-id`) or a locally-generated UUID, not tied to any personal
account unless you sign in (see `src/services/logging/distinctId.ts`).

## What's collected only if you explicitly enable it

**OpenTelemetry (metrics/logs export).** Off by default — requires setting
`OTEL_TELEMETRY_ENABLED=1` in the extension host's environment, which is not
something a typical marketplace install exposes. This exists for
self-hosted/enterprise deployments that want to route telemetry to their own
OTLP collector instead of (or alongside) PostHog. See
`src/shared/services/config/otel-config.ts`.

## What isn't telemetry, despite living near telemetry code

**Firebase.** Used exclusively as an authentication provider for account
sign-in (`src/services/auth/providers/FirebaseAuthProvider.ts`) — it does not
collect usage telemetry. An earlier draft of this audit's findings grouped it
with the telemetry surface by proximity in `package.json`; that was
inaccurate and is corrected here.

**Recognition worker** (marketplace star/usage counters). This **is** telemetry
and is treated as such. When you install, star, open or cite a marketplace item,
the extension POSTs the event (marketplace, item id, event type, extension
version) to the recognition host
(`https://aihydro-recognition.aihydro-mgalib.workers.dev/v1`, currently under a
personal Cloudflare account; moving it to an organisation-owned domain is
planned). Each request carries `clientIdHash`, a stable client-derived hash
(`sha256("aihydro-recognition:" + your anonymous telemetry id)`). It is
pseudonymous, not anonymous: the same install always sends the same hash.
Nothing is sent to this host, including count look-ups and star toggles, unless
**both** VS Code's telemetry setting (`telemetry.telemetryLevel`, reported to
extensions as `vscode.env.isTelemetryEnabled`) **and** AI-Hydro's own telemetry
setting allow it. If either is off, or the host cannot report it, or it cannot be read, no request is made and
marketplace counts and stars show as unavailable. See
`recognition-worker/README.md` for the server side. Retiring this call entirely
is under consideration.

**Final-answer audit.** When you complete a task and an AI-Hydro MCP server is
connected, the final answer text (plus the chat id, workspace path and the
provider-reported model id, as for any AI-Hydro MCP call) is sent to that
server's `audit_interpretation` tool to check numbers and claims against the
evidence ledger. For the default local stdio server this stays on your machine;
if you registered a *remote* AI-Hydro server, the answer text is sent to it
(egress). Not telemetry; on by default; turn it off in Settings > Features >
"Audit final answers" (`finalAnswerAuditEnabled`). With the experimental
"Check answers before showing them" setting (`finalAnswerAuditGate`, default on, active only
when the answer audit is on and a trusted first-party AI-Hydro server with the graded audit is connected)
the same audit runs before the answer is shown, and each revision the gate asks
for sends one more request to your model provider; a held-back draft and its
findings are stored in the task's local `ui_messages.json` like any transcript
row. Draft text is never sent to telemetry.

## What was removed as part of this audit

`@sentry/browser` was declared in `package.json` but had zero imports
anywhere in `src/` or `webview-ui/` — dead code, not a live error-reporting
path. Removed rather than documented, since documenting unused code as if it
were active would be its own inaccuracy.

## What this document does not decide

Whether PostHog telemetry should default to **off** instead of **on** (i.e.
opt-in rather than opt-out) is a product decision with real trade-offs — it
would reduce the usage visibility the maintainer relies on for prioritization,
and changes the experience for every existing user, not just new installs.
This audit surfaces the current default (opt-out, `telemetrySetting`
defaults to enabled unless explicitly set to `"disabled"` — see
`src/core/controller/ui/initializeWebview.ts`) as a fact worth knowing, not
as something to silently flip. If the product wants an opt-in-by-default
posture to match its provenance-first positioning more closely, that's a
deliberate call for the maintainer to make.
