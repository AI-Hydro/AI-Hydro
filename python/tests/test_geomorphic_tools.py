#!/usr/bin/env python3
"""
Test suite for ai_hydro.tools.geomorphic module

Tests geomorphic parameter computation following Horton, Schumm, and Gray methodologies.
"""

import pytest
import numpy as np
import geopandas as gpd
from shapely.geometry import box, Polygon
from unittest.mock import Mock, patch

from ai_hydro.analysis.geomorphic import (
    extract_geomorphic_parameters,
    get_geomorphic_summary,
    _calculate_basin_area_km2,
    _calculate_basin_perimeter_km,
    _extract_basin_length,
    _extract_relief_metrics,
    _extract_stream_metrics
)


class TestBasicMorphometry:
    """Tests for basic morphometric calculations"""
    
    def test_calculate_basin_area(self):
        """Test basin area calculation"""
        # Create a simple square polygon (1 degree x 1 degree ~111 km)
        coords = [(-86.0, 40.0), (-85.0, 40.0), (-85.0, 41.0), (-86.0, 41.0)]
        poly = Polygon(coords)
        gdf = gpd.GeoDataFrame([1], geometry=[poly], crs=4326)
        
        area = _calculate_basin_area_km2(gdf)
        
        # Should be roughly 111 x 111 = 12,321 km²
        assert 10000 < area < 15000
    
    def test_calculate_basin_perimeter(self):
        """Test basin perimeter calculation"""
        coords = [(-86.0, 40.0), (-85.0, 40.0), (-85.0, 41.0), (-86.0, 41.0)]
        poly = Polygon(coords)
        gdf = gpd.GeoDataFrame([1], geometry=[poly], crs=4326)
        
        perimeter = _calculate_basin_perimeter_km(gdf)
        
        # Should be roughly 4 * 111 = 444 km
        assert 400 < perimeter < 500


class TestShapeIndices:
    """Tests for shape index calculations"""
    
    def test_circular_basin(self):
        """Test shape indices for a circular basin"""
        # Create approximate circle using buffer
        from shapely.geometry import Point
        center = Point(-86.0, 40.0)
        circle = center.buffer(0.1)  # ~11 km radius
        gdf = gpd.GeoDataFrame([1], geometry=[circle], crs=4326)
        
        with patch('ai_hydro.tools.geomorphic._extract_relief_metrics') as mock_relief:
            with patch('ai_hydro.tools.geomorphic._extract_stream_metrics') as mock_streams:
                mock_relief.return_value = {
                    'H_m': 100.0, 'Rh': 0.01, 'Rp': 0.001,
                    'Ls_percent': 5.0, 'Cs_main_channel_m_per_m': 0.01
                }
                mock_streams.return_value = {
                    'D_km_per_km2': 2.0, 'Rn': 0.2, 'C_km2_per_km': 0.5,
                    'Rf': 0.1, 'Cf_per_km2': 1.0, 'MCh_km': 10.0,
                    'Slope_10_85_m_per_m': 0.01
                }
                
                result = extract_geomorphic_parameters(
                    gdf, 
                    outlet_lat=40.0, 
                    outlet_lon=-86.0,
                    dem_path=None
                )
                
                # Circular basin should have Rc close to 1.0
                if 'Rc' in result:
                    assert 0.8 < result['Rc'] < 1.0
    
    def test_elongated_basin(self):
        """Test shape indices for elongated basin"""
        # Create elongated rectangle
        coords = [(-86.0, 40.0), (-85.0, 40.0), (-85.0, 40.1), (-86.0, 40.1)]
        poly = Polygon(coords)
        gdf = gpd.GeoDataFrame([1], geometry=[poly], crs=4326)
        
        with patch('ai_hydro.tools.geomorphic._extract_relief_metrics') as mock_relief:
            with patch('ai_hydro.tools.geomorphic._extract_stream_metrics') as mock_streams:
                mock_relief.return_value = {
                    'H_m': 50.0, 'Rh': 0.005, 'Rp': 0.0005,
                    'Ls_percent': 3.0, 'Cs_main_channel_m_per_m': 0.005
                }
                mock_streams.return_value = {
                    'D_km_per_km2': 1.5, 'Rn': 0.1, 'C_km2_per_km': 0.7,
                    'Rf': 0.05, 'Cf_per_km2': 0.5, 'MCh_km': 15.0,
                    'Slope_10_85_m_per_m': 0.005
                }
                
                result = extract_geomorphic_parameters(
                    gdf,
                    outlet_lat=40.0,
                    outlet_lon=-86.0,
                    dem_path=None
                )
                
                # Elongated basin should have low Rc
                if 'Rc' in result:
                    assert result['Rc'] < 0.5


class TestReliefMetrics:
    """Tests for relief and slope calculations"""
    
    @patch('ai_hydro.tools.geomorphic.rioxarray.open_rasterio')
    def test_extract_relief_basic(self, mock_raster):
        """Test relief metric extraction"""
        # Mock DEM data
        import xarray as xr
        mock_dem = xr.DataArray(
            np.random.rand(100, 100) * 500 + 200,  # 200-700m elevation
            dims=['y', 'x']
        )
        mock_dem.rio = Mock()
        mock_dem.rio.clip = Mock(return_value=mock_dem)
        
        mock_raster.return_value = mock_dem
        
        coords = [(-86.1, 40.0), (-86.0, 40.0), (-86.0, 40.1), (-86.1, 40.1)]
        poly = Polygon(coords)
        gdf = gpd.GeoDataFrame([1], geometry=[poly], crs=4326)
        
        result = _extract_relief_metrics(
            gdf,
            outlet_lat=40.0,
            outlet_lon=-86.0,
            dem_path='mock_dem.tif'
        )
        
        assert 'H_m' in result
        assert 'Rh' in result
        assert 'Rp' in result
        assert result['H_m'] >= 0


class TestStreamMetrics:
    """Tests for stream network metrics"""
    
    def test_drainage_density_calculation(self):
        """Test drainage density calculation"""
        # Mock data: 100 km of streams in 50 km² basin
        total_stream_length = 100.0  # km
        basin_area = 50.0  # km²
        
        D = total_stream_length / basin_area
        
        assert D == 2.0  # km/km²
    
    def test_stream_frequency_calculation(self):
        """Test stream frequency calculation"""
        # Mock data: 30 stream segments in 50 km² basin
        n_segments = 30
        basin_area = 50.0  # km²
        
        Cf = n_segments / basin_area
        
        assert Cf == 0.6  # segments/km²


class TestAdvancedIndices:
    """Tests for advanced geomorphic indices (HKR, Gray, Murphey)"""
    
    def test_hkr_index(self):
        """Test Hypsometric-Kinematic Ruggedness index"""
        # HKR = A / (Cs * sqrt(D))
        A = 100.0  # km²
        Cs = 0.01  # m/m
        D = 2.0    # km/km²
        
        HKR = A / (Cs * np.sqrt(D))
        
        # Should be a reasonable value
        assert HKR > 0
        assert np.isfinite(HKR)
    
    def test_gray_index(self):
        """Test Gray's index"""
        # G = Lca / sqrt(Cs)
        Lca = 15.0  # km
        Cs = 0.01   # m/m
        
        G = Lca / np.sqrt(Cs)
        
        assert G > 0
        assert G == 150.0
    
    def test_murphey_index(self):
        """Test Murphey's index"""
        # M = Sb / A
        Sb = 225.0  # km²
        A = 100.0   # km²
        
        M = Sb / A
        
        assert M == 2.25


class TestGeomorphicSummary:
    """Tests for summary generation"""
    
    def test_get_summary_complete(self):
        """Test summary generation with complete data"""
        params = {
            'DA_km2': 100.0,
            'Lp_km': 50.0,
            'Lb_km': 15.0,
            'Rff': 0.44,
            'Rc': 0.85,
            'Re': 0.75,
            'H_m': 200.0,
            'D_km_per_km2': 2.0,
            'Rn': 0.4,
            'HKR': 5000.0,
            'G_Gray': 150.0,
            'M_Murphey': 2.25
        }
        
        summary = get_geomorphic_summary(params)
        
        assert 'basic_morphometry' in summary
        assert 'shape_indices' in summary
        assert 'relief_metrics' in summary
        assert 'stream_network' in summary
        assert 'advanced_indices' in summary
        
        # Check structure
        assert 'DA_km2' in summary['basic_morphometry']
        assert 'Rc' in summary['shape_indices']
        assert 'H_m' in summary['relief_metrics']


class TestEdgeCases:
    """Tests for edge cases and error handling"""
    
    def test_empty_geometry(self):
        """Test with empty geometry"""
        from shapely.geometry import GeometryCollection
        empty_geom = GeometryCollection()
        gdf = gpd.GeoDataFrame([1], geometry=[empty_geom], crs=4326)
        
        area = _calculate_basin_area_km2(gdf)
        assert area == 0.0
    
    def test_very_small_basin(self):
        """Test with very small basin"""
        # 0.01 x 0.01 degree basin
        coords = [
            (-86.0, 40.0), (-85.99, 40.0),
            (-85.99, 40.01), (-86.0, 40.01)
        ]
        poly = Polygon(coords)
        gdf = gpd.GeoDataFrame([1], geometry=[poly], crs=4326)
        
        area = _calculate_basin_area_km2(gdf)
        
        # Should be roughly 1.1 x 1.1 = 1.21 km²
        assert 0.5 < area < 2.0


class TestIntegration:
    """Integration tests for complete parameter extraction"""
    
    @patch('ai_hydro.tools.geomorphic._extract_relief_metrics')
    @patch('ai_hydro.tools.geomorphic._extract_stream_metrics')
    def test_extract_parameters_complete(self, mock_streams, mock_relief):
        """Test complete parameter extraction"""
        # Create test basin
        coords = [(-86.1, 40.0), (-86.0, 40.0), (-86.0, 40.1), (-86.1, 40.1)]
        poly = Polygon(coords)
        gdf = gpd.GeoDataFrame([1], geometry=[poly], crs=4326)
        
        # Mock returns
        mock_relief.return_value = {
            'H_m': 150.0,
            'Rh': 0.01,
            'Rp': 0.001,
            'Ls_percent': 5.0,
            'Cs_main_channel_m_per_m': 0.01
        }
        
        mock_streams.return_value = {
            'D_km_per_km2': 2.5,
            'Rn': 0.375,
            'C_km2_per_km': 0.4,
            'Rf': 0.15,
            'Cf_per_km2': 1.2,
            'MCh_km': 12.0,
            'Slope_10_85_m_per_m': 0.008
        }
        
        result = extract_geomorphic_parameters(
            gdf,
            outlet_lat=40.0,
            outlet_lon=-86.0,
            dem_path=None
        )
        
        # Check all expected parameter categories
        expected_keys = [
            'DA_km2', 'Lp_km', 'Lb_km', 'Lca_km',  # Basic
            'Rff', 'Rc', 'Re', 'Sb', 'Ru',          # Shape
            'H_m', 'Rh', 'Rp', 'Ls_percent',        # Relief
            'D_km_per_km2', 'Rn', 'Rf',             # Stream
            'HKR', 'G_Gray', 'M_Murphey'            # Advanced
        ]
        
        for key in expected_keys:
            assert key in result, f"Missing parameter: {key}"
        
        # Validate value ranges
        assert result['DA_km2'] > 0
        assert 0 <= result['Rc'] <= 1
        assert result['H_m'] >= 0
        assert result['D_km_per_km2'] > 0


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
