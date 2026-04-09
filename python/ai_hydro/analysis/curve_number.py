"""
Curve Number (CN) Grid Generation — Analysis Layer

Creates NRCS Curve Number grids for watersheds by combining NLCD land cover
data with soil properties to characterize runoff potential.

Data retrieval functions (fetch_lulc_data, fetch_soil_data_polaris) are in
ai_hydro.data.landcover and ai_hydro.data.soil respectively.
"""

from __future__ import annotations

import numpy as np
from pathlib import Path
from typing import Dict, List, Tuple, Optional, Any
import warnings

try:
    import xarray as xr
    import geopandas as gpd
    from ai_hydro.data.landcover import fetch_lulc_data
    from ai_hydro.data.soil import fetch_soil_data_polaris
    _DEPS_AVAILABLE = True
except ImportError:
    _DEPS_AVAILABLE = False

# Conditional imports for visualization
try:
    import matplotlib
    matplotlib.use("Agg")  # headless — MCP server has no display
    import matplotlib.pyplot as plt
    import matplotlib.colors as mcolors
    HAS_MATPLOTLIB = True
except ImportError:
    HAS_MATPLOTLIB = False
    warnings.warn("matplotlib not available - visualizations will be disabled")

try:
    import folium
    from folium import raster_layers
    HAS_FOLIUM = True
except ImportError:
    HAS_FOLIUM = False
    warnings.warn("folium not available - interactive maps will be disabled")


def create_curve_number_grid(
    gauge_id: str,
    year: int = 2019,
    resolution: int = 30,
    save_outputs: bool = True,
    output_dir: Optional[str] = None,
    output_formats: List[str] = None,
    create_visualizations: bool = True,
    output_prefix: Optional[str] = None
) -> Dict[str, Any]:
    """
    Create comprehensive Curve Number grid for a USGS gauge watershed.
    
    This function performs complete CN grid generation including watershed delineation,
    LULC data retrieval, soil properties extraction, hydrologic group classification,
    CN grid creation, and optional visualizations.
    
    Parameters
    ----------
    gauge_id : str
        USGS gauge identifier (8-digit code, e.g., '03245500')
    year : int, optional
        Year of NLCD data to use (default: 2019)
    resolution : int, optional
        Spatial resolution in meters (default: 30m NLCD native)
    save_outputs : bool, optional
        Whether to save output files (default: True)
    output_dir : str, optional
        Output directory path. If None, uses './output/cn_grid_{gauge_id}'
    output_formats : list of str, optional
        Output formats to save: 'geotiff', 'netcdf', or both (default: ['geotiff', 'netcdf'])
    create_visualizations : bool, optional
        Whether to create PNG and HTML visualizations (default: True)
    output_prefix : str, optional
        Filename prefix for outputs (default: 'cn_grid')
    
    Returns
    -------
    dict
        Dictionary with the following structure:
        
        {
            'cn_grid': xarray.DataArray,
            
            'statistics': {
                'cn_mean': float,
                'cn_median': float,
                'cn_min': float,
                'cn_max': float,
                'cn_std': float,
                'cn_p10': float,
                'cn_p25': float,
                'cn_p75': float,
                'cn_p90': float
            },
            
            'cn_zones': {
                'percent_low_cn': float,              # CN < 70
                'percent_medium_cn': float,           # CN 70-85 (NOTE: 'medium' not 'moderate')
                'percent_high_cn': float,             # CN > 85
                'low_cn_interpretation': str,
                'medium_cn_interpretation': str,
                'high_cn_interpretation': str
            },
            
            'watershed_info': {
                'gauge_id': str,
                'gauge_name': str,
                'area_km2': float,
                'centroid_lat': float,
                'centroid_lon': float,
                'geometry': shapely.geometry.Polygon,
                'gdf': geopandas.GeoDataFrame
            },
            
            'lulc_stats': {
                'classes': list,       # NLCD class codes
                'counts': list,        # Pixel counts
                'percentages': list    # Percentage for each class
            },
            
            'soil_stats': {
                'soil_group_distribution': {
                    'A': int, 'B': int, 'C': int, 'D': int
                },
                'soil_group_percentages': {
                    'A': float, 'B': float, 'C': float, 'D': float
                }
            },
            
            'file_paths': {         # Only if save_outputs=True
                'watershed': str,
                'geotiff': str,
                'netcdf': str,
                'statistics': str,
                'png_map': str,
                'html_map': str
            },
            
            'visualizations': {     # Only if create_visualizations=True
                'figure': matplotlib.figure.Figure
            }
        }
        
        Access examples:
        - CN mean: result['statistics']['cn_mean']
        - Medium CN zone: result['cn_zones']['percent_medium_cn']
        - Land cover classes: result['lulc_stats']['classes']
        - Gauge name: result['watershed_info']['gauge_name']
    
    Examples
    --------
    >>> # Simple usage - automatic everything
    >>> result = create_curve_number_grid('03245500')
    >>> print(f"Mean CN: {result['statistics']['cn_mean']:.1f}")
    >>> print(f"High CN areas: {result['cn_zones']['percent_high_cn']:.1f}%")
    
    >>> # Custom parameters
    >>> result = create_curve_number_grid(
    ...     gauge_id='03245500',
    ...     year=2016,
    ...     resolution=10,
    ...     output_formats=['netcdf'],
    ...     create_visualizations=True
    ... )
    
    Notes
    -----
    - CN values are for Antecedent Moisture Condition II (AMC-II)
    - Soil groups: A (high infiltration) to D (very slow infiltration)
    - Uses NRCS CN lookup tables for NLCD classes
    - Outputs in WGS84 (EPSG:4326) projection
    """
    if not _DEPS_AVAILABLE:
        raise ImportError("curve number analysis requires: pip install aihydro-tools[analysis]")
    from ai_hydro.analysis.watershed import delineate_watershed

    # Set defaults
    if output_formats is None:
        output_formats = ['geotiff', 'netcdf']
    if output_prefix is None:
        output_prefix = 'cn_grid'
    
    # Setup output directory
    if output_dir is None:
        output_dir = f'./output/cn_grid_{gauge_id}'
    output_path = Path(output_dir)
    if save_outputs:
        output_path.mkdir(parents=True, exist_ok=True)
    
    print("="*70)
    print("CURVE NUMBER GRID GENERATION")
    print("="*70)
    print(f"Gauge ID: {gauge_id}")
    print(f"NLCD Year: {year}")
    print(f"Resolution: {resolution}m")
    print()
    
    # Step 1: Delineate watershed
    print("Step 1: Delineate watershed boundary")
    print("-" * 50)
    watershed_data = delineate_watershed(gauge_id=gauge_id)
    watershed_geom = watershed_data['geometry']
    watershed_gdf = watershed_data['gdf']
    
    print(f"  Watershed: {watershed_data['gauge_name']}")
    print(f"  Area: {watershed_data['area_km2']:.2f} km²")
    print(f"  Centroid: ({watershed_data['gauge_lon']:.4f}, {watershed_data['gauge_lat']:.4f})")
    print()
    
    # Step 2: Fetch LULC data
    print("Step 2: Fetch NLCD land cover data")
    print("-" * 50)
    lulc_data = fetch_lulc_data(watershed_gdf, resolution=resolution, year=year)
    cover_var = f'cover_{year}'
    print(f"  Retrieved {cover_var} with shape: {lulc_data[cover_var].shape}")
    
    # Get LULC statistics
    lulc_values = lulc_data[cover_var].values
    unique_classes, class_counts = np.unique(lulc_values[~np.isnan(lulc_values)], return_counts=True)
    lulc_stats = {
        'classes': unique_classes.tolist(),
        'counts': class_counts.tolist(),
        'percentages': (100 * class_counts / class_counts.sum()).tolist()
    }
    print(f"  Unique NLCD classes: {len(unique_classes)}")
    print()
    
    # Step 3: Fetch soil data
    print("Step 3: Fetch soil properties from Polaris")
    print("-" * 50)
    soil_data = fetch_soil_data_polaris(watershed_gdf)
    print(f"  Retrieved soil data variables: {list(soil_data.data_vars)}")
    print()
    
    # Step 4: Classify soil groups and create CN grid
    print("Step 4: Create Curve Number grid")
    print("-" * 50)
    cn_grid, soil_group_grid, soil_stats = _create_cn_grid_from_data(
        lulc_data, soil_data, year, resolution
    )
    print()
    
    # Step 5: Calculate statistics
    print("Step 5: Calculate statistics and zones")
    print("-" * 50)
    valid_cn = cn_grid.values[~np.isnan(cn_grid.values)]
    statistics = {
        'cn_mean': float(valid_cn.mean()),
        'cn_median': float(np.median(valid_cn)),
        'cn_min': float(valid_cn.min()),
        'cn_max': float(valid_cn.max()),
        'cn_std': float(valid_cn.std()),
        'cn_p10': float(np.percentile(valid_cn, 10)),
        'cn_p25': float(np.percentile(valid_cn, 25)),
        'cn_p75': float(np.percentile(valid_cn, 75)),
        'cn_p90': float(np.percentile(valid_cn, 90))
    }
    
    # Classify CN zones
    cn_zones = _classify_cn_zones(cn_grid.values)
    
    print(f"  CN Statistics:")
    print(f"    Mean: {statistics['cn_mean']:.1f}")
    print(f"    Median: {statistics['cn_median']:.1f}")
    print(f"    Range: {statistics['cn_min']:.0f} - {statistics['cn_max']:.0f}")
    print(f"    Std: {statistics['cn_std']:.1f}")
    print(f"  CN Zones:")
    print(f"    Low CN (<70): {cn_zones['percent_low_cn']:.1f}%")
    print(f"    Medium CN (70-85): {cn_zones['percent_medium_cn']:.1f}%")
    print(f"    High CN (>85): {cn_zones['percent_high_cn']:.1f}%")
    print()
    
    # Step 6: Save outputs
    file_paths = {}
    if save_outputs:
        print("Step 6: Save outputs")
        print("-" * 50)
        
        # Save watershed boundary
        watershed_path = output_path / f'{output_prefix}_watershed_{gauge_id}.gpkg'
        watershed_gdf.to_file(watershed_path, driver='GPKG')
        file_paths['watershed'] = str(watershed_path)
        print(f"  Saved watershed: {watershed_path.name}")
        
        # Save CN grid in requested formats
        if 'geotiff' in output_formats:
            tif_path = output_path / f'{output_prefix}_{gauge_id}.tif'
            cn_grid.rio.to_raster(tif_path, driver='GTiff', compress='lzw')
            file_paths['geotiff'] = str(tif_path)
            print(f"  Saved GeoTIFF: {tif_path.name}")
        
        if 'netcdf' in output_formats:
            nc_path = output_path / f'{output_prefix}_{gauge_id}.nc'
            # Add metadata
            cn_grid.attrs['gauge_id'] = gauge_id
            cn_grid.attrs['gauge_name'] = watershed_data['gauge_name']
            cn_grid.attrs['creation_date'] = str(np.datetime64('today'))
            cn_grid.to_netcdf(nc_path)
            file_paths['netcdf'] = str(nc_path)
            print(f"  Saved NetCDF: {nc_path.name}")
        
        # Save statistics as JSON
        import json
        stats_path = output_path / f'{output_prefix}_statistics_{gauge_id}.json'
        stats_output = {
            'gauge_id': gauge_id,
            'gauge_name': watershed_data['gauge_name'],
            'area_km2': watershed_data['area_km2'],
            'cn_statistics': statistics,
            'cn_zones': cn_zones,
            'lulc_year': year,
            'resolution_m': resolution
        }
        with open(stats_path, 'w') as f:
            json.dump(stats_output, f, indent=2)
        file_paths['statistics'] = str(stats_path)
        print(f"  Saved statistics: {stats_path.name}")
        print()
    
    # Step 7: Create visualizations
    visualizations = {}
    if create_visualizations:
        print("Step 7: Create visualizations")
        print("-" * 50)
        
        # Static PNG map
        if HAS_MATPLOTLIB:
            fig = _create_static_visualization(cn_grid, watershed_gdf, gauge_id)
            visualizations['figure'] = fig
            
            if save_outputs:
                png_path = output_path / f'{output_prefix}_{gauge_id}.png'
                fig.savefig(png_path, dpi=300, bbox_inches='tight')
                file_paths['png_map'] = str(png_path)
                print(f"  Saved PNG map: {png_path.name}")
                plt.close(fig)
        
        # Interactive HTML map
        if HAS_FOLIUM and save_outputs:
            html_path = output_path / f'{output_prefix}_{gauge_id}.html'
            _create_interactive_map(cn_grid, watershed_gdf, html_path, gauge_id)
            file_paths['html_map'] = str(html_path)
            print(f"  Saved HTML map: {html_path.name}")
        
        print()
    
    # Summary
    print("="*70)
    print("COMPLETED SUCCESSFULLY!")
    print("="*70)
    if save_outputs:
        print(f"Output directory: {output_path.absolute()}")
        print(f"Files saved: {len(file_paths)}")
    print()
    
    # Return comprehensive results
    return {
        'cn_grid': cn_grid,
        'statistics': statistics,
        'cn_zones': cn_zones,
        'watershed_info': {
            'gauge_id': watershed_data['gauge_id'],
            'gauge_name': watershed_data['gauge_name'],
            'area_km2': watershed_data['area_km2'],
            'centroid_lat': watershed_data['gauge_lat'],
            'centroid_lon': watershed_data['gauge_lon'],
            'geometry': watershed_geom,
            'gdf': watershed_gdf
        },
        'lulc_stats': lulc_stats,
        'soil_stats': soil_stats,
        'file_paths': file_paths,
        'files_saved': list(file_paths.values()),
        'visualizations': visualizations
    }


def create_curve_number_grid_from_geometry(
    geometry,
    year: int = 2019,
    resolution: int = 30,
    save_outputs: bool = True,
    output_dir: Optional[str] = None,
    output_formats: List[str] = None,
    create_visualizations: bool = True,
    output_prefix: Optional[str] = None
) -> Dict[str, Any]:
    """
    Create comprehensive Curve Number grid from custom watershed geometry.
    
    This function accepts various geometry formats (shapefile, GeoJSON, GeoDataFrame,
    or shapely geometry) and creates a CN grid following the same methodology as
    the gauge-based function. Ideal for custom watersheds, delineated boundaries,
    or non-USGS catchments.
    
    Parameters
    ----------
    geometry : str, Path, gpd.GeoDataFrame, or shapely.Polygon
        Watershed geometry in one of these formats:
        - str/Path: Path to shapefile (.shp) or GeoJSON (.geojson, .json)
        - gpd.GeoDataFrame: Watershed as GeoDataFrame
        - shapely.Polygon: Watershed boundary polygon
        Must be in WGS84 (EPSG:4326) or will be reprojected
    year : int, optional
        Year of NLCD data to use (default: 2019)
    resolution : int, optional
        Spatial resolution in meters (default: 30m)
    save_outputs : bool, optional
        Whether to save output files (default: True)
    output_dir : str, optional
        Output directory path. If None, uses './output/cn_grid_custom'
    output_formats : list of str, optional
        Output formats: 'geotiff', 'netcdf', or both (default: ['geotiff', 'netcdf'])
    create_visualizations : bool, optional
        Whether to create PNG and HTML visualizations (default: True)
    output_prefix : str, optional
        Filename prefix for outputs (default: 'cn_grid_custom')
    
    Returns
    -------
    dict
        Dictionary with the following structure (same as create_curve_number_grid):
        
        {
            'cn_grid': xarray.DataArray,
            
            'statistics': {
                'cn_mean': float,
                'cn_median': float,
                'cn_min': float,
                'cn_max': float,
                'cn_std': float,
                'cn_p10': float,
                'cn_p25': float,
                'cn_p75': float,
                'cn_p90': float
            },
            
            'cn_zones': {
                'percent_low_cn': float,              # CN < 70
                'percent_medium_cn': float,           # CN 70-85 (NOTE: 'medium' not 'moderate')
                'percent_high_cn': float,             # CN > 85
                'low_cn_interpretation': str,
                'medium_cn_interpretation': str,
                'high_cn_interpretation': str
            },
            
            'watershed_info': {
                'source': 'custom_geometry',
                'area_km2': float,
                'centroid_lat': float,
                'centroid_lon': float,
                'geometry': shapely.geometry.Polygon,
                'gdf': geopandas.GeoDataFrame
            },
            
            'lulc_stats': {
                'classes': list,       # NLCD class codes
                'counts': list,        # Pixel counts
                'percentages': list    # Percentage for each class
            },
            
            'soil_stats': {
                'soil_group_distribution': {
                    'A': int, 'B': int, 'C': int, 'D': int
                },
                'soil_group_percentages': {
                    'A': float, 'B': float, 'C': float, 'D': float
                }
            },
            
            'file_paths': {         # Only if save_outputs=True
                'watershed': str,
                'geotiff': str,
                'netcdf': str,
                'statistics': str,
                'png_map': str,
                'html_map': str
            },
            
            'visualizations': {     # Only if create_visualizations=True
                'figure': matplotlib.figure.Figure
            }
        }
        
        Access examples:
        - CN mean: result['statistics']['cn_mean']
        - Medium CN zone: result['cn_zones']['percent_medium_cn']
        - Land cover classes: result['lulc_stats']['classes']
        - Watershed area: result['watershed_info']['area_km2']
    
    Examples
    --------
    >>> # From shapefile
    >>> result = create_curve_number_grid_from_geometry('watershed.shp')
    
    >>> # From GeoJSON
    >>> result = create_curve_number_grid_from_geometry('watershed.geojson')
    
    >>> # From delineated watershed
    >>> from ai_hydro.analysis.watershed import delineate_watershed
    >>> ws = delineate_watershed('01031500')
    >>> result = create_curve_number_grid_from_geometry(ws['geometry'])
    
    >>> # From GeoDataFrame with custom settings
    >>> result = create_curve_number_grid_from_geometry(
    ...     watershed_gdf,
    ...     year=2016,
    ...     resolution=10,
    ...     output_dir='./my_cn_analysis',
    ...     output_prefix='custom_watershed'
    ... )
    
    Notes
    -----
    - CN values are for Antecedent Moisture Condition II (AMC-II)
    - Uses same methodology as gauge-based function
    - Accepts any geometry format - automatically handles conversion
    - Outputs in WGS84 (EPSG:4326) projection
    """
    if not _DEPS_AVAILABLE:
        raise ImportError("curve number analysis requires: pip install aihydro-tools[analysis]")
    from pathlib import Path

    # Set defaults
    if output_formats is None:
        output_formats = ['geotiff', 'netcdf']
    if output_prefix is None:
        output_prefix = 'cn_grid_custom'
    
    # Setup output directory
    if output_dir is None:
        output_dir = './output/cn_grid_custom'
    output_path = Path(output_dir)
    if save_outputs:
        output_path.mkdir(parents=True, exist_ok=True)
    
    print("="*70)
    print("CURVE NUMBER GRID GENERATION (CUSTOM GEOMETRY)")
    print("="*70)
    print(f"Geometry Type: {type(geometry).__name__}")
    print(f"NLCD Year: {year}")
    print(f"Resolution: {resolution}m")
    print()
    
    # Convert geometry to GeoDataFrame
    print("Step 1: Process input geometry")
    print("-" * 50)
    watershed_gdf = _convert_geometry_to_geodataframe(geometry)
    watershed_geom = watershed_gdf.geometry.iloc[0]
    
    # Calculate area
    area_km2 = watershed_gdf.to_crs(epsg=5070).area.iloc[0] / 1e6  # Convert m² to km²
    centroid = watershed_geom.centroid
    
    print(f"  Geometry processed successfully")
    print(f"  Area: {area_km2:.2f} km²")
    print(f"  Centroid: ({centroid.x:.4f}, {centroid.y:.4f})")
    print()
    
    # Step 2: Fetch LULC data
    print("Step 2: Fetch NLCD land cover data")
    print("-" * 50)
    lulc_data = fetch_lulc_data(watershed_gdf, resolution=resolution, year=year)
    cover_var = f'cover_{year}'
    print(f"  Retrieved {cover_var} with shape: {lulc_data[cover_var].shape}")
    
    # Get LULC statistics
    lulc_values = lulc_data[cover_var].values
    unique_classes, class_counts = np.unique(lulc_values[~np.isnan(lulc_values)], return_counts=True)
    lulc_stats = {
        'classes': unique_classes.tolist(),
        'counts': class_counts.tolist(),
        'percentages': (100 * class_counts / class_counts.sum()).tolist()
    }
    print(f"  Unique NLCD classes: {len(unique_classes)}")
    print()
    
    # Step 3: Fetch soil data
    print("Step 3: Fetch soil properties from Polaris")
    print("-" * 50)
    soil_data = fetch_soil_data_polaris(watershed_gdf)
    print(f"  Retrieved soil data variables: {list(soil_data.data_vars)}")
    print()
    
    # Step 4: Classify soil groups and create CN grid
    print("Step 4: Create Curve Number grid")
    print("-" * 50)
    cn_grid, soil_group_grid, soil_stats = _create_cn_grid_from_data(
        lulc_data, soil_data, year, resolution
    )
    print()
    
    # Step 5: Calculate statistics
    print("Step 5: Calculate statistics and zones")
    print("-" * 50)
    valid_cn = cn_grid.values[~np.isnan(cn_grid.values)]
    statistics = {
        'cn_mean': float(valid_cn.mean()),
        'cn_median': float(np.median(valid_cn)),
        'cn_min': float(valid_cn.min()),
        'cn_max': float(valid_cn.max()),
        'cn_std': float(valid_cn.std()),
        'cn_p10': float(np.percentile(valid_cn, 10)),
        'cn_p25': float(np.percentile(valid_cn, 25)),
        'cn_p75': float(np.percentile(valid_cn, 75)),
        'cn_p90': float(np.percentile(valid_cn, 90))
    }
    
    # Classify CN zones
    cn_zones = _classify_cn_zones(cn_grid.values)
    
    print(f"  CN Statistics:")
    print(f"    Mean: {statistics['cn_mean']:.1f}")
    print(f"    Median: {statistics['cn_median']:.1f}")
    print(f"    Range: {statistics['cn_min']:.0f} - {statistics['cn_max']:.0f}")
    print(f"    Std: {statistics['cn_std']:.1f}")
    print(f"  CN Zones:")
    print(f"    Low CN (<70): {cn_zones['percent_low_cn']:.1f}%")
    print(f"    Medium CN (70-85): {cn_zones['percent_medium_cn']:.1f}%")
    print(f"    High CN (>85): {cn_zones['percent_high_cn']:.1f}%")
    print()
    
    # Step 6: Save outputs
    file_paths = {}
    if save_outputs:
        print("Step 6: Save outputs")
        print("-" * 50)
        
        # Save watershed boundary
        watershed_path = output_path / f'{output_prefix}_watershed.gpkg'
        watershed_gdf.to_file(watershed_path, driver='GPKG')
        file_paths['watershed'] = str(watershed_path)
        print(f"  Saved watershed: {watershed_path.name}")
        
        # Save CN grid in requested formats
        if 'geotiff' in output_formats:
            tif_path = output_path / f'{output_prefix}.tif'
            cn_grid.rio.to_raster(tif_path, driver='GTiff', compress='lzw')
            file_paths['geotiff'] = str(tif_path)
            print(f"  Saved GeoTIFF: {tif_path.name}")
        
        if 'netcdf' in output_formats:
            nc_path = output_path / f'{output_prefix}.nc'
            # Add metadata
            cn_grid.attrs['source'] = 'custom_geometry'
            cn_grid.attrs['creation_date'] = str(np.datetime64('today'))
            cn_grid.to_netcdf(nc_path)
            file_paths['netcdf'] = str(nc_path)
            print(f"  Saved NetCDF: {nc_path.name}")
        
        # Save statistics as JSON
        import json
        stats_path = output_path / f'{output_prefix}_statistics.json'
        stats_output = {
            'source': 'custom_geometry',
            'area_km2': area_km2,
            'cn_statistics': statistics,
            'cn_zones': cn_zones,
            'lulc_year': year,
            'resolution_m': resolution
        }
        with open(stats_path, 'w') as f:
            json.dump(stats_output, f, indent=2)
        file_paths['statistics'] = str(stats_path)
        print(f"  Saved statistics: {stats_path.name}")
        print()
    
    # Step 7: Create visualizations
    visualizations = {}
    if create_visualizations:
        print("Step 7: Create visualizations")
        print("-" * 50)
        
        # Static PNG map
        if HAS_MATPLOTLIB:
            fig = _create_static_visualization(cn_grid, watershed_gdf, 'Custom Geometry')
            visualizations['figure'] = fig
            
            if save_outputs:
                png_path = output_path / f'{output_prefix}.png'
                fig.savefig(png_path, dpi=300, bbox_inches='tight')
                file_paths['png_map'] = str(png_path)
                print(f"  Saved PNG map: {png_path.name}")
                plt.close(fig)
        
        # Interactive HTML map
        if HAS_FOLIUM and save_outputs:
            html_path = output_path / f'{output_prefix}.html'
            _create_interactive_map(cn_grid, watershed_gdf, html_path, 'Custom Geometry')
            file_paths['html_map'] = str(html_path)
            print(f"  Saved HTML map: {html_path.name}")
        
        print()
    
    # Summary
    print("="*70)
    print("COMPLETED SUCCESSFULLY!")
    print("="*70)
    if save_outputs:
        print(f"Output directory: {output_path.absolute()}")
        print(f"Files saved: {len(file_paths)}")
    print()
    
    # Return comprehensive results
    return {
        'cn_grid': cn_grid,
        'statistics': statistics,
        'cn_zones': cn_zones,
        'watershed_info': {
            'source': 'custom_geometry',
            'area_km2': area_km2,
            'centroid_lat': centroid.y,
            'centroid_lon': centroid.x,
            'geometry': watershed_geom,
            'gdf': watershed_gdf
        },
        'lulc_stats': lulc_stats,
        'soil_stats': soil_stats,
        'file_paths': file_paths,
        'files_saved': list(file_paths.values()),
        'visualizations': visualizations
    }


# ============================================================================
# Internal Helper Functions (not exported to RAG)
# ============================================================================

def _convert_geometry_to_geodataframe(geometry) -> gpd.GeoDataFrame:
    """
    Convert various geometry formats to GeoDataFrame.
    
    Accepts:
    - File paths (str/Path): .shp, .geojson, .json
    - GeoDataFrame
    - Shapely Polygon/MultiPolygon
    
    Returns GeoDataFrame in WGS84 (EPSG:4326).
    """
    from pathlib import Path
    from shapely.geometry import Polygon, MultiPolygon
    
    # If already GeoDataFrame
    if isinstance(geometry, gpd.GeoDataFrame):
        gdf = geometry.copy()
        if gdf.crs is None:
            gdf.set_crs(epsg=4326, inplace=True)
        elif gdf.crs.to_epsg() != 4326:
            gdf = gdf.to_crs(epsg=4326)
        return gdf
    
    # If file path (string or Path)
    if isinstance(geometry, (str, Path)):
        path = Path(geometry)
        
        if not path.exists():
            raise FileNotFoundError(f"Geometry file not found: {path}")
        
        # Read file based on extension
        if path.suffix.lower() in ['.shp', '.geojson', '.json', '.gpkg']:
            gdf = gpd.read_file(path)
            if gdf.crs is None:
                gdf.set_crs(epsg=4326, inplace=True)
            elif gdf.crs.to_epsg() != 4326:
                gdf = gdf.to_crs(epsg=4326)
            return gdf
        else:
            raise ValueError(f"Unsupported file format: {path.suffix}. "
                           "Supported formats: .shp, .geojson, .json, .gpkg")
    
    # If shapely Polygon or MultiPolygon
    if isinstance(geometry, (Polygon, MultiPolygon)):
        gdf = gpd.GeoDataFrame({'geometry': [geometry]}, crs='EPSG:4326')
        return gdf
    
    # If GeoSeries
    if isinstance(geometry, gpd.GeoSeries):
        gdf = gpd.GeoDataFrame({'geometry': geometry}, crs=geometry.crs)
        if gdf.crs is None:
            gdf.set_crs(epsg=4326, inplace=True)
        elif gdf.crs.to_epsg() != 4326:
            gdf = gdf.to_crs(epsg=4326)
        return gdf
    
    raise TypeError(f"Unsupported geometry type: {type(geometry)}. "
                   "Expected: str/Path (file), GeoDataFrame, GeoSeries, or shapely Polygon/MultiPolygon")


def _create_cn_grid_from_data(
    lulc_data: xr.Dataset,
    soil_data: xr.Dataset,
    year: int,
    resolution: int
) -> Tuple[xr.DataArray, np.ndarray, Dict]:
    """
    Create CN grid from LULC and soil data.
    
    Internal function that combines land cover and soil properties
    to generate the Curve Number grid.
    """
    # Extract land cover
    cover_var = f'cover_{year}'
    lulc = lulc_data[cover_var]
    
    # Extract soil properties
    soil_vars = list(soil_data.data_vars)
    
    # Map to correct variable names (Polaris naming can vary)
    if 'sand_0_5cm_mean' in soil_vars:
        sand_da = soil_data['sand_0_5cm_mean']
        silt_da = soil_data['silt_0_5cm_mean']
        clay_da = soil_data['clay_0_5cm_mean']
        ksat_da = soil_data.get('ksat_0_5cm_mean', None)
    elif 'sand_5' in soil_vars:
        sand_da = soil_data['sand_5']
        silt_da = soil_data['silt_5']
        clay_da = soil_data['clay_5']
        ksat_da = soil_data.get('ksat_5', None)
    else:
        raise ValueError(f"Unexpected soil variable names: {soil_vars}")
    
    # Resample soil data to match LULC grid if needed
    if sand_da.shape != lulc.shape:
        print(f"  Resampling soil data from {sand_da.shape} to match LULC grid {lulc.shape}...")
        sand_da = sand_da.rio.reproject_match(lulc)
        silt_da = silt_da.rio.reproject_match(lulc)
        clay_da = clay_da.rio.reproject_match(lulc)
        if ksat_da is not None:
            ksat_da = ksat_da.rio.reproject_match(lulc)
    
    # Extract values
    sand = sand_da.values
    silt = silt_da.values
    clay = clay_da.values
    ksat = ksat_da.values if ksat_da is not None else None
    lulc_values = lulc.values
    
    # Classify soil hydrologic groups
    print("  Classifying soil hydrologic groups...")
    soil_groups, soil_stats = _classify_soil_hydrologic_group(sand, silt, clay, ksat)
    
    # Create CN lookup table
    cn_table = _create_cn_lookup_table()
    
    # Initialize CN grid
    cn_grid_values = np.full_like(lulc_values, np.nan, dtype=np.float32)
    
    # Apply lookup table
    print("  Applying CN lookup table...")
    for nlcd_class in np.unique(lulc_values[~np.isnan(lulc_values)]):
        nlcd_mask = (lulc_values == nlcd_class)
        for soil_group in range(1, 5):
            soil_mask = (soil_groups == soil_group)
            combined_mask = nlcd_mask & soil_mask
            
            # Get CN value from lookup table
            key = (int(nlcd_class), soil_group)
            if key in cn_table:
                cn_grid_values[combined_mask] = cn_table[key]
    
    # Create xarray DataArray
    cn_grid = xr.DataArray(
        cn_grid_values,
        coords=lulc.coords,
        dims=lulc.dims,
        attrs={
            'long_name': 'NRCS Curve Number',
            'units': 'dimensionless',
            'description': 'SCS Curve Number for AMC-II conditions',
            'source': 'NLCD land cover + Polaris soil data',
            'year': year,
            'resolution_m': resolution
        }
    )
    
    # Add CRS
    cn_grid.rio.write_crs(lulc.rio.crs, inplace=True)
    
    # Print statistics
    valid_cn = cn_grid_values[~np.isnan(cn_grid_values)]
    print(f"  CN Grid created:")
    print(f"    Mean: {valid_cn.mean():.1f}")
    print(f"    Range: {valid_cn.min():.0f} - {valid_cn.max():.0f}")
    
    return cn_grid, soil_groups, soil_stats


def _classify_soil_hydrologic_group(
    sand: np.ndarray,
    silt: np.ndarray,
    clay: np.ndarray,
    ksat: Optional[np.ndarray] = None
) -> Tuple[np.ndarray, Dict]:
    """
    Classify soils into NRCS hydrologic groups (A, B, C, D) based on texture.
    
    Internal function for soil classification.
    
    Returns
    -------
    soil_group : np.ndarray
        Soil hydrologic group as integers (1=A, 2=B, 3=C, 4=D)
    stats : dict
        Distribution statistics of soil groups
    """
    # Initialize with group D (most restrictive)
    soil_group = np.full_like(sand, 4, dtype=np.int32)
    
    # Group A: High sand content (>70%), low clay (<10%)
    mask_A = (sand > 70) & (clay < 10)
    soil_group[mask_A] = 1
    
    # Group B: Moderate sand (50-70%) or silt dominant with low clay
    mask_B = ((sand >= 50) & (sand <= 70) & (clay < 20)) | \
             ((silt > 50) & (clay < 27))
    soil_group[mask_B] = 2
    
    # Group C: Higher clay content (20-40%) or sandy clay loam
    mask_C = ((clay >= 20) & (clay < 40)) & (~mask_A) & (~mask_B)
    soil_group[mask_C] = 3
    
    # Group D: High clay content (>40%) - already initialized as 4
    
    # If ksat is available, refine classification
    if ksat is not None:
        # Very high infiltration -> Group A
        soil_group[ksat > 15] = 1
        # High infiltration -> Group B
        soil_group[(ksat > 5) & (ksat <= 15) & (soil_group > 2)] = 2
        # Moderate infiltration -> Group C
        soil_group[(ksat > 1.5) & (ksat <= 5) & (soil_group > 3)] = 3
        # Low infiltration (<1.5 cm/hr) -> Group D (already set)
    
    # Calculate statistics
    unique_groups, counts = np.unique(soil_group[~np.isnan(sand)], return_counts=True)
    group_names = {1: 'A', 2: 'B', 3: 'C', 4: 'D'}
    
    stats = {
        'soil_group_distribution': {},
        'soil_group_percentages': {}
    }
    
    print(f"    Soil group distribution:")
    for group, count in zip(unique_groups, counts):
        pct = 100 * count / counts.sum()
        group_name = group_names[int(group)]
        stats['soil_group_distribution'][group_name] = int(count)
        stats['soil_group_percentages'][group_name] = float(pct)
        print(f"      Group {group_name}: {pct:.1f}%")
    
    return soil_group, stats


def _create_cn_lookup_table() -> Dict[Tuple[int, int], int]:
    """
    Create NRCS Curve Number lookup table for NLCD classes and soil groups.
    
    Internal function - CN lookup table.
    
    Returns
    -------
    dict
        Dictionary mapping (NLCD_class, soil_group) -> CN value
    """
    cn_table = {}
    
    # NLCD classes and corresponding CN values for soil groups A, B, C, D
    nlcd_cn_values = {
        # Water (0% impervious assumed for wetlands)
        11: [100, 100, 100, 100],  # Open Water
        12: [100, 100, 100, 100],  # Perennial Ice/Snow
        
        # Developed (urban) areas
        21: [49, 69, 79, 84],  # Developed, Open Space (<20% impervious)
        22: [61, 75, 83, 87],  # Developed, Low Intensity (20-49% impervious)
        23: [72, 82, 88, 91],  # Developed, Medium Intensity (50-79% impervious)
        24: [89, 92, 94, 95],  # Developed, High Intensity (80-100% impervious)
        
        # Barren
        31: [77, 86, 91, 94],  # Barren Land (Rock/Sand/Clay)
        
        # Forest
        41: [36, 60, 73, 79],  # Deciduous Forest
        42: [36, 60, 73, 79],  # Evergreen Forest
        43: [36, 60, 73, 79],  # Mixed Forest
        
        # Shrubland/Grassland
        52: [35, 56, 70, 77],  # Shrub/Scrub
        71: [49, 69, 79, 84],  # Grassland/Herbaceous
        
        # Agriculture
        81: [67, 78, 85, 89],  # Pasture/Hay
        82: [67, 78, 85, 89],  # Cultivated Crops
        
        # Wetlands
        90: [80, 87, 93, 95],  # Woody Wetlands
        95: [80, 87, 93, 95],  # Emergent Herbaceous Wetlands
    }
    
    # Build lookup table for all combinations
    for nlcd_class, cn_values in nlcd_cn_values.items():
        for soil_group in range(1, 5):  # Groups A, B, C, D (1-4)
            cn_table[(nlcd_class, soil_group)] = cn_values[soil_group - 1]
    
    return cn_table


def _classify_cn_zones(cn_array: np.ndarray) -> Dict[str, float]:
    """
    Classify CN grid into runoff potential zones.
    
    Internal function for zone classification.
    """
    valid_cn = cn_array[~np.isnan(cn_array)]
    total_pixels = len(valid_cn)
    
    low_cn = np.sum(valid_cn < 70)
    medium_cn = np.sum((valid_cn >= 70) & (valid_cn <= 85))
    high_cn = np.sum(valid_cn > 85)
    
    return {
        'percent_low_cn': 100 * low_cn / total_pixels,
        'percent_medium_cn': 100 * medium_cn / total_pixels,
        'percent_high_cn': 100 * high_cn / total_pixels,
        'low_cn_interpretation': 'Low runoff potential - good infiltration',
        'medium_cn_interpretation': 'Moderate runoff potential',
        'high_cn_interpretation': 'High runoff potential - poor infiltration'
    }


def _create_static_visualization(
    cn_grid: xr.DataArray,
    watershed_gdf: gpd.GeoDataFrame,
    gauge_id: str
) -> plt.Figure:
    """
    Create static PNG visualization of CN grid.
    
    Internal function for visualization.
    """
    fig, ax = plt.subplots(figsize=(12, 10))
    
    # Plot CN grid
    im = cn_grid.plot(
        ax=ax,
        cmap='RdYlGn_r',  # Red (high CN) to Green (low CN)
        vmin=30,
        vmax=100,
        cbar_kwargs={'label': 'Curve Number', 'shrink': 0.8}
    )
    
    # Overlay watershed boundary
    watershed_gdf.boundary.plot(ax=ax, color='black', linewidth=2, label='Watershed')
    
    ax.set_title(f'Curve Number Grid - Gauge {gauge_id}', 
                 fontsize=14, fontweight='bold')
    ax.set_xlabel('Longitude')
    ax.set_ylabel('Latitude')
    ax.legend(loc='upper right')
    ax.grid(True, alpha=0.3)
    
    plt.tight_layout()
    
    return fig


def _create_interactive_map(
    cn_grid: xr.DataArray,
    watershed_gdf: gpd.GeoDataFrame,
    output_path: Path,
    gauge_id: str
) -> None:
    """
    Create interactive HTML map of CN grid using Folium.
    
    Internal function for interactive visualization.
    """
    # Get watershed center for map
    centroid = watershed_gdf.geometry.centroid.iloc[0]
    center_lat = centroid.y
    center_lon = centroid.x
    
    # Create base map
    m = folium.Map(
        location=[center_lat, center_lon],
        zoom_start=10,
        tiles='OpenStreetMap'
    )
    
    # Add watershed boundary
    folium.GeoJson(
        watershed_gdf.to_json(),
        name='Watershed Boundary',
        style_function=lambda x: {
            'fillColor': 'none',
            'color': 'black',
            'weight': 3
        }
    ).add_to(m)
    
    # Convert CN grid to image overlay (simplified approach)
    # Note: For production, consider using rasterio for proper georeferencing
    bounds = [
        [float(cn_grid.y.min()), float(cn_grid.x.min())],
        [float(cn_grid.y.max()), float(cn_grid.x.max())]
    ]
    
    # Add title
    title_html = f'''
    <div style="position: fixed; 
                top: 10px; left: 50px; width: 300px; height: 90px; 
                background-color: white; border:2px solid grey; z-index:9999; 
                font-size:14px; padding: 10px">
    <b>Curve Number Grid</b><br>
    Gauge ID: {gauge_id}<br>
    CN Range: {float(cn_grid.min().values):.0f} - {float(cn_grid.max().values):.0f}
    </div>
    '''
    m.get_root().html.add_child(folium.Element(title_html))
    
    # Add layer control
    folium.LayerControl().add_to(m)
    
    # Save map
    m.save(str(output_path))
