"""
Path Resolution Utilities
=========================

Utility functions for resolving paths to knowledge base resources.

Version: 2.0.0
"""

from pathlib import Path
from typing import Optional
import os


def resolve_knowledge_path(relative_path: str) -> Path:
    """
    Resolve a relative path within the knowledge base.
    
    Args:
        relative_path: Path relative to knowledge base root
                      (e.g., "concepts/hydrology_concepts.json")
    
    Returns:
        Path: Absolute path to the resource
        
    Raises:
        FileNotFoundError: If the resolved path does not exist
    """
    from ..rag.config import RAGConfig
    
    base_path = RAGConfig.get_knowledge_base_path()
    full_path = base_path / relative_path
    
    if not full_path.exists():
        raise FileNotFoundError(
            f"Knowledge resource not found: {relative_path}\n"
            f"Looked in: {full_path}\n"
            f"Knowledge base: {base_path}"
        )
    
    return full_path.resolve()


def get_knowledge_base_root() -> Path:
    """
    Get the root directory of the knowledge base.
    
    Returns:
        Path: Absolute path to knowledge base root
    """
    from ..rag.config import RAGConfig
    return RAGConfig.get_knowledge_base_path()


def list_knowledge_files(category: str, extension: str = ".json") -> list[Path]:
    """
    List all files in a knowledge category.
    
    Args:
        category: Knowledge category (concepts, tools, workflows, etc.)
        extension: File extension to filter by (default: .json)
    
    Returns:
        list[Path]: List of file paths in the category
    """
    from ..rag.config import RAGConfig
    
    base_path = RAGConfig.get_knowledge_base_path()
    category_path = base_path / category
    
    if not category_path.exists():
        return []
    
    return list(category_path.glob(f"*{extension}"))


def resolve_with_fallback(primary_path: str, fallback_path: str) -> Optional[Path]:
    """
    Try to resolve a primary path, falling back to an alternative if not found.
    
    Args:
        primary_path: Primary path to try
        fallback_path: Fallback path if primary doesn't exist
    
    Returns:
        Optional[Path]: Resolved path, or None if neither exists
    """
    try:
        return resolve_knowledge_path(primary_path)
    except FileNotFoundError:
        try:
            return resolve_knowledge_path(fallback_path)
        except FileNotFoundError:
            return None


def get_cache_path(cache_name: str) -> Optional[Path]:
    """
    Get path to a cache file.
    
    Args:
        cache_name: Name of the cache file
    
    Returns:
        Optional[Path]: Path to cache file, or None if caching disabled
    """
    from ..rag.config import RAGConfig
    
    cache_dir = RAGConfig.get_cache_dir()
    if cache_dir is None:
        return None
    
    return cache_dir / cache_name


def ensure_cache_dir() -> Optional[Path]:
    """
    Ensure cache directory exists.
    
    Returns:
        Optional[Path]: Path to cache directory, or None if cannot be created
    """
    from ..rag.config import RAGConfig
    
    cache_dir = RAGConfig.get_cache_dir()
    if cache_dir is None:
        return None
    
    try:
        cache_dir.mkdir(parents=True, exist_ok=True)
        return cache_dir
    except (OSError, PermissionError):
        return None


def is_knowledge_base_available() -> bool:
    """
    Check if knowledge base is available.
    
    Returns:
        bool: True if knowledge base can be accessed
    """
    try:
        from ..rag.config import RAGConfig
        kb_path = RAGConfig.get_knowledge_base_path()
        return kb_path.exists() and kb_path.is_dir()
    except RuntimeError:
        return False


def get_environment_info() -> dict:
    """
    Get information about the current environment configuration.
    
    Returns:
        dict: Environment information including paths and settings
    """
    from ..rag.config import RAGConfig
    
    info = {
        "knowledge_base_available": False,
        "knowledge_base_path": None,
        "cache_available": False,
        "cache_path": None,
        "debug_mode": RAGConfig.is_debug_mode(),
        "trace_mode": RAGConfig.is_trace_mode(),
        "env_vars": {
            "AI_HYDRO_KNOWLEDGE_PATH": os.getenv('AI_HYDRO_KNOWLEDGE_PATH'),
            "AI_HYDRO_CACHE_DIR": os.getenv('AI_HYDRO_CACHE_DIR'),
            "AI_HYDRO_DEBUG": os.getenv('AI_HYDRO_DEBUG'),
            "AI_HYDRO_TRACE": os.getenv('AI_HYDRO_TRACE'),
        }
    }
    
    try:
        kb_path = RAGConfig.get_knowledge_base_path()
        info["knowledge_base_available"] = True
        info["knowledge_base_path"] = str(kb_path)
    except RuntimeError:
        pass
    
    cache_dir = RAGConfig.get_cache_dir()
    if cache_dir:
        info["cache_available"] = True
        info["cache_path"] = str(cache_dir)
    
    return info
