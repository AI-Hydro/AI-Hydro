# Changelog — AI-Hydro VS Code Extension

All notable changes to the AI-Hydro VS Code extension are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

The companion Python package (`aihydro-tools`) has its own changelog at
`github.com/AI-Hydro/aihydro-tools/CHANGELOG.md`.

---

## [Unreleased]

---

## [0.1.2] — 2026-04-10

### Added
- **v1.2 Python backend** (aihydro-tools v1.2.0) integrated:
  - `ProjectSession`: project-scoped research state spanning multiple gauges/topics
  - `ResearcherProfile`: persistent researcher persona built from interactions
  - 10 new MCP tools → 26 total
  - Folder-based literature indexing (`index_literature`, `search_literature`)
  - Cross-session experiment search (`search_experiments`)
  - Project experiment journal (`add_journal_entry`)
  - Researcher profile tools (`get/update_researcher_profile`,
    `log_researcher_observation`)
- **Memory hierarchy** fully documented in agent instructions:
  `ResearcherProfile → ProjectSession → HydroSession → research.md`
- Agent now calls `get_researcher_profile()` at conversation start to recall
  who the researcher is and tailor responses accordingly.

### Changed
- `python/ai_hydro/mcp/app.py`: agent instructions rewritten with memory
  hierarchy, project workflow, and literature workflow sections.
- `python/ai_hydro/session/__init__.py`: exports `ProjectSession`,
  `ResearcherProfile` alongside `HydroSession`.
- `python/ai_hydro/session/store.py`: `write_research_context()` now appends
  researcher profile block to `.clinerules/research.md`.

---

## [0.1.1] — 2026-04-09

### Changed
- Bumped version 0.1.0 → 0.1.1 for VSIX distribution.

### Python backend (aihydro-tools v1.1.0)
- RAG system removed; `query_hydro_concepts` tool removed.
- Hardcoded "17 tools" references replaced with generic language throughout.
- RAG files archived to `github.com/AI-Hydro/aihydro-rag`.

---

## [0.1.0] — 2026-03-31

### Added
- Initial public release of AI-Hydro VS Code extension.
- Full TypeScript rebranding from Cline → AI-Hydro:
  - Types: `ClineMessage` → `AiHydroMessage`, `ClineAsk` → `AiHydroAsk`, etc.
  - Config files: `.clinerules` / `.aihydroignore` / `.aihydrorules`
  - VS Code config keys: `cline.*` → `aihydro.*`
  - 25 source files renamed, 8 webview files renamed
- Auto-registration of `ai-hydro` MCP server on extension activation
  (`src/core/mcp/ensureDefaultMcpServer.ts`): detects `aihydro-mcp` on PATH
  and writes server config automatically.
- MCP settings file: `aihydro_mcp_settings.json`
  (at `~/Library/Application Support/Code/User/globalStorage/aihydro.ai-hydro/`)
- Custom agent system prompt for hydrological research workflows.
- Python backend: aihydro-tools v1.1.0 (16 MCP tools via `aihydro-mcp`).
- Latest AI model support added to `src/shared/api.ts`:
  Claude 4.6 (Opus/Sonnet), GPT-5.4, Gemini 3.1, and others.
- Documentation: `PLUGIN_GUIDE.md`, `docs/tools-reference.md`,
  `docs/installation.md`, `docs/architecture.md`.
- Community contribution guide: `python/CONTRIBUTING.md`.

### Notes
- Proto/generated code preserved from upstream Cline (untouched):
  `src/shared/proto/cline/`, `src/generated/`, `proto/`
- Proto-conversion layer bridges `AiHydroMessage` (app) ↔ `ClineMessage` (proto)

---

[Unreleased]: https://github.com/AI-Hydro/AI-Hydro/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/AI-Hydro/AI-Hydro/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/AI-Hydro/AI-Hydro/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/AI-Hydro/AI-Hydro/releases/tag/v0.1.0
