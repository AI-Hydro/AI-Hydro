# Read-only explorers

Read-only explorers let AI-Hydro hand a focused question to a helper that has its own context window, so the main chat stays short. An explorer reads, searches and calls read-only tools, then reports back. It cannot change anything.

Turn them on in **Settings > Features > Subagents**. The setting is off by default and works the same on macOS, Windows and Linux.

## What happens when the model uses them

1. The model proposes 1 to 4 explorer prompts. A card shows each prompt, the model they will use, their budget and what an explorer cannot do. **Approve** or **Deny**. This is asked every time, whatever your auto-approve settings, including YOLO mode, and there is no "Always".
2. One status row appears in the chat. Each explorer shows its state (queued, running, waiting for you, done, stopped early, blocked, failed or cancelled), its last tool, its calls, tokens and cost. Expand an explorer to see its calls and where its record is stored. Up to three run at once.
3. When an explorer wants something that needs your approval (a file read outside what auto-approve covers, or a tool call that is not auto-approved), the approval appears in the chat as usual, with a line above it: "From Explorer 2 - read-only" and the first line of that explorer's prompt. One approval is pending at a time, in order. There is no "Always" on an explorer's approval.
4. Each explorer ends with a short report. The main agent receives the reports as unverified text and is told to open the source a report names before relying on it.

**Stop** cancels the main task and every explorer.

## What an explorer can and cannot do

| It can | It cannot |
|---|---|
| Read, search and list files in your workspace | Write or edit a file, or run a command |
| Call read-only tools on the trusted AI-Hydro server (tools the server marks read-only and closed-world) | Call a tool that writes, fetches from the network or is not marked read-only; use any other MCP server's tools |
| Read resources from the trusted AI-Hydro server | Browse, fetch a URL, or ask you a free-text question |
| Report findings to the main agent | Start another explorer, or create, change or approve a claim |

An explorer is never more capable than the main agent. It ignores YOLO and "run all commands"; it auto-approves nothing beyond its own reads, and only when your own read settings already allow them. In a workspace you have not trusted, every explorer call asks.

Explorers cannot fetch data in parallel yet (several basins at once, for example). That needs a different profile, which is not built.

## Limits

Each explorer is stopped, and its last message kept, at 30 tool calls, about 10 minutes, 40,000 output tokens, 80% of the model's context window, or a 2 USD cap (the cap applies only when your provider reports cost). A stopped explorer is shown as "Stopped early" with the reason, never as finished.

## Where the record is

Each explorer writes `subagents/<id>.json` in the task's storage folder: its prompt (and a hash), the model requested and the model the provider reported, times, usage, every tool call (name, server and tool, a hash of the arguments, how it was approved and how it ended) and its report. Arguments are hashed, not stored.

The AI-Hydro server does not yet record which agent made a call; its run records carry the chat's id and the label "vscode". Until the server seals the explorer's identity, this file is the only place that says which agent made a call. Each MCP call an explorer makes also carries the explorer's id in the request metadata (`agent_id`, `parent_agent_id`, `role`), which the server ignores for now.

The task total in the header includes the explorers' tokens and cost.
