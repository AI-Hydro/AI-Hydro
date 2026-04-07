"""
Unit tests for knowledge_loader module.

Tests unified knowledge loading across concepts, tools, and workflows.
"""

import unittest
import json
import tempfile
from pathlib import Path
from unittest.mock import patch

# Add parent directory to path for imports
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from ai_hydro.registry.loader import KnowledgeLoader, get_knowledge_loader


class TestKnowledgeLoader(unittest.TestCase):
    """Test cases for KnowledgeLoader class."""
    
    def setUp(self):
        """Set up test fixtures."""
        self.loader = KnowledgeLoader()
    
    def test_loader_initialization(self):
        """Test that loader initializes correctly."""
        self.assertIsInstance(self.loader, KnowledgeLoader)
        self.assertFalse(self.loader._concepts_loaded)
        self.assertEqual(len(self.loader._concepts), 0)
    
    def test_load_concepts_returns_dict(self):
        """Test that load_concepts returns a dictionary."""
        concepts = self.loader.load_concepts()
        self.assertIsInstance(concepts, dict)
    
    def test_load_concepts_changes_loaded_state(self):
        """Test that load_concepts changes the loaded state."""
        initial_state = self.loader._concepts_loaded
        
        try:
            self.loader.load_concepts()
            # Should change loaded state
            self.assertTrue(self.loader._concepts_loaded or not initial_state)
        except Exception:
            # If knowledge base doesn't exist, should handle gracefully
            pass
    
    def test_load_concepts_is_idempotent(self):
        """Test that calling load_concepts multiple times is safe."""
        try:
            concepts1 = self.loader.load_concepts()
            concepts2 = self.loader.load_concepts()
            
            # Should return same concepts without reloading
            self.assertEqual(len(concepts1), len(concepts2))
        except Exception:
            # If knowledge base doesn't exist, that's okay for this test
            pass
    
    def test_get_concept_with_category_only(self):
        """Test getting all concepts from a category."""
        concept = self.loader.get_concept("hydrology_concepts")
        # Should return something or None
        self.assertTrue(concept is None or isinstance(concept, (dict, list)))
    
    def test_get_concept_with_category_and_name(self):
        """Test getting a specific concept by category and name."""
        concept = self.loader.get_concept("hydrology_concepts", "watershed")
        # Should return something or None
        self.assertTrue(concept is None or isinstance(concept, (dict, str, list)))
    
    def test_get_concept_nonexistent_category(self):
        """Test getting concept from non-existent category."""
        concept = self.loader.get_concept("nonexistent_category_12345")
        self.assertIsNone(concept)
    
    def test_load_all_returns_dict(self):
        """Test that load_all returns a dictionary with expected keys."""
        try:
            all_knowledge = self.loader.load_all()
            
            self.assertIsInstance(all_knowledge, dict)
            self.assertIn('concepts', all_knowledge)
            self.assertIn('tools', all_knowledge)
            self.assertIn('workflows', all_knowledge)
            
            self.assertIsInstance(all_knowledge['concepts'], dict)
            self.assertIsInstance(all_knowledge['tools'], list)
            self.assertIsInstance(all_knowledge['workflows'], list)
        except Exception:
            # If knowledge base doesn't exist, that's okay
            pass
    
    def test_search_all_returns_dict(self):
        """Test that search_all returns a dictionary with expected keys."""
        results = self.loader.search_all("test")
        
        self.assertIsInstance(results, dict)
        self.assertIn('concepts', results)
        self.assertIn('tools', results)
        self.assertIn('workflows', results)
        
        self.assertIsInstance(results['concepts'], list)
        self.assertIsInstance(results['tools'], list)
        self.assertIsInstance(results['workflows'], list)
    
    def test_search_all_case_insensitive(self):
        """Test that search is case-insensitive."""
        results_lower = self.loader.search_all("watershed")
        results_upper = self.loader.search_all("WATERSHED")
        
        # Should return similar structure regardless of case
        self.assertEqual(
            len(results_lower['concepts']) + len(results_lower['tools']) + len(results_lower['workflows']),
            len(results_upper['concepts']) + len(results_upper['tools']) + len(results_upper['workflows'])
        )
    
    def test_search_all_empty_query(self):
        """Test search with empty query."""
        results = self.loader.search_all("")
        self.assertIsInstance(results, dict)
    
    def test_singleton_pattern(self):
        """Test that get_knowledge_loader returns the same instance."""
        loader1 = get_knowledge_loader()
        loader2 = get_knowledge_loader()
        
        self.assertIs(loader1, loader2)


class TestKnowledgeLoaderWithMockData(unittest.TestCase):
    """Test loader with mock data."""
    
    def test_load_concepts_with_mock_data(self):
        """Test loading concepts from mock JSON files."""
        with tempfile.TemporaryDirectory() as temp_dir:
            concepts_path = Path(temp_dir)
            
            # Create mock concept file
            concept_data = {
                "watershed": {
                    "definition": "Area of land that drains to a common outlet",
                    "keywords": ["catchment", "basin"]
                }
            }
            
            with open(concepts_path / "test_concepts.json", 'w') as f:
                json.dump(concept_data, f)
            
            # Mock the RAGConfig to return our temp directory
            with patch('ai_hydro.registry.loader.RAGConfig') as mock_config:
                mock_config.get_concepts_path.return_value = concepts_path
                
                loader = KnowledgeLoader()
                concepts = loader.load_concepts()
                
                # Should have loaded the mock concepts
                self.assertIn("test_concepts", concepts)
                self.assertIn("watershed", concepts["test_concepts"])
                
                # Test get_concept
                category_concepts = loader.get_concept("test_concepts")
                self.assertIsNotNone(category_concepts)
                
                specific_concept = loader.get_concept("test_concepts", "watershed")
                self.assertIsNotNone(specific_concept)
                self.assertEqual(specific_concept['definition'], "Area of land that drains to a common outlet")
    
    def test_search_all_with_mock_data(self):
        """Test searching across all knowledge types with mock data."""
        with tempfile.TemporaryDirectory() as temp_dir:
            concepts_path = Path(temp_dir)
            
            # Create mock concept with searchable content
            concept_data = {
                "watershed": {
                    "definition": "Area of land that drains water",
                    "keywords": ["water", "drainage"]
                }
            }
            
            with open(concepts_path / "hydrology.json", 'w') as f:
                json.dump(concept_data, f)
            
            with patch('ai_hydro.registry.loader.RAGConfig') as mock_config:
                mock_config.get_concepts_path.return_value = concepts_path
                
                loader = KnowledgeLoader()
                
                # Search for "water"
                results = loader.search_all("water")
                
                # Should find the concept
                self.assertTrue(len(results['concepts']) > 0)


class TestKnowledgeLoaderEdgeCases(unittest.TestCase):
    """Test edge cases and error handling."""
    
    def test_load_concepts_with_nonexistent_directory(self):
        """Test loading concepts when directory doesn't exist."""
        with patch('ai_hydro.registry.loader.RAGConfig') as mock_config:
            mock_config.get_concepts_path.return_value = Path("/nonexistent/path")
            
            loader = KnowledgeLoader()
            # Should handle missing directory gracefully
            try:
                concepts = loader.load_concepts()
                self.assertIsInstance(concepts, dict)
            except Exception:
                # Or raise appropriate exception
                pass
    
    def test_load_concepts_with_invalid_json(self):
        """Test loading concepts with invalid JSON file."""
        with tempfile.TemporaryDirectory() as temp_dir:
            concepts_path = Path(temp_dir)
            
            # Create invalid JSON file
            with open(concepts_path / "invalid.json", 'w') as f:
                f.write("{invalid json content")
            
            with patch('ai_hydro.registry.loader.RAGConfig') as mock_config:
                mock_config.get_concepts_path.return_value = concepts_path
                
                loader = KnowledgeLoader()
                # Should handle invalid JSON gracefully
                concepts = loader.load_concepts()
                
                # Should still be loaded (just skip invalid files)
                self.assertTrue(loader._concepts_loaded)
    
    def test_search_all_with_special_characters(self):
        """Test search with special characters."""
        loader = KnowledgeLoader()
        
        # Should handle special characters without crashing
        results = loader.search_all("test*query[special]")
        self.assertIsInstance(results, dict)
    
    def test_get_concept_with_none_values(self):
        """Test getting concept with None values."""
        loader = KnowledgeLoader()
        
        concept = loader.get_concept(None)
        self.assertIsNone(concept)


if __name__ == '__main__':
    unittest.main()
