"""
RAG Configuration Module
========================

Centralized configuration for the RAG system, including path resolution
and environment variable support.

Version: 2.0.0
"""

from pathlib import Path
import os
from typing import Optional


class RAGConfig:
    """
    Configuration class for RAG system.
    
    Provides centralized path resolution and configuration management.
    Supports multiple deployment scenarios through environment variables.
    """
    
    @staticmethod
    def get_knowledge_base_path() -> Path:
        """
        Get path to knowledge base directory.
        
        Resolution order:
        1. Environment variable AI_HYDRO_KNOWLEDGE_PATH
        2. Relative to package: ../../../../knowledge/
        3. Fallback: package_data/knowledge/ (for pip install)
        
        Returns:
            Path: Path to knowledge base directory
            
        Raises:
            RuntimeError: If knowledge base cannot be found
        """
        # Check environment variable
        env_path = os.getenv('AI_HYDRO_KNOWLEDGE_PATH')
        if env_path:
            env_path_obj = Path(env_path)
            if env_path_obj.exists() and env_path_obj.is_dir():
                return env_path_obj.resolve()
            else:
                raise RuntimeError(
                    f"AI_HYDRO_KNOWLEDGE_PATH is set to '{env_path}' but path does not exist or is not a directory"
                )
        
        # Try relative path (development mode)
        # From: python/ai_hydro/rag/config.py
        # To: knowledge/
        package_dir = Path(__file__).parent
        knowledge_path = package_dir.parent.parent.parent / "knowledge"
        
        if knowledge_path.exists() and knowledge_path.is_dir():
            return knowledge_path.resolve()
        
        # Fallback to package data (pip install mode)
        fallback = package_dir / "package_data" / "knowledge"
        if fallback.exists() and fallback.is_dir():
            return fallback.resolve()
        
        # If nothing works, raise error with helpful message
        raise RuntimeError(
            "Knowledge base not found. Tried:\n"
            f"1. Environment variable AI_HYDRO_KNOWLEDGE_PATH: {env_path or 'not set'}\n"
            f"2. Relative path: {knowledge_path} (exists: {knowledge_path.exists()})\n"
            f"3. Package data: {fallback} (exists: {fallback.exists()})\n\n"
            "Please either:\n"
            "- Set AI_HYDRO_KNOWLEDGE_PATH environment variable to point to knowledge/ directory\n"
            "- Ensure knowledge/ directory exists in the project root\n"
            "- Reinstall the package if using pip install"
        )
    
    @staticmethod
    def get_concepts_path() -> Path:
        """Get path to concepts directory."""
        return RAGConfig.get_knowledge_base_path() / "concepts"
    
    @staticmethod
    def get_tools_path() -> Path:
        """Get path to tools directory."""
        return RAGConfig.get_knowledge_base_path() / "tools"
    
    @staticmethod
    def get_workflows_path() -> Path:
        """Get path to workflows directory."""
        return RAGConfig.get_knowledge_base_path() / "workflows"
    
    @staticmethod
    def get_templates_path() -> Path:
        """Get path to templates directory."""
        return RAGConfig.get_knowledge_base_path() / "templates"
    
    @staticmethod
    def get_datasets_path() -> Path:
        """Get path to datasets directory."""
        return RAGConfig.get_knowledge_base_path() / "datasets"
    
    @staticmethod
    def is_debug_mode() -> bool:
        """Check if debug mode is enabled via environment variable."""
        return os.getenv('AI_HYDRO_DEBUG', '').lower() in ('true', '1', 'yes')
    
    @staticmethod
    def is_trace_mode() -> bool:
        """Check if trace mode is enabled via environment variable."""
        return os.getenv('AI_HYDRO_TRACE', '').lower() in ('true', '1', 'yes')
    
    @staticmethod
    def get_cache_dir() -> Optional[Path]:
        """
        Get cache directory for embeddings and processed knowledge.
        
        Returns:
            Optional[Path]: Cache directory path, or None if caching disabled
        """
        cache_dir = os.getenv('AI_HYDRO_CACHE_DIR')
        if cache_dir:
            cache_path = Path(cache_dir)
            cache_path.mkdir(parents=True, exist_ok=True)
            return cache_path
        
        # Default cache location: python/cache/
        default_cache = Path(__file__).parent.parent.parent / "cache"
        if not default_cache.exists():
            try:
                default_cache.mkdir(parents=True, exist_ok=True)
            except (OSError, PermissionError):
                # If can't create cache, return None (caching disabled)
                return None
        
        return default_cache if default_cache.exists() else None


# Convenience functions for backward compatibility
def get_knowledge_base_path() -> Path:
    """Convenience function for getting knowledge base path."""
    return RAGConfig.get_knowledge_base_path()


def get_concepts_path() -> Path:
    """Convenience function for getting concepts path."""
    return RAGConfig.get_concepts_path()


def get_tools_path() -> Path:
    """Convenience function for getting tools path."""
    return RAGConfig.get_tools_path()


def get_workflows_path() -> Path:
    """Convenience function for getting workflows path."""
    return RAGConfig.get_workflows_path()
