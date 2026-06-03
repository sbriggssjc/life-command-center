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


---

## Addendum — live loop closure verified + E2E#3/#4 (later 2026-06-03)

**E2E#3 (FOUND VIA LIVE CLICK, FIXED, VERIFIED):** "Open opportunity →" failed with
`open_opportunity_failed`. Root cause: `touchpoint_cadence.owner_user_id` FK'd to
`auth.users` while the app's owners live in `public.users` (the only such outlier
FK) — the cadence-seed trigger rolled back every terminal BD action. `bd_opportunities`
had **0 rows ever**. Fixed by re-pointing the FK to `public.users`
(migration `20260603120000_lcc_touchpoint_cadence_owner_fk_public_users.sql`, PR #1021).

**The full BD loop now closes in production (exercised for real):**
- Queue path: `open_opportunity` on EAGLE RIVER INVESTORS – HAWAII → 201, opportunity
  persisted, cadence auto-seeded, **entity instantly left P0.5** (the queue learns).
- Property path (real UI click on GSA Lakeland #3841's banner): `create_lead` →
  gov `prospect_leads` row + LCC opportunity (`identified`, origin `property_flow`)
  + cadence seeded + "Lead created" activity event + **banner live-advanced**
  (✓ Owner › ✓ Lead › Cadence).

**E2E#4 (NEW):** `api/intake-share.js` (iOS Shortcut "Send to LCC" share target) is
unmounted on Railway — confirmed live (returns SPA HTML). Same class as E2E#1/#2;
one-line `server.js` mount. (No vercel.json rewrite needed — Vercel auto-routes it.)

**Minor nits:** (1) queue-opened opportunities carry `stage=null` vs `'identified'`
from create_lead — align in `lcc_open_prospect_opportunity`. (2) The next-step
banner offers "Add to cadence" even when the create-lead trigger already seeded
the cadence — banner should detect an existing cadence and show "On cadence ✓".


## Addendum 2 — full loop matrix verified live (later 2026-06-03)

All remaining loops exercised with REAL writes and verified in both DBs:

| Loop | Result |
|---|---|
| Queue → open opportunity (gov) | 201 → opportunity + cadence persisted → entity left P0.5 (queue learned) |
| Property → create lead (gov, real UI click) | `prospect_leads` row + opportunity (`identified`) + cadence + activity event + banner live-advanced |
| Property → create lead (dia, real UI click) | `marketing_leads` row (DaVita Inc. / Palestra Properties) + banner live-advanced — **both domain write paths confirmed** |
| Inbox → Promote (real UI click) | toast → item left inbox → **My Work 0→1** with the promoted action |
| Copilot agent actions | `get_daily_briefing_snapshot` returns a real briefing; `generate_prospecting_brief` responds (graceful no-engagement case); `get_my_execution_queue` **already shows the just-promoted action** — the M365 agent sees the canonical queue live |

**E2E#5 (NEW):** domain/vertical naming inconsistency across the BD engine —
`vertical`/`source_domain` mix `dia|gov`, `dialysis|government`, and NULL across
bands (P7 rows long-form, others short-form). `handlePriorityBand` filters
long-form so short-form rows miss their band on the property detail. Third
occurrence of the alias bug class. Fix prompt:
`CLAUDECODE_PROMPT_E2E5_bd_engine_consistency.md` (also folds in the stage=null
and banner cadence-awareness nits).

Open items: E2E#4 intake-share mount (one-liner to the PR #1020 chat), E2E#5
prompt, QA#8 enforcement decision, CI workflow decision.


## Addendum 3 — E2E#5 + nits closed (PR #1023, verified live by Claude Code)

- **Vertical canonicalization shipped at all three layers** — data migration
  (`dialysis→dia`/`government→gov` across `bd_opportunities`, `touchpoint_cadence`,
  `entities`, `lcc_entity_portfolio_facts`; `entities.domain='lcc'` correctly left
  alone), writer CASE-maps (`lcc_open_prospect_opportunity`,
  `lcc_seed_onboarding_cadence`), view-boundary re-normalization + orphan guard
  (`entity_id IS NOT NULL AND vertical IS NOT NULL`), and a transition-tolerant
  consumer filter in `handlePriorityBand` (`in.(dia,dialysis)`).
- Live: `vertical` → only **dia 320 / gov 796**; zero long forms, zero NULLs;
  the 6 orphan seed cadences soft-dispositioned to `phase='dormant'` + audit note
  (re-seed naturally via the auto-seed trigger if ever worked); P5 dia 26502
  (Palestra) now resolves its band.
- Nits closed: queue-opened opportunities now `stage='identified'`; `create_lead`
  returns `cadence_seeded`/`cadence_next_touch_due` and the next-step banner shows
  **"On cadence ✓ — next touch <date>"** instead of a redundant Add-to-cadence.

**Remaining open:** E2E#4 intake-share mount (one-liner to the PR #1020 chat);
merge/deploy PRs #1020/#1021/#1023 (no file overlap between them — clean merges);
then a final live confirmation pass. Standing decisions: QA#8 auth enforcement,
CI workflow.
