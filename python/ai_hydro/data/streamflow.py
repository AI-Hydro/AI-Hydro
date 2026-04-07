"""
Streamflow Data Retrieval
=========================

Fetch USGS NWIS streamflow data and provide unit conversion utilities.

Public Functions
----------------
fetch_streamflow_data(gauge_id, start_date, end_date) -> HydroResult
    Download USGS streamflow as JSON-serializable time series

Internal helpers
----------------
_fetch_streamflow_internal  — returns raw dict for analysis layer
_to_mm_per_day              — unit conversion (m³/s → mm/day)
"""

from __future__ import annotations

from typing import Dict, Optional
import logging
import warnings

import numpy as np
import pandas as pd

from ai_hydro.core import DataSource, HydroMeta, HydroResult, ToolError

_SOURCES_NWIS = [
    DataSource(
        name="USGS NWIS",
        url="https://waterservices.usgs.gov/nwis/dv/",
        citation=(
            "@misc{NWIS2024,\n"
            "  title={National Water Information System (NWIS)},\n"
            "  author={{USGS Water Resources Mission Area}},\n"
            "  year={2024},\n"
            "  url={https://waterdata.usgs.gov/nwis}\n"
            "}"
        ),
    )
]

_TOOL_PATH_STREAMFLOW = "ai_hydro.data.streamflow.fetch_streamflow_data"

log = logging.getLogger(__name__)
warnings.filterwarnings('ignore')


def _get_version() -> str:
    try:
        from importlib.metadata import version
        return version("ai-hydro")
    except Exception:
        return "unknown"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def fetch_streamflow_data(
    gauge_id: str,
    start_date: str,
    end_date: str,
    interval: str = "daily",
) -> HydroResult:
    """
    Fetch daily or hourly streamflow from USGS NWIS and return data + metadata.

    Parameters
    ----------
    gauge_id : str
        USGS gauge identifier (8-digit code)
    start_date : str
        Start date in YYYY-MM-DD format
    end_date : str
        End date in YYYY-MM-DD format
    interval : str, optional
        Data interval: "daily" or "hourly" (default: "daily")

    Returns
    -------
    HydroResult
        result.data keys: dates, q_cms, units, n_days, gauge_id, gauge_name,
        gauge_lat, gauge_lon, start_date, end_date, interval

    Raises
    ------
    ToolError
        DEPENDENCY_ERROR, NO_DATA, NO_VALID_DATA, NETWORK_ERROR
    """

    # Lazy import of heavy dependencies
    try:
        import hydrofunctions as hf
        from pygeohydro import NWIS as NWISInfo
    except ImportError as e:
        raise ToolError(
            code="DEPENDENCY_ERROR",
            message=str(e),
            tool=_TOOL_PATH_STREAMFLOW,
            recovery="pip install 'ai-hydro[data]'",
        ) from e

    try:
        service = "dv" if interval == "daily" else "iv"
        log.info(f"Fetching USGS streamflow data for {gauge_id} ({service})")

        nwis = hf.NWIS(gauge_id, service, start_date, end_date)
        df = nwis.df()

        if df.empty:
            raise ToolError(
                code="NO_DATA",
                message=f"No streamflow data returned for gauge {gauge_id} ({start_date} to {end_date}).",
                tool=_TOOL_PATH_STREAMFLOW,
                recovery="Check date range and verify gauge is active at waterdata.usgs.gov",
            )

        # First data column is discharge in CFS
        q_cfs = pd.to_numeric(df.iloc[:, 0], errors="coerce")
        q_cms = q_cfs * 0.0283168  # Convert to m³/s
        q_cms.index = pd.to_datetime(q_cms.index).tz_localize(None)
        q_cms = q_cms.dropna()

        if len(q_cms) == 0:
            raise ToolError(
                code="NO_VALID_DATA",
                message=f"No valid streamflow data after QC for gauge {gauge_id}.",
                tool=_TOOL_PATH_STREAMFLOW,
                recovery="Try a different date range or check gauge status.",
            )

        # Fetch site metadata
        info = NWISInfo().get_info([{"site": gauge_id}])
        info["site_no"] = info["site_no"].astype(str)

        if gauge_id not in info["site_no"].values:
            log.warning(f"Gauge {gauge_id} not found in NWIS metadata")
            row_meta = {}
        else:
            row = info.loc[info["site_no"] == str(gauge_id)].iloc[0]
            row_meta = {
                "gauge_name": str(row.get("station_nm", "")),
                "latitude": float(row.get("dec_lat_va", np.nan)),
                "longitude": float(row.get("dec_long_va", np.nan)),
                "huc_02": str(row.get("huc_cd", ""))[:2] if row.get("huc_cd") else "NA",
            }

        meta = {
            "gauge_id": str(gauge_id),
            "service": service,
            "units": "m^3/s",
            "source_units": "ft^3/s",
            "start_date": start_date,
            "end_date": end_date,
            **row_meta
        }

        log.info(f"Retrieved {len(q_cms)} streamflow points from {meta.get('gauge_name', gauge_id)}")

        return HydroResult(
            data={
                "dates": [d.isoformat() for d in q_cms.index.to_pydatetime()],
                "q_cms": [float(v) for v in q_cms.values],
                "units": "m^3/s",
                "n_days": len(q_cms),
                "gauge_id": gauge_id,
                "gauge_name": meta.get("gauge_name", ""),
                "gauge_lat": meta.get("latitude"),
                "gauge_lon": meta.get("longitude"),
                "start_date": start_date,
                "end_date": end_date,
                "interval": interval,
            },
            meta=HydroMeta(
                tool=_TOOL_PATH_STREAMFLOW,
                version=_get_version(),
                gauge_id=gauge_id,
                sources=_SOURCES_NWIS,
                params={"gauge_id": gauge_id, "start_date": start_date,
                        "end_date": end_date, "interval": interval},
            ),
        )
    except ToolError:
        raise
    except Exception as e:
        log.error("fetch_streamflow_data failed: %s", e)
        raise ToolError(
            code="NETWORK_ERROR",
            message=f"Failed to fetch streamflow for gauge {gauge_id}: {e}",
            tool=_TOOL_PATH_STREAMFLOW,
            recovery="Check network connection and verify gauge ID.",
        ) from e


# ---------------------------------------------------------------------------
# Internal helpers (used by analysis.signatures)
# ---------------------------------------------------------------------------

def _fetch_streamflow_internal(
    gauge_id: str,
    start_date: str,
    end_date: str,
    interval: str = "daily",
) -> Optional[Dict]:
    """Internal fetch that returns {q_cms: pd.Series, meta: dict} for computation."""
    try:
        import hydrofunctions as hf
        from pygeohydro import NWIS as NWISInfo

        service = "dv" if interval == "daily" else "iv"
        nwis = hf.NWIS(gauge_id, service, start_date, end_date)
        df = nwis.df()
        if df.empty:
            return None

        q_cfs = pd.to_numeric(df.iloc[:, 0], errors="coerce")
        q_cms = q_cfs * 0.0283168
        q_cms.index = pd.to_datetime(q_cms.index).tz_localize(None)
        q_cms = q_cms.dropna()
        if len(q_cms) == 0:
            return None

        info = NWISInfo().get_info([{"site": gauge_id}])
        info["site_no"] = info["site_no"].astype(str)
        row_meta: dict = {}
        if gauge_id in info["site_no"].values:
            row = info.loc[info["site_no"] == gauge_id].iloc[0]
            row_meta = {
                "gauge_name": str(row.get("station_nm", "")),
                "latitude": float(row.get("dec_lat_va", float("nan"))),
                "longitude": float(row.get("dec_long_va", float("nan"))),
            }
        return {"q_cms": q_cms, "meta": row_meta}
    except Exception as e:
        log.error("Internal streamflow fetch failed: %s", e)
        return None


def _to_mm_per_day(discharge_cms: pd.Series, area_km2: float) -> pd.Series:
    """
    Convert discharge from m³/s to basin-depth mm/day.

    Formula: q_mm_day = q_cms * 86.4 / area_km2
    """
    if discharge_cms is None or len(discharge_cms) == 0 or area_km2 <= 0:
        return pd.Series(dtype=float)

    q_mm_day = discharge_cms * (86.4 / area_km2)
    q_mm_day.index = pd.to_datetime(q_mm_day.index).tz_localize(None)
    return q_mm_day
