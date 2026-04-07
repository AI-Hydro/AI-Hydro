# Hydrological Concepts

This directory contains definitions and documentation of hydrological concepts, terminology, and theoretical knowledge.

## Files

- **hydrology_concepts.json** - Core hydrological concepts and definitions
- **camels_metadata.json** - CAMELS dataset attribute descriptions
- **model_descriptions.json** - Hydrological model information

## Purpose

These concepts provide the theoretical foundation for the RAG engine to:
- Answer questions about hydrological terminology
- Explain scientific concepts
- Provide context for analysis tasks
- Link related concepts

## Adding New Concepts

See [../CONTRIBUTING.md](../CONTRIBUTING.md) for detailed guidelines.

Quick example:
```json
{
  "your_concept": {
    "definition": "Clear definition",
    "category": "hydrology|climatology|modeling",
    "synonyms": ["alternative terms"],
    "related_concepts": ["related concepts"],
    "units": "SI units if applicable",
    "references": ["citations"]
  }
}
```
