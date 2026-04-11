---
description: AI-Hydro session and provenance JSON schema — HydroSession, ProjectSession, ResearcherProfile. How every tool call is recorded for reproducibility.
---

# Provenance & Session Schema

One of AI-Hydro's central claims is that reproducibility should be a natural byproduct of the analysis process — not an afterthought. This page documents exactly what is recorded, where it is stored, and how it can be used to reconstruct or audit any analysis.

---

## The Core Contract: HydroResult

Every tool in AI-Hydro returns a `HydroResult` — a structured object with two parts:

```python
@dataclass
class HydroResult:
    data: dict        # the actual result values
    meta: HydroMeta   # who computed this, with what, from where, when

@dataclass
class HydroMeta:
    tool: str         # function name
    version: str      # aihydro-tools version
    source: str       # data source description
    retrieved_at: str # ISO 8601 UTC timestamp
    parameters: dict  # all input parameters used
```

This is what makes auditing possible. Every result carries the information needed to reproduce the computation independently.

---

## HydroSession Schema

**Location:** `~/.aihydro/sessions/<gauge_id>.json`

Full annotated schema:

```json
{
  "gauge_id": "01031500",
  "created_at": "2026-04-10T09:00:00Z",
  "updated_at": "2026-04-10T14:22:00Z",
  "version": "1.2.0",

  "watershed": {
    "data": {
      "area_km2": 1247.3,
      "perimeter_km": 198.6,
      "centroid_lat": 44.58,
      "centroid_lon": -70.54,
      "bbox": [-71.2, 44.1, -70.0, 45.1],
      "geometry_wkt": "POLYGON ((-71.2 44.1, ...))"
    },
    "meta": {
      "tool": "delineate_watershed",
      "version": "1.2.0",
      "source": "USGS NLDI / NHDPlus",
      "retrieved_at": "2026-04-10T09:14:22Z",
      "parameters": { "gauge_id": "01031500" }
    }
  },

  "streamflow": {
    "data": {
      "dates": ["2000-01-01", "2000-01-02", "..."],
      "discharge_cms": [12.4, 11.8, "..."],
      "record_count": 9131,
      "missing_days": 14,
      "units": "m3/s"
    },
    "meta": {
      "tool": "fetch_streamflow_data",
      "version": "1.2.0",
      "source": "USGS NWIS (waterservices.usgs.gov)",
      "retrieved_at": "2026-04-10T09:17:05Z",
      "parameters": {
        "gauge_id": "01031500",
        "start_date": "2000-01-01",
        "end_date": "2024-12-31"
      }
    }
  },

  "signatures": {
    "data": {
      "baseflow_index": 0.52,
      "runoff_ratio": 0.41,
      "mean_annual_discharge_cms": 37.2,
      "cv_daily_discharge": 1.14,
      "q5_cms": 118.4,
      "q25_cms": 52.1,
      "q50_cms": 24.3,
      "q75_cms": 11.6,
      "q95_cms": 3.2,
      "fdc_slope": -1.84,
      "high_flow_freq_days_yr": 8.2,
      "low_flow_freq_days_yr": 62.1,
      "recession_constant": 0.967,
      "rising_limb_density": 0.31
    },
    "meta": {
      "tool": "extract_hydrological_signatures",
      "version": "1.2.0",
      "source": "Derived from USGS NWIS streamflow",
      "retrieved_at": "2026-04-10T09:18:30Z",
      "parameters": { "gauge_id": "01031500" }
    }
  },

  "geomorphic": {
    "data": {
      "area_km2": 1247.3,
      "perimeter_km": 198.6,
      "mean_elevation_m": 412.1,
      "max_elevation_m": 1024.0,
      "min_elevation_m": 134.0,
      "relief_m": 890.0,
      "mean_slope_deg": 8.3,
      "elongation_ratio": 0.71,
      "circularity_ratio": 0.40,
      "form_factor": 0.33,
      "drainage_density_km_km2": 0.82,
      "stream_frequency": 1.14
    },
    "meta": {
      "tool": "extract_geomorphic_parameters",
      "version": "1.2.0",
      "source": "3DEP 10m DEM (USGS) via NHDPlus delineation",
      "retrieved_at": "2026-04-10T09:21:10Z",
      "parameters": { "gauge_id": "01031500", "dem_resolution_m": 10 }
    }
  },

  "model": {
    "data": {
      "framework": "hbv",
      "nse_train": 0.84,
      "kge_train": 0.81,
      "rmse_train_cms": 14.2,
      "nse_val": 0.79,
      "kge_val": 0.76,
      "rmse_val_cms": 16.8,
      "train_period": ["2000-10-01", "2007-09-30"],
      "val_period": ["2000-10-01", "2005-09-30"],
      "parameters": {
        "TT": 0.21, "CFMAX": 4.12, "FC": 312.4,
        "LP": 0.78, "BETA": 2.31, "K0": 0.41,
        "K1": 0.18, "K2": 0.04, "UZL": 48.2,
        "PERC": 1.84, "MAXBAS": 2.1
      }
    },
    "meta": {
      "tool": "train_hydro_model",
      "version": "1.2.0",
      "source": "GridMET forcing + CAMELS streamflow",
      "retrieved_at": "2026-04-10T10:44:00Z",
      "parameters": {
        "gauge_id": "01031500",
        "framework": "hbv",
        "train_start": "2000-10-01",
        "train_end": "2007-09-30",
        "epochs": 500,
        "n_restarts": 3
      }
    }
  },

  "notes": [
    {
      "timestamp": "2026-04-10T11:02:00Z",
      "text": "High BFI consistent with fractured bedrock geology. Worth investigating with isotope data."
    }
  ]
}
```

---

## ProjectSession Schema

**Location:** `~/.aihydro/projects/<project_name>/project.json`

```json
{
  "name": "New England Basins",
  "description": "Comparing snowmelt-driven runoff across Maine and New Hampshire catchments.",
  "created_at": "2026-04-10T09:00:00Z",
  "updated_at": "2026-04-10T14:22:00Z",
  "version": "1.2.0",

  "gauge_ids": ["01031500", "01013500", "01054200"],

  "topics": ["snowmelt", "baseflow", "New England"],

  "literature_dir": "~/.aihydro/projects/new_england_basins/literature/",
  "literature_indexed": true,
  "literature_index_updated": "2026-04-10T12:00:00Z",

  "journal": [
    {
      "timestamp": "2026-04-10T14:22:00Z",
      "entry": "HBV performed significantly better on the smaller basins. May be related to the prevalence of lakes in the larger ones."
    }
  ],

  "metrics": {}
}
```

---

## ResearcherProfile Schema

**Location:** `~/.aihydro/researcher.json`

```json
{
  "name": "Mohammad Galib",
  "institution": "Purdue University",
  "role": "PhD Researcher",
  "domain": "Computational Hydrology",
  "expertise": ["watershed modelling", "differentiable hydrology", "CAMELS benchmark"],
  "tools_familiarity": {
    "HBV-light": "advanced",
    "NeuralHydrology": "intermediate"
  },
  "preferred_models": ["HBV-light", "LSTM"],
  "research_focus": "Investigating the role of geology in controlling baseflow generation across CAMELS-US catchments.",
  "active_project": "New England Basins",
  "communication_style": "concise, technical",
  "observations": [
    "Prefers NSE and KGE together rather than NSE alone for model evaluation.",
    "Tends to work with 20-year streamflow records for signature extraction."
  ],
  "updated_at": "2026-04-10T14:22:00Z",
  "version": "1.2.0"
}
```

!!! info "Privacy"
    All three files — `HydroSession`, `ProjectSession`, and `ResearcherProfile` — are stored **locally** at `~/.aihydro/`. Nothing is sent to any cloud service. The AI agent reads them via the MCP server running on your own machine.

---

## What the Provenance Enables

| Use case | How |
|----------|-----|
| **Re-run analysis** | Parameters and date ranges are stored in `meta.parameters` for every slot |
| **Audit data source** | `meta.source` and `meta.retrieved_at` identify the exact data API and retrieval time |
| **Generate methods paragraph** | `export_session` reads all `meta` fields and produces a citable text block |
| **Compare across basins** | `search_experiments` queries `data` fields across all sessions in a project |
| **Version tracking** | `meta.version` records which `aihydro-tools` release produced each result |

---

## Side-by-Side: Conversation vs. Provenance

=== "What you say"

    ```
    Delineate the watershed for gauge 01031500 and extract hydrological signatures.
    ```

=== "What gets recorded"

    ```json
    {
      "watershed": {
        "data": { "area_km2": 1247.3, ... },
        "meta": {
          "tool": "delineate_watershed",
          "source": "USGS NLDI / NHDPlus",
          "retrieved_at": "2026-04-10T09:14:22Z",
          "parameters": { "gauge_id": "01031500" }
        }
      },
      "signatures": {
        "data": { "baseflow_index": 0.52, ... },
        "meta": {
          "tool": "extract_hydrological_signatures",
          "source": "Derived from USGS NWIS streamflow",
          "retrieved_at": "2026-04-10T09:18:30Z",
          "parameters": { "gauge_id": "01031500" }
        }
      }
    }
    ```

=== "What gets exported"

    ```
    Watershed boundaries for USGS gauge 01031500 were delineated using
    the NHDPlus dataset via the USGS NLDI API (accessed 2026-04-10).
    Hydrological signatures were computed from daily discharge records
    retrieved from the USGS National Water Information System (2000–2024).
    Baseflow was separated using the Eckhardt recursive digital filter,
    yielding a baseflow index of 0.52.
    ```

The conversation is ephemeral. The provenance record is permanent and machine-readable.
