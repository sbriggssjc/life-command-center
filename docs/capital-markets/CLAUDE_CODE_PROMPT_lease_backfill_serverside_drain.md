# Claude Code prompt — drain the remaining in-domain lease backfill SERVER-SIDE (mechanical, gated end-state)

> The multi-tenant choke-point fix (PR #1197) is merged + live and the independent
> gate has verified the backfill is SAFE on multiple sampled batches: fill-blanks only
> (populated disagreements → Decision Center `conflict`, never overwritten), guarantor →
> canonical operator + a deduped `guaranteed_by` edge, one-active-lease-per-property
> (no duplicate leases), `/Multi//Portfolio/` docs gated out (`multitenant_deferred`),
> scanned PDFs → `needs_ocr` (no 500), property 40041 stays clean. Progress so far:
> **27 / 303** in-domain lease docs backfilled, **~276 remaining**.
>
> The remaining drain is purely mechanical, but the browser-driven capped ticks I was
> running are bounded by a 45s client timeout (~3–8 docs/tick ⇒ ~50 round-trips). Run
> the rest SERVER-SIDE with the full budget. NO policy change — just drain. Receipts
> come back to me for the end-gate.

## What to run
A one-shot drain that loops the EXISTING `handleLeaseBackfill` / `backfillOneLeaseDoc`
path (do NOT fork the logic — reuse the handler so every guard is inherited verbatim):

- Repeatedly invoke the capped drain (`POST /api/lease-backfill`, or call the handler
  directly in a node script with the service context) until the eligible queue is empty
  (`scanned === 0`), i.e. `subject_hint->>lease_backfilled_at` set on every in-domain
  lease row (status `staged|attached`, `vertical in (dia,gov)`), `/Multi//Portfolio/`
  excluded.
- **Gentle on the connection pool — the artifact-offload / 2026-05-29 lesson.** LCC Opps
  is the small tier (auth lives there; disk/connection incidents = sign-in lockout).
  Run **sequential** batches (no parallel fan-out), a brief pause between ticks, and use
  the existing per-tick time budget. This is a background drain, not a race.
- Idempotent + resumable: the `lease_backfilled_at` marker drops processed rows out of
  the queue, so a re-run only picks up the unfinished tail. Transient fetch/extract
  failures stay UNmarked and retry on a later tick (already the handler's behavior).
- **Change nothing else.** No schema, no policy, no new api/*.js. The multi-tenant gate,
  fill-blanks/conflict routing, edge dedup, and one-active-lease dedupe all stay as-is.

## Report back (the receipts for my end-gate)
Aggregate across the whole drain:
- `scanned, enriched, needs_ocr, ambiguous, no_domain, multitenant_deferred, error`
- `fields_filled_total, conflicts_total, ti_rows_total, leases_created, guaranteed_by_edges`
- The list of `leases_created` (property_id + lease_id + domain) — so I can confirm each
  net-new lease was genuinely lease-less, single-tenant, and not a `/Multi/` leak.
- Any `error` rows (id + reason) that persisted after retries — the OCR / unsupported-
  format tail to size the follow-up.

## My end-gate (after you report — independent, read-only)
I will verify on the live DBs before calling the backfill complete:
1. **No duplicate edges** — every `guaranteed_by` asset has exactly 1 edge, all from a
   canonical operator entity (no `guarantor <name>` orphans).
2. **No duplicate leases** — no property has >1 active `data_source='folder_feed_lease'`
   lease.
3. **No clobber** — `folder_feed_lease` writes only on blanks; every populated
   disagreement is `decision='conflict'` (Decision Center), nothing curated overwritten.
   Spot-check a sample of enriched leases.
4. **Multi-tenant gate held** — property 40041 still clean (guarantor NULL, no new
   lease/edge/provenance); zero `/Multi//Portfolio/` docs enriched.
5. **needs_ocr tail** sized for the OCR / docx-xlsx-format follow-up.

## Guardrails
- Receipts-first; the drain is mechanical but the END STATE is gated. Don't touch the
  cleaned records (dia leases 25312 NULL-guarantor / 19530 / 14365; the canonical
  `guaranteed_by` edges; the `superseded` provenance rows 1403859 / 1406606 / 1406607).
- Stay gentle on LCC Opps connections. Stop and report if `error` spikes or any tick
  returns a 5xx — don't hammer.
