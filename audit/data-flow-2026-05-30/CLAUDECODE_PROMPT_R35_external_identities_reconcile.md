# Claude Code — R35: reconcile `external_identities` asset links (the one table R22/R23 missed)

## Why (cross-DB integrity sweep, live 2026-06-16 — see AUDIT_cross_db_referential_integrity_2026-06-16.md)
Full sweep result: the entity graph + property mirrors are referentially SOUND — 0 orphans
across 9 LCC entity-reference classes; `lcc_entity_portfolio_facts` 0 not-in-mirror both
domains (R22/R23 reconcile holding). The ONE uncovered table is **`external_identities`**
asset rows (`source_type='asset'`), which R22/R23 never touched. ~638 asset rows don't
resolve to a current domain property, in THREE distinct classes (verified by sampling):

1. **~345 dia CCN-mislabels** — 6-digit `external_id`s like `012505` that are CMS Medicare
   **CCNs** (5/5 sampled exist in `dia.medicare_clinics.medicare_id`), stored as
   `(source_type='asset', source_system='dia')`. Valid clinic identities, **wrong type**.
2. **dia true property orphans** — 5-digit dia-property-shaped ids (e.g. `37587`,`39911`)
   that **no longer exist** in `dia.properties` (dia hard-deletes on merge; asset link
   never cleaned). Plus a few malformed **UUID** asset external_ids.
3. **gov: mostly NOT orphans** — of 17 flagged, sampling showed ~7/9 are ACTIVE gov
   properties (a `lcc_property_attributes` coverage gap, NOT orphans), 1 archived, ~1
   truly gone, 1 malformed UUID.

## ⚠️ Critical safety rule (the sweep proved this)
**Do NOT use `lcc_property_attributes` (the active mirror) as the orphan test** — the gov
sample showed it flags ACTIVE properties (mirror has coverage gaps). Use the **all-status
`v_property_id_census`** (R22/R23 built it on gov + dia, anon-readable) as the authority. A
property absent from the census = truly gone; present (any status) = keep.

## Unit 1 — retype the dia CCN-mislabels (don't delete; they're valid)
- Identify dia asset rows whose `external_id` matches a CCN (6-digit, incl. leading-zero)
  AND exists in `dia.medicare_clinics.medicare_id` (verify cross-DB; don't assume by format
  alone). Retype them from `source_type='asset'` to the correct CMS/clinic identity
  convention — reuse the R4-A `canonicalDomainSourceType` / `canonicalIdentitySystem`
  helpers in `api/_shared/entity-link.js` (e.g. `source_system='cms'` /
  `source_type='medicare_ccn'`, whatever the canon dictates — check the helper, don't invent
  a 6th spelling).
- **Forward guard**: in the writer path that mints asset identities, never write a CCN as
  `source_type='asset'`; route it through the canonical helper so this can't recur (the
  R4-A choke-point pattern).

## Unit 2 — prune the true orphans (census-based, reversible)
- Extend the **R22/R23 reconcile** (`lcc_reconcile_mirrors_*` family) — or a parallel
  `lcc_reconcile_external_identities_*` — to cover `external_identities` asset rows:
  for each `(source_system in dia/gov, source_type='asset')` row whose `external_id` is a
  domain-property-shaped id that is **absent from `v_property_id_census`** (all-status),
  snapshot to a reversible backup (mirror R22's `lcc_mirror_reconcile_deletions` pattern)
  then delete. Also prune the malformed-UUID asset external_ids (a UUID is never a valid
  property id).
- **Reuse R22's guards verbatim**: completeness (every census page HTTP 200 + max-offset
  page empty), sanity floor (min live count), anomaly cap (never prune > X% in one pass),
  1000/row census paging. Any guard fail ⇒ skip (no prune).
- **Leave** the gov active-but-not-in-mirror rows untouched (present in census = valid).

## Unit 3 — forward reconcile + the gov mirror-coverage note
- Add `external_identities` to the **daily** reconcile cron (alongside the R22/R23 mirror
  reconcile) so a future domain merge/delete cleans its asset links automatically.
- Surface (don't fix here) the **gov mirror-coverage gap**: ~14 active gov properties have
  an `external_identities` asset row but no `lcc_property_attributes` row — note the count
  for a possible separate sync-coverage round; do not prune them.

## Guards / house rules
- Census-based, reversible (snapshot before delete), idempotent, bounded (R22 guards). DB +
  the entity-link helper; ≤12 `api/*.js`. `node --check`; suite green. Apply the domain
  census migrations first if any are missing (they exist from R22/R23).
- Verify live: dia CCN asset rows retyped (0 remain as `asset`); true orphans pruned +
  snapshotted (re-run finds 0); gov active rows intact; re-running the reconcile is a no-op.

## Bottom line
The cross-DB graph is healthy; this closes the last gap — `external_identities` asset links
weren't reconciled on domain merge. Retype the ~345 dia CCN mislabels, prune the true
orphans (census-based + reversible), and wire external_identities into the daily reconcile
so it stays clean. Low blast radius, high tidiness — the capstone on the integrity work.
