---
description: The words AI-Hydro uses in its own interface, and the spelling rules that a test enforces.
---

# Interface naming

One short list of the words the extension uses on screen. A test (`src/shared/__tests__/uiContract.test.ts`) fails the build when a user-visible string breaks the spelling rule below.

## Spelling

| Write | Never write |
|---|---|
| **AI-Hydro** | "AI Hydro", "AIHydro", "Ai-Hydro" in text a user reads |

Code identifiers (`AiHydroError`, `aihydro.settingsButtonClicked`, `AiHydroEnv`) keep their own casing. The test only looks at the spelling "AI" followed by a space and "Hydro". A line that has to quote the old spelling (for example a test of the guard) ends with the marker `brand-guard:allow`.

## Concepts

| Concept | Word on screen | Notes |
|---|---|---|
| A directory-bound container | **Project** | Planned; see the program plan. |
| One conversation | **Task** today, **Chat** after the chat-polish wave | The sidebar button and the command palette both say "New Task" now, so they agree. The rename to "Chat" is made once, with the chat-polish work, to avoid changing the chat transcript strings twice. |
| A basin or place research record | **Study** | The tool argument `session_id` stays as an accepted alias. |
| A delegated read-only helper | **Explorer** (generic: subagent) | Not shipped yet. |
| One recorded tool execution | **Run** | Numbers in answers cite runs. |
| The view that lists connected MCP servers | **Hydro Tools & Data Sources** | The same name in the command palette, the sidebar view title and the status popover link. Its tabs are Installed, Marketplace, Remote servers. "MCP" appears only inside that view, where the protocol is the subject. |

Never say "session" in new interface text: it means both a chat and a study in different places.

## Command palette

- Every command has the category `AI-Hydro`. The palette shows `AI-Hydro: <title>`, so a title never repeats the category.
- Titles that belong to a feature area start with the area: `Map: Save Scene`, not `AI-Hydro Map: Save Scene`.
- A command that only exists in a development build is hidden through `menus.commandPalette` with `when: aihydro.isDevMode`. A `when` on the command itself does nothing.

## Removed from the interface

Account sign-in, credits, voice dictation, "Generate Commit Message", the code-definition tool, the CLI subagent, the coding walkthrough. The browser tool is off by default and can be turned on in Settings > Browser.
