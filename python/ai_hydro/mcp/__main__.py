"""Allow running the MCP server via ``python -m ai_hydro.mcp``.

This is the universal fallback when the ``aihydro-mcp`` console script
is not on PATH (common with user-level pip installs on Windows).
"""
from __future__ import annotations

import sys


def _version() -> str:
    try:
        from importlib.metadata import version
        return version("aihydro-tools")
    except Exception:
        return "unknown"


def _diagnose() -> None:
    """Run a quick diagnostic check and print results."""
    import importlib

    print(f"aihydro-tools {_version()}")
    print()

    # Check core imports
    core_modules = [
        ("ai_hydro.core", "Core types"),
        ("ai_hydro.mcp.app", "FastMCP app"),
        ("ai_hydro.mcp.helpers", "MCP helpers"),
        ("ai_hydro.mcp.tools_analysis", "Analysis tools"),
        ("ai_hydro.mcp.tools_session", "Session tools"),
        ("ai_hydro.mcp.tools_modelling", "Modelling tools"),
        ("ai_hydro.mcp.tools_docs", "Doc tools"),
        ("ai_hydro.session.store", "Session store"),
    ]

    optional_modules = [
        ("ai_hydro.data.streamflow", "Streamflow data", "pip install aihydro-tools[data]"),
        ("ai_hydro.data.forcing", "Forcing data", "pip install aihydro-tools[data]"),
        ("ai_hydro.data.landcover", "Land cover data", "pip install aihydro-tools[data]"),
        ("ai_hydro.data.soil", "Soil data", "pip install aihydro-tools[data]"),
        ("ai_hydro.analysis.watershed", "Watershed delineation", "pip install aihydro-tools[analysis]"),
        ("ai_hydro.analysis.signatures", "Hydrological signatures", "pip install aihydro-tools[analysis]"),
        ("ai_hydro.analysis.geomorphic", "Geomorphic parameters", "pip install aihydro-tools[analysis]"),
        ("ai_hydro.analysis.twi", "TWI computation", "pip install aihydro-tools[analysis]"),
        ("ai_hydro.analysis.curve_number", "Curve number grid", "pip install aihydro-tools[analysis]"),
    ]

    print("Core modules:")
    all_ok = True
    for mod, label in core_modules:
        try:
            importlib.import_module(mod)
            print(f"  OK  {label} ({mod})")
        except Exception as e:
            print(f"  ERR {label} ({mod}): {e}")
            all_ok = False

    print()
    print("Optional modules:")
    for mod, label, install_hint in optional_modules:
        try:
            importlib.import_module(mod)
            print(f"  OK  {label} ({mod})")
        except Exception as e:
            print(f"  --  {label}: not available ({install_hint})")

    # Count registered tools
    print()
    try:
        from ai_hydro.mcp import mcp as _mcp
        import asyncio
        try:
            tools = asyncio.run(_mcp.list_tools())
            print(f"Registered tools: {len(tools)}")
            for t in sorted(tools, key=lambda x: x.name):
                print(f"  - {t.name}")
        except Exception:
            print("Registered tools: (could not enumerate)")
    except Exception as e:
        print(f"Tool registration failed: {e}")

    print()
    if all_ok:
        print("Status: READY")
    else:
        print("Status: CORE MODULES MISSING — server may not start")

    # Show executable location
    import shutil
    exe = shutil.which("aihydro-mcp")
    if exe:
        print(f"Executable: {exe} (on PATH)")
    else:
        print("Executable: aihydro-mcp NOT on PATH")
        print(f"Fallback:   python -m ai_hydro.mcp")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        arg = sys.argv[1]
        if arg in ("--version", "-V"):
            print(f"aihydro-tools {_version()}")
            sys.exit(0)
        elif arg in ("--diagnose", "--check"):
            _diagnose()
            sys.exit(0)
        elif arg in ("--help", "-h"):
            print("Usage: python -m ai_hydro.mcp [OPTIONS]")
            print()
            print("Options:")
            print("  (no args)    Start the MCP server on stdio")
            print("  --version    Show package version")
            print("  --diagnose   Run diagnostic checks (modules, tools, PATH)")
            print("  --help       Show this help")
            sys.exit(0)

    from ai_hydro.mcp import main
    main()
