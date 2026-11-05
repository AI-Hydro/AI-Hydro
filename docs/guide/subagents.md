# Read-only subagents: explorers and the reviewer

Read-only explorers let AI-Hydro hand a focused question to a helper that has its own context window, so the main chat stays short. An explorer reads, searches and calls read-only tools, then reports back. It cannot change anything.

Turn them on in **Settings > Features > Subagents**. The setting is off by default and works the same on macOS, Windows and Linux.

Two kinds exist. An **explorer** reads and reports what it found. A **reviewer** checks statements against the evidence behind them, in a clean context, and reports each as supported, unsupported or unverifiable. Both are read-only and have the same tools, so the reviewer adds no authority. A reviewer's verdicts are **advice from a second model run**: they are not a review by a person, they are not evidence, and they never approve, reject or promote a claim. The chat never calls them "reviewed". "Unverifiable" means the reviewer could not check the statement against what it was given or could read; it does not mean the statement is wrong.

## When the model uses them

**The main agent works alone by default.** Most tasks never need a subagent: a subagent starts knowing nothing, costs money and a click, and the main agent must still open whatever it relies on. The model is told to check, in order, whether the work has to stay with it (a claim, a plan, an interpretation, an assumption, a binding or the final answer always does, even if you ask it to hand it off), whether a tool already does the job (the data and experiment tools, not agents, do batch work), whether a handful of calls would do, and whether each step needs the last one. Only then may it propose subagents, and it must name why: **bulk** (one wide question, much work left or a heavy context), **independent** (two or more separate, sizeable questions), **user_asked** (you asked), or **independent_check** (a reviewer: you asked, or a claim is about to go to promotion and `run_skeptic` and `audit_interpretation` have already run). Words such as "thorough" or "from several angles" are not a request for subagents.

This is guidance to the model, not a classifier: no code predicts whether a task deserves a subagent. What the code does is below. Launch always asks you, and a high approval rate is not evidence the policy works.

## What happens when the model uses them

1. The model proposes 1 to 4 prompts. A card shows a line headed **Why:** (the model's own one-line summary of what this will find and what it saves, capped at 140 characters; "No reason given" if it wrote none), then a line from the host: the reason it named, how full the main agent's context is, launches so far, launches you denied, agents used of the task limit, and "Reads will ask you" when read auto-approve is off. Under those: each prompt, the model they will use, their budget and what the agent cannot do. **Approve** or **Deny**. This is asked every time, whatever your auto-approve settings, including YOLO mode, and there is no "Always". The "Why:" line is the model's words, not the host's: no button depends on it.
   - If a launch names `independent` with one prompt, the card says "One explorer, so nothing runs in parallel". It does not refuse.
   - If you **deny with no message**, the model is told to carry on with its own tools and not to ask again unless you do. After **two** such denials in a row, further launches are refused with no card until you write to the main agent again. A denial with a message is you speaking, so it does not count toward that.
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
| Report findings to the main agent (a reviewer reports verdicts) | Start another subagent, or create, change or approve a claim |

An explorer is never more capable than the main agent. It ignores YOLO and "run all commands"; it auto-approves nothing beyond its own reads, and only when your own read settings already allow them. In a workspace you have not trusted, every explorer call asks.

Subagents cannot fetch data in parallel yet (several basins at once, for example). That needs a different definition, which is not built. The data and experiment tools already do batch work.

## What a subagent is given

Every subagent gets the same honesty rules as the main agent (cite a number with the run and field it came from, never invent one, abstain when the evidence is thin). Each also gets a short **study brief** in its first message when the chat has an active study: the study, gauge, period and plan, as the AI-Hydro server's own capped project digest gives them (at most 2,048 bytes). The host reads it; the model does not write it, and the card says when it is sent. It is reference data and grants nothing. Nothing else of the main conversation is passed on, and a subagent has no memory.

## Which model a subagent runs

By default, the main agent's model. A reviewer can run on another model so it is not the author checking its own work: set the `agentModels` state key to `{"reviewer": {"modelId": "..."}}` for a model on the same provider. Add `"providerId"` to use a different provider; that is allowed only for a definition that permits it (the reviewer), and then **the prompts and anything the reviewer reads go to that provider**, which the card says. An id or provider that cannot be applied refuses the launch with the reason; it never falls back to the main agent's model silently. An explorer ignores the setting and uses the main agent's model. There is no settings screen for it yet.

## Limits

Each explorer is stopped, and its last message kept, at 30 tool calls, about 10 minutes, 40,000 output tokens, 80% of the model's context window, or a 2 USD cap. A stopped explorer is shown as "Stopped early" with the reason, never as finished.

**Cost.** An explorer's cost is worked out the way the main chat works out its own: the provider's figure when it sends one, otherwise from the tokens and the model's listed prices. This holds for Anthropic, Vertex and OpenAI-compatible providers too. If the model has no verified price, the cost is shown as "cost unknown" and counts as nothing toward any dollar cap. **The task budget does not stop such a model**: the per-explorer limits (output tokens, tool calls, time) are the only limits, and the launch card says so. A task-level token cap for unpriced models is not built; `maxAgentsPerTask` is the cap that applies to them. A cost shown with a leading "at least" sign is a lower bound (a cache price is missing).

**Task budget.** All the explorers in one task together are held to a budget, **5 USD** by default, shown on the launch card with what is used so far. When it is reached the explorers still running stop at their next request ("task agent budget used"), and the main agent is told no more explorers can start. The total is read from the chat's own status rows, so it survives closing and reopening the task. A cap is a stop, not a guarantee: a request already under way when it is reached still finishes and is billed, and explorers launched together can each spend before the others are stopped, so the final cost can run over. The budget is the `agentBudgetUsd` state key (a number of dollars; 0 refuses all explorers). There is no settings screen for it yet.

**Agents per task.** A task may start at most **12** subagents in all its launches (`maxAgentsPerTask`; 0 refuses all). Unlike the dollar budget this needs no price, so it also bounds a model whose cost is unknown. A launch that would pass it is refused with the number left. The count is read from the chat's status rows. 12 is the orchestration report's untested value (three launches of four); under the delegation guidance it should almost never be reached.

**Start gap.** Explorers started together are started one second apart (`subagentStaggerMs`; 0 starts them together), and share one system prompt, so a provider's prompt cache can serve the second and third from the first one's prefix. Whether this pays off is checked on the installed build, not in the unit tests.

**Transient errors.** If a request fails with a rate limit, an overload, a server error or a dropped connection, the explorer retries it up to twice (about 1.5 and 3 seconds later) before it is shown as failed. Errors that will not change, such as a bad key, fail at once.

## Where the record is

Each subagent writes `subagents/<id>.json` in the task's storage folder: its definition (id, where it came from and a hash), its prompt (and a hash), the one-line purpose and reason the model gave at launch, a hash of the study brief it was given, the model requested and the provider it went to and the model the provider reported, times, usage, every tool call (name, server and tool, a hash of the arguments, how it was approved and how it ended), its report (or, for a reviewer, its review), and, when a budget or an error ended it without a report, its last message (`lastAssistantText`) and the reason (`error`). Arguments are hashed, not stored.

The AI-Hydro server does not yet record which agent made a call; its run records carry the chat's id and the label "vscode". Until the server seals the explorer's identity, this file is the only place that says which agent made a call. Each MCP call an explorer makes also carries the explorer's id in the request metadata (`agent_id`, `parent_agent_id`, `role`), which the server ignores for now.

The task total in the header includes the explorers' tokens and cost.
