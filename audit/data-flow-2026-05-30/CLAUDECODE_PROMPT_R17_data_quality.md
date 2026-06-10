# Claude Code — R17: entity-graph & gov-property data-quality cleanup

Grounded live 2026-06-09 across LCC Opps / dia / gov. dia is healthy (the
auto-supersede trigger drove dup-addr 1,061→42, multi-active-lease 1,007→100).
The issues are on gov (a bulk-import duplication) and the LCC entity graph
(un-drained merges + orphans + an inflated lane). **Investigation-first on the
destructive parts — confirm the pattern + get Scott's blessing before any
delete/dedup.**

## Unit 1 (HEADLINE) — gov properties: ~7,626 untraced, heavily-duplicated rows
**Grounded:** `gov.properties` = 18,949 rows; **7,626 (40%) have NULL
`data_source` AND NULL `lease_number`**, created in **two batches — 6,690 on
2026-05-17 and 894 on 2026-06-07**. They are heavily address-clustered: 159
address groups hold 6,914 rows, with the largest addresses carrying **150-173
rows each** (e.g. `3800 Charlotte Ave, TN` = 173, `101 Ranch Dr, WY` = 162) — all
lease-less. 99.8% carry an `agency`; **943 have sales, 446 have listings**, but
0 have a `leases` row and almost none have financials/owners. This inflates the
property table, geocoding spend, the asset-entity graph, and the property-merge
Decision Center lane.

**Do:**
1. **Identify the generating writer (repo archaeology).** `git log`/PR history
   around 2026-05-17 and 2026-06-07; grep for `gov` property INSERTs that omit
   `data_source` and `lease_number` (a backfill/portfolio-expansion/FRPP or
   sales-comp path). Name it in the report. **Add a guard** so gov property
   INSERTs always stamp `data_source` (and ideally fail CI if a writer omits it).
2. **Triage, don't blind-delete** (943 sales + 446 listings are linked):
   - For each address cluster, determine the real building identity. Collapse
     true duplicates to one property, **repointing** sales_transactions /
     available_listings / owners / cap_rate_history to the survivor (reuse
     `gov_merge_property` if suitable).
   - Rows with NO sale/listing/lease/financial/owner and a duplicated address =
     pure junk → soft-archive (a `status`/`is_active=false` flag, NOT a hard
     delete; mirror the dia sales_transactions cleanup posture).
   - Preserve every row that anchors a real sale/listing.
3. **Gate:** present the dedup/delete plan + counts to Scott; exercise on a small
   sample first; no mass mutation until blessed (the gov-true_owner write-back
   posture).

## Unit 2 — LCC: drain the auto-mergeable entity duplicates
**Grounded:** `v_lcc_merge_candidates` = 656 groups / **670 collapsible duplicate
entities; 430 groups (436 entities) `auto_mergeable=true`**. `lcc_apply_fuzzy_merges`
exists but **no cron/bulk action drains it** (the only merge cron is
`lcc-merge-log-reconcile`, which is backref cleanup, not entity merging). So
high-confidence duplicate entities accumulate, splitting portfolios and polluting
name-match pickers.
**Do:** wire a **gentle cron** (or a Decision Center bulk action) that applies
`lcc_apply_fuzzy_merges` for `auto_mergeable=true` groups only; non-auto groups
stay in the review lane. Effect-first, idempotent, bounded batch size (the
artifact-offload cadence lesson). Record each merge (it already logs via
`lcc_merge_entity`).

## Unit 3 — LCC: orphan-entity hygiene
**Grounded:** **1,037 entities have NO relationship, NO external identity, and NO
portfolio fact** — dead weight in entity search + name-match pickers.
**Do:** soft-flag them (`metadata.orphan_flagged=true`, reversible — mirror the
R4-A junk flag) and exclude flagged orphans from the name-match/search surfaces
(the same place R11 Unit 3 excludes junk-flagged). No hard deletes. Re-evaluate
on a schedule (an entity that later gains an edge clears the flag).

## Unit 4 — gov property-merge Decision Center lane de-noise
**Grounded:** the lane reports **6,914** but that's a ROW count over 159 address
groups, **106 of which are legitimate multi-lease buildings** (every row a
distinct GSA lease) — only ~53 groups have a possible true duplicate. Same
inflation pattern R13 fixed for the provenance lane.
**Do:** scope the lane's source to **group-level true-duplicate candidates** —
exclude address groups where `count(distinct lease_number) = count(*)` (legit
multi-lease) and surface the ~53 real groups, counted as groups not rows. Keep
the raw view for analytics; just don't drive the operator lane off the inflated
row count.

## House rules
`node --check`; ≤12 api/*.js; effect-first + outcome-truthful; idempotent;
soft-flag/repoint over hard-delete; **destructive gov dedup (Unit 1) and the
auto-merge cron (Unit 2) are gated on Scott's blessing + a sample run.** DB
migrations cache-or-live-safe; constraints/crons after the writer deploy.
