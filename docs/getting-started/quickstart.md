---
description: Run your first hydrological analysis with AI-Hydro in minutes. Watershed delineation, streamflow retrieval, and HBV model calibration from a single conversation.
---

# Quickstart

This guide walks through a complete hydrological analysis of a single USGS gauge — from watershed delineation to model calibration — in one agent conversation.

!!! tip "Prerequisites"
    Complete [Installation](installation.md) first. You need `aihydro-mcp` running and an API key configured in the VS Code extension.

---

## Open the AI-Hydro Sidebar

Click the AI-Hydro icon in the VS Code Activity Bar (left sidebar). You'll see the chat interface where you talk to the agent.

---

## Your First Analysis

Paste this into the chat:

```
Delineate the watershed for USGS gauge 01031500, fetch the last 10 years
of daily streamflow, and extract hydrological signatures. Save the session.
```

The agent will:

1. **Call `start_session`** — initialises a research session for gauge 01031500
2. **Call `delineate_watershed("01031500")`** — NHDPlus delineation via USGS NLDI
3. **Call `fetch_streamflow_data("01031500", ...)`** — 10 years of USGS NWIS data
4. **Call `extract_hydrological_signatures("01031500")`** — 15+ flow statistics

You'll see each tool call appear in the chat as it happens, with structured results returned inline.

---

## Reading the Results

After the analysis, ask:

```
Summarise the hydrological character of this basin.
```

The agent synthesises the signature results into a plain-English interpretation — baseflow behaviour, flashiness, seasonality — without you writing any code.

---

## Add Modelling

```
Calibrate a differentiable HBV-light model using GridMET forcing.
```

This triggers:

1. **`fetch_forcing_data`** — basin-averaged GridMET climate (precipitation, temperature, PET)
2. **`train_hydro_model`** — PyTorch HBV-light with automatic warm-up and calibration
3. Results cached with NSE, KGE, RMSE in the session

---

## Export for Your Paper

```
Export a methods paragraph I can use in my manuscript.
```

The agent calls `export_session` and generates a citable methods section with data sources, parameters, and tool versions — ready to paste into your paper.

---

## What Was Saved

Everything is persisted at `~/.aihydro/sessions/01031500.json`. Next time you open VS Code and mention gauge 01031500, the agent picks up exactly where you left off — no re-downloading, no re-computing.

```bash
# Inspect the session directly
cat ~/.aihydro/sessions/01031500.json
```

---

## Next Steps

- [Sessions & Provenance](../guide/sessions.md) — understand the memory model
- [Tool Reference](../tools/analysis.md) — every tool with full parameters
- [Project Workspace](../guide/project-session.md) — multi-basin research
