#!/bin/bash

# Release script for Esmeralda CLI
# Usage: ./scripts/release.sh <version>
# Example: ./scripts/release.sh 2.0.0

set -e

VERSION=$1

if [ -z "$VERSION" ]; then
    echo "Usage: ./scripts/release.sh <version>"
    echo "Example: ./scripts/release.sh 2.0.0"
    exit 1
fi

echo "Releasing Esmeralda v${VERSION}..."

# Update package.json version
npm version $VERSION --no-git-tag-version
echo "Updated package.json"

# Create commit
git add package.json package-lock.json
git commit -m "release: v${VERSION}"

# Create tag
git tag "v${VERSION}"

echo ""
echo "Release v${VERSION} prepared!"
echo ""
echo "Next steps:"
echo "  1. Confirm jade-orm-core already has tag v${VERSION} (do not publish CLI before core)"
echo "  2. git push origin master --tags"
echo ""
echo "The GitHub Action will inject the version from the tag and publish to npm."
