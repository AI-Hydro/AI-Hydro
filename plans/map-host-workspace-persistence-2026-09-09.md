# Map host workspace and persistence ordering — 2026-09-09

## Problem

`MapSessionService.setWorkspaceRoot` changes `workspaceRoot` while retaining the prior active ROI. The persisted record can therefore relabel an ROI from workspace A as owned by workspace B, defeating the tools-side ownership check. Session persistence is fire-and-forget and overlapping writes are not ordered. `setActiveRoi` RPCs also perform asynchronous workspace refresh before mutation, allowing concurrent calls to reach the service out of invocation order.

## Scope

- A real workspace-root change invalidates workspace-bound ROI and layer visibility state before publishing or persisting the new ownership context. Preserve global display preferences only where their meaning is workspace-independent.
- Serialize host ROI RPC operations with their workspace refresh, across callers.
- Serialize persistence using immutable snapshots so disk state cannot regress behind the last accepted mutation.
- Ensure shutdown/tests can await pending persistence where required; do not report durable success from an unobserved failed write.
- Preserve the existing global bridge file because Python consumes it, but make its workspace ownership truthful.

## Acceptance

- Switching A → B cannot expose A's ROI as B-owned in memory, stream snapshots, or the final persisted file.
- Concurrent set/clear RPCs execute in invocation order even when workspace refresh completion timing differs.
- Delayed earlier persistence cannot overwrite a later snapshot.
- Same-root refresh does not clear state.
- Persistence errors are observable to a durability-aware caller while event/UI mutation behavior remains explicit.
- Focused host tests and host TypeScript pass; no writes to the user's real `~/.aihydro` in tests.

## Limits

This slice establishes host state ownership and ordering. It does not prove geometry adequacy, live extension restart behavior, or atomic coordination with Python readers during the final file rename; those require the real persisted-study walkthrough.
