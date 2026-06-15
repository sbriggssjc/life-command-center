# Claude Code prompt — RESUME the corpus lease backfill (all guards verified live) — server-side drain

> GREEN-LIT. Every correctness guard the drain depends on is now verified LIVE by the
> independent gate:
> - `/Multi//Portfolio/` folder gate → `multitenant_deferred` (no domain lease minted).
> - dateless / create-4xx → deterministic terminal (`enrich_create_rejected`,
>   `dateless_active_lease`), no retry-burn.
> - transient (5xx/network) → retry + `MAX_ATTEMPTS=3` dead-letter cap.
> - **operator-agreement gate** → DaVita-doc-vs-Satellite-property routes to
>   `match_disambiguation` (`operator_mismatch`), NO write; verified on 5171/5175 → 30680
>   (0 leases on 30680) while a normal DaVita→DaVita doc (5368 → 25495) still enriched.
> - underlying: fill-blanks only, populated disagreements → `conflict` (Decision Center),
>   canonical guarantor edge + dedup, one-active-lease-per-property.
>
> Run the remaining corpus to completion SERVER-SIDE. No policy change — just drain. The
> receipts come back to me for the final end-gate.

## What to run
- Loop the EXISTING `handleLeaseBackfill` / `backfillOneLeaseDoc` path (reuse the handler,
  do NOT fork) until the eligible queue is empty (`scanned === 0`): in-domain
  (`vertical in (dia,gov)`) `detected_type=lease`, status `staged|attached`, not yet
  backfilled, `/Multi//Portfolio/` excluded.
- **Gentle on LCC Opps connections** (the small/auth tier — the artifact-offload /
  2026-05-29 lesson): SEQUENTIAL batches, a brief pause between ticks, the existing
  per-tick time budget. Background drain, not a race. Stop + report if `error` spikes or
  any tick returns 5xx.
- Idempotent + resumable: the `lease_backfilled_at` marker (and the terminal outcomes)
  drop processed rows out; a re-run only picks up the unfinished tail. Transient failures
  stay unmarked and retry under the dead-letter cap.
- **Do NOT reset any markers.** 5171/5175 are intentionally terminal (`operator_mismatch`,
  in the disambiguation lane) — leave them; they are NOT part of the drain.

## Report back — the aggregate receipts for my end-gate
Across the whole drain:
- counts: `scanned, enriched, needs_ocr, ambiguous (split out operator_mismatch vs
  address-ambiguous), no_domain, enrich_unprocessable, enrich_create_rejected (split out
  dateless_active_lease), error_dead_letter, multitenant_deferred, error`.
- enrich detail: `fields_filled_total, conflicts_total, ti_rows_total, leases_created,
  guaranteed_by_edges`.
- the `leases_created` list (property_id + lease_id + domain) — so I confirm each net-new
  lease was genuinely lease-less, single-operator, single-tenant (no `/Multi/` leak).
- the `operator_mismatch` list (doc id + matched property_id) — the cross-operator catches,
  so I confirm the gate is firing across the corpus, not just on 30680.
- the deferred tails (`enrich_create_rejected` / `enrich_unprocessable` / `needs_ocr`) with
  their reasons + `text_len` — to size the OCR / dateless-from-memorandum / format
  follow-ups.

## My end-gate (after you report — independent, read-only)
no dup edges (each asset 1 edge, canonical operator); no dup leases (no property >1 active
`folder_feed_lease`); no clobber (writes on blanks; disagreements → `conflict`,
spot-checked, incl. confirming high conflict counts like 5368's 4 are genuine); the
operator gate fired on every cross-operator match (none wrote through); 40041 + 30680 +
the cleaned records still clean; tails sized with reasons.

## Guardrails
- Receipts-first; end state is gated. ≤12 api/*.js; reuse the handler, no fork; no schema.
- Don't touch the cleaned records (dia 25312 / 19530 / 14365; canonical `guaranteed_by`
  edges; superseded provenance 1403859 / 1406606 / 1406607).
- Open the two flagged data-quality rows in the Decision Center (not blocking the drain):
  30680's phantom address (`1221 S Capitol Ave` vs CMS `1450 Kooser Rd`) and the stray
  `medicare_clinics 552652 → property 30680` `property_id` mis-link.
