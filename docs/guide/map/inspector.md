---
description: Click anywhere on the map to inspect feature properties, raster values, and trigger AI analysis or watershed delineation.
---

# Feature Inspector

Click anywhere on the map canvas (outside of any active drawing tool) to open the **Feature Inspector**. The inspector shows what is at that exact point across all visible layers and provides one-click actions to start an agent workflow.

---

## What the Inspector Shows

| Section | Contents |
|---|---|
| **Title and kind** | The layer's name, then what was clicked: Gauge, River reach, Basin, Feature or Map point, with the click's coordinates |
| **Run line** | The tool and run that made the layer, with **Open** (opens the run in Replay). A MERIT, NWIS, WBD or NID layer no run made reads "Reference, not in any run" |
| **Properties** | The first six, then **Show all (N)**. Photos show as a strip |
| **Raster value** | Pixel value from the topmost visible analysis-ready raster at that point, with the layer name and units |

> **Raster readings require a local GeoTIFF with raw pixel values loaded.** Python-pushed preview PNGs and GEE tiles do not return per-pixel values. If the raster section is empty, open the layer's drawer, choose **Style** and **Load raster values**.

---

## Actions

The card and the right-click menu offer the same actions, under the same names (one list for both).

| Action | What it does |
|---|---|
| **Ask AI-Hydro** | With a chat open, adds your question and one reference line to that chat's input (nothing is cleared, and you press Send); with no chat open, starts one. The line looks like `[map-ref kind=basin layer=… run=… study=… at=lon,lat]` and names the layer, the run and the study of what you pointed at. If the layer is from another study than the chat's, the card says so |
| **Delineate** | Opens the chat and the agent delineates the watershed; the run is recorded. The tooltip says how it would be routed (NLDI first, hybrid or quick MERIT) |
| **...** menu | **Delineate without chat** (runs here on the MERIT flow-direction raster, best for small and medium basins), **Select** (add to the selection set), **Save as GeoJSON**, **Save as shapefile**, **Add pin**, **Measure from here**, **Copy coordinates**, **Remove layer** |

---

## Cursor Value Probe (Hover Mode)

While the Feature Inspector is not blocking, moving the cursor over the map shows a **live cursor value** in the Map Status Bar for the topmost visible analysis-ready raster — no click needed. This is useful for quickly scanning a raster for value ranges without recording a reading.

---

## Tips

- **Delineate without chat** (under `...`) is the quickest way to delineate a small or medium watershed: one click on the outlet, result in seconds. It records no run; use **Delineate** when the result must be reproducible
- Click a vector feature (watershed polygon, gauge point, MERIT river reach) to see all its properties before asking the agent about it — knowing the HUC8 code or gauge ID lets you write a more specific prompt
- If multiple vector layers overlap at a point, the inspector lists features from all of them — useful for checking whether a point falls inside a flood zone, a specific soil type, and a particular HUC simultaneously
- **Copy coordinates** (under `...`) copies the latitude and longitude in decimal degrees
