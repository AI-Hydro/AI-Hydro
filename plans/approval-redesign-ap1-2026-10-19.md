# Approval redesign, slice AP1 (security tightening) — 2026-10-19

Source design and acceptance tests T1-T31: `docs/vision-2040/findings/critique-approval-policy-2026-10-19.md` (ecosystem repo), background `audit-approval-mechanism-2026-10-19.md`. This slice only tightens behaviour. AP2 (annotation-driven MCP auto-run, inline prompt UI) is separate.

## What AP1 changes

| Finding | Change | Where |
|---|---|---|
| B1 | Host-side read-only command classifier; model flag only tightens; label/help honest | `src/core/task/commandPolicy.ts`, `ExecuteCommandToolHandler.ts`, `webview-ui/.../auto-approve-menu/constants.ts` |
| Protected commands | Hard deny of `aihydro-approve`, `ai_hydro.approval`, `ai_hydro/approval` in every mode | `commandPolicy.ts` (`matchProtectedCommand`), also `task/index.ts executeCommandTool` |
| B2 | Subagent launch always asks, refused when disabled, no `yolo_mode_toggled=true` / `-y` | `commandPolicy.ts`, `subagent_command.ts`, `cli-detector.ts` |
| B3 | Protected paths always ask for file writes and commands; loosening MCP-settings edits need UI confirmation | `protectedPaths.ts`, `tools/autoApprove.ts`, `services/mcp/policyGate.ts`, `McpHub.ts` |
| B4 | One `isServerTrusted` (name + recorded launcher); `AIHYDRO_AGENT_CONTEXT=1` on agent surfaces, cleared in the approval terminal | `shared/aihydro/firstPartyServers.ts`, `core/mcp/firstPartyLauncher.ts`, `ensureDefaultMcpServer.ts`, terminals, `serverEnv.ts`, `approvalTerminal.ts` |
| M4 | Explorer: READ class (readOnly + closed-world) on a trusted server only | `explorerPolicy.ts`, `shared/aihydro/mcpEffectClass.ts` |

## Tests (T-numbers implemented)

T1 (effectClass only), T3, T4, T5, T13, T14, T15, T16, T17, T18, T27, T28, plus B3 path tests and launcher persistence. Not in AP1: T2, T6-T12, T19-T22 (policy engine and prompt UI, AP2), T23-T26 (aihydro-tools CLI repo), T29-T30 (e2e stub-server, AP2), T31 (server-side invariant, unchanged).

T28 covers `backgroundExec` and test-mode `executeCommandInNode` by asserting on the spawn source, because a unit test cannot start those shell hosts.

## Security review of PR 61 (BLOCK) and what changed

| Finding | Fix |
|---|---|
| 1. Classifier bypassed by shell syntax it never parsed (zsh `*(e:..:)`, `=(..)`, brace expansion, abbreviated flags, PowerShell) | `src/core/task/readOnlyClassifier.ts`: unquoted `( ) { } * ? [ ] ! #`, a word-leading `=`, `~`, `^`, quoted `; & < > ` ! $`, control and non-ASCII characters reject; per-program flag ALLOW-lists (no abbreviations); sort, file, tree, rg, jq dropped; Windows and non-bash/zsh/sh/dash shells classify nothing read-only |
| 2. Model flags survive (`-s yolo_mode_toggled=true -y` after the injected false) | `subagentLaunchRefusal` denies `-y`, `--yolo`, any `yolo`, model `AIHYDRO_PROFILE=` and any flag other than `--profile`/`--workdir`; `sanitizeSubagentFlags` strips them again at injection; the notice is only shown for the standard form where it is true |
| 3. Launch-rule evasion | `mentionsAihydroProgram`: any word that normalises (quotes, escapes, case, path, `.exe`) to `aihydro`, across chains and wrappers, is a launch: denied while subagents are disabled, otherwise always asks; also enforced in `executeCommandTool` |
| 4. McpHub raw read path | `autoApprove` for tools, connection config strings and UI toggles come only from the gate's accepted policy (`McpPolicyGate.acceptedAutoApprove` / `sanitize`); integration test with a real McpHub and stdio server: edit, refresh, still not auto-approved, revert |

Non-blocking items done: `AIHYDRO_AGENT_CONTEXT=1` in ArtifactKernelService, GeeService and MapHydrologyService spawns; "Trust this launcher" is modal; a notice when a non-standard first-party launcher is not recorded; spaced-dot (`ai_hydro . approval`) and glob (`aihydro-appro?e`) forms in the protected matcher; `.git/config` and `.git/hooks` are protected paths.

Follow-up (not done): DiffViewProvider creates new files before approval, so a protected-path or approval decision for a brand-new file is made after the file exists on disk. Move creation behind approval.

New limits from the review fixes: a word equal to `aihydro` anywhere in a command (`cat aihydro`) is treated as a launch (asks, or is denied while subagents are disabled); the whitespace-collapsing and glob variants of the protected matcher can over-match (denies, the safe direction); the classifier takes `$SHELL` of the extension host as the terminal's shell and an unset or unlisted shell means nothing auto-runs; git subcommands still read repository config that was written before the session.

## Known limits (state these in review; do not over-trust the layers)

1. **Text matching is not a boundary.** The protected-command matcher and the protected-path text check read command text. Indirection defeats them: `a=aihydro-; ${a}approve`, `$'\x61ihydro-approve'`, a script file written earlier and run later, a base64-decoded payload, a program that spawns another, a subagent that decides on its own. `commandPolicy.test.ts` pins these as documented misses.
2. **The read-only classifier is a filter, not a sandbox.** It knows nothing about hostile files, aliases, git config or PATH. Reading is not restricted (a read-only `cat` of any readable file is allowed); only the protected-path text check asks.
3. **A same-user process bypasses all of it.** The real boundary for claim approval is a touch-required (`sk-`) signature (critique section c).
4. **Reads of protected paths via file tools are unchanged** (`read_file` of `~/.ssh` still follows "Read" settings). AP1 gates writes. Follow-up.
5. **Subagent policy is not forwarded.** The aihydro CLI is not in this repository and was not available (not on PATH), so its settings keys could not be verified and none were invented. Subagents run without YOLO under the CLI's own policy and may stall waiting for approval in their terminal. Revisit when the CLI contract is known. Also unverified: whether `-y` alone auto-answered MCP asks (it is no longer passed).
6. **Explorer in the CLI process.** The trust anchor is loaded from the extension settings directory of the process's own host. A CLI subagent with a different storage directory has no launcher record, so its explorer profile can call no MCP tools (fail closed). Fix belongs with the CLI contract.
7. **Launcher record scope.** Trust compares `command` and `args` only, not `env`/`cwd`, and does not verify the code the launcher loads. A record is written (or confirmed by the user) from the existing settings entry at upgrade time.
8. **CLI side.** aihydro-tools main (1f5fbd6) refuses `aihydro-approve` when `AIHYDRO_AGENT_CONTEXT` or `AIHYDRO_ACTIVE` is set. This slice sets `AIHYDRO_AGENT_CONTEXT=1` (and the existing `AIHYDRO_ACTIVE`) on agent surfaces and clears both, plus `AIHYDRO_PROFILE`, in the approval terminal. `env -u` / `unset` still bypasses it.
9. **`TerminalOptions.env` `null` clears a variable** per the VS Code API type (`string | null | undefined`) and the editor's terminal-env merge; the installed typings do not document the semantics and it was not verified at runtime here. The extension never sets the marker in the approval terminal, so the clear is belt and braces; tests assert the options passed.
10. **aiHydroServer.ts** (`isAiHydroServerName`, context injection of `_chat_id`/`_workspace`) still identifies by name plus an env allowlist. It is a routing decision, not an approval decision, and is left alone.
11. `deny`, `alwaysAsk`, `trustAnnotations` in the settings schema are reserved; only their loosening is detected.

## Hand-off to PR 58 (harness H1)

PR 58 adds `isMcpInstructionsTrusted` with a `TODO(AP1)`. `isServerTrusted(server)` from `src/shared/aihydro/firstPartyServers.ts` takes the resolved connection (`{name, config}`, i.e. an `McpServer`) and is intended to replace the name-based check there. PR 58's files were not edited here; wire it after both merge.

## M6 (consecutive read ceiling) — deferred to AP2

Nothing in AP1 auto-runs MCP reads, so a counter would have no consumer. TODO for AP2, when read auto-run lands: exempt READ-class MCP auto-runs from `maxRequests` (20) and add a separate consecutive-read ceiling of about 100 that any human interaction resets; on reaching it pause with "N read-only calls in a row". Test T12.

## Verification run for this slice

See the PR description for the exact commands and results.
