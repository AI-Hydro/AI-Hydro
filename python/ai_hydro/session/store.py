"""
AI-Hydro Research Session (HydroSession)
==========================================

Persistent research state across MCP tool calls in a single session.
Eliminates redundant API calls by caching results per gauge.

Storage: ~/.aihydro/sessions/<gauge_id>.json

Dynamic slots
-------------
Plugins can register their own result slots without editing core code:
    session.set("my_plugin_result", {...})
    session.get("my_plugin_result")  # → dict or None
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_SESSIONS_DIR = Path.home() / ".aihydro" / "sessions"
# Fallback rules dir when session has no workspace_dir set.
# In monorepo dev: store.py is 4 levels deep → repo root is the VS Code workspace.
# In installed (PyPI) use: workspace_dir on the session is the correct target.
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
_RULES_DIR_NAME = ".aihydrorules"

# Common slot names corresponding to built-in MCP tools.
# Plugins may add more — these are just the well-known ones.
_COMMON_SLOTS = (
    "watershed",
    "streamflow",
    "signatures",
    "geomorphic",
    "camels",
    "forcing",
    "twi",
    "cn",
    "model",
)


class HydroSession:
    """Persistent research state for a single USGS gauge across tool calls."""

    def __init__(self, gauge_id: str) -> None:
        self.gauge_id: str = gauge_id
        self.workspace_dir: str | None = None   # VS Code workspace path
        self._slots: dict[str, dict | None] = {}
        self.notes: list[str] = []
        self.created_at: str = datetime.now(timezone.utc).isoformat()
        self.updated_at: str = self.created_at

    # ------------------------------------------------------------------
    # Dynamic slot access
    # ------------------------------------------------------------------

    def set(self, slot: str, value: dict | None) -> None:
        """Store a result under the given slot name."""
        self._slots[slot] = value

    def get(self, slot: str) -> dict | None:
        """Retrieve a stored result by slot name."""
        return self._slots.get(slot)

    # ------------------------------------------------------------------
    # Backward-compat property accessors (used by mcp_server.py)
    # ------------------------------------------------------------------

    @property
    def watershed(self) -> dict | None:
        return self.get("watershed")

    @watershed.setter
    def watershed(self, v: dict | None) -> None:
        self.set("watershed", v)

    @property
    def streamflow(self) -> dict | None:
        return self.get("streamflow")

    @streamflow.setter
    def streamflow(self, v: dict | None) -> None:
        self.set("streamflow", v)

    @property
    def signatures(self) -> dict | None:
        return self.get("signatures")

    @signatures.setter
    def signatures(self, v: dict | None) -> None:
        self.set("signatures", v)

    @property
    def geomorphic(self) -> dict | None:
        return self.get("geomorphic")

    @geomorphic.setter
    def geomorphic(self, v: dict | None) -> None:
        self.set("geomorphic", v)

    @property
    def camels(self) -> dict | None:
        return self.get("camels")

    @camels.setter
    def camels(self, v: dict | None) -> None:
        self.set("camels", v)

    @property
    def forcing(self) -> dict | None:
        return self.get("forcing")

    @forcing.setter
    def forcing(self, v: dict | None) -> None:
        self.set("forcing", v)

    @property
    def twi(self) -> dict | None:
        return self.get("twi")

    @twi.setter
    def twi(self, v: dict | None) -> None:
        self.set("twi", v)

    @property
    def cn(self) -> dict | None:
        return self.get("cn")

    @cn.setter
    def cn(self, v: dict | None) -> None:
        self.set("cn", v)

    @property
    def model(self) -> dict | None:
        return self.get("model")

    @model.setter
    def model(self, v: dict | None) -> None:
        self.set("model", v)

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    @classmethod
    def _path(cls, gauge_id: str) -> Path:
        return _SESSIONS_DIR / f"{gauge_id}.json"

    @classmethod
    def load(cls, gauge_id: str) -> HydroSession:
        """Load an existing session, or return a new empty one."""
        path = cls._path(gauge_id)
        if not path.exists():
            return cls(gauge_id)
        with open(path) as f:
            raw = json.load(f)
        session = cls(gauge_id)
        # Load all known + any extra keys stored on disk
        for key, val in raw.items():
            if key in ("gauge_id", "workspace_dir", "notes",
                       "created_at", "updated_at"):
                continue
            # Any dict-valued key is treated as a slot
            if isinstance(val, dict) or val is None:
                session.set(key, val)
        session.workspace_dir = raw.get("workspace_dir")
        session.notes = raw.get("notes", [])
        session.created_at = raw.get("created_at", session.created_at)
        session.updated_at = raw.get("updated_at", session.updated_at)
        return session

    def save(self) -> None:
        """Persist session to disk and refresh .clinerules/research.md."""
        self.updated_at = datetime.now(timezone.utc).isoformat()
        _SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
        with open(self._path(self.gauge_id), "w") as f:
            json.dump(self._to_raw(), f, indent=2)
        self.write_research_context()

    def _to_raw(self) -> dict:
        raw: dict[str, Any] = {
            "gauge_id": self.gauge_id,
            "workspace_dir": self.workspace_dir,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "notes": self.notes,
        }
        for slot, val in self._slots.items():
            raw[slot] = val
        return raw

    # ------------------------------------------------------------------
    # Workspace file writing
    # ------------------------------------------------------------------

    def write_workspace_file(self, filename: str, content: Any) -> str | None:
        """
        Write content as JSON to workspace_dir/<filename>.

        Returns the absolute path written, or None if workspace_dir is not set.
        """
        if not self.workspace_dir:
            return None
        out_path = Path(self.workspace_dir) / filename
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w") as f:
            if isinstance(content, str):
                f.write(content)
            else:
                json.dump(content, f, indent=2)
        return str(out_path)

    # ------------------------------------------------------------------
    # Query helpers
    # ------------------------------------------------------------------

    def computed(self) -> list[str]:
        """List of slot names that have been computed."""
        return [k for k, v in self._slots.items() if v is not None]

    def pending(self) -> list[str]:
        """List of common slot names not yet computed."""
        return [s for s in _COMMON_SLOTS if self.get(s) is None]

    def summary(self) -> dict:
        """Return a compact summary suitable for agent reasoning."""
        return {
            "gauge_id": self.gauge_id,
            "computed": self.computed(),
            "pending": self.pending(),
            "notes": self.notes,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    def to_json(self) -> str:
        """Serialize the full session for agent reasoning."""
        return json.dumps(self._to_raw(), indent=2)

    def cite_all(self) -> str:
        """Combined BibTeX for every computed result that carries citations."""
        entries: list[str] = []
        for slot in self.computed():
            result = self.get(slot)
            if not result:
                continue
            meta = result.get("meta", {})
            for src in meta.get("sources", []):
                citation = src.get("citation")
                if citation and citation not in entries:
                    entries.append(citation)
        if not entries:
            return f"% No citations available for gauge {self.gauge_id}"
        return "\n\n".join(entries)

    # ------------------------------------------------------------------
    # .clinerules/research.md sync
    # ------------------------------------------------------------------

    def write_research_context(self) -> None:
        """
        Write a human-readable session digest to .aihydrorules/research.md.

        Location: workspace_dir/.aihydrorules/research.md when workspace_dir
        is set (installed use), otherwise repo-root/.aihydrorules/research.md
        (monorepo dev). The extension auto-loads this file into every
        conversation, giving the agent immediate awareness of research state
        without any explicit tool call.
        """
        lines: list[str] = [
            "# Current Research Session",
            f"**Gauge**: {self.gauge_id}{self._gauge_name_str()}",
            f"**Updated**: {self.updated_at[:10]}",
            "",
        ]

        computed = self.computed()
        pending = self.pending()

        if computed:
            lines.append(f"**Computed** ({len(computed)}): " + ", ".join(computed))
        if pending:
            lines.append(f"**Pending** ({len(pending)}): " + ", ".join(pending))
        lines.append("")

        # Key findings from each computed slot
        findings = self._key_findings()
        if findings:
            lines.append("## Key findings")
            lines.extend(findings)
            lines.append("")

        # Researcher notes
        if self.notes:
            lines.append("## Notes")
            for note in self.notes:
                lines.append(f"- {note}")
            lines.append("")

        if pending:
            lines.append("## Suggested next step")
            lines.append(f"Run `{pending[0]}` — call the corresponding MCP tool.")
            lines.append("")

        # Append researcher profile context if available
        try:
            from ai_hydro.session.persona import ResearcherProfile
            profile = ResearcherProfile.load()
            if not profile.is_blank():
                lines.append("")
                lines.append(profile.to_context_string())
        except Exception:
            pass

        lines.append("")
        lines.append(
            "> *Auto-generated by HydroSession — do not edit manually.*"
        )

        # Write to workspace_dir/.aihydrorules/research.md when workspace is
        # known (installed use), else fall back to repo root (monorepo dev).
        base = Path(self.workspace_dir) if self.workspace_dir else _REPO_ROOT
        research_md = base / _RULES_DIR_NAME / "research.md"
        research_md.parent.mkdir(parents=True, exist_ok=True)
        research_md.write_text("\n".join(lines))

    def _gauge_name_str(self) -> str:
        """Pull gauge name from cached watershed result if available."""
        if self.watershed:
            name = self.watershed.get("data", {}).get("gauge_name")
            if name:
                return f" ({name})"
        return ""

    def _key_findings(self) -> list[str]:
        """Extract a few key metrics from each computed slot."""
        findings: list[str] = []

        def _get(slot: str, *keys: str) -> Any:
            result = self.get(slot)
            if not result:
                return None
            data = result.get("data", {})
            for k in keys:
                if k in data:
                    return data[k]
            return None

        if self.watershed:
            area = _get("watershed", "area_km2")
            huc = _get("watershed", "huc_02")
            if area is not None:
                findings.append(f"- **Watershed area**: {area:.1f} km²" +
                                 (f"  (HUC-02: {huc})" if huc else ""))

        if self.streamflow:
            n = _get("streamflow", "n_days")
            if n:
                findings.append(f"- **Streamflow record**: {n:,} days")

        if self.signatures:
            bfi = _get("signatures", "baseflow_index")
            rr = _get("signatures", "runoff_ratio")
            qm = _get("signatures", "q_mean")
            if bfi is not None:
                findings.append(f"- **Baseflow index**: {bfi:.2f}")
            if rr is not None:
                findings.append(f"- **Runoff ratio**: {rr:.2f}")
            if qm is not None:
                findings.append(f"- **Mean discharge**: {qm:.3f} mm/d")

        if self.camels:
            p = _get("camels", "p_mean")
            ar = _get("camels", "aridity")
            el = _get("camels", "elev_mean")
            if p is not None:
                findings.append(f"- **Mean precip**: {p:.1f} mm/d")
            if ar is not None:
                findings.append(f"- **Aridity index**: {ar:.2f}")
            if el is not None:
                findings.append(f"- **Mean elevation**: {el:.0f} m")

        if self.twi:
            twi_m = _get("twi", "twi_mean")
            if twi_m is not None:
                findings.append(f"- **Mean TWI**: {twi_m:.2f}")

        if self.cn:
            cn_mean = _get("cn", "cn_mean")
            high_pct = _get("cn", "percent_high_cn")
            if cn_mean is not None:
                findings.append(f"- **Mean CN**: {cn_mean:.1f}")
            if high_pct is not None:
                findings.append(f"- **High CN area**: {high_pct:.1f}%")

        if self.model:
            result = self.model
            data = result.get("data", result)  # model slot stores the dict directly
            fw  = data.get("framework", "")
            mt  = data.get("model_type", "")
            nse = data.get("nse")
            kge = data.get("kge")
            label = f"{fw} {mt}".strip() or "model"
            parts = []
            if nse is not None:
                parts.append(f"NSE={nse:.3f}")
            if kge is not None:
                parts.append(f"KGE={kge:.3f}")
            findings.append(f"- **{label}**: " + (", ".join(parts) if parts else "trained"))

        return findings
