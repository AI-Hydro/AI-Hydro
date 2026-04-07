"""
AI-Hydro MCP Server Infrastructure.

Importing this package triggers tool registration via ``@mcp.tool()``
decorators in the tool modules.
"""
from ai_hydro.mcp.app import mcp  # noqa: F401 — the FastMCP singleton

# Import tool modules so their @mcp.tool() decorators execute and
# register all 17 tools on the shared ``mcp`` instance.
from ai_hydro.mcp import tools_analysis   # noqa: F401
from ai_hydro.mcp import tools_session    # noqa: F401
from ai_hydro.mcp import tools_modelling  # noqa: F401

# Discover and register community plugin tools via entry points.
# Third-party packages register tools in their pyproject.toml:
#   [project.entry-points."aihydro.tools"]
#   my_tool = "my_package.module:my_tool_function"
from ai_hydro.mcp.registry import discover_tools as _discover_tools

for _name, _fn in _discover_tools():
    mcp.tool(name=_name)(_fn)
