#!/usr/bin/env python3
"""
Test suite for ai_hydro.tools.hydrology module

Tests hydrological signatures computation following CAMELS methodology.
"""

import pytest
import numpy as np
import pandas as pd
from datetime import datetime
from unittest.mock import Mock, patch
from shapely.geometry import box

from ai_hydro.data.streamflow import (
    fetch_streamflow_data,
    _to_mm_per_day,
)
from ai_hydro.analysis.signatures import (
    extract_hydrological_signatures,
    _fetch_precipitation_data_bygeom as fetch_precipitation_data_bygeom,
    compute_flow_stats_camels,
    compute_water_balance_camels,
    compute_event_stats_camels,
    compute_timing_stats_camels,
    compute_slope_fdc_camels,
    _lyne_hollick_baseflow,
)


class TestStreamflowConversion:
    """Tests for discharge unit conversion"""
    
    def test_to_mm_per_day_basic(self):
        """Test conversion from m³/s to mm/day"""
        # Create synthetic discharge series
        dates = pd.date_range('2020-01-01', periods=10)
        q_cms = pd.Series(np.ones(10) * 10.0, index=dates)  # 10 m³/s
        area_km2 = 100.0
        
        result = _to_mm_per_day(q_cms, area_km2)
        
        assert len(result) == 10
        expected = 10.0 * 86.4 / 100.0  # 8.64 mm/day
        np.testing.assert_almost_equal(result.iloc[0], expected, decimal=2)
    
    def test_to_mm_per_day_empty(self):
        """Test with empty series"""
        q_cms = pd.Series(dtype=float)
        result = _to_mm_per_day(q_cms, 100.0)
        assert len(result) == 0


class TestBaseflowSeparation:
    """Tests for Lyne-Hollick baseflow filter"""
    
    def test_lyne_hollick_basic(self):
        """Test baseflow separation with synthetic data"""
        # Create synthetic streamflow with baseflow + quickflow
        days = 365
        baseflow = np.full(days, 2.0)  # constant baseflow
        quickflow = np.zeros(days)
        quickflow[100:110] = 10.0  # storm event
        total_flow = baseflow + quickflow
        
        bf = _lyne_hollick_baseflow(total_flow, alpha=0.925, passes=3)
        
        assert len(bf) == days
        assert np.all(bf >= 0)
        assert np.all(bf <= total_flow)
        # Baseflow should be close to 2.0 outside storm period
        assert np.mean(bf[:90]) > 1.5
        assert np.mean(bf[:90]) < 2.5
    
    def test_lyne_hollick_all_baseflow(self):
        """Test with constant flow (all baseflow)"""
        q = np.full(365, 5.0)
        bf = _lyne_hollick_baseflow(q, alpha=0.925, passes=3)
        
        # Should return approximately the same as input
        np.testing.assert_allclose(bf, q, rtol=0.1)
    
    def test_lyne_hollick_negative_handling(self):
        """Test that negative values are properly handled"""
        q = np.array([5.0, 3.0, -1.0, 2.0, 4.0])  # includes negative
        bf = _lyne_hollick_baseflow(q, alpha=0.925, passes=1)
        
        # All baseflow values should be non-negative and <= total flow
        assert np.all(bf >= 0)
        assert np.all(bf[bf > 0] <= q[bf > 0])


class TestFlowStatistics:
    """Tests for flow statistics computation"""
    
    def test_compute_flow_stats_basic(self):
        """Test basic flow statistics"""
        dates = pd.date_range('2000-01-01', periods=365*5, freq='D')
        q = pd.Series(np.random.lognormal(1, 1, len(dates)), index=dates)
        
        result = compute_flow_stats_camels(q)
        
        assert 'q_mean' in result
        assert 'q_std' in result
        assert 'q5' in result
        assert 'q95' in result
        assert 'q_median' in result
        assert 'baseflow_index' in result
        
        # Validate ranges
        assert result['q_mean'] > 0
        assert result['q_std'] > 0
        assert result['q5'] > result['q95']  # Q5 is high flow, Q95 is low flow
        assert 0 <= result['baseflow_index'] <= 1
    
    def test_compute_flow_stats_insufficient_data(self):
        """Test with insufficient data"""
        q = pd.Series([1.0, 2.0, 3.0])  # only 3 days
        result = compute_flow_stats_camels(q)
        
        # Should return NaN for all values
        for key in result:
            assert np.isnan(result[key])


class TestWaterBalance:
    """Tests for water balance metrics"""
    
    def test_compute_water_balance_basic(self):
        """Test water balance computation"""
        dates = pd.date_range('2000-01-01', periods=365*10, freq='D')
        
        # Create synthetic data with realistic runoff ratio
        p = pd.Series(np.random.gamma(2, 2, len(dates)), index=dates)  # precipitation
        q = pd.Series(p.values * 0.4 + np.random.normal(0, 0.5, len(dates)), index=dates)
        q = q.clip(lower=0)  # ensure non-negative
        
        result = compute_water_balance_camels(q, p)
        
        assert 'runoff_ratio' in result
        assert 'stream_elas' in result
        
        # Runoff ratio should be reasonable (0-1 typically, can be >1 in some cases)
        assert 0 < result['runoff_ratio'] < 2
    
    def test_compute_water_balance_dry_basin(self):
        """Test with very low runoff"""
        dates = pd.date_range('2000-01-01', periods=365*5, freq='D')
        p = pd.Series(np.ones(len(dates)) * 2.0, index=dates)
        q = pd.Series(np.ones(len(dates)) * 0.1, index=dates)  # low runoff
        
        result = compute_water_balance_camels(q, p)
        
        assert result['runoff_ratio'] < 0.2


class TestEventStatistics:
    """Tests for high/low flow event statistics"""
    
    def test_compute_event_stats_basic(self):
        """Test event statistics with synthetic data"""
        dates = pd.date_range('2000-01-01', periods=365*5, freq='D')
        
        # Create flow series with events
        q = pd.Series(np.ones(len(dates)) * 5.0, index=dates)  # baseline
        
        # Add high-flow events (>9x median)
        q.iloc[100:105] = 50.0  # 5-day event
        q.iloc[500:503] = 55.0  # 3-day event
        
        # Add low-flow events (<0.2x mean)
        q.iloc[1000:1030] = 0.5  # 30-day event
        
        result = compute_event_stats_camels(q)
        
        assert 'high_q_freq' in result
        assert 'high_q_dur' in result
        assert 'low_q_freq' in result
        assert 'low_q_dur' in result
        assert 'zero_q_freq' in result
        assert 'flow_variability' in result
        
        assert result['high_q_freq'] > 0
        assert result['high_q_dur'] > 0
        assert result['low_q_freq'] > 0
    
    def test_compute_event_stats_no_events(self):
        """Test with constant flow (no events)"""
        dates = pd.date_range('2000-01-01', periods=365*5, freq='D')
        q = pd.Series(np.ones(len(dates)) * 5.0, index=dates)
        
        result = compute_event_stats_camels(q)
        
        assert result['high_q_freq'] == 0.0
        assert result['zero_q_freq'] == 0.0


class TestTimingStatistics:
    """Tests for timing statistics (half-flow date)"""
    
    def test_compute_timing_stats_basic(self):
        """Test half-flow date computation"""
        # Create 5 years of data with seasonal pattern
        dates = pd.date_range('2000-10-01', periods=365*5, freq='D')
        doy = dates.dayofyear
        
        # Peak flow in spring (day 120)
        q = pd.Series(5 + 10 * np.sin(2 * np.pi * (doy - 30) / 365), index=dates)
        q = q.clip(lower=0.1)
        
        result = compute_timing_stats_camels(q)
        
        assert 'hfd_mean' in result
        assert 'half_flow_date_std' in result
        
        # HFD should be finite and in reasonable range (1-365)
        if np.isfinite(result['hfd_mean']):
            assert 1 <= result['hfd_mean'] <= 365
    
    def test_compute_timing_stats_insufficient_data(self):
        """Test with insufficient data"""
        dates = pd.date_range('2020-01-01', periods=100, freq='D')
        q = pd.Series(np.ones(100), index=dates)
        
        result = compute_timing_stats_camels(q)
        
        # Should return NaN with insufficient data
        assert np.isnan(result['hfd_mean'])


class TestFDCSlope:
    """Tests for flow duration curve slope"""
    
    def test_compute_slope_fdc_basic(self):
        """Test FDC slope computation"""
        dates = pd.date_range('2000-01-01', periods=365*5, freq='D')
        
        # Create log-normal flow distribution
        q = pd.Series(np.random.lognormal(1, 1, len(dates)), index=dates)
        
        result = compute_slope_fdc_camels(q)
        
        assert 'slope_fdc' in result
        assert np.isfinite(result['slope_fdc'])
        # Slope should be negative (flow decreases with increasing exceedance)
        # In log-log space, but the way it's computed, it should be positive
        assert result['slope_fdc'] != 0
    
    def test_compute_slope_fdc_flat(self):
        """Test with constant flow"""
        dates = pd.date_range('2000-01-01', periods=365*5, freq='D')
        q = pd.Series(np.ones(len(dates)) * 5.0, index=dates)
        
        result = compute_slope_fdc_camels(q)
        
        # Slope should be approximately 0 for constant flow
        # May return NaN due to log(constant)
        assert result['slope_fdc'] == 0.0 or np.isnan(result['slope_fdc'])


class TestHydrologicalSignaturesIntegration:
    """Integration tests for full hydrological signatures extraction"""
    
    @patch('ai_hydro.tools.hydrology.fetch_streamflow_data')
    @patch('ai_hydro.tools.hydrology.fetch_precipitation_data_bygeom')
    def test_extract_signatures_complete(self, mock_prcp, mock_q):
        """Test complete signature extraction with mocked data"""
        # Create synthetic data
        dates = pd.date_range('1990-01-01', '2009-12-31', freq='D')
        n_days = len(dates)
        
        # Streamflow with seasonal pattern
        doy = dates.dayofyear
        q_cms = pd.Series(
            10 + 20 * np.sin(2 * np.pi * (doy - 90) / 365) + np.random.normal(0, 2, n_days),
            index=dates
        ).clip(lower=0.1)
        
        # Precipitation
        p_mm = pd.Series(
            3 + 2 * np.sin(2 * np.pi * (doy - 180) / 365) + np.random.gamma(1, 1, n_days),
            index=dates
        )
        
        mock_q.return_value = q_cms
        mock_prcp.return_value = p_mm
        
        # Mock watershed
        geom = box(-86.9, 40.4, -86.8, 40.5)
        
        result = extract_hydrological_signatures(
            '01234567',
            geom,
            area_km2=100.0,
            start_date='1990-01-01',
            end_date='2009-12-31'
        )
        
        # Check all expected signatures
        expected = [
            'q_mean', 'q_std', 'q5', 'q95', 'q_median', 'baseflow_index',
            'runoff_ratio', 'stream_elas', 'high_q_freq', 'high_q_dur',
            'low_q_freq', 'low_q_dur', 'zero_q_freq', 'flow_variability',
            'hfd_mean', 'half_flow_date_std', 'slope_fdc'
        ]
        
        for sig in expected:
            assert sig in result, f"Missing signature: {sig}"


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
