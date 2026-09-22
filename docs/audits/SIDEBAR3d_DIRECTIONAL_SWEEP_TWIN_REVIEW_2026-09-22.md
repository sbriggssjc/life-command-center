# SIDEBAR3-d — the directional sweep, routed into the twin-review lane (2026-09-22)

**What this is:** the 85-pair list from `SIDEBAR3-c`'s fleet sweep, re-run live and put into the
existing Dialysis_DB review lane `dia_property_twin_review`. **Nothing was merged, aliased or edited.**
Only review rows were written. The Decision Center `property_twin` lane and the
`property-twin-assist-tick` read that table, so the new rows show up there with no code change.

## Result

| disposition | pairs | rows |
|---|---:|---:|
| **Newly queued** (`batch_tag = 'sidebar3d_directional_20260922'`, ids 5049–5085) | **37** | 37 |
| Already pending in the lane (untouched) | 43 | 45 ⚠️ |
| Already **rejected** by a human, "not a twin" (ids 89, 185, 316). Not re-queued | 3 | 3 |
| **Not queued**: different city **and** different ZIP (sweep false positive) | 3 | 0 |
| **Total** | **86** | |

Live delta: lane `pending` **1,138 → 1,175 (+37)**. New rows by class: `review_name` 23, `review_conflict` 12,
`review_ambiguous` 2, **`auto_blank` 0**. Max `dia_property_merge_backup.backup_id` still **598**, so no
merge ran.

### ⚠️ 86, not 85
The `SIDEBAR3-c` query was **never recorded** (the STATUS entry and backlog row both say "re-run the query in
the STATUS entry", and the entry doesn't contain it). The query below is a SQL port of the guard's own parse
(`parseCivicNumberSpan` + `normStreetRest` + `detectRangeAddressCollision`, ±20 including an exact civic
match). All four examples from the backlog row are in the output, so this is the same population to within one
row. The one-row difference can't be resolved without the original query. **This file is now the record.**

### Opposite-directional shape (the guard question)
Out of 86: **6 are opposite-directional** (both sides have a directional and they differ), **67 are the same
direction spelled differently** (`West`/`W`, `Northeast`/`NE`), and **13 have a directional on one side only**
(`South Halsted` / `Halsted`). The 6:

| pair | addresses | disposition |
|---|---|---|
| 25972 / 38918 | 720 West Broadway / 730 E Broadway, Louisville KY | new #5061 |
| 30247 / 38653 | 117 East Harwood Rd / 109-189 W Harwood Rd, Hurst TX | new #5072 |
| 28233 / 37766 | 150 South 31st St / 150 N. 31st St, Clinton OK | already pending #676, #4973 |
| 26494 / 38175 | 407 South Telegraph Rd (Monroe) / 254-546 N Telegraph Rd (Pontiac) MI | not queued, different city |
| 27751 / 1806505 | 916 South Main St (Fuquay-Varina) / 935 N Main St (Louisburg) NC | not queued, different city |
| 22904 / 29096 | 101 W Park Dr (Livingston) / 110 South Park Dr (Brownwood) TX | not queued, different city, 248 mi |

So **3 of the 6 opposite-directional pairs are the different-city false positives.** That's what the guard's
stripping of *any* leading directional costs. The guard behaviour was left alone as instructed: it can only
cause an extra refusal, never a merge.

## Decisions made, and why

- **Excluded 3 cross-city pairs rather than queueing them.** The sweep keys on state + street and never
  checks city. The lane's deterministic assist (`classifyTwinDeterministic`) **ignores distance**, so a
  same-operator pair 248 miles apart (Fresenius / Fresenius, Park Dr TX) could be annotated
  "likely twin — merge". The exclusion is narrow: city differs **and** both 5-digit ZIPs are present and
  differ. **4901 Sam Houston Pkwy S (29220 Pasadena / 31396 Houston, 28.9 mi) was kept** because its
  normalized address is identical and 31396 has no ZIP. That looks like one building with a wrong city or
  geocode, which is exactly a twin candidate.
- **Never `auto_blank`.** `dia_merge_twins(mode => 'auto')` merges *every* pending `auto_blank` row, with **no
  batch or detector filter**. A blank-tenant shadow would have been classed `auto_blank` by the detectors'
  own rule and silently merged on the next auto run. Those rows are `review_name` instead. Their
  blank tenant is visible on the card, and the assist hands blank shadows to judgment rather than deciding them.
- **Anchor = the more complete record**, using the strong-id detector's scoring (CMS link +100, tenant 5,
  medicare_id 4, building size 3, year built 2, zip 1, + sale count; ties go to the lower id). This matters
  because the lane's **Merge** verdict keeps the anchor and drops the shadow.
- **`n_anchors`** = how many sweep partners the shadow has. A shadow with 2 partners is `review_ambiguous`
  (24722 Sample Rd, 39796 Cottage Grove). `review_conflict` = both operators known and different.
- **The 3 human rejections were respected.** They are the same pairs a person already ruled "not a twin".
- **`detail`** carries the lane's standard keys plus `detector: 'sidebar3d_directional'`,
  `directional_shape`, `collision_kind`, `civic_gap`, both addresses, and a do-not-auto-merge note.

## ⚠️ Found, not fixed: two pairs sit in the lane twice
`uq_dia_twin_review_pair` is **orientation-sensitive**, on `(shadow_property_id, anchor_property_id)`. The
2026-09-11 strong-id batch re-queued two pairs that the 2026-08-14 geospatial batch already held pending,
but in the reverse orientation: **25415/37568** (#649, #4964) and **28233/37766** (#676, #4973). A reviewer
will see each pair twice, and a merge verdict on one leaves the other pending against a deleted property.
This batch checked **both** orientations before inserting, so it added no more. Filed as backlog
`SIDEBAR3-d-orient`.

## Reverse
```sql
delete from dia_property_twin_review
 where batch_tag = 'sidebar3d_directional_20260922' and status = 'pending';
```
A row already decided by a human (merged / rejected / research) is left alone. Undo a merge with
`dia_unmerge_property(backup_id)`.

## The sweep query (Dialysis_DB `zqzrriwuavgrquhisnoa`)
```sql
with s as (
  select property_id, address, city, dia_normalize_state(state) st,
    (regexp_match(btrim(address), '^(\d{1,9})'))[1]::bigint lo,
    coalesce((regexp_match(btrim(address), '^\d{1,9}\s*-\s*(\d{1,9})\s'))[1]::bigint,
             (regexp_match(btrim(address), '^(\d{1,9})'))[1]::bigint) hi,
    btrim(regexp_replace(lower(regexp_replace(regexp_replace(btrim(address),'^\d+(\s*-\s*\d+)?\s+',''),
          '[.,]','','g')),'\s+',' ','g')) rest
  from properties where address ~ '^\s*\d'
), f as (
  select *,
    regexp_replace(rest,'^(northeast|northwest|southeast|southwest|north|south|east|west|ne|nw|se|sw|n|s|e|w)\s+','') folded,
    rest ~ '^(north|south|east|west|northeast|northwest|southeast|southwest)\s' sp
  from s
)
select a.property_id, a.address, b.property_id, b.address
from f a join f b on a.folded = b.folded and a.property_id < b.property_id
where a.st is not distinct from b.st
  and a.sp <> b.sp                                     -- spelled-out directional on exactly one side
  and ((a.lo <= b.hi and b.lo <= a.hi) or abs(a.lo - b.lo) <= 20);
```
