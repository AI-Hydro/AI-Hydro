"""
Workflow Registry for AI-Hydro
================================

Manages registration and discovery of hydrological workflows.
"""

from typing import Dict, List, Any, Optional
from pathlib import Path
import yaml

from ..rag.config import RAGConfig


class WorkflowRegistry:
    """
    Registry for managing hydrological workflows.
    
    Workflows are defined in YAML files in the knowledge/workflows/ directory.
    """
    
    def __init__(self):
        """Initialize the workflow registry."""
        self._workflows: Dict[str, Dict[str, Any]] = {}
        self._loaded = False
    
    @property
    def workflows(self) -> List[Dict[str, Any]]:
        """
        Get list of all workflows.
        
        Returns:
            List of workflow definitions
        """
        if not self._loaded:
            self.load_workflows()
        return list(self._workflows.values())
    
    def load_workflows(self) -> None:
        """
        Load workflow definitions from the knowledge base.
        
        Loads from knowledge/workflows/*.yaml
        """
        if self._loaded:
            return
        
        workflows_path = RAGConfig.get_workflows_path()
        
        # Load all YAML workflow files
        if workflows_path.exists():
            for yaml_file in workflows_path.glob('*.yaml'):
                try:
                    with open(yaml_file, 'r', encoding='utf-8') as f:
                        workflow_data = yaml.safe_load(f)
                        
                        # Use filename (without extension) as key if no name specified
                        workflow_name = workflow_data.get('name', yaml_file.stem)
                        self._workflows[workflow_name] = workflow_data
                        
                except Exception as e:
                    print(f"Warning: Failed to load workflow from {yaml_file}: {e}")
        
        self._loaded = True
    
    def get_workflow(self, workflow_name: str) -> Optional[Dict[str, Any]]:
        """
        Get workflow definition by name.
        
        Args:
            workflow_name: Name of the workflow
            
        Returns:
            Workflow definition dict or None if not found
        """
        if not self._loaded:
            self.load_workflows()
        
        return self._workflows.get(workflow_name)
    
    def list_workflows(self, category: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        List workflows, optionally filtered by category.
        
        Args:
            category: Filter by category (e.g., 'data_extraction', 'analysis')
            
        Returns:
            List of workflow definitions
        """
        if not self._loaded:
            self.load_workflows()
        
        workflows = list(self._workflows.values())
        
        if category:
            workflows = [w for w in workflows if w.get('category') == category]
        
        return workflows
    
    def search_workflows(self, query: str) -> List[Dict[str, Any]]:
        """
        Search workflows by name or description.
        
        Enhanced to support multi-word queries by tokenizing and scoring matches.
        
        Args:
            query: Search query string
            
        Returns:
            List of matching workflow definitions, scored by relevance
        """
        if not self._loaded:
            self.load_workflows()
        
        query_lower = query.lower()
        # Tokenize query (split on spaces, remove empty strings)
        query_tokens = [t.strip() for t in query_lower.split() if t.strip()]
        
        scored_results = []
        
        for workflow_name, workflow_def in self._workflows.items():
            score = 0.0
            
            # Combine searchable text
            name_lower = workflow_name.lower()
            description_lower = workflow_def.get('description', '').lower()
            category_lower = workflow_def.get('category', '').lower()
            
            # Score based on token matches
            for token in query_tokens:
                # Name matches (highest weight)
                if token in name_lower:
                    score += 1.0
                
                # Description matches
                if token in description_lower:
                    score += 0.5
                
                # Category matches
                if token in category_lower:
                    score += 0.3
                
                # Step description matches
                for step in workflow_def.get('steps', []):
                    if token in step.get('description', '').lower():
                        score += 0.2
                        break  # Only count once per workflow
            
            # Add to results if any tokens matched
            if score > 0:
                workflow_copy = workflow_def.copy()
                workflow_copy['relevance'] = score / len(query_tokens)  # Normalize by query length
                scored_results.append(workflow_copy)
        
        # Sort by relevance score (highest first)
        scored_results.sort(key=lambda x: x.get('relevance', 0), reverse=True)
        
        return scored_results
    
    def get_workflow_steps(self, workflow_name: str) -> List[Dict[str, Any]]:
        """
        Get the steps for a specific workflow.
        
        Args:
            workflow_name: Name of the workflow
            
        Returns:
            List of workflow steps or empty list if not found
        """
        workflow = self.get_workflow(workflow_name)
        
        if not workflow:
            return []
        
        return workflow.get('steps', [])


# Global registry instance
_registry_instance: Optional[WorkflowRegistry] = None


def get_workflow_registry() -> WorkflowRegistry:
    """
    Get the global workflow registry instance.
    
    Returns:
        Singleton WorkflowRegistry instance
    """
    global _registry_instance
    
    if _registry_instance is None:
        _registry_instance = WorkflowRegistry()
    
    return _registry_instance
