# Architecture

AI-Hydro is built on three layers: the VS Code extension (agent interface), the MCP server (tool execution), and the Python backend (domain computation + session persistence).

---

## System Overview

```
┌─────────────────────────────────────────────────────────┐
│  VS Code Extension (TypeScript)                          │
│  ┌──────────────────────┐  ┌──────────────────────────┐ │
│  │  AI Agent (LLM)      │  │  MCP Client              │ │
│  │  Claude / GPT /      │←→│  JSON-RPC over stdio     │ │
│  │  Gemini / ...        │  │                          │ │
│  └──────────────────────┘  └──────────┬───────────────┘ │
└─────────────────────────────────────────────────────────┘
                                         │ stdio
┌────────────────────────────────────────▼────────────────┐
│  aihydro-mcp (Python / FastMCP)                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐ │
│  │ Analysis │ │Modelling │ │ Session  │ │  Project   │ │
│  │  tools   │ │  tools   │ │  tools   │ │  tools     │ │
│  └──────────┘ └──────────┘ └──────────┘ └────────────┘ │
│  ┌─────────────────────────────────────────────────────┐│
│  │  Plugin discovery (importlib.metadata entry_points) ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
         │              │              │
    Federal APIs    ML backends   ~/.aihydro/
    USGS/GridMET/   (modelling)   sessions/
    3DEP/NLCD                     projects/
```

---

## Layer 1 — VS Code Extension

**Language:** TypeScript  
**Base:** Fork of [Cline](https://github.com/cline/cline) (Apache 2.0)

Responsibilities:
- Renders the chat interface and tool call log
- Manages AI provider connections and API keys
- Acts as an MCP **client** — sends tool call requests, receives results
- Handles file reads/writes and terminal execution for standalone scripts
- Auto-registers the `ai-hydro` MCP server on activation

When the agent decides to call `delineate_watershed`, it sends a JSON-RPC `tools/call` request over stdio to the Python server. The Python server executes the computation and returns a structured result. The agent then interprets the result in natural language.

When no tool exists for a task, the agent writes a standalone Python script and executes it via the integrated terminal — combining the reliability of structured tools with the flexibility of the full Python ecosystem.

---

## Layer 2 — MCP Server

**Language:** Python  
**Framework:** [FastMCP](https://github.com/jlowin/fastmcp)  
**Protocol:** [Model Context Protocol](https://modelcontextprotocol.io/) (JSON-RPC over stdio)

The server is modular:

```
python/ai_hydro/mcp/
├── app.py             — FastMCP singleton + agent instructions
├── __init__.py        — imports all tool modules (triggers registration)
├── tools_analysis.py  — 8 analysis tools
├── tools_session.py   — 6 session tools
├── tools_modelling.py — 2 modelling tools
├── tools_project.py   — 10 project/literature/persona tools
├── tools_docs.py      — tools.md generation + version helpers
├── helpers.py         — shared validation, caching, session utilities
└── registry.py        — entry-point plugin discovery
```

Tool registration happens at import time via `@mcp.tool()` decorators. Plugin discovery scans `aihydro.tools` entry points and registers any community tools found.

---

## Layer 3 — Python Backend

**Package:** `aihydro-tools` (PyPI)

### Data retrieval

| Module | Library | Source |
|--------|---------|--------|
| `data/streamflow.py` | hydrofunctions | USGS NWIS |
| `data/forcing.py` | pygridmet | GridMET |
| `data/landcover.py` | pygeohydro | NLCD |
| `data/soil.py` | requests | POLARIS |

### Analysis

| Module | Library | What |
|--------|---------|------|
| `analysis/watershed.py` | pynhd | NHDPlus delineation |
| `analysis/signatures.py` | numpy/pandas | Flow statistics |
| `analysis/twi.py` | py3dep + xrspatial | Terrain analysis |
| `analysis/geomorphic.py` | geopandas + py3dep | Basin morphometry |
| `analysis/curve_number.py` | pygeohydro | CN grid |

### Modelling

| Module | Framework | Model |
|--------|-----------|-------|
| `modelling/conceptual/hbv.py` | PyTorch | Differentiable HBV-light |
| `modelling/neural/lstm.py` | NeuralHydrology | LSTM |

### Session persistence

| Class | File | Storage |
|-------|------|---------|
| `HydroSession` | `session/store.py` | `~/.aihydro/sessions/<gauge>.json` |
| `ProjectSession` | `session/project.py` | `~/.aihydro/projects/<name>/project.json` |
| `ResearcherProfile` | `session/persona.py` | `~/.aihydro/researcher.json` |

---

## MCP Communication

```
Agent                    aihydro-mcp
  │                           │
  │──tools/list──────────────>│  list all registered tools
  │<─────────────[tool list]──│
  │                           │
  │──tools/call──────────────>│  {"name": "delineate_watershed",
  │  {"gauge_id": "01031500"} │   "arguments": {"gauge_id": "01031500"}}
  │                           │
  │                     [USGS NLDI API call]
  │                     [NHDPlus processing]
  │                     [HydroSession.save()]
  │                           │
  │<─────────────[result]─────│  {"area_km2": 1247.3, ...}
```

---

## Dependency Management

Heavy dependencies are lazy-loaded with `try/except` blocks and `_DEPS_AVAILABLE` flags:

```python
try:
    import geopandas as gpd
    import pynhd
    _GEO_AVAILABLE = True
except ImportError:
    _GEO_AVAILABLE = False

def delineate_watershed(gauge_id: str) -> dict:
    if not _GEO_AVAILABLE:
        return {"error": "Install aihydro-tools[analysis] for watershed tools."}
    # ... proceed ...
```

Tools return informative errors for missing extras rather than crashing the server.

---

## Memory Hierarchy

```
ResearcherProfile  (~/.aihydro/researcher.json)
    — who you are: expertise, preferences, active project

ProjectSession  (~/.aihydro/projects/<name>/project.json)
    — what you're working on: gauges, journal, literature

HydroSession  (~/.aihydro/sessions/<gauge>.json)
    — what was computed: all tool results with provenance metadata
```

Each tier is injected into the agent context via `.clinerules/research.md`, written by `sync_research_context` and `write_research_context()`.
