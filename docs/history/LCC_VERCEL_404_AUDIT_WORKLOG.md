# LCC Vercel 404 Audit Worklog

## Objective
- Audit why homepage load may return Vercel `404 NOT_FOUND` after Daily Briefing homepage changes.
- Validate deployment/routing/build causes without assuming Daily Briefing UI logic is the root cause.

## Scope Checked
- App entry point and static root assumptions.
- `index.html` root behavior.
- `vercel.json` rewrites/headers and route implications.
- `package.json` build/runtime scripts.
- Vercel build output and route manifest.
- API route + app route compatibility under current Vercel config.

## What Was Verified
- `index.html` exists at repo root and references local assets/scripts (`app.js`, `styles.css`, etc.).
- `vercel.json` currently includes:
  - `"framework": null`
  - `"buildCommand": ""`
  - `"outputDirectory": ""`
  - only `/api/*` rewrites; no rewrite for `/`.
- Local `npx vercel build --yes` succeeded and produced:
  - `.vercel/output/static/index.html`
  - `.vercel/output/config.json` with `handle: filesystem` before rewrites.
- Generated routes show `/` should be served from filesystem when `index.html` is present.
- `app.js` does not use SPA URL routing (`history.pushState`, pathname routing), so homepage should still be `/`.

## Key Finding
- `vercel.json` was introduced in commit `c48ec9d` (blame shows full file from that commit).
- Because local build succeeds with valid static output, a production `NOT_FOUND` is most likely a deployment/project config mismatch or deployment selection issue, not Daily Briefing homepage JS rendering logic.

## Likely Cause Candidates (ranked)
1. Vercel project/deployment configuration mismatch (root directory / deployment alias / production target) causing `/` to resolve where `index.html` is absent.
2. Fragile `vercel.json` top-level build settings (`buildCommand: ""`, `outputDirectory: ""`) producing inconsistent behavior across environments/deploy contexts.
3. Static file miss in deployed artifact for `/` (less likely given local output includes `index.html`).
4. Non-root route access (e.g., deep-link path) without SPA fallback rewrite (not likely if failing exactly at `/`).
5. Daily Briefing code regression causing runtime errors (unlikely for Vercel `NOT_FOUND`, which is routing/deployment-level before app JS executes).

## Recommended Fix Direction
- Prefer deployment config hardening:
  - Remove `buildCommand` and `outputDirectory` keys from `vercel.json` unless explicitly needed.
  - Keep only required `rewrites`/`headers`.
  - Redeploy and verify `/` and `/index.html` both return 200.
- In Vercel dashboard/project settings, confirm:
  - Correct Root Directory (repo root for this project).
  - No conflicting framework preset/output dir overrides.
  - Production alias points at the expected successful deployment.

## What Worked
- Local Vercel build pipeline completed and generated full static + function output.
- Route manifest compilation confirms filesystem-first routing for root.

## What Did Not Work / Limits
- Could not retrieve full remote project settings via available local CLI subcommands.
- Actual production deployment metadata (alias target/build logs for failing deployment) was not directly fetched in this session.

## Alignment to Overall Project
- This isolates homepage `NOT_FOUND` risk to deployment/routing configuration, reducing chance of unnecessary rollback of Daily Briefing functional work.
- Next step should focus on production config verification and redeploy validation, then only app code if 404 is cleared but runtime issues remain.
