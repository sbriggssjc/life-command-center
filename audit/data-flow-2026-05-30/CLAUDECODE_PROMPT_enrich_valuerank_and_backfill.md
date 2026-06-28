# Claude Code (life-command-center) — value-rank the enrich worker + backfill-drain the SOS-manager pivots

## Why (verified live 2026-06-27)

ORE Phase 1 Unit A wired the orphaned SOS managers into the owner records and they
flowed end-to-end: signal mirror 298→946, `owner_contact_pivot` 172→**813 (729 with
a named decision-maker)**, and the owner-contact-enrich worker is attaching them
(0 failures). Two refinements from the live run:

1. **The worker selects FIFO, not value-first.** Its candidate query orders
   `updated_at.asc` (owner-contact-enrich.js batch selector). So as it drains the
   729 named pivots, it attaches oldest-first — the handful of high-value owners
   (only ~5–7 of the 729 are ≥$1M connected value) aren't prioritized, and the
   high-value ones are the entire point. It should attach + seed cadences for the
   **highest-value owners first**.
2. **Per-tick throughput is wall-clock-capped (~32 processed/tick)** regardless of
   the `limit` param (the function budget). Fine for steady state, but the one-time
   Unit-A backfill (729 named pivots) + the deed OCR backfill (~406 deeds) drain
   slowly on the daily/30-min crons.

## Unit 1 — value-rank the enrich worker's candidate selection

In the enrich worker's batch selector (`api/_handlers/owner-contact-enrich.js`,
the `owner_contact_pivot` candidate query, currently `order=updated_at.asc`):
- Order by **owner value DESC first**, then `updated_at.asc` as the tiebreak.
  Use the same value source the queue/worklist rank on — `lcc_entity_connected_value`
  (connected_property_value) and/or the portfolio rollup — joined by entity_id,
  NULLS LAST. So the highest-value contactless owners attach + seed cadences first,
  and the value-gated cadence-seed (#1353) fires on the owners that matter.
- Keep everything else identical (the guards, the wall-clock budget, the attach +
  seed-cadence path, idempotency). This is purely an ORDER BY change to the
  candidate pull.
- If joining the value cache in the PostgREST select is awkward, a small
  value-ranked view (`v_owner_contact_enrich_queue`) the worker selects from is fine
  — reuse the existing value columns; no new value math.

## Unit 2 — one-time backfill drain (operational, not a code change)

The 729 named pivots + ~406 deeds are one-time backlogs; the crons grind them at
~32/~6 per tick. For faster drain, add (or document) a **workstation batch** that
loops the endpoint with a bounded concurrency — the established `lease-ocr-backfill`
/ `geocode-backfill` script pattern:
- `scripts/owner-contact-enrich-drain.mjs` — POST `/api/owner-contact-enrich-tick`
  in a loop until `processed=0`, gentle pacing (respect the 60-connection tier),
  value-ranked order (Unit 1) so high-value drains first.
- Same for the deed OCR backfill if not already covered: loop
  `/api/document-text-tick?doctype=deed` until eligible=0 (Document AI is configured
  and working — ~$1.50/1k pages, ~$1.65 for the deed corpus). The existing
  `lcc-document-text` cron also drains it over time; the script is just for speed.
- Either is optional — the crons will finish the backlog; the script is for when you
  want it done now.

## Boundaries / verify

- life-command-center; the worker selector ORDER BY (+ optional view) + an optional
  drain script; no new api/*.js; reuse the value source + the existing attach/seed
  path. Reversible.
- `node --check`; suite green; the enrich tests still pass with the new ordering.
- **Live proof (Cowork):** after deploy, an enrich tick attaches the highest-value
  named owners first (verify a ≥$1M owner attaches + seeds a cadence ahead of the
  low-value tail); the focus session's top value reflects the high-value owners as
  they drain.

## Bottom line

Unit A's managers are flowing; this makes the worker spend its (budget-limited)
attach effort on the **highest-value owners first** instead of FIFO, so the few
high-value decision-makers reach outreach immediately — and gives a batch script to
drain the one-time backlog on demand rather than waiting on the cron.
