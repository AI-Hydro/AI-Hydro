---
description: How the AI agent reads and updates the map — orchestration tools, the Python bridge, show_on_map, and how layers flow from Python to the canvas.
---

# Agent & Python Integration

The AI-Hydro map is not a passive viewer — the agent can read the full map state, push new layers, re-style existing ones, control the viewport, and execute analysis that feeds results directly back to the canvas.

---

## How Layers Flow from Python to the Map

When a Python tool calls any map-aware MCP function, the events travel through this pipeline:

1. The MCP tool calls `ai_hydro.mcp.map_events.push_layer(layer)` on the server side
2. The server writes a small JSON event file to `~/.aihydro/map_events/`
3. The VS Code extension file-watcher picks it up (~600 ms polling interval), calls `controller.addMapLayer()`, and deletes the file
4. The controller forwards the layer over the **gRPC `MapService.subscribeToMapLayers` stream**
5. `MapContext` in the webview receives the stream event and updates React state — deck.gl re-renders

For GEE tile layers, the Python tool computes the tile URL template using `geemap` and passes it in `metadata.gee_tile_url_template`. The map fetches tiles directly from the GEE Maps API (requires an authenticated GEE session on the Python side).

---

## Analysis Tools That Push Layers Automatically

| Tool | Layer pushed | Type |
|---|---|---|
| `delineate_watershed` | Watershed boundary polygon + outlet point | Vector |
| `compute_twi` | TWI grid (viridis_r, 70% opacity) | Raster |
| `create_cn_grid` | Curve Number grid (YlOrRd, 70% opacity) | Raster |
| `show_on_map` | Any GeoJSON you pass | Vector |
| `gee.preview_layer` | Google Earth Engine tile mosaic | GEE tile |
| `merit_add_map_layers` | MERIT river network for a basin | Vector |
| `wbd_add_map_layers` | WBD HUC boundaries | Vector |

---

## `show_on_map`

Push any geometry from a Python analysis session directly to the map:

```python
show_on_map(
    geojson=my_geojson_string,   # FeatureCollection / Feature / Geometry
    name="Study Area",
    layer_type="polygon",        # polygon | line | point
    style_preset="watershed",    # watershed | flowlines | gauge | default
    auto_zoom=True,
)
```

### Style presets

| Preset | Fill colour | Stroke | Use for |
|---|---|---|---|
| `watershed` | `#1a6eb5` (20% opacity) | `#003399` 2 px | Catchment polygons |
| `flowlines` | transparent | `#3399ff` 1.5 px | River / stream lines |
| `gauge` | `#e05c00` | `#993300` 1 px | Station point markers |
| `default` | `#0066CC` | `#003399` 1 px | General purpose |

---

## Agent Map Orchestration Tools

The agent can read and update the live map state using these MCP tools — without the user needing to do anything manually.

### Reading map state

```
map_get_state      → basemap, view centre/zoom, active ROI, full layer catalog
map_list_layers    → layer catalog only (IDs, names, types, styles, numeric attributes)
```

### Updating existing layers

```
map_update_layer(layer_id, fill_color, stroke_color, opacity, display_name, visible)
map_apply_symbology(layer_id, graduated_attribute, method, classes, color_ramp)
map_remove_layer(layer_id)
```

### Viewport control

```
map_fit_extent            → fit all visible layers
map_fit_layer(layer_id)   → fit a specific layer
map_set_basemap(id)       → change the active basemap
```

> **Do not** write a second GeoJSON file just to re-style a layer that is already on the map. Use `map_update_layer` for style changes; use `show_on_map` only when adding **new** geometry.

---

## Agent Workflows Triggered from the Map

Several map panels send context directly to the agent chat, pre-loading all the spatial information the agent needs:

| Source | What is sent |
|---|---|
| **Feature Inspector → Ask AI-Hydro** (a new chat; with a chat open it adds a `[map-ref …]` line to the input instead) | Click coordinates, all visible layer names and types, vector feature properties at that point, raster pixel value |
| **Feature Inspector → Delineate** | Click coordinates with a pre-filled delineation instruction |
| **Annotations → Ask Agent** | Annotation geometry, My Notes, AI Prompt, visible layer list |
| **Annotations → Batch Ask Agent** | Full collection as a coordinate/geometry/notes table |
| **Transects → Ask Agent** | Waypoints, full 200-point profile, geomorphic metrics, sampled layer name/units |
| **Transects → Batch Ask Agent** | Collection as a CSV table with per-transect profile statistics |

---

## From the chat to the map

A tool card whose run made layers that are on the map shows **On map (N)**, and a claim whose run evidence made layers shows **Show on map (N)** in its popover. Either one opens the map, shows those layers and selects the first in the Layers panel. The map moves its view only when you have not touched it for 5 seconds; otherwise it says the view did not move. The layers are matched by the run id recorded on each layer, so a layer with no run record is never linked.

## Camera, Run-Output and Time Control

Three further agent tools write command files that the extension's `MapCommandWatcher` validates against a bounded schema (`mapCommandSchema`) before acting on them:

| Tool | Effect |
|---|---|
| `map_fly_to` | Animated camera move to a longitude/latitude (zoom 0–24, duration capped at 60 s) |
| `map_add_layer_from_run` | Adds a GeoJSON run output as a provenance-tagged layer (run id and session id kept in the layer metadata) and optionally zooms to it |
| `map_set_time_range` | Sets the shared time brush (ISO-8601 start/end) that drives the time slider |

Commands that fail validation (out-of-range coordinates, oversized strings, unparseable timestamps) are rejected and logged rather than applied.

---

## Workspace Persistence

Map state survives panel close, VS Code restart, and extension updates. The following are saved to `localStorage` under `aihydro.map.workspace.v1`:

- Selected basemap
- View state (longitude, latitude, zoom, pitch, bearing)
- Visible layer IDs
- Per-layer opacity overrides
- Layer display name aliases
- Clustering-enabled layer IDs
- Ribbon panel dimensions

Annotations are saved separately under `aihydro.map.annotations.v1`. Transects are saved under `aihydro.map.transects.v1`.

---

## Tips

- Use `map_list_layers` in an agent prompt to let the agent discover the current layer catalog before deciding what analysis to run — avoids "layer not found" errors from stale IDs
- The `style_preset` in `show_on_map` is the fastest way to enforce consistent styling across all delineation outputs — all watershed polygons in the same session get the same blue fill
- After a batch transect analysis, the agent can call `map_apply_symbology` on any vector layer in the response to immediately visualize the results (e.g. colour-code HUC polygons by peak discharge)
- The file-watcher polling interval is ~600 ms — for rapid sequential tool calls the map may update in bursts rather than one layer at a time
