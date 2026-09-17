#!/bin/bash

# Builds the frontend the way .github/workflows/gh-pages-preview.yml builds
# it - sub-directory base path, index.html copied to 404.html - and serves
# it with GitHub Pages' fallback behavior, so deep links are exercised
# locally instead of only at the root.
#
#   ./scripts/preview_gh_pages.sh              # build and serve
#   ./scripts/preview_gh_pages.sh --build-only # build only
#   PORT=8080 ./scripts/preview_gh_pages.sh    # serve elsewhere
#
# Output goes to dist-gh-pages/ (gitignored, and excluded from eslint and
# prettier - without that, the next lint run walks minified bundles).
# The ordinary `npm run build` into dist/ is left alone.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

# The Pages project site path. Matches the workflow, which uses the
# repository name.
REPO_NAME="${REPO_NAME:-neurosift}"
PORT="${PORT:-5175}"
BASE_PATH="/$REPO_NAME/"
OUT_ROOT="$REPO_ROOT/dist-gh-pages"
SITE_DIR="$OUT_ROOT/$REPO_NAME"

cd "$REPO_ROOT"

echo "Building with base path $BASE_PATH -> $SITE_DIR"
NEUROSIFT_BASE_PATH="$BASE_PATH" npm run build -- \
  --outDir "$SITE_DIR" --emptyOutDir

# GitHub Pages has no rewrite engine; public/_redirects is ignored there.
# Its single fallback is the site's 404.html, so index.html is copied to it.
cp "$SITE_DIR/index.html" "$SITE_DIR/404.html"
echo "Copied index.html to 404.html (Pages SPA fallback)"

if [ "$1" = "--build-only" ]; then
  exit 0
fi

exec node "$REPO_ROOT/devel/gh_pages_preview_server.mjs" \
  "$OUT_ROOT" "$BASE_PATH" "$PORT"
