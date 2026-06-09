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


## Addendum 4 — E2E#6 fixed (PR #1024, pending deploy + ordered migration)

Final-sweep findings all addressed by Claude Code:
- **(a) Targeting:** create-lead no longer anchors to the operator when
  `true_owner_is_operator` — frontend sends `true_owner_name: null` + the flag;
  `bridgeCreateLead` anchors entity/lead on the recorded owner (landlord). The
  mis-anchored "Davita" artifact fully dispositioned (opp `closed_lost`, cadence
  `dormant`, corrupt external_identity deleted, dia lead `void` + audit note —
  voided rather than renamed so the fixed flow re-creates one clean lead).
- **(b) Idempotence:** both `bridgeCreateLead` and `lcc_open_prospect_opportunity`
  now reuse an existing OPEN prospect opp (`already_open: true`); RPC changed to
  `RETURNS TABLE(opportunity_id, already_open)`.
- **(c) Persisted banner state:** `lookup_asset` entity id captured into the
  ownership cache on load; `handlePriorityBand` resolves open-opp + cadence state;
  the banner renders "Lead is live" / "On cadence ✓" on fresh reopens.

**⚠️ Deploy ordering:** code deploy FIRST, then apply LCC migration
`20260603140000_…` (the RPC return-shape change breaks old code if applied
early). Data-cleanup portions already applied live (idempotent).

Post-deploy verification checklist: reopen dia 26502 → persisted banner state;
dia create-lead anchors to landlord; double-click → one opportunity +
`already_open`; only Rutherford & Strickland + Eagle River remain open.


## Addendum 5 — E2E#6 deployed, migration applied (ordered), verified live

Ordered sequence executed: code deploy → RPC migration applied to LCC Opps →
live verification on Palestra (dia 26502):

- **(a) Targeting ✓** — fresh create-lead anchors on the **landlord**:
  `marketing_leads.lead_name = 'Palestra Properties'` (no Davita anywhere).
- **(b) Idempotence ✓ (opportunities)** — deliberate double-click produced
  exactly ONE open opportunity. (Known scope boundary observed: TWO lead rows —
  the guard dedupes opportunities, not domain lead rows. Test duplicate voided
  with audit note.)
- **(c) Persistence ✓ (positive case)** — fresh reopen showed the persisted
  state; `/api/priority-band` correctly returns `open_opportunity:false`,
  `bd_opportunity_id:null` after the void.
- Open opportunities now: Eagle River, Rutherford & Strickland, + the new
  Palestra-anchored one. The voided Davita artifact stayed closed.

### Three small residuals (one mini follow-up for the #1024 chat)
1. **Banner negative case:** when the priority-band check says
   `open_opportunity === false` (entity resolved, nothing open), the banner
   still shows "Lead is live / Add to cadence" instead of re-offering
   "Create the lead" — one condition in `_udRenderNextStep`'s `needsLead`.
2. **Placeholder entity names:** ensureEntityLink matched an existing asset
   entity named `property <uuid>`; it should refresh placeholder-pattern names
   from the seeded owner name so BD surfaces read "Palestra Properties", not a UUID.
3. **Lead-row dedupe:** create_lead should skip inserting a new domain lead row
   when an open lead for the same property+source exists (mirror of the
   opportunity guard).


## Addendum 6 — E2E#6 residuals fixed (PR #1024 second commit, pending deploy)

All three residuals addressed, code-only (no migration / no ordering constraint):
1. Banner negative case — `needsLead` now includes `open_opportunity === false`
   from the authoritative priority-band check.
2. Placeholder entity names — `isPlaceholderEntityName` (`^property [0-9a-f-]+$`)
   + refresh helpers; `ensureEntityLink` and `bridgeCreateLead`'s
   entity_id-supplied path adopt the real owner name (soft-fail). The lingering
   `9bde3355…` placeholder self-heals on the next create-lead.
3. Lead-row idempotence — `bridgeCreateLead` checks for an existing open lead
   (gov: matched_property_id+lead_source; dia: source+source_ref, with
   `source_ref = property_id` now stamped) before inserting; voided/closed don't block.

Post-deploy verification plan: negative-case banner on a no-opp property;
`already_open` + name heal on Palestra (watch: heal must run BEFORE the
already_open early-return); double-click → 1 opportunity AND 1 lead row.


## Addendum 7 — PR #1024 residuals verified live; one new blocker found (E2E#7)

Final verification of the three residual fixes (all deployed):
- **Negative-case banner ✓** — gov 5450 (Bloomington) fresh open offers
  "Create the lead" when `open_opportunity === false`.
- **Lead-row idempotence ✓** — deliberate double-click on 5450 → exactly ONE new
  `prospect_leads` row.
- **`already_open` + name heal ✓** — one create-lead on Palestra reused the open
  opportunity (still exactly 1) AND healed the entity name from
  `property <uuid>` → **"Palestra Properties"**.

**E2E#7a (NEW BLOCKER, root-caused in SQL):** the create-lead opportunity insert
fails silently for any entity with a pre-existing cadence —
`23505 uq_cadence_contact_property` raised inside `bd_opportunity_auto_seed_cadence`
rolls back the opportunity. Verified: 5450's asset entity ("Acquest Development")
carries a pre-seeded cadence → lead created, opportunity never lands. Blast
radius: the ~305 pre-seeded cadence entities. Fix: trigger ON CONFLICT →
reactivate-and-link the existing cadence. Prompt:
`CLAUDECODE_PROMPT_E2E7_cadence_trigger_conflict.md` (also folds in two console
bugs: dia `v_sf_activity_feed.sf_account_id` 400 on every detail load, and
`renderRecentEmails` `jsStringArg` ReferenceError; plus design notes on
org-vs-asset entity duality for cross-flow idempotence and legacy `source_ref`
backfill).


## Addendum 8 — FINAL: E2E#7 verified live; audit closed

- **Console clean** on a fresh full load + dia Activity Log tab: the
  `v_sf_activity_feed` 400 and the `jsStringArg` crash are both gone.
- **Trigger fix verified** via the exact probe insert on the failing entity
  (Acquest, pre-seeded cadence): opportunity insert succeeds; the existing
  cadence reactivates-and-links (`phase=onboarding`, `bd_opportunity_id` set).
- **Terminal banner state**: Bloomington (gov 5450) on a cold open renders
  **"On cadence ✓ — Next touch Jun 3, 2026 · ✓ Owner › ✓ Lead › ✓ Cadence"** —
  the full spine completion detected purely from persisted state, with no action
  re-offered. The self-propelling contract's end state works.

### Audit closed. Final tally for 2026-06-03:
- **QA cycle:** 12 findings → fixed → verified live.
- **E2E cycle:** 7 finding clusters → fixed → verified live (Railway mounts incl.
  Capital Markets/bridges/intake-share; cadence owner FK; dia/gov
  canonicalization + orphan guard; targeting/idempotence/persisted state;
  cadence-trigger conflict; 2 console bugs).
- The BD spine closes end-to-end on both domains with correct landlord
  targeting, idempotent writes, persisted UI state, a queue that learns from
  actions, and the M365/Copilot surface reading live canonical state.

### Deliberately deferred (documented, not forgotten):
- Org-vs-asset entity unification for cross-flow dedupe (architectural; interim
  `source_property_id` dedupe shipped).
- Legacy dia `source_ref` backfill (3 rows; wrong-key risk > benefit).
- QA#8 auth enforcement flip (Scott's env-var decision; guard + readiness probe live).
- CI workflow for `npm test` (recommended; Scott's call).
- Next-state SOS adapters (CA/TX) — future-todo doc.

CLAUDE.md has been accumulating the session's engineering lessons (canonical
dia/gov forms, the unique-INDEX ON CONFLICT gotcha, the seed-probe collision) —
future sessions inherit them.
