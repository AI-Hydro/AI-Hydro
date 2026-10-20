---
description: The AI-Hydro map panel — GPU-accelerated geospatial visualization inside VS Code with full agent integration.
---

# Map Panel

The AI-Hydro map panel renders geospatial analysis outputs as interactive layers inside VS Code — watershed boundaries, TWI grids, gauge networks, GEE tiles, and any file you drop on the canvas appear here automatically. No copy-pasting coordinates into an external tool; no Mapbox token; no QGIS dependency.

The renderer is built on **deck.gl** (GPU-accelerated) and talks to the extension host over **gRPC streaming** so the map updates in real time as Python tools push layers.

---

## Opening the Map

Click the **Map** icon in the AI-Hydro activity bar, or run `AI-Hydro: Open Map` from the command palette (`Cmd+Shift+P`). The panel opens in editor column 2, side-by-side with the chat.

---

## Tool Ribbon

The right-edge ribbon provides quick access to every map tool. Click an icon to open its panel; click again to collapse. Only one panel is open at a time.

| Icon | Tool | Guide page |
|---|---|---|
| 🗺️ | Basemap | [Basemaps](#basemaps) |
| 📑 | Layers | [Layers & Symbology](map/layers.md) |
| 🧭 | Gallery (Mine / Starred / Community) | [Hydrography & Gallery](map/hydrography.md) |
| 🌊 | Hydrography | [Hydrography & Gallery](map/hydrography.md) |
| ⛶ | Fit extent | Zooms to all visible layers |
| 🔍 | Search | [Hydrography & Gallery](map/hydrography.md) |
| ✏️ | Draw | [Draw & Measure](map/draw-measure.md) |
| 📏 | Measure | [Draw & Measure](map/draw-measure.md) |
| 💬 | Annotations | [Smart Annotations](map/annotations.md) |
| 📈 | Transect | [Transect Profiles](map/transects.md) |
| ◩ | Swipe | [Swipe Comparison](map/swipe.md) |
| 🖼️ | Map Plate | [Map Plate Composer](map/map-plate.md) |

---

## Basemaps

All basemaps are free — no API token required.

### Hydrology default (muted)

New profiles open on a muted, label-free base (Carto Positron / Dark Matter no-labels, chosen by VS Code theme: light for light themes, dark for dark and high-contrast) so rivers and your layers carry the colour. Inside the United States the USGS National Map hydrography is drawn above it to emphasise rivers; elsewhere only the muted base is drawn. Attribution: © OpenStreetMap contributors © CARTO (plus USGS where the river overlay is in view).

Profiles saved by an older version are moved to this default **once**. After that your own choice always wins; **Reset to hydrology default** in the Basemap panel brings the default back.

### Hydrology-focused alternatives (United States coverage)

| Basemap | Best for |
|---|---|
| USGS Topo | Watershed context, roads, terrain names |
| USGS Imagery | Aerial / satellite verification |
| USGS Shaded Relief | Terrain hillshading |
| Esri Hillshade | High-resolution DEM shading |
| Esri Ocean | Bathymetry and coastal work |

The USGS caches are requested only inside a US envelope, and every basemap is capped at the zoom its service serves (the last level is stretched rather than requesting missing tiles).

### General purpose

Carto Voyager · Carto Dark · Carto Light · Esri World Topo · Esri World Imagery · Humanitarian (HOT).

A few missing tiles show a small status note; the "Map display incomplete" alert appears only when most tiles fail, can be dismissed, and offers **Retry imagery** (tile problems) or **Reload map renderer** (renderer problems).

> **Note on OpenStreetMap direct**: tile.openstreetmap.org disallows embedded-app traffic. Use Carto or HOT basemaps — both are OSM-derived and permit this use case.

---

## Map Status Bar

The bar at the bottom of the map shows:

| Element | Detail |
|---|---|
| **Scale bar** | Physical distance per pixel at current zoom and latitude |
| **Coordinates** | Cursor position — click to cycle between decimal (45.4981°N), DMS (45°29′53.2″N), and UTM |
| **Bearing indicator** | Compass needle; click to reset north |
| **Zoom controls** | +/– buttons |
| **Attribution** | Basemap source links (required by tile licences) |

---

## Feature Pages

| Page | What it covers |
|---|---|
| [Layers & Symbology](map/layers.md) | Loading files, layer types, symbology editor, GeoTIFF support, Python tool layers |
| [Draw & Measure](map/draw-measure.md) | Vector draw tool, measure distances and areas, ROI for analysis |
| [Smart Annotations](map/annotations.md) | Pins, polygons, notes, collections, batch agent analysis, multi-format export |
| [Transect Profiles](map/transects.md) | Profile charts, geomorphic metrics, overlay mode, batch analysis, export formats |
| [Swipe Comparison](map/swipe.md) | Side-by-side layer comparison with a draggable divider |
| [Map Plate Composer](map/map-plate.md) | Publication-quality map figures — templates, cartographic elements, print export |
| [Feature Inspector](map/inspector.md) | Click-to-inspect vector properties and raster values, Quick Delineate |
| [Hydrography & Gallery](map/hydrography.md) | MERIT rivers, WBD boundaries, gauges, dams; personal Gallery (save/import scenes, transects, annotations), bookmarks, community catalog |
| [Agent Integration](map/agent-integration.md) | Python bridge, show_on_map, agent orchestration tools, workspace persistence |
