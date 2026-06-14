#!/usr/bin/env bash
# Deploy site to Cloudflare Pages and optionally attach the production custom domain.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

PROJECT_NAME="${PAGES_PROJECT_NAME:-astrabound}"
BRANCH="${PAGES_DEPLOY_BRANCH:-main}"
CUSTOM_DOMAIN="${PAGES_CUSTOM_DOMAIN:-astra.jakesarcade.app}"
PRODUCTION_URL="https://${CUSTOM_DOMAIN}/"

TOKEN="${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN (Cloudflare dashboard → My Profile → API Tokens)}"

export CLOUDFLARE_API_TOKEN="${TOKEN}"

echo "Deploying to Cloudflare Pages project \"${PROJECT_NAME}\" (branch ${BRANCH})…"
npx wrangler pages deploy . --project-name "${PROJECT_NAME}" --branch "${BRANCH}"

if [[ "${SKIP_PAGES_DOMAIN:-}" != "1" ]]; then
  bash "${ROOT}/scripts/cloudflare-pages-domain.sh"
fi

echo ""
echo "Production URL: ${PRODUCTION_URL}"
echo "Pages preview:  https://${PROJECT_NAME}.pages.dev/ (may differ — check dashboard)"
