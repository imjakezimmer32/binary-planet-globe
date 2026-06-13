#!/usr/bin/env bash
# Attach a custom domain to the Cloudflare Pages project (same account as jakesarcade.app).
# Requires: CLOUDFLARE_API_TOKEN with Account → Cloudflare Pages → Edit (and DNS if auto-setup).
set -euo pipefail

PROJECT_NAME="${PAGES_PROJECT_NAME:-astrabound}"
CUSTOM_DOMAIN="${PAGES_CUSTOM_DOMAIN:-astra.jakesarcade.app}"
TOKEN="${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN}"

if [[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  echo "Looking up Cloudflare account id…"
  CLOUDFLARE_ACCOUNT_ID="$(curl -fsS \
    -H "Authorization: Bearer ${TOKEN}" \
    "https://api.cloudflare.com/client/v4/accounts?per_page=1" \
    | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);if(!j.success||!j.result?.[0]?.id){process.exit(1)};process.stdout.write(j.result[0].id)})")"
  echo "Using account ${CLOUDFLARE_ACCOUNT_ID}"
fi

echo "Adding Pages custom domain ${CUSTOM_DOMAIN} to project ${PROJECT_NAME}…"
RESP="$(curl -fsS -X POST \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${PROJECT_NAME}/domains" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data "{\"name\":\"${CUSTOM_DOMAIN}\"}")"

echo "${RESP}" | node -e "
let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
  const j=JSON.parse(d);
  if(!j.success){
    const msg=JSON.stringify(j.errors||j);
    if(/already exists|duplicate|already been taken/i.test(msg)){console.log('Domain already attached — OK');process.exit(0)}
    console.error(JSON.stringify(j,null,2));process.exit(1)
  }
  const r=j.result;
  console.log('Domain:', r.name);
  console.log('Status:', r.status);
  if(r.validation_data?.txt_name) console.log('TXT (if needed):', r.validation_data.txt_name, '→', r.validation_data.txt_value);
})"

echo "Done. SSL may take a few minutes. Open https://${CUSTOM_DOMAIN}/ when status is active."
