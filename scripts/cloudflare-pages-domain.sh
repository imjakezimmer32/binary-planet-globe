#!/usr/bin/env bash
# Attach custom domain to Cloudflare Pages AND ensure DNS points at the correct project.
# Requires CLOUDFLARE_API_TOKEN with Account Pages Edit + Zone DNS Edit for jakesarcade.app.
#
# Important: the astra game lives on astrabound-4ov.pages.dev — NOT astrabound.pages.dev
# (that URL is a different, older Pages project).
set -euo pipefail

PROJECT_NAME="${PAGES_PROJECT_NAME:-astrabound}"
CUSTOM_DOMAIN="${PAGES_CUSTOM_DOMAIN:-astra.jakesarcade.app}"
PAGES_CNAME_TARGET="${PAGES_CNAME_TARGET:-astrabound-4ov.pages.dev}"
TOKEN="${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN}"

if [[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  echo "Looking up Cloudflare account id…"
  CLOUDFLARE_ACCOUNT_ID="$(curl -fsS \
    -H "Authorization: Bearer ${TOKEN}" \
    "https://api.cloudflare.com/client/v4/accounts?per_page=1" \
    | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);if(!j.success||!j.result?.[0]?.id){process.exit(1)};process.stdout.write(j.result[0].id)})")"
  echo "Using account ${CLOUDFLARE_ACCOUNT_ID}"
fi

APEX="${CUSTOM_DOMAIN#*.}"
SUB="${CUSTOM_DOMAIN%%.${APEX}}"

resolve_zone_id() {
  if [[ -n "${CLOUDFLARE_ZONE_ID:-}" ]]; then
    echo "${CLOUDFLARE_ZONE_ID}"
    return 0
  fi
  local json
  json="$(curl -fsS \
    -H "Authorization: Bearer ${TOKEN}" \
    "https://api.cloudflare.com/client/v4/zones?name=${APEX}&status=active&per_page=1")"
  node -e "
let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
  const j=JSON.parse(d);
  const z=j.result&&j.result[0];
  if(!j.success||!z) process.exit(2);
  process.stdout.write(z.id);
})" <<< "${json}" 2>/dev/null
}

echo "Ensuring DNS for ${CUSTOM_DOMAIN} (zone ${APEX})…"
ZONE_ID=""
if ZONE_ID="$(resolve_zone_id)"; then
  echo "Using zone id ${ZONE_ID}"
else
  echo ""
  echo "Could not find zone \"${APEX}\" with this API token."
  echo "Zones visible to this token:"
  curl -fsS -H "Authorization: Bearer ${TOKEN}" \
    "https://api.cloudflare.com/client/v4/zones?per_page=50" \
    | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);if(!j.success){console.log('  (zone list failed — token may lack Zone Read)');return}(j.result||[]).forEach(z=>console.log(' -',z.name));})" || true
  echo ""
  echo "Fix: use a token from the Cloudflare account that owns jakesarcade.app,"
  echo "with Zone → DNS → Edit (and Zone → Zone → Read), OR set secret CLOUDFLARE_ZONE_ID."
  echo "Manual DNS (same account as the domain):"
  echo "  Type: CNAME   Name: ${SUB}   Target: ${PAGES_CNAME_TARGET}   Proxy: ON"
  ZONE_ID=""
fi

if [[ -n "${ZONE_ID}" ]]; then
  EXISTING="$(curl -fsS \
    -H "Authorization: Bearer ${TOKEN}" \
    "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records?name=${CUSTOM_DOMAIN}")"

  HAS_RECORD="$(echo "${EXISTING}" | node -e "
let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
  const j=JSON.parse(d);
  process.stdout.write(j.result&&j.result.length>0?'yes':'no');
})")"

  if [[ "${HAS_RECORD}" == "yes" ]]; then
    CURRENT="$(echo "${EXISTING}" | node -e "
let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
  const j=JSON.parse(d);
  const r=j.result&&j.result[0];
  if(!r){process.exit(0)}
  process.stdout.write((r.content||'')+' '+(r.proxied?'proxied':'dns-only'));
})")"
    echo "DNS record exists (${CURRENT})"
    if [[ "${CURRENT}" != *"${PAGES_CNAME_TARGET}"* ]]; then
      echo "WARNING: record may point at the wrong target. Should be ${PAGES_CNAME_TARGET}"
    fi
  else
    echo "Creating CNAME ${SUB} → ${PAGES_CNAME_TARGET} (proxied)…"
    CREATE_RESP="$(curl -fsS -X POST \
      "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records" \
      -H "Authorization: Bearer ${TOKEN}" \
      -H "Content-Type: application/json" \
      --data "{\"type\":\"CNAME\",\"name\":\"${SUB}\",\"content\":\"${PAGES_CNAME_TARGET}\",\"proxied\":true,\"ttl\":1}")"
    echo "${CREATE_RESP}" | node -e "
let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
  const j=JSON.parse(d);
  if(!j.success){console.error(JSON.stringify(j,null,2));process.exit(1)}
  console.log('Created DNS:', j.result.name, '→', j.result.content);
})"
  fi
fi

echo "Adding Pages custom domain ${CUSTOM_DOMAIN} to project ${PROJECT_NAME} (live at ${PAGES_CNAME_TARGET})…"
RESP="$(curl -sS -X POST \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${PROJECT_NAME}/domains" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data "{\"name\":\"${CUSTOM_DOMAIN}\"}")"

echo "${RESP}" | node -e "
let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
  const j=JSON.parse(d);
  if(!j.success){
    const msg=JSON.stringify(j.errors||j);
    if(/already exists|duplicate|already been taken/i.test(msg)){console.log('Pages domain already attached — OK');process.exit(0)}
    console.error(JSON.stringify(j,null,2));process.exit(1)
  }
  const r=j.result;
  console.log('Pages domain:', r.name);
  console.log('Status:', r.status);
  if(r.validation_data?.txt_name) console.log('TXT (if needed):', r.validation_data.txt_name, '→', r.validation_data.txt_value);
})"

echo "Done. Open https://${CUSTOM_DOMAIN}/ (allow a few minutes for DNS + SSL)."
