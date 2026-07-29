# Claude Code Prompt — Rent Imputation → Cap Rates for Past & Future Sales (Dialysis_DB)

## Objective
Produce a **market rent estimate for every dialysis property** so a cap rate is computable for any
sale — historical or prospective — even when no lease rent exists on the record. Today **723 of 3,689
live sales (~20%) have neither a recorded cap nor any lease rent**, so their comp cap is blank. Comps
already compute SOLD CAP = Rent ÷ Sold Price from *actual* lease rent (9,084 leases, avg **$21.57/SF**);
this build fills the missing side with a clearly-tagged **imputed** rent.

## Design
1. **Imputed rent model.** Estimate annual rent = `rent_psf_model × RBA`, where `rent_psf_model` is a
   hierarchical market rent/SF:
   - primary: median rent/SF by **operator (chain_canonical) × region (state or metro) × vintage bucket**;
   - fall back to operator × region, then region, then national — whichever has ≥ N supporting leases.
   - Build from the 9,084 leases with `annual_rent` and `building_size` (filter sane $5–$100/SF band).
   - Optionally condition on lease type (Absolute NNN vs NN) and chair count (rent scales with capacity).
2. **Storage.** Add `properties.rent_imputed` (numeric) + `rent_source` ('lease' | 'imputed' | 'sale')
   and a `rent_psf_basis` note (which tier fired, support count). NEVER overwrite an actual lease rent —
   imputation only fills where `v_property_latest_lease.annual_rent` is null.
3. **Comps wiring.** In `rpc_query_comps`, RENT should resolve `coalesce(lease.annual_rent, rent_imputed)`
   and the output must carry a flag so the workbook can mark imputed-rent caps (e.g. an "(est.)" note or
   a distinct fill) — an imputed cap must never look like a verified one.
4. **Prospective use.** Because the estimate is property-level, it also yields a cap for a *future* sale
   (list price ÷ imputed rent) — expose it so BOVs/pipeline can price un-leased comps.

## Validate
- Back-test: on properties that DO have a real lease rent, compare imputed vs actual (MAPE by tier);
  report accuracy and choose the minimum support count `N` that keeps error acceptable.
- Sanity band: imputed rent/SF must fall in the operator/region interquartile range; flag outliers.
- Show the coverage lift: how many of the 723 no-rent sales (and how many total properties) gain a cap.

## Deliverable
`docs/data-quality/rent_imputation_plan.md` + the model (SQL view or function `v_property_rent_estimate`),
the `properties.rent_imputed`/`rent_source` columns (fill-NULL, logged), the `rpc_query_comps` RENT
coalesce + imputed flag, and the back-test results. Dry-run first; keep actual vs imputed strictly separated.

## Guardrails
- Actual lease rent always wins; imputed only fills nulls and is always tagged.
- Never write imputed rent into `leases.annual_rent` (keep it on properties / a separate estimate view).
- Reversible + logged; a comp must visibly distinguish an estimated cap from a verified one.
