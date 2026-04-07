"""
AI-Hydro Utilities Module
=========================

Shared utilities for AI-Hydro including:
- Path resolution
- Validation
- Helper functions

Version: 2.0.0
"""

from .path_resolver import resolve_knowledge_path, get_knowledge_base_root
from .validators import validate_json_schema, validate_workflow_yaml

__all__ = [
    'resolve_knowledge_path',
    'get_knowledge_base_root',
    'validate_json_schema',
    'validate_workflow_yaml'
]
__version__ = '2.0.0'
