"""
Unit tests for validators module.

Tests JSON schema validation, YAML validation, and validation reporting.
"""

import unittest
import json
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock

# Add parent directory to path for imports
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from ai_hydro.utils.validators import (
    load_schema,
    validate_json_schema,
    validate_json_file,
    validate_workflow_yaml,
    validate_knowledge_base,
    get_validation_report
)


class TestValidators(unittest.TestCase):
    """Test cases for validation utilities."""
    
    def test_load_schema_returns_dict(self):
        """Test that load_schema returns a dictionary."""
        try:
            schema = load_schema()
            self.assertIsInstance(schema, dict)
        except FileNotFoundError:
            # Schema file might not exist in test environment
            self.skipTest("Schema file not found")
    
    def test_validate_json_schema_with_valid_data(self):
        """Test validation with valid data."""
        # Simple test data
        test_data = {
            "name": "test",
            "description": "Test description"
        }
        
        # Test without schema (should try to load default)
        is_valid, error = validate_json_schema(test_data)
        # Should return a boolean and optional error message
        self.assertIsInstance(is_valid, bool)
        if not is_valid:
            self.assertIsInstance(error, str)
    
    def test_validate_json_schema_with_invalid_data(self):
        """Test validation with invalid data against a simple schema."""
        # Define a simple schema
        schema = {
            "type": "object",
            "required": ["name"],
            "properties": {
                "name": {"type": "string"}
            }
        }
        
        # Test with missing required field
        test_data = {"description": "Missing name field"}
        is_valid, error = validate_json_schema(test_data, schema)
        
        self.assertFalse(is_valid)
        self.assertIsNotNone(error)
        self.assertIsInstance(error, str)
    
    def test_validate_json_file_with_valid_file(self):
        """Test JSON file validation with a valid file."""
        # Create a temporary JSON file
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump({"name": "test", "value": 123}, f)
            temp_path = f.name
        
        try:
            is_valid, error = validate_json_file(Path(temp_path))
            # Should successfully parse the file
            self.assertIsInstance(is_valid, bool)
        finally:
            # Clean up
            Path(temp_path).unlink()
    
    def test_validate_json_file_with_nonexistent_file(self):
        """Test JSON file validation with non-existent file."""
        is_valid, error = validate_json_file(Path("/nonexistent/path/file.json"))
        
        self.assertFalse(is_valid)
        self.assertIsNotNone(error)
        self.assertIn("not found", error.lower())
    
    def test_validate_json_file_with_invalid_json(self):
        """Test JSON file validation with invalid JSON."""
        # Create a temporary file with invalid JSON
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            f.write("{invalid json content")
            temp_path = f.name
        
        try:
            is_valid, error = validate_json_file(Path(temp_path))
            
            self.assertFalse(is_valid)
            self.assertIsNotNone(error)
            self.assertIn("JSON", error)
        finally:
            # Clean up
            Path(temp_path).unlink()
    
    def test_validate_workflow_yaml_with_valid_file(self):
        """Test YAML workflow validation with valid file."""
        # Create a temporary YAML file with valid workflow
        yaml_content = """
name: Test Workflow
description: A test workflow
steps:
  - name: Step 1
    description: First step
  - name: Step 2
    description: Second step
"""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as f:
            f.write(yaml_content)
            temp_path = f.name
        
        try:
            is_valid, error, data = validate_workflow_yaml(Path(temp_path))
            
            self.assertTrue(is_valid)
            self.assertIsNone(error)
            self.assertIsInstance(data, dict)
            self.assertEqual(data['name'], 'Test Workflow')
            self.assertEqual(len(data['steps']), 2)
        finally:
            # Clean up
            Path(temp_path).unlink()
    
    def test_validate_workflow_yaml_missing_required_fields(self):
        """Test YAML workflow validation with missing required fields."""
        # Create a YAML file missing required fields
        yaml_content = """
name: Test Workflow
# Missing description and steps
"""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as f:
            f.write(yaml_content)
            temp_path = f.name
        
        try:
            is_valid, error, data = validate_workflow_yaml(Path(temp_path))
            
            self.assertFalse(is_valid)
            self.assertIsNotNone(error)
            self.assertIn("required", error.lower())
        finally:
            # Clean up
            Path(temp_path).unlink()
    
    def test_validate_workflow_yaml_empty_steps(self):
        """Test YAML workflow validation with empty steps."""
        yaml_content = """
name: Test Workflow
description: A workflow with no steps
steps: []
"""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as f:
            f.write(yaml_content)
            temp_path = f.name
        
        try:
            is_valid, error, data = validate_workflow_yaml(Path(temp_path))
            
            self.assertFalse(is_valid)
            self.assertIsNotNone(error)
            self.assertIn("at least one step", error.lower())
        finally:
            # Clean up
            Path(temp_path).unlink()
    
    def test_validate_knowledge_base_returns_dict(self):
        """Test that validate_knowledge_base returns a dictionary."""
        results = validate_knowledge_base()
        
        self.assertIsInstance(results, dict)
        self.assertIn('valid', results)
        self.assertIn('invalid', results)
        self.assertIn('errors', results)
        
        self.assertIsInstance(results['valid'], list)
        self.assertIsInstance(results['invalid'], list)
        self.assertIsInstance(results['errors'], dict)
    
    def test_get_validation_report_returns_string(self):
        """Test that get_validation_report returns a string."""
        report = get_validation_report()
        
        self.assertIsInstance(report, str)
        self.assertIn("Validation Report", report)


class TestValidatorsEdgeCases(unittest.TestCase):
    """Test edge cases and error handling for validators."""
    
    def test_validate_json_schema_with_none_data(self):
        """Test validation with None data."""
        schema = {"type": "object"}
        is_valid, error = validate_json_schema(None, schema)
        
        # Should handle None gracefully
        self.assertFalse(is_valid)
        self.assertIsNotNone(error)
    
    def test_validate_workflow_yaml_with_invalid_yaml(self):
        """Test YAML validation with invalid YAML syntax."""
        yaml_content = """
name: Test
description: Test
steps:
  - invalid: : yaml
"""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as f:
            f.write(yaml_content)
            temp_path = f.name
        
        try:
            is_valid, error, data = validate_workflow_yaml(Path(temp_path))
            
            self.assertFalse(is_valid)
            self.assertIsNotNone(error)
        finally:
            # Clean up
            Path(temp_path).unlink()
    
    def test_validate_workflow_yaml_with_invalid_step_structure(self):
        """Test YAML validation with invalid step structure."""
        yaml_content = """
name: Test Workflow
description: Test
steps:
  - "This should be a dict, not a string"
"""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as f:
            f.write(yaml_content)
            temp_path = f.name
        
        try:
            is_valid, error, data = validate_workflow_yaml(Path(temp_path))
            
            self.assertFalse(is_valid)
            self.assertIsNotNone(error)
            self.assertIn("dictionary", error.lower())
        finally:
            # Clean up
            Path(temp_path).unlink()


if __name__ == '__main__':
    unittest.main()
