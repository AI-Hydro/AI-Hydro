"""
Forcing Data Module

This module provides tools for extracting, processing, and formatting hydrometeorological
forcing data for hydrological modeling, following CAMELS Part 2 methodology.

Key capabilities:
- Fetch basin-averaged climate forcing from GridMET
- Calculate multiple PET methods (Hargreaves, Penman-Monteith)
- Export forcing in model-ready formats
- Generate CAMELS-compatible time series

References:
    - Newman et al. (2015) - CAMELS forcing data
    - Hargreaves & Samani (1985) - Reference evapotranspiration
    - Allen et al. (1998) - FAO-56 Penman-Monteith
"""

from __future__ import annotations

import warnings
from typing import Tuple, Dict, Optional, Union
from pathlib import Path
import numpy as np
import pandas as pd

try:
    import xarray as xr
    import pygridmet as gridmet
    _DEPS_AVAILABLE = True
except ImportError:
    _DEPS_AVAILABLE = False

warnings.filterwarnings('ignore')


def fetch_forcing_data(
    watershed_geom,
    start_date: str,
    end_date: str,
    variables: Optional[list] = None
) -> pd.DataFrame:
    """
    Fetch basin-averaged daily forcing data from GridMET.
    
    Parameters
    ----------
    watershed_geom : shapely.geometry
        Watershed boundary geometry
    start_date : str
        Start date in YYYY-MM-DD format
    end_date : str
        End date in YYYY-MM-DD format
    variables : list, optional
        List of variables to fetch. Default: all available
        
    Returns
    -------
    pd.DataFrame
        Daily forcing data with columns for each variable
        
    Examples
    --------
    >>> from ai_hydro.tools.forcing import fetch_forcing_data
    >>> df = fetch_forcing_data(
    ...     watershed_geom,
    ...     '2010-01-01',
    ...     '2020-12-31'
    ... )
    >>> print(df.head())
    """
    if not _DEPS_AVAILABLE:
        raise ImportError("forcing data requires: pip install aihydro-tools[data]")
    try:
        print(f"Fetching GridMET forcing data from {start_date} to {end_date}...")
        
        # Default variables: all GridMET climate variables
        if variables is None:
            variables = ["pr", "tmmn", "tmmx", "srad", "vs", "sph", "pet"]
        
        # Fetch data
        ds = gridmet.get_bygeom(
            geometry=watershed_geom,
            dates=(start_date, end_date),
            variables=variables,
            crs="EPSG:4326"
        )
        
        print(f"✓ Retrieved {len(ds.time)} days of forcing data")
        
        # Calculate spatial mean (basin average)
        df_list = []
        for var in variables:
            if var in ds.data_vars:
                var_mean = ds[var].mean(dim=["lat", "lon"])
                series = var_mean.to_series()
                series.index = pd.to_datetime(series.index).tz_localize(None)
                df_list.append(series.rename(var))
        
        # Combine all variables
        df = pd.concat(df_list, axis=1)
        
        # Unit conversions to standard format
        if 'tmmn' in df.columns:
            df['tmmn'] = df['tmmn'] - 273.15  # K to °C
        if 'tmmx' in df.columns:
            df['tmmx'] = df['tmmx'] - 273.15  # K to °C
        if 'tmmn' in df.columns and 'tmmx' in df.columns:
            df['tavg'] = (df['tmmn'] + df['tmmx']) / 2  # Average temperature
        
        # Rename to CAMELS-style column names
        column_mapping = {
            'pr': 'prcp_mm',
            'tmmn': 'tmin_C',
            'tmmx': 'tmax_C',
            'tavg': 'tavg_C',
            'srad': 'srad_Wm2',
            'vs': 'wind_ms',
            'sph': 'sph_kgkg',
            'pet': 'pet_mm'
        }
        df = df.rename(columns={k: v for k, v in column_mapping.items() if k in df.columns})
        
        df.index.name = 'date'
        df = df.reset_index()
        
        print(f"✓ Processed forcing data: {len(df)} days, {len(df.columns)-1} variables")
        return df
        
    except Exception as e:
        print(f"✗ Error fetching forcing data: {str(e)}")
        return None


def calculate_pet_hargreaves(
    df: pd.DataFrame,
    latitude: float
) -> pd.DataFrame:
    """
    Calculate PET using Hargreaves-Samani method.
    
    Parameters
    ----------
    df : pd.DataFrame
        DataFrame with tmin_C, tmax_C columns
    latitude : float
        Watershed centroid latitude in decimal degrees
        
    Returns
    -------
    pd.DataFrame
        DataFrame with added pet_hargreaves_mm column
        
    References
    ----------
    Hargreaves & Samani (1985) - Reference crop evapotranspiration
    """
    try:
        print("Calculating Hargreaves-Samani PET...")
        
        # Require temperature columns
        if 'tmin_C' not in df.columns or 'tmax_C' not in df.columns:
            print("  Warning: Missing temperature columns, skipping Hargreaves PET")
            return df
        
        tavg = (df['tmin_C'] + df['tmax_C']) / 2
        tdiff = np.sqrt(np.maximum(df['tmax_C'] - df['tmin_C'], 0))
        
        # Extraterrestrial radiation approximation
        # If solar radiation available, use it; otherwise estimate
        if 'srad_Wm2' in df.columns:
            ra_approx = df['srad_Wm2'] * 0.0864 * 1.5  # W/m² to MJ/m²/day
        else:
            # Day of year for seasonal variation
            doy = pd.to_datetime(df['date']).dt.dayofyear
            # Simplified Ra estimation
            ra_approx = 15.0 + 10.0 * np.sin(2 * np.pi * (doy - 81) / 365)
        
        # Hargreaves-Samani equation
        # PET = 0.0023 * Ra * (Tavg + 17.8) * sqrt(Tmax - Tmin)
        df['pet_hargreaves_mm'] = 0.0023 * ra_approx * (tavg + 17.8) * tdiff
        
        # Ensure non-negative
        df['pet_hargreaves_mm'] = np.maximum(df['pet_hargreaves_mm'], 0)
        
        print(f"✓ Hargreaves PET calculated (mean: {df['pet_hargreaves_mm'].mean():.2f} mm/day)")
        return df
        
    except Exception as e:
        print(f"✗ Error calculating Hargreaves PET: {str(e)}")
        return df


def calculate_water_balance_metrics(df: pd.DataFrame) -> Dict[str, float]:
    """
    Calculate water balance statistics from forcing data.
    
    Parameters
    ----------
    df : pd.DataFrame
        Forcing data with prcp_mm and pet_mm columns
        
    Returns
    -------
    dict
        Water balance metrics
    """
    try:
        stats = {}
        
        # Require precipitation and PET
        if 'prcp_mm' not in df.columns or 'pet_mm' not in df.columns:
            print("  Warning: Missing prcp_mm or pet_mm, cannot compute water balance")
            return stats
        
        # Annual totals
        n_years = len(df) / 365.25
        stats['mean_annual_precip_mm'] = df['prcp_mm'].sum() / n_years
        stats['mean_annual_pet_mm'] = df['pet_mm'].sum() / n_years
        
        # Aridity index
        stats['aridity_index'] = stats['mean_annual_pet_mm'] / stats['mean_annual_precip_mm']
        
        # Temperature statistics
        if 'tavg_C' in df.columns:
            stats['mean_annual_temp_C'] = df['tavg_C'].mean()
        
        # Precipitation characteristics
        wet_days = (df['prcp_mm'] > 1.0).sum()
        stats['wet_days_per_year'] = wet_days / n_years
        stats['wet_day_frequency'] = wet_days / len(df)
        
        # Snow fraction (approximate: precip when temp <= 0°C)
        if 'tavg_C' in df.columns:
            snow_days = (df['tavg_C'] <= 0) & (df['prcp_mm'] > 0)
            stats['snow_fraction'] = df.loc[snow_days, 'prcp_mm'].sum() / df['prcp_mm'].sum()
        
        print(f"✓ Water balance metrics calculated")
        return stats
        
    except Exception as e:
        print(f"✗ Error calculating water balance: {str(e)}")
        return {}


def export_forcing_data(
    df: pd.DataFrame,
    gauge_id: str,
    output_dir: Union[str, Path],
    formats: list = ['csv', 'netcdf']
) -> Dict[str, str]:
    """
    Export forcing data in multiple formats for model compatibility.
    
    Parameters
    ----------
    df : pd.DataFrame
        Forcing data
    gauge_id : str
        Gauge identifier
    output_dir : str or Path
        Output directory
    formats : list
        List of formats to export: 'csv', 'netcdf', 'summa', 'vic'
        
    Returns
    -------
    dict
        Dictionary of {format: filepath} for exported files
    """
    try:
        print(f"Exporting forcing data in {len(formats)} format(s)...")
        
        output_dir = Path(output_dir)
        output_dir.mkdir(exist_ok=True, parents=True)
        
        exported_files = {}
        
        # CSV export
        if 'csv' in formats:
            csv_path = output_dir / f"{gauge_id}_forcing.csv"
            df.to_csv(csv_path, index=False)
            exported_files['csv'] = str(csv_path)
            print(f"  ✓ CSV: {csv_path}")
        
        # NetCDF export
        if 'netcdf' in formats:
            nc_path = output_dir / f"{gauge_id}_forcing.nc"
            ds = df.set_index('date').to_xarray()
            ds.to_netcdf(nc_path)
            exported_files['netcdf'] = str(nc_path)
            print(f"  ✓ NetCDF: {nc_path}")
        
        # SUMMA format (specialized format for SUMMA model)
        if 'summa' in formats:
            summa_path = output_dir / f"{gauge_id}_forcing_summa.txt"
            _export_summa_format(df, summa_path)
            exported_files['summa'] = str(summa_path)
            print(f"  ✓ SUMMA: {summa_path}")
        
        # VIC format
        if 'vic' in formats:
            vic_path = output_dir / f"{gauge_id}_forcing_vic.txt"
            _export_vic_format(df, vic_path)
            exported_files['vic'] = str(vic_path)
            print(f"  ✓ VIC: {vic_path}")
        
        print(f"✓ Forcing data exported successfully")
        return exported_files
        
    except Exception as e:
        print(f"✗ Error exporting forcing data: {str(e)}")
        return {}


def _export_summa_format(df: pd.DataFrame, filepath: Path):
    """Export forcing data in SUMMA model format"""
    # SUMMA expects: year, month, day, hour, prcp, temp, etc.
    df_copy = df.copy()
    df_copy['date'] = pd.to_datetime(df_copy['date'])
    df_copy['year'] = df_copy['date'].dt.year
    df_copy['month'] = df_copy['date'].dt.month
    df_copy['day'] = df_copy['date'].dt.day
    df_copy['hour'] = 12  # Assume daily data at noon
    
    cols = ['year', 'month', 'day', 'hour']
    if 'prcp_mm' in df_copy.columns:
        cols.append('prcp_mm')
    if 'tavg_C' in df_copy.columns:
        cols.append('tavg_C')
    if 'srad_Wm2' in df_copy.columns:
        cols.append('srad_Wm2')
    if 'wind_ms' in df_copy.columns:
        cols.append('wind_ms')
    
    df_copy[cols].to_csv(filepath, sep='\t', index=False, float_format='%.3f')


def _export_vic_format(df: pd.DataFrame, filepath: Path):
    """Export forcing data in VIC model format"""
    # VIC expects: prcp, tmax, tmin, wind
    df_copy = df.copy()
    
    cols = []
    if 'prcp_mm' in df_copy.columns:
        cols.append('prcp_mm')
    if 'tmax_C' in df_copy.columns:
        cols.append('tmax_C')
    if 'tmin_C' in df_copy.columns:
        cols.append('tmin_C')
    if 'wind_ms' in df_copy.columns:
        cols.append('wind_ms')
    
    df_copy[cols].to_csv(filepath, sep='\t', index=False, header=False, float_format='%.3f')


def create_forcing_dataset(
    watershed_geom,
    gauge_id: str,
    start_date: str,
    end_date: str,
    output_dir: Union[str, Path],
    latitude: Optional[float] = None,
    export_formats: list = ['csv']
) -> Tuple[pd.DataFrame, Dict[str, float], Dict[str, str]]:
    """
    Complete workflow: fetch, process, and export forcing data.
    
    Parameters
    ----------
    watershed_geom : shapely.geometry
        Watershed boundary
    gauge_id : str
        Gauge identifier
    start_date : str
        Start date YYYY-MM-DD
    end_date : str
        End date YYYY-MM-DD
    output_dir : str or Path
        Output directory
    latitude : float, optional
        Watershed latitude for PET calculation
    export_formats : list
        Export formats (default: ['csv'])
        
    Returns
    -------
    df : pd.DataFrame
        Forcing data
    stats : dict
        Water balance statistics
    files : dict
        Exported file paths
        
    Examples
    --------
    >>> from ai_hydro.tools.forcing import create_forcing_dataset
    >>> df, stats, files = create_forcing_dataset(
    ...     watershed_geom,
    ...     '03335000',
    ...     '2010-01-01',
    ...     '2020-12-31',
    ...     './forcing_output'
    ... )
    """
    try:
        print(f"\n{'='*60}")
        print(f"Creating forcing dataset for gauge {gauge_id}")
        print(f"Period: {start_date} to {end_date}")
        print(f"{'='*60}\n")
        
        # Step 1: Fetch forcing data
        df = fetch_forcing_data(watershed_geom, start_date, end_date)
        if df is None:
            raise ValueError("Failed to fetch forcing data")
        
        # Step 2: Calculate additional PET if latitude provided
        if latitude is not None:
            df = calculate_pet_hargreaves(df, latitude)
        
        # Step 3: Calculate water balance metrics
        stats = calculate_water_balance_metrics(df)
        
        # Step 4: Export data
        files = export_forcing_data(df, gauge_id, output_dir, export_formats)
        
        print(f"\n{'='*60}")
        print("Forcing dataset creation complete!")
        print(f"{'='*60}\n")
        
        return df, stats, files
        
    except Exception as e:
        print(f"✗ Error creating forcing dataset: {str(e)}")
        return None, {}, {}


def generate_forcing_summary(
    df: pd.DataFrame,
    stats: Dict[str, float],
    gauge_id: str
) -> str:
    """
    Generate human-readable summary of forcing data.
    
    Parameters
    ----------
    df : pd.DataFrame
        Forcing data
    stats : dict
        Water balance statistics
    gauge_id : str
        Gauge identifier
        
    Returns
    -------
    str
        Formatted summary text
    """
    summary = "\n" + "="*60 + "\n"
    summary += f"FORCING DATA SUMMARY - Gauge {gauge_id}\n"
    summary += "="*60 + "\n\n"
    
    summary += f"Time Period: {df['date'].iloc[0]} to {df['date'].iloc[-1]}\n"
    summary += f"Total Days: {len(df)}\n"
    summary += f"Variables: {', '.join([c for c in df.columns if c != 'date'])}\n\n"
    
    summary += "WATER BALANCE:\n"
    if 'mean_annual_precip_mm' in stats:
        summary += f"  Mean Annual Precipitation: {stats['mean_annual_precip_mm']:.1f} mm/year\n"
    if 'mean_annual_pet_mm' in stats:
        summary += f"  Mean Annual PET: {stats['mean_annual_pet_mm']:.1f} mm/year\n"
    if 'aridity_index' in stats:
        summary += f"  Aridity Index: {stats['aridity_index']:.2f}\n"
    if 'mean_annual_temp_C' in stats:
        summary += f"  Mean Annual Temperature: {stats['mean_annual_temp_C']:.1f} °C\n\n"
    
    summary += "PRECIPITATION CHARACTERISTICS:\n"
    if 'wet_days_per_year' in stats:
        summary += f"  Wet Days per Year: {stats['wet_days_per_year']:.0f}\n"
    if 'snow_fraction' in stats:
        summary += f"  Snow Fraction: {stats['snow_fraction']:.2f}\n\n"
    
    summary += "="*60 + "\n"

    return summary


def fetch_forcing_data_result(
    watershed_geojson: dict,
    start_date: str,
    end_date: str,
    gauge_id: Optional[str] = None,
    variables: Optional[list] = None,
) -> "HydroResult":
    """
    Fetch basin-averaged GridMET forcing data, returning a standardized HydroResult.

    Parameters
    ----------
    watershed_geojson : dict
        GeoJSON geometry dict (e.g. from delineate_watershed result).
    start_date : str
        Start date in YYYY-MM-DD format.
    end_date : str
        End date in YYYY-MM-DD format.
    gauge_id : str, optional
        Gauge ID for provenance metadata.
    variables : list, optional
        GridMET variable names to fetch. Default: all available.

    Returns
    -------
    HydroResult
        data keys: dates (ISO string list), plus one list per variable,
        plus water-balance summary stats (mean_annual_precip_mm, aridity_index, etc.)
    """
    from shapely.geometry import shape
    from ai_hydro.core import DataSource, HydroMeta, HydroResult, ToolError
    import numpy as np

    _TOOL_PATH = "ai_hydro.tools.forcing.fetch_forcing_data_result"
    _SOURCES = [
        DataSource(
            name="GridMET (Climatology Lab)",
            url="https://www.climatologylab.org/gridmet.html",
            citation=(
                "@article{abatzoglou2013development, "
                "title={Development of gridded surface meteorological data for "
                "ecological applications and modelling}, "
                "author={Abatzoglou, John T}, "
                "journal={International Journal of Climatology}, "
                "volume={33}, number={1}, pages={121--131}, year={2013}}"
            ),
        ),
    ]

    try:
        from ai_hydro import __version__

        watershed_geom = shape(watershed_geojson)
        df = fetch_forcing_data(
            watershed_geom=watershed_geom,
            start_date=start_date,
            end_date=end_date,
            variables=variables,
        )

        if df is None or df.empty:
            raise ToolError(
                code="NO_FORCING_DATA",
                message="fetch_forcing_data returned empty DataFrame",
                tool=_TOOL_PATH,
                recovery="Check date range and watershed geometry validity.",
            )

        # Build JSON-serializable dict
        clean: dict = {}

        # Dates as ISO strings
        if "date" in df.columns:
            clean["dates"] = [str(d) for d in df["date"]]
        else:
            clean["dates"] = [str(d) for d in df.index]

        # Each variable column as float list (NaN → None)
        var_cols = [c for c in df.columns if c != "date"]
        for col in var_cols:
            vals = df[col].tolist()
            clean[col] = [
                (float(v) if (v is not None and np.isfinite(float(v))) else None)
                for v in vals
            ]

        clean["n_days"] = len(df)
        clean["variables"] = var_cols

        # Summary stats
        pr_col = next((c for c in var_cols if c in ("pr", "precipitation")), None)
        pet_col = next((c for c in var_cols if c in ("pet", "potential_evapotranspiration")), None)
        tmmn_col = "tmmn" if "tmmn" in var_cols else None
        tmmx_col = "tmmx" if "tmmx" in var_cols else None

        if pr_col:
            annual_pr = float(df[pr_col].sum() / (len(df) / 365.25))
            clean["mean_annual_precip_mm"] = round(annual_pr, 2)
        if pet_col:
            annual_pet = float(df[pet_col].sum() / (len(df) / 365.25))
            clean["mean_annual_pet_mm"] = round(annual_pet, 2)
        if pr_col and pet_col and clean.get("mean_annual_precip_mm", 0) > 0:
            clean["aridity_index"] = round(
                clean["mean_annual_pet_mm"] / clean["mean_annual_precip_mm"], 3
            )
        if tmmn_col and tmmx_col:
            mean_k = float((df[tmmn_col].mean() + df[tmmx_col].mean()) / 2)
            clean["mean_annual_temp_C"] = round(mean_k - 273.15, 2)

        return HydroResult(
            data=clean,
            meta=HydroMeta(
                tool=_TOOL_PATH,
                version=__version__,
                gauge_id=gauge_id,
                sources=_SOURCES,
                params={
                    "start_date": start_date,
                    "end_date": end_date,
                    "variables": variables or "all",
                },
            ),
        )

    except ToolError:
        raise
    except Exception as exc:
        raise ToolError(
            code="FORCING_FETCH_FAILED",
            message=str(exc),
            tool=_TOOL_PATH,
            recovery=(
                "Ensure watershed_geojson is a valid GeoJSON polygon and "
                "dates are in YYYY-MM-DD format. "
                "Install forcing extras: pip install 'ai-hydro[forcing]'"
            ),
        ) from exc
