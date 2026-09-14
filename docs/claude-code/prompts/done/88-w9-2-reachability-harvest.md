# Prompt 88 — W9.2: Contact-reachability internal harvest (Wave 9, unit 1)

**Status: DONE (built, flag OFF, awaiting dry-run gate → Cowork flip). 2026-08-08.**

Wave 9 unit 1. Harvests INTERNAL sources only (SF-synced records, sidebar captures, intake
extraction snapshots) to fill the reachability gap: domain contacts with neither email nor phone
— dia 4,234/5,951 (71%), gov **10,542/15,434 (68%)** (gov measured for the first time this unit).
External acquisition (SOS/deed) is W9.1; web-search proxy stays PAUSED.

Two arms, deterministic-first: (1) deterministic exact-identity donor fills (arithmetic, NO LLM,
confidence 1.0), (2) LLM-attributed fills from intake snapshots with a verbatim-quote validator.
Proposal-only → the new `reachability_harvest_review` Decision Center lane → human confirm →
deterministic fill-blanks writer (domain contacts email/phone + provenance, reversible).

## Deliverables shipped
- Migration `supabase/migrations/20260826120000_lcc_w9_2_reachability_harvest.sql` (applied live
  to LCC Opps): 4 tables + 2 views + 8 fsp rows (`w9_2_internal_harvest`@60 / `comms_observed`@40,
  drift view = 0) + flag `W9_2_REACHABILITY_HARVEST` (OFF) + nightly cron 04:40 UTC.
- Planner `api/_shared/reachability-harvest-planner.js` (pure brain).
- Tick `/api/reachability-harvest-tick` + fill-blanks verdict writer + DC lane (all 6 touches) in
  `api/admin.js`; route in `server.js`; `_DC_FEDERATED`/SUBLANES/badge in `ops.js`; meta + render
  branch + `dcFedBulkReachabilityFills` bulk-confirm in `dc-lanes.js`.
- Tests `test/reachability-harvest-planner.test.mjs` (22). Lane-wiring + subroutes guards pass.
- Dry-run sheet `docs/audits/W9_2_reachability_harvest_dryrun_2026-08-08.md`; ROLLOUT_STATUS
  Wave 9 section + W9.2 row.

## Operator gate before flip
Redeploy Railway → `GET /api/reachability-harvest-tick?score=1&n=8` (deterministic pointers +
verbatim LLM quotes + `scan_errors:[]`) → review → flip `W9_2_REACHABILITY_HARVEST`→on.
