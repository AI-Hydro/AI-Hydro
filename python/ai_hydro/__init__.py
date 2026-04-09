"""
AI-Hydro Python Package
========================

Validated, FAIR-compliant hydrological tools for agentic research platforms.

All tools return HydroResult — a standardized, JSON-serializable envelope with
FAIR provenance metadata. Designed to be called directly by AI agents via the
AI-Hydro MCP server, eliminating code generation for standard hydrology tasks.

Quick Start
-----------
>>> from ai_hydro.tools.watershed import delineate_watershed
>>> result = delineate_watershed('01031500')
>>> result.data['area_km2']
>>> result.meta.cite()  # BibTeX

MCP Server
----------
Run the MCP server to expose all tools to any MCP-compatible agent:
    python python/mcp_server.py

Or add to Claude Code:
    {"mcpServers": {"ai-hydro": {"command": "python", "args": ["python/mcp_server.py"]}}}

Tools
-----
- delineate_watershed       Watershed boundary + gauge metadata
- fetch_streamflow_data     USGS daily discharge time series
- extract_hydrological_signatures  17 CAMELS-style flow signatures
- extract_geomorphic_parameters    28 basin morphometry metrics
- compute_twi               Topographic Wetness Index
- fetch_forcing_data        Basin-averaged GridMET forcing
- extract_camels_attributes 60+ CAMELS attributes (via camels-attrs)
- query_hydro_concepts      Search hydrological knowledge base

Architecture
------------
See AI_HYDRO_PLATFORM_ROADMAP.md for full architecture and community model.
"""

try:
    from importlib.metadata import version as _v
    __version__ = _v("aihydro-tools")
except Exception:
    __version__ = "unknown"
__author__ = "Mohammad Galib"
__email__ = "mgalib@purdue.edu"

# Core types — always available (no heavy deps)
from ai_hydro.core import DataSource, HydroMeta, HydroResult, HydroTool, ToolError

__all__ = [
    # Types
    "HydroResult",
    "HydroMeta",
    "DataSource",
    "HydroTool",
    "ToolError",
    # Version
    "__version__",
]
