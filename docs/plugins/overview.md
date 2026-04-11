---
description: Extend AI-Hydro with community hydrology tools. Two plugin paths: Python entry-point plugins and standalone MCP servers. Flood frequency, sediment transport, groundwater, and more.
---

# Plugin Overview

AI-Hydro is a platform, not a closed product. The most impactful contributions are new domain tools — knowledge that currently lives in papers and custom scripts, packaged so any AI agent can discover and use it.

---

## Two Plugin Paths

| | Path A: Standalone MCP Server | Path B: Entry-Point Plugin |
|--|-------------------------------|---------------------------|
| **Best for** | Full sub-domain toolkits, complex dependencies | Single tools, small extensions |
| **Runs as** | Separate process | Loaded into `aihydro-mcp` process |
| **Dependency isolation** | Complete | Shares `aihydro-tools` environment |
| **HydroSession access** | Via MCP tool calls | Direct Python access |
| **Distribution** | Any MCP-compatible client | `pip install` auto-discovers |
| **Examples** | HEC-RAS interface, SWMM wrapper | Flood frequency tool, snow signature |

---

## High-Priority Contribution Areas

The following domains have the highest demand from the community and no current built-in tools:

- **Flood frequency analysis** — L-moments, GEV fitting, return period estimation
- **Sediment transport** — rating curves, suspended load, reservoir sedimentation
- **Groundwater** — well analysis, aquifer characterisation, recharge estimation
- **Remote sensing** — MODIS snow cover, Landsat ET, SAR soil moisture
- **Water quality** — nutrient loading, temperature modelling, DO
- **Snow hydrology** — SWE retrieval, melt modelling, snowpack depletion curves
- **Irrigation & water resources** — consumptive use, irrigation scheduling, reservoir operations
- **Hydraulic modelling** — 1D/2D flood mapping, HEC-RAS integration

---

## Getting Started

→ [Path B: Entry-Point Plugin](entry-point.md) — fastest to implement, recommended for single tools
→ [Path A: Standalone MCP Server](standalone-server.md) — for full toolkits with heavy dependencies
→ [Data Contract](data-contract.md) — `HydroResult` / `HydroMeta` spec all tools must follow

---

## Plugin Discovery

Entry-point plugins are discovered automatically when the `aihydro-mcp` server starts:

```python
# ai_hydro/mcp/registry.py
from importlib.metadata import entry_points

def discover_tools():
    for ep in entry_points(group="aihydro.tools"):
        tool_fn = ep.load()
        mcp.tool()(tool_fn)  # registers with FastMCP
```

Install a community package → restart the server → the tool appears automatically. No changes to the core required.
