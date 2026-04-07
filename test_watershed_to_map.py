#!/usr/bin/env python3
"""
Test script: Watershed Delineation to Map Display
Demonstrates the complete workflow from Python tool to map visualization
"""

import json
from ai_hydro.tools.watershed import delineate_watershed

def main():
    # Step 1: Delineate watershed using AI-Hydro tool
    print("Delineating watershed for USGS gauge 01031500...")
    gauge_id = '01031500'
    
    result = delineate_watershed(gauge_id, save_shapefile=False)
    
    # Step 2: Display results
    print(f"\n✅ Watershed Delineated Successfully!")
    print(f"   Area: {result['area_km2']:.1f} km²")
    
    # Check what keys are available
    print(f"   Available data: {', '.join(result.keys())}")
    
    # Step 3: Convert geometry to GeoJSON
    # The result contains a GeoDataFrame, convert it to GeoJSON
    gdf = result['gdf']
    geojson = json.loads(gdf.to_json())
    
    print(f"\n📊 GeoJSON Structure:")
    print(f"   Type: {geojson['type']}")
    print(f"   Features: {len(geojson.get('features', []))}")
    if geojson['features']:
        print(f"   Geometry Type: {geojson['features'][0]['geometry']['type']}")
    
    # Step 4: Save GeoJSON to file for map testing
    output_file = 'watershed_01031500.geojson'
    with open(output_file, 'w') as f:
        json.dump(geojson, f, indent=2)
    
    print(f"\n💾 Saved to: {output_file}")
    
    # Step 5: Display what would be sent to map
    print(f"\n🗺️  Map Layer Info:")
    print(f"   ID: watershed_{gauge_id}")
    print(f"   Name: Watershed {gauge_id}")
    print(f"   Layer Type: polygon")
    print(f"   Style: Blue (#0066CC), 60% opacity")
    
    print(f"\n✨ Next steps:")
    print(f"   1. This GeoJSON can now be sent to the map via gRPC")
    print(f"   2. The MapView component will display it")
    print(f"   3. Layer controls allow toggling visibility")
    
    return result

if __name__ == "__main__":
    main()
