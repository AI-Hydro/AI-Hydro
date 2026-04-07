"""
AI-Hydro Core Types
====================

Standardized data contracts for all AI-Hydro tools and community contributions.

Every tool in the AI-Hydro ecosystem returns a HydroResult — a typed,
JSON-serializable envelope containing the output data and full FAIR provenance
metadata. This ensures:

- Agent composability: outputs of one tool are valid inputs to the next
- FAIR compliance: every result is Findable, Accessible, Interoperable, Reusable
- Reproducibility: the metadata IS the methods section
- Anti-hallucination: agents reason over structured data, not text blobs

Usage
-----
>>> from ai_hydro.core import HydroResult, HydroMeta, DataSource, ToolError
>>> # Tools return HydroResult; access data via result.data
>>> result = delineate_watershed('01031500')
>>> print(result.data['area_km2'])
>>> print(result.meta.cite())
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from pydantic import BaseModel, Field, model_validator


# ---------------------------------------------------------------------------
# Data provenance building blocks
# ---------------------------------------------------------------------------

class DataSource(BaseModel):
    """A single data source used in computing a result."""
    name: str = Field(..., description="Short name, e.g. 'USGS NLDI'")
    url: str | None = Field(None, description="API endpoint or dataset URL")
    accessed: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).date().isoformat(),
        description="ISO date the source was accessed"
    )
    citation: str | None = Field(
        None,
        description="BibTeX or APA citation for the data source"
    )


class HydroMeta(BaseModel):
    """
    FAIR provenance metadata attached to every HydroResult.

    Contains everything needed to reproduce the computation and cite
    the data sources in a manuscript methods section.
    """
    tool: str = Field(..., description="Full tool identifier, e.g. 'ai_hydro.tools.watershed.delineate_watershed'")
    version: str = Field(..., description="Package version, e.g. '1.0.0'")
    gauge_id: str | None = Field(None, description="USGS gauge ID if applicable")
    sources: list[DataSource] = Field(default_factory=list)
    params: dict[str, Any] = Field(default_factory=dict, description="Exact inputs used")
    computed_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
        description="ISO 8601 timestamp of computation"
    )

    def cite(self) -> str:
        """
        Generate a BibTeX block for all data sources used.

        Returns
        -------
        str
            BibTeX entries, one per data source that has a citation.
        """
        entries = []
        for src in self.sources:
            if src.citation:
                entries.append(src.citation)
        if not entries:
            return f"% No citations available for {self.tool}"
        return "\n\n".join(entries)

    def to_methods_text(self) -> str:
        """
        Generate a manuscript-ready methods paragraph.

        Returns
        -------
        str
            Plain-text methods description suitable for a paper.
        """
        source_names = [s.name for s in self.sources]
        sources_str = ", ".join(source_names) if source_names else "undocumented sources"
        params_str = ", ".join(f"{k}={v!r}" for k, v in self.params.items())
        return (
            f"This result was computed using {self.tool} (version {self.version}) "
            f"with parameters: {params_str}. "
            f"Data sourced from: {sources_str}. "
            f"Computed on {self.computed_at[:10]}."
        )


# ---------------------------------------------------------------------------
# The universal tool output type
# ---------------------------------------------------------------------------

class HydroResult(BaseModel):
    """
    Standardized output for every AI-Hydro tool.

    All data is stored in a flat, JSON-serializable dictionary.
    Geometry is always GeoJSON (dict), never Shapely.
    Time series are always {dates: [...], values: [...]} dicts.
    All numeric values are Python float/int, never numpy scalars.

    Examples
    --------
    >>> result = delineate_watershed('01031500')
    >>> result.data['area_km2']          # float
    >>> result.data['geometry_geojson']  # GeoJSON dict
    >>> result.meta.cite()               # BibTeX string
    >>> result.to_dict()                 # fully serializable dict
    """
    data: dict[str, Any] = Field(..., description="Flat, JSON-serializable output dict")
    meta: HydroMeta

    @model_validator(mode='after')
    def _validate_json_serializable(self) -> HydroResult:
        """Ensure data dict contains only JSON-serializable values."""
        import json
        try:
            json.dumps(self.data)
        except (TypeError, ValueError) as e:
            raise ValueError(
                f"HydroResult.data must be fully JSON-serializable. "
                f"Found non-serializable value: {e}. "
                f"Convert Shapely geometries to GeoJSON dicts, "
                f"numpy arrays to lists, and numpy scalars to Python floats."
            ) from e
        return self

    def to_dict(self) -> dict[str, Any]:
        """Return fully JSON-serializable dict including metadata."""
        return {
            "data": self.data,
            "meta": self.meta.model_dump()
        }


# ---------------------------------------------------------------------------
# Structured error type
# ---------------------------------------------------------------------------

class ToolError(Exception):
    """
    Structured error from an AI-Hydro tool.

    Provides machine-readable error context so agents can reason
    about recovery — try an alternative, ask for clarification, etc.
    """
    def __init__(
        self,
        code: str,
        message: str,
        tool: str,
        recovery: str | None = None,
        alternatives: list[str] | None = None,
    ):
        """
        Parameters
        ----------
        code : str
            Short error code, e.g. 'GAUGE_NOT_FOUND', 'NETWORK_ERROR'
        message : str
            Human-readable error description
        tool : str
            Tool that raised the error
        recovery : str, optional
            Suggested recovery action for the agent
        alternatives : list[str], optional
            Alternative gauge IDs, methods, or approaches to try
        """
        super().__init__(message)
        self.code = code
        self.message = message
        self.tool = tool
        self.recovery = recovery
        self.alternatives = alternatives or []

    def to_dict(self) -> dict:
        return {
            "error": True,
            "code": self.code,
            "message": self.message,
            "tool": self.tool,
            "recovery": self.recovery,
            "alternatives": self.alternatives,
        }


# ---------------------------------------------------------------------------
# Community tool base class
# ---------------------------------------------------------------------------

class HydroTool:
    """
    Base class for all AI-Hydro community tools.

    Community contributors subclass this and implement `run()` and `validate()`.
    The MCP server discovers and registers all subclasses automatically.

    Required class attributes
    -------------------------
    name : str
        Snake-case tool name used as MCP endpoint name
    description : str
        One-sentence description (becomes MCP tool description)
    category : str
        Tool category, e.g. 'watershed', 'snow', 'groundwater'
    version : str
        Semantic version string
    data_sources : list[DataSource]
        Data sources this tool accesses

    Required methods
    ----------------
    run(inputs) -> HydroResult
        Execute the tool and return a HydroResult
    validate() -> bool
        Return True if tool passes self-check on reference data
        CI runs this on every pull request.
    """
    name: str = ""
    description: str = ""
    category: str = ""
    version: str = "0.1.0"
    data_sources: list[DataSource] = []

    def run(self, **kwargs) -> HydroResult:
        raise NotImplementedError("Subclasses must implement run()")

    def validate(self) -> bool:
        raise NotImplementedError("Subclasses must implement validate()")

    @classmethod
    def get_schema(cls) -> dict:
        """Return MCP-compatible tool schema."""
        return {
            "name": cls.name,
            "description": cls.description,
            "category": cls.category,
            "version": cls.version,
            "sources": [s.model_dump() for s in cls.data_sources],
        }
