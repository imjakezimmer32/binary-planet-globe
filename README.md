# astra

Single-page Three.js scene: astra polygon planets, galaxy jumps, Cloudflare Pages.

- **Live site:** https://astra.jakesarcade.app/
- **Local preview:** `npm install` then `npm run dev`
- **Deploy from your computer:** `npm run deploy` (needs `CLOUDFLARE_API_TOKEN` — see below)

## One-time: give Cloudflare access (required to publish)

This repo deploys with **Wrangler** to your Cloudflare account. The cloud agent (and GitHub Actions) need an API token — they cannot use your browser login.

### Step 1 — Create an API token (about 2 minutes)

1. Open [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens).
2. **Create Token** → use template **Edit Cloudflare Workers** or build a custom token with:
   - **Account** → **Cloudflare Pages** → **Edit**
   - **Zone** → **DNS** → **Edit** (for `jakesarcade.app`, so the subdomain can point at Pages)
3. Copy the token (shown once).

### Step 2 — Add it where deploys run

**GitHub (recommended — auto-deploy on every push to `main`):**

1. GitHub repo → **Settings → Secrets and variables → Actions**
2. New repository secret: name **`CLOUDFLARE_API_TOKEN`**, value = the token from step 1
3. Push to **`main`** (or re-run the **Deploy to Cloudflare Pages** workflow)

**Your computer (manual deploy):**

```bash
export CLOUDFLARE_API_TOKEN="paste-token-here"
npm run deploy
```

That runs `scripts/cloudflare-deploy.sh`: uploads the site to Pages project **`astrabound`** and attaches **`astra.jakesarcade.app`**.

### Step 3 — Workers AI (optional, for dynamic death quotes)

1. Cloudflare → **Workers & Pages** → **astrabound** → **Settings** → **Functions** → **Bindings**
2. Add **Workers AI**, variable name **`AI`**
3. Redeploy once

Without this, death-screen text uses the built-in fallback lines (game still works).

## Deploy from Git (automatic)

You only need **one** of these. If you turn on both, Cloudflare may run **two** deploys for every push.

### Option A — GitHub Actions (already wired in this repo)

1. Add secret **`CLOUDFLARE_API_TOKEN`** (see above).
2. Push to **`main`**. The workflow deploys and runs `scripts/cloudflare-pages-domain.sh` for **astra.jakesarcade.app**.

Production URL: **https://astra.jakesarcade.app/** (Pages project **`astrabound`**; `jakesarcade.app` is already on Cloudflare nameservers).

### Option B — Cloudflare “connect Git” (builds on Cloudflare)

1. In [Cloudflare dashboard](https://dash.cloudflare.com/): **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Choose this GitHub repo, production branch **`main`**, project name **`astrabound`** (or match your existing project).
3. **Build settings** (static site, no real build step):
   - **Build command:** leave empty, or use `exit 0` if the UI requires something.
   - **Build output directory:** `.` (the folder that already contains `index.html` — the repo root).
4. Under **Custom domains**, add **`astra.jakesarcade.app`**.

If you use Option B, **disable or delete** the GitHub Action deploy (or turn off automatic builds in Cloudflare) so you do not double-publish.

## Repo config for Wrangler

`wrangler.jsonc` sets the Pages project name, `pages_build_output_dir` (`.` = site files at repo root), `compatibility_date` for the Workers/Pages toolchain, and an optional **`ai` binding** used by the Pages Function at `POST /api/death-saying` (Workers AI) to generate **very short** respawn lines (`kicker`, `quote`, `note`, `cta`) when you die in lava or water.

Local `npm run dev` (static `serve`) does **not** run Pages Functions, so `/api/death-saying` will fail and the client will use the same fallback until you preview with `npx wrangler pages dev .` or deploy to Pages.
