"""
Validation utilities for AI-Hydro knowledge base files.

Provides JSON schema and YAML validation for knowledge base content.
"""

from typing import Dict, Any, Optional, List
from pathlib import Path
import json
import yaml
import jsonschema
from jsonschema import validate, ValidationError

from .path_resolver import get_knowledge_base_root


def load_schema() -> Dict[str, Any]:
    """
    Load the JSON schema for knowledge base validation.
    
    Returns:
        Dict containing the JSON schema
        
    Raises:
        FileNotFoundError: If schema.json is not found
        json.JSONDecodeError: If schema is invalid JSON
    """
    schema_path = get_knowledge_base_root() / "schema.json"
    
    if not schema_path.exists():
        raise FileNotFoundError(f"Schema file not found: {schema_path}")
    
    with open(schema_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def validate_json_schema(data: Dict[str, Any], schema: Optional[Dict[str, Any]] = None) -> tuple[bool, Optional[str]]:
    """
    Validate a JSON object against the knowledge base schema.
    
    Args:
        data: JSON data to validate
        schema: Schema to validate against (if None, loads default schema)
        
    Returns:
        Tuple of (is_valid, error_message)
        - is_valid: True if validation passes
        - error_message: None if valid, error message if invalid
    """
    if schema is None:
        try:
            schema = load_schema()
        except Exception as e:
            return False, f"Failed to load schema: {str(e)}"
    
    try:
        validate(instance=data, schema=schema)
        return True, None
    except ValidationError as e:
        return False, f"Validation error: {e.message}"
    except Exception as e:
        return False, f"Unexpected validation error: {str(e)}"


def validate_json_file(file_path: Path) -> tuple[bool, Optional[str]]:
    """
    Validate a JSON file against the knowledge base schema.
    
    Args:
        file_path: Path to JSON file to validate
        
    Returns:
        Tuple of (is_valid, error_message)
    """
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        return validate_json_schema(data)
    
    except FileNotFoundError:
        return False, f"File not found: {file_path}"
    except json.JSONDecodeError as e:
        return False, f"Invalid JSON: {str(e)}"
    except Exception as e:
        return False, f"Error reading file: {str(e)}"


def validate_workflow_yaml(file_path: Path) -> tuple[bool, Optional[str], Optional[Dict[str, Any]]]:
    """
    Validate a workflow YAML file.
    
    Checks for:
    - Valid YAML syntax
    - Required fields (name, description, steps)
    - Valid step structure
    
    Args:
        file_path: Path to YAML file to validate
        
    Returns:
        Tuple of (is_valid, error_message, parsed_data)
        - is_valid: True if validation passes
        - error_message: None if valid, error message if invalid
        - parsed_data: Parsed YAML data if valid, None if invalid
    """
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = yaml.safe_load(f)
        
        # Check required top-level fields
        required_fields = ['name', 'description', 'steps']
        missing_fields = [field for field in required_fields if field not in data]
        
        if missing_fields:
            return False, f"Missing required fields: {', '.join(missing_fields)}", None
        
        # Validate steps structure
        if not isinstance(data['steps'], list):
            return False, "Field 'steps' must be a list", None
        
        if len(data['steps']) == 0:
            return False, "Workflow must have at least one step", None
        
        # Validate each step
        for i, step in enumerate(data['steps']):
            if not isinstance(step, dict):
                return False, f"Step {i+1} must be a dictionary", None
            
            step_required = ['name', 'description']
            step_missing = [field for field in step_required if field not in step]
            
            if step_missing:
                return False, f"Step {i+1} missing required fields: {', '.join(step_missing)}", None
        
        return True, None, data
    
    except FileNotFoundError:
        return False, f"File not found: {file_path}", None
    except yaml.YAMLError as e:
        return False, f"Invalid YAML: {str(e)}", None
    except Exception as e:
        return False, f"Error reading file: {str(e)}", None


def validate_knowledge_base() -> Dict[str, List[str]]:
    """
    Validate all files in the knowledge base.
    
    Returns:
        Dict with keys 'valid', 'invalid', 'errors' containing file paths and error messages
    """
    from .path_resolver import list_knowledge_files
    
    results = {
        'valid': [],
        'invalid': [],
        'errors': {}
    }
    
    # Validate concept files
    for category in ['concepts', 'tools']:
        try:
            json_files = list_knowledge_files(category, '.json')
            
            for file_path in json_files:
                is_valid, error = validate_json_file(file_path)
                
                if is_valid:
                    results['valid'].append(str(file_path))
                else:
                    results['invalid'].append(str(file_path))
                    results['errors'][str(file_path)] = error
        
        except Exception as e:
            results['errors'][f'{category}_category'] = str(e)
    
    # Validate workflow files
    try:
        yaml_files = list_knowledge_files('workflows', '.yaml')
        
        for file_path in yaml_files:
            is_valid, error, _ = validate_workflow_yaml(file_path)
            
            if is_valid:
                results['valid'].append(str(file_path))
            else:
                results['invalid'].append(str(file_path))
                results['errors'][str(file_path)] = error
    
    except Exception as e:
        results['errors']['workflows_category'] = str(e)
    
    return results


def get_validation_report() -> str:
    """
    Generate a human-readable validation report for the knowledge base.
    
    Returns:
        Formatted validation report string
    """
    results = validate_knowledge_base()
    
    report = ["=" * 60]
    report.append("AI-Hydro Knowledge Base Validation Report")
    report.append("=" * 60)
    report.append("")
    
    report.append(f"Valid files: {len(results['valid'])}")
    report.append(f"Invalid files: {len(results['invalid'])}")
    report.append("")
    
    if results['invalid']:
        report.append("Invalid Files:")
        report.append("-" * 60)
        for file_path in results['invalid']:
            report.append(f"\n  {file_path}")
            if file_path in results['errors']:
                report.append(f"    Error: {results['errors'][file_path]}")
        report.append("")
    
    if results['valid']:
        report.append("Valid Files:")
        report.append("-" * 60)
        for file_path in results['valid']:
            report.append(f"  ✓ {file_path}")
    
    report.append("")
    report.append("=" * 60)
    
    return "\n".join(report)
