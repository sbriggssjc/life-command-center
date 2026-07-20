# Claude Code (LCC) — `sf-record-sync-tick`: never discard a fetched record (interleave fetch + persist)

## Why (grounded live 2026-07-20, from real ticks)

The targeted sync worker (PR #1437) works — the Account drain is live on cron
`lcc-sf-record-sync-account` (jobid 174) and coverage is climbing. But its wall-clock
budget is spent wrongly, and at `limit=200` it produced a **200 OK that wrote nothing**.

Real responses:

```jsonc
// limit=200
{ "records_returned": 140,
  "lookup":  { "batches_run": 7, "batches_failed": 0, "batches_total": 10, "budget_stopped": true },
  "records_persisted": 0, "entities_created": 0,
  "persist": { "records_persisted": 0, "budget_stopped": true },
  "missing_before": 4627, "missing_after": 4627 }     // ← zero progress

// limit=40
{ "records_returned": 40,
  "lookup":  { "batches_run": 2, "batches_failed": 0, "budget_stopped": false },
  "records_persisted": 21, "entities_created": 1, "entities_matched": 20,
  "persist": { "budget_stopped": true },              // ← wrote 21 of 40
  "missing_before": 4627, "missing_after": 4606 }
```

**The flaw:** fetch and persist run as two sequential phases sharing one ~22s budget. The
lookup phase runs until the budget is gone, then the persist phase starts, immediately
sees no budget, and returns. Records already retrieved from Salesforce — which cost real
API calls — are **thrown away**. At `limit=200` that was 140 records discarded for zero
progress, reported as a successful run.

This matters beyond today's backfill: `SYNC_SPECS` is designed so Contact, Opportunity and
other objects reuse this worker. A budget flaw in shared infrastructure will bite every
future spec.

## What to build (`api/_handlers/sf-record-sync.js`)

### Unit 1 — interleave: fetch a batch, persist that batch, repeat

Restructure the drain loop so persistence happens per batch rather than as a second phase:

```
for each batch of ≤20 ids:
    if budget exhausted → stop the LOOP (clean exit, report partial)
    fetch batch  → persist batch immediately
```

- A fetched record is **always** persisted before the next fetch starts. The budget then
  bounds *how many batches run*, never *whether fetched work is kept*.
- Keep `batchSize ≤ 20` (the Salesforce OData 100-node ceiling — do not change).
- Reserve a small persist tail (e.g. stop fetching when remaining budget < the observed
  per-batch persist cost) so the final batch is never stranded mid-write.

### Unit 2 — make "discarded" impossible to report silently

- Add `records_discarded` to the response. With Unit 1 correct it should always be **0** —
  a non-zero value is a bug signal, not an accepted outcome.
- Keep `budget_stopped` but scope it honestly: it should mean "stopped starting new
  batches," not "abandoned fetched records."
- A tick that returns `records_returned > 0` and `records_persisted == 0` should be
  treated as anomalous — log it loudly. Today that combination looked like success.

### Unit 3 — measure throughput so the cron can be tuned on evidence

Observed per-tick persistence is variable (21 on one tick, 7 on another) and the cause
isn't yet known — it may be `ensureEntityLink` round-trips, or the needed-set recompute
running per tick. Add timings to the response: `ms_missing_set`, `ms_lookup`,
`ms_persist`, `records_per_second`.

If the needed-set computation is a meaningful share of each tick, consider caching it for
the duration of a tick (it already is) or across ticks with a short TTL — but **measure
before optimizing**; do not add a cache on speculation.

## Boundaries

LCC-Opps only · no SF writes · no dia/gov writes · no migration · idempotent (a re-drain
must still report ~0 created) · reversible (`metadata.via='sf_account_import'`) · do NOT
change `batchSize` above 20 · do NOT touch the T4c comp path in
`api/_shared/sf-record-lookup.js` · keep the `SYNC_SPECS` registry shape so other objects
inherit the fix automatically.

## Tests

- Interleaving: a run whose budget expires mid-drain persists **every** record it fetched
  (`records_discarded === 0`), and `missing_after < missing_before`.
- A budget that expires during fetch stops cleanly without a partial/unpersisted batch.
- `records_returned > 0 && records_persisted === 0` is asserted impossible under normal
  operation.
- Idempotency preserved: second drain over the same ids reports ~0 created.
- The Comp__c path is untouched (assert the shared module's behavior is unchanged).

## Verify (post-deploy)

1. `npm run verify:deploy`.
2. `POST /api/sf-record-sync-tick?object=account&limit=200` — the case that previously
   wrote nothing. Expect `records_persisted > 0`, `records_discarded: 0`, and
   `missing_after < missing_before`.
3. Compare per-tick throughput against the current cron baseline (~7–21 records/tick). If
   it improves materially, raise the cron's `limit` and/or widen the interval — the cron is
   `lcc-sf-record-sync-account`, jobid 174, currently `*/2` at `limit=40`.
4. Once `missing_after` reaches 0, **unschedule the cron** (`cron.unschedule(174)`) — it's a
   backfill, not steady-state work. A gentler steady-state schedule can be added later for
   newly-referenced accounts.
