# Claude Code Prompt — CMS / medicare_id Match Coverage (Dialysis_DB)

## Objective
Chairs and Patients (census = TTM treatments ÷ 156) derive from `medicare_clinics`, joined to
`properties` via `medicare_id`. Only **7,477 of 12,307 properties (61%)** carry a `medicare_id`;
**4,830 have none**, which is the ceiling on chairs/patients coverage. Raise the match rate.

## Already done (do not redo)
- A fill-NULL backfill propagated `number_of_chairs` → `properties.total_chairs` (+1,004) and CMS
  `ttm_total_treatments`/`estimated_annual_treatments` → `properties.ttm_total_treatments` (+1,231),
  logged in `dia_chairs_tx_backfill_log`.
- `trg_medicare_propagate_to_property` now also propagates `total_chairs` + `ttm_total_treatments`
  (fill-NULL-only) so matched properties stay filled going forward.
- Remaining gap = the **4,830 properties with no `medicare_id`** (this prompt) + CMS clinics with no
  `property_id` (the reverse side of the same match).

## Investigate & implement
1. **Inventory the existing matcher.** Find how `properties.medicare_id` / `medicare_clinics.property_id`
   get set today (address match? NPI? CCN? geocode?). Look at the `*match*`, `*npi*`, `*ccn*`,
   `canonicalize_ccn`, `v_clinic_property_link_*`, `v_npi_lookup_review_queue` views/functions and any
   linking job. Quantify current matcher precision/recall on a labeled sample.
2. **Address match.** Both tables carry addresses (`properties.address`, `medicare_clinics` address
   fields). Use `dia_normalize_address` + city/state (and the CMS CCN/NPI where present) to propose
   new links for the 4,830. Measure candidate matches and estimate false-positive risk (same address,
   different suite = different clinic — dialysis often co-locates; be conservative).
3. **NPI registry path.** `clinic_npi_registry_history` and `v_npi_lookup_review_queue` exist — use NPI
   as a strong key where a property has an NPI but no medicare_id link.
4. **Reverse gap.** Count `medicare_clinics` rows with `property_id IS NULL` that DO match a property —
   linking those also fills chairs/patients via the (now-fixed) trigger.

## Deliverable
`docs/data-quality/cms_match_plan.md`: current matcher description + measured coverage, the proposed
new-link method(s) with expected yield and FP guardrails, and a **dry-run** table of proposed links
(property_id ↔ medicare_id, match basis, confidence) for review. Implement only high-confidence links
(exact NPI/CCN, or normalized-address + city + state + operator agreement) in this pass, logged and
reversible; queue the fuzzy remainder for human review. Re-run the chairs/treatments fill-NULL backfill
after linking so newly matched properties inherit the data.

## Guardrails
- Fill-NULL-only; never overwrite verified `total_chairs`/`ttm_total_treatments`/`medicare_id`.
- Conservative on co-located clinics (suite-level distinctions) — prefer NPI/CCN over address alone.
- All links logged + reversible; dry-run first.
