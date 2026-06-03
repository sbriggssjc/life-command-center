# Claude Code prompt — E2E#5 + nits: BD-engine consistency cleanup

Paste into Claude Code, run from the **life-command-center** repo. Three small,
related consistency fixes found during the live end-to-end loop testing. End with
merge + deploy commands (note any migration applied to LCC Opps
`xengecqvemvfknjvbvrq`).

---

## Context (verified live 2026-06-03 — don't re-investigate)

The full BD loop now closes in production (queue→opportunity→cadence→queue-advance;
property→lead→opportunity→cadence on BOTH domains; inbox→promote→My Work→Copilot).
Three consistency issues remain:

### E2E#5 — domain/vertical naming is inconsistent across the BD engine (the real one)
`v_priority_queue_enriched` grouped by `vertical, priority_band` shows **three
naming conventions coexisting**:
- short forms: `dia` (P0.5 171, P4 2, P5 16), `gov` (P0/P0.5/P1–P6/P8)
- long forms: `dialysis` (P7 130), `government` (P7 169) — the P7 steady-state rows
- `NULL` vertical: 5 P7 rows

`source_domain` is inconsistent the same way: P5 rows carry `dia`/`gov` while
`handlePriorityBand` (api/admin.js) filters `source_domain=eq.government|dialysis`
(long forms) — so the per-property band lookup **misses rows that carry short
forms** (the property-detail prospecting feed silently shows no band for those).
This is the third occurrence of the dia/gov alias bug class (after the
`getDomainCredentials` aliases and the QA#9 fixes).

**Fix at the source, not the consumers:** pick ONE canonical form (recommend the
short `dia`/`gov`, matching the frontend) and normalize:
1. Find where each writer sets `vertical` / `source_domain` (the BD sync functions
   on LCC Opps: `lcc_sync_*` entity/portfolio/listing-event/property-attribute
   syncs, `lcc_open_prospect_opportunity`, `bd_opportunities` writers in
   operations.js, and the P7 steady-state generator that's writing long forms).
   Normalize their outputs to the canonical form.
2. One-time data normalization (idempotent migration): UPDATE existing rows in the
   underlying tables (`bd_opportunities.vertical`, `lcc_entity_portfolio_facts`,
   whatever feeds `v_priority_queue_enriched.vertical/source_domain`) mapping
   `dialysis→dia`, `government→gov`; investigate + backfill the 5 NULL-vertical
   P7 rows from their entity's portfolio domain.
3. Normalize at the view boundary too (belt-and-suspenders): wrap
   `vertical`/`source_domain` in the view with a `CASE` alias map so any future
   stray long form still presents canonically.
4. Update `handlePriorityBand`'s filter to the canonical form (and accept both
   during transition).

### Nit 1 — queue-opened opportunities have `stage=null`
`lcc_open_prospect_opportunity` inserts `bd_opportunities` with `stage=null`,
while `bridgeCreateLead` uses `stage='identified'`. Align: default the RPC's
insert to `'identified'` (migration: `CREATE OR REPLACE FUNCTION`).

### Nit 2 — Next-step banner isn't cadence-aware
After "Create lead", the `bd_opportunity_auto_seed_cadence` trigger has ALREADY
seeded the cadence, but the property banner (`_udRenderNextStep` in detail.js)
still offers "Add to cadence" as the next step. Make the banner detect an
existing cadence/open opportunity for the owner entity (e.g., have create_lead's
response include `cadence_seeded: true` — it already knows — and stash it in
`_udCache` like `owner_entity_id`; or fetch the cadence state with the other
enrichments) and render the final state as **"On cadence ✓ — next touch <date>"**
instead of offering a redundant action. Keep "Add to cadence" only when no
cadence exists (the recovery path for entities without one).

## Verify + ship
- `SELECT vertical, count(*) FROM v_priority_queue_enriched GROUP BY 1` returns
  ONLY `dia`/`gov` (no long forms, no NULLs).
- `handlePriorityBand` returns a band for a P5 dia property (e.g. dia 26502 /
  Palestra Properties) — previously missed by the long-form filter.
- Queue-opened opportunities land with `stage='identified'`.
- After a create-lead on a fresh property, the banner shows the cadence state
  rather than offering "Add to cadence" redundantly.
- `node --check` on touched JS; function count unchanged; migrations idempotent.
