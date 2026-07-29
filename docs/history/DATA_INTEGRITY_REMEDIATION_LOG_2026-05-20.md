# LCC Data Integrity — Remediation Log

**Date:** 2026-05-20 (executed 2026-05-20 → 2026-05-21)
**Companion to:** `DATA_INTEGRITY_AUDIT_2026-05-20.md`
**Mode:** Reversible quarantine / merge writes on production (dia + gov). **Zero deletes.** LCC Opps untouched.
**Reversibility:** every change is either an additive flag (clear to undo) or a logged FK repoint (replay in reverse from the merge-log tables).

---

## Summary of changes

| Finding | DB | Action | Rows affected | Reversal |
|---------|----|--------|---------------|----------|
| DQ-7 | dia | Placeholder property clones flagged `domain_classification_flag='duplicate_placeholder'` | 2,381 | clear flag |
| DQ-7 | gov | Placeholder clones set `intel_status='junk_no_data'` (1 survivor/address kept) | 6,638 | reset via `created_at` batch window |
| DQ-1 | dia | Out-of-band cap-rate sales (<0.03 or >0.10) `exclude_from_market_metrics=true` + note | 55 | flip flag |
| DQ-1 | gov | Out-of-band cap-rate sales `exclude_from_market_metrics=true` + reason | 518 | flip flag |
| DQ-2 | dia | Duplicate priced sales excluded, survivor referenced in note | 446 | flip flag |
| DQ-2 | gov | Duplicate priced sales excluded, survivor referenced | 203 | flip flag |
| DQ-5 | dia | recorded_owners merged (336→303 survivors), FKs repointed | 533 repoints | replay `dq5_owner_merge_log` |
| DQ-5 | gov | recorded_owners merged (1,278→1,189) | 543 repoints | replay log |
| DQ-5 | dia | true_owners merged (175→164) across 15 tables | 2,172 repoints | replay log |
| DQ-5 | gov | true_owners merged (1,367→1,276) across 5 tables | 1,389 repoints | replay log |
| DQ-10 | gov | Ownership-change stubs already excluded (0 new); price-less sidebar sales `needs_research=true` | 1,781 | flip flag |
| DQ-3 | gov | `listing_status` casing normalized; 5 sold-but-active listings closed | 7 + 5 | flip status |
| DQ-9 | gov | NULL-property sales `needs_research=true` (undated ownership_history already tracked) | 415 | flip flag |

**Totals:** ~10,400 rows quarantined/flagged, ~4,637 owner FK references merged-and-logged, ~3,156 duplicate owner identities collapsed. No row was deleted.

---

## Reversibility infrastructure (created this pass)

- `dia.dq5_owner_merge_map`, `dia.dq5_true_owner_merge_map` — survivor↔duplicate owner mappings.
- `gov.dq5_owner_merge_map`, `gov.dq5_true_owner_merge_map` — same for gov.
- `dia.dq5_owner_merge_log`, `gov.dq5_owner_merge_log` — append-only ledger of every FK repoint: `(table_name, fk_column, row_pk, old_owner_id, new_owner_id, merged_at)`. Replaying these UPDATE-back restores the pre-merge graph.
- Migration `dia_add_duplicate_placeholder_classification_flag` extended the `properties_domain_classification_flag_check` constraint to allow `'duplicate_placeholder'`.

### To reverse a merge (example)
```sql
-- dia recorded_owners repoints
UPDATE properties p SET recorded_owner_id = l.old_owner_id
FROM dq5_owner_merge_log l
WHERE l.table_name='properties' AND l.fk_column='recorded_owner_id'
  AND p.property_id::text = l.row_pk AND p.recorded_owner_id = l.new_owner_id;
-- repeat per table_name/fk_column
```

### To reverse a quarantine flag
```sql
UPDATE dia.properties SET domain_classification_flag=NULL WHERE domain_classification_flag='duplicate_placeholder';
UPDATE gov.properties SET intel_status=NULL WHERE intel_status='junk_no_data'
  AND created_at >= '2026-05-17 12:27:00+00' AND created_at < '2026-05-17 12:30:00+00';
UPDATE sales_transactions SET exclude_from_market_metrics=false WHERE cap_rate_notes LIKE '%DQ1 2026-05-20%' OR cap_rate_notes LIKE '%DQ2 2026-05-20%';
```

---

## Root-cause note for DQ-7 (needs an owner)

Both placeholder batches are point-in-time fan-outs from a single writer run:
- **gov:** 6,692 rows created `2026-05-17 12:27–12:30 UTC`, 49 addresses, 0 with real data.
- **dia:** ~2,400 rows, id range 40057–43553, all sharing earliest timestamp `2026-05-18 01:35:00 UTC`.

The quarantine cleans the symptom. **The application/cron path that created property rows without deduping against `(normalized_address, state)` should be located and fixed** so this does not recur — this is outside SQL scope (app code in the dia/gov pipelines).

---

## Surfaced for manual review (no safe auto-fix)

These were intentionally **not** auto-corrected because resolving them requires human judgment or data that cannot be fabricated.

**DQ-4 — ownership-chain breaks.** The chain-continuity metric (dia 27%, gov 48% breaks) lives in the free-text `buyer_name`/`seller_name` columns, not the owner FK tables, so the DQ-5 merge does not auto-resolve it. Most breaks are name variants; the residual are genuinely missing intermediate transfers. No fabrication is appropriate — route to ownership research.

**DQ-6 — facility-name addresses.** ~254 dia + ~212 gov property rows have a facility name instead of a street address (e.g. "Dialysis Unit", "Northern Michigan Hospital"). Route to the geocode/address-research queue; replace with the geocoded street address and keep the facility name in `building_name`.

**DQ-8 — lease anomalies.**
- dia `lease_id 23581` (property 147670, DaVita): `lease_start=2012-01-01`, `lease_expiration=2011-12-31` — a year-typo inversion. Fix the typo (likely expiration 2021-12-31) manually.
- gov: 11 properties with >1 active lease. Most are agency-name variants of one tenant (e.g. "Social Security" / "Social Security Administration" / "Social Security Office"; "FBI" / "Federal Bureau of Investigation") or junk-parsed agencies ("064 Square Feet", "Abc 9999", "XXX"). Some are legitimately multi-tenant (SSA + DOL). Review each: supersede the dup leases, delete the junk ones via the normal pipeline.

---

*All writes above were SELECT-verified before and after. The audit report's prioritized punch list items #1–#9 are resolved or flagged; the remaining review items are documented here for owner follow-up.*
