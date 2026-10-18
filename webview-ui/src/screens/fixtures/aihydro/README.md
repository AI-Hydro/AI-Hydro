# Recorded ai-hydro tool-call fixtures (UI-W slice S3)

These bodies feed the S3 presenter and card tests and the harness screens. Nothing was re-recorded and no
network was used to create them. Field names are the server's own; none were guessed.

| File | What it is | How it was made |
|---|---|---|
| `success_data_fetch.json` | A `data_fetch` call and its full result for USGS 01013500, 1989-10-01 to 2009-09-30 (explicit gauge id, area check pass). | **Verbatim** step from `docs/vision-2040/evidence/e2e-proof-3/01013500/transcript.jsonl` (recorded 2026-10-17 against the live USGS Water Data API). Only `streamflow_slot.data_file` (a local path) was replaced by `<elided: local path>`. |
| `signatures_result.json` | A signatures call and result from the same session (carries `_run_id`, `meta.gauge_id`, no `upstream`/`site_resolution`, no `information_class`). | **Verbatim** step from the same transcript. `args.geometry_geojson` (a long polygon string) was replaced by `<elided: polygon GeoJSON string>`. |
| `provisional_data_fetch.json` | A `data_fetch` result whose `quality` has 43 Provisional of 120 rows. | **Spliced.** `quality` and `upstream` are the output of `aihydro_data.sources.usgs_waterdata.get_daily("01013500", "2026-06-19", "2026-10-17")` run offline against the recorded body `daily_01013500_last120d_provisional` (aihydro-data integration worktree `.worktrees/v2040-u-int-data`, `tests/fixtures/usgs_waterdata`). `site_resolution` is the real explicit-id record below. `upstream.retrieved_at` is the replay time, not a USGS retrieval time. The run id is a fixture id (`fx-run-0101`) because no server run produced this combination. |
| `area_fail_data_fetch.json` | A `data_fetch` result whose `site_resolution.area_check` is `fail`. | **Spliced.** `site_resolution` is the output of `resolve_gauge(<NLDI basin of COMID 724696>, gauge_id="01109000")` run offline against the recorded bodies: gauge 01109000 (112 km2) against the 01013500 basin polygon (2252 km2). `quality`/`upstream` come from the verbatim success body. Run id `fx-run-0102` is a fixture id. |
| `outlet_snap_site_resolution.json` | A `method: outlet_snap` gauge-resolution record. | `resolve_gauge(outlet=<recorded NLDI nwissite position of 01013500>)` run offline against the recorded bodies. |
| `refusal_gauge_required.json` | The terminal `GAUGE_REQUIRED` refusal envelope (`error`, `code`, `message`, `recovery`, `next_tools`, `details`). | `TerminalSourceError.to_dict()` raised by `resolve_gauge(<basin polygon>)` with no gauge id and no outlet. `args` follow the recorded call shape. |
| `refusal_arg_repair.json` | The arg-repair self-help envelope (`error`, `tool`, `message`, `required`, `input_schema`, `example_call`; **no `code`**). | Real `ArgRepairMiddleware` output (`StructuredToolError.envelope`) for the toy tool in aihydro-tools `tests/test_arg_repair.py`. |
| `tools_list_2_5_0.json` | `description`, `inputSchema` and `annotations` for three tools. | An in-memory MCP `tools/list` against the aihydro-tools 2.5.0 server (tag `v2.5.0`, worktree `.worktrees/v2040-u5`). `data_fetch` comes from the installed aihydro-data. |

Sources of the field names:

- `site_resolution` (`site`, `site_name`, `method`, `distance_m`, `area_check`, `log_area_ratio`, `area_ratio`, `thresholds`, `warnings`): `aihydro_data/sources/usgs_waterdata.py`, `GaugeResolution`.
- `quality` (`n_rows`, `approval_counts`, `provisional_fraction`, `provisional_first`, `provisional_last`): same file, `summarize_frame`.
- `upstream` (`backend`, `retrieved_at`, `request_urls`, ...): same file, `_new_record`.
- `product`, `source`, `site_resolution`, `quality`, `upstream` on the result: `aihydro_data/contracts.py`, `FetchResult`.
- `_run_id`: `ai_hydro/mcp/app.py` `_inject_run_id` and `ai_hydro/mcp/enforcement.py`.
- Error envelope: `aihydro_data/exceptions.py` `AihydroDataError.to_dict`, `ai_hydro/mcp/errors.py` `envelope_from_exception`, `ai_hydro/mcp/arg_repair.py` `_build_help`.
- `basin_ref` (`id`, `aliases[{scheme,id}]`, `area_km2`): aihydro-core `records/place.py` `BasinRef`. No recorded result carrying one is in these fixtures; the presenter test builds one inline from that schema.

The server does not emit `information_class` yet (S3 asks for it as a display-envelope field), so no recorded body has it. The
presenter tests that exercise it use a one-key inline object and say so.
