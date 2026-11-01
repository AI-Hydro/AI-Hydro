---
description: Drop named pins on the map, add a note, ask AI-Hydro about a location, and delete or undo. Pins belong to the project.
---

# Pins

A **pin** is a saved point with a name you can edit and an optional note. It is yours: a place to check, an outlet candidate, a dam. A pin is not data and has no scientific standing; the pin card says so ("Your note. Not a measurement.").

## Add a pin

There are three ways. Double-click is **not** one of them: it zooms the map, as on every map.

| How | What happens |
|---|---|
| **Right-click** (or two-finger tap) the map and choose **Add pin** | A pin is placed at that point and its card opens with the name selected |
| Press **P**, then click the map | The pin tool stays armed so you can place several; press **Esc** to stop |
| Open **Pins** in the rail and choose **Add pin** | Same as P |

New pins are named `Pin 1`, `Pin 2`, and so on. Type over the name and press Enter.

## The pin card

Click a pin to open its card: the name (click it to edit), a note, the coordinates, and four actions.

| Action | Does |
|---|---|
| **Ask AI-Hydro** | Opens a chat about this location, with the pin's name and note as context |
| **Delineate** | Opens a chat and the agent delineates the watershed at the pin |
| **Copy coordinates** | Copies `lat, lon` |
| **Delete** | Removes the pin (see Undo) |

## Delete and undo

Delete a pin from its card, from the Pins panel, from the right-click menu on the pin ("Remove pin"), or with **Delete** / **Backspace** while it is selected. A toast offers **Undo**, and **Ctrl/Cmd+Z** undoes the last pin change (add, rename, note, delete, clear all).

## The Pins panel

**Pins** in the rail lists every pin of the open project with its coordinates. Each row has Zoom to, Rename and Delete. **Clear all** asks first, and can be undone. **Export** writes the pins as GeoJSON; **From layer** adds one pin per point of the visible vector layer.

## Right-click menu

The menu is grouped: **AI-Hydro**, then the object under the pointer (a pin, or a layer feature), then **Map**.

- **Ask AI-Hydro…** opens a chat with your question.
- **Delineate** opens a chat and the agent runs `delineate_watershed_from_point`, so the run is recorded.
- **Delineate without chat** runs the interactive MERIT delineation directly and adds the basin to the map. It needs a CONUS point or a MERIT rivers layer on the map, and is meant for small and medium basins.
- **Add pin**, **Measure from here**, **Copy coordinates**.
- On a pin: **Rename pin**, **Ask about this pin**, **Remove pin**. On a layer feature: **Inspect**, export, **Remove layer**.

## Pins belong to the project

Each project has its own pins; pins from one project do not appear in another. Pins saved before projects existed were one global list. The first project that opens the map after the upgrade receives them, and the Pins panel shows a one-time notice: **Keep** them or **Clear them** (undoable). A pin stored with a damaged location is skipped so the map still loads, but it is kept aside (not deleted) on the host.

Pins you add before AI-Hydro knows which project is open (for example while the tools server is still starting) are kept on this machine until the project confirms it has saved them, so they are not lost if the window closes or the folder changes first. A pin that was never confirmed is shown in the next project that opens the map. In one rare case (the project saved it but its confirmation was lost, and a different project opens next) the same pin can appear in both projects; delete the extra copy.

## Lines and areas

Sketched lines and areas are not pins. They live under **Draw** in the rail ("Sketches & tracker"), with the tracker fields (status, priority, collections, photos) described in [Smart Annotations](annotations.md).
