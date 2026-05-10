# AstraBound

Single-page Three.js scene: AstraBound polygon planets, galaxy jumps, Cloudflare Pages.

- **Local preview:** `npm install` then `npm run dev`
- **Deploy:** `npm run deploy` (Wrangler → project `astrabound`)

## Automatic Cloudflare deploys from this repo

This repo is configured to auto-deploy to Cloudflare Pages project
`astrabound` whenever code is pushed to the `main` branch.
Deployments are published from `main`:
`https://astrabound.pages.dev/`
(and branch previews like `https://main.astrabound.pages.dev/`).

One-time setup in GitHub (Settings → Secrets and variables → Actions):

1. Add secret `CLOUDFLARE_API_TOKEN` (token with Cloudflare Pages edit access).
After this secret is saved, every push to `main` deploys automatically.
