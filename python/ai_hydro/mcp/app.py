"""
FastMCP application instance for AI-Hydro.

All tool modules import ``mcp`` from here so every ``@mcp.tool()``
decorator registers on the same singleton.
"""
from __future__ import annotations

from fastmcp import FastMCP, Context

__all__ = ["mcp", "Context"]

mcp = FastMCP(
    name="AI-Hydro",
    version="1.0.0",
    instructions=(
        "You are connected to the AI-Hydro MCP server with hydrological tools.\n\n"
        "Tool selection rule:\n"
        "- If an MCP tool exists for the task \u2192 call it here. Never use Python instead.\n"
        "- If NO MCP tool exists \u2192 Python scripting with execute_command is the correct fallback.\n\n"
        "NEVER call pip install. All dependencies are pre-installed.\n\n"
        "Standard workflow \u2014 every tool takes only gauge_id, no geometry passing needed:\n"
        "1. delineate_watershed(gauge_id, workspace_dir) \u2014 FIRST call, pass workspace path once.\n"
        "   Geometry is stored in session automatically. Response has no coordinate arrays.\n"
        "2. fetch_streamflow_data(gauge_id, start_date, end_date)\n"
        "3. extract_hydrological_signatures(gauge_id)\n"
        "4. extract_camels_attributes(gauge_id)\n"
        "5. extract_geomorphic_parameters(gauge_id)\n"
        "6. compute_twi(gauge_id)\n"
        "7. fetch_forcing_data(gauge_id, start_date, end_date)\n\n"
        "Files are saved automatically to workspace_dir \u2014 NEVER call write_file for data.\n"
        "Geometry is loaded from session by downstream tools \u2014 NEVER pass coordinate arrays.\n"
        "Results are cached in HydroSession \u2014 skip already-computed steps.\n"
        "start_session is optional \u2014 only call it to check what is already computed.\n"
        "clear_session(gauge_id) \u2014 resets slots to force re-computation with new parameters.\n\n"
        "AI modelling workflow (after steps 1 + 7 above):\n"
        "8. train_hydro_model(gauge_id) \u2014 differentiable HBV-light (default, recommended)\n"
        "   or train_hydro_model(gauge_id, framework='neuralhydrology') \u2014 LSTM\n"
        "   Returns NSE, KGE, RMSE. NSE > 0.75 = excellent.\n"
        "9. get_model_results(gauge_id) \u2014 retrieve cached model performance."
    ),
)
