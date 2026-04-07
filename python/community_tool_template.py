"""
AI-Hydro Community Tool Template
==================================

Copy this file, fill in the TODO sections, and submit a pull request.

Checklist before submitting
----------------------------
[ ] Tool name is unique (check existing tools at https://github.com/galib9690/AI-Hydro)
[ ] run() returns HydroResult (not a dict, DataFrame, or tuple)
[ ] All data values are JSON-serializable (float, int, str, list, dict — no numpy/Shapely)
[ ] validate() passes against at least gauge 01031500 (Mattawamkeag River, ME)
[ ] SOURCES list includes BibTeX citations for all data sources
[ ] pyproject.toml entry point registered (see bottom of this file)

Naming conventions
------------------
- Tool name: snake_case, verb_noun  (e.g. compute_snow_cover, fetch_groundwater_levels)
- Category: one of watershed, hydrology, climate, geomorphic, snow, groundwater, soil,
            vegetation, remote_sensing, water_quality, sociohydrology

Questions?  Open an issue: https://github.com/galib9690/AI-Hydro/issues
"""

from __future__ import annotations

from typing import Any

# ── Import AI-Hydro base types ────────────────────────────────────────────────
from ai_hydro.core import DataSource, HydroMeta, HydroResult, HydroTool, ToolError


# ── Define your data sources ─────────────────────────────────────────────────
# One DataSource per dataset or API you access.  Citation is BibTeX.

_SOURCES: list[DataSource] = [
    DataSource(
        name="TODO: replace with your data source name",   # e.g. 'USGS NWIS'
        url="https://TODO.replace.with.data.url",
        citation=(
            # BibTeX — paste the full entry here
            "@article{TODO2024,\n"
            "  title={TODO: paper title},\n"
            "  author={TODO: Author, First},\n"
            "  journal={TODO: Journal Name},\n"
            "  volume={0}, number={0}, pages={1--10}, year={2024}\n"
            "}"
        ),
    ),
]

_TOOL_PATH = "my_package.my_module.MyTool"   # TODO: update with your package path


# ── The Tool class ────────────────────────────────────────────────────────────

class MyTool(HydroTool):
    """
    TODO: One-sentence description of what this tool computes.

    This description appears as the MCP tool description visible to AI agents.
    Keep it ≤ 120 characters and start with a verb: "Compute ...", "Fetch ...", etc.
    """

    # Required class attributes
    name: str = "my_tool"                  # TODO: snake_case, verb_noun
    description: str = "TODO: one-sentence description starting with a verb"
    category: str = "TODO: see naming conventions above"
    version: str = "0.1.0"
    data_sources: list[DataSource] = _SOURCES

    def run(
        self,
        # TODO: add your parameters here — keep them JSON-serializable
        gauge_id: str,
        watershed_geojson: dict | None = None,
        # add more as needed...
    ) -> HydroResult:
        """
        TODO: describe what this tool does.

        Parameters
        ----------
        gauge_id : str
            8-digit USGS gauge ID, e.g. '01031500'
        watershed_geojson : dict, optional
            GeoJSON polygon dict from delineate_watershed tool

        Returns
        -------
        HydroResult
            data keys: TODO list them
        """
        # ── Import heavy dependencies lazily (keeps core install light) ───────
        try:
            import numpy as np           # TODO: replace with your actual deps
            # import your_library
        except ImportError as e:
            raise ToolError(
                code="DEPENDENCY_ERROR",
                message=f"Required dependency not installed: {e}",
                tool=_TOOL_PATH,
                recovery="pip install your-package-name",
            ) from e

        # ── Validate inputs ───────────────────────────────────────────────────
        if not gauge_id or len(gauge_id) != 8:
            raise ToolError(
                code="INVALID_GAUGE_ID",
                message=f"gauge_id must be an 8-digit USGS gauge ID, got: {gauge_id!r}",
                tool=_TOOL_PATH,
                recovery="Look up gauge IDs at https://waterdata.usgs.gov",
            )

        # ── Main computation ──────────────────────────────────────────────────
        try:
            # TODO: add your computation logic here

            # Example result dict — must be JSON-serializable
            # (Python float/int/str/list/dict — NOT numpy arrays or Shapely geometry)
            result_data: dict[str, Any] = {
                "gauge_id": gauge_id,
                "my_metric": 42.0,          # TODO: replace with real computation
                "my_other_metric": 7.3,
                # "_units" key is convention for unit strings
                "_units": {
                    "my_metric": "mm/year",
                    "my_other_metric": "dimensionless",
                },
            }

        except Exception as exc:
            raise ToolError(
                code="COMPUTATION_FAILED",
                message=str(exc),
                tool=_TOOL_PATH,
                recovery=(
                    "Check gauge_id is valid and watershed_geojson is a "
                    "GeoJSON Polygon in EPSG:4326."
                ),
            ) from exc

        # ── Wrap in HydroResult ───────────────────────────────────────────────
        return HydroResult(
            data=result_data,
            meta=HydroMeta(
                tool=_TOOL_PATH,
                version=self.version,
                gauge_id=gauge_id,
                sources=_SOURCES,
                params={
                    "gauge_id": gauge_id,
                    # TODO: add all parameters you used
                },
            ),
        )

    def validate(self) -> bool:
        """
        Self-check against reference gauge 01031500 (Mattawamkeag River, ME).

        CI calls this on every pull request.  Return True = pass, False = fail.

        Requirements
        ------------
        - Must complete without raising an exception
        - result.data must contain all expected keys
        - Values must be physically plausible (not NaN, not zero when non-zero expected)
        """
        try:
            result = self.run(gauge_id="01031500")

            # Check required keys exist
            assert "my_metric" in result.data, "Missing my_metric in result.data"

            # Check values are physically plausible
            # TODO: add specific value range checks
            val = result.data["my_metric"]
            assert val is not None and val > 0, f"my_metric should be > 0, got {val}"

            return True

        except AssertionError as e:
            print(f"Validation failed: {e}")
            return False
        except Exception as e:
            print(f"Validation error: {e}")
            return False


# ── Optional: standalone function wrapper ─────────────────────────────────────
# Expose as a plain function so users can call it without instantiating the class.

def my_tool(gauge_id: str, **kwargs) -> HydroResult:
    """Convenience wrapper — calls MyTool().run()."""
    return MyTool().run(gauge_id=gauge_id, **kwargs)


# ── Entry point registration ──────────────────────────────────────────────────
# Add the following to YOUR package's pyproject.toml:
#
# [project.entry-points."ai_hydro.tools"]
# my_tool = "my_package.my_module:MyTool"
#
# The AI-Hydro MCP server auto-discovers all registered entry points at startup.
# Your tool will then appear in Claude Code / Cursor with no server changes needed.
