"""
Fetch Hydrological Data Workflow
=================================

Downloads streamflow, watershed boundaries, and climate data using
the ai_hydro.tools layer.
"""

from typing import Dict, Any, Optional, Union
from datetime import datetime
import pandas as pd

# NOTE: Imports are lazy (inside functions) to avoid heavy dependency chains
# This allows RAG to load without requiring all tool dependencies


def fetch_hydrological_data(
    gauge_id: str,
    start_date: str,
    end_date: str,
    data_types: Optional[list] = None
) -> Dict[str, Any]:
    """
    Fetch hydrological data for a USGS gauge.
    
    This is a Tier 3 workflow that orchestrates multiple Tier 2 tools
    to fetch various types of hydrological data.
    
    Args:
        gauge_id: USGS gauge identifier (8 digits)
        start_date: Start date (YYYY-MM-DD)
        end_date: End date (YYYY-MM-DD)
        data_types: Types of data to fetch (default: all available)
        
    Returns:
        Dictionary containing:
        - streamflow: pandas Series of daily streamflow (m³/s)
        - watershed: Dict with boundary geometry and metadata
        - gauge_id: Original gauge ID
        - status: Success/error status
        - errors: Any errors encountered
    """
    if data_types is None:
        data_types = ["streamflow", "watershed_boundary"]
    
    result = {
        "gauge_id": gauge_id,
        "status": "success",
        "data": {},
        "errors": []
    }
    
    # Fetch streamflow data
    if "streamflow" in data_types:
        try:
            # Lazy import to avoid heavy dependency chain
            from ai_hydro.tools.hydrology import fetch_streamflow_data
            streamflow = fetch_streamflow_data(gauge_id, start_date, end_date)
            if streamflow is not None:
                result["data"]["streamflow"] = streamflow
                result["data"]["streamflow_stats"] = {
                    "mean_cms": float(streamflow.mean()),
                    "min_cms": float(streamflow.min()),
                    "max_cms": float(streamflow.max()),
                    "count": len(streamflow)
                }
            else:
                result["errors"].append("No streamflow data available for date range")
        except Exception as e:
            result["errors"].append(f"Streamflow fetch failed: {str(e)}")
    
    # Fetch watershed boundary
    if "watershed_boundary" in data_types:
        try:
            # Lazy import to avoid heavy dependency chain
            from ai_hydro.tools.watershed import delineate_watershed
            watershed = delineate_watershed(gauge_id)
            if watershed:
                result["data"]["watershed"] = {
                    "area_km2": watershed.get("area_km2"),
                    "gauge_name": watershed.get("gauge_name"),
                    "geometry": "GeoDataFrame" if "geometry" in watershed else None
                }
            else:
                result["errors"].append("Watershed delineation failed")
        except Exception as e:
            result["errors"].append(f"Watershed fetch failed: {str(e)}")
    
    # Set overall status
    if result["errors"]:
        result["status"] = "partial" if result["data"] else "failed"
    
    return result


# Alias for backward compatibility
def fetch_usgs_streamflow(gauge_id: str, start_date: str, end_date: str) -> Union[pd.Series, None]:
    """
    Simplified function that returns just the streamflow data.
    This is an alias for the Tier 2 function.
    
    Args:
        gauge_id: USGS gauge identifier
        start_date: Start date (YYYY-MM-DD)
        end_date: End date (YYYY-MM-DD)
        
    Returns:
        pandas Series of daily streamflow (m³/s) or None if failed
    """
    # Lazy import to avoid heavy dependency chain
    from ai_hydro.tools.hydrology import fetch_streamflow_data
    return fetch_streamflow_data(gauge_id, start_date, end_date)
