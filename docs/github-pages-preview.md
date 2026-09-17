# GitHub Pages preview (fork only)

Upstream deploys the frontend to **Cloudflare Pages** (`.github/workflows/deploy.yml`,
`scripts/deploy.sh`), which needs `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`. A fork has neither, so this repo carries a
GitHub Pages preview instead: `.github/workflows/gh-pages-preview.yml`
builds the site and publishes it to the fork's own Pages site, and
`scripts/preview_gh_pages.sh` reproduces the same layout locally.

It is guarded with `if: github.repository != 'flatironinstitute/neurosift'`,
so it can never run upstream.

## What the preview reproduces, and what it can't

The frontend reads **no build-time environment variables** — no `VITE_*`
anywhere — and every backend URL is hardcoded in `src/`
(`chat.neurosift.app`, `neurosift-job-manager.vercel.app`,
`neurosift-annotation-manager.vercel.app`, `runpack-*.neurosift.app`,
`api.dandiarchive.org`, `api-dandi.emberarchive.org`, `openneuro.org`).
The preview therefore talks to the same deployed services production talks
to, with nothing to configure. (The "staging"/"sandbox" in this codebase is
_DANDI_ staging, chosen at runtime by a user toggle — not a build context.)

Two differences from the Cloudflare deploy:

- **Credentials don't carry over.** DANDI/EMBER API keys live in
  `localStorage`, which is per-origin, so a key entered on `neurosift.app`
  does not exist on `<owner>.github.io`. The preview is anonymous browsing
  of public data. Any API that gates on `Origin` may also refuse it.
- **Deep links return HTTP 404.** Cloudflare Pages honors
  `public/_redirects` (`/* /index.html 200`). GitHub Pages has no rewrite
  engine at all; its only fallback is the site's single `404.html`, so both
  the workflow and the local script copy `index.html` to `404.html`. A deep
  link then serves the app shell and React Router resolves the route
  client-side — correct rendering, wrong status line. Nothing in the app
  depends on the status.

Nothing else is lost: `public/_redirects` contains exactly one line, and
there are no proxies, header rules, plugins, or edge/serverless functions in
this build. (`cf-workers/`, `nextjs/`, `job_runners/` and `python/` are
separately deployed services, unaffected by either deploy path.)

## The path problem

Cloudflare Pages serves from a domain root; a Pages **project site** is
served from `/<repo>/`. So the build takes a base path:

- `vite.config.ts` reads `NEUROSIFT_BASE_PATH`, defaulting to `"/"`. Unset,
  the build is byte-for-byte what it was before this change, so the upstream
  deploy cannot regress.
- `src/App.tsx` sets the router's `basename` from `import.meta.env.BASE_URL`,
  which Vite derives from that same `base` — one value, both places.

The workflow passes `/<repo>/`; the local script passes `/neurosift/` (override
with `REPO_NAME=`).

## One-time setup (manual — no workflow token can do this)

1. **Settings → Pages → Source → GitHub Actions.**
   This cannot be automated. `actions/configure-pages` accepts an
   `enablement: true` input, but it **does not work** from a workflow token:
   the run fails with _"Resource not accessible by integration"_. The input
   is deliberately not set in the workflow.
2. **Settings → Environments → `github-pages` → Deployment branches**: make
   sure the branch this workflow runs on is allowed (see the trap below).
3. Push to the preview branch, or run the workflow manually from the Actions
   tab. The URL appears on the job's environment link and is
   `https://<owner>.github.io/<repo>/`.

### Things that look broken but aren't

- **No `gh-pages` branch is created.** The GitHub Actions Pages source
  uploads an artifact and deploys it directly; it never writes a branch. Its
  absence is not a symptom of anything. (This fork _does_ have a `gh-pages`
  branch, left over from `preview-deploy-forks.yml` — see below.)
- **A job that fails instantly with zero steps and no log output** means the
  `github-pages` environment rejected the branch. That environment pins its
  deployment-branch policy to whatever the default branch was _when the
  environment was first created_; rename the branch or change the default
  later and deploys are refused before any step runs, with no error pointing
  at the cause. Fix it at **Settings → Environments → `github-pages` →
  Deployment branches**.

### Conflict with the older fork-preview workflows

`preview-deploy-forks.yml` and `preview-cleanup-forks.yml` publish previews
to a `gh-pages` **branch** under `previews/<slug>/`, using
`devel/gh-pages-root/404.html` as a redirect dispatcher. That is the
_branch_ Pages source. **A repository has only one Pages source**, so
selecting "GitHub Actions" in step 1 makes those two workflows publish to a
branch nobody serves. They are left in place (they're upstream's, and they
work for anyone using the branch source) but they are inert once this
preview is enabled. Pick one.

## Local preview

```bash
./scripts/preview_gh_pages.sh              # build + serve
./scripts/preview_gh_pages.sh --build-only # build only
PORT=8080 ./scripts/preview_gh_pages.sh    # serve elsewhere
```

It builds into `dist-gh-pages/<repo>/` with the Pages base path, copies
`index.html` to `404.html`, and serves it at
`http://localhost:5175/neurosift/` through
`devel/gh_pages_preview_server.mjs`, which reproduces Pages' fallback
(unmatched path → the site's `404.html`, status 404) so deep links are
exercised and not just the root. The ordinary `npm run build` into `dist/`
is untouched. `dist-gh-pages/` is gitignored and excluded from eslint and
prettier — otherwise the next lint run walks minified bundles.

## Branch layout

The divergence from upstream is permanent (upstream won't carry a Pages
workflow), so it is kept small and kept off the sync path:

- **`main-v2` stays identical to upstream.** Clean base for upstream PRs, and
  GitHub's "Sync fork" button keeps working. A diverged default branch makes
  that button offer "discard commits", which silently eats the preview work.
- **The preview lives on `main-v2-preview`, which should be the repo's
  default branch.** Not cosmetic: the `github-pages` environment only allows
  deploys from the default branch by default.
- **The workflow's push trigger points at `main-v2-preview`.** On the clean
  branch it could never fire, since that branch doesn't carry the file.
- **Minimize the divergence.** The `vite.config.ts` base-path change and the
  `basename` wiring are no-ops upstream (they default to `"/"`) and are
  plausibly upstreamable on their own. Land those upstream and the fork's
  divergence shrinks to one workflow file, a script, and this document —
  files upstream will never touch, so syncing stays conflict-free.
