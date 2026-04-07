"""
AI-Hydro Research Session (HydroSession)
==========================================

Persistent research state across MCP tool calls in a single session.
Eliminates redundant API calls by caching results per gauge.

Storage: ~/.aihydro/sessions/<gauge_id>.json
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_SESSIONS_DIR = Path.home() / ".aihydro" / "sessions"
# Project root: python/ai_hydro/session.py → up 3 levels
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_RESEARCH_MD = _PROJECT_ROOT / ".clinerules" / "research.md"

# Slot names that correspond to the main MCP tools
_RESULT_SLOTS = (
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
        self.watershed: dict | None = None
        self.streamflow: dict | None = None
        self.signatures: dict | None = None
        self.geomorphic: dict | None = None
        self.camels: dict | None = None
        self.forcing: dict | None = None
        self.twi: dict | None = None
        self.cn: dict | None = None
        self.model: dict | None = None
        self.notes: list[str] = []
        self.created_at: str = datetime.now(timezone.utc).isoformat()
        self.updated_at: str = self.created_at

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
        for slot in _RESULT_SLOTS:
            setattr(session, slot, raw.get(slot))
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
        for slot in _RESULT_SLOTS:
            raw[slot] = getattr(self, slot)
        return raw

    # ------------------------------------------------------------------
    # Workspace file writing
    # ------------------------------------------------------------------

    def write_workspace_file(self, filename: str, content: Any) -> str | None:
        """
        Write content as JSON to workspace_dir/<filename>.

        Returns the absolute path written, or None if workspace_dir is not set.
        Silently does nothing if workspace_dir is unset — the agent can fall
        back to write_file if it wants.
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
        return [s for s in _RESULT_SLOTS if getattr(self, s) is not None]

    def pending(self) -> list[str]:
        """List of slot names not yet computed."""
        return [s for s in _RESULT_SLOTS if getattr(self, s) is None]

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
            result = getattr(self, slot)
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
        Write a human-readable session digest to .clinerules/research.md.

        This file is auto-loaded into every AI-Hydro conversation, giving
        the agent immediate awareness of research state without any tool call.
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

        lines.append(
            "> *Auto-generated by HydroSession — do not edit manually.*"
        )

        _RESEARCH_MD.parent.mkdir(parents=True, exist_ok=True)
        _RESEARCH_MD.write_text("\n".join(lines))

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
            result = getattr(self, slot, None)
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
