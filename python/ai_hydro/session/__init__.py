"""AI-Hydro Session Management.

Persistent research state across MCP tool calls.

v1.2 additions:
  - ProjectSession  : project-level state spanning multiple gauges and topics
  - ResearcherProfile : persistent researcher persona built from interactions
"""

from ai_hydro.session.store import HydroSession
from ai_hydro.session.project import ProjectSession
from ai_hydro.session.persona import ResearcherProfile

__all__ = ["HydroSession", "ProjectSession", "ResearcherProfile"]
