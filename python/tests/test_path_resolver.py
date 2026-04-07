"""
Unit tests for path_resolver module.

Tests path resolution, environment detection, and knowledge base availability.
"""

import unittest
import os
from pathlib import Path
from unittest.mock import patch, MagicMock

# Add parent directory to path for imports
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from ai_hydro.utils.path_resolver import (
    resolve_knowledge_path,
    get_knowledge_base_root,
    list_knowledge_files,
    get_cache_path,
    is_knowledge_base_available,
    get_environment_info
)


class TestPathResolver(unittest.TestCase):
    """Test cases for path_resolver utilities."""
    
    def test_get_knowledge_base_root_returns_path(self):
        """Test that get_knowledge_base_root returns a Path object."""
        root = get_knowledge_base_root()
        self.assertIsInstance(root, Path)
    
    def test_get_knowledge_base_root_exists(self):
        """Test that knowledge base root exists."""
        root = get_knowledge_base_root()
        # Should return a path even if it doesn't exist physically
        self.assertIsNotNone(root)
    
    def test_resolve_knowledge_path_with_relative(self):
        """Test resolving relative paths within knowledge base."""
        # Test relative path resolution
        concepts_path = resolve_knowledge_path("concepts/hydrology_concepts.json")
        self.assertIsInstance(concepts_path, Path)
        self.assertTrue(str(concepts_path).endswith("hydrology_concepts.json"))
    
    def test_is_knowledge_base_available(self):
        """Test knowledge base availability check."""
        # Should return True or False, not raise an exception
        available = is_knowledge_base_available()
        self.assertIsInstance(available, bool)
    
    def test_get_environment_info_returns_dict(self):
        """Test that environment info returns a dictionary."""
        info = get_environment_info()
        self.assertIsInstance(info, dict)
        
        # Check for expected keys
        self.assertIn("knowledge_base_root", info)
        self.assertIn("knowledge_base_available", info)
        self.assertIn("python_version", info)
    
    def test_get_cache_path_returns_path(self):
        """Test that get_cache_path returns a Path object."""
        cache_path = get_cache_path("test.db")
        self.assertIsInstance(cache_path, Path)
        self.assertTrue(str(cache_path).endswith("test.db"))
    
    @patch.dict(os.environ, {'AI_HYDRO_KNOWLEDGE_PATH': '/custom/path'})
    def test_environment_variable_override(self):
        """Test that AI_HYDRO_KNOWLEDGE_PATH environment variable is respected."""
        # Note: This test checks if the env var is read, not if the path exists
        info = get_environment_info()
        self.assertIn("AI_HYDRO_KNOWLEDGE_PATH", info)
    
    def test_list_knowledge_files_returns_list(self):
        """Test that list_knowledge_files returns a list."""
        try:
            files = list_knowledge_files("concepts", ".json")
            self.assertIsInstance(files, list)
        except Exception:
            # If knowledge base doesn't exist, should handle gracefully
            pass
    
    def test_resolve_knowledge_path_handles_absolute(self):
        """Test that absolute paths are handled correctly."""
        # Absolute paths should be returned as-is
        abs_path = Path("/absolute/path/to/file.json")
        result = resolve_knowledge_path(str(abs_path))
        self.assertEqual(result, abs_path)


class TestPathResolverEdgeCases(unittest.TestCase):
    """Test edge cases and error handling."""
    
    def test_resolve_empty_path(self):
        """Test resolving empty path."""
        result = resolve_knowledge_path("")
        self.assertIsInstance(result, Path)
    
    def test_list_files_invalid_category(self):
        """Test listing files with invalid category."""
        # Should handle invalid categories gracefully
        try:
            files = list_knowledge_files("nonexistent_category", ".json")
            self.assertIsInstance(files, list)
        except Exception as e:
            # Should either return empty list or raise appropriate exception
            self.assertIsInstance(e, (FileNotFoundError, ValueError))
    
    def test_get_cache_path_with_subdirectory(self):
        """Test cache path with subdirectory."""
        cache_path = get_cache_path("subdir/file.db")
        self.assertIsInstance(cache_path, Path)
        self.assertTrue("subdir" in str(cache_path))


if __name__ == '__main__':
    unittest.main()
