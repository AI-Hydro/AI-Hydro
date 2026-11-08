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

All basemaps work without an API token or account. CARTO basemaps were removed (2026-10-20): CARTO's keyless tiles now return an "API KEY REQUIRED" watermark for every request, and the extension holds no CARTO key.

### Hydrology default (muted)

New profiles open on a muted, global base (Esri Light Gray Canvas / Dark Gray Canvas, chosen by VS Code theme: light for light themes, dark for dark and high-contrast; zoom 0-16) with **vector rivers** drawn above it in both themes, so rivers and your layers carry the colour. Esri's item pages list World Light Gray Base and World Dark Gray Base as mature support, retiring in December 2029 (no day given).

**Where the rivers come from.**

- **From zoom 3 up:** the GEOGLOWS v2 global stream network (CC BY 4.0), streamed from GEOGLOWS's public S3 bucket as a PMTiles archive (about 2.4 GB, never downloaded whole). Only HTTP byte-range requests for the tiles in view are sent; no user data is sent. The map's content-security policy already allowed `https:` connections, so no new host was added.
- **Below zoom 3, and whenever the GEOGLOWS tiles cannot be reached:** the bundled Natural Earth 1:50m rivers and lakes (public domain, about 290 KB). They are coarse. When the stream fails after a few tries, the map says so ("River tiles could not be loaded ... Showing the coarse bundled Natural Earth rivers instead") with **Retry imagery**, and stops requesting river tiles until you retry. Natural Earth lakes also draw up to zoom 6 (the GEOGLOWS tiles have no water bodies).
- **Width and colour show Strahler order, not upstream area.** The GEOGLOWS tiles carry only a river id and the Strahler order, so order stands in for log upstream area (0.6 px at order 1 up to 4.2 px at order 10, one scale for every view). The network is TDX-Hydro (12 m source), whose orders run higher than a 90 m network's for the same river, so an order is not a fixed area. Smaller rivers appear as you zoom in (order 9 and up at world scale, everything from zoom 8).
- **Palettes** follow the design's styles S1 (light, pale violet to dark navy) and S2 (dark, dim blue to white, small reaches at half opacity). Both are single-hue ramps whose lightness rises (dark) or falls (light) monotonically with order, so they read under colour-vision deficiency and in greyscale.
- **Labels:** the rivers carry none. The base map's own place and water names are the only labels on the map, so nothing is drawn twice.
- **Credit:** "Rivers: GEOGLOWS ECMWF Streamflow Service (CC BY 4.0)" appears in the map credit once its tiles have loaded, "Natural Earth (public domain)" whenever the bundled tier is on screen, and map exports list both.

The old USGS raster overlay is still available as the **Gray + USGS rivers (US, light theme)** basemap: USGS National Map hydrography from zoom 8 in the United States, light theme only (it is cartography for a light map and carries its own river names).

Profiles saved by an older version are moved to this default **once**, and a saved choice that no longer exists (for example a CARTO basemap) is also moved to it, with a one-time notice saying why. After that your own choice always wins; **Reset to hydrology default** in the Basemap panel brings the default back.

### Hydrology-focused alternatives (United States coverage)

| Basemap | Best for |
|---|---|
| USGS Topo | Watershed context, roads, terrain names |
| USGS Imagery | Aerial / satellite verification |
| USGS Shaded Relief | Terrain hillshading |
| Esri Hillshade | High-resolution DEM shading |
| Esri Ocean | Bathymetry and coastal work |

The USGS caches are requested only inside US coverage (CONUS, Alaska, Hawaii, Puerto Rico/USVI; the western Aleutians and the Northwestern Hawaiian Islands are not included, so a view of only those reports no coverage). When the view is outside it, the map shows a notice ("USGS Topo covers the United States only, so no tiles are shown here.") with a **Use Hydrology default** button instead of a silently blank map. Every basemap is capped at the zoom its service serves (the last level is stretched rather than requesting missing tiles).

### General purpose

Esri World Topo · Esri World Imagery. Humanitarian OSM (HOT) was removed: OpenStreetMap France's usage page (https://www.openstreetmap.fr/usage/, read 2026-10-20) limits free use to non-profit sites and to apps that send an identifying user-agent, which an embedded webview cannot do. A saved HOT choice moves to the default with a notice.

If a basemap answers every tile in view with one identical image **and** returns that same image for a fixed land control tile (z3, 45-90E and 0-41N: Arabian Sea, Pakistan and India), a "Basemap unavailable" notice appears with the same switch button. The control matters: real sources repeat tiles over open ocean (Esri Gray Canvas ocean tiles at zoom 5-6 are byte-identical), so sameness in the view alone never raises the notice. The check is general, not tied to one provider, and stops hashing tiles once it has decided. If the control tile cannot be fetched (10 s timeout, HTTP or hashing error) nothing is claimed and it is not retried for that basemap.

A few missing tiles show a small status note; the "Map display incomplete" alert appears only when most tiles fail, can be dismissed, and offers **Retry imagery** (tile problems) or **Reload map renderer** (renderer problems).

> **Note on OpenStreetMap direct**: tile.openstreetmap.org is best-effort and requires an app-specific User-Agent and honoured cache headers, which an embedded webview cannot set, so it is not offered. The Esri basemaps are the general-purpose choice. Esri's item pages state the Esri Master License Agreement; this project has not verified that the agreement permits keyless use of services.arcgisonline.com in an application, so check Esri's current terms before relying on these basemaps in a published product.

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
| [Feature Inspector](map/inspector.md) | Click-to-inspect vector properties, run line and raster values; one action list for card and menu |
| [Hydrography & Gallery](map/hydrography.md) | MERIT rivers, WBD boundaries, gauges, dams; personal Gallery (save/import scenes, transects, annotations), bookmarks, community catalog |
| [Agent Integration](map/agent-integration.md) | Python bridge, show_on_map, agent orchestration tools, workspace persistence |
