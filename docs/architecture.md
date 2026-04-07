# Architecture

## Overview

AI-Hydro has three layers:

```
┌──────────────────────────────────────────────────────────────────┐
│  Layer 1 — VS Code Extension  (TypeScript / React)               │
│                                                                   │
│   ┌────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│   │ Chat Panel │  │ Map Panel    │  │ Settings / Auth        │  │
│   │ (webview)  │  │ (webview)    │  │                        │  │
│   └────────────┘  └──────────────┘  └────────────────────────┘  │
│         │                                                         │
│   ┌─────▼──────────────────────────────────────────────────────┐ │
│   │  Controller  (task orchestration, MCP client, gRPC server) │ │
│   └─────────────────────────────────┬──────────────────────────┘ │
└─────────────────────────────────────┼────────────────────────────┘
                                      │
              ┌───────────────────────┴───────────────────┐
              │  MCP (stdio)            gRPC (localhost)   │
              ▼                                           ▼
┌────────────────────────────┐     ┌──────────────────────────────┐
│  Layer 2 — Python MCP      │     │  Map Service (TypeScript)    │
│  Server                    │     │  GeoJSON → Leaflet layers    │
│                            │     └──────────────────────────────┘
│  python/mcp_server.py      │
│  17 tools registered       │
│  HydroSession caching      │
└────────────┬───────────────┘
             │
┌────────────▼───────────────┐
│  Layer 3 — ai_hydro pkg    │
│  python/ai_hydro/           │
│                            │
│  data/  analysis/ modelling/│
│  session/  mcp/  rag/      │
└────────────┬───────────────┘
             │
    ┌────────┼─────────────────────────┐
    ▼        ▼                         ▼
  USGS     GridMET               pygeohydro
  NWIS     3DEP DEM              CAMELS data
  NLDI     MODIS                 HyRiver suite
```

---

## Layer 1 — VS Code Extension

Built on [Cline](https://github.com/cline/cline) (fork). Provides:

- **Chat panel** — conversational interface to the AI agent
- **MCP client** — manages the stdio connection to the Python server, forwards tool calls
- **Map panel** — displays GeoJSON layers (watershed boundaries, gauge locations) via Leaflet
- **Task controller** — orchestrates multi-step agent loops
- **Settings UI** — provider/model config, API key management

Key files:

| File | Role |
|------|------|
| `src/extension.ts` | Extension entry point |
| `src/core/task/index.ts` | Agent task loop |
| `src/core/controller/index.ts` | Message routing |
| `src/hosts/vscode/VscodeMapPanelProvider.ts` | Map panel host |
| `webview-ui/src/components/` | React UI components |

---

## Layer 2 — Python MCP Server

The MCP server is built with FastMCP and split into focused modules:

```
python/
├── mcp_server.py                # Thin entry point (~50 lines)
│                                  path setup, Box Drive workaround, mcp.run()
└── ai_hydro/mcp/
    ├── __init__.py              # Imports tool modules → triggers registration
    ├── app.py                   # FastMCP singleton + agent instructions
    ├── helpers.py               # 9 shared helpers (validation, caching, session)
    ├── tools_analysis.py        # 9 analysis @mcp.tool() functions
    ├── tools_session.py         # 6 session management tools
    ├── tools_modelling.py       # 2 AI modelling tools
    ├── tools_docs.py            # tools.md generation + version helpers
    └── registry.py              # Plugin discovery via entry points
```

**Startup sequence:**
1. `mcp_server.py`: `os.chdir(~/.aihydro/cache/)` — avoids Box Drive / read-only cloud folder issues
2. `from ai_hydro.mcp import mcp` — triggers tool module imports, registering all 17 tools via `@mcp.tool()` decorators
3. `mcp.run()` — listens for JSON-RPC calls on stdin/stdout

**Tool execution flow:**
```
AI model → MCP client (extension) → JSON-RPC call → mcp_server.py
    ↓                                                       ↓
  result ← MCP client ← JSON-RPC response ← tool function → ai_hydro pkg
```

**Session wiring:**
Each tool that produces a cacheable result calls `HydroSession.load(gauge_id)`, stores the result in the appropriate slot (`session.watershed = result`), and calls `session.save()`. Subsequent tool calls automatically use the cached value.

---

## Layer 3 — Python Package

Organised into semantic layers so each layer can be installed independently:

```
python/ai_hydro/
├── core/
│   └── types.py                 # HydroResult, HydroMeta, ToolError
├── data/                        # Data retrieval
│   ├── streamflow.py            # fetch_streamflow_data (USGS NWIS)
│   ├── forcing.py               # fetch_forcing_data (GridMET)
│   ├── landcover.py             # fetch_lulc_data (NLCD)
│   └── soil.py                  # fetch_soil_data_polaris (Polaris)
├── analysis/                    # Computation
│   ├── watershed.py             # delineate_watershed (USGS NLDI)
│   ├── signatures.py            # extract_hydrological_signatures (17 CAMELS)
│   ├── geomorphic.py            # extract_geomorphic_parameters (28 metrics)
│   ├── twi.py                   # compute_twi (Topographic Wetness Index)
│   └── curve_number.py          # create_cn_grid (NRCS Curve Number)
├── modelling/                   # AI models
│   ├── metrics.py               # NSE, KGE, RMSE + shared utilities
│   ├── conceptual/hbv.py        # Differentiable HBV-light (PyTorch)
│   └── neural/lstm.py           # NeuralHydrology LSTM
├── session/
│   └── store.py                 # HydroSession — persistent research state
├── rag/
│   └── engine.py                # RAG search (TF-IDF over hydrological knowledge)
└── __init__.py
```

---

## HydroSession

The `HydroSession` class (`python/ai_hydro/session/store.py`) is central to AI-Hydro's efficiency.

```python
class HydroSession:
    gauge_id:    str
    watershed:   dict | None    # result from delineate_watershed
    streamflow:  dict | None    # result from fetch_streamflow_data
    signatures:  dict | None    # result from extract_hydrological_signatures
    geomorphic:  dict | None    # result from extract_geomorphic_parameters
    camels:      dict | None    # result from extract_camels_attributes
    forcing:     dict | None    # result from fetch_forcing_data
    twi:         dict | None    # result from compute_twi
    model:       dict | None    # result from train_hydro_model
    notes:       list[str]      # researcher annotations
```

**Storage**: `~/.aihydro/sessions/<gauge_id>.json` — plain JSON, human-readable.

**Research context sync**: After every `session.save()`, the session automatically writes `.clinerules/research.md`, which is loaded into the AI's context at the start of every conversation. This means the AI always knows what has been computed without any tool calls.

---

## Data Flow: `train_hydro_model` Example

```
User: "Train an HBV model for gauge 01031500"
  │
  ▼
AI agent → calls train_hydro_model("01031500", framework="hbv")
  │
  ▼
mcp_server.py: train_hydro_model()
  ├─ HydroSession.load("01031500")
  │    reads ~/.aihydro/sessions/01031500.json
  │    session.watershed → GeoJSON polygon (769 km²)
  │    session.forcing   → GridMET dict (3653 days)
  │
  ├─ train_hbv_light(gauge_id, session, output_dir, ...)
  │    ├─ fetch_camels_streamflow("01031500", area_km2=769)
  │    │    pygeohydro.get_camels() → xarray Dataset
  │    │    discharge in cfs → convert to mm/day
  │    │
  │    ├─ _load_forcing_arrays(session)
  │    │    reads prcp_mm, tmax_C, tmin_C, pet_mm from session.forcing
  │    │
  │    └─ 3 × (Adam 500 epochs with CosineAnnealingLR)
  │         _hbv_simulate() — pure PyTorch differentiable HBV-light
  │         NSE loss minimised via autograd
  │         best result: NSE=0.638, KGE=0.644
  │
  ├─ session.model = result
  │    session.save() → writes JSON + research.md
  │
  └─ return result dict
        │
        ▼
AI agent formats result for user
```

---

## MCP Protocol

AI-Hydro uses the [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) for the extension ↔ Python server interface.

- **Transport**: stdio (subprocess with stdin/stdout JSON-RPC)
- **Tool discovery**: The extension lists available tools on startup; the AI model sees them as callable functions
- **Invocation**: The AI model emits a `tools/call` JSON-RPC request; the extension forwards it to the Python server; the result returns as structured JSON

No code generation is involved — the AI directly invokes real Python functions and receives real data.

---

## Differentiable HBV-Light

The built-in hydrological model (`train_hbv_light` in `modelling/conceptual/hbv.py`) is a PyTorch implementation of HBV-light (Seibert, 1997).

**Model structure:**

```
P, T  →  Snow routine   (TT, CFMAX, CWH, CFR)
         Soil moisture  (FC, LP, BETA)
         Upper zone     (K0, K1, UZL, PERC)
         Lower zone     (K2)
         Routing        (MAXBAS, CET)
         → Q_sim [mm/day]
```

**12 calibrated parameters** are stored as unconstrained `nn.Parameter` tensors and mapped to physical bounds via sigmoid scaling:

```python
p_physical = p_min + (p_max - p_min) * torch.sigmoid(raw_param)
```

**Training**: Adam optimiser with cosine annealing LR schedule. Multiple random restarts ensure global optimum search. All gradients flow through the full simulation via PyTorch autograd.

**Loss function**: `1 - NSE` (Nash–Sutcliffe Efficiency minimisation).

---

## Provenance (FAIR)

Every tool result includes a `meta` block conforming to FAIR data principles:

```json
{
  "data": { ... },
  "meta": {
    "tool": "delineate_watershed",
    "version": "1.0.0-alpha",
    "computed_at": "2026-03-06T14:23:11Z",
    "params": { "gauge_id": "01031500" },
    "sources": [
      {
        "name": "USGS NLDI",
        "url": "https://labs.waterdata.usgs.gov/api/nldi/",
        "citation": "@misc{usgs_nldi, title={USGS Network Linked Data Index}, ...}"
      }
    ]
  }
}
```

`export_session(format="bibtex")` aggregates all source citations across the session.
