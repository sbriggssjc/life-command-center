# Track A Progress — 2026-05-23 → 2026-05-24

Continuation of `2026-05-23_week0_closeout.md`. Tracks all live cleanup runs executed via Supabase MCP through the `audit_run_log` + `record_cleanup_provenance` helpers.

## Runs executed

| log_id | run_id | step | domain | rows | duration | status |
|---:|---|---|---|---:|---|---|
| 1 | smoke_2026_05_23 | foundation_verify | lcc_opps | 0 | 0s | succeeded |
| 2 | A4a_dia_2026_05_23_001 | A4a_deed_property_id_sync | dia | 364 (dry) | 37s | succeeded |
| 3 | A4a_dia_2026_05_23_002 | A4a_deed_property_id_sync | dia | 364 | 29s | succeeded |
| 4 | A2a_dia_2026_05_23_001 | A2a_sales_dedup_quarantine | dia | 504 | 94s | succeeded |
| 5 | A2a_gov_2026_05_23_001 | A2a_sales_dedup_quarantine | gov | 573 | 34s | succeeded |
| 6 | A3a_gov_2026_05_24_001 | A3a_ownership_stub_reclassify | gov | 3,313 | 19s | succeeded |
| 7 | A3b_gov_2026_05_24_001 | A3b_missing_price_to_needs_review | gov | 2,686 | 22s | succeeded |
| 8 | A3b_dia_2026_05_24_001 | A3b_missing_price_to_needs_review | dia | 320 | 17s | succeeded |
| 9 | A5_dia_2026_05_24_001 | A5_cap_rate_retro_tag | dia | 1,301 | 235s | succeeded |
| 10 | A5_gov_2026_05_24_001 | A5_cap_rate_retro_tag | gov | 2,717 | 235s | succeeded |

10 runs total. ≈12,438 row state changes across the two domains, all reversible via `field_provenance.source_run_id`.

## Continuous propagation workers now active

| Domain | Cron job | Schedule | Function |
|---|---|---|---|
| dia | lcc-dia-sales-dedup-tick | `*/15 * * * *` | `sales_dedup_tick()` |
| gov | lcc-gov-sales-dedup-tick | `*/15 * * * *` | `sales_dedup_tick()` |
| dia | lcc-dia-cap-rate-quality-tick | `15 3 * * *` | `cap_rate_quality_tick()` |
| gov | lcc-gov-cap-rate-quality-tick | `15 3 * * *` | `cap_rate_quality_tick()` |

## Metrics, before → after

### v_data_health_sales

| Metric | Dia before | Dia after | Gov before | Gov after |
|---|---:|---:|---:|---:|
| `sales_total` | 3,880 | 3,880 | 9,914 | 9,924 (drift) |
| `sales_live` | 3,880 | **3,056** | 9,914 | **3,352** |
| `sales_duplicate_superseded` | 0 | 504 | 0 | 573 |
| `sales_ownership_stub` | 0 | 0 | 0 | **3,313** |
| `sales_needs_review` | 0 | 320 | 0 | **2,686** |
| `duplicate_groups_live` | 489 | **0** | 448 | **0** |
| `sales_live_missing_price` | 320 | **0** | 5,978 | **0** |
| `sales_live_cap_rate_outside_default_band` | 101 | 91 | 718 | 577 |

### cap_rate_quality distribution (live only)

| Domain | implausible_unverified | stated_only | market_implied (pre-A5) | NULL (no cap rate) |
|---|---:|---:|---:|---:|
| Dia | **490** | 811 | 0 | 1,755 |
| Gov | **1,391** | 1,326 | 18 | 623 |

Comp queries can now filter `WHERE cap_rate_quality NOT IN ('implausible_unverified')` to exclude out-of-class-band rows from comps. The narrower class bands (dia=dialysis 5.5–8 %, gov=government_leased 5–8 %) flag ~3x more rows than the prior default 3–10 % check.

## Schema additions this round

| Migration | Purpose |
|---|---|
| `dia_extend_cap_rate_quality_check` | Adds `verified` / `stated_only` / `implausible_unverified` to the allowed-values CHECK (was previously NOI-source-only). |
| `gov_extend_cap_rate_quality_check` | Mirror. |
| `dia_A5_cap_rate_retro_tag_and_B5_tick` | Adds `dia_asset_class_for()`, `cap_rate_quality_tick()` function, lcc-dia-cap-rate-quality-tick cron. |
| `gov_A5_cap_rate_retro_tag_and_B5_tick` | Mirror with `gov_asset_class_for()` mapping `OF`/`IN`/`RT` short codes correctly. |

## Notes & decisions captured during apply

### A3 (gov) split into A3a + A3b

The audit's "5,982 NULL-price live rows" turned out to be two distinct populations:
- **A3a — 3,313 actual ownership stubs** (`data_source` LIKE `ownership_change_stub%`). GSA lessor swaps. Reclassified `transaction_state='ownership_stub'`.
- **A3b — 2,686 real-but-incomplete sales** (`costar_sidebar`, `costar_export`, `excel_master` etc. with `transaction_type='brokered'/'Investment'/'Owner-User'/'foreclosure'`). These are genuine sales that lack `sold_price` — awaiting enrichment. Reclassified `transaction_state='needs_review'`.

The split treatment is more truthful than the plan's original "all to ownership_stub" — these need different downstream handling (the stubs should never get a price; the needs_review rows might via enrichment).

Dia had no ownership-stub pattern; all 320 missing-price live rows went to A3b/needs_review.

### A5 used domain-default asset class

92% of dia properties and 94% of gov properties have NULL `building_type`. Rather than build per-row classification, the asset_class mapping defaults the bulk to the domain default:
- dia default = `dialysis` (5.5–8 %)
- gov default = `government_leased` (5.0–8 %)

The `*_asset_class_for(building_type)` helper functions handle the long-tail building_type values (Medical Office, Retail, Industrial, etc.) for the few properties that have them populated.

Per-row asset_class can be refined later if richer building-type data lands — the cron worker picks up the new classifications on its next tick.

### Pre-existing CHECK constraint on `cap_rate_quality`

Round 76ek had pinned `cap_rate_quality` to NOI-source values only (`cmbs_audited`, `om_actual`, `om_pro_forma`, `market_implied`). The first A5 apply failed loud against this constraint. Hotfix extended the allowed list additively to include the band-check values (`verified`, `stated_only`, `implausible_unverified`). Old code paths still write the NOI-source values; A5/B5 owns the new ones.

### A2a side-effect: cap-rate outliers dropped naturally

`sales_live_cap_rate_outside_default_band` dropped on both domains between baseline and A3 (101→91 dia, 718→577 gov) without any cap-rate-specific action. That's because some of the duplicates A2a quarantined were also cap-rate outliers — quarantining them removed them from the `live` lane and therefore from the count.

## Provenance

10 `field_provenance` bulk-summary rows tagged `source='cleanup_run_<run_id>'`. Recovery query:

```sql
SELECT * FROM public.field_provenance
WHERE source_run_id IN ('A3a_gov_2026_05_24_001', ...)
ORDER BY recorded_at;
```

## Next priorities

User pre-selected B1+C1 for prior round (done); A3 + A5 + B5 for this round (done). Open candidates for the next session:

1. **A1 + C4 entity dedup** — 1,399 redundant owner rows. Architecturally foundational. Bigger build (FK repointing across multiple tables) + BEFORE INSERT trigger to make it stick.
2. **B7 backslide alarms** — daily health checks that surface regressions in the dashboard views. Small build, big confidence boost.
3. **A4b deed-orphan investigation** — the 232 dia + 88 gov true orphans (no join-table link, no column). Smaller cleanup but closes the deed-records loop.
4. **C2 sales writer refactor** — extends sidebar `upsertDomainSales` to persist contact PII (buyer/seller email/phone/address) per Decision #5 and persist lat/long. Bigger code change in JS.
5. **A6 ownership_history overlap** — query for overlaps; if 0, add the EXCLUDE constraint (C5) immediately.
