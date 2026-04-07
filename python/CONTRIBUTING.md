# Contributing to AI-Hydro

AI-Hydro is a community-maintained ecosystem of validated, FAIR-compliant
hydrological tools for AI agents.  Every tool contributed here becomes
immediately available to researchers via Claude Code, Cursor, and any other
MCP-compatible AI assistant.

---

## Ways to contribute

| Contribution type | What to do |
|---|---|
| New tool | Follow the **New Tool** guide below |
| Bug fix / improvement | Open an issue or PR against an existing tool |
| New knowledge entry | Add to `knowledge/` YAML files |
| Documentation | Edit any `.md` file |
| Test data / reference gauges | Add to `tests/test_reference_gauges.py` |

---

## New Tool guide

### 1. Set up

```bash
git clone https://github.com/galib9690/AI-Hydro
cd AI-Hydro/python
pip install -e ".[dev]"
```

### 2. Copy the template

```bash
cp community_tool_template.py ai_hydro/tools/my_tool.py
```

### 3. Fill in the template

Open `my_tool.py` and complete every `TODO` section:

- **`name`** — snake_case verb_noun, e.g. `compute_snow_cover`
- **`description`** — ≤120 char, starts with a verb, becomes the MCP tool description
- **`category`** — one of: `watershed`, `hydrology`, `climate`, `geomorphic`,
  `snow`, `groundwater`, `soil`, `vegetation`, `remote_sensing`,
  `water_quality`, `sociohydrology`
- **`_SOURCES`** — at least one `DataSource` with a BibTeX `citation`
- **`run()`** — returns a `HydroResult`, all data JSON-serializable
- **`validate()`** — passes for gauge `01031500`

### 4. The data contract (mandatory)

Every tool **must** return a `HydroResult`:

```python
from ai_hydro.core import HydroResult, HydroMeta, DataSource, ToolError

return HydroResult(
    data={
        "my_metric": 42.0,        # Python float, not numpy.float64
        "my_list": [1.0, 2.0],   # Python list, not numpy.ndarray
        "_units": {"my_metric": "mm/year"},  # convention for units
    },
    meta=HydroMeta(
        tool="my_package.my_module.MyTool",
        version="0.1.0",
        gauge_id=gauge_id,
        sources=[DataSource(name="USGS NWIS", url="...", citation="@article{...}")],
        params={"gauge_id": gauge_id},
    ),
)
```

**Rules:**
- All values in `data` must be JSON-serializable (`float`, `int`, `str`, `list`, `dict`, `None`)
- NO `numpy` scalars or arrays, NO Shapely geometry objects, NO pandas DataFrames
- Geometry → GeoJSON dict.  Time series → `{"dates": [...], "values": [...]}`
- On failure, raise `ToolError` with a `code`, `message`, and `recovery` hint

### 5. Write tests

Add a test class to `tests/test_reference_gauges.py`:

```python
class TestMyTool:
    def test_my_tool_contract(self):
        with patch("ai_hydro.tools.my_tool._my_underlying_function",
                   return_value={"my_metric": 42.0}):
            from ai_hydro.tools.my_tool import my_tool
            result = my_tool(gauge_id="01031500")
            _assert_hydro_result(result, expected_data_keys=["my_metric"])
            assert result.data["my_metric"] > 0
```

Run locally:
```bash
pytest tests/test_reference_gauges.py -v -m "not live"
```

### 6. Register the entry point

In `pyproject.toml` (core repo tools) or your own package's `pyproject.toml`:

```toml
[project.entry-points."ai_hydro.tools"]
my_tool = "ai_hydro.tools.my_tool:MyTool"
```

The MCP server discovers all registered entry points at startup — no changes
to the server required.

### 7. Open a pull request

CI automatically runs:
1. `pytest tests/test_reference_gauges.py -m "not live"` (fast, mocked)
2. `MyTool().validate()` on gauge `01031500`
3. `ruff check` linting

---

## Code style

- Python ≥ 3.9
- `ruff` for linting: `ruff check .`
- Type hints on all public functions
- Lazy imports for heavy deps (geopandas, xarray, etc.) inside function bodies

---

## FAIR compliance checklist

| FAIR principle | Requirement |
|---|---|
| **Findable** | Tool registered in `ai_hydro.tools` entry points |
| **Accessible** | `pip install ai-hydro` (core) or `pip install your-package` |
| **Interoperable** | Returns `HydroResult` — outputs chain to other tools |
| **Reusable** | `HydroMeta.cite()` → BibTeX; `to_methods_text()` → manuscript paragraph |

---

## Adding to the knowledge base

Add a YAML entry to `knowledge/` for the `query_hydro_concepts` MCP tool:

```yaml
# knowledge/my_topic.yml
- concept: "My Hydrological Concept"
  category: "hydrology"
  definition: "Plain-language definition."
  formula: "optional LaTeX formula"
  references:
    - "Author, Year. Title. Journal."
  related_tools:
    - "my_tool"
```

---

## Questions?

Open an issue: https://github.com/galib9690/AI-Hydro/issues
