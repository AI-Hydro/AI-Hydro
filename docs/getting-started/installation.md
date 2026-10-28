---
description: Install AI-Hydro VS Code extension and aihydro-tools Python package. Step-by-step guide for macOS, Windows, and Linux with conda, pip, and PATH troubleshooting.
---

# Installation

AI-Hydro has two components: the **VS Code extension** (the agent interface) and the **Python backend** (`aihydro-tools`, the MCP server). Both are needed for the full experience.

---

## Prerequisites

- **VS Code** 1.84 or later
- **Python** 3.10 or later (3.11+ recommended)
- An AI API key — Anthropic, OpenAI, Google, or any supported provider

---

## Step 0 — Let the extension manage the tools (default)

The extension keeps its own Python environment for `aihydro-tools` and needs no terminal. On first start it finds Python 3.10 or newer (your `aihydro.tools.pythonPath` setting first, then `python3`), creates `~/.aihydro/venvs/tools-2.8` (or `$AIHYDRO_HOME/venvs/tools-2.8`; override with `aihydro.tools.venvPath`), installs `aihydro-tools[data,analysis,mcp,viz,gee,delineation]~=2.8.2` into it with that environment's own `python -m pip`, checks that the server answers an MCP handshake, and registers the environment's `aihydro-mcp` as the AI-Hydro server. It never installs into your system or base interpreter, and it adopts an existing healthy environment at that path instead of recreating it.

**What is downloaded and when.** The install fetches `aihydro-tools` and its dependencies from PyPI (pypi.org and files.pythonhosted.org), typically several hundred MB (an estimate). It starts on its own only when no environment exists at the default path, only after you agree once in a prompt that names PyPI, the size and the directory, and only while `aihydro.tools.autoInstall` is true. An existing environment that is unhealthy or older than 2.8.2 is never changed automatically: use **Repair**. Set `aihydro.tools.autoInstall` to false to install only from the **Install** button.

The Welcome view and the chat home show one status row (installed version, healthy or not, trusted or not) with **Install**, **Repair**, **Retry** and **Show log**; the status bar shows the same state, and **Settings > About** lists the interpreter, venv path, version, server command and trust verdict. A failed install stays visible and can be retried; there is no "don't show again". If a launcher is already registered somewhere else, the extension asks once whether to switch to the managed environment; a changed launcher always needs your explicit "Trust this launcher" before it is treated as the first-party server.

Skip Steps 1 and 2 unless you want to run the tools from your own environment.

---

## Step 1 — Install the Python Backend (optional, manual)

The Python package provides all hydrological tools via an MCP server.

=== "Full install (recommended)"

    ```bash
    pip install aihydro-tools[all]
    ```

    Installs all tool categories: data retrieval, analysis, modelling, and visualisation.

=== "Selective install"

    Install only what you need:

    | Extra | What it adds |
    |-------|-------------|
    | `[data]` | Streamflow, forcing, land cover, soil, CAMELS |
    | `[analysis]` | Watershed, signatures, TWI, geomorphic, curve number |
    | `[modelling]` | PyTorch HBV-light, NeuralHydrology LSTM |
    | `[viz]` | Matplotlib, Plotly, Folium |
    | `[all]` | Everything |

    ```bash
    pip install aihydro-tools[data,analysis]
    ```

=== "Conda / Mamba"

    ```bash
    conda create -n aihydro python=3.11
    conda activate aihydro
    pip install aihydro-tools[all]
    ```

---

## Step 2 — Verify the Server

```bash
aihydro-mcp --diagnose
```

You should see a list of available tools and their status. If `aihydro-mcp` is not found, see [PATH Troubleshooting](#path-troubleshooting) below.

---

## Step 3 — Install the VS Code Extension

Search **AI-Hydro** in the VS Code Extensions panel (`Ctrl+Shift+X` / `Cmd+Shift+X`), or:

```bash
code --install-extension aihydro.ai-hydro
```

On first activation, the extension automatically detects `aihydro-mcp` on your PATH and registers the MCP server — no manual configuration needed.

!!! tip "Manual VSIX install"
    If you downloaded a `.vsix` release file:
    ```bash
    code --install-extension ai-hydro-0.1.4.vsix
    ```

---

## Step 4 — Configure an AI Provider

Open the AI-Hydro sidebar in VS Code and enter your API key for any supported provider:

- **Anthropic** — Get a key at [console.anthropic.com](https://console.anthropic.com)
- **OpenAI** — Get a key at [platform.openai.com](https://platform.openai.com)
- **Google** — Get a key at [aistudio.google.com](https://aistudio.google.com)

Recommended starting model: **Claude Sonnet 4.6** (best balance of speed and reasoning for hydrological workflows).

---

## PATH Troubleshooting

If `aihydro-mcp` is not found after install:

| Environment | Typical location |
|-------------|-----------------|
| macOS/Linux (user) | `~/.local/bin/aihydro-mcp` |
| macOS with Conda | `~/miniconda3/bin/aihydro-mcp` |
| macOS with Homebrew Python | `/opt/homebrew/bin/aihydro-mcp` |
| Windows (user) | `%APPDATA%\Python\Python3XX\Scripts\aihydro-mcp.exe` |

**Universal fallback** — works regardless of PATH:

```bash
python -m ai_hydro.mcp
```

The VS Code extension auto-detects both the console script and the module fallback.

---

## Next Step

→ [Quickstart — your first hydrological analysis](quickstart.md)
