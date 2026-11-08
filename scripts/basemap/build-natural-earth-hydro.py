"""Builds webview-ui/src/components/map/rivers/naturalEarthHydro.json from Natural Earth 1:50m shapefiles.

Natural Earth is public domain (https://www.naturalearthdata.com/about/terms-of-use/). Inputs:
  ne_50m_rivers_lake_centerlines  (featurecla == "River"; canals and lake centrelines are dropped)
  ne_50m_lakes
Download them from https://www.naturalearthdata.com/downloads/50m-physical-vectors/ and pass the folder, or use the
copy cartopy caches in ~/.local/share/cartopy/shapefiles/natural_earth/physical/ (the default).

Run:  python -I scripts/basemap/build-natural-earth-hydro.py [shapefile-dir]

Output (compact, coordinates rounded to 2 decimals = about 1 km, lines simplified at 0.02 degrees):
  { "rivers": [[scalerank, [lon0, lat0, lon1, lat1, ...]], ...],
    "lakes":  [[[ring0 flat], [hole flat], ...], ...] }
scalerank 1 is the largest river class. Names are not shipped: our own river labels are not drawn (the base map
carries the one set of labels).
"""

import json
import os
import sys

import geopandas as gpd
from shapely.geometry import MultiLineString, MultiPolygon

src = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/.local/share/cartopy/shapefiles/natural_earth/physical/")
out = os.path.join(os.path.dirname(__file__), "..", "..", "webview-ui", "src", "components", "map", "rivers", "naturalEarthHydro.json")


def flat(coords):
    pts = []
    for x, y in coords:
        pts += [round(x, 2), round(y, 2)]
    return pts


rivers = gpd.read_file(os.path.join(src, "ne_50m_rivers_lake_centerlines.shp"))
rivers = rivers[(rivers.featurecla == "River") & rivers.geometry.notna()]
lakes = gpd.read_file(os.path.join(src, "ne_50m_lakes.shp"))
lakes = lakes[lakes.geometry.notna()]

river_rows = []
for _, row in rivers.iterrows():
    geom = row.geometry.simplify(0.02)
    parts = geom.geoms if isinstance(geom, MultiLineString) else [geom]
    for part in parts:
        if part.is_empty or len(part.coords) < 2:
            continue
        river_rows.append([int(row.scalerank), flat(part.coords)])

lake_rows = []
for _, row in lakes.iterrows():
    geom = row.geometry.simplify(0.02)
    polys = geom.geoms if isinstance(geom, MultiPolygon) else [geom]
    for poly in polys:
        if poly.is_empty or poly.area < 0.01:
            continue
        lake_rows.append([flat(poly.exterior.coords)] + [flat(r.coords) for r in poly.interiors if r.length > 0.3])

with open(out, "w") as fh:
    json.dump({"rivers": river_rows, "lakes": lake_rows}, fh, separators=(",", ":"))
print(f"{len(river_rows)} river parts, {len(lake_rows)} lake polygons, {os.path.getsize(out)} bytes -> {out}")
