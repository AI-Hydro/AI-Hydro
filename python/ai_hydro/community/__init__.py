"""
AI-Hydro Community Tools
=========================

Base classes and utilities for community-contributed tools.

Community tools extend HydroTool and are registered via Python entry points
in the ``ai_hydro.tools`` namespace.  The MCP server auto-discovers them at
startup — no changes to the server code required.

Quick start for contributors
-----------------------------
1. Copy ``community_tool_template.py`` from the project root.
2. Subclass ``HydroTool``, implement ``run()`` and ``validate()``.
3. Register your package's entry point in ``pyproject.toml``::

    [project.entry-points."ai_hydro.tools"]
    my_tool = "my_package.my_module:MyTool"

4. Open a pull request — CI will call ``validate()`` automatically.
"""
from ai_hydro.core import HydroResult, HydroMeta, DataSource, HydroTool, ToolError

__all__ = ["HydroResult", "HydroMeta", "DataSource", "HydroTool", "ToolError"]
