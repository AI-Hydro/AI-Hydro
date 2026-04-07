#!/usr/bin/env python3
"""
Test suite for ai_hydro.tools.climate module

Tests climate data extraction and index computation following CAMELS methodology.
"""

import pytest
import numpy as np
import pandas as pd
import xarray as xr
from datetime import datetime
from shapely.geometry import box
from unittest.mock import Mock, patch

from ai_hydro.tools.climate import (
    fetch_climate_data,
    extract_climate_indices,
    compute_seasonality,
    compute_snow_fraction,
    compute_extreme_precipitation_stats,
    calculate_pet_hargreaves
)


class TestClimateDataFetch:
    """Tests for climate data fetching"""
    
    def test_fetch_climate_data_basic(self):
        """Test basic climate data fetching structure"""
        # Create mock geometry (small test area)
        geom = box(-86.9, 40.4, -86.8, 40.5)
        
        # Mock the gridmet call
        with patch('ai_hydro.tools.climate.gridmet') as mock_gridmet:
            # Create mock dataset
            dates = pd.date_range('2020-01-01', '2020-01-10', freq='D')
            mock_ds = xr.Dataset({
                'pr': xr.DataArray(np.random.rand(10, 2, 2), 
                                   coords={'time': dates, 'lat': [40.4, 40.5], 'lon': [-86.9, -86.8]}),
                'tmmn': xr.DataArray(np.random.rand(10, 2, 2) * 20 + 273.15,
                                     coords={'time': dates, 'lat': [40.4, 40.5], 'lon': [-86.9, -86.8]}),
                'tmmx': xr.DataArray(np.random.rand(10, 2, 2) * 20 + 283.15,
                                     coords={'time': dates, 'lat': [40.4, 40.5], 'lon': [-86.9, -86.8]}),
                'pet': xr.DataArray(np.random.rand(10, 2, 2) * 5,
                                    coords={'time': dates, 'lat': [40.4, 40.5], 'lon': [-86.9, -86.8]})
            })
            mock_gridmet.get_bygeom.return_value = mock_ds
            
            result = fetch_climate_data(geom, '2020-01-01', '2020-01-10')
            
            assert result is not None
            assert isinstance(result, xr.Dataset)
            assert 'tavg' in result.variables


class TestSeasonalityComputation:
    """Tests for seasonality index computation"""
    
    def test_compute_seasonality_synthetic(self):
        """Test seasonality with synthetic sinusoidal data"""
        # Create synthetic data with known seasonality
        doy = np.arange(1, 366)
        dates = pd.date_range('2020-01-01', periods=365)
        
        # Perfect sine wave: max in summer (day 180), min in winter
        temp = 15 + 10 * np.sin(2 * np.pi * (doy - 90) / 365.25)
        prcp = 3 + 2 * np.sin(2 * np.pi * (doy - 180) / 365.25)
        
        result = compute_seasonality(temp, prcp, dates.values)
        
        assert 'p_seasonality' in result
        assert 'temp_seasonality' in result
        assert isinstance(result['temp_seasonality'], (int, float))
        assert np.isfinite(result['temp_seasonality'])
        # Temperature amplitude should be close to 10
        assert 8 < abs(result['temp_seasonality']) < 12
    
    def test_compute_seasonality_flat_data(self):
        """Test seasonality with flat (no seasonal variation) data"""
        dates = pd.date_range('2020-01-01', periods=365)
        temp = np.full(365, 15.0)  # constant temperature
        prcp = np.full(365, 3.0)   # constant precipitation
        
        result = compute_seasonality(temp, prcp, dates.values)
        
        # Should return valid results even for flat data
        assert 'p_seasonality' in result
        assert 'temp_seasonality' in result


class TestSnowFraction:
    """Tests for snow fraction computation"""
    
    def test_compute_snow_fraction_all_rain(self):
        """Test with all rain (warm temperatures)"""
        temp = np.full(365, 15.0)  # always above freezing
        prcp = np.random.rand(365) * 10
        
        result = compute_snow_fraction(temp, prcp)
        
        assert result == 0.0
    
    def test_compute_snow_fraction_all_snow(self):
        """Test with all snow (cold temperatures)"""
        temp = np.full(365, -5.0)  # always below freezing
        prcp = np.random.rand(365) * 10
        
        result = compute_snow_fraction(temp, prcp)
        
        assert result == 1.0
    
    def test_compute_snow_fraction_mixed(self):
        """Test with mixed rain/snow"""
        temp = np.concatenate([
            np.full(180, 15.0),   # warm half
            np.full(185, -5.0)    # cold half
        ])
        prcp = np.ones(365) * 2.0  # uniform precipitation
        
        result = compute_snow_fraction(temp, prcp)
        
        # Should be approximately 0.5 (half the year below freezing)
        assert 0.45 < result < 0.55


class TestExtremePrecipitation:
    """Tests for extreme precipitation statistics"""
    
    def test_extreme_precip_basic(self):
        """Test extreme precipitation with synthetic data"""
        dates = pd.date_range('2020-01-01', periods=365)
        prcp = np.ones(365) * 2.0  # baseline 2 mm/day
        
        # Add some extreme events (5x mean = 10 mm/day)
        prcp[50:53] = 12.0   # 3-day event
        prcp[200:202] = 11.0 # 2-day event
        
        result = compute_extreme_precipitation_stats(prcp, dates.values)
        
        assert 'high_prec_freq' in result
        assert 'high_prec_dur' in result
        assert 'high_prec_timing' in result
        assert result['high_prec_freq'] > 0
        assert 2 <= result['high_prec_dur'] <= 3  # average of 3-day and 2-day events
    
    def test_extreme_precip_no_extremes(self):
        """Test with no extreme events"""
        dates = pd.date_range('2020-01-01', periods=365)
        prcp = np.ones(365) * 2.0  # uniform, no extremes
        
        result = compute_extreme_precipitation_stats(prcp, dates.values)
        
        assert result['high_prec_freq'] == 0.0
        assert np.isnan(result['high_prec_dur'])


class TestHargreavesPET:
    """Tests for Hargreaves-Samani PET calculation"""
    
    def test_calculate_pet_hargreaves_basic(self):
        """Test basic Hargreaves PET calculation"""
        df = pd.DataFrame({
            'tmin_C': np.random.rand(365) * 10 + 5,
            'tmax_C': np.random.rand(365) * 10 + 20,
            'srad_Wm2': np.random.rand(365) * 200 + 100
        })
        latitude = 40.0
        
        result = calculate_pet_hargreaves(df, latitude)
        
        assert 'pet_hargreaves_mm' in result.columns
        assert len(result) == 365
        assert result['pet_hargreaves_mm'].notna().all()
        assert (result['pet_hargreaves_mm'] > 0).all()


class TestClimateIndicesIntegration:
    """Integration tests for full climate indices extraction"""
    
    def test_extract_climate_indices_complete(self):
        """Test complete climate indices extraction with mock data"""
        # Create mock climate dataset
        dates = pd.date_range('2000-01-01', '2020-12-31', freq='D')
        n_days = len(dates)
        
        # Create seasonal patterns
        doy = dates.dayofyear
        temp_seasonal = 15 + 10 * np.sin(2 * np.pi * (doy - 90) / 365.25)
        prcp_seasonal = 3 + 2 * np.sin(2 * np.pi * (doy - 180) / 365.25)
        
        mock_ds = xr.Dataset({
            'tavg': xr.DataArray(temp_seasonal, coords={'time': dates}),
            'pr': xr.DataArray(prcp_seasonal, coords={'time': dates}),
            'pet': xr.DataArray(np.ones(n_days) * 4.0, coords={'time': dates})
        })
        
        # Mock to return spatial mean directly
        mock_ds['tavg'] = mock_ds['tavg'].expand_dims({'lat': [40.0], 'lon': [-86.0]})
        mock_ds['pr'] = mock_ds['pr'].expand_dims({'lat': [40.0], 'lon': [-86.0]})
        mock_ds['pet'] = mock_ds['pet'].expand_dims({'lat': [40.0], 'lon': [-86.0]})
        
        with patch('ai_hydro.tools.climate.gridmet') as mock_gridmet:
            mock_gridmet.get_bygeom.return_value = mock_ds
            
            from ai_hydro.tools.climate import compute_climate_indices
            result, units = compute_climate_indices(mock_ds)
            
            # Check all expected indices
            expected_indices = [
                'p_mean', 'pet_mean', 'temp_mean', 'aridity',
                'p_seasonality', 'temp_seasonality', 'frac_snow',
                'high_prec_freq', 'high_prec_dur', 'high_prec_timing',
                'low_prec_freq', 'low_prec_dur', 'low_prec_timing',
                'prec_intensity'
            ]
            
            for idx in expected_indices:
                assert idx in result, f"Missing index: {idx}"
                assert idx in units, f"Missing unit for: {idx}"
            
            # Validate ranges
            assert result['p_mean'] > 0
            assert result['pet_mean'] > 0
            assert result['aridity'] > 0
            assert -1 <= result['p_seasonality'] <= 1
            assert 0 <= result['frac_snow'] <= 1


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
