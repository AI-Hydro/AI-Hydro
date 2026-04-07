"""
Land Cover Data Retrieval for AI-Hydro

Fetches NLCD (National Land Cover Database) data for watershed analysis.
"""

import xarray as xr
import geopandas as gpd
from typing import Optional


def fetch_lulc_data(
    geometry: gpd.GeoSeries,
    resolution: int = 30,
    year: int = 2019
) -> xr.Dataset:
    """
    Fetch Land Use/Land Cover (LULC) data from NLCD for a given geometry.

    Parameters
    ----------
    geometry : gpd.GeoSeries or gpd.GeoDataFrame
        Geometry to retrieve LULC data for (WGS84, EPSG:4326)
    resolution : int, optional
        Spatial resolution in meters (default: 30m, NLCD native resolution)
    year : int, optional
        Year of NLCD data (default: 2019)
        Available years: 2001, 2004, 2006, 2008, 2011, 2013, 2016, 2019, 2021

    Returns
    -------
    xr.Dataset
        Dataset containing land cover classification raster with variable 'cover_{year}'

    Examples
    --------
    >>> from ai_hydro.analysis.watershed import delineate_watershed
    >>> ws = delineate_watershed('03245500')
    >>> lulc = fetch_lulc_data(ws['gdf'], year=2019, resolution=30)
    >>> print(lulc['cover_2019'].shape)

    Notes
    -----
    NLCD classes include:
    - 11: Open Water
    - 21-24: Developed areas (varying intensity)
    - 31: Barren Land
    - 41-43: Forest (Deciduous, Evergreen, Mixed)
    - 52: Shrub/Scrub
    - 71: Grassland/Herbaceous
    - 81: Pasture/Hay
    - 82: Cultivated Crops
    - 90: Woody Wetlands
    - 95: Emergent Herbaceous Wetlands
    """
    import pygeohydro as gh

    print(f"  Retrieving NLCD land cover (year={year}, resolution={resolution}m)...")

    # Get NLCD data using pygeohydro
    nlcd_dict = gh.nlcd_bygeom(
        geometry,
        resolution=resolution,
        years={'cover': [year]},
        region='L48',
        crs=4326
    )

    # Extract the dataset (pygeohydro returns a dict with gauge ID or feature index as key)
    # Get the first value from the dictionary
    lulc_dataset = next(iter(nlcd_dict.values()))

    return lulc_dataset
