# PR2 (re-scoped) — the sidebar is dia's ONLY real public-record source, and its writer drops the stats it is handed

**Repo: `life-command-center`** (the writer is `api/_handlers/sidebar-pipeline.js::upsertPublicRecords`)
with reads/writes against **Dialysis_DB `zqzrriwuavgrquhisnoa`**. Companion quarantine (**PR11**) is
in scope if cheap — see §4.

**Read first:** `docs/architecture/public-records-source-lane.md` §2 — the 2026-09-02 **split
table** — and §2a (PR1: the model leg). Then `CLAUDE.md` § "Field-level data provenance" and the
`field_source_priority` rows for `dia.parcel_records` / `dia.properties` (`costar_sidebar` sits at
45–60; `county_records` @5 is the *refused* lane — do not touch it).

## The measurement that re-scoped this (do not re-derive; verify in one query)

PR2 as filed said *"the tax fetcher reaches 77%, so this is a fetcher question."* Split by
`raw_payload->>'source'`:

| table | `source` | rows | distinct APN | with a value | properties linked |
|---|---|---:|---:|---|---:|
| `tax_records` | **NULL (gpt-4o leg)** | **25,334** | **1 — NULL** | tax_amount on 10 | **9,033** / 22,131 links |
| `tax_records` | `costar_sidebar` | 287 | 286 | assessed 287, **tax_amount 0** | 266 |
| `parcel_records` | **NULL (gpt-4o leg)** | 672 | **1 — NULL** | stats on **41** | 27 |
| `parcel_records` | `costar_sidebar` | **932** | **931** | assessed 286, **stats 0** | **883** |

**There is no county fetcher reaching 77%.** The 9,033 "tax-linked" properties point at APN-less,
amount-less generated rows. The only genuine rows are the CoStar sidebar's — **931 real APNs on 883
properties, and ZERO of them carry `building_sf` / `lot_sf` / `year_built`.**

## Why that zero is a WRITER defect, not a capture gap — read before building

- `extension/sidepanel.js:118` lists `square_footage` and `year_built` among the metadata keys the
  capture sends. The data reaches the server.
- `upsertPublicRecords` (`sidebar-pipeline.js` ~5,100–5,420) builds `pubRecFields` from
  `parcel_number / land_value / improvement_value / assessed_value / county / tax_amount /
  assessment_years / census_tract / legal_description / lat / lon` — **never `square_footage`,
  `year_built`, `lot_size`, `land_use`, `zoning`, `owner_name`** — and the dia `parcel_records`
  INSERT writes `apn, county, state, assessed_value, raw_payload, fetched_at, data_hash` only.
- **`tax_amount` is stashed in `raw_payload.tax_amount` and never written to the
  `tax_records.tax_amount` column** — which is why it is 0 on all 287 sidebar tax rows. The
  tax INSERT writes `assessed_value` per year and nothing else.

So the parcel table has the columns, the capture has the values, and the line between them was
never written. **Measure before asserting**: over the 932 sidebar parcel rows, how many of their
originating captures (`staged_intake_extractions` / the sidebar `metadata` that
`process_sidebar_extraction` received) actually carried `square_footage` / `year_built` /
`lot_size` / `tax_amount`? Quote that as the ceiling of what a fix can recover. If the extension
only sends them on some page types, say which.

## Build

1. **Write the stats the capture carries** into `parcel_records.building_sf / lot_sf / year_built /
   land_use / zoning / owner_name` and `tax_records.tax_amount` — **fill-blanks, priority-gated
   through the existing Round-76co registry path** the PATCH branch already uses (`lcc_merge_field`
   / `field_source_priority`, source `costar_sidebar`). ⚠️ **Register any (table, field) rung
   `costar_sidebar` does not yet have BEFORE writing** or the rows land as `domain_trigger` and
   `v_field_provenance_unranked` grows (PR8 made the registry the allowlist; PR5's reverse arm
   already carries one such unregistered sidebar write on gov). State the rungs added.
2. **Units, not just values.** `lot_sf` is square feet; CoStar renders lot size in **acres** on
   many pages. `property-metadata-coverage.md` invariant **I12** measured 3,702 paired rows, 0
   equal, ratio 43,560 on 91.1% — parse the unit, never assume. Same for `square_footage` (a
   string like `"12,400 SF"`). Positive-control both parsers on named captures.
3. **Backfill the 932 existing sidebar rows from their stored captures** in the same change (the
   PR1a rule: a producer fix and its backfill ship together, or the backfill is a chore repeated
   forever). Reversible: batch tag in provenance, and a snapshot of the touched columns.
4. **PR11, if cheap:** soft-quarantine the 25,334 + 672 APN-less model-leg rows and their 22,171
   `property_public_records` links (`metadata.quarantined_reason = 'pr1_model_leg_no_apn'`, batch
   tag, never delete), **and stop the producer minting them** — `Dialysis/src/public_record_ingest.py`
   must not write a `tax_records` / `parcel_records` row with a NULL APN. Positive-control that the
   931 sidebar APNs are untouched. If this cannot be done cleanly here, leave PR11 filed and say why.

## Verify on — the state delta, never the writer's tally

- `parcel_records where source='costar_sidebar' and (building_sf is not null or year_built is not null)`:
  **0 → N**, with N ≤ the measured capture ceiling from §"Measure before asserting".
- `tax_records where source='costar_sidebar' and tax_amount > 0`: **0 → N**.
- `dia.properties.year_built` / `building_size` provenance: does `costar_sidebar` now appear as a
  source on rows where it previously did not? Quote before/after counts from
  `v_field_provenance_effective_source`. **Do not let it override `salesforce`@20 where a rung says
  otherwise — `write` vs `skip` vs `conflict` counts, please.**
- `v_field_provenance_unranked`: unchanged (30 today, rolling 30-day window — quote it before and
  after in one session).
- `property-metadata-coverage.md`'s residue — *82 properties with a sale price and no building
  size cannot produce a $/SF comp* — how many of the 82 does this recover?

## What NOT to do

- Do not touch `county_records`, the gpt-4o leg's *values*, or `REGRID_API_KEY` (PR1d).
- Do not fuzzy-match APNs across counties; the link is `(apn, county, state)` by design.
- Do not "fix" the zero by reading the model-leg's 41 stat rows — they are generated.

## Report back

The capture ceiling (how many of 932 carried each stat) · rungs registered · parser positive
controls (acres → sq ft, `"12,400 SF"`) · before/after on the four verify-on counts with
write/skip/conflict split · the 82-property comp residue recovered · PR11 done-or-why-not · and
anything the sweep finds that outranks this (the second unregistered sidebar write on gov
`government_type` is PR5's, not yours — note it, do not fix it here).
