# Changelog

All notable changes to the AI-Hydro VS Code extension are documented here.
The companion Python package (`aihydro-tools`) has its own changelog at
[github.com/AI-Hydro/aihydro-tools](https://github.com/AI-Hydro/aihydro-tools/blob/main/CHANGELOG.md).

---

## [0.1.3] — 2026-04-11

### Fixed
- **Security**: Path traversal vulnerability in `ProjectSession` — `project_name` now
  validated against `^[a-zA-Z0-9_-]{1,64}$` before any filesystem use
- **Critical**: `fetch_streamflow_data` broken on pandas 3.0 — replaced `hydrofunctions`
  with `dataretrieval` (official USGS Python client); all streamflow fetches now work
- **Geomorphic**: Outlet elevation NaN silently coerced to 0.0, cascading to 6 metrics
  returning zero — added nearest-pixel fallback (±3 cells); returns `NaN` explicitly
  if no valid pixel found
- `research.md` and `tools.md` written to `.clinerules/` (old Cline path) instead of
  `.aihydrorules/` — auto-injected research context was not reaching the agent
- `add_note`: parameter `text` renamed to `note`; `add_journal_entry`: `text` → `entry`;
  `get_project_summary`: `name` → `project_name` (consistent with all other project tools)
- `export_session`: default format corrected from `"text"` to `"json"`, third option
  corrected from `"text"` to `"methods"`; `clear_session` docs: `slot` → `slots` (list)
- `train_hydro_model` docs: parameters fully corrected (`framework`, date ranges, `epochs=500`)

---

## [0.1.2] — 2026-04-10

### Added
- **v1.2 Python backend** (aihydro-tools v1.2.0):
  - `ProjectSession`: project-scoped research state spanning multiple gauges/topics
  - `ResearcherProfile`: persistent researcher persona built from interactions
  - 10 new MCP tools → 26 total
  - Folder-based literature indexing (`index_literature`, `search_literature`)
  - Cross-session experiment search (`search_experiments`)
  - Project experiment journal (`add_journal_entry`)
  - Researcher profile tools (`get/update_researcher_profile`, `log_researcher_observation`)
- Memory hierarchy fully documented in agent instructions:
  `ResearcherProfile → ProjectSession → HydroSession → research.md`
- Agent now calls `get_researcher_profile()` at conversation start
- GitHub Pages documentation site (MkDocs Material)
- YouTube channel added to project links

### Changed
- Platform descriptions revised across README, PyPI, and Marketplace for clarity and vision
- Private files (`paper.md`, `branding.md`) excluded from VSIX packaging

---

## [0.1.1] — 2026-04-09

### Changed
- Bumped version 0.1.0 → 0.1.1 for VSIX distribution

### Python backend (aihydro-tools v1.1.0)
- RAG system removed; `query_hydro_concepts` tool removed
- Hardcoded tool-count references replaced with generic language
- RAG files archived to [github.com/AI-Hydro/aihydro-rag](https://github.com/AI-Hydro/aihydro-rag)

---

## [0.1.0] — 2026-03-31

### Added
- Initial public release of AI-Hydro VS Code extension
- Full TypeScript rebranding from Cline → AI-Hydro
- Auto-registration of `ai-hydro` MCP server on extension activation
- Custom agent system prompt for hydrological research workflows
- Python backend: aihydro-tools v1.1.0 (16 MCP tools via `aihydro-mcp`)
- Latest AI model support: Claude 4.6 (Opus/Sonnet), GPT-5.4, Gemini 3.1
- Documentation: `PLUGIN_GUIDE.md`, `docs/tools-reference.md`, `docs/installation.md`
- Community contribution guide: `python/CONTRIBUTING.md`

---

[0.1.2]: https://github.com/AI-Hydro/AI-Hydro/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/AI-Hydro/AI-Hydro/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/AI-Hydro/AI-Hydro/releases/tag/v0.1.0
