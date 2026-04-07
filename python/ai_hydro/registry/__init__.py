"""
Registry Package for AI-Hydro
==============================

Provides registration and discovery of tools, workflows, and knowledge.
"""

# Avoid circular imports by using lazy imports

__all__ = [
    'ToolRegistry', 
    'WorkflowRegistry', 
    'KnowledgeLoader',
    'get_tool_registry',
    'get_workflow_registry', 
    'get_knowledge_loader'
]


def __getattr__(name):
    """Lazy import to avoid circular dependencies."""
    if name == 'ToolRegistry':
        from .tool_registry import ToolRegistry
        return ToolRegistry
    elif name == 'WorkflowRegistry':
        from .workflow_registry import WorkflowRegistry
        return WorkflowRegistry
    elif name == 'KnowledgeLoader':
        from .loader import KnowledgeLoader
        return KnowledgeLoader
    elif name == 'get_tool_registry':
        from .tool_registry import get_tool_registry
        return get_tool_registry
    elif name == 'get_workflow_registry':
        from .workflow_registry import get_workflow_registry
        return get_workflow_registry
    elif name == 'get_knowledge_loader':
        from .loader import get_knowledge_loader
        return get_knowledge_loader
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
