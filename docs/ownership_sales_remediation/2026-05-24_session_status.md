# Ownership & Sales Remediation — 2026-05-24 Session Status

Cumulative through commit `c2d801f`. Picks up after PR #930 + #937 merged.

## What landed this session

### Track A (one-shot cleanup)
- **A1 entity dedup**:
  - dia: 35 losers merged across 15 clusters via `v_recorded_owner_canonical_clusters` (SMBC variants, VEREIT/ARCP/Cole REIT III, Truist/SunTrust, Sumitomo Mitsui variants, Realty Income/Agree variants). FK repoints: hundreds of properties, ownership_history, sales_transactions, medicare_clinics, contacts.
  - gov: 116 losers merged across 115 canonical_name groups.
  - All losers marked `merged_into_recorded_owner_id`; field-merge COALESCEs survivor with loser non-null fields; logged to `dq5_owner_merge_map` + `dq5_owner_merge_log` + LCC `audit_run_log` + `field_provenance`.
- **A6b ownership_history same-owner dedup**:
  - dia: 610 rows superseded (449 dup groups)
  - gov: 249 rows superseded (192 dup groups)
  - oh_active dropped from 7,749 to 7,139 on dia.

### Track B (continuous propagation)
- **B2 owner-merge-tick** (hourly on both domains): catches any new duplicates from sidebar/CSV/manual writers within 60 min. Same survivor-selection logic as A1.
- **B4 ownership-chain-tick** (nightly 03:45 UTC on both domains): surfaces chain breaks (seller of sale N+1 ≠ buyer of sale N) using canonical-key normalization. Baselines: dia 416 / gov 483 actionable break candidates for analyst review.

### Function library additions
- `apply_owner_merge(survivor, loser, canonical, run_id)` — bulletproof entity-merge primitive used by both A1 and B2.
- `owner_merge_tick()` — orchestrator for B2.
- `canon_owner_key(text)` IMMUTABLE — regex-based canonical key for owner-name comparison.
- `ownership_chain_tick()` — B4 cron entry point.

### Recovery scaffolding
- `scripts/audit/deferred/2026-05-24_lcc_outage_backfill.sql` — pattern for catching up `audit_run_log` writes if LCC Opps SQL endpoint times out mid-cleanup (happened once this session and recovered within ~10 min).

## Audit-log inventory (LCC Opps)

| log_id | step | domain | rows |
|---:|---|---|---:|
| 1 | foundation_verify | lcc_opps | 0 |
| 2 | A4a deed property_id sync (dry-run) | dia | 364 |
| 3 | A4a deed property_id sync | dia | 364 |
| 4 | A2a sales dedup | dia | 504 |
| 5 | A2a sales dedup | gov | 573 |
| 6 | A3a ownership stub reclassify | gov | 3,313 |
| 7 | A3b missing-price to needs_review | gov | 2,686 |
| 8 | A3b missing-price to needs_review | dia | 320 |
| 9 | A5 cap_rate retro-tag | dia | 1,301 |
| 10 | A5 cap_rate retro-tag | gov | 2,717 |
| 11 | **A1 entity dedup recorded_owners** | **dia** | **35** |
| 12 | **A1 entity dedup recorded_owners** | **gov** | **116** |
| 13 | **A6b ownership_history same-owner dedup** | **dia** | **610** |
| 14 | **A6b ownership_history same-owner dedup** | **gov** | **249** |

**Total: 13,294 row state changes since foundations went live, all reversible via `field_provenance.source_run_id`.**

## Cron workers now active (12 total across both domains)

| Worker | Schedule | Purpose |
|---|---|---|
| `lcc-{dia,gov}-sales-dedup-tick` | `*/15 * * * *` | Quarantine new duplicate sales |
| `lcc-{dia,gov}-cap-rate-quality-tick` | `15 3 * * *` | Tag new sales cap_rate_quality |
| `lcc-{dia,gov}-data-health-snapshot` | `30 2 * * *` | B7 daily snapshot + backslide alarms |
| `lcc-{dia,gov}-owner-merge-tick` | `0 * * * *` | Catch new duplicate owners |
| `lcc-{dia,gov}-ownership-chain-tick` | `45 3 * * *` | Surface new chain breaks |
| (existing) | `lcc-{dia,gov}-data-health-snapshot` includes alert rules |

## Updated symptom tracking

| User complaint | Status |
|---|---|
| Duplicates for the same sale on the same property | ✅ FIXED + can't recur (UNIQUE index + 15-min cron) |
| Missing many elements of a sales transaction | ⏳ MAJOR PROGRESS (price-missing live: 6,302→0; cap-rate quality tagged on 4,036 rows; contact PII persistence (C2) still pending) |
| Ownership history not in unison | ⏳ SIGNIFICANT PROGRESS (151 owner dupes merged; 859 same-owner-history dupes superseded; chain-break detection live; A6a chronological closure still TODO) |

## Plan status (32 total items)

- ✅ **DONE** (18): F1, F2, F3, F4, C1, C3 (N/A), C6, B1, B2, B4, B5, B7, A1, A2, A3, A4 (partial — A4b orphans pending), A5, A6 (A6b only)
- ⏳ **PARTIAL** (1): A6 — A6b done; A6a (chronological closure across different owners — 1,111 dia rows) still TODO
- ⬜ **TODO** (13): C2, C4, C5, C7, C8, C9, B3, B6, B8, A4b, A7, A8, A9

## Recommended priorities for next session

1. **C4 owner-entity BEFORE INSERT trigger** — closes the loop on A1/B2 by making duplicates impossible at write time (matches the C1 pattern for sales).
2. **A7 owner→SF link backfill** — now unblocked by A1; lift owner→SF coverage from 1.5–20% baseline. Salesforce-side; uses `sf-entity-backfill` script pattern.
3. **B8 Data Health dashboard tile** — surface snapshot trend + open alerts in `ops.js`. Bigger UI work.
4. **A6a ownership_history chronological closure** — 1,111 dia rows where different owners are simultaneously "open"; needs inference-based end_date.
5. **C2 sales writer refactor** — persist contact PII per Decision #5; bigger JS work.
6. **C8 RCM/LoopNet auth fix** — small Power Automate header tweak; low effort.

## Notable LCC Opps SQL outage learning

The LCC Opps SQL endpoint (`xengecqvemvfknjvbvrq`) timed out at the Supabase MCP layer for ~10 minutes during A6b. The project itself was `ACTIVE_HEALTHY` per metadata and REST writes were succeeding; only the SQL editor / execute_sql path was affected. The cleanup completed against the actually-reachable dia/gov endpoints and the `audit_run_log` writes were deferred to a backfill SQL file that ran successfully on recovery. Pattern documented at `scripts/audit/deferred/`.
