# Claude Code Prompt — Land Size & Year Built Coverage (Dialysis_DB)

## Objective
Land size and Year Built are populated on only **~27% / ~28%** of the 12,307 dialysis properties.
This blocks the LAND and BUILT columns (and downstream $/acre, vintage) in the comps engine.
Diagnose the acquisition pipeline end-to-end and deliver a plan (with quick wins) to raise coverage.
**This is an acquisition/coverage problem, not a propagation-wiring bug** — the propagation triggers
already work; the source tables are starved. Confirm or refute that framing with evidence.

## What we already found (verify, don't assume)
- `properties`: 12,307 rows; `coalesce(land_area, lot_sf)` set on 3,277; `year_built` on 3,452;
  `parcel_number` (APN) on only **963 (8%)**.
- `parcel_records`: 1,573 rows but **only 41** have `lot_sf`/`year_built`. Sample `raw_payload`s carry
  `"source":"costar_sidebar"` with `far/tax_amount/census_tract/assessment_years/construction_type/
  legal_description` all **null** and **no lot/year field present** — i.e. empty shells.
- The propagation trigger `trg_parcel_propagate_to_property` (fills properties NULL slots from
  `parcel_records`) is healthy but has almost nothing to propagate.
- The CoStar sidebar extractor `extension/content/costar.js` *does* parse Year Built (~line 1279),
  Land Acres / Lot Size (~1305, ~1577), and Parcel Number (~1398). So the extraction logic exists;
  coverage = how many properties have actually been run through the sidebar.
- Internal alternates (sf_comp_staging, available_listings) recover only ~48 land / ~41 year_built.

## Investigate
1. **Where do land_area / lot_sf / year_built actually come from today?** Trace every writer:
   `extension/content/costar.js` (sidebar → which table/endpoint?), any CoStar-export importer,
   `trg_parcel_propagate_to_property`, listing/SF importers. Produce a source-attribution breakdown
   of the currently-populated ~3,300 rows (which source filled each).
2. **Why is `parcel_records` empty?** Is the `costar_sidebar` public-record write path capturing the
   wrong fields, or is CoStar's Public Record tab not being read? Is there a *county assessor* fetch
   path at all, or only the CoStar shell? Should `parcel_records` be retired or rebuilt?
3. **APN backfill feasibility.** parcel_number is on 8%. Can we backfill APN via geocode→county
   parcel lookup (which providers already wired? check `ai_research.py`, county/deed code,
   `dia_county_digest_backfill`)? What would a real assessor feed cost/require?
4. **Bulk CoStar path.** Can the sidebar extraction run in bulk (queue of property URLs) rather than
   one-off? Is there a CoStar bulk/CSV export we already ingest elsewhere we can extend to land/year?
5. **Extraction reliability.** On the properties that WERE run through the sidebar, what % yielded
   land + year? If low, the CoStar layout parsing (costar.js) may be silently failing on some layouts
   — add coverage tests.

## Deliverable
A short written plan (`docs/data-quality/land_yearbuilt_plan.md`) with: (a) the source-attribution
breakdown, (b) a verdict on `parcel_records` (retire vs fix), (c) the highest-yield path to raise
coverage (bulk CoStar vs assessor feed vs APN backfill) with rough effort, and (d) any **quick wins**
(e.g. a one-time backfill from an existing-but-unpropagated source; fixing a costar.js parse miss).
Implement only the low-risk quick wins in this pass (reversible, logged); leave the larger acquisition
build as a scoped recommendation.

## Guardrails
- Do NOT change the comps RPC output contract (`rpc_query_comps`) — LAND/BUILT already read
  `land_area`/`lot_sf`/`year_built`; this work only needs to *fill* those columns.
- Propagation must be **fill-NULL-only** (never overwrite verified values), mirroring the existing triggers.
- Everything reversible / dry-run-first; log backfills.
