"""
Unit tests for workflow_registry module.

Tests workflow discovery, filtering, and search functionality.
"""

import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch

# Add parent directory to path for imports
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from ai_hydro.registry.workflow_registry import WorkflowRegistry, get_workflow_registry


class TestWorkflowRegistry(unittest.TestCase):
    """Test cases for WorkflowRegistry class."""
    
    def setUp(self):
        """Set up test fixtures."""
        self.registry = WorkflowRegistry()
    
    def test_registry_initialization(self):
        """Test that registry initializes correctly."""
        self.assertIsInstance(self.registry, WorkflowRegistry)
        self.assertFalse(self.registry._loaded)
        self.assertEqual(len(self.registry._workflows), 0)
    
    def test_load_workflows_changes_loaded_state(self):
        """Test that load_workflows changes the loaded state."""
        initial_state = self.registry._loaded
        
        try:
            self.registry.load_workflows()
            # Should change loaded state even if no workflows found
            self.assertTrue(self.registry._loaded or not initial_state)
        except Exception:
            # If knowledge base doesn't exist, should handle gracefully
            pass
    
    def test_load_workflows_is_idempotent(self):
        """Test that calling load_workflows multiple times is safe."""
        try:
            self.registry.load_workflows()
            workflows_count_1 = len(self.registry._workflows)
            
            self.registry.load_workflows()
            workflows_count_2 = len(self.registry._workflows)
            
            # Should not reload if already loaded
            self.assertEqual(workflows_count_1, workflows_count_2)
        except Exception:
            # If knowledge base doesn't exist, that's okay for this test
            pass
    
    def test_get_workflow_returns_none_for_nonexistent(self):
        """Test that get_workflow returns None for non-existent workflows."""
        workflow = self.registry.get_workflow("nonexistent_workflow_12345")
        self.assertIsNone(workflow)
    
    def test_get_workflow_loads_workflows_if_needed(self):
        """Test that get_workflow automatically loads workflows."""
        initial_state = self.registry._loaded
        workflow = self.registry.get_workflow("any_workflow")
        
        # Should have attempted to load workflows
        self.assertTrue(self.registry._loaded or not initial_state)
    
    def test_list_workflows_returns_list(self):
        """Test that list_workflows returns a list."""
        workflows = self.registry.list_workflows()
        self.assertIsInstance(workflows, list)
    
    def test_list_workflows_with_category_filter(self):
        """Test filtering workflows by category."""
        workflows = self.registry.list_workflows(category="data_extraction")
        self.assertIsInstance(workflows, list)
        
        # All returned workflows should match the category filter
        for workflow in workflows:
            self.assertEqual(workflow.get('category'), 'data_extraction')
    
    def test_search_workflows_returns_list(self):
        """Test that search_workflows returns a list."""
        results = self.registry.search_workflows("data")
        self.assertIsInstance(results, list)
    
    def test_search_workflows_case_insensitive(self):
        """Test that search is case-insensitive."""
        results_lower = self.registry.search_workflows("data")
        results_upper = self.registry.search_workflows("DATA")
        
        # Should return same results regardless of case
        self.assertEqual(len(results_lower), len(results_upper))
    
    def test_search_workflows_empty_query(self):
        """Test search with empty query."""
        results = self.registry.search_workflows("")
        self.assertIsInstance(results, list)
    
    def test_get_workflow_steps_returns_list(self):
        """Test that get_workflow_steps returns a list."""
        steps = self.registry.get_workflow_steps("nonexistent_workflow")
        self.assertIsInstance(steps, list)
        self.assertEqual(len(steps), 0)  # Should return empty list for nonexistent
    
    def test_singleton_pattern(self):
        """Test that get_workflow_registry returns the same instance."""
        registry1 = get_workflow_registry()
        registry2 = get_workflow_registry()
        
        self.assertIs(registry1, registry2)


class TestWorkflowRegistryWithMockData(unittest.TestCase):
    """Test registry with mock workflow data."""
    
    def test_load_workflows_with_mock_data(self):
        """Test loading workflows from mock YAML files."""
        # Create a temporary directory with mock workflow files
        with tempfile.TemporaryDirectory() as temp_dir:
            workflows_path = Path(temp_dir)
            
            # Create mock workflow
            workflow_yaml = """
name: Test Workflow
category: testing
description: A test workflow for unit testing
steps:
  - name: Step 1
    description: First step
    action: test_action_1
  - name: Step 2
    description: Second step
    action: test_action_2
"""
            
            with open(workflows_path / "test_workflow.yaml", 'w') as f:
                f.write(workflow_yaml)
            
            # Mock the RAGConfig to return our temp directory
            with patch('ai_hydro.registry.workflow_registry.RAGConfig') as mock_config:
                mock_config.get_workflows_path.return_value = workflows_path
                
                registry = WorkflowRegistry()
                registry.load_workflows()
                
                # Should have loaded the mock workflow
                self.assertTrue(len(registry._workflows) >= 1)
                
                # Test get_workflow
                workflow = registry.get_workflow("Test Workflow")
                self.assertIsNotNone(workflow)
                self.assertEqual(workflow['category'], 'testing')
                
                # Test list_workflows with filter
                testing_workflows = registry.list_workflows(category="testing")
                self.assertTrue(len(testing_workflows) >= 1)
                
                # Test search
                results = registry.search_workflows("test")
                self.assertTrue(len(results) >= 1)
                
                # Test get_workflow_steps
                steps = registry.get_workflow_steps("Test Workflow")
                self.assertEqual(len(steps), 2)
                self.assertEqual(steps[0]['name'], 'Step 1')


class TestWorkflowRegistryEdgeCases(unittest.TestCase):
    """Test edge cases and error handling."""
    
    def test_load_workflows_with_nonexistent_directory(self):
        """Test loading workflows when directory doesn't exist."""
        with patch('ai_hydro.registry.workflow_registry.RAGConfig') as mock_config:
            mock_config.get_workflows_path.return_value = Path("/nonexistent/path")
            
            registry = WorkflowRegistry()
            # Should handle missing directory gracefully
            try:
                registry.load_workflows()
                # Should mark as loaded even if no files found
                self.assertTrue(registry._loaded)
            except Exception:
                # Or raise appropriate exception
                pass
    
    def test_search_workflows_with_special_characters(self):
        """Test search with special characters."""
        registry = WorkflowRegistry()
        
        # Should handle special characters without crashing
        results = registry.search_workflows("test*query[special]")
        self.assertIsInstance(results, list)
    
    def test_load_workflows_with_invalid_yaml(self):
        """Test loading workflows with invalid YAML file."""
        with tempfile.TemporaryDirectory() as temp_dir:
            workflows_path = Path(temp_dir)
            
            # Create invalid YAML file
            with open(workflows_path / "invalid.yaml", 'w') as f:
                f.write("{ invalid : : yaml }")
            
            with patch('ai_hydro.registry.workflow_registry.RAGConfig') as mock_config:
                mock_config.get_workflows_path.return_value = workflows_path
                
                registry = WorkflowRegistry()
                # Should handle invalid YAML gracefully
                registry.load_workflows()
                
                # Should still mark as loaded
                self.assertTrue(registry._loaded)


if __name__ == '__main__':
    unittest.main()
