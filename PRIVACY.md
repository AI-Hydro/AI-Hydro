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
account (there is no account sign-in; see `src/services/logging/distinctId.ts`).

## What's collected only if you explicitly enable it

**OpenTelemetry (metrics/logs export).** Off by default — requires setting
`OTEL_TELEMETRY_ENABLED=1` in the extension host's environment, which is not
something a typical marketplace install exposes. This exists for
self-hosted/enterprise deployments that want to route telemetry to their own
OTLP collector instead of (or alongside) PostHog. See
`src/shared/services/config/otel-config.ts`.

## Map tile providers

The map panel requests basemap and river tiles directly from these hosts. Each sees an ordinary web request: the tile
coordinates (or byte ranges) asked for, your IP address and the webview's user agent. No workspace content, file
names, layer data or account information is sent. Where you pan reveals roughly where you are looking.

| Host | What it serves | What is asked for |
|---|---|---|
| `server.arcgisonline.com`, `services.arcgisonline.com` (Esri) | Gray Canvas default basemap, imagery, topo, hillshade, ocean | Tile `{z}/{y}/{x}` addresses in view |
| `basemap.nationalmap.gov` (USGS) | USGS Topo, Imagery, Shaded Relief, and the hydrography cache of the optional "Gray + USGS rivers" basemap | Tile addresses in view (United States only) |
| `geoglows-v2.s3.us-west-2.amazonaws.com` (GEOGLOWS, on AWS S3) | Vector rivers of the default basemap (`streams.pmtiles`, CC BY 4.0) | HTTP byte ranges of the archive for the tiles in view; never the whole 2.4 GB file |

Natural Earth rivers and lakes are bundled and make no request.

## What isn't telemetry, despite living near telemetry code

**Account sign-in.** AI-Hydro has no account sign-in. The inherited Firebase
authentication stack (and the credits and dictation features that depended on
it) was removed in the X0-6 clean-up, and the webview no longer allows
connections to the Firebase hosts. Stored sign-in secrets from earlier versions
(`clineAccountId`, `cline:clineAccountId`) are deleted once on first start.

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
"Audit final answers" (`finalAnswerAuditEnabled`). With the
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
