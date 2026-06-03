# LCC End-to-End Flow Audit — 2026-06-03

Goal: verify every click resolves, the full loops close start→finish across both
databases, and the Microsoft/Copilot integration holds — no dead ends. Run as a
static sweep of all clickable handlers + a live walkthrough on the deployed app.

## Headline: a Railway-vs-Vercel routing gap (one root cause, two impacts)

`lcc_cron_post` (verified) posts to the **Railway** app even with its default
`target='vercel'` — so the live, user-facing deployment *and* the crons both run
on Railway (`tranquil-delight-production-633f.up.railway.app`). But `server.js`
(the Railway Express server) imports only **9** handlers and **omits two Vercel
functions**: `capital-markets.js` and `bridges.js`. Requests to their routes fall
through to the SPA catch-all and return **index.html with status 200** — a silent
dead end (the caller gets HTML, not JSON).

### E2E#1 — Capital Markets is dead on the live app  (HIGH, user-facing)
- `/api/capital-markets?action=…` → **200 `<!DOCTYPE html>`** (verified live). The
  frontend (`capital-markets.js`, `gov.js::renderGovCapitalMarkets`) fetches and
  `JSON.parse` throws *"Unexpected token '<'"* → the Capital Markets dashboard,
  exports, and RCA import are broken for the user.
- **Root cause:** `capital-markets.js` not imported/mounted in `server.js`
  (present in `vercel.json` functions only).
- **Fix:** mount `capital-markets.js` in `server.js` (verify it runs under Express
  — no Vercel-only req/res APIs).

### E2E#2 — `/api/bridges` family unrouted on Railway  (MEDIUM, conditional)
- `/api/bridges?_route=…` (cadence-tick, enrichment-worker, salesforce-changes,
  sharepoint-changes, outlook-changes, calendar-changes, sf-write) → **200 SPA
  HTML** (verified live). Not mounted in `server.js`.
- **Why it's not currently breaking the core loop:** the active pg_crons (last 4
  days) all hit **mounted** `/api/admin?_route=…` routes and return 200 JSON
  (geocode-tick, llc-research-tick, generate-research-tasks, merge-log-reconcile,
  availability-promotion-sweep, auto-scrape-listings). And cadence advancement is
  **trigger-driven** (`activity_event_advance_cadence` / `bd_opportunity_auto_seed_cadence`),
  not dependent on an HTTP cadence-tick. The primary OM-email intake uses
  `/api/intake?_route=outlook-message` (mounted; 405 on GET = correct).
- **The genuine risk:** the Microsoft/Salesforce **connector webhooks**
  (salesforce/sharepoint/outlook/calendar-changes), `sf-write`, and
  `enrichment-worker` live only on `/api/bridges`. If any external subscription
  (Graph/SF webhooks, connector deltas) points at the Railway URL, it silently
  gets HTML → inbound MS/SF delta sync quietly fails.
- **Fix:** mount `bridges.js` in `server.js`, **and** confirm where the connector
  webhook subscriptions actually point (Railway vs a separate Vercel deployment).

## What's clean (verified)

- **All in-app clicks resolve.** Static sweep across index.html + app.js/ops.js/
  detail.js/dialysis.js/contacts-ui.js: every `onclick` calls a defined,
  window-exposed function; every `navTo('pageX')` has a page div + a render case;
  every `action=`/`_route=` the frontend POSTs has a dispatch case on a *mounted*
  handler. 100+ handlers, 18 pages, all Copilot suggestion actions, all modals — clean.
- **BD spine loop** (Priority Queue/NBA → property → ownership ladder → resolve/
  link → create lead → cadence) — exercised live (gov) during the QA verification;
  dia uses the same `openUnifiedDetail` code path. Next-step banner, "Open
  opportunity →", review-lane resolver, ownership badges all confirmed working.
- **Review Console** — six lanes populate (gov lanes now counting), resolver
  advances, < 1s. **Property detail** — ownership-divergence + SOS-link badges
  return 200 (allowlist fix verified).
- **Microsoft/Copilot — the mounted paths work:** `/api/intake?_route=outlook-message`
  (Power Automate OM intake), `/api/operations` Copilot/agent actions
  (`daily_briefing`, `prospecting_brief`, etc.), and the `/api/copilot/*`
  passthrough are all mounted and dispatch correctly. The gap is specifically the
  `/api/bridges` connector webhooks (E2E#2).

## Recommended fix
Single Claude Code prompt: mount `capital-markets.js` + `bridges.js` in
`server.js` (Express), verify both run without Vercel-only APIs, and confirm the
connector-webhook subscription targets. See
`CLAUDECODE_PROMPT_E2E1_E2E2_railway_route_mounts.md`.

*Method: static handler→endpoint sweep (Explore agent) + live browser probes on the
Railway deployment + pg_net/cron forensics on LCC Opps, 2026-06-03.*
