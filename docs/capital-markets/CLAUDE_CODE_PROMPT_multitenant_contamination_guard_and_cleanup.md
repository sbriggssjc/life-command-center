# Claude Code prompt — Multi-tenant deal-folder contamination guard + cleanup of the one contaminated lease

> Surfaced by the independent at-scale gate on the Stage B lease BACKFILL capped drain
> (PR #1193, `?_route=lease-backfill`, run live 2026-06-15). The drain itself was mostly
> clean — 15 `write` / 3 `conflict`, every conflict a genuine no-clobber protection,
> comps `.xlsx`/`.docx` correctly `needs_ocr`/skipped, 0 errors. But the FIRST
> multi-tenant deal folder it touched produced a **contaminated lease**, and that
> exposes a real extractor bug the single-tenant gate (Conyers 22391) could never hit.
> **HOLD the full 303-lease backfill until this lands and is gate-verified.**
>
> Same discipline as every prior round: receipts-first, dry-run → independent SQL
> verification → write, provenance on every write, never leave fake data, never
> hard-delete curated rows (exclude/null/provenance-tag).

## The finding (exact receipts — these are the targets)

A genuine **Hertz** lease in a MULTI-TENANT DaVita-anchored deal folder was extracted
and the extractor **cross-attributed a dialysis guarantor onto the Hertz tenant**:

- **Contaminated lease:** dia `leases.lease_id = 25312`, `property_id = 40041`.
  - `tenant = 'THE HERTZ CORPORATION'` — CORRECT for the doc.
  - `guarantor = 'Total Renal Care, Inc.'` — **WRONG** (a Hertz car-rental lease is not
    guaranteed by DaVita's operating entity; bled from the "DaVita Anchored" context).
  - Other written fields (real, from the Hertz lease, may stay if the row is kept):
    `annual_rent=24000`, `leased_area=1500`, `rent_per_sf=16`, `expense_structure='NNN'`,
    `lease_start=2023-02-01`, `lease_expiration=2028-01-31`,
    `renewal_options='3 additional periods of 3 years'`.
- **Wrong entity edge (LCC Opps):** `entity_relationships` `guaranteed_by`
  from the canonical **Davita** operator entity → **asset 40041**. Built off the
  contaminated guarantor. Must be removed.
- **Provenance (LCC Opps):** `field_provenance` rows `source='folder_feed_lease'`,
  `target_table='dia.leases'`, `record_pk_value='25312'` — the `guarantor` row is the
  contaminated one.
- **Source doc:** `/sites/TeamBriggs20/Shared Documents/PROPERTIES/Multi/DaVita Anchored - Springfield, IL/Rec'd/Hertz (6994.505)- First Amendment to Lease - 2936 S 6th St Springfield IL.pdf`
  (`folder_feed_seen.status='attached'`, `subject_hint.lease_backfilled_at='2026-06-15T12:47:43.323Z'`).
- **Why it matched at all:** dia `properties.property_id=40041` is
  `'2936 S 6th St, Springfield IL'`, `building_name='DaVita-Anchored Center - Springfield - IL'`,
  `tenant='THE HERTZ CORPORATION'`, `building_size=11054` — i.e. a single UNIT of a
  multi-tenant center, **mis-ingested into the dia single-tenant book** (the
  `whole_center_multitenant` class from the mis-ingestion sweep). The other docs in that
  `/Multi/` folder (the DaVita MASTER LEASE, BOVs, BOS, Rosatis, the generic "Hertz
  Lease.pdf") correctly resolved to `unresolved_no_domain_property` — only the unit whose
  address is in the dia book matched.

**Contrast — the clean cases (proof single-tenant works, do NOT touch):**
`leases.lease_id=19530` (Kenansville NC, 133 Limestone Rd — real single-tenant DaVita:
rent $148,504 / $17.68 psf, guarantor "Total Renal Care, Inc." CORRECT, edge Davita→133
Limestone Rd CORRECT) and the prior Conyers gate `lease_id=14365` / property 22391
(conflicts protected, no clobber). Single-tenant dialysis enrichment is clean; the bug
is specific to multi-tenant / portfolio deal folders.

## Unit 1 — the guard (stop multi-tenant folders from minting domain leases)

The root cause is two-layered; fix both:

1. **Folder-class gate (primary).** A lease doc whose server-relative path is under a
   **`/Multi/`** or **`/Portfolio/`** segment is a multi-tenant / portfolio deal folder.
   Per Scott's dia/gov doctrine (single-asset, single-tenant), the lease extractor must
   **NOT auto-create or fill a domain lease** from these folders. Route them the same way
   the other Springfield `/Multi/` docs already went — record `folder_feed_seen.status`
   as a non-promoting outcome (e.g. `unresolved_no_domain_property` or a new explicit
   `status='multitenant_deferred'` / `detected_type` note) and surface to the Decision
   Center / mis-ingestion review, never a silent domain write. Use the existing
   path-segment helper convention (`isExcludedFolderPath` / the `/Multi/` `/Portfolio/`
   buckets are already recognized in `folder_feed_seen.subject_hint`).
   - Match the segment robustly (whole path segment, case-insensitive), consistent with
     the existing `EXCLUDED_FOLDER_SEGMENT_RES` style — don't substring-match a tenant
     name that merely contains "multi".

2. **Cross-attribution guard (defense in depth — for any multi-tenant doc that still gets
   extracted).** Even outside `/Multi/`, the extractor must not attribute one tenant's
   guarantor/terms to a different tenant. Add a sanity check in the lease extractor: if
   the extracted `tenant` and `guarantor` resolve to **different operator families**
   (e.g. tenant canonicalizes to a non-dialysis brand like "Hertz" but guarantor
   canonicalizes to a dialysis operator like Davita/Total Renal Care), treat the
   guarantor as **unverified** — do NOT write it and do NOT mint the `guaranteed_by`
   edge; route to a Decision Center conflict instead. Reuse the existing
   `lcc_operator_affiliate_patterns` canonicalization that already maps
   renal/total renal/davita → Davita. The principle: a guarantor that contradicts the
   tenant's own credit family is a contamination signal, not a fact.

Acceptance for Unit 1: a dry-run over the Springfield `/Multi/` Hertz doc (and a
`/Portfolio/` sample) shows it is NOT promoted to a domain lease (folder-class gate
fires); and a synthetic multi-tenant doc with mismatched tenant/guarantor shows the
guarantor withheld + no edge (cross-attribution guard fires). Add unit tests mirroring
`test/lease-extractor.test.mjs` (the existing 31 cases) — one for each guard.

## Unit 2 — cleanup of the one contaminated record (gated, then I verify)

Provide this as an idempotent, dry-run-first script/migration. **Surgical, not
destructive** — the Hertz tenant/rent/dates are real; only the contaminated guarantor +
its edge are fake. Two acceptable options — recommend (A), let Scott choose:

- **(A) Surgical scrub (preferred):** on dia `leases.lease_id=25312`, NULL the
  `guarantor` field; in LCC Opps remove the `guaranteed_by` edge (Davita→asset 40041)
  that was built from it; supersede/void the `field_provenance` `guarantor` row for
  record 25312 (`source='folder_feed_lease'`). Leave the genuine Hertz lease facts.
  Then route property 40041 to the mis-ingestion sweep (below).
- **(B) Full revert:** delete lease 25312 entirely (it only exists because of this
  backfill) + the edge + all its `folder_feed_lease` provenance rows, and reset
  `folder_feed_seen` for the Hertz doc to a non-promoting status so the guard handles it
  on the next pass. Cleaner if we'd rather 40041 carry no lease until the sweep
  reclassifies it.

Either way: **idempotent, dry-run JSON first** (show exactly what would change, 0 writes),
then the real write only on Scott's gate, then I independently verify **0 residue** of the
contaminated guarantor/edge and that the clean leases (19530, 14365) are untouched.

## Unit 3 — flag property 40041 to the mis-ingestion sweep

Property 40041 ("DaVita-Anchored Center - Springfield - IL", a multi-tenant unit in the
dia single-tenant book) is the `whole_center_multitenant` class from
`CLAUDE_CODE_PROMPT_misingestion_sweep.md`. Add it (and any sibling
`%Anchored%`/`%Center%`/`/Multi/`-sourced dia rows the audit surfaces) to the frozen
sweep candidate set for `exclude_from_market_metrics` review — provenance-tagged, never
hard-deleted. This keeps the multi-tenant unit out of the dia single-tenant cap/rent/$psf
cohorts regardless of the lease decision above.

## Guardrails
- Receipts-first; dry-run JSON before any write; I verify each at the gate before the
  next step. Provenance on every write; never silently overwrite; never hard-delete
  curated data.
- Reuse existing machinery — the folder-feed path helpers, `lease-extractor.js`,
  `field_provenance`/`field_source_priority`, `lcc_operator_affiliate_patterns`, the
  Decision Center conflict lane, the mis-ingestion sweep. Add guards + tests, not parallel
  systems. ≤12 `api/*.js`.
- **The full 303-lease backfill stays HELD** until Unit 1 + Unit 2 are merged and
  gate-verified. Single-tenant dialysis enrichment is proven clean; the backfill resumes
  once multi-tenant/portfolio folders are guarded.

## Verified state at hand-off (2026-06-15, by the independent gate)
- folder_feed_lease provenance: 15 write / 3 conflict; all 3 conflicts genuine
  populated-field protections (14365 tenant + annual_rent; 19530 tenant).
- guaranteed_by edges: 3, all from canonical Davita — two correct (22391, 133 Limestone
  Rd), one contaminated (asset 40041, this finding).
- leases_created this batch: 1 (lease 25312, property 40041 — the contaminated one;
  property has exactly 1 active lease, no duplicate).
- needs_ocr 8 (all `.xlsx`/`.docx`/comps — correctly skipped, 0 mis-enrichment).
