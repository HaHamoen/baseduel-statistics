#!/usr/bin/env bash
# Build the site when its code changed, put the data beside it, check it, and
# upload it to Cloudflare Pages.
#
#   tools/deploy.sh [preview|main|mockup]      preview by default
#
# preview -> https://preview.<project>.pages.dev, main -> https://<project>.pages.dev,
# mockup -> https://mockup.<project>.pages.dev (something to look at before it
# goes on preview).
# Needs .cloudflare.env (CLOUDFLARE_API_TOKEN with Pages edit, and
# CLOUDFLARE_ACCOUNT_ID) and data already exported to web/public/data.
# BDSTATS_PAGES_PROJECT names the project (bd-stats).
set -euo pipefail
cd "$(dirname "$0")/.."

branch="${1:-preview}"
case "$branch" in
  preview|main|mockup) ;;
  *) echo "usage: tools/deploy.sh [preview|main|mockup]" >&2; exit 2 ;;
esac
if [ -f .cloudflare.env ]; then set -a; . ./.cloudflare.env; set +a; fi
: "${CLOUDFLARE_API_TOKEN:?is not set: put it in .cloudflare.env}"
: "${CLOUDFLARE_ACCOUNT_ID:?is not set: put it in .cloudflare.env}"
project="${BDSTATS_PAGES_PROJECT:-bd-stats}"

cd web
[ -f public/data/meta.json ] || { echo "no data: run the exporter first" >&2; exit 1; }

# The code is built only when it changed; the data is copied in below, so a
# data-only deploy skips the build.
if [ "${REBUILD:-}" = 1 ] || [ ! -f dist/index.html ] || [ -n "$(find src index.html \
     vite.config.ts package.json package-lock.json public/_headers \
     -newer dist/index.html -print -quit)" ]; then
  node_modules/.bin/tsc --noEmit
  node_modules/.bin/vite build --logLevel warn
fi

# The data is replaced, not merged, so a file the exporter removed is gone
# from the site too.
rm -rf dist/data
cp -r public/data dist/data
cp public/_headers dist/_headers

# Pages' free plan: 20,000 files, 25 MiB a file.
files=$(find dist -type f | wc -l)
if [ "$files" -gt 19000 ]; then echo "refusing: $files files" >&2; exit 1; fi
big=$(find dist -type f -size +24M -print -quit)
if [ -n "$big" ]; then echo "refusing: $big is over 24 MiB" >&2; exit 1; fi

# Nothing secret leaves this machine: webhooks, heartbeat URLs, tokens.
if grep -rIlE 'discord(app)?\.com/api/webhooks|betterstack\.com/api|betteruptime\.com|CLOUDFLARE_API_TOKEN|_PASSWORD' dist; then
  echo "refusing: the files above look like they hold a secret" >&2
  exit 1
fi

node_modules/.bin/wrangler pages deploy dist --project-name "$project" \
  --branch "$branch" --commit-dirty=true
