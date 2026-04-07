"""
Watershed Delineation Tool
===========================

Automated watershed boundary extraction for USGS gauge sites.

Returns a standardized HydroResult with GeoJSON geometry and full
FAIR provenance metadata.

Functions
---------
delineate_watershed(gauge_id, save_geojson, output_dir) -> HydroResult

Examples
--------
>>> from ai_hydro.tools.watershed import delineate_watershed
>>> result = delineate_watershed('01031500')
>>> print(result.data['area_km2'])      # float
>>> print(result.data['gauge_name'])    # str
>>> print(result.meta.cite())           # BibTeX
"""

from __future__ import annotations

import json
import logging
import warnings
from typing import Optional

warnings.filterwarnings("ignore")
log = logging.getLogger(__name__)

__all__ = ["delineate_watershed", "validate_gauge_id"]

# ---------------------------------------------------------------------------
# Data source declarations (used for FAIR provenance)
# ---------------------------------------------------------------------------
from ai_hydro.core import DataSource, HydroMeta, HydroResult, ToolError

_SOURCES = [
    DataSource(
        name="USGS NLDI",
        url="https://labs.waterdata.usgs.gov/api/nldi/",
        citation=(
            "@misc{NLDI2024,\n"
            "  title={Network-Linked Data Index (NLDI)},\n"
            "  author={{USGS Water Resources}},\n"
            "  year={2024},\n"
            "  url={https://labs.waterdata.usgs.gov/api/nldi/}\n"
            "}"
        ),
    ),
    DataSource(
        name="USGS NWIS",
        url="https://waterservices.usgs.gov/",
        citation=(
            "@misc{NWIS2024,\n"
            "  title={National Water Information System (NWIS)},\n"
            "  author={{USGS Water Resources Mission Area}},\n"
            "  year={2024},\n"
            "  url={https://waterdata.usgs.gov/nwis}\n"
            "}"
        ),
    ),
]

_TOOL_PATH = "ai_hydro.tools.watershed.delineate_watershed"

try:
    from pynhd import NLDI
    from pygeohydro import NWIS
    import geopandas as gpd
    _DEPS_OK = True
except ImportError:
    _DEPS_OK = False


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def delineate_watershed(
    gauge_id: str,
    save_geojson: bool = False,
    output_dir: Optional[str] = None,
) -> HydroResult:
    """
    Delineate watershed boundary for a USGS gauge using NLDI.

    Parameters
    ----------
    gauge_id : str
        8-digit USGS gauge identifier (e.g., '01031500')
    save_geojson : bool, optional
        Save watershed boundary as GeoJSON file (default: False)
    output_dir : str, optional
        Directory to save GeoJSON if save_geojson=True

    Returns
    -------
    HydroResult
        result.data keys:
        - geometry_geojson : dict  — GeoJSON polygon (WGS84 / EPSG:4326)
        - area_km2         : float — Watershed drainage area in km²
        - gauge_id         : str   — USGS gauge identifier
        - gauge_name       : str   — Official USGS station name
        - gauge_lat        : float — Gauge latitude (°N)
        - gauge_lon        : float — Gauge longitude (°E)
        - huc_02           : str   — 2-digit hydrologic unit code

    Raises
    ------
    ToolError
        GAUGE_NOT_FOUND   — gauge_id not in NLDI or NWIS
        INVALID_GAUGE_ID  — bad format
        NETWORK_ERROR     — API unreachable
        DEPENDENCY_ERROR  — pynhd/pygeohydro not installed

    Examples
    --------
    >>> result = delineate_watershed('01031500')
    >>> result.data['area_km2']
    847.3
    >>> geojson = result.data['geometry_geojson']  # pass to other tools
    >>> result.meta.cite()  # BibTeX for NLDI + NWIS
    """
    _check_deps()

    if not validate_gauge_id(gauge_id):
        raise ToolError(
            code="INVALID_GAUGE_ID",
            message=f"Invalid gauge_id: '{gauge_id}'. Must be 8+ digit string (e.g., '01031500').",
            tool=_TOOL_PATH,
            recovery="Check gauge ID at https://waterdata.usgs.gov/nwis",
        )

    log.info("Delineating watershed for gauge %s", gauge_id)

    try:
        # ── Step 1: Watershed boundary from NLDI ─────────────────────────
        nldi = NLDI()
        watershed_gdf = nldi.get_basins(gauge_id)

        if watershed_gdf.crs is None or watershed_gdf.crs.to_epsg() != 4326:
            watershed_gdf = watershed_gdf.to_crs("EPSG:4326")

        watershed_geom = watershed_gdf.geometry.iloc[0]
        area_km2 = float(
            watershed_gdf.to_crs("EPSG:5070").geometry.area.iloc[0] / 1e6
        )
        log.info("Watershed area: %.1f km²", area_km2)

        # ── Step 2: Gauge metadata from NWIS ─────────────────────────────
        nwis = NWIS()
        site_info = nwis.get_info([{"site": gauge_id}])
        site_info["site_no"] = site_info["site_no"].astype(str)

        if gauge_id not in site_info["site_no"].values:
            raise ToolError(
                code="GAUGE_NOT_FOUND",
                message=f"Gauge {gauge_id} not found in NWIS.",
                tool=_TOOL_PATH,
                recovery="Verify gauge ID at https://waterdata.usgs.gov/nwis",
            )

        row = site_info.loc[site_info["site_no"] == gauge_id].iloc[0]
        gauge_lat = float(row["dec_lat_va"])
        gauge_lon = float(row["dec_long_va"])
        gauge_name = str(row["station_nm"])
        huc_full = str(row.get("huc_cd", ""))
        huc_02 = huc_full[:2] if len(huc_full) >= 2 else "NA"

        # ── Step 3: Geometry → GeoJSON dict (JSON-serializable) ──────────
        geometry_geojson = json.loads(watershed_gdf.to_json())["features"][0]["geometry"]

        # ── Step 4: Optional file export ──────────────────────────────────
        if save_geojson and output_dir:
            import os
            os.makedirs(output_dir, exist_ok=True)
            out_path = os.path.join(output_dir, f"watershed_{gauge_id}.geojson")
            with open(out_path, "w") as f:
                json.dump(geometry_geojson, f)
            log.info("Saved GeoJSON: %s", out_path)

        return HydroResult(
            data={
                "geometry_geojson": geometry_geojson,
                "area_km2": area_km2,
                "gauge_id": gauge_id,
                "gauge_name": gauge_name,
                "gauge_lat": gauge_lat,
                "gauge_lon": gauge_lon,
                "huc_02": huc_02,
            },
            meta=HydroMeta(
                tool=_TOOL_PATH,
                version=_get_version(),
                gauge_id=gauge_id,
                sources=_SOURCES,
                params={
                    "gauge_id": gauge_id,
                    "save_geojson": save_geojson,
                    "output_dir": output_dir,
                },
            ),
        )

    except ToolError:
        raise
    except Exception as e:
        raise ToolError(
            code="NETWORK_ERROR" if "connection" in str(e).lower() else "COMPUTATION_ERROR",
            message=f"Failed to delineate watershed for gauge {gauge_id}: {e}",
            tool=_TOOL_PATH,
            recovery="Check network connection and verify gauge ID exists in USGS system.",
        ) from e


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def validate_gauge_id(gauge_id: str) -> bool:
    """Return True if gauge_id is valid 8+ digit format."""
    return isinstance(gauge_id, str) and len(gauge_id) >= 8 and gauge_id.isdigit()


def _check_deps() -> None:
    if not _DEPS_OK:
        raise ToolError(
            code="DEPENDENCY_ERROR",
            message="Required dependencies not installed.",
            tool=_TOOL_PATH,
            recovery="pip install 'ai-hydro[watershed]'",
        )


def _get_version() -> str:
    try:
        from importlib.metadata import version
        return version("ai-hydro")
    except Exception:
        return "unknown"
