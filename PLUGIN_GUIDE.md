# Community Contribution Guide

AI-Hydro is designed as a platform, not a closed product. This guide explains how to contribute hydrological tools that become immediately available to every AI agent connected to AI-Hydro.

There are two contribution paths depending on your goals:

| | **Path A: Standalone MCP Server** | **Path B: Entry Point Plugin** |
|---|---|---|
| **Best for** | Full sub-domain toolkits, complex dependencies | Single tools or small extensions |
| **Independence** | Runs as its own process | Loaded into the existing `aihydro-mcp` server |
| **Session access** | No (manages own state) | Yes (full HydroSession integration) |
| **Dependency isolation** | Complete (own venv) | Shares `aihydro-tools` environment |
| **Discovery** | User adds to MCP settings manually or via marketplace | Automatic on `pip install` + server restart |
| **Example** | PyHMT2D, custom flood model server | `aihydro-snowmelt`, `aihydro-water-quality` |

---

## Path A: Standalone MCP Server

Create an independent MCP server that AI-Hydro users add alongside the core `ai-hydro` server. This is ideal for large toolkits with their own dependencies, data stores, or execution requirements.

### 1. Create a FastMCP server

```python
# my_hydro_server/server.py
from fastmcp import FastMCP

mcp = FastMCP(
    name="My Hydro Tools",
    version="0.1.0",
    instructions="Hydrological tools for flood frequency analysis.",
)

@mcp.tool()
def compute_flood_frequency(
    gauge_id: str,
    distribution: str = "log_pearson_3",
    return_periods: str = "2,5,10,25,50,100",
) -> dict:
    """Fit a flood frequency distribution to annual peak flows from USGS NWIS.

    Returns flood quantiles for the specified return periods.
    """
    periods = [int(x) for x in return_periods.split(",")]
    # ... your analysis code ...
    return {
        "gauge_id": gauge_id,
        "distribution": distribution,
        "quantiles": {str(p): q for p, q in zip(periods, quantiles)},
        "parameters": {"shape": 0.12, "location": 150.3, "scale": 42.1},
    }

def main():
    mcp.run()
```

### 2. Package for PyPI

```toml
# pyproject.toml
[project]
name = "aihydro-flood-freq"
version = "0.1.0"
dependencies = ["fastmcp>=2.0", "scipy>=1.10"]

[project.scripts]
aihydro-flood-freq = "my_hydro_server.server:main"
```

### 3. Users install and register

```bash
pip install aihydro-flood-freq
```

Then add to `aihydro_mcp_settings.json`:

```json
{
  "mcpServers": {
    "ai-hydro": { "command": "aihydro-mcp", "args": [] },
    "flood-freq": { "command": "aihydro-flood-freq", "args": [] }
  }
}
```

### 4. Submit to the AI-Hydro marketplace (optional)

Create a JSON descriptor at `Marketplace/api/download/<your-package>.json` in the [AI-Hydro/Marketplace](https://github.com/AI-Hydro/Marketplace) repo and open a PR:

```json
{
  "mcpId": "aihydro-flood-freq",
  "githubUrl": "https://github.com/your-org/aihydro-flood-freq",
  "name": "Flood Frequency Analysis",
  "author": "Your Name",
  "description": "Log-Pearson III and GEV flood frequency analysis from USGS peak flows.",
  "readmeContent": "...",
  "llmsInstallationContent": "pip install aihydro-flood-freq",
  "requiresApiKey": false
}
```

---

## Path B: Entry Point Plugin

Extend the existing `aihydro-tools` MCP server by registering tools through Python entry points. Your tool runs inside the same server process, with full access to HydroSession, helpers, and the shared data cache.

### 1. Create a plugin package

```
aihydro-snowmelt/
  pyproject.toml
  aihydro_snowmelt/
    __init__.py
    tools.py
```

### 2. Write your tool function

```python
# aihydro_snowmelt/tools.py
"""Snow melt estimation tools for AI-Hydro."""
from __future__ import annotations

def compute_snow_water_equivalent(
    gauge_id: str,
    method: str = "temperature_index",
    degree_day_factor: float = 4.5,
) -> dict:
    """Estimate snow water equivalent (SWE) using temperature-index method.

    Requires watershed and forcing data to be computed first (via the
    standard AI-Hydro workflow).

    Args:
        gauge_id: USGS gauge ID (e.g. '01031500').
        method: Estimation method. Currently only 'temperature_index'.
        degree_day_factor: Melt factor in mm/degC/day (default 4.5).

    Returns:
        Dictionary with SWE time series, peak SWE, and melt onset date.
    """
    from ai_hydro.session import HydroSession

    # Load the existing session (watershed + forcing must already exist)
    session = HydroSession(gauge_id)
    forcing = session.forcing
    if forcing is None:
        return {"error": "Run fetch_forcing_data first", "gauge_id": gauge_id}

    tmin = forcing["data"]["tmin"]
    prcp = forcing["data"]["prcp"]

    # Simple temperature-index SWE model
    swe = []
    current_swe = 0.0
    for t, p in zip(tmin, prcp):
        if t < 0:
            current_swe += p  # accumulate as snow
        else:
            melt = min(current_swe, degree_day_factor * t)
            current_swe -= melt
        swe.append(round(current_swe, 2))

    peak_swe = max(swe) if swe else 0.0

    result = {
        "gauge_id": gauge_id,
        "method": method,
        "degree_day_factor": degree_day_factor,
        "peak_swe_mm": peak_swe,
        "swe_timeseries": swe,
    }

    # Store in session for downstream tools
    session.set("snowmelt", result)
    session.save()

    return result
```

### 3. Register the entry point

```toml
# pyproject.toml
[project]
name = "aihydro-snowmelt"
version = "0.1.0"
dependencies = ["aihydro-tools"]

[project.entry-points."aihydro.tools"]
compute_snow_water_equivalent = "aihydro_snowmelt.tools:compute_snow_water_equivalent"
```

The entry point group **must** be `"aihydro.tools"` (with a dot, not underscore). This matches the discovery mechanism in `ai_hydro.mcp.registry`.

### 4. Install and test

```bash
pip install -e .
aihydro-mcp --diagnose   # should show your new tool in the list
```

The server discovers all registered entry points at startup via `importlib.metadata`. No changes to the core server are needed.

### How discovery works

On server startup, `ai_hydro.mcp.registry.discover_tools()` iterates over all installed packages that declare `[project.entry-points."aihydro.tools"]` and registers each function as an MCP tool:

```python
# Simplified from ai_hydro/mcp/registry.py
from importlib.metadata import entry_points

def discover_tools():
    eps = entry_points(group="aihydro.tools")
    for ep in eps:
        yield ep.name, ep.load()
```

---

## The Data Contract: HydroResult

Tools that want maximum interoperability with the AI-Hydro ecosystem should return data following the `HydroResult` pattern. This is **recommended but not required** for entry point plugins — any JSON-serializable return value works.

```python
from ai_hydro.core import HydroResult, HydroMeta, DataSource

return HydroResult(
    data={
        "my_metric": 42.0,        # Python float, not numpy.float64
        "my_list": [1.0, 2.0],    # Python list, not numpy.ndarray
        "_units": {"my_metric": "mm/year"},
    },
    meta=HydroMeta(
        tool="aihydro_snowmelt.tools.compute_snow_water_equivalent",
        version="0.1.0",
        gauge_id=gauge_id,
        sources=[DataSource(name="GridMET", url="https://www.climatologylab.org/gridmet.html")],
        params={"gauge_id": gauge_id, "method": method},
    ),
)
```

**Rules:**
- All values in `data` must be JSON-serializable (`float`, `int`, `str`, `list`, `dict`, `None`)
- No NumPy scalars or arrays, no Shapely geometries, no pandas DataFrames
- Geometry should be GeoJSON dicts. Time series should use `{"dates": [...], "values": [...]}`
- On failure, raise `ToolError` with a `code`, `message`, and `recovery` hint

---

## Session Integration

Entry point plugins can read and write to the shared HydroSession:

```python
from ai_hydro.session import HydroSession

session = HydroSession(gauge_id)

# Read existing slots
watershed = session.watershed       # dict or None
streamflow = session.streamflow     # dict or None

# Write a custom slot (any name works)
session.set("my_custom_slot", {"key": "value"})
session.save()
```

Sessions are stored at `~/.aihydro/sessions/<gauge_id>.json`. The 9 built-in slots are: `watershed`, `streamflow`, `signatures`, `geomorphic`, `camels`, `forcing`, `twi`, `cn`, `model`. Plugins can add any additional slot name.

---

## Architecture: Hub-and-Spoke

AI-Hydro follows a **hub-and-spoke** architecture:

- **Hub**: `aihydro-tools` — the core package with 17 tools, HydroSession, MCP server, and plugin discovery
- **Spokes**: Community packages that register tools via entry points or run as standalone MCP servers

Why keep the core monolithic:
1. **HydroSession** coordinates state across data/analysis/modelling tools — splitting would break session coherence
2. Heavy dependencies are already lazy-loaded with `try/except` + `_DEPS_AVAILABLE` flags
3. The extras system (`[data]`, `[analysis]`, `[modelling]`) already handles selective installation
4. Entry points enable distributed development without fragmenting the core

**Future evolution**: If the core grows beyond ~50 tools or dependency conflicts arise, we'll split into `aihydro-core`, `aihydro-data`, `aihydro-analysis`, and `aihydro-modelling`. The entry point system makes this migration transparent to plugins.

---

## Testing Your Plugin

### For entry point plugins

```python
# tests/test_my_tool.py
def test_tool_returns_dict():
    """Tool should return a JSON-serializable dict."""
    result = compute_snow_water_equivalent("01031500")
    assert isinstance(result, dict)
    assert "gauge_id" in result

def test_tool_discovery():
    """Tool should be discoverable via entry points."""
    from importlib.metadata import entry_points
    eps = entry_points(group="aihydro.tools")
    names = [ep.name for ep in eps]
    assert "compute_snow_water_equivalent" in names
```

### For standalone MCP servers

```python
# tests/test_server.py
import asyncio
from my_hydro_server.server import mcp

def test_tools_registered():
    tools = asyncio.run(mcp.list_tools())
    names = [t.name for t in tools]
    assert "compute_flood_frequency" in names
```

---

## High-Priority Contribution Areas

We're actively looking for community tools in these domains:

- **Flood frequency analysis** — LP3, GEV, regional regression
- **Sediment transport** — bed load, suspended load, reservoir sedimentation
- **Groundwater** — well analysis, aquifer testing, recharge estimation
- **Remote sensing** — MODIS snow cover, Landsat ET, SAR soil moisture
- **Water quality** — nutrient loading, dissolved oxygen, temperature
- **Snow hydrology** — SWE estimation, snowmelt timing, glacial melt
- **Irrigation & water resources** — scheduling, allocation, reservoir operations
- **Hydraulic modelling** — HEC-RAS integration, 2D flood mapping

---

## Questions?

- **Issues**: [github.com/AI-Hydro/AI-Hydro/issues](https://github.com/AI-Hydro/AI-Hydro/issues)
- **Discussions**: [github.com/AI-Hydro/AI-Hydro/discussions](https://github.com/AI-Hydro/AI-Hydro/discussions)
- **Email**: mgalib@purdue.edu
