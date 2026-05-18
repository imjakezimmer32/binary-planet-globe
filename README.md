# astra

Single-page Three.js scene: astra polygon planets, galaxy jumps, Cloudflare Pages.

- **Local preview:** `npm install` then `npm run dev`
- **Deploy from your computer:** `npm run deploy` (uses Wrangler; needs `wrangler login` or `CLOUDFLARE_API_TOKEN`)

## Deploy from Git (automatic)

You only need **one** of these. If you turn on both, Cloudflare may run **two** deploys for every push.

### Option A — GitHub Actions (already wired in this repo)

1. In GitHub: **Settings → Secrets and variables → Actions**
2. Add secret **`CLOUDFLARE_API_TOKEN`** (Cloudflare API token with permission to edit Pages).
3. Push to **`main`**. The workflow in `.github/workflows/deploy-cloudflare-pages.yml` runs `wrangler pages deploy --project-name astrabound --branch main` (static files from the repo root).

Production URL: **https://astrabound-4ov.pages.dev/** — this is the `*.pages.dev` host for the existing Cloudflare Pages project named **`astrabound`**. Keep that project name in Wrangler and CI so deploys always hit this URL.

### Option B — Cloudflare “connect Git” (builds on Cloudflare)

1. In [Cloudflare dashboard](https://dash.cloudflare.com/): **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Choose this GitHub repo, production branch **`main`**, project name **`astrabound`** (or match your existing project).
3. **Build settings** (static site, no real build step):
   - **Build command:** leave empty, or use `exit 0` if the UI requires something.
   - **Build output directory:** `.` (the folder that already contains `index.html` — the repo root).
4. Save and deploy.

If you use Option B, **disable or delete** the GitHub Action deploy (or turn off automatic builds in Cloudflare) so you do not double-publish.

## Repo config for Wrangler

`wrangler.jsonc` sets the Pages project name, `pages_build_output_dir` (`.` = site files at repo root), `compatibility_date` for the Workers/Pages toolchain, and an optional **`ai` binding** used by the Pages Function at `POST /api/death-saying` (Workers AI) to generate **very short** respawn lines (`kicker`, `quote`, `note`, `cta`) when you die in lava or water.

### Workers AI (respawn lines)

1. In Cloudflare: **Workers & Pages** → your **astrabound** project → **Settings** → **Functions** → **Bindings** → add **Workers AI** with variable name **`AI`** (must match `wrangler.jsonc`).
2. Redeploy the site. If the binding is missing, the game still works: the client falls back to the bundled static death-screen prose.

Local `npm run dev` (static `serve`) does **not** run Pages Functions, so `/api/death-saying` will fail and the client will use the same fallback until you preview with `npx wrangler pages dev .` or deploy to Pages.
