---
description: Evidence Board, Experiment Table, and Session Replay panels for auditing AI-Hydro analyses from persisted session state.
---

# Reproducibility Panels

AI-Hydro exposes three side-by-side audit panels in the VS Code extension. They are designed for scientific review, not just UI convenience: every panel reads persisted session state or the live ledger so claims, experiments, and tool runs can be inspected after the chat has moved on.

Open them from the Command Palette or the sidebar toolbar:

| Panel | Command | Primary source |
|---|---|---|
| Evidence Board | `AI-Hydro: Evidence Board` | Ledger gRPC service + claim updates |
| Experiment Table | `AI-Hydro: Experiment Table` | `~/.aihydro/sessions/<session_id>.json` or capsule `session.json` |
| Session Replay | `AI-Hydro: Session Replay` | `~/.aihydro/sessions/<session_id>.json` or capsule `session.json` |

Use the bundled demo fixture for a populated end-to-end smoke test:

```bash
mkdir -p ~/.aihydro/sessions
cp examples/reproducibility-panels/demo-reproducibility-cockpit.json \
  ~/.aihydro/sessions/demo-reproducibility-cockpit.json
```

Then load:

| Panel | Session | Experiment |
|---|---|---|
| Evidence Board | `demo-reproducibility-cockpit` | — |
| Experiment Table | `demo-reproducibility-cockpit` | `panel_smoke_exp` |
| Session Replay | `demo-reproducibility-cockpit` | — |

The demo contains 3 claims, 1 experiment, and 4 replay runs. It is intentionally illustrative for UI/UX validation; it is not publication evidence.

## Evidence Board

The Evidence Board is a kanban-style claim ledger grouped by claim status:

```text
proposed → tested → weakly_supported → supported → stale → contradicted → retracted
```

It displays:

- claim statement, type, confidence, and status;
- evidence spans bound to runs, papers, datasets, or metrics;
- limitations/caveats recorded with the claim;
- live claim updates from the extension ledger subscription.

Use the session input in the toolbar to load a specific session. A blank input loads the most recent session reported by the ledger service. Ledger load/subscription failures are shown inline; they should not be mistaken for an empty claims board.

Common producers:

```python
add_claim(...)
draft_claim_from_run(...)
update_claim_status(...)
list_claims(...)
```

## Experiment Table

The Experiment Table loads an experiment from a persisted HydroSession and renders a metric table across features/basins.

It expects a session slot shaped like:

```json
{
  "_experiments": {
    "data": {
      "experiment_id": {
        "defn": {
          "name": "...",
          "tool": "...",
          "features": ["01031500", "01109000"],
          "metrics": ["kge", "nse"]
        },
        "results": {
          "status": "complete",
          "run_ids": { "01031500": "run.01031500" },
          "cells": {
            "01031500": { "kge": { "value": 0.73 } }
          },
          "errors": {}
        }
      }
    }
  }
}
```

The panel supports:

- recent-session suggestions from `~/.aihydro/sessions/`;
- direct session id, explicit JSON path, or capsule directory path;
- sorted metric columns;
- compact value + CI cells that hide empty uncertainty columns;
- pass/warn/fail badges for common skill metrics such as KGE/NSE;
- cross-feature aggregate statistics;
- click-to-highlight for matching map layers (`metadata.feature_id`, layer name, or layer id);
- run chips that open Session Replay focused on the backing run.

If an experiment id is wrong, the host response lists available experiment ids.

## Session Replay

Session Replay turns `_run_log` into a chronological audit timeline. It supports both wrapped map slots and arrays:

```json
{
  "_run_log": {
    "data": {
      "run1": {
        "tool_name": "delineate_watershed",
        "timestamp": "2026-06-25T00:01:00Z",
        "key_outputs": {
          "area_km2": 113.27,
          "_quality_flags": [
            { "validator": "area_range", "status": "pass" }
          ]
        }
      }
    }
  }
}
```

The panel supports:

- recent-session suggestions;
- direct session id, JSON path, or capsule directory path;
- chronological sorting by timestamp/run id;
- filtering by tool name, run id, or basin id;
- review chips for `All`, `Needs review`, and `Failed`;
- keyboard navigation (`↑`, `↓`, `Esc`);
- focused-run opening from Experiment Table run chips and Evidence Board run spans;
- quality-flag and diff-status badges.

## Shared file-contract reader

The extension host uses `src/integrations/aihydro-session/sessionSurfaces.ts` to resolve and parse these surfaces. Unit tests lock the cross-language contract in:

```bash
TS_NODE_PROJECT=./tsconfig.unit-test.json npx mocha --no-config \
  --require ts-node/register \
  --require tsconfig-paths/register \
  --require source-map-support/register \
  "src/integrations/aihydro-session/__tests__/sessionSurfaces.test.ts"
```

This is the regression gate for future changes to `_experiments`, `_run_log`, capsule exports, and recent-session discovery.
