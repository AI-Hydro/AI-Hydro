---
description: Build an AI-Hydro entry-point plugin in Python. Complete aihydro-snowmelt example with pyproject.toml, tool function, session integration, and PyPI publishing.
---

# Path B: Entry-Point Plugin

Register a new tool into the `aihydro-mcp` server process via Python entry points. The simplest path — no separate server, no additional process, full HydroSession access.

---

## Complete Example: `aihydro-snowmelt`

We'll build a plugin that adds a `compute_snow_signatures` tool.

### 1. Create the package

```
aihydro-snowmelt/
├── pyproject.toml
└── aihydro_snowmelt/
    ├── __init__.py
    └── tools.py
```

### 2. Write the tool function

```python title="aihydro_snowmelt/tools.py"
from ai_hydro.core.types import HydroResult, HydroMeta
from ai_hydro.session import HydroSession
from datetime import datetime, timezone


def compute_snow_signatures(gauge_id: str) -> dict:
    """
    Compute snow-related hydrological signatures from cached streamflow data.

    Requires fetch_streamflow_data to have been called first.

    Args:
        gauge_id: USGS gauge ID (e.g., "12345678")

    Returns:
        Snow signatures: center of mass, snowmelt fraction, spring pulse timing.
    """
    session = HydroSession.load(gauge_id)
    if not session.streamflow:
        return {"error": f"No streamflow data for gauge {gauge_id}. Call fetch_streamflow_data first."}

    dates = session.streamflow["dates"]
    q = session.streamflow["discharge_cms"]

    # --- your computation here ---
    results = _compute_snow_metrics(dates, q)

    result = HydroResult(
        data=results,
        meta=HydroMeta(
            tool="compute_snow_signatures",
            version="0.1.0",
            source="Derived from USGS NWIS streamflow",
            retrieved_at=datetime.now(timezone.utc).isoformat(),
            parameters={"gauge_id": gauge_id},
        ),
    )

    session.set_slot("snow_signatures", result.data, result.meta.__dict__)
    session.save()

    return result.data


def _compute_snow_metrics(dates, q):
    # implement your domain logic here
    return {
        "center_of_mass_doy": 105,
        "snowmelt_fraction": 0.42,
        "spring_pulse_doy": 88,
    }
```

### 3. Register the entry point

```toml title="pyproject.toml"
[build-system]
requires = ["setuptools>=61.0"]
build-backend = "setuptools.build_meta"

[project]
name = "aihydro-snowmelt"
version = "0.1.0"
dependencies = ["aihydro-tools>=1.2.0"]

[project.entry-points."aihydro.tools"]
compute_snow_signatures = "aihydro_snowmelt.tools:compute_snow_signatures"
```

### 4. Install and test

```bash
# Install in development mode
pip install -e .

# Restart the MCP server
pkill -f aihydro-mcp
aihydro-mcp

# Verify your tool is discovered
aihydro-mcp --diagnose
# Should list compute_snow_signatures
```

### 5. Use it

```
Compute snow signatures for gauge 01031500.
```

The agent calls `compute_snow_signatures("01031500")` — your function runs, results are cached in the session, and the agent interprets them.

---

## Rules for Entry-Point Tools

1. **Function signature** — single `gauge_id: str` parameter (or more, as needed). Return `dict`.
2. **Load and save the session** — use `HydroSession.load(gauge_id)` and `session.save()`.
3. **Return a `HydroResult`-like dict** with `data` and `meta` keys for provenance.
4. **Docstring** — the agent reads it to understand what the tool does. Write it clearly.
5. **Graceful errors** — return `{"error": "..."}` instead of raising exceptions.

---

## Publishing

```bash
# Build
python -m build

# Upload to PyPI
twine upload dist/*
```

After publishing, users install with:

```bash
pip install aihydro-snowmelt
```

And the tool is immediately available on next server restart.

---

## Listing on the AI-Hydro Plugin Registry

Open an issue on [AI-Hydro/AI-Hydro](https://github.com/AI-Hydro/AI-Hydro/issues) with the tag `plugin` and your package name. We'll add it to the community plugin list.
