# Claude Code prompt — E2E#1/#2: mount capital-markets + bridges on Railway (server.js)

Paste into Claude Code, run from the **life-command-center** repo. End with merge
+ deploy commands.

---

## Context (verified live + in code, 2026-06-03 — don't re-investigate the symptom)

The live app and the pg_crons both run on **Railway** (`lcc_cron_post` posts to
`lcc_railway_url` even with its default `target='vercel'`). But `server.js` (the
Railway Express server) imports only **9** handlers (`actions, admin, apply-change,
domains, entity-hub, intake, operations, queue, sync`) and **omits two existing
Vercel functions**: `api/capital-markets.js` and `api/bridges.js`. Their routes
fall through to the SPA catch-all and return **index.html (200)** instead of JSON.

- **E2E#1 (user-facing):** `/api/capital-markets?action=…` returns
  `<!DOCTYPE html>` → `JSON.parse` throws *"Unexpected token '<'"* in the frontend
  → the Capital Markets dashboard / exports / RCA import are broken on the live
  app. (`capital-markets.js` exports `default` at line 349.)
- **E2E#2 (integration):** the entire `/api/bridges` family returns SPA HTML.
  Active pg_crons don't use it (they hit mounted `/api/admin?_route=…`) and cadence
  is trigger-driven, so the core loop is intact — but the **Microsoft/Salesforce
  connector webhooks** live only here and silently fail if any subscription points
  at Railway. (`bridges.js` exports `default` at line 680, `_route`-dispatched.)

**No Vercel function-count impact:** both files already exist (they count toward
the 12); this is purely Railway routing — no new `api/*.js`.

## Task

### 1. Mount both handlers in `server.js`
Add imports alongside the existing nine:
```js
import capitalMarketsHandler from './api/capital-markets.js';
import bridgesHandler        from './api/bridges.js';
```
Mount the routes (place near the other `app.all` blocks):
```js
// Capital Markets — handles its own ?action= dispatch
app.all('/api/capital-markets', capitalMarketsHandler);

// Bridges — _route-dispatched; mirror the vercel.json friendly aliases
app.all('/api/bridges', bridgesHandler);
app.all('/api/enrichment-worker',          (req,res)=>{ req.query._route='worker';  bridgesHandler(req,res); });
app.all('/api/salesforce-changes',         (req,res)=>{ req.query._route='ingest'; req.query._source='salesforce'; bridgesHandler(req,res); });
app.all('/api/sharepoint-changes',         (req,res)=>{ req.query._route='ingest'; req.query._source='sharepoint'; bridgesHandler(req,res); });
app.all('/api/outlook-changes',            (req,res)=>{ req.query._route='ingest'; req.query._source='outlook';   bridgesHandler(req,res); });
app.all('/api/calendar-changes',           (req,res)=>{ req.query._route='ingest'; req.query._source='calendar';  bridgesHandler(req,res); });
app.all('/api/sf-write',                   (req,res)=>{ req.query._route='write';   bridgesHandler(req,res); });
app.all('/api/cadence-tick',               (req,res)=>{ req.query._route='cadence'; bridgesHandler(req,res); });
app.all('/api/sharepoint-extract',         (req,res)=>{ req.query._route='sp_extract'; bridgesHandler(req,res); });
app.all('/api/sharepoint-extract-callback',(req,res)=>{ req.query._route='sp_extract'; req.query.action='callback'; bridgesHandler(req,res); });
app.all('/api/admin/bridges',              (req,res)=>{ req.query._route='admin'; bridgesHandler(req,res); });
```
Match these to the current `vercel.json` rewrites exactly (they're the source of
truth for the `_route`/`_source` mapping) so Railway and Vercel behave identically.

### 2. Verify both run under Express (not Vercel-only)
Confirm neither handler uses Vercel-specific request/response APIs that Express
doesn't provide (e.g., `req.body` is fine — `express.json()` is already mounted;
watch for anything reading the raw stream, `res.json`/`res.status` are fine).
If either needs a small shim, add it; don't change handler logic.

### 3. Confirm connector-webhook targets (investigation, report in PR)
Determine where the Microsoft Graph / Salesforce change-notification subscriptions
actually POST (Railway vs a separate Vercel deployment). If they point at Railway,
this mount is what makes inbound MS/SF delta sync work; if they point at a Vercel
deployment, note that too. Document the finding in the PR so the bridges exposure
is settled, not assumed.

## Verify + ship
- After deploy, live-probe: `/api/capital-markets?action=<valid>` returns **JSON**
  (not HTML); the gov Capital Markets dashboard renders; `/api/bridges?_route=admin`
  returns JSON (freshness) instead of the SPA shell.
- `node --check server.js`. `ls api/*.js | wc -l` unchanged (no new files).
- End with merge + deploy commands.
