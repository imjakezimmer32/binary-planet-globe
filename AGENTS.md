# AGENTS.md

## Cursor Cloud specific instructions

### Overview

AstraBound is a single-page static web app (Three.js polygon space/planet simulation) served as a single `index.html` with inline JS/CSS. No backend, no database, no build step.

### Running the dev server

```bash
npm run dev
```

This runs `npx serve -l 5500 .` and serves the app at http://localhost:5500/.

**Gotcha:** The first run after `npm install` will prompt to install the `serve` package via npx. The update script pre-installs it globally to avoid the interactive prompt.

### Deployment

```bash
npm run deploy
```

Requires `CLOUDFLARE_API_TOKEN` environment variable. Deploys to Cloudflare Pages project `astrabound`.

### Lint / Test / Build

- **No linter configured** — there is no ESLint or other lint tool in this project.
- **No automated tests** — there is no test framework or test suite.
- **No build step** — the app is served directly as static files (no bundler).

### Project structure

| File | Purpose |
|------|---------|
| `index.html` | Entire app (~5400 lines, inline Three.js scene) |
| `package.json` | Dev tooling: `serve` (dev server) and `wrangler` (deploy) |
| `site.webmanifest` | PWA manifest |
| `app-icon-*.png`, `og-image.png` | Static image assets |
| `.github/workflows/deploy-cloudflare-pages.yml` | CI/CD auto-deploy on push to main |
