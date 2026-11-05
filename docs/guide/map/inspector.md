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
| **Gauge** (a gauge only) | USGS site, name, drainage area and period of record when the layer reports them (otherwise "not reported"), and a link to the USGS monitoring-location page |
| **Trace** (a gauge only) | A distance (1 to 200 km, 50 by default) and **Upstream** and **Downstream** buttons, then every trace of this gauge already on the map. See [Trace upstream and downstream](#trace-upstream-and-downstream) |
| **Properties** | The first six, then **Show all (N)**. Photos show as a strip |
| **Raster value** | Pixel value from the topmost visible analysis-ready raster at that point, with the layer name and units |

> **Raster readings require a local GeoTIFF with raw pixel values loaded.** Python-pushed preview PNGs and GEE tiles do not return per-pixel values. If the raster section is empty, open the layer's drawer, choose **Style** and **Load raster values**.

---

## Trace upstream and downstream

From a gauge card, **Upstream** or **Downstream** with a distance asks the agent to run `gauge_flowlines`. The map does not run the tool itself: the request goes into the chat as one line (or starts a chat), you send it, and you approve the tool call as for any other tool. The card then says it is waiting; **Stop waiting** forgets the request without cancelling anything in the chat.

The result is a layer in **Results**, and it belongs to the run that made it (**Open run** in its Layers row menu, or **Open** on the card of a clicked trace line). The card describes it from the facts recorded on the layer: gauge, direction, distance, the number of flowlines, and whether the tool cut it. The tool keeps at most 750 flowlines per direction, and says when it stopped there. The card reads nothing from the layer's name or file name, so a layer from an older tools server shows "not recorded" for what it cannot say, and the map's waiting state does not end for it. Source is always "NLDI navigation over NHDPlus V2". The card treats the facts as recorded only on a layer that names a run and carries the `_fact_keys` stamp the host writes when it adds a layer from a run (every other add loses the stamp, and no edit can change it; a layer you restore with Undo after removing it keeps it, because the host remembers its last 20 removals; undoing a clear-all, or a removal older than those 20, reads "not recorded"). This is a convention, not a signature: a layer catalog file edited on disk can still forge it. A map scene opened from a file never brings the stamp in, so a trace layer opened from a scene reads "not recorded" for gauge, direction, distance, count and cut. A trace of both directions does not answer a request for one direction.

- **It is a network query result, not a modelled flow path.** NLDI lists the flowlines within the distance along the network (upstream: every tributary; downstream: the main stem). It says nothing about regulation, perennial flow or gauge coverage. The line is drawn solid: dashes on this map mean modelled lines.
- **United States only.** A gauge that is not a USGS site number gets a plain "tracing is unavailable" message and no buttons. A US id NLDI does not know is learned by asking: the agent says so, and no layer is added.
- **No trace over the MERIT layer.** The loaded MERIT rivers are clipped to the view, so a trace over them would be incomplete and wrong without saying so.

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
