"""
Shared Modelling Utilities
==========================

Metrics (NSE, KGE, RMSE), unit conversion helpers, device selection,
and session data loaders used by both HBV and NeuralHydrology backends.
"""

from __future__ import annotations

import json
import logging
import math
from pathlib import Path
from typing import Any

log = logging.getLogger("ai_hydro.modelling")

# Session forcing variable names → NeuralHydrology generic column names
_FORCING_MAP: dict[str, str] = {
    "prcp_mm":  "prcp(mm/day)",
    "tmax_C":   "tmax(C)",
    "tmin_C":   "tmin(C)",
    "pet_mm":   "pet(mm/day)",
    "srad_Wm2": "srad(W/m2)",
    "wind_ms":  "wind(m/s)",
    # fallbacks for older sessions that used raw GridMET keys
    "pr":   "prcp(mm/day)",
    "tmmx": "tmax(C)",
    "tmmn": "tmin(C)",
    "pet":  "pet(mm/day)",
    "srad": "srad(W/m2)",
    "vs":   "wind(m/s)",
}

# CAMELS attributes most useful as static inputs to LSTM
_USEFUL_STATIC: list[str] = [
    "area_gages2", "elev_mean", "slope_mean",
    "p_mean", "pet_mean", "aridity", "frac_snow",
    "baseflow_index", "runoff_ratio",
    "soil_porosity", "soil_depth_pelletier", "max_water_content",
    "geol_permeability", "carbonate_rocks_frac",
    "frac_forest", "lai_max", "gvf_max",
]


# ──────────────────────────────────────────────────────────────────────
# Unit helpers
# ──────────────────────────────────────────────────────────────────────

def _q_cms_to_mm_day(q_cms: float | None, area_km2: float) -> float | None:
    """Convert discharge m³/s → basin-averaged runoff mm/day."""
    if q_cms is None or area_km2 is None or area_km2 <= 0:
        return None
    return q_cms * 86400.0 / (area_km2 * 1e6) * 1000.0


def _q_cfs_to_mm_day(q_cfs: float, area_km2: float) -> float:
    """Convert discharge ft³/s → basin-averaged runoff mm/day."""
    return q_cfs * 0.0283168 * 86400.0 / (area_km2 * 1e6) * 1000.0


def _hargreaves_pet(tmean: float, tmax: float, tmin: float) -> float:
    """Hargreaves (1985) reference ET estimate in mm/day."""
    tr = max(0.0, tmax - tmin)
    return max(0.0, 0.0023 * (tmean + 17.8) * tr ** 0.5 * 5.0)


# ──────────────────────────────────────────────────────────────────────
# CAMELS streamflow loader
# ──────────────────────────────────────────────────────────────────────

def fetch_camels_streamflow(gauge_id: str, area_km2: float) -> dict[str, float]:
    """
    Fetch CAMELS streamflow for a gauge as a date→mm/day dict.

    Uses pygeohydro.get_camels() which returns a 35-year (1980-2014)
    continuous record for 671 CONUS stations.  Discharge is in cfs;
    this function converts to mm/day.

    Returns empty dict if gauge_id is not in CAMELS.
    """
    try:
        import pygeohydro as gh
        import numpy as np
        _, flow_ds = gh.get_camels()
        station_ids = list(flow_ds.coords["station_id"].values.astype(str))
        if gauge_id not in station_ids:
            log.info("Gauge %s not in CAMELS (671 stations); using session streamflow.", gauge_id)
            return {}
        g = flow_ds.sel(station_id=gauge_id)
        cfs_vals = g["discharge"].values.astype(float)
        time_vals = [str(t)[:10] for t in g["time"].values]
        q_dict: dict[str, float] = {}
        for d, cfs in zip(time_vals, cfs_vals):
            if not np.isnan(cfs):
                q_dict[d] = _q_cfs_to_mm_day(cfs, area_km2)
        log.info("CAMELS streamflow: %d valid days for gauge %s", len(q_dict), gauge_id)
        return q_dict
    except Exception as exc:
        log.warning("CAMELS fetch failed (%s); will use session streamflow.", exc)
        return {}


# ──────────────────────────────────────────────────────────────────────
# Session data loaders
# ──────────────────────────────────────────────────────────────────────

def _load_full_data(session: Any, slot: str, gauge_id: str) -> dict:
    """
    Return the full data dict for a session slot, including daily arrays.

    The MCP server strips large arrays from responses to save context,
    but the session JSON on disk always retains them.  Falls back to the
    workspace JSON file if arrays are missing from the in-memory session.
    """
    result = getattr(session, slot, None)
    if result is None:
        tool = {"streamflow": "fetch_streamflow_data",
                "forcing": "fetch_forcing_data"}.get(slot, slot)
        raise ValueError(f"No {slot} cached for gauge {gauge_id}. Run {tool} first.")

    data = result.get("data", {})
    if "dates" not in data and session.workspace_dir:
        fname = f"{slot}_{gauge_id}.json"
        ws_path = Path(session.workspace_dir) / fname
        if ws_path.exists():
            data = json.loads(ws_path.read_text())
    if "dates" not in data:
        raise ValueError(
            f"{slot} data is missing daily arrays for gauge {gauge_id}. "
            "Re-run the fetch tool with an explicit workspace_dir."
        )
    return data


def _load_forcing_arrays(frc_data: dict) -> tuple[list, list, list, list, list]:
    """
    Extract prcp, tmax, tmin, pet, dates from forcing data dict.
    Handles both new-style keys (prcp_mm, tmax_C, …) and legacy GridMET keys.
    Returns: (dates, prcp, tmax, tmin, pet) — all lists.
    """
    dates = frc_data.get("dates", [])

    def _get(new_key: str, old_key: str) -> list:
        v = frc_data.get(new_key) or frc_data.get(old_key) or []
        return [float(x) if x is not None else float("nan") for x in v]

    prcp = _get("prcp_mm", "pr")
    tmax = _get("tmax_C",  "tmmx")
    tmin = _get("tmin_C",  "tmmn")
    pet  = _get("pet_mm",  "pet")
    return dates, prcp, tmax, tmin, pet


# ──────────────────────────────────────────────────────────────────────
# Evaluation metrics
# ──────────────────────────────────────────────────────────────────────

def _compute_metrics(
    obs: "np.ndarray", pred: "np.ndarray"
) -> tuple[float | None, float | None, float | None]:
    """Return (NSE, KGE, RMSE). None for each if obs has < 10 valid points."""
    import numpy as np
    valid = ~np.isnan(obs) & ~np.isnan(pred)
    if valid.sum() < 10:
        return None, None, None
    o, p = obs[valid], pred[valid]
    ss_res = np.sum((o - p) ** 2)
    ss_tot = np.sum((o - o.mean()) ** 2)
    nse  = float(1.0 - ss_res / (ss_tot + 1e-10))
    r    = float(np.corrcoef(o, p)[0, 1])
    alpha = float(np.std(p) / (np.std(o) + 1e-10))
    beta  = float(np.mean(p) / (np.mean(o) + 1e-10))
    kge  = float(1.0 - ((r - 1) ** 2 + (alpha - 1) ** 2 + (beta - 1) ** 2) ** 0.5)
    rmse = float(np.sqrt(np.mean((o - p) ** 2)))
    return nse, kge, rmse


def _best_device() -> str:
    """Select GPU, Apple Silicon MPS, or CPU."""
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda:0"
        # Note: MPS not used — HBV internal state init issues on MPS
    except Exception:
        pass
    return "cpu"


def _safe_float(lst: list | None, idx: int, default: float | None) -> float | None:
    if lst is None or idx >= len(lst):
        return default
    v = lst[idx]
    if v is None or (isinstance(v, float) and v != v):
        return default
    try:
        return float(v)
    except (TypeError, ValueError):
        return default
