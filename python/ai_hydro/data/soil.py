"""
Soil Data Retrieval for AI-Hydro

Fetches soil properties from the Polaris database for hydrological analysis.
"""
from __future__ import annotations

from typing import Optional, List

try:
    import xarray as xr
    import geopandas as gpd
    _DEPS_AVAILABLE = True
except ImportError:
    _DEPS_AVAILABLE = False


def fetch_soil_data_polaris(
    geometry: gpd.GeoSeries,
    layers: Optional[List[str]] = None
) -> xr.Dataset:
    """
    Fetch soil properties data from Polaris database for CN grid calculation.

    Parameters
    ----------
    geometry : gpd.GeoSeries or gpd.GeoDataFrame
        Geometry to retrieve soil data for (WGS84, EPSG:4326)
    layers : list of str, optional
        Soil layers to retrieve. If None, retrieves layers needed for CN:
        - sand, silt, clay fractions (for texture classification)
        - ksat (saturated hydraulic conductivity)
        Default retrieves top layer (0-5 cm) data

    Returns
    -------
    xr.Dataset
        Dataset containing soil property rasters

    Examples
    --------
    >>> from ai_hydro.analysis.watershed import delineate_watershed
    >>> ws = delineate_watershed('03245500')
    >>> soil = fetch_soil_data_polaris(ws['gdf'])
    >>> print(list(soil.data_vars))

    Notes
    -----
    Polaris provides soil properties at multiple depths:
    - 0-5 cm (layer name suffix: '_5' or '_0_5cm')
    - 5-15 cm, 15-30 cm, 30-60 cm, 60-100 cm, 100-200 cm

    For CN calculation, we use the top layer (0-5 cm) which most influences
    surface runoff characteristics.
    """
    if not _DEPS_AVAILABLE:
        raise ImportError("soil data requires: pip install aihydro-tools[data]")
    import pygeohydro as gh

    # Default to top layer soil properties needed for hydrologic group classification
    if layers is None:
        layers = ['sand_5', 'silt_5', 'clay_5', 'ksat_5']

    print(f"  Retrieving soil data from Polaris...")
    print(f"    Requested layers: {layers}")

    # Get soil data from Polaris
    soil_dataset = gh.soil_polaris(
        layers=layers,
        geometry=geometry.geometry.iloc[0],
        geo_crs=4326
    )

    return soil_dataset
