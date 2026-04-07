# Contributing to AI-Hydro

Thank you for your interest in contributing! AI-Hydro is an open-source hydrological research platform and we welcome contributions from the hydrology, earth sciences, and software engineering communities.

## Ways to Contribute

- **Bug reports** — if a tool returns wrong data or the extension crashes
- **New tools** — wrap a new data source or analysis method as an MCP tool
- **Improved models** — better rainfall–runoff models, regionalization schemes
- **Documentation** — tutorials, worked examples, explanations
- **Tests** — unit and integration tests for the Python package

## Before You Start

For anything beyond a small bug fix or typo:

1. Check [existing issues](https://github.com/galib9690/AI-Hydro/issues) and [discussions](https://github.com/galib9690/AI-Hydro/discussions) to avoid duplication.
2. Open an issue or discussion describing what you plan to build and why.
3. Wait for a maintainer response before investing significant time.

**Small fixes** (typos, obvious bugs, minor wording, simple type corrections) may be submitted directly without prior discussion.

---

## Development Setup

### 1. Clone and install

```bash
git clone https://github.com/galib9690/AI-Hydro.git
cd AI-Hydro

# Extension (TypeScript / React)
npm run install:all

# Python package (editable)
cd python
pip install -e ".[dev]"
cd ..
```

### 2. Run the extension in development mode

Press **F5** in VS Code (or **Run → Start Debugging**). This opens a new Extension Development Host window with AI-Hydro loaded from source.

### 3. Run Python tests

```bash
cd python
pytest tests/ -v
```

### 4. Run TypeScript lint + format

```bash
npm run lint
npm run format
```

---

## Adding a New Tool

Each MCP tool requires two things: a Python implementation and an MCP registration.

### Step 1 — Implement the tool

Create or edit a file in `python/ai_hydro/tools/`:

```python
# python/ai_hydro/tools/my_tool.py

from ai_hydro.core.types import HydroResult, HydroMeta
from datetime import datetime, timezone

def my_new_analysis(gauge_id: str, param: float = 1.0) -> dict:
    """
    One-sentence description.

    Parameters
    ----------
    gauge_id : str
        8-digit USGS NWIS site ID.
    param : float
        Description of parameter.

    Returns
    -------
    dict
        Keys: result_value, meta
    """
    # ... implementation ...
    result = {"result_value": 42.0}
    meta = HydroMeta(
        tool="my_new_analysis",
        version="1.0.0-alpha",
        computed_at=datetime.now(timezone.utc).isoformat(),
        params={"gauge_id": gauge_id, "param": param},
        sources=[],  # add data source citations here
    )
    return HydroResult(data=result, meta=meta).to_dict()
```

### Step 2 — Register as an MCP tool

Add to `python/mcp_server.py`:

```python
@mcp.tool()
def my_new_analysis(gauge_id: str, param: float = 1.0) -> dict:
    """One-sentence description shown to the AI model."""
    try:
        gauge_id = _validate_gauge_id(gauge_id)
        from ai_hydro.tools.my_tool import my_new_analysis as _impl
        result = _impl(gauge_id, param=param)
        return result
    except Exception as e:
        return _tool_error_to_dict(e)
```

### Step 3 — (Optional) Cache in HydroSession

If the result is expensive and should be reused:

1. Add a slot to `_RESULT_SLOTS` in `python/ai_hydro/session.py`
2. Add `self.my_slot: dict | None = None` to `HydroSession.__init__`
3. Add a key finding to `_key_findings()` if useful
4. In the MCP tool, load/save the session:

```python
session = HydroSession.load(gauge_id)
session.my_slot = result
session.save()
```

### Step 4 — Write a test

```python
# python/tests/test_my_tool.py
def test_my_new_analysis():
    result = my_new_analysis("01031500")
    assert result["result_value"] > 0
    assert "meta" in result
```

### Step 5 — Document

Add an entry to [docs/tools-reference.md](./docs/tools-reference.md) with:
- Parameters table
- Return value description
- Example

---

## Pull Request Guidelines

1. **One feature / fix per PR** — keep PRs focused and reviewable.
2. **Link the issue** — include `Closes #123` in the PR description.
3. **Tests pass** — `pytest tests/` and `npm test` must both pass.
4. **Docs updated** — if you add a tool, update `docs/tools-reference.md`.
5. **No secrets** — never commit API keys, credentials, or `.env` files.

Use the PR template when submitting.

---

## Code Style

**Python**
- Black-formatted (`black python/`)
- Type-annotated public functions
- Docstrings in NumPy style

**TypeScript**
- Biome-formatted (`npm run format`)
- No `any` types without a comment explaining why

---

## Reporting Security Issues

Please **do not** file public issues for security vulnerabilities.
Email mgalib@purdue.edu or use [GitHub Security Advisories](https://github.com/galib9690/AI-Hydro/security/advisories/new).

---

## Code of Conduct

All contributors are expected to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).

---

## License

By contributing to AI-Hydro, you agree that your contributions will be licensed under the [Apache 2.0 License](./LICENSE).
