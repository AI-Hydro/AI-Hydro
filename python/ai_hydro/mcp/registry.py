"""
MCP Tool Entry Point Discovery
================================

Auto-discover tools registered via Python entry points.

Community plugins register tools in their own ``pyproject.toml``::

    [project.entry-points."aihydro.tools"]
    my_tool = "my_package.module:my_tool_function"

Then ``discover_tools()`` finds them at runtime so the MCP server
can register them without any code change in ai-hydro core.
"""

from __future__ import annotations

import logging
from typing import Any, Callable

log = logging.getLogger("ai_hydro.mcp")


def discover_tools() -> list[tuple[str, Callable[..., Any]]]:
    """
    Auto-discover tools registered via the ``aihydro.tools`` entry point group.

    Returns
    -------
    list of (name, callable) tuples
        Each entry is a (tool_name, tool_function) pair that the MCP server
        can register as an additional tool.
    """
    try:
        from importlib.metadata import entry_points
    except ImportError:
        # Python < 3.9 fallback
        from importlib_metadata import entry_points  # type: ignore[no-redef]

    discovered: list[tuple[str, Callable[..., Any]]] = []
    eps = entry_points(group="aihydro.tools")
    for ep in eps:
        try:
            tool_fn = ep.load()
            discovered.append((ep.name, tool_fn))
            log.info("Discovered plugin tool: %s (%s)", ep.name, ep.value)
        except Exception as exc:
            log.warning("Failed to load plugin tool %s: %s", ep.name, exc)

    return discovered
