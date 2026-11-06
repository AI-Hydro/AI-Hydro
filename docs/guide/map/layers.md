---
description: Manage, style, and inspect every layer type on the AI-Hydro map — rasters, vectors, GEE tiles, and more.
---

# Layers & Symbology

The **Layers panel** (📑) is the central control surface for everything on the map canvas. Open it from the Tool Ribbon on the right edge.

---

## Loading Layers

| Method | How |
|---|---|
| **Drag-and-drop** | Drop any supported file directly onto the map canvas |
| **+ Add Layer…** | File picker in the Layers panel — filtered to supported formats |
| **🔗 URL** | Load from a remote GeoJSON, tile endpoint, or direct file link |
| **Explorer right-click** | Right-click a geospatial file → *Add to AI-Hydro Map* |
| **Python tools** | Analysis tools push layers automatically over the gRPC stream |

### Supported Formats

| Format | Extensions | Notes |
|---|---|---|
| GeoJSON | `.geojson`, `.json` | FeatureCollection, Feature, or bare Geometry |
| TopoJSON | `.topojson`, `.json` | Converted via `topojson-client` |
| KML | `.kml` | Placemarks, paths, and polygons |
| KMZ | `.kmz` | ZIP extracted, inner KML parsed |
| GPX | `.gpx` | Track points and routes |
| Shapefile | `.zip` | Must contain `.shp + .dbf + .shx`; `.prj` recommended |
| GeoTIFF | `.tif`, `.tiff` | Single-band raster; see [GeoTIFF](#geotiff-support) below |
| CSV | `.csv` | Auto-detects `lon`/`lat`/`longitude`/`latitude`/`x`/`y` columns |

---

### Project files: On the map and Not on the map

Opening the map does not register every GeoJSON/KML/… file in the folder as a layer. Each map file of the open folders appears **once**: under **On the map** as its layer row, or under **Not on the map**, a collapsed section below it with the header `Not on the map · N files`. **Load** moves a file up to On the map and **Unload** moves it back down; a file is never in both places. After either, the row that moved is marked for a moment in its new place (an outline; a fade too when your system allows motion) and the status line says where it went (`Loaded x. It moved up to On the map.`, `Unloaded x. It is now under Not on the map.`). Hover the name of a project file's row on the map to see its folder path. The section is a flat list for 20 files or fewer and collapsed folders above that (a root row per folder in a multi-root window); a filter box appears above 10 files, and the list is virtualised, so thousands of rows stay fast. It lists up to 5,000 files and says `5,000+` when the scan stopped there; removing files from the list does not bring in the ones beyond the limit. The section opens by itself only when the map has no layers and there are files to load; open or closed is remembered.

- **Load** shows the size on the row, asks first above 20 MB (the largest layer the map already keeps across a restart; larger files can leave the window unresponsive while they are read), and offers **Zoom to**; the camera fits the file when the map was empty. GeoTIFF and KMZ load through the map panel's own parser.
- **Unload** keeps the layer's name, style, opacity and place in a sidecar file (`map_unloaded_layers.<hash>.json` beside the layer catalog, not in it), so loading the file again gives it back. It keeps no run link: a loaded file reads `Not linked to a run`. Undo is in the status line.
- **Remove from list** (row menu, folder menu, `Remove N matches` from the filter, and `Unload and remove from list` on an On the map row) hides a file or folder in this list **on this machine**. It never touches the file: no code of the feature deletes, moves or renames anything. The entry is stored per project in the extension's global state as a folder hash plus a relative path (never an absolute path). Undo is in the status line for 10 seconds; after that **Removed from list (N)**, the last row of the section, lists the entries with **Restore** and **Restore all**.
- **What is scanned.** `.aihydro/` (the tools' own output) is never listed, and `files.exclude` is merged with the built-in skip list (`node_modules`, `.git`, `.worktrees`, `_archive`, `dist`, `build`, virtualenvs, `env`, `.tox`, `site-packages`, `.ipynb_checkpoints`, `.cache`, `target`); the section says `N folders skipped` (the top level of each folder; hover for the names) and how many symlinks it met and how many lead outside the folder and are not listed. A `.json` file is judged from its first 8 KB. Scans are debounced, and the list refreshes when the window regains focus or the layers change. A file counts as on the map when a layer was made from it, compared by real path, so a symlinked folder does not show it as loadable. A multi-root window has one removed list for the project; the same relative path in two folders stays two rows.
- **Authorised paths.** Every path the map panel opens, reads or loads passes one check (`authorizeMapPath`): inside an open folder, inside AI-Hydro's own directories, or a file the user chose (Add file, the Explorer menu). A file already on the map can be reloaded or opened; a path from a scene or a message that fits none of these is refused. Loading a GeoTIFF or KMZ from the list accepts only a file of the current scan. Converted layers are written under the source's own folder in `.aihydro/map-derived`, named with a short hash of the source path, and never replace another source's provenance.

The ribbon badge counts **visible** layers; its tooltip reads "N visible · M hidden". Layers restored from an earlier session are scoped to the current workspace and capped at the 40 most recent; older layers are kept on disk (never dropped) and the panel offers **Restore older layers (N)** to load them. The old unscoped `map_layer_catalog.json` is imported once, by the first workspace that opens it; a `map_layer_catalog.migrated` marker records that, and no other workspace imports it. After that the unscoped file is a **mirror of the active workspace's catalog**, rewritten atomically on every catalog write, because the agent's map layer tools (aihydro-tools) still read it. The mirror can be removed once aihydro-tools reads the scoped catalogs. Before the first mirror write, the previous unscoped file is copied byte-for-byte to `map_layer_catalog.legacy-backup.json` (never overwritten); if that copy fails the unscoped file is left untouched. "No layers yet" appears only after restore has finished.

---

## Layer Types & Icons

| Icon | Layer type |
|---|---|
| ● | Point |
| 〰 | Line |
| ⬡ | Polygon |
| ▦ | Raster (local GeoTIFF) |
| ◉ | GEE tile layer |
| ◈ | Other / unknown |

---

## Source Badges

| Badge | Source |
|---|---|
| 📁 | Workspace file |
| 🐍 | Python tool output |
| 📥 | User-loaded (drag-and-drop / file picker) |
| 🛰 | Google Earth Engine layer |
| 📤 | Pushed via extension API |

---

## Performance & Large Files

AI-Hydro is optimised to stay responsive when many or large layers are loaded simultaneously.

### What happens under the hood

| Situation | How it's handled |
|---|---|
| Opening a large GeoJSON or CSV | Parsed in a **Web Worker** off the main thread — the map stays interactive during load |
| Pan / zoom with many layers | Geometry is tessellated once and reused; deck.gl skips GPU re-upload when nothing changed |
| Opacity or style change | Color accessors update without rebuilding geometry |
| File with > 2 million coordinates | Worker applies **automatic grid-snap simplification** before adding the layer |

### The "simplified" badge

If a loaded file contains more than 2 million coordinates (e.g., a high-density river network or continental-scale polygon set), the layer is automatically simplified before display:

- Coordinates are snapped to a grid sized to ~1/10 000 of the data extent (minimum 1 × 10⁻⁵°, roughly 1 m at the equator).
- Adjacent duplicate vertices are removed. **Point features are never touched.**
- A blue **simplified** badge appears in the layer row. Hover over it to see the original and reduced coordinate counts.

The simplified version is display-only — the source file on disk is not modified.

> **When does this matter?** At typical screen resolutions, sub-metre coordinate differences are sub-pixel. Simplification has no visible effect on the map but can reduce a 5 M-coordinate watershed delineation to < 500 K, cutting GPU tessellation time by 10×.

---

## Status Pills

Each layer row shows a coloured pill describing its analysis readiness:

| Status | Meaning |
|---|---|
| **Analysis-ready raster** | GeoTIFF with raw pixel values loaded — colormap editable, value probing active, profile charts work |
| **Visual preview raster** | Pre-rendered PNG from Python — display only, no per-pixel analysis |
| **Remote raster** | GEE tile or URL-loaded image |
| **Reference vector** | MERIT / WBD boundary layer |
| **Analysis output** | Vector produced by a Python tool |

A warning icon appears on a row when its file changed and the layer did not follow it (see [A layer follows its file](#a-layer-follows-its-file)).

> **Profile charts and cursor readings require an analysis-ready raster.** If the value probe shows nothing, open Symbology and click **Load raster values**.

---

## Per-Layer Controls

Each action lives in one place. Click a layer's name to open its drawer; the `...` menu holds the rest.

| Where | Control | Action |
|---|---|---|
| Row | Eye | Show or hide the layer |
| Row | Grip | Drag to reorder |
| Drawer | Opacity slider | Layer opacity |
| Drawer | **Style** | Symbology editor; **Cluster points** for point layers |
| Drawer | **Attributes** | Attribute table (vector layers) |
| Drawer | **Details** | Overview, Data and Provenance. The run and tool names copy from here |
| `...` menu | Zoom to layer, Rename on map | Rename on map sets the name shown on the map; the file is not renamed |
| `...` menu | **Save as…** | A workspace file, or a GeoJSON download |
| `...` menu | Open file | Only when the layer has a source file |
| Drawer | **Use new file** | Only on a layer with a run (or another evidence link) whose file changed. It asks first, then replaces the content and removes the link |
| `...` menu and Details | **Open run** | Opens the run that made the layer in Replay. Shown only when the layer records both its study and its run |
| Details, Provenance | Open provenance record | When the layer has one |
| `...` menu | Move up, Move down | Render order |
| `...` menu | **Unload**, Unload and remove from list | For a file in the project list; the file stays on disk and Undo appears |
| `...` menu | Remove layer | For a layer with no file in the project list (inline, Earth Engine, outside the project); source file not deleted; Undo appears |

Layers are grouped by what they are, not by how they got there: **Results** (made by a tool run, even if saved in the workspace; Details shows the path), **Files** (any file from disk, in the workspace or not; `Not linked to a run`), **Reference data**, **Earth Engine**. One file is one layer: adding a file that is already on the map (same source path, else the same content) selects the existing layer and says so, and layers from two different runs are never merged. **Reference data** holds MERIT rivers, WBD boundaries, NWIS gauges and NID dams that no run made: they are labelled "Reference, not in any run" and are not from a recorded run. The same layer made by a study's run sits under Results instead.

Show all and Hide all are in the Layers panel `...` menu. The Provenance tab lists what is recorded and ends with one "Not recorded: ..." line for the facts that are not.

### A layer follows its file

A layer that names a file follows it. There is no Reload button.

- **A layer with no run** (a file you loaded, or one an agent wrote that no run recorded) is updated in place when its file changes on disk: same row, name, style, visibility and place in the stack, and the camera does not move. The drawer keeps a line, `Updated from the file on disk at 14:03:09.`, and the status line says so once. The map reads exactly the bytes it hashed; a file caught part-way through a write is tried once more after a second, then the layer says `Could not read the new version: ...` and keeps the last good copy.
- **A layer with an evidence link** (a run, a study, a tool or a claim) never changes by itself. Its row gets a warning icon and the drawer says `The file changed after this run. The map still shows the run's result.` **Use new file** replaces the content after one question, and removes the link, because the new content did not come from that run. A layer that holds no saved copy says `The map draws the file as it is now, so it may not match.` instead of claiming one.
- **A file that is gone** keeps the last loaded copy and says `File not found: ...`. A file replaced in one step (save by rename, delete then create) is waited for and never shows as gone.
- **Raster layers** (GeoTIFF) are not re-read in place: they say the file changed and to load it again.
- It looks when a watcher says something changed, when the map opens, and when the map panel is shown again. A watcher can drop events (network drives promise none), so the look on show is the backstop. While the map is closed nothing is read or drawn; the next open finds every change.
- Only files the map was allowed to load are watched: inside an open folder, in AI-Hydro's own folders, or picked this session with Add file or the Explorer. A path that arrived in a map scene is never watched.

### Renaming

Double-click a layer name to rename it inline. The new name is saved to `display_name` metadata and reflected everywhere — including the live legend and Map Plate Composer.

### Opacity

Each visible layer shows an opacity slider (0–100%) below the name row. Rasters blend against the basemap; vector layers multiply against stroke and fill alpha.

---

## Global Controls

| Control | Action |
|---|---|
| **Show all / Hide all** | Toggle all layers at once |
| **+ Add Layer…** | Open file picker |
| **🔗 URL** | Load from URL |
| **💾 Save scene** | Persist full layer stack, styles, view, and source references |
| **📂 Open scene** | Restore a previously saved map scene |
| **ⓘ** | Toggle metadata detail rows for all layers |
| **Clear all layers** | Remove all layers (with confirmation) |

---

## Layer Reordering

Drag a layer row using its ⠿ gripper, or use ↑/↓ buttons, to change render order. **Layers lower in the list render on top.** This controls which raster is sampled by transect profiles and the cursor value probe.

---

## Point Clustering

For dense point networks (USGS gauges, precipitation stations), open the layer's drawer, choose **Style** and tick **Cluster points**. Points within the same grid cell at low zoom are aggregated into a single marker sized by count.

---

## Symbology Editor

Click a layer's colour swatch or the 🎨 icon to open the inline editor.

### Vector Layers

| Control | Effect |
|---|---|
| Fill colour | Feature fill (HTML colour picker) |
| Fill opacity | 0–1 slider |
| Stroke colour | Feature outline colour |
| Stroke width | Outline thickness (pixels) |

### Raster Layers

| Control | Effect |
|---|---|
| Status badge | Shows analysis-ready vs visual preview |
| **Value histogram** | 40-bin SVG histogram from raw pixel data; bars coloured with the active colormap |
| Colormap | viridis · viridis_r · plasma · magma · cividis · Blues · YlOrRd · RdYlGn |
| Opacity | 0–1 slider |
| **Load raster values** | Hydrates raw pixel data (unlocks colormap editing and per-pixel analysis) |

The histogram is only shown for analysis-ready rasters. Switching colormaps instantly recolors the histogram bars to match.

---

## Graduated (Choropleth) Symbology

For vector layers, click **By Attribute** to open the graduated symbology editor:

1. Select a **numeric attribute** from the layer's feature properties
2. Choose a **classification method**: Natural Breaks, Equal Interval, or Quantile
3. Pick a **colour ramp**: viridis, YlOrRd, Blues, RdYlGn, or custom stops
4. Set the **number of classes** (2–7)
5. Click **Apply** — breaks and colours are stored in layer metadata and re-applied on every render

The map legend updates automatically to show the colour ramp and class boundaries.

---

## GeoTIFF Support

GeoTIFFs are decoded with **geotiff.js** entirely in-browser — no server round-trip.

### Supported CRS

| EPSG | Name |
|---|---|
| 4326, 4269, 4152 | WGS84 / NAD83 geographic — rendered directly |
| 3857, 900913 | Web Mercator — pixel-warped to WGS84 |
| 5070, 102003 | CONUS Albers (NLCD, POLARIS, 3DEP) — pixel-warped |
| 26901–26960 | NAD83 UTM zones 1–60 — pixel-warped |
| 32601–32660 | WGS84 UTM zones North — pixel-warped |
| 32701–32760 | WGS84 UTM zones South — pixel-warped |
| 26701–26760 | NAD27 UTM — pixel-warped |
| 25801–25860 | ETRS89 UTM — pixel-warped |

Warping uses bilinear interpolation; output is capped at 512 px on the long axis. Unsupported CRSs return a clear error — reproject to EPSG:4326 first using `gdalwarp` or QGIS.

---

## Layers from Python Analysis Tools

| Tool | Layer pushed | Type |
|---|---|---|
| `delineate_watershed` | Watershed boundary polygon + outlet point | Vector |
| `compute_twi` | TWI grid (viridis_r, 70% opacity) | Raster |
| `create_cn_grid` | Curve Number grid (YlOrRd, 70% opacity) | Raster |
| `show_on_map` | Any GeoJSON you pass | Vector |
| `gee.preview_layer` | Google Earth Engine tile mosaic | GEE tile |
| `merit_add_map_layers` | MERIT river network for a basin | Vector |
| `wbd_add_map_layers` | WBD HUC boundaries | Vector |
