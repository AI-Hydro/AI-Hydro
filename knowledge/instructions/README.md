# AI-Hydro Instructions Knowledge Base

This directory contains structured guidelines and instructions for using AI-Hydro tools and workflows effectively. These files are loaded by the RAG system to provide intelligent context-aware assistance to the AI.

## Purpose

The instructions in this directory help the AI:
1. **Prevent hallucinations** - Provide accurate, verified guidance instead of making up procedures
2. **Follow best practices** - Ensure scientifically sound hydrological analysis
3. **Avoid common mistakes** - Learn from documented pitfalls
4. **Handle errors gracefully** - Implement robust error handling patterns
5. **Validate data properly** - Apply appropriate quality checks
6. **Use correct patterns** - Follow established workflow templates

## File Structure

### Core Instruction Files

1. **general_guidelines.json**
   - Basic principles for tool usage
   - Tool selection guidance
   - Workflow organization
   - Code quality standards
   - Version: 1.0.0

2. **best_practices.json**
   - Watershed delineation best practices
   - Attribute extraction guidelines
   - Time series analysis recommendations
   - Workflow optimization strategies
   - Scientific rigor requirements
   - Version: 1.0.0

3. **common_pitfalls.json**
   - Tool usage mistakes to avoid
   - Watershed delineation issues
   - Data extraction problems
   - Workflow execution errors
   - Scientific analysis mistakes
   - Performance pitfalls
   - Version: 1.0.0

4. **error_handling.json**
   - Common error types and solutions
   - Error handling patterns (try-except, retry logic, etc.)
   - Debugging strategies
   - Recovery strategies
   - Prevention techniques
   - Bug reporting guidelines
   - Version: 1.0.0

5. **data_validation.json**
   - Validation criteria for all data types
   - Quality checks for each attribute category
   - Cross-validation methods
   - Automated validation patterns
   - Physical constraint checks
   - Version: 1.0.0

6. **task_patterns.json**
   - Basic workflow patterns (single operations)
   - Complete workflows (end-to-end analysis)
   - Advanced patterns (regional analysis, sensitivity testing)
   - Integration patterns (GIS, modeling frameworks)
   - Debugging and optimization patterns
   - Version: 1.0.0

## JSON Structure

All instruction files follow this structure:

```json
{
  "_description": "Brief description of file purpose",
  "_version": "1.0.0",
  
  "category_name": {
    "subcategory": {
      "field": "value or array of values",
      "description": "Explanation text",
      "example": "Code example if applicable"
    }
  }
}
```

### Special Fields

- `_description`: File-level description (RAG metadata)
- `_version`: Semantic version number
- `description`: Explanation of a concept or pattern
- `example`: Code examples demonstrating usage
- `steps`: Sequential list of actions
- `mistake`: What not to do
- `correct`: The right way to do it
- `explanation`: Why this matters

## RAG Integration

### How Instructions Are Used

1. **Query Processing**: User queries are tokenized and matched against instruction content
2. **Context Injection**: Relevant instructions are injected into the AI's context
3. **Guided Response**: AI uses instructions to provide accurate, validated guidance
4. **Validation**: Instructions help validate tool existence and proper usage

### Keyword Optimization

Instructions use domain-specific keywords for better RAG retrieval:
- Hydrological terms: watershed, delineation, streamflow, precipitation, etc.
- Technical terms: validation, error handling, debugging, optimization
- Tool names: delineate_watershed, extract_topographic_attributes, etc.
- Workflow names: camels_extraction, auto_modeling, etc.

## Updating Instructions

### When to Update

- New tools or workflows are added
- Best practices evolve
- Common mistakes are discovered
- New error patterns emerge
- Scientific standards change

### How to Update

1. **Edit the JSON file** directly with new content
2. **Maintain structure** - Keep the established JSON schema
3. **Update version** - Increment version number for significant changes
4. **Test RAG retrieval** - Verify instructions are properly loaded
5. **Document changes** - Note what was added/modified

### Version Guidelines

- **Patch (1.0.x)**: Minor clarifications, typo fixes
- **Minor (1.x.0)**: New sections added, significant content updates
- **Major (x.0.0)**: Structural changes, breaking changes to schema

## Best Practices for Instruction Content

### Writing Effective Instructions

1. **Be Specific**: Provide concrete examples, not vague advice
2. **Use Keywords**: Include technical terms users will likely mention
3. **Show Code**: Include runnable code examples
4. **Explain Why**: Don't just say what to do, explain the reasoning
5. **Link Concepts**: Cross-reference related instructions
6. **Stay Current**: Keep content synchronized with actual tool capabilities

### Content Organization

- **Hierarchical**: Organize from general to specific
- **Searchable**: Use clear, descriptive keys
- **Modular**: Each file focuses on one aspect
- **Cross-referenced**: Instructions reference each other when relevant

### Examples

Good instruction:
```json
{
  "gauge_id_format": {
    "mistake": "Using incorrect gauge ID format",
    "examples": ["031500", "1031500", "USGS-01031500"],
    "correct": "01031500",
    "explanation": "USGS gauge IDs are 8-digit strings with leading zeros preserved"
  }
}
```

Poor instruction:
```json
{
  "gauge_format": "Use correct format"
}
```

## Integration with Knowledge Base

### Related Knowledge Files

Instructions complement other knowledge base components:

- **tools/tier2_wrappers.json**: Tool metadata and capabilities
- **tools/tier3_workflows.json**: Workflow definitions
- **workflows/*.yaml**: Step-by-step workflow specifications
- **concepts/*.json**: Hydrological concept definitions
- **templates/*.json**: Code templates and scaffolding

### Consistency Across Files

Ensure consistency with:
- Tool names match those in tier2_wrappers.json
- Workflow names match tier3_workflows.json
- Parameter names match actual function signatures
- Examples use real, working code

## RAG Engine Integration

### Loading Instructions

The KnowledgeLoader (`python/ai_hydro/registry/loader.py`) loads instructions:

```python
def load_instructions(self) -> Dict[str, Any]:
    """Load all instruction files from knowledge/instructions/"""
    instructions = {}
    instructions_dir = self.knowledge_dir / 'instructions'
    
    for file in instructions_dir.glob('*.json'):
        if file.name != 'README.md':
            with open(file) as f:
                instructions[file.stem] = json.load(f)
    
    return instructions
```

### Querying Instructions

The RAGEngine uses instructions in context augmentation:

```python
def _get_relevant_instructions(self, query: str) -> str:
    """Get instructions relevant to the query"""
    relevant = []
    
    for category, content in self.instructions.items():
        if self._matches_query(query, content):
            relevant.append(self._format_instruction(category, content))
    
    return "\n".join(relevant)
```

## Testing Instructions

### Validation Tests

Run validation tests to ensure instructions are properly loaded:

```bash
python -m pytest python/tests/test_instructions.py
```

### RAG Integration Tests

Test that instructions are properly retrieved:

```python
from ai_hydro.rag.engine import RAGEngine

engine = RAGEngine()
result = engine.query("how to handle watershed delineation errors")
assert "error_handling" in result["sources"]
```

## Contributing

When contributing new instructions:

1. Follow the established JSON structure
2. Include clear examples and explanations
3. Use consistent terminology with other files
4. Test RAG retrieval before submitting
5. Update this README if adding new file types
6. Increment version numbers appropriately

## License

These instructions are part of the AI-Hydro project and follow the same license as the main project.

## Contact

For questions about instructions:
- Open an issue on GitHub
- Check the AI-Hydro documentation
- Review the RAG system guide

---

**Last Updated**: 2025-10-23  
**Maintained By**: AI-Hydro Development Team
