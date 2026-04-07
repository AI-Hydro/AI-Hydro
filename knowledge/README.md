# AI-Hydro Knowledge Base

**Version:** 2.0.0  
**Last Updated:** October 22, 2025  
**Status:** Active Development

---

## Overview

This is the unified knowledge base for AI-Hydro, containing all hydrological concepts, tool documentation, workflows, templates, and reference datasets. This knowledge base powers the RAG (Retrieval-Augmented Generation) engine that helps users with hydrological analysis tasks.

## Directory Structure

```
knowledge/
├── concepts/           # Hydrological concepts and definitions
├── tools/             # Tool capabilities and documentation
├── workflows/         # Workflow definitions and examples
├── templates/         # Code templates for common tasks
├── datasets/          # Reference data and benchmarks
├── README.md          # This file
├── CONTRIBUTING.md    # Contribution guidelines
└── schema.json        # JSON schema for validation
```

## Contents

### 📚 Concepts (`concepts/`)

Hydrological concepts, terminology, and theoretical knowledge:
- `hydrology_concepts.json` - Core hydrological definitions
- `camels_metadata.json` - CAMELS dataset attribute documentation
- `model_descriptions.json` - Hydrological model descriptions

### 🔧 Tools (`tools/`)

Documentation of available Python tools and functions:
- `tier1_libraries.json` - External library integrations
- `tier2_wrappers.json` - AI-Hydro wrapper functions
- `tier3_workflows.json` - Complete workflow orchestrations
- `camels_tools.json` - CAMELS-specific tools

### 🔄 Workflows (`workflows/`)

Complete workflow definitions in YAML format:
- `fetch_hydrological_data.yaml` - Data retrieval workflows
- `compute_signatures.yaml` - Signature computation
- `auto_modeling.yaml` - Automated modeling
- `rag_search.yaml` - RAG search workflows

### 📝 Templates (`templates/`)

Reusable code templates for common tasks:
- Analysis templates
- Workflow templates
- Tool wrapper templates

### 📊 Datasets (`datasets/`)

Reference datasets and benchmarks:
- CAMELS reference data
- USGS gauge information
- Model benchmarks

## How the Knowledge Base Works

The knowledge base is used by the RAG engine to:

1. **Answer Questions**: Semantic search over hydrological concepts
2. **Recommend Tools**: Suggest appropriate tools for user tasks
3. **Guide Workflows**: Provide step-by-step workflow guidance
4. **Provide Context**: Inject relevant knowledge into AI conversations
5. **Validate Approaches**: Ensure best practices are followed

## Contributing

Please see [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines on:
- Adding new concepts
- Documenting tools
- Creating workflows
- Code templates
- Dataset contributions
- Schema validation
- Testing requirements

## Quick Start for Contributors

### Adding a New Concept

1. Edit the appropriate JSON file in `concepts/`
2. Follow the schema in `schema.json`
3. Run validation: `python scripts/validate_knowledge.py`
4. Submit a pull request

### Adding Tool Documentation

1. Edit the appropriate JSON file in `tools/`
2. Include function signature, description, and usage example
3. Validate against schema
4. Update related workflows if needed

### Creating a New Workflow

1. Create YAML file in `workflows/`
2. Follow existing workflow format
3. Include inputs, outputs, and step descriptions
4. Add usage examples
5. Test the workflow end-to-end

## Schema Validation

All knowledge files must conform to the schema defined in `schema.json`. Run validation before submitting:

```bash
python scripts/validate_knowledge.py
```

## Environment Variables

The RAG engine can be configured using environment variables:

- `AI_HYDRO_KNOWLEDGE_PATH` - Override default knowledge base location
- `AI_HYDRO_DEBUG` - Enable verbose logging
- `AI_HYDRO_TRACE` - Full trace logging

## Development vs Production

### Development Mode
- Knowledge loaded from repository: `./knowledge/`
- Hot-reloading enabled
- Validation warnings shown

### Production Mode
- Knowledge bundled with package
- Cached for performance
- Strict validation

## Testing

Test your knowledge contributions:

```bash
# Validate all knowledge files
python scripts/validate_knowledge.py

# Test RAG connection
python scripts/test_rag_connection.py

# Benchmark performance
python scripts/benchmark_rag.py
```

## Migration from Old Structure

If you're migrating from the previous structure:

- ~~`Brains/knowledge/`~~ → `knowledge/concepts/` and `knowledge/tools/`
- ~~`Brains/workflows/`~~ → `knowledge/workflows/`
- ~~`python/ai_hydro/knowledge/`~~ → `knowledge/concepts/`

See deprecation timeline in main project documentation.

## Version History

- **2.0.0** (Oct 2025) - Unified knowledge base restructuring
- **1.0.0** (Earlier) - Initial dual-directory structure (deprecated)

## Support

For questions or issues:
- Check [CONTRIBUTING.md](CONTRIBUTING.md)
- Review the [architecture docs](../docs/architecture.md)
- Open an issue on [GitHub](https://github.com/galib9690/AI-Hydro/issues)

---

**This knowledge base is the single source of truth for AI-Hydro's hydrological intelligence.**
