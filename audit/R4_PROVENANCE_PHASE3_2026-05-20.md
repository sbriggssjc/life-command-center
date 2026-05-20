# R4-5 / R4-6 — Data-governance Phase-3 rollout (2026-05-20)

Closes the open audit items from
`audit/ROUND_4_FINDINGS_2026-05-20.md` for field-level provenance. See
also `docs/architecture/data_quality_self_learning_loop.md` and
`docs/architecture/field_source_priority_ramp_plan.md`.

## What changed

### LCC Opps (`xengecqvemvfknjvbvrq`)

Migrations applied:

1. **`20260520200000_lcc_r4_provenance_governance_phase3.sql`**
   - Reranks per owner field-by-field decisions
     - OM > Email for `dia.leases.{lease_expiration, lease_start, renewal_options}` (was a true 35/35 tie; OM dropped to 30)
     - CoStar > RCA for property attributes: `dia.properties.{year_built, address, parcel_number}`, `dia.property_documents.source_url`, `gov.properties.year_built`, `gov.property_documents.source_url`, `gov.parcel_records.improvement_value` (CoStar lowered to 45, below RCA=50)
     - CoStar wins `role` on `dia.contacts` (CoStar lowered to 30, below OM=40 and RCA=50)
   - Registers ~141 previously-unranked `(target_table, field_name, source)` writer-paths (R4-5). Skips two known writer-bug clusters intentionally: `gov.gov.leases.*` (double-schema typo, fixed in code below) and `gov.contacts.{contact_name, contact_email}` (column-name drift, see migration 20260511120000).
   - Flips the owner-decided rules' losing-side from `record_only` → `warn`. **No flips to `strict`** — Phase-3 needs a `[field-provenance:warn]`-log observation cycle before strict. See "Next steps" below.

2. **`20260520210000_lcc_r4_resolve_stale_conflicts.sql`**
   - Marks 273 historical conflict log rows as `superseded` where the
     currently-authoritative source outranks the rejected conflict
     source under the new registry. These were tied at recording time;
     the registry changes broke the tie in the current value's favor.
     Pure audit-trail cleanup — no domain DB writes.

### LCC Opps codepaths (`api/_handlers/sidebar-pipeline.js`)

- **`gov.gov.leases` writer typo fix.** The `provCollect` flush
  re-prefixes with `${tablePrefix}.`; two `pushProvenance` calls in
  `upsertGovernmentLeases` passed the already-qualified
  `'gov.leases'`, producing `gov.gov.leases.*` rows in
  `field_provenance`. Switched to the unqualified `'leases'`.
- **List price / cap rate parsing before provenance recording.** The
  available-listings provenance branch was passing CoStar's raw
  `metadata.list_price` ("$3,690,000 ($246.00/SF)") and
  `Number(metadata.cap_rate)/100` ("6.7%" → NaN → null) to
  `recordCoStarFieldsProvenance`. Both now go through
  `parseCurrency` / `parseCapRateDecimal` first, matching what the
  actual `upsertDialysisListings` writer stores. Eliminates the
  fake same-priority "string vs number" conflicts CoStar vs OM.
- **`isJunkContactName` extensions.**
  - `firmSuffixRe` gained `Investors` alongside `Investments?` (was
    catching "LA Investors" et al.).
  - `labelRe` gained `Managing Partner | General Partner | Limited
    Partner | Partner` for the role-as-name leak (`contact_name =
    "Managing Partner"` vs OM's actual contact).

## Resulting state

| Metric | Before | After |
|---|---|---|
| `v_field_provenance_conflicts` | 485 | **212** |
| `v_field_provenance_unranked` | 163 | **22** (writer-bug rows; new sidebar writes go to canonical names) |
| `field_source_priority` rules | 1,393 | 1,534 |
| Rules in `warn` mode | 46 | 58 |
| Rules in `strict` mode | 12 | 12 (unchanged — Phase-3 didn't flip past warn) |

## What is still open

### 193 conflicts requiring a domain backfill review

After the rerank, 193 conflict-log rows now show
`conflicting_source_now_wins` — the rejected value was actually from
the higher-trust source under the new rules. To reconcile, the
*winning* value (currently `conflicting_value` in the log) has to be
written back into the live dia / gov tables. This rewrites live
domain data and was deliberately left for owner review.

Breakdown:

| Table | Field | Pair (now-winner ← now-loser) | Rows |
|---|---|---|---|
| `dia.contacts` | `role` | costar_sidebar ← rca_sidebar | 64 |
| `dia.contacts` | `role` | costar_sidebar ← om_extraction | 27 |
| `dia.property_documents` | `source_url` | costar_sidebar ← rca_sidebar | 21 |
| `dia.leases` | `lease_expiration` | om_extraction ← email_intake | 20 |
| `gov.property_documents` | `source_url` | costar_sidebar ← rca_sidebar | 18 |
| `dia.leases` | `renewal_options` | om_extraction ← email_intake | 9 |
| `dia.leases` | `lease_start` | om_extraction ← email_intake | 9 |
| `gov.properties` | `year_built` | costar_sidebar ← rca_sidebar | 7 |
| `dia.properties` | `address` | costar_sidebar ← rca_sidebar | 6 |
| `dia.properties` | `parcel_number` | costar_sidebar ← rca_sidebar | 5 |
| `gov.parcel_records` | `improvement_value` | costar_sidebar ← rca_sidebar | 4 |
| `dia.properties` | `year_built` | costar_sidebar ← rca_sidebar | 3 |

A reversible backfill should:
1. Snapshot the affected `(target_table, record_pk_value, field_name)`
   rows from the domain DBs into a side table (`r4_backfill_pre`).
2. For each conflict log row: UPDATE the domain DB to the
   `conflicting_value`. Match by `record_pk_value`.
3. Resolve the log row (mark `decision='superseded'`, point
   `superseded_by_id` at the new write's provenance row).
4. Compare post-state row counts to the snapshot to confirm.

The lease-term backfills (38 rows) are the most consequential — they
change which lease end dates the lifecycle triggers see. Suggest
walking each one in spreadsheet form before bulk-applying.

The 19 `still_tied` rows in `v_field_provenance_conflicts` are real
same-priority disagreements waiting for human review (e.g. two CoStar
captures with different DaVita brand canonicalizations).

### Phase-3 warn → strict cycle

12 rules already in strict (set in earlier rounds — see
`docs/architecture/field_source_priority_ramp_plan.md`). This round's
flips added 12 more rules to warn:

```sql
SELECT target_table, field_name, source
FROM   field_source_priority
WHERE  enforce_mode = 'warn'
  AND  notes LIKE '%R4-6 Phase-3 warn%';
```

After a cycle of Vercel function-log review for
`[field-provenance:warn]` lines on these rules, the same set can be
flipped to `strict` to actively block lower-priority writes. The
ramp doc's section "Recommended sequence" covers the operational
mechanics.

### Sidebar/parser quality

The two parser-quality fixes in this PR are conservative; further
junk-name patterns will surface as additional same-priority
conflicts accumulate. The diagnostic query for them is:

```sql
SELECT field_name, conflicting_value, current_value, count(*)
FROM   v_field_provenance_conflicts
WHERE  target_table = 'dia.contacts' AND field_name = 'contact_name'
GROUP  BY 1, 2, 3
ORDER  BY 4 DESC;
```

When a value-shape pattern crosses ~10 distinct records, that's the
signal to add another class to `isJunkContactName`.

## Out of scope this round

- **No `lcc_value_normalize_for_compare` change.** Stricter date-format
  normalization (e.g. `"2016-06-01T00:00:00.000Z"` ≡ `"2016-06-01"`)
  would auto-resolve ~12 still-tied entries but risks under-detecting
  real disagreements; defer to a focused session.
- **No CMS chain-org / county-records writer instrumentation** (still
  Phase 2.3 / 2.4 in `data_quality_self_learning_loop.md`).
- **No self-learning feedback loop** (Phase 4).
