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

## What is deliberately not claimed

Nothing in this repository sources the following for these models, so they are not presented as facts:

- **Prices** (input, output, cache read/write): undefined. The UI shows "cost unavailable (pricing not
  verified)" (`pricingUnverified` in `src/shared/api.ts`), not `$0`.
- **Context window and max output**: the registry uses the smallest window documented elsewhere in the
  registry (200,000) and the registry-wide default `maxTokens` (8192). These are conservative placeholders.
- **Capability flags**: only `supportsPromptCache` and `supportsTemperature: false` (send no explicit
  temperature) are set. Adaptive thinking, effort levels and `xhigh` are left unset until sourced; with
  them unset, no thinking or effort parameters are sent for these models.

To promote a model to verified: add the sourced prices/limits/flags to its registry entry, remove
`pricingUnverified`, and cite the source in this file.
