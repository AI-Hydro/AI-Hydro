#!/usr/bin/env python3
"""Export the aihydro-tools annotation table as the checked-in tool list the explorer-policy tests read.

    python3 scripts/export-aihydro-tool-surface.py <path to ai_hydro/mcp/tool_annotations.toml> <source ref> \
        > src/core/task/__tests__/fixtures/aihydro-tool-surface.json

The list holds one row per registered tool: its name and the annotation fields the host reads (readOnlyHint,
openWorldHint, destructiveHint, and the aihydro/ vocabulary keys). It is a snapshot, not a live view: regenerate it
when the pinned aihydro-tools release changes, and review the diff. `source` records which release it came from.
"""
import json
import sys
import tomllib

KEEP = ("readOnlyHint", "openWorldHint", "destructiveHint", "effect", "audience", "requiresConsent")


def main() -> None:
    path, ref = sys.argv[1], sys.argv[2]
    with open(path, "rb") as handle:
        table = tomllib.load(handle)
    tools = {name: {key: row[key] for key in KEEP if key in row} for name, row in sorted(table.items())}
    json.dump({"source": f"aihydro-tools {ref} ai_hydro/mcp/tool_annotations.toml", "tools": tools}, sys.stdout, indent=1)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
