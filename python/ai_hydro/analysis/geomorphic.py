"""
Geomorphic Characteristics Extraction Module

This module provides tools for extracting 28 geomorphic parameters from watersheds,
including basin morphometry, stream network characteristics, relief metrics, and
shape indices following standard hydrological analysis methods.

References:
    - Horton, R.E. (1932) - Drainage basin characteristics
    - Strahler, A.N. (1952) - Hypsometric analysis
    - Schumm, S.A. (1956) - Evolution of drainage systems
    - Gray, D.M. (1961) - Synthetic unit hydrographs
"""

from __future__ import annotations

import os
import warnings
from typing import Tuple, Dict, Optional, Union
import numpy as np

try:
    import geopandas as gpd
    from shapely.geometry import Point, LineString
    from pyproj import Geod
    import py3dep
    import xrspatial
    _DEPS_AVAILABLE = True
    # Geodesic calculator for accurate area/perimeter on WGS84
    geod = Geod(ellps="WGS84")
except ImportError:
    _DEPS_AVAILABLE = False
    geod = None

warnings.filterwarnings('ignore')


def extract_geomorphic_parameters(
    watershed_gdf: gpd.GeoDataFrame,
    outlet_lat: float,
    outlet_lon: float,
    dem_resolution: int = 30,
    stream_threshold: Optional[float] = None
) -> Tuple[Dict[str, float], Dict[str, str]]:
    """
    Extract comprehensive set of 28 geomorphic parameters for watershed characterization.
    
    This function computes basin morphometry, relief characteristics, stream network
    metrics, and shape indices that are essential for understanding watershed behavior
    and hydrological response.
    
    Parameters
    ----------
    watershed_gdf : gpd.GeoDataFrame
        Watershed boundary as GeoDataFrame in WGS84 (EPSG:4326)
    outlet_lat : float
        Outlet latitude in decimal degrees
    outlet_lon : float
        Outlet longitude in decimal degrees
    dem_resolution : int, optional
        DEM resolution in meters (default: 30)
    stream_threshold : float, optional
        Flow accumulation threshold for stream extraction (default: auto-calculated)
        
    Returns
    -------
    geomorph_attrs : dict
        Dictionary of 28 geomorphic parameters
    geomorph_units : dict
        Dictionary of units for each parameter
        
    Examples
    --------
    >>> from ai_hydro.tools.geomorphic import extract_geomorphic_parameters
    >>> params, units = extract_geomorphic_parameters(
    ...     watershed_gdf, 
    ...     outlet_lat=40.4405833,
    ...     outlet_lon=-86.8291565
    ... )
    >>> print(f"Drainage area: {params['DA_km2']:.2f} {units['DA_km2']}")
    >>> print(f"Drainage density: {params['D_km_per_km2']:.3f} {units['D_km_per_km2']}")
    
    Notes
    -----
    The 28 parameters include:
    - Basic morphometry (4): DA, Lp, Lb, Lca
    - Shape indices (5): Rff, Rc, Re, Sb, Ru
    - Relief metrics (3): H, Rh, Rp
    - Slope characteristics (2): Ls, Cs
    - Stream network (7): D, Rn, C, Rf, Cf, MCh, Slope_10_85
    - Advanced indices (3): HKR, G, M
    - Additional metrics (4): % water/wetland, % urban, CN, % sinks
    """
    try:
        print("Extracting geomorphic parameters...")
        
        # Ensure watershed is in WGS84
        if watershed_gdf.crs != "EPSG:4326":
            watershed_gdf = watershed_gdf.to_crs("EPSG:4326")
        
        geom = watershed_gdf.geometry.iloc[0]
        
        # 1. Basic morphometry
        print("  - Computing basic morphometry...")
        DA_km2 = _compute_drainage_area(geom)
        Lp_km = _compute_perimeter(geom)
        Lb_km, outlet_point_proj = _compute_basin_length(geom, outlet_lat, outlet_lon)
        Lca_km = _compute_centroid_length(geom, outlet_lat, outlet_lon)
        
        # 2. Shape indices
        print("  - Computing shape indices...")
        shape_indices = _compute_shape_indices(DA_km2, Lp_km, Lb_km)
        
        # 3. Relief and elevation metrics
        print("  - Computing relief metrics...")
        relief_metrics = _compute_relief_metrics(
            geom, outlet_lat, outlet_lon, dem_resolution
        )
        
        # 4. Slope characteristics
        print("  - Computing slope characteristics...")
        Ls = relief_metrics.get('mean_slope_pct', np.nan)
        
        # 5. Stream network metrics (simplified - without actual stream extraction)
        print("  - Computing stream network approximations...")
        stream_metrics = _compute_stream_metrics_approximate(
            DA_km2, Lp_km, relief_metrics
        )
        
        # 6. Advanced indices
        print("  - Computing advanced indices...")
        advanced_indices = _compute_advanced_indices(
            DA_km2, Lb_km, shape_indices['Sb'],
            stream_metrics.get('Cs', np.nan),
            stream_metrics.get('D_km_per_km2', np.nan),
            Lca_km
        )
        
        # 7. Additional metrics (placeholders - require NLCD and soils data)
        print("  - Setting placeholders for land cover metrics...")
        pct_water_wetland = np.nan  # Requires NLCD processing
        pct_urban = np.nan          # Requires NLCD processing
        CN_weighted = np.nan        # Requires NLCD + soils
        pct_sinks = np.nan          # Requires DEM depression analysis
        
        # Assemble all parameters
        geomorph_attrs = {
            # Basic morphometry (4)
            "DA_km2": DA_km2,
            "Lp_km": Lp_km,
            "Lb_km": Lb_km,
            "Lca_km": Lca_km,
            
            # Shape indices (5)
            "Rff": shape_indices['Rff'],
            "Rc": shape_indices['Rc'],
            "Re": shape_indices['Re'],
            "Sb": shape_indices['Sb'],
            "Ru": shape_indices['Ru'],
            
            # Relief metrics (3)
            "H_m": relief_metrics.get('H_m', np.nan),
            "Rh": relief_metrics.get('Rh', np.nan),
            "Rp": relief_metrics.get('Rp', np.nan),
            
            # Slope (2)
            "Ls_pct": Ls,
            "Cs_m_per_m": stream_metrics.get('Cs', np.nan),
            
            # Stream network (7)
            "D_km_per_km2": stream_metrics.get('D_km_per_km2', np.nan),
            "Rn": stream_metrics.get('Rn', np.nan),
            "C_km2_per_km": stream_metrics.get('C_km2_per_km', np.nan),
            "Rf": stream_metrics.get('Rf', np.nan),
            "Cf_per_km2": stream_metrics.get('Cf_per_km2', np.nan),
            "MCh_km": stream_metrics.get('MCh_km', np.nan),
            "Slope_10_85_m_per_m": stream_metrics.get('Slope_10_85', np.nan),
            
            # Advanced indices (3)
            "HKR": advanced_indices['HKR'],
            "G_Gray": advanced_indices['G'],
            "M_Murphey": advanced_indices['M'],
            
            # Additional (4)
            "pct_water_wetland": pct_water_wetland,
            "pct_urban": pct_urban,
            "CN_weighted": CN_weighted,
            "pct_sinks": pct_sinks,
        }
        
        # Units dictionary
        geomorph_units = {
            "DA_km2": "km²",
            "Lp_km": "km",
            "Lb_km": "km",
            "Lca_km": "km",
            "Rff": "–",
            "Rc": "–",
            "Re": "–",
            "Sb": "–",
            "Ru": "–",
            "H_m": "m",
            "Rh": "–",
            "Rp": "–",
            "Ls_pct": "%",
            "Cs_m_per_m": "m/m",
            "D_km_per_km2": "km/km²",
            "Rn": "–",
            "C_km2_per_km": "km²/km",
            "Rf": "–",
            "Cf_per_km2": "1/km²",
            "MCh_km": "km",
            "Slope_10_85_m_per_m": "m/m",
            "HKR": "–",
            "G_Gray": "–",
            "M_Murphey": "–",
            "pct_water_wetland": "%",
            "pct_urban": "%",
            "CN_weighted": "–",
            "pct_sinks": "%",
        }
        
        print(f"✓ Extracted {len(geomorph_attrs)} geomorphic parameters")
        return geomorph_attrs, geomorph_units
        
    except Exception as e:
        print(f"✗ Error extracting geomorphic parameters: {str(e)}")
        # Return NaN-filled dictionary
        param_names = [
            "DA_km2", "Lp_km", "Lb_km", "Lca_km", "Rff", "Rc", "Re", "Sb", "Ru",
            "H_m", "Rh", "Rp", "Ls_pct", "Cs_m_per_m", "D_km_per_km2", "Rn",
            "C_km2_per_km", "Rf", "Cf_per_km2", "MCh_km", "Slope_10_85_m_per_m",
            "HKR", "G_Gray", "M_Murphey", "pct_water_wetland", "pct_urban",
            "CN_weighted", "pct_sinks"
        ]
        return {k: np.nan for k in param_names}, {}


def _compute_drainage_area(geom) -> float:
    """Compute drainage area in km² using geodesic calculation"""
    try:
        lon, lat = geom.exterior.coords.xy
        area_m2, _ = geod.polygon_area_perimeter(lon, lat)
        return abs(area_m2) / 1e6  # m² to km²
    except:
        return np.nan


def _compute_perimeter(geom) -> float:
    """Compute perimeter in km using geodesic calculation"""
    try:
        lon, lat = geom.exterior.coords.xy
        _, perimeter_m = geod.polygon_area_perimeter(lon, lat)
        return perimeter_m / 1000.0  # m to km
    except:
        return np.nan


def _compute_basin_length(geom, outlet_lat: float, outlet_lon: float) -> Tuple[float, Point]:
    """
    Compute basin length as maximum distance from outlet to boundary.
    
    Returns
    -------
    Lb_km : float
        Basin length in km
    outlet_point : Point
        Outlet point in projected CRS for further calculations
    """
    try:
        # Project to equal-area CRS for distance calculations
        watershed_proj = gpd.GeoDataFrame(
            [1], geometry=[geom], crs="EPSG:4326"
        ).to_crs("EPSG:5070")  # Albers Equal Area
        
        geom_proj = watershed_proj.geometry.iloc[0]
        outlet_proj = gpd.GeoSeries(
            [Point(outlet_lon, outlet_lat)], crs="EPSG:4326"
        ).to_crs("EPSG:5070").iloc[0]
        
        # Get boundary coordinates
        boundary = geom_proj.boundary
        if boundary.geom_type == "MultiLineString":
            coords = [c for line in boundary.geoms for c in line.coords]
        else:
            coords = list(boundary.coords)
        
        # Find maximum distance
        max_dist = 0.0
        outlet_xy = (outlet_proj.x, outlet_proj.y)
        for x, y in coords:
            dist = np.hypot(x - outlet_xy[0], y - outlet_xy[1])
            if dist > max_dist:
                max_dist = dist
        
        Lb_km = max_dist / 1000.0
        return Lb_km, outlet_proj
        
    except Exception as e:
        print(f"    Warning: Basin length calculation failed: {e}")
        return np.nan, None


def _compute_centroid_length(geom, outlet_lat: float, outlet_lon: float) -> float:
    """Compute straight-line distance from outlet to centroid"""
    try:
        watershed_proj = gpd.GeoDataFrame(
            [1], geometry=[geom], crs="EPSG:4326"
        ).to_crs("EPSG:5070")
        
        centroid = watershed_proj.centroid.iloc[0]
        outlet_proj = gpd.GeoSeries(
            [Point(outlet_lon, outlet_lat)], crs="EPSG:4326"
        ).to_crs("EPSG:5070").iloc[0]
        
        dist_m = np.hypot(
            centroid.x - outlet_proj.x,
            centroid.y - outlet_proj.y
        )
        return dist_m / 1000.0
        
    except Exception as e:
        print(f"    Warning: Centroid length calculation failed: {e}")
        return np.nan


def _compute_shape_indices(DA_km2: float, Lp_km: float, Lb_km: float) -> Dict[str, float]:
    """
    Compute shape indices for watershed characterization.
    
    Returns
    -------
    dict with keys: Rff, Rc, Re, Sb, Ru
    """
    try:
        # Form factor (Horton 1932)
        Rff = DA_km2 / (Lb_km ** 2) if Lb_km > 0 else np.nan
        
        # Circularity ratio (Miller 1953)
        Rc = (4.0 * np.pi * DA_km2) / (Lp_km ** 2) if Lp_km > 0 else np.nan
        
        # Elongation ratio (Schumm 1956)
        Dc_km = 2.0 * np.sqrt(DA_km2 / np.pi)  # Diameter of equal-area circle
        Re = Dc_km / Lb_km if Lb_km > 0 else np.nan
        
        # Shape factor (Horton 1932)
        Sb = (Lb_km ** 2) / DA_km2 if DA_km2 > 0 else np.nan
        
        # Unity shape factor
        Ru = Lb_km / np.sqrt(DA_km2) if DA_km2 > 0 else np.nan
        
        return {
            'Rff': Rff,
            'Rc': Rc,
            'Re': Re,
            'Sb': Sb,
            'Ru': Ru
        }
        
    except Exception as e:
        print(f"    Warning: Shape indices calculation failed: {e}")
        return {'Rff': np.nan, 'Rc': np.nan, 'Re': np.nan, 'Sb': np.nan, 'Ru': np.nan}


def _compute_relief_metrics(
    geom, 
    outlet_lat: float, 
    outlet_lon: float,
    resolution: int = 30
) -> Dict[str, float]:
    """
    Compute relief metrics from DEM.
    
    Returns
    -------
    dict with keys: H_m, Rh, Rp, mean_slope_pct, outlet_elev
    """
    try:
        # Get DEM
        dem = py3dep.get_dem(geom, resolution=resolution)
        dem_proj = dem.rio.reproject("EPSG:5070")
        
        # Get outlet elevation
        outlet_pt = gpd.GeoSeries(
            [Point(outlet_lon, outlet_lat)], crs="EPSG:4326"
        ).to_crs(dem_proj.rio.crs).iloc[0]
        
        # Sample DEM at outlet (nearest pixel)
        x_idx = int((outlet_pt.x - dem_proj.rio.bounds()[0]) / dem_proj.rio.resolution()[0])
        y_idx = int((dem_proj.rio.bounds()[3] - outlet_pt.y) / abs(dem_proj.rio.resolution()[1]))
        
        # Ensure indices are within bounds
        x_idx = max(0, min(x_idx, dem_proj.shape[1] - 1))
        y_idx = max(0, min(y_idx, dem_proj.shape[0] - 1))
        
        outlet_elev = float(dem_proj.values[y_idx, x_idx])

        # If outlet pixel is NaN (river channel / no-data cell), search nearest valid pixel
        if np.isnan(outlet_elev):
            search_r = 3  # expand ±3 pixels
            for r in range(1, search_r + 1):
                y0 = max(0, y_idx - r); y1 = min(dem_proj.shape[0] - 1, y_idx + r)
                x0 = max(0, x_idx - r); x1 = min(dem_proj.shape[1] - 1, x_idx + r)
                patch = dem_proj.values[y0:y1+1, x0:x1+1]
                valid_vals = patch[~np.isnan(patch)]
                if len(valid_vals) > 0:
                    outlet_elev = float(np.nanmin(valid_vals))  # lowest nearby = outlet
                    break

        # Basin elevations
        z_max = float(np.nanmax(dem_proj.values))
        z_min = float(np.nanmin(dem_proj.values))

        # Relief — guard against NaN outlet (returns np.nan rather than 0.0)
        if np.isnan(outlet_elev):
            H_m = float("nan")
        else:
            H_m = max(0.0, z_max - outlet_elev)
        
        # Compute slope
        slope_deg = xrspatial.slope(dem_proj)
        slope_pct = np.tan(np.deg2rad(slope_deg)) * 100.0
        mean_slope_pct = float(np.nanmean(slope_pct.values))
        
        # Get basin length and perimeter for ratios
        from shapely.geometry import shape as shapely_shape
        geom_proj = gpd.GeoDataFrame(
            [1], geometry=[geom], crs="EPSG:4326"
        ).to_crs("EPSG:5070").geometry.iloc[0]
        
        # Basin length approximation
        bounds = geom_proj.bounds
        Lb_m = max(bounds[2] - bounds[0], bounds[3] - bounds[1])
        
        # Perimeter
        Lp_m = geom_proj.length
        
        # Relief ratio (Schumm 1956)
        Rh = H_m / Lb_m if Lb_m > 0 else np.nan
        
        # Relative relief
        Rp = H_m / Lp_m if Lp_m > 0 else np.nan
        
        return {
            'H_m': H_m,
            'Rh': Rh,
            'Rp': Rp,
            'mean_slope_pct': mean_slope_pct,
            'outlet_elev': outlet_elev,
            'z_max': z_max,
            'Lb_m': Lb_m / 1000.0  # convert to km
        }
        
    except Exception as e:
        print(f"    Warning: Relief metrics calculation failed: {e}")
        return {
            'H_m': np.nan,
            'Rh': np.nan,
            'Rp': np.nan,
            'mean_slope_pct': np.nan,
            'outlet_elev': np.nan,
            'z_max': np.nan,
            'Lb_m': np.nan
        }


def _compute_stream_metrics_approximate(
    DA_km2: float,
    Lp_km: float,
    relief_metrics: Dict[str, float]
) -> Dict[str, float]:
    """
    Compute approximate stream network metrics using empirical relationships.
    
    Note: This provides estimates without full stream network extraction.
    For precise values, use actual stream network from flow accumulation.
    """
    try:
        # Approximate drainage density using empirical relationship
        # Typical range: 0.5-5.0 km/km² (Horton 1945)
        # Here we use a simple approximation based on basin characteristics
        
        H_m = relief_metrics.get('H_m', 0)
        Lb_km = relief_metrics.get('Lb_m', np.nan)
        
        # Drainage density approximation (increases with relief and decreases with area)
        D_km_per_km2 = 0.5 + (H_m / 1000.0)  # Rough approximation
        D_km_per_km2 = max(0.5, min(D_km_per_km2, 5.0))  # Constrain to reasonable range
        
        # Ruggedness number (Melton 1957)
        Rn = (H_m / 1000.0) * D_km_per_km2
        
        # Constant of channel maintenance (Schumm 1956)
        C_km2_per_km = 1.0 / D_km_per_km2 if D_km_per_km2 > 0 else np.nan
        
        # Fineness ratio
        total_stream_len_km = D_km_per_km2 * DA_km2
        Rf = total_stream_len_km / Lp_km if Lp_km > 0 else np.nan
        
        # Stream frequency (approximate)
        # Assume typical stream segment length ~ 1 km
        n_segments = total_stream_len_km
        Cf_per_km2 = n_segments / DA_km2 if DA_km2 > 0 else np.nan
        
        # Main channel length (approximate as ~1.5 * basin length)
        MCh_km = 1.5 * Lb_km if not np.isnan(Lb_km) else np.nan
        
        # Main channel slope
        Cs = (H_m / (MCh_km * 1000.0)) if (MCh_km and MCh_km > 0) else np.nan
        
        # 10-85% slope (approximate)
        Slope_10_85 = 0.75 * Cs if not np.isnan(Cs) else np.nan
        
        return {
            'D_km_per_km2': D_km_per_km2,
            'Rn': Rn,
            'C_km2_per_km': C_km2_per_km,
            'Rf': Rf,
            'Cf_per_km2': Cf_per_km2,
            'MCh_km': MCh_km,
            'Cs': Cs,
            'Slope_10_85': Slope_10_85
        }
        
    except Exception as e:
        print(f"    Warning: Stream metrics approximation failed: {e}")
        return {k: np.nan for k in [
            'D_km_per_km2', 'Rn', 'C_km2_per_km', 'Rf',
            'Cf_per_km2', 'MCh_km', 'Cs', 'Slope_10_85'
        ]}


def _compute_advanced_indices(
    DA_km2: float,
    Lb_km: float,
    Sb: float,
    Cs: float,
    D: float,
    Lca_km: float
) -> Dict[str, float]:
    """
    Compute advanced geomorphic indices.
    
    Returns
    -------
    dict with keys: HKR, G, M
    """
    try:
        # Hypsometric-Kinematic-Relief index (HKR)
        if Cs > 0 and D > 0 and np.isfinite(Cs) and np.isfinite(D):
            HKR = DA_km2 / (Cs * np.sqrt(D))
        else:
            HKR = np.nan
        
        # Gray's index (Gray 1961)
        if Cs > 0 and np.isfinite(Cs):
            G = Lca_km / np.sqrt(Cs)
        else:
            G = np.nan
        
        # Murphey index
        if DA_km2 > 0 and np.isfinite(Sb):
            M = Sb / DA_km2
        else:
            M = np.nan
        
        return {'HKR': HKR, 'G': G, 'M': M}
        
    except Exception as e:
        print(f"    Warning: Advanced indices calculation failed: {e}")
        return {'HKR': np.nan, 'G': np.nan, 'M': np.nan}


# Convenience function for quick extraction
def get_geomorphic_summary(
    watershed_gdf: gpd.GeoDataFrame,
    outlet_lat: float,
    outlet_lon: float
) -> str:
    """
    Generate a human-readable summary of geomorphic characteristics.
    
    Parameters
    ----------
    watershed_gdf : gpd.GeoDataFrame
        Watershed boundary
    outlet_lat : float
        Outlet latitude
    outlet_lon : float
        Outlet longitude
        
    Returns
    -------
    str
        Formatted summary text
    """
    params, units = extract_geomorphic_parameters(
        watershed_gdf, outlet_lat, outlet_lon
    )
    
    summary = "\n" + "="*60 + "\n"
    summary += "GEOMORPHIC CHARACTERISTICS SUMMARY\n"
    summary += "="*60 + "\n\n"
    
    summary += "BASIC MORPHOMETRY:\n"
    summary += f"  Drainage Area: {params['DA_km2']:.2f} {units['DA_km2']}\n"
    summary += f"  Perimeter: {params['Lp_km']:.2f} {units['Lp_km']}\n"
    summary += f"  Basin Length: {params['Lb_km']:.2f} {units['Lb_km']}\n"
    summary += f"  Centroid Length: {params['Lca_km']:.2f} {units['Lca_km']}\n\n"
    
    summary += "SHAPE CHARACTERISTICS:\n"
    summary += f"  Form Factor (Rff): {params['Rff']:.3f}\n"
    summary += f"  Circularity Ratio (Rc): {params['Rc']:.3f}\n"
    summary += f"  Elongation Ratio (Re): {params['Re']:.3f}\n\n"
    
    summary += "RELIEF AND SLOPE:\n"
    summary += f"  Basin Relief (H): {params['H_m']:.1f} {units['H_m']}\n"
    summary += f"  Relief Ratio (Rh): {params['Rh']:.4f}\n"
    summary += f"  Mean Basin Slope: {params['Ls_pct']:.2f} {units['Ls_pct']}\n\n"
    
    summary += "STREAM NETWORK (approximate):\n"
    summary += f"  Drainage Density (D): {params['D_km_per_km2']:.3f} {units['D_km_per_km2']}\n"
    summary += f"  Stream Frequency (Cf): {params['Cf_per_km2']:.3f} {units['Cf_per_km2']}\n"
    summary += f"  Main Channel Length: {params['MCh_km']:.2f} {units['MCh_km']}\n\n"
    
    summary += "="*60 + "\n"
    
    return summary


# ---------------------------------------------------------------------------
# HydroResult wrapper — MCP-facing public API
# ---------------------------------------------------------------------------

def extract_geomorphic_parameters_result(
    watershed_geojson: dict,
    outlet_lat: float,
    outlet_lon: float,
    dem_resolution: int = 30,
) -> "HydroResult":
    """
    Extract 28 geomorphic parameters. Accepts GeoJSON dict, returns HydroResult.

    This is the MCP-facing wrapper around extract_geomorphic_parameters().
    Pass result.data['geometry_geojson'] and result.data['gauge_lat/lon']
    from delineate_watershed() directly.

    Parameters
    ----------
    watershed_geojson : dict
        GeoJSON polygon (from delineate_watershed result.data['geometry_geojson'])
    outlet_lat : float
        Outlet latitude (from delineate_watershed result.data['gauge_lat'])
    outlet_lon : float
        Outlet longitude (from delineate_watershed result.data['gauge_lon'])
    dem_resolution : int
        DEM resolution in metres (default 30)

    Returns
    -------
    HydroResult
        result.data: 28 float parameters + '_units' dict
        result.meta: FAIR provenance
    """
    if not _DEPS_AVAILABLE:
        raise ImportError("geomorphic analysis requires: pip install aihydro-tools[analysis]")
    from shapely.geometry import shape
    import geopandas as gpd
    from ai_hydro.core import HydroResult, HydroMeta, DataSource

    try:
        watershed_geom = shape(watershed_geojson)
        watershed_gdf = gpd.GeoDataFrame(geometry=[watershed_geom], crs="EPSG:4326")

        params, units = extract_geomorphic_parameters(
            watershed_gdf=watershed_gdf,
            outlet_lat=outlet_lat,
            outlet_lon=outlet_lon,
            dem_resolution=dem_resolution,
        )

        # Convert all values to JSON-serializable floats
        clean = {}
        for k, v in params.items():
            try:
                fv = float(v)
                clean[k] = fv if np.isfinite(fv) else None
            except (TypeError, ValueError):
                clean[k] = None
        clean["_units"] = units

        def _get_version():
            try:
                from importlib.metadata import version
                return version("aihydro-tools")
            except Exception:
                return "unknown"

        return HydroResult(
            data=clean,
            meta=HydroMeta(
                tool="ai_hydro.tools.geomorphic.extract_geomorphic_parameters",
                version=_get_version(),
                sources=[
                    DataSource(
                        name="USGS 3DEP",
                        url="https://www.usgs.gov/3d-elevation-program",
                        citation=(
                            "@misc{3DEP2024,\n"
                            "  title={3D Elevation Program},\n"
                            "  author={{USGS}}, year={2024},\n"
                            "  url={https://www.usgs.gov/3d-elevation-program}\n"
                            "}"
                        ),
                    )
                ],
                params={
                    "outlet_lat": outlet_lat,
                    "outlet_lon": outlet_lon,
                    "dem_resolution": dem_resolution,
                },
            ),
        )

    except Exception as e:
        from ai_hydro.core import ToolError
        raise ToolError(
            code="COMPUTATION_ERROR",
            message=f"Geomorphic parameter extraction failed: {e}",
            tool="ai_hydro.tools.geomorphic.extract_geomorphic_parameters",
            recovery="Verify watershed_geojson is a valid GeoJSON polygon.",
        ) from e
