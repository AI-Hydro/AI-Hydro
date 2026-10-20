# Claude 5.x model ids

Source of the ids: Anthropic model IDs as listed in the Claude Code environment, 2026-10-17.

| Model id | Bedrock registry id | Vertex registry id |
|---|---|---|
| `claude-fable-5-1` | `anthropic.claude-fable-5-1` | not registered |
| `claude-opus-5-5` | `anthropic.claude-opus-5-5` | `claude-opus-5-5` |
| `claude-sonnet-5-5` | `anthropic.claude-sonnet-5-5` | `claude-sonnet-5-5` |
| `claude-haiku-5-5` | `anthropic.claude-haiku-5-5` | not registered |

The Bedrock and Vertex ids are the same names under each platform's convention; their availability
and (for Bedrock) Converse-API support are not verified here.

## Sourced limits, flags and prices (fetched 2026-10-19)

Sources (Anthropic documentation):

- Models overview: https://platform.claude.com/docs/en/models/overview
- Model pages: https://platform.claude.com/docs/en/models/{fable-5-1,opus-5-5,sonnet-5-5,haiku-5-5}/overview
- Effort: https://platform.claude.com/docs/en/build-with-claude/effort
- What's new in Opus 5.5 (thinking cannot be disabled; also applies to Fable 5.1): https://platform.claude.com/docs/en/models/opus-5-5/whats-new-opus-5-5
- Pricing: https://platform.claude.com/docs/en/about-claude/pricing

| Model | Context | Max output | Input / output (USD per MTok) | 5m cache write / read |
|---|---|---|---|---|
| `claude-fable-5-1` | 1M | 128K | 10 / 50 | 12.50 / 0.25 |
| `claude-opus-5-5` | 1M | 128K | 4 / 20 | 5 / 0.20 |
| `claude-sonnet-5-5` | 1M | 128K | 2 / 10 | 2.50 / 0.10 |
| `claude-haiku-5-5` (prompt <= 100k) | 1M | 128K | 0.10 / 0.50 | 0.125 / 0.01 |
| `claude-haiku-5-5` (prompt > 100k) | 1M | 128K | 0.50 / 2.50 | 0.625 / 0.05 |

All four support adaptive thinking and the effort parameter (`low`, `medium`, `high`, `xhigh`, `max`).
`budget_tokens` is never sent. Fable 5.1 and Opus 5.5 reject `thinking: disabled` and
`thinking: enabled` (400), so the request builder only ever sends `adaptive` (when the user's thinking
setting is on) and otherwise omits the field. The user's effort setting is sent as `output_config.effort`.

## Evidence table

Fetched 2026-10-19 (WebFetch of the pages; values re-checked by the reviewer on the same date). "Whole request"
means the Haiku 5.5 tier is chosen per request from the full prompt length, cache reads and writes included, and
reprices every token of that request.

| Fact | Fable 5.1 | Opus 5.5 | Sonnet 5.5 | Haiku 5.5 | Source URL |
|---|---|---|---|---|---|
| Context window | 1M | 1M | 1M | 1M | https://platform.claude.com/docs/en/models/overview |
| Max output | 128K | 128K | 128K | 128K | https://platform.claude.com/docs/en/models/overview |
| Thinking | adaptive, always on | adaptive, always on | adaptive | adaptive | https://platform.claude.com/docs/en/models/overview |
| Default effort | high | medium | high | medium | https://platform.claude.com/docs/en/build-with-claude/effort |
| Input / output, USD per MTok | 10 / 50 | 4 / 20 | 2 / 10 | 0.10 / 0.50 (prompt <= 100k) | https://platform.claude.com/docs/en/about-claude/pricing |
| 5m cache write | 12.50 | 5 | 2.50 | 0.125 (prompt <= 100k) | https://platform.claude.com/docs/en/about-claude/pricing |
| Cache read | 0.25 | 0.20 | 0.10 | 0.01 (prompt <= 100k) | https://platform.claude.com/docs/en/about-claude/pricing |
| Haiku above 100k prompt tokens (whole request) | | | | 0.50 / 2.50, write 0.625, read 0.05 | https://platform.claude.com/docs/en/about-claude/pricing |

## Deliberately conservative

- `supportsTemperature: false`: the Haiku 5.5 page says to omit `temperature`, `top_p` and `top_k`; the
  other pages do not say otherwise, so none is sent.
- Bedrock and Vertex entries share the limits and flags, but their platform pricing is not sourced here
  (`pricingUnverified`), so the UI shows "cost unavailable" there. Their availability and Bedrock
  Converse-API support are not verified.
- Sonnet 5.5 documents `thinking: {"type": "between_tools"}` as its lowest thinking setting; that mode is
  not implemented. With the user's thinking setting off the field is omitted (adaptive default).
- The condense threshold for a 1M window is `max(window - 40k, 0.8 * window)` (`context-window-utils.ts`).
