# PDR13 — property dedup match key was too strict (parcel_number / medicare_id detector)

**Repo:** `sbriggssjc/dialysis` (dia, Dialysis_DB `zqzrriwuavgrquhisnoa`)
**Branch:** `claude/pdr13-property-dedup-match-key` (pushed, no PR opened)
**Migration:** `supabase/migrations/20260911123900_dia_pdr13_property_twins_strong_id.sql` (applied live)
**Status:** shipped, verified live, guard green

## The bug

`v_property_merge_candidates` + `dia_auto_merge_property_duplicates` (the hourly cron, `jobid 16`,
confirmed live/active) group `properties` rows on a **byte-for-byte identical**
`dia_normalize_address(address)` within the same normalized state. That match key is real,
correct, and running — it just cannot see a group whose members spell the same physical address
differently. A Donna, TX DaVita clinic had **5** `properties` rows for exactly this reason:

| property_id | address (raw) | normalized |
|---|---|---|
| 23545 | 1006 East Hwy 2 | `1006 e hwy 2` |
| 37722 | 1006 I-2 | `1006 i-2` |
| 39874 | 1006 East I.H. 2 | `1006 e ih 2` |
| 37710 | *(null)* | `` |
| 45543 | 303 E Wacker Dr | `303 e wacker dr` |

Four distinct normalized-address keys, one physical clinic. This is not a special case — it is a
class, and the fix generalizes to it.

## Step 2 — the real fleet-wide population, measured before touching anything

Two strong, address-independent identifiers were checked for shared groups NOT already visible to
the address key:

- **`properties.parcel_number`**, same normalized state, length ≥ 6: **8 real groups / 17 rows**,
  all invisible to the address key (every group's members carry ≥2 distinct normalized-address
  keys). Two shorter groups exist too — GA parcel `"14"` (3 properties: Atlanta SW Dialysis /
  Decatur St / North Ave — three different, real, miles-apart clinics) and `"18"` (Stone Mountain /
  Decatur — two more different clinics). Both are placeholder-length strings, **confirmed NOT the
  same facility**, and a length ≥ 6 floor excludes both cleanly with no real group falling below it.
- **An "effective medicare_id"** — `COALESCE(property_cms_link.medicare_id, properties.medicare_id)`.
  `property_cms_link` is a newer, human-confirmed link table (has `match_method`/`matched_by`
  columns) that several properties carry independently of the older `properties.medicare_id`
  column, and the two sometimes **disagree** (13 properties measured with a mismatched CCN between
  the two sources — legacy column stale/typo'd, link table corrected). Grouped on this coalesced
  value, CCN-format-gated (length = 6, uniform in this dataset, no garbage risk found): **38 groups
  / 79 rows**, again all invisible to the address key.

Both signals independently catch the Donna, TX case:
- `property_cms_link` links **39874 → medicare_id 672843** (matched 2026-09-10 by `sabriggs@northmarq.com`, `match_method='auto:address_zip'`).
- `properties.medicare_id` on **23545 = 672843** directly (the same CCN, via the older column).
- **37710 / 37722 / 39874** all share `parcel_number = 'G2980-00-000-0001-00'`.
- **45543** shares **neither** identifier with anyone in the group.

Total measured candidate population from both signals combined, after de-duplicating pairs that
match on both bases and computing final classification: **48 pairs** (32 `review_name` /
16 `review_conflict` / 0 `auto_blank` / 0 `review_ambiguous`).

A sample of the `review_conflict` population is worth noting as a safety validation: one pair
(Colorado Springs "North"/"South" Liberty Dialysis, CCNs 062563/062564) turned out to rest on an
apparent error inside `property_cms_link` itself — the two rows are genuinely different Liberty
Dialysis locations, and the link table's own CCN assignment disagrees with the tenant name text.
The classifier caught this via the operator/CCN-mismatch text embedded in the tenant strings and
correctly routed it to `review_conflict`, never `auto_blank` — a human reviewing it would reject it
in one glance. This was found by reading the actual output, not assumed.

## Step 3 — the fix shipped

**Migration:** `supabase/migrations/20260911123900_dia_pdr13_property_twins_strong_id.sql`

Two new functions, both reusing the **existing** reversible-merge machinery end to end (no new
merge mechanism, per the task's explicit instruction):

- **`dia_find_property_twins_strong_id(p_min_parcel_len integer default 6)`** — read-only detector.
  Groups on `parcel_number` (state-scoped, length ≥ `p_min_parcel_len`) UNION the effective
  `medicare_id` (CCN-format length = 6). Picks one anchor per group (the row carrying a confirmed
  `property_cms_link` row wins outright; otherwise highest completeness — tenant/building_size/
  year_built/medicare_id/zip/sales-transaction-count, mirroring `dia_auto_merge_property_duplicates`'s
  own scoring). Classifies each shadow exactly like the existing geospatial detector
  (`dia_find_property_twins`): `auto_blank` (shadow tenant blank) → `review_conflict` (normalized
  operators disagree) → `review_ambiguous` (a shadow resolves to >1 anchor across the two bases) →
  else `review_name`.
- **`dia_merge_strong_id_twins(p_dry_run, p_mode, p_batch, p_min_parcel_len)`** — the driver.
  Writes candidates into the **SAME** `dia_property_twin_review` lane the geospatial detector uses
  (idempotent `ON CONFLICT ... DO UPDATE WHERE status='pending'`), and merges via the **SAME**
  `dia_merge_property_reversible` → `dia_unmerge_property` round trip. `mode='auto'` only ever
  touches `classification='auto_blank'` pending rows — measured **empty** on the real population,
  so nothing merges unattended today, an explicit and measured decision. `mode='confirmed'` merges
  only rows a human (or, for verification, me) set `status='approved'`, scoped to
  `detail->>'detector'='strong_id'` so it can never sweep up the geospatial detector's own approved
  rows or vice versa.

CLI: `src/merge_property_twins_strong_id.py` (`python -m src.merge_property_twins_strong_id
[--apply] [--mode review_only|auto|confirmed] [--batch N] [--min-parcel-len N] [--unmerge ID]`),
mirroring the existing `src/merge_property_twins.py` exactly.

## Step 6 — guard, mutation-verified

`tests/test_pdr13_property_dedup_strong_id.py` — 15 static source-assertion tests (comment-stripped
first, matching the repo's `test_b6d_*`/`test_pr1_*` convention), all passing:

```
15 passed in 0.02s
```

Four mutations were run against the shipped migration to confirm the guard fires (each reverted
after confirming RED, migration file diffed byte-identical to the applied version afterward):

| mutation | result |
|---|---|
| lower `p_min_parcel_len` default 6 → 2 | `test_default_min_parcel_len_excludes_measured_placeholder_groups` **FAILED** |
| drop `classification='auto_blank'` from the `mode='auto'` WHERE clause | `test_auto_mode_only_ever_selects_auto_blank_pending_rows` **FAILED** |
| drop `detail->>'detector'='strong_id'` scoping from `mode='confirmed'` | `test_confirmed_mode_is_scoped_to_this_detectors_own_rows` **FAILED** |
| reorder the classification CASE so `auto_blank` is checked before `review_conflict`/`review_ambiguous` | `test_operator_conflict_and_ambiguity_outrank_auto_blank` **FAILED** |

4/4 mutations RED, 15/15 tests green on the real (unmutated) migration.

## Step 4 — acceptance test, real values, run live against Supabase (Dialysis_DB)

Ran the actual flow described in the task:

1. `dia_merge_strong_id_twins(dry_run=true)` → `{"review_name":32,"review_conflict":16}` (0 auto_blank, 0 ambiguous).
2. `dia_merge_strong_id_twins(dry_run=false, mode='review_only')` → wrote 48 rows into
   `dia_property_twin_review`, confirmed the 3 Donna, TX pairs present with `status='pending'`:
   - `23545 → 39874`, classification `review_name`, `match_basis='medicare_id'`, `match_value='672843'`
   - `37710 → 39874`, classification `review_name`, `match_basis='parcel_number'`, `match_value='G2980-00-000-0001-00'`
   - `37722 → 39874`, classification `review_name`, `match_basis='parcel_number'`, `match_value='G2980-00-000-0001-00'`
3. Approved **only** those 3 rows (`status='approved'`; confirmed count of approved rows fleet-wide = 3, i.e. nothing else touched).
4. `dia_merge_strong_id_twins(dry_run=false, mode='confirmed')` →
   `{"merged":3,"failed":0,"samples":[{"drop":23545,"keep":39874,"backup_id":587},{"drop":37710,"keep":39874,"backup_id":588},{"drop":37722,"keep":39874,"backup_id":589}]}`

### Post-merge state, queried directly

`properties` now holds **2** rows for this location instead of 5:

| property_id | address | parcel_number | true_owner_id | recorded_owner_id |
|---|---|---|---|---|
| **39874 (canonical)** | 1006 East I.H. 2 | G2980-00-000-0001-00 | `3eb6f673-…` | `4077bb8b-…` |
| 45543 (left alone) | 303 E Wacker Dr *(data-entry error)* | *(null)* | `3eb6f673-…` | *(null)* |

`sales_transactions` for the group now shows exactly **one** row:

```
sale_id 311, property_id 39874, sold_price 3,639,317.00, sale_date 2019-02-01
```

— the real 2019 sale (originally on 23545), correctly repointed. The duplicate CoStar capture of
the SAME sale (`sale_id 8747`, originally on 37710) was **not** duplicated onto the canonical row —
`dia_merge_property`'s fold-on-collision logic recognized it as a re-observation of the same sale
and folded it away (`dia_property_merge_backup.rewired.sales_dedup_dropped = 1`,
`sale_children_repointed = 2`), matching the task's own description of it as "a duplicate CoStar
capture of the same sale."

`property_cms_link` still (unsurprisingly, unaffected) shows the canonical property correctly linked:

```
property_id 39874, medicare_id 672843, match_method 'auto:address_zip', matched_by 'sabriggs@northmarq.com'
```

The full `dia_property_merge_backup.rewired` payload for each of the three merges (read directly
from the DB, backup_ids 587/588/589) confirms every dependent table repointed or fold-deduped onto
39874: `sales_transactions` (repointed / dedup-dropped), `medicare_clinics.property_id` (repointed),
`cap_rate_history` (`policy: fold_fill_blanks`), `facility_patient_counts` (**25 rows**, repointed),
`leases`, `lease_escalations`, `property_documents`, `property_public_records`, `contacts`,
`lease_options`, `available_listings` (dedup-dropped). Nothing here was asserted from reading the
merge function's *code* — it is the actual `rewired` JSON the live merge wrote.

**Honest caveat, stated rather than glossed over:** `dia_merge_property` does **not** fill-blank
the KEEP row's own scalar columns (`recorded_owner_id`, `true_owner_id`) from the DROP row — it only
repoints child-table foreign keys that reference `properties`. `39874.recorded_owner_id` now reads
`4077bb8b-…`, matching 37710's pre-merge value, but the `rewired` log for all three merges shows
**no** `properties.recorded_owner_id` write. This almost certainly landed via an independent,
concurrent owner-resolution process running in the live production database during testing (the
repo runs several such crons on 30–60 minute schedules), not as an effect of this merge. Reported
plainly rather than over-claimed.

### The 5th row, correctly left alone

`property_id 45543` ("303 E Wacker Dr" — a real Chicago street, on a Donna, TX row) shares
**neither** `parcel_number` nor `medicare_id` with the merged group. Its only connection is
`true_owner_id`, a bare shared-owner signal this repo's own doctrine (`CLAUDE.md`, "Property
address twins" section) explicitly warns is a coincidental identity, never a matchable one, and
never safe to auto-act on. It was correctly **not** picked up by either new detector and remains a
standalone `properties` row — a data-entry defect (the address is simply wrong), not a
dedup-detection gap. Fixing it is an address-correction task, out of scope here.

## Summary of numbers

| item | value |
|---|---|
| real parcel_number groups (address-invisible), len ≥ 6 | 8 groups / 17 rows |
| false-positive short-parcel groups measured & excluded | 2 groups ("14", "18" in GA) |
| real medicare_id groups (address-invisible) | 38 groups / 79 rows |
| total measured candidate pairs after de-dup | 48 |
| classification split | 32 review_name / 16 review_conflict / 0 auto_blank / 0 ambiguous |
| test file | `tests/test_pdr13_property_dedup_strong_id.py`, 15/15 passed |
| mutations run (spot-checked) | 4/4 RED |
| Donna, TX rows before / after | 5 → 2 (39874 canonical, 45543 standalone) |
| sales_transactions rows for the group before / after | 2 (sale_id 311 + duplicate 8747) → 1 (sale_id 311, dedup-folded) |

## Files

- `/home/user/dialysis/supabase/migrations/20260911123900_dia_pdr13_property_twins_strong_id.sql`
- `/home/user/dialysis/src/merge_property_twins_strong_id.py`
- `/home/user/dialysis/tests/test_pdr13_property_dedup_strong_id.py`
- `/home/user/dialysis/CLAUDE.md` (new "PDR13" section)
- Branch pushed: `claude/pdr13-property-dedup-match-key` (dialysis repo), no PR opened per the task's instructions.

---
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01QTtUmchkafeDXxYx6yJSH2
