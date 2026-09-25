# Map ROI ordering — 2026-09-09

## Goal

Make the webview ROI lifecycle deterministic when mutations, session-stream
updates, refreshes, reconnects, failures, and teardown overlap. The host session
stream is authoritative: a successful empty mutation response must not be
presented as proof that the requested ROI became canonical.

## Scope

- Serialize ROI mutations issued by one mounted Map provider in invocation order.
- Never update visible ROI from the mutation caller's request.
- Fence refresh responses against later mutations, stream events, reconnects,
  failures, and teardown.
- Preserve the ordered layer/session startup behavior and existing visible state
  on connection failure.

The client queue does not order mutations from other clients or host-side
workspace/session activity. Host serialization and workspace-scoped persistence
remain required for global ordering.

## Acceptance and verification

- Overlapping set/clear calls reach the host in caller order, including after a
  rejected mutation.
- Late mutation completions cannot overwrite a newer stream ROI.
- Rejected mutations do not fabricate a successful selection.
- Old refresh and stream callbacks cannot update a reconnected or unmounted
  provider.
- Existing stream-startup tests remain green.
- Run `npx vitest run src/context/__tests__/MapContext.test.tsx` and
  `npx tsc --noEmit` from `webview-ui`.

## Outcome

Implemented the provider-local mutation queue, stream-only visible ROI updates,
and separate ROI response-generation and connection-lifecycle fences. Queued
mutations are rejected before dispatch if reconnect, connection failure, or
unmount changed the lifecycle; an RPC already sent to the host cannot be
cancelled by this client guard. Twelve MapContext tests pass, including the
previous five ordered-startup/lifecycle cases and seven mutation/refresh teardown
cases; webview TypeScript passes. Host-wide mutation ordering and workspace
isolation remain outside this client slice.
