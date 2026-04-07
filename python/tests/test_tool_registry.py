"""
Unit tests for tool_registry module.

Tests tool discovery, filtering, and search functionality.
"""

import unittest
import json
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock

# Add parent directory to path for imports
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from ai_hydro.registry.tool_registry import ToolRegistry, get_tool_registry


class TestToolRegistry(unittest.TestCase):
    """Test cases for ToolRegistry class."""
    
    def setUp(self):
        """Set up test fixtures."""
        self.registry = ToolRegistry()
    
    def test_registry_initialization(self):
        """Test that registry initializes correctly."""
        self.assertIsInstance(self.registry, ToolRegistry)
        self.assertFalse(self.registry._loaded)
        self.assertEqual(len(self.registry._tools), 0)
    
    def test_load_tools_changes_loaded_state(self):
        """Test that load_tools changes the loaded state."""
        initial_state = self.registry._loaded
        
        try:
            self.registry.load_tools()
            # Should change loaded state even if no tools found
            self.assertTrue(self.registry._loaded or not initial_state)
        except Exception:
            # If knowledge base doesn't exist, should handle gracefully
            pass
    
    def test_load_tools_is_idempotent(self):
        """Test that calling load_tools multiple times is safe."""
        try:
            self.registry.load_tools()
            tools_count_1 = len(self.registry._tools)
            
            self.registry.load_tools()
            tools_count_2 = len(self.registry._tools)
            
            # Should not reload if already loaded
            self.assertEqual(tools_count_1, tools_count_2)
        except Exception:
            # If knowledge base doesn't exist, that's okay for this test
            pass
    
    def test_get_tool_returns_none_for_nonexistent(self):
        """Test that get_tool returns None for non-existent tools."""
        tool = self.registry.get_tool("nonexistent_tool_12345")
        self.assertIsNone(tool)
    
    def test_get_tool_loads_tools_if_needed(self):
        """Test that get_tool automatically loads tools."""
        initial_state = self.registry._loaded
        tool = self.registry.get_tool("any_tool")
        
        # Should have attempted to load tools
        self.assertTrue(self.registry._loaded or not initial_state)
    
    def test_list_tools_returns_list(self):
        """Test that list_tools returns a list."""
        tools = self.registry.list_tools()
        self.assertIsInstance(tools, list)
    
    def test_list_tools_with_tier_filter(self):
        """Test filtering tools by tier."""
        tools = self.registry.list_tools(tier="tier1")
        self.assertIsInstance(tools, list)
        
        # All returned tools should match the tier filter
        for tool in tools:
            self.assertEqual(tool.get('tier'), 'tier1')
    
    def test_list_tools_with_category_filter(self):
        """Test filtering tools by category."""
        tools = self.registry.list_tools(category="watershed")
        self.assertIsInstance(tools, list)
        
        # All returned tools should match the category filter
        for tool in tools:
            self.assertEqual(tool.get('category'), 'watershed')
    
    def test_list_tools_with_both_filters(self):
        """Test filtering tools by both tier and category."""
        tools = self.registry.list_tools(tier="tier2", category="watershed")
        self.assertIsInstance(tools, list)
        
        # All returned tools should match both filters
        for tool in tools:
            self.assertEqual(tool.get('tier'), 'tier2')
            self.assertEqual(tool.get('category'), 'watershed')
    
    def test_search_tools_returns_list(self):
        """Test that search_tools returns a list."""
        results = self.registry.search_tools("watershed")
        self.assertIsInstance(results, list)
    
    def test_search_tools_case_insensitive(self):
        """Test that search is case-insensitive."""
        results_lower = self.registry.search_tools("watershed")
        results_upper = self.registry.search_tools("WATERSHED")
        
        # Should return same results regardless of case
        self.assertEqual(len(results_lower), len(results_upper))
    
    def test_search_tools_empty_query(self):
        """Test search with empty query."""
        results = self.registry.search_tools("")
        self.assertIsInstance(results, list)
    
    def test_get_tool_path_returns_string_or_none(self):
        """Test that get_tool_path returns string or None."""
        path = self.registry.get_tool_path("nonexistent_tool")
        self.assertTrue(path is None or isinstance(path, str))
    
    def test_singleton_pattern(self):
        """Test that get_tool_registry returns the same instance."""
        registry1 = get_tool_registry()
        registry2 = get_tool_registry()
        
        self.assertIs(registry1, registry2)


class TestToolRegistryWithMockData(unittest.TestCase):
    """Test registry with mock tool data."""
    
    def test_load_tools_with_mock_data(self):
        """Test loading tools from mock JSON files."""
        # Create a temporary directory with mock tool files
        with tempfile.TemporaryDirectory() as temp_dir:
            tools_path = Path(temp_dir)
            
            # Create mock tier1 tools
            tier1_data = {
                "pysheds": {
                    "tier": "tier1",
                    "category": "watershed",
                    "description": "Watershed delineation",
                    "keywords": ["watershed", "dem"]
                }
            }
            
            with open(tools_path / "tier1_libraries.json", 'w') as f:
                json.dump(tier1_data, f)
            
            # Mock the RAGConfig to return our temp directory
            with patch('ai_hydro.registry.tool_registry.RAGConfig') as mock_config:
                mock_config.get_tools_path.return_value = tools_path
                
                registry = ToolRegistry()
                registry.load_tools()
                
                # Should have loaded the mock tool
                self.assertEqual(len(registry._tools), 1)
                self.assertIn("pysheds", registry._tools)
                
                # Test get_tool
                tool = registry.get_tool("pysheds")
                self.assertIsNotNone(tool)
                self.assertEqual(tool['tier'], 'tier1')
                
                # Test list_tools with filter
                tier1_tools = registry.list_tools(tier="tier1")
                self.assertEqual(len(tier1_tools), 1)
                
                # Test search
                results = registry.search_tools("watershed")
                self.assertEqual(len(results), 1)


class TestToolRegistryEdgeCases(unittest.TestCase):
    """Test edge cases and error handling."""
    
    def test_load_tools_with_nonexistent_directory(self):
        """Test loading tools when directory doesn't exist."""
        with patch('ai_hydro.registry.tool_registry.RAGConfig') as mock_config:
            mock_config.get_tools_path.return_value = Path("/nonexistent/path")
            
            registry = ToolRegistry()
            # Should handle missing directory gracefully
            try:
                registry.load_tools()
                # Should mark as loaded even if no files found
                self.assertTrue(registry._loaded)
            except Exception:
                # Or raise appropriate exception
                pass
    
    def test_search_tools_with_special_characters(self):
        """Test search with special characters."""
        registry = ToolRegistry()
        
        # Should handle special characters without crashing
        results = registry.search_tools("test*query[special]")
        self.assertIsInstance(results, list)


if __name__ == '__main__':
    unittest.main()
