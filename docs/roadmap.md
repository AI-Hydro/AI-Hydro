---
description: AI-Hydro project roadmap — current status, shipped features, and planned work for v0.3 and v1.0.
---

# Roadmap

!!! tip "Project Status: Beta"
    The extension and Python backend are stable for interactive research and learning.
    New capabilities are added incrementally; breaking changes before v1.0 will be
    documented in the [Changelog](changelog.md).

---

## Current Version

**Extension:** 0.4.x (see the [Changelog](changelog.md) for the exact release) · **Python backend:** aihydro-tools 2.12.0 (aihydro-watershed 0.4.7, aihydro-data 0.2.10)

The lists below were last curated at extension v0.2.8; the Changelog is the authoritative record of what has shipped since.

### What's stable

- All 184 built-in MCP tools in aihydro-tools 2.12.0 (analysis, modelling, session, project, literature, persona, map, provenance and more; see the [Complete Reference](tools/reference.md))
- AI-Hydro Studio with full interactive-module execution environment
- Course mode: guided learning paths with prerequisites and progress tracking
- `window.aihydro` interactivity primitives (timeline, compare, sim, plot, scene3d, bindParam)
- Manim video cells (3Blue1Brown-style animations rendered to inline MP4)
- Control-state persistence (slider values survive panel close/reopen)
- `AI-Hydro: Validate Module` command (deterministic lint against the 50-item checklist)
- Live agent↔preview session bridge (`preview_list_modules`, `preview_get_state`, etc.)
- Module marketplace with contributor recognition
- HydroSession, ProjectSession, ResearcherProfile persistence
- Plugin entry-point system (`aihydro.tools`)
- Local "Save Page As" snapshots render with full CSS/images (`<base href>` injection)
- Saved live-app detection banner with "Open in browser" for offline-unrenderable files
- Full ARIA label coverage on all icon-only toolbar buttons and the kernel status chip

### Known limitations

- USGS-gauge-centric data tools — non-USGS international gauges require custom scripts
- PDF extraction requires text-layer PDFs (scanned images not supported)
- LSTM modelling requires CAMELS gauges (static attributes dependency)
- `xrspatial` not available on Python 3.13 — `extract_geomorphic_parameters` requires conda-installed `xarray-spatial`; TWI is unaffected (uses `pysheds`)
- Manim render speed scales with animation length — complex scenes can take 10–60 s on first run

---

## Near-term — v0.2.x

- [ ] Cell dependency graph — `dependsOn` field for graph-ordered execution
- [ ] Variable inspector — inspect Python namespace without `print()` calls
- [ ] Multi-band GeoTIFF in cells — render raster outputs inline in the output area
- [ ] Shared output store — pass arrays / GeoDataFrames between cells in different artifacts
- [ ] Windows PATH auto-detection improvements in extension
- [ ] Terminal recording (asciinema/vhs) on the documentation home page
- [ ] Screenshot gallery of VS Code extension in action

---

## Medium-term — v0.3.x

- [ ] International gauge support (GRDC, Global Runoff Database)
- [ ] Interactive provenance viewer in VS Code sidebar
- [ ] Automated session diff — detect what changed between analysis runs
- [ ] Community plugin registry page (curated list with install commands)
- [ ] `aihydro-rag` optional semantic literature search package
- [ ] Case study: multi-basin CAMELS comparison with provenance export

---

## Long-term — v1.0

- [ ] Stable, versioned API contract for plugins
- [ ] Full test suite with live data fixtures
- [ ] Peer-reviewed paper published (GMD or Environmental Modelling & Software)
- [ ] Docker image for reproducible deployment
- [ ] CI integration — run AI-Hydro analyses as part of research CI pipelines

---

## Contributing to the Roadmap

Have a domain tool or feature you need? [Open an issue](https://github.com/AI-Hydro/AI-Hydro/issues) with the `enhancement` label or contribute directly — see the [Plugin Guide](plugins/overview.md) for the fastest path to adding new domain tools.
