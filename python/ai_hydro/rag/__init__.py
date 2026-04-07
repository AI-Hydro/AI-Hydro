"""
AI-Hydro RAG (Retrieval-Augmented Generation) Module
====================================================

This module provides RAG capabilities for AI-Hydro, including:
- Knowledge base querying
- Tool recommendations
- Workflow suggestions
- Hydrological concept lookup

Version: 2.0.0
"""

# Avoid circular imports by using lazy imports
# Import these modules directly when needed instead of at package level

__all__ = ['RAGEngine', 'RAGConfig']
__version__ = '2.0.0'


def __getattr__(name):
    """Lazy import to avoid circular dependencies."""
    if name == 'RAGEngine':
        from .engine import RAGEngine
        return RAGEngine
    elif name == 'RAGConfig':
        from .config import RAGConfig
        return RAGConfig
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
