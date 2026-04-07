#!/bin/bash
# Clean rebuild script for AI-Hydro extension
# This fixes stale build artifacts that may cause duplicate UI elements

echo "🧹 Cleaning build artifacts..."

# Remove all build outputs
rm -rf webview-ui/dist
rm -rf webview-ui/build
rm -rf node_modules/.cache
rm -f *.vsix

echo "✅ Clean complete"
echo ""
echo "📦 Rebuilding webview frontend..."

# Rebuild webview
cd webview-ui
npm run build
cd ..

echo "✅ Webview build complete"
echo ""
echo "🔨 Packaging extension backend..."

# Package the extension
npm run package

echo "✅ Backend package complete"
echo ""
echo "📦 Creating VSIX package..."

# Create VSIX
npx vsce package --allow-package-secrets sendgrid

echo "✅ VSIX package created"
echo ""
echo "🎉 Clean rebuild complete!"
echo ""
echo "📋 Next steps:"
echo "1. Find the .vsix file in current directory"
echo "2. In VSCode: Extensions → '...' menu → Install from VSIX"
echo "3. Select the newly created .vsix file"
echo "4. Reload VSCode"
