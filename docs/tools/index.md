# Tool Reference

All tools are exposed via the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) and can be called by any compatible AI agent. The agent decides which tools to call — you describe what you want to understand, and the agent orchestrates the right sequence.

---

## Tool Categories

| Category | Tools | Description |
|----------|-------|-------------|
| [Analysis Tools](analysis.md) | 10 tools | Data retrieval, watershed, signatures, terrain, modelling |
| [Modelling Tools](modelling.md) | 2 tools | HBV-light, LSTM calibration and results |
| [Project & Literature](project.md) | 10 tools | Projects, literature indexing, researcher persona |
| [Session Tools](session.md) | 6 tools | Session management, export, provenance |

---

## Data Contract

All tools return a `HydroResult` object:

```python
@dataclass
class HydroResult:
    data: dict          # tool-specific results
    meta: HydroMeta     # provenance metadata

@dataclass
class HydroMeta:
    tool: str           # tool name
    version: str        # aihydro-tools version
    source: str         # data source (e.g., "USGS NWIS")
    retrieved_at: str   # ISO 8601 timestamp
    parameters: dict    # input parameters used
```

This contract is what makes provenance automatic — every result carries the information needed to reproduce the computation.

---

## Community Tools

Tools registered via the `aihydro.tools` entry-point system appear in this reference automatically after the server restarts. See [Plugin Overview](../plugins/overview.md) for how to contribute tools.
