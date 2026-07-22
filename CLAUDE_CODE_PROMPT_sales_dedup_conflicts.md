# Claude Code Prompt — Same-Sale Price Conflicts in the Live Sales Lane (Dialysis_DB)

## Objective
Collapse **conflicting records of the same sale** to one survivor. There are ~125 (property_id,
sale_date) groups (~144 extra rows) among live sales where the SAME property on the SAME date carries
**multiple different sold_prices** (e.g. property 25379 / 2017-12-28 → 5 rows, $2.48M–$3.75M; property
23632 / 2017-02-07 → $4.47M–$8.61M), from mixed sources (`costar_sidebar`, `historical_csv_import`,
null-source). These skew cap-rate charts and force the comp de-dup to pick a price arbitrarily.

## Already done
- The comps engine now de-dups these to one row via a normalized-address+state+date key
  (`rpc_query_comps`), so they no longer double-print — but the *surviving price is not chosen on
  quality*. This prompt fixes the source.

## Investigate
1. **Read `sales_dedup_tick`** (B1 continuous worker, scheduled `lcc-dia-sales-dedup-tick` */15) and
   its A2a survivor-selection. Determine why its key does NOT collapse (property_id, sale_date) when
   `sold_price` differs — likely price/sale_id is part of the identity, so conflicts read as distinct sales.
2. **Confirm these are one transaction, not many.** For a single dialysis `property_id` on one date,
   multiple differing prices are almost always conflicting records of one sale (source disagreement),
   not separate deals. Validate against a sample; note any genuine multi-parcel exceptions.
3. **Survivor rule.** Define quality-ranked selection per (property_id, sale_date): prefer
   `cap_rate_quality`/`validation` = validated, then a trusted source order (deed/county >
   historical_csv_import > costar_sidebar > null), then most-recent `updated_at`. Losers move out of the
   `live` lane (mark `transaction_state`), never hard-deleted; log to a reversible dedup log.

## Deliverable
`docs/data-quality/sales_dedup_conflicts_plan.md` + a dry-run table of each conflict group with the
proposed survivor and the demoted rows (with reason). Extend `sales_dedup_tick` (or add a companion
pass) to collapse (property_id, sale_date) conflicts using the survivor rule, idempotent and reversible.
Re-check the comp de-dup afterward so the surviving price is the quality-chosen one.

## Guardrails
- Never hard-delete; demote via `transaction_state` + log. Fully reversible.
- Conservative on genuine multi-parcel/portfolio edge cases — flag rather than merge when ambiguous.
- Keep `exclude_from_market_metrics` semantics intact.
