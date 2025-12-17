# AI-Hydro – Computational Research Platform for Hydrology

<p align="center">
  <img src="./assets/docs/aihydro-hero-static.png" alt="AI-Hydro" width="100%" />
</p>

<div align="center">
<table>
<tbody>
<td align="center">
<a href="https://github.com/galib9690/AI-Hydro" target="_blank"><strong>GitHub Repository</strong></a>
</td>
<td align="center">
<a href="https://github.com/galib9690/AI-Hydro/issues" target="_blank"><strong>Issues</strong></a>
</td>
<td align="center">
<a href="https://github.com/galib9690/AI-Hydro/discussions" target="_blank"><strong>Discussions</strong></a>
</td>
<td align="center">
<a href="https://github.com/galib9690/AI-Hydro/discussions/categories/feature-requests" target="_blank"><strong>Feature Requests</strong></a>
</td>
<td align="center">
<a href="https://github.com/galib9690/AI-Hydro/wiki" target="_blank"><strong>Documentation</strong></a>
</td>
</tbody>
</table>
</div>

## Overview

**AI-Hydro** is an intelligent computational environment for hydrology and Earth-system sciences research. Built as a VSCode extension on the Cline framework, AI-Hydro combines domain-specific Python tools, curated hydrological knowledge bases, and RAG-based intelligence to assist researchers in complex hydrological analyses.

Unlike general-purpose coding assistants, AI-Hydro understands hydrology-specific concepts, workflows, and data structures. It provides dozens of **specialized tools** and **complete workflows** for watershed analysis, CAMELS attribute extraction, streamflow analysis, and more.

### What Makes AI-Hydro Special

1. **Domain-Specific Tools**: Dozens of wrapper functions + complete workflows for hydrology
2. **Intelligent Tool Discovery**: Multi-criteria weighted scoring with semantic understanding
3. **Multi-Tier Architecture**: Progressive disclosure from workflows to tools to libraries
4. **Reproducible Workflows**: Complete audit trails with workspace-isolated environments
5. **Direct Data Access**: USGS NWIS, NLDI, 3DEP, GridMET, and more

### Core Capabilities

**Tier 2 Tools** (Some of the focused functions):
- `delineate_watershed()` - Extract watershed boundaries
- `extract_topographic_attributes()` - Elevation, slope, drainage stats
- `extract_climate_indices()` - Precipitation, temperature, aridity
- `extract_hydrological_signatures()` - Flow statistics, baseflow, timing
- `extract_soil_attributes()` - Porosity, texture, depth
- `extract_vegetation_attributes()` - LAI, land cover, GVF
- `extract_geological_attributes()` - Lithology, permeability
- `extract_geomorphic_parameters()` - 28 basin morphometry metrics
- `fetch_streamflow_data()` - USGS streamflow retrieval
- `fetch_climate_data()` - GridMET climate data
- `fetch_forcing_data()` - Basin-averaged forcing

**Tier 3 Workflows** (some of the complete orchestrations):
- `extract_camels_attributes()` - Complete CAMELS extraction (70+ attributes)
- `fetch_hydrological_data()` - Multi-source data retrieval
- `compute_all_signatures()` - Comprehensive signature calculation
- `scientific_investigation()` - End-to-end watershed analysis

---

## Getting Started

### Quick Example

```python
# Example 1: Delineate a watershed
from ai_hydro.tools.watershed import delineate_watershed

result = delineate_watershed('01031500')
print(f"Watershed: {result['gauge_name']}")
print(f"Area: {result['area_km2']:.1f} km²")

# Example 2: Extract complete CAMELS attributes
from ai_hydro.workflows.camels_extraction import extract_camels_attributes

result = extract_camels_attributes(
    gauge_id='01031500',
    save_results=True,
    output_dir='./results'
)

print(f"Extracted {len(result['attributes'])} attributes")
print(f"Mean elevation: {result['attributes']['elev_mean']:.1f} m")
print(f"Aridity: {result['attributes']['aridity']:.2f}")
```

### How It Works

1. **Natural Language Request**: "Extract CAMELS attributes for gauge 01031500"
2. **Intelligent Tool Discovery**: Multi-criteria scoring finds optimal tools (name matching, semantic similarity, category alignment)
3. **Tool Validation**: Verifies tool existence to prevent hallucinations
4. **Code Generation**: Creates Python script using validated, ranked tools
5. **Execution**: Runs in isolated workspace virtual environment
6. **Results**: Presents findings with visualizations and next steps

See [AI-Hydro's complete architecture](./AI_HYDRO_COMPLETE_WORKFLOW_ARCHITECTURE.md) for comprehensive technical details.

### RAG System Intelligence

AI-Hydro uses an **Adjusted Weights** multi-criteria scoring approach that achieved **66.67% precision@3** in testing:

- **Name Match (35%)**: Identifies tools by name/phrase matching
- **Semantic Similarity (30%)**: TF-IDF-based understanding of query intent
- **Category Alignment (20%)**: Matches queries to relevant tool categories
- **Tier Appropriateness (10%)**: Selects right abstraction level (workflow vs. tool)
- **Keyword Density (5%)**: Evaluates keyword concentration in descriptions

This approach **fixes critical bugs** from previous systems (e.g., correctly ranking `fetch_streamflow_data` #1 for streamflow queries, not `delineate_watershed`).

**Key Features:**
- ✅ Automatic tool validation prevents AI hallucinations
- ✅ Semantic understanding through TF-IDF vectorization
- ✅ Domain-specific synonym handling (TWI → topographic wetness index)
- ✅ Acronym recognition (LAI, PET, DEM, etc.)

See [AI_HYDRO_RAG_SYSTEM_GUIDE.md](./AI_HYDRO_RAG_SYSTEM_GUIDE.md) for technical details.


---

## Architecture

### System Components

```
┌─────────────────────────────────────┐
│  VSCode Extension (TypeScript)      │
│  ├─ Chat Interface                  │
│  ├─ RAG Service                     │
│  ├─ Task Manager                    │
│  └─ Workspace Manager               │
└──────────────┬──────────────────────┘
               │ JSON-RPC
               ▼
┌─────────────────────────────────────┐
│  Python Package: ai-hydro           │
│  ├─ tools/ (Tier 2 wrappers)     │
│  ├─ workflows/ (Tier 3 workflows) │
│  ├─ rag/ (RAG engine)               │
│  ├─ registry/ (tool discovery)      │
│  └─ knowledge/ (domain knowledge)   │
└──────────────┬──────────────────────┘
               │ API calls
               ▼
┌─────────────────────────────────────┐
│  External Data Sources              │
│  USGS, GridMET, 3DEP, MODIS, etc.   │
└─────────────────────────────────────┘
```

### Package Structure (Just the Domain Specific Python Package)

```
python/ai_hydro/
├── tools/          # Tier 2: Single-purpose wrappers
│   ├── watershed.py
│   ├── hydrology.py
│   ├── climate.py
│   ├── soil.py
│   ├── vegetation.py
│   ├── geology.py
│   ├── topography.py
│   ├── geomorphic.py
│   └── forcing.py
├── workflows/      # Tier 3: Complete workflows
│   ├── camels_extraction.py
│   ├── fetch_data.py
│   ├── compute_signatures.py
│   ├── investigation.py
│   ├── modeling.py
│   └── rag_search.py
├── rag/            # RAG engine with validation
│   ├── engine.py
│   ├── embeddings.py
│   └── knowledge_loader.py
├── registry/       # Tool/workflow discovery
├── knowledge/      # Domain knowledge (JSON)
└── utils/          # Validators, helpers
```

---

## Features

### AI Models

AI-Hydro works with leading AI providers (Anthropic, OpenAI, Google, AWS Bedrock) but enhances them with domain-specific knowledge:

- Watershed delineation concepts
- CAMELS attribute definitions
- Hydrological signatures
- Water balance equations
- Common modeling approaches

The extension tracks API usage and provides cost transparency.

### Execute Hydrological Workflows

AI-Hydro executes Python scripts in isolated workspace environments:

- Install required packages (geopandas, rasterio, etc.)
- Run complete workflows (CAMELS extraction)
- Process large datasets
- Manage long-running computations

For long-running processes, use "Proceed While Running" to continue working.

### Create and Edit Analysis Scripts

AI-Hydro generates Python scripts following hydrological best practices:

- Presents changes in diff view
- Monitors for errors automatically
- Handles missing data appropriately
- Validates coordinate reference systems
- Ensures proper imports

All changes tracked in Timeline for reproducibility.

### Visualize Results

Create interactive visualizations using plotly, matplotlib:

- Hydrographs and flow duration curves
- Watershed boundary maps
- CAMELS attribute correlations
- Model performance metrics
- Interactive dashboards

### Add Research Context

**`@url`:** Paste documentation URLs (USGS API docs, model manuals)

**`@problems`:** Add analysis errors for diagnosis

**`@file`:** Add data files, configurations, results

**`@folder`:** Add entire project folders

### Research Checkpoints

AI-Hydro takes git-based snapshots at each step:

- Use 'Compare' to see changes
- 'Restore' to roll back
- Ensure reproducibility
- Test different configurations

---

## Example Research Workflows

### Watershed Analysis
```
"Analyze hydrological characteristics of USGS gage 01646500 
using CAMELS attributes and compute flow duration curves"
```

### Model Calibration
```
"Extract CAMELS attributes for gauge 01031500 and prepare 
forcing data for hydrological modeling"
```

### Comparative Studies
```
"Compare rainfall-runoff responses across CAMELS basins 
and identify key controlling attributes"
```

---

## Python Package Installation

The `ai-hydro` Python package is automatically installed in your workspace's virtual environment. 

### Dependencies

**Core:** numpy, pandas, xarray, scipy  
**Geospatial:** geopandas, rasterio, shapely, pyproj  
**Hydro Data:** pygeohydro, pynhd, py3dep, pygridmet  
**RAG:** langchain, chromadb, sentence-transformers  
**Visualization:** matplotlib, plotly, folium  

See `python/pyproject.toml` for complete list.

---

## Documentation

- **Architecture**: See `AI_HYDRO_COMPLETE_WORKFLOW_ARCHITECTURE.md`
- **RAG System**: See `AI_HYDRO_RAG_SYSTEM_GUIDE.md`
- **Developers Guide**: See `AI_HYDRO_TOOLS_AND_WORKFLOWS_DEVELOPER_GUIDE.md`

---

## Contributing

To contribute to AI-Hydro, check our [Contributing Guide](CONTRIBUTING.md). Join our [Discord](https://discord.gg/ai-hydro) to discuss in the `#contributors` channel.

### Development Setup

```bash
# Clone repository
git clone https://github.com/galib9690/AI-Hydro.git
cd AI-Hydro

# Install VSCode extension dependencies
npm install

# Install Python package in editable mode
cd python
pip install -e ".[dev]"

# Run tests
pytest tests/
```

---

## Citation

If you use AI-Hydro in your research, please cite:

```bibtex
@software{aihydro2025,
  title = {AI-Hydro: An Intelligent Computational Environment for Hydrology Research},
  author = {Galib, Mohammad and AI-Hydro Research Team},
  year = {2025},
  url = {https://github.com/galib9690/AI-Hydro},
  version = {0.1.0}
}
```

---

## License

[Apache 2.0 © 2025 AI-Hydro Research Team](./LICENSE)

---

## Built on Open Source

AI-Hydro is built on [Cline](https://github.com/cline/cline), an open-source autonomous coding agent. We're grateful to the Cline community for creating the agentic framework that makes domain-specific research assistants like AI-Hydro possible.

---

## Support

- **Issues**: [GitHub Issues](https://github.com/galib9690/AI-Hydro/issues)
- **Discussions**: [GitHub Discussions](https://github.com/galib9690/AI-Hydro/discussions)
- **Email**: mgalib@purdue.edu

---

**Version**: 0.1.0  
**Last Updated**: January 2025  
**Maintainer**: Mohammad Galib (mgalib@purdue.edu)
