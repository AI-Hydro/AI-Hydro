#!/bin/bash
# Script to verify AI-Hydro extension installation

echo "=== AI-Hydro Extension Installation Verification ==="
echo ""

# Check if VSIX file exists
if [ -f "ai-hydro-1.0.0-alpha.1.vsix" ]; then
    echo "✓ VSIX file found: ai-hydro-1.0.0-alpha.1.vsix"
    echo "  Size: $(ls -lh ai-hydro-1.0.0-alpha.1.vsix | awk '{print $5}')"
else
    echo "✗ VSIX file not found!"
    exit 1
fi

echo ""
echo "=== Python Environment Check ==="

# Check Python 3
if command -v python3 &> /dev/null; then
    echo "✓ Python 3 found: $(python3 --version)"
else
    echo "✗ Python 3 not found!"
fi

# Check if Python dependencies are installed
if [ -f "python/requirements.txt" ]; then
    echo ""
    echo "Python dependencies required:"
    cat python/requirements.txt
    echo ""
    echo "To install: cd python && pip install -r requirements.txt"
fi

echo ""
echo "=== RAG Engine Check ==="

# Check if RAG engine exists
if [ -f "python/ai_hydro/brain/rag_engine.py" ]; then
    echo "✓ RAG engine found: python/ai_hydro/brain/rag_engine.py"
else
    echo "✗ RAG engine not found!"
fi

# Check if tools registry exists
if [ -f "python/ai_hydro/brain/tools_registry.py" ]; then
    echo "✓ Tools registry found: python/ai_hydro/brain/tools_registry.py"
else
    echo "✗ Tools registry not found!"
fi

echo ""
echo "=== Quick RAG Test ==="
echo "Running debug_rag_integration.py..."
echo ""

if [ -f "debug_rag_integration.py" ]; then
    python3 debug_rag_integration.py
else
    echo "✗ Debug script not found!"
fi

echo ""
echo "=== Next Steps ==="
echo ""
echo "1. Install the extension in VSCode:"
echo "   - Extensions → ... menu → Install from VSIX..."
echo "   - Select: ai-hydro-1.0.0-alpha.1.vsix"
echo ""
echo "2. Open Output panel in VSCode:"
echo "   - View → Output (or Cmd+Shift+U / Ctrl+Shift+U)"
echo "   - Select 'Cline' or 'AI Hydro' from dropdown (NOT 'Continue')"
echo ""
echo "3. Start a hydrological task and watch for RAG logs"
echo ""
echo "See TESTING_RAG_INTEGRATION.md for detailed instructions"
