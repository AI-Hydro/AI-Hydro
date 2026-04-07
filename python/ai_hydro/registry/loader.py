"""
Knowledge Loader for AI-Hydro
==============================

Unified loader for all knowledge base content.
"""

from typing import Dict, List, Any, Optional
from pathlib import Path
import json
import yaml

from ..rag.config import RAGConfig
from .tool_registry import get_tool_registry
from .workflow_registry import get_workflow_registry


class KnowledgeLoader:
    """
    Unified loader for all knowledge base content.
    
    Provides high-level methods to load concepts, tools, and workflows.
    """
    
    def __init__(self):
        """Initialize the knowledge loader."""
        self._concepts: Dict[str, Any] = {}
        self._concepts_loaded = False
        self._instructions: Dict[str, Any] = {}
        self._instructions_loaded = False
    
    def load_concepts(self) -> Dict[str, Any]:
        """
        Load all concept files from the knowledge base.
        
        Returns:
            Dict with concept categories as keys and concept data as values
        """
        if self._concepts_loaded:
            return self._concepts
        
        concepts_path = RAGConfig.get_concepts_path()
        
        if concepts_path.exists():
            for json_file in concepts_path.glob('*.json'):
                try:
                    with open(json_file, 'r', encoding='utf-8') as f:
                        concept_data = json.load(f)
                        
                        # Use filename (without extension) as category
                        category = json_file.stem
                        self._concepts[category] = concept_data
                        
                except Exception as e:
                    print(f"Warning: Failed to load concepts from {json_file}: {e}")
        
        self._concepts_loaded = True
        return self._concepts
    
    def load_instructions(self) -> Dict[str, Any]:
        """
        Load all instruction files from the knowledge base.
        
        Returns:
            Dict with instruction categories as keys and instruction data as values
        """
        if self._instructions_loaded:
            return self._instructions
        
        # Get knowledge directory and construct instructions path
        knowledge_dir = RAGConfig.get_knowledge_base_path()
        instructions_path = knowledge_dir / 'instructions'
        
        if instructions_path.exists():
            for json_file in instructions_path.glob('*.json'):
                try:
                    with open(json_file, 'r', encoding='utf-8') as f:
                        instruction_data = json.load(f)
                        
                        # Use filename (without extension) as category
                        category = json_file.stem
                        self._instructions[category] = instruction_data
                        
                except Exception as e:
                    print(f"Warning: Failed to load instructions from {json_file}: {e}")
        
        self._instructions_loaded = True
        return self._instructions
    
    def get_concept(self, category: str, concept_name: Optional[str] = None) -> Any:
        """
        Get a specific concept or all concepts in a category.
        
        Args:
            category: Concept category (e.g., 'hydrology_concepts')
            concept_name: Specific concept name (optional)
            
        Returns:
            Concept data or None if not found
        """
        if not self._concepts_loaded:
            self.load_concepts()
        
        category_data = self._concepts.get(category)
        
        if category_data is None:
            return None
        
        if concept_name is None:
            return category_data
        
        # If the category data is a dict, look up the concept by name
        if isinstance(category_data, dict):
            return category_data.get(concept_name)
        
        return category_data
    
    def get_instruction(self, category: str, instruction_name: Optional[str] = None) -> Any:
        """
        Get a specific instruction or all instructions in a category.
        
        Args:
            category: Instruction category (e.g., 'best_practices')
            instruction_name: Specific instruction name (optional)
            
        Returns:
            Instruction data or None if not found
        """
        if not self._instructions_loaded:
            self.load_instructions()
        
        category_data = self._instructions.get(category)
        
        if category_data is None:
            return None
        
        if instruction_name is None:
            return category_data
        
        # If the category data is a dict, look up the instruction by name
        if isinstance(category_data, dict):
            return category_data.get(instruction_name)
        
        return category_data
    
    def load_all(self) -> Dict[str, Any]:
        """
        Load all knowledge base content.
        
        Returns:
            Dict with 'concepts', 'instructions', 'tools', and 'workflows' keys
        """
        # Load concepts
        concepts = self.load_concepts()
        
        # Load instructions
        instructions = self.load_instructions()
        
        # Load tools via registry
        tool_registry = get_tool_registry()
        tool_registry.load_tools()
        tools = tool_registry.list_tools()
        
        # Load workflows via registry
        workflow_registry = get_workflow_registry()
        workflow_registry.load_workflows()
        workflows = workflow_registry.list_workflows()
        
        return {
            'concepts': concepts,
            'instructions': instructions,
            'tools': tools,
            'workflows': workflows
        }
    
    def search_all(self, query: str) -> Dict[str, List[Any]]:
        """
        Search across all knowledge base content.
        
        Args:
            query: Search query string
            
        Returns:
            Dict with 'concepts', 'instructions', 'tools', and 'workflows' keys containing matches
        """
        results = {
            'concepts': [],
            'instructions': [],
            'tools': [],
            'workflows': []
        }
        
        query_lower = query.lower()
        
        # Search concepts
        if not self._concepts_loaded:
            self.load_concepts()
        
        for category, concept_data in self._concepts.items():
            if isinstance(concept_data, dict):
                for concept_name, concept_value in concept_data.items():
                    if query_lower in str(concept_name).lower() or \
                       query_lower in str(concept_value).lower():
                        results['concepts'].append({
                            'category': category,
                            'name': concept_name,
                            'data': concept_value
                        })
        
        # Search instructions
        if not self._instructions_loaded:
            self.load_instructions()
        
        for category, instruction_data in self._instructions.items():
            if isinstance(instruction_data, dict):
                for instruction_name, instruction_value in instruction_data.items():
                    if query_lower in str(instruction_name).lower() or \
                       query_lower in str(instruction_value).lower():
                        results['instructions'].append({
                            'category': category,
                            'name': instruction_name,
                            'data': instruction_value
                        })
        
        # Search tools
        tool_registry = get_tool_registry()
        results['tools'] = tool_registry.search_tools(query)
        
        # Search workflows
        workflow_registry = get_workflow_registry()
        results['workflows'] = workflow_registry.search_workflows(query)
        
        return results


# Global loader instance
_loader_instance: Optional[KnowledgeLoader] = None


def get_knowledge_loader() -> KnowledgeLoader:
    """
    Get the global knowledge loader instance.
    
    Returns:
        Singleton KnowledgeLoader instance
    """
    global _loader_instance
    
    if _loader_instance is None:
        _loader_instance = KnowledgeLoader()
    
    return _loader_instance
