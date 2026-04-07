# Contributing to AI-Hydro Knowledge Base

Thank you for contributing to the AI-Hydro knowledge base! This guide will help you add new concepts, tools, workflows, and other knowledge effectively.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Knowledge Types](#knowledge-types)
3. [File Formats](#file-formats)
4. [Contribution Workflow](#contribution-workflow)
5. [Quality Standards](#quality-standards)
6. [Validation](#validation)
7. [Examples](#examples)

---

## Quick Start

### Before You Begin

1. Familiarize yourself with the existing knowledge structure
2. Check if similar content already exists
3. Review the schema in `schema.json`
4. Set up validation tools

### Basic Contribution Steps

```bash
# 1. Fork and clone the repository
git clone https://github.com/your-username/AI-Hydro.git

# 2. Create a feature branch
git checkout -b add-knowledge-<description>

# 3. Add your knowledge files
# Edit JSON/YAML files in knowledge/ subdirectories

# 4. Validate your changes
python scripts/validate_knowledge.py

# 5. Commit and push
git add knowledge/
git commit -m "Add knowledge: <description>"
git push origin add-knowledge-<description>

# 6. Create a Pull Request
```

---

## Knowledge Types

### 1. Hydrological Concepts (`concepts/`)

**Purpose**: Core hydrological definitions, terminology, and theoretical knowledge

**Files**:
- `hydrology_concepts.json` - General hydrological concepts
- `camels_metadata.json` - CAMELS dataset attributes
- `model_descriptions.json` - Hydrological model information

**Structure**:
```json
{
  "concept_name": {
    "definition": "Clear, concise definition",
    "category": "Category (e.g., 'hydrology', 'climatology')",
    "synonyms": ["alternate_term1", "alternate_term2"],
    "related_concepts": ["related1", "related2"],
    "references": ["citation1", "citation2"],
    "units": "SI units if applicable"
  }
}
```

### 2. Tool Documentation (`tools/`)

**Purpose**: Document available Python tools and their capabilities

**Files**:
- `tier1_libraries.json` - External libraries (PySheds, Xarray, etc.)
- `tier2_wrappers.json` - AI-Hydro wrapper functions
- `tier3_workflows.json` - Complete workflow functions
- `camels_tools.json` - CAMELS-specific tools

**Structure**:
```json
{
  "tool_name": {
    "full_path": "ai_hydro.module.submodule.function_name",
    "tier": "tier1|tier2|tier3",
    "category": "watershed|climate|modeling|etc",
    "description": "What the tool does",
    "purpose": "When to use this tool",
    "inputs": {
      "param1": {"type": "str", "description": "Parameter description", "required": true},
      "param2": {"type": "float", "description": "Optional parameter", "required": false}
    },
    "outputs": {
      "type": "GeoDataFrame|dict|array",
      "description": "What is returned"
    },
    "usage_example": "from ai_hydro import func\nresult = func(param1='value')",
    "dependencies": ["library1", "library2"],
    "references": ["doi:10.xxxx/xxxxx"]
  }
}
```

### 3. Workflows (`workflows/`)

**Purpose**: Complete workflow definitions for common tasks

**Files**: Individual YAML files (e.g., `fetch_hydrological_data.yaml`)

**Structure**:
```yaml
name: Workflow Name
description: What this workflow accomplishes
category: data|analysis|modeling|research
version: 1.0.0

inputs:
  - name: input1
    type: str
    description: Input description
    required: true
    default: null

outputs:
  - name: output1
    type: GeoDataFrame
    description: Output description

steps:
  - step: 1
    name: Step Name
    tool: ai_hydro.module.function
    description: What this step does
    inputs:
      param1: ${input1}
    outputs:
      result1: intermediate_result

  - step: 2
    name: Next Step
    tool: ai_hydro.module.function2
    description: Next operation
    inputs:
      data: ${result1}
    outputs:
      final: output1

example:
  description: Example usage
  code: |
    from ai_hydro.workflows import workflow_name
    result = workflow_name(input1='value')

notes:
  - Important consideration 1
  - Important consideration 2

references:
  - "Citation 1"
  - "Citation 2"
```

### 4. Templates (`templates/`)

**Purpose**: Reusable code templates for common patterns

**Files**: Python files with well-documented template code

**Guidelines**:
- Include clear TODOs for customization
- Provide inline documentation
- Follow AI-Hydro coding standards
- Include usage examples in docstring

### 5. Datasets (`datasets/`)

**Purpose**: Reference data, benchmarks, and test datasets

**Guidelines**:
- Include metadata file (JSON) with each dataset
- Document data source and provenance
- Specify license and usage restrictions
- Keep datasets reasonably sized (<10MB if possible)
- Provide data dictionary

---

## File Formats

### JSON Files

- Use 2-space indentation
- Include comments using `"_comment"` fields
- Validate against schema before committing
- Sort keys alphabetically for consistency
- Use UTF-8 encoding

### YAML Files

- Use 2-space indentation (no tabs)
- Include inline comments where helpful
- Follow workflow schema structure
- Use meaningful anchor names for reuse
- Validate syntax before committing

---

## Contribution Workflow

### 1. Assess Need

Before adding new knowledge, check:
- Does this concept/tool/workflow already exist?
- Is this the right place for this information?
- Will this be useful to other users?

### 2. Choose Location

| Content Type | Location | File |
|-------------|----------|------|
| New hydrological concept | `concepts/` | `hydrology_concepts.json` |
| CAMELS attribute | `concepts/` | `camels_metadata.json` |
| Model information | `concepts/` | `model_descriptions.json` |
| Tool documentation | `tools/` | `tier{1,2,3}_*.json` |
| Complete workflow | `workflows/` | `{workflow_name}.yaml` |
| Code template | `templates/` | `{template_name}.py` |
| Reference data | `datasets/` | `{dataset_name}/` |

### 3. Follow Schema

All JSON files must conform to `schema.json`. Key requirements:

- Required fields must be present
- Data types must match specification
- Enums must use valid values
- References must be properly formatted

### 4. Write Clear Documentation

- **Definitions**: Clear, concise, accessible to non-experts
- **Examples**: Working code that can be copy-pasted
- **Context**: When and why to use this knowledge
- **References**: Cite sources with DOIs when possible

### 5. Validate

Run validation before committing:

```bash
# Validate all knowledge files
python scripts/validate_knowledge.py

# Test specific file
python scripts/validate_knowledge.py --file knowledge/concepts/hydrology_concepts.json

# Fix common issues automatically
python scripts/validate_knowledge.py --fix
```

### 6. Test Integration

Test that your changes work with the RAG engine:

```bash
# Test RAG connection and query
python scripts/test_rag_connection.py

# Test specific query
python -c "
from ai_hydro.rag import RAGEngine
engine = RAGEngine()
results = engine.query('your new concept')
print(results)
"
```

---

## Quality Standards

### Content Quality

1. **Accuracy**: All information must be factually correct
2. **Clarity**: Write for diverse audience (students to experts)
3. **Completeness**: Include all necessary context
4. **Consistency**: Follow existing patterns and terminology
5. **Currency**: Use current best practices and methods

### Documentation Quality

1. **Examples**: Provide working, tested code examples
2. **Context**: Explain when and why to use something
3. **References**: Cite authoritative sources
4. **Cross-links**: Reference related concepts/tools
5. **Units**: Always specify units for quantities

### Code Quality (for templates)

1. **PEP 8**: Follow Python style guidelines
2. **Type hints**: Include type annotations
3. **Docstrings**: Google-style docstrings
4. **Error handling**: Include appropriate try/except
5. **Comments**: Explain non-obvious logic

---

## Validation

### Schema Validation

The `schema.json` file defines the structure for all JSON files. Validation checks:

- Required fields are present
- Data types are correct
- Enum values are valid
- References are properly formatted
- No duplicate keys

### Content Validation

Beyond schema, validate:
- Examples execute without errors
- References are accessible
- Cross-references exist
- Units are SI standard
- Terminology is consistent

### Running Validation

```bash
# Full validation (all files)
python scripts/validate_knowledge.py

# Validate with verbos output
python scripts/validate_knowledge.py --verbose

# Auto-fix common issues
python scripts/validate_knowledge.py --fix

# Validate single file
python scripts/validate_knowledge.py --file knowledge/concepts/hydrology_concepts.json
```

---

## Examples

### Example 1: Adding a New Hydrological Concept

Edit `knowledge/concepts/hydrology_concepts.json`:

```json
{
  "effective_precipitation": {
    "definition": "The portion of precipitation that becomes streamflow, excluding losses to evapotranspiration, infiltration, and storage",
    "category": "hydrology",
    "synonyms": ["excess precipitation", "direct runoff"],
    "related_concepts": ["runoff_coefficient", "baseflow", "interception"],
    "units": "mm",
    "references": ["doi:10.1016/j.jhydrol.2019.124023"]
  }
}
```

### Example 2: Documenting a New Tool

Edit `knowledge/tools/tier2_wrappers.json`:

```json
{
  "calculate_aridity_index": {
    "full_path": "ai_hydro.climate.indices.calculate_aridity_index",
    "tier": "tier2",
    "category": "climate",
    "description": "Calculate aridity index (AI = PET/P) for a catchment",
    "purpose": "Quantify climate aridity to classify watersheds",
    "inputs": {
      "precipitation": {
        "type": "array",
        "description": "Mean annual precipitation [mm/year]",
        "required": true
      },
      "pet": {
        "type": "array",
        "description": "Mean annual potential evapotranspiration [mm/year]",
        "required": true
      }
    },
    "outputs": {
      "type": "float",
      "description": "Aridity index (dimensionless). AI < 0.5 = humid, AI > 2.0 = arid"
    },
    "usage_example": "from ai_hydro.climate.indices import calculate_aridity_index\nai = calculate_aridity_index(precipitation=1200, pet=800)\nprint(f'Aridity Index: {ai:.2f}')",
    "dependencies": ["numpy"],
    "references": ["doi:10.1016/j.jhydrol.2011.07.012"]
  }
}
```

### Example 3: Creating a New Workflow

Create `knowledge/workflows/sensitivity_analysis.yaml`:

```yaml
name: Parameter Sensitivity Analysis
description: Systematic sensitivity analysis of model parameters
category: modeling
version: 1.0.0

inputs:
  - name: model
    type: object
    description: Calibrated hydrological model instance
    required: true
  
  - name: parameters
    type: list
    description: List of parameter names to analyze
    required: true
  
  - name: perturbation_range
    type: tuple
    description: Relative perturbation range (min, max) as fractions
    required: false
    default: [0.8, 1.2]

outputs:
  - name: sensitivity_results
    type: DataFrame
    description: Sensitivity indices for each parameter

steps:
  - step: 1
    name: Setup Baseline
    tool: ai_hydro.workflows.modeling.run_model
    description: Run model with default parameters to establish baseline
    inputs:
      model: ${model}
    outputs:
      baseline: baseline_results
  
  - step: 2
    name: Parameter Perturbation
    tool: ai_hydro.workflows.modeling.perturb_parameters
    description: Systematically perturb each parameter
    inputs:
      model: ${model}
      parameters: ${parameters}
      range: ${perturbation_range}
    outputs:
      perturbed_models: model_ensemble
  
  - step: 3
    name: Compute Sensitivity
    tool: ai_hydro.workflows.modeling.calculate_sensitivity
    description: Calculate sensitivity indices
    inputs:
      baseline: ${baseline}
      perturbed: ${model_ensemble}
    outputs:
      results: sensitivity_results

example:
  description: Sensitivity analysis example
  code: |
    from ai_hydro.workflows import sensitivity_analysis
    from ai_hydro.models import GR4J
    
    model = GR4J(parameters={'X1': 320, 'X2': 2.5, 'X3': 90, 'X4': 1.5})
    results = sensitivity_analysis(
        model=model,
        parameters=['X1', 'X2', 'X3', 'X4'],
        perturbation_range=[0.5, 1.5]
    )
    print(results)

notes:
  - Uses Sobol sensitivity analysis method
  - Requires calibrated model as starting point
  - Results show first-order and total-order indices

references:
  - "Saltelli et al. (2008) Global Sensitivity Analysis"
```

---

## Review Process

### Self-Review Checklist

Before submitting, check:

- [ ] Content is accurate and up-to-date
- [ ] Examples execute without errors
- [ ] Schema validation passes
- [ ] Follows existing patterns
- [ ] Documentation is complete
- [ ] References are included
- [ ] No typos or grammatical errors
- [ ] Tested with RAG engine

### Pull Request Review

Maintainers will review:

1. **Relevance**: Is this valuable knowledge?
2. **Quality**: Meets documentation standards?
3. **Accuracy**: Information is correct?
4. **Integration**: Works with existing knowledge?
5. **Testing**: Properly validated?

---

## Questions?

If you have questions:

1. Check existing knowledge files for patterns
2. Review [README.md](README.md)
3. Ask in GitHub discussions
4. Open an issue for clarification

---

**Thank you for contributing to AI-Hydro's knowledge base!**
