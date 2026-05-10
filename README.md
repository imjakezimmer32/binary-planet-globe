# Binary Planet Globe

Single-page Three.js scene: binary planets, galaxy jumps, Cloudflare Pages.

- **Local preview:** `npm install` then `npm run dev`
- **Deploy:** `npm run deploy` (Wrangler → project `binary-planet-globe`)

## Automatic Cloudflare deploys from this repo

This repo is configured to auto-deploy to Cloudflare Pages project
`binary-planet-globe` whenever code is pushed to the `main` branch.
Deployments are published to the `master` branch URL:
`https://master.binary-planet-globe.pages.dev/`.

One-time setup in GitHub (Settings → Secrets and variables → Actions):

1. Add secret `CLOUDFLARE_API_TOKEN` (token with Cloudflare Pages edit access).
2. Add secret `CLOUDFLARE_ACCOUNT_ID` (your Cloudflare account ID).

After these secrets are saved, every push to `main` deploys automatically.
