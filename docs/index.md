---
hide:
  - navigation
  - toc
---

<div class="hero" markdown>

# AI-Hydro

<p class="tagline">Intelligent Hydrological Computing</p>

<div class="install-block">pip install aihydro-tools[all]</div>

<p style="color: #94a3b8; font-size: 0.95rem;">
  An open platform where AI agents do real hydrological research —<br>
  watershed analysis, streamflow retrieval, model calibration, and reproducible provenance,<br>
  all from a single conversation.
</p>

[Get Started](getting-started/installation.md){ .md-button .md-button--primary }
[View on GitHub](https://github.com/AI-Hydro/AI-Hydro){ .md-button }
[Watch on YouTube](https://www.youtube.com/channel/UC8RWDhJm61i2tlV9mt982cw){ .md-button }

</div>

---

## The Problem

Hydrological research today involves a fragmented cycle: downloading data from scattered federal APIs, wrangling formats, writing processing scripts, calibrating models, and documenting provenance — **often spending more time on plumbing than on science.**

This friction compounds a deeper structural failure: fewer than 7% of published computational hydrology studies provide sufficient code, data, and workflow documentation for independent replication, a rate that has barely moved despite a decade of open-science advocacy.

**AI-Hydro addresses this gap directly.** Tell the agent what you want to understand. It does the computation.

---

## What AI-Hydro Can Do

<div class="feature-grid" markdown>

<div class="feature-card" markdown>
<div class="icon">🌊</div>

### Watershed Analysis

Delineate watersheds, fetch streamflow, extract hydrological signatures, characterize geomorphology — all from a USGS gauge ID, in one conversation.
</div>

<div class="feature-card" markdown>
<div class="icon">🧠</div>

### Hydrological Modelling

Calibrate differentiable conceptual models or train deep learning rainfall-runoff models. Results cached with full provenance.
</div>

<div class="feature-card" markdown>
<div class="icon">📁</div>

### Project Workspace

Organise research across multiple gauges, regions, and topics. Search across all your experiments in one command.
</div>

<div class="feature-card" markdown>
<div class="icon">📚</div>

### Literature Module

Drop your PDFs into a folder. Index them. Ask the agent to synthesise across your own paper collection — no vector database required.
</div>

<div class="feature-card" markdown>
<div class="icon">🧬</div>

### Researcher Profile

The agent learns who you are — your expertise, preferred models, active projects — and tailors responses accordingly across every session.
</div>

<div class="feature-card" markdown>
<div class="icon">🔌</div>

### Community Plugins

Any Python package can register domain tools via entry points. Flood frequency, sediment transport, groundwater, remote sensing — community-built and auto-discovered.
</div>

</div>

---

## Quick Example

```
You: Delineate the watershed for USGS gauge 01031500, extract hydrological
     signatures, and calibrate a differentiable HBV model on GridMET forcing.

AI-Hydro:
  ✓ Watershed delineated — 1,247 km² (NHDPlus, NLDI)
  ✓ Streamflow fetched — 14,975 daily records (2000–2024, USGS NWIS)
  ✓ Hydrological signatures extracted — BFI: 0.52, runoff ratio: 0.41, ...
  ✓ HBV-light calibrated — NSE: 0.81, KGE: 0.78 (validation period)
  ✓ Session saved → ~/.aihydro/sessions/01031500.json
```

No code written. No data downloaded manually. Full provenance recorded automatically.

---

## Installation

=== "VS Code Extension"

    Search **AI-Hydro** in the VS Code Extensions panel, or install from the [Marketplace](https://marketplace.visualstudio.com/items?itemName=aihydro.ai-hydro).

    The extension auto-detects `aihydro-mcp` on startup — no manual server configuration needed.

=== "Python Package Only"

    ```bash
    pip install aihydro-tools[all]
    aihydro-mcp --diagnose
    ```

    Use with any MCP-compatible client (Claude Desktop, custom agents, etc.).

---

## Supported AI Models

| Provider | Recommended |
|----------|-------------|
| Anthropic | Claude Sonnet 4.6, Opus 4.6 |
| OpenAI | GPT-5.4, o3-pro |
| Google | Gemini 3.1 Pro, 2.5 Flash |
| AWS Bedrock | Claude on Bedrock |
| Local | Ollama, LM Studio |

---

## Built on Open Source

AI-Hydro is a domain-specific fork of [Cline](https://github.com/cline/cline) (Apache 2.0).
The Python backend builds on the broader scientific Python ecosystem — federal data APIs,
geospatial libraries, and deep learning frameworks — all open source and properly cited in
the tool provenance metadata.

If you use AI-Hydro in your research, see the **[Citing AI-Hydro](citing.md)** page for
BibTeX entries for the platform and all data sources.
