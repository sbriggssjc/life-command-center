# Sales Completeness — First Measurement (2026-05-24)

This session built diagnostic tooling that directly answers the user's original complaint: **"Most of the sample records we had were missing many elements of a sales transaction."**

## The numbers

### v_sales_completeness_summary (live sales only, post-A3 quarantine)

| Domain | Sales live | Avg score | Median | Perfect (100) | High (80-99) | Mid (60-79) | Low (40-59) | Critical (<40) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Dia | 3,588 | **72.7** | 75 | 14 (0.4%) | 1,474 (41%) | 1,646 (46%) | 446 (12%) | 8 (0.2%) |
| Gov | 3,421 | **72.5** | 75 | 0 | 1,208 (35%) | 1,688 (49%) | 503 (15%) | 22 (0.6%) |

Average completeness is ~73/100. About 12-15% of live sales are below 60 and worth triaging.

### v_sales_missing_field_rates (dia top 10)

| Field | Rows missing | % missing |
|---|---:|---:|
| `recorded_date` | 3,388 | **94.4%** |
| `transaction_type` | 3,292 | **91.8%** |
| `cap_rate_quality` | 2,287 | 63.7% |
| `broker` | 2,080 | 58.0% |
| `rent_at_sale` | 1,940 | 54.1% |
| `data_source` | 1,067 | 29.7% |
| `cap_rate` | 928 | 25.9% |
| `seller` | 866 | 24.1% |
| `buyer` | 800 | 22.3% |
| `sold_price` | 105 | 2.9% (continuous worker catches) |

### v_sales_missing_field_rates (gov top 10)

| Field | Rows missing | % missing |
|---|---:|---:|
| `lender_name` | 3,421 | **100%** (never captured) |
| `guarantor` | 3,421 | **100%** (never captured) |
| `financing_type` | 3,345 | **97.8%** |
| `lease_expiration` | 2,197 | 64.2% |
| `sf_leased` | 2,132 | 62.3% |
| `gross_rent_or_noi` | 1,999 | 58.4% |
| `broker` | 1,877 | 54.9% |
| `recorded_owner_id` | 1,636 | 47.8% |
| `sold_price_psf` | 915 | 26.7% |
| `agency` | 799 | 23.4% |

## What this tells us

- **Dia's biggest gap is `recorded_date` (94% missing)** — the deed recording date. CoStar sidebar captures the closing date but not the recording date in most cases. This is a C2 (sales writer refactor) target: pull `recordation_date` from CoStar's Public Record tab.
- **Dia's `transaction_type` (92% missing)** — the writer is leaving this NULL even when CoStar provides it. Cheap fix in `upsertDomainSales`.
- **Gov's `lender_name` and `guarantor` are NEVER populated** (100% missing) — the writer isn't even attempting to capture these from RCA / CoStar even though the schema has columns. Easy C2 win.
- **Gov's `financing_type` 97.8% missing** — same writer-side gap.
- **`broker` 58% missing on dia, 55% on gov** — significant. Some are residual writer gaps; some are legitimate (off-market sale).
- **`cap_rate` 25.9% missing on dia** — actually better than expected post-A5.

## How to use the views

```sql
-- Worst 50 live sales on dia (priced highest first, lowest completeness)
SELECT sale_id, property_id, sale_date, sold_price, completeness_score, missing_fields
FROM v_sales_completeness
WHERE completeness_score < 50
ORDER BY sold_price DESC LIMIT 50;

-- Per-field missingness sorted most-missed first
SELECT * FROM v_sales_missing_field_rates;

-- Distribution
SELECT * FROM v_sales_completeness_summary;

-- 30-day trend (after B7 has run a few nights)
SELECT * FROM v_data_health_trend
WHERE view_name = 'v_sales_completeness_summary'
ORDER BY day DESC;
```

## Continuous protection added in this session

| Worker | Schedule | Effect |
|---|---|---|
| `sales_needs_review_tick()` (dia + gov) | `5 * * * *` (hourly) | Catches new NULL-price live sales within 60 min and reclassifies to `needs_review`. Already caught 105 dia + ~10 gov rows that landed since A3b. |
| Extended `data_health_snapshot_tick()` | nightly 02:30 UTC | Now also snapshots `v_sales_completeness_summary` and opens a `completeness_regression` alert when avg score drops >1.5 pts vs prior snapshot. |

## What's recommended next

1. **C2 sales writer refactor (Track C, biggest user-visible win)**: extend `sidebar-pipeline.js::upsertDomainSales` to (a) persist `recorded_date` from the CoStar Public Record tab on dia, (b) populate `transaction_type` from extracted text, (c) capture `lender_name`/`guarantor`/`financing_type` on gov where CoStar/RCA provide them, (d) persist buyer/seller PII contacts per Decision #5. Each of these would lift the average completeness score by 5-15 points.
2. **A4b investigation**: 232 dia + 88 gov true deed orphans — research what these are.
3. **A6a chronological closure**: the harder ownership_history case (1,111 dia rows with different owners simultaneously open).
4. **C4 entity-collision detection**: BEFORE INSERT trigger that surfaces canonical-key collisions at write time (lighter complement to the hourly B2 worker).
