# Prompt 52 — Comps engine: prefer enriched record, exclude bare duplicates, don't pin operator, rank on displayed cap

## Why (live comp build, 2026-08-05)
Three engine behaviors produced bad/missing comps that had to be worked around by hand:
1. **Operator pin.** A request naming "The Villages **DaVita**" restricted the ENTIRE comp universe to DaVita (0 Fresenius/US Renal). For an appraisal comp set, the subject's operator should anchor SIMILARITY, not filter the universe — the best comp may be a Fresenius/US Renal of like size/term/cap.
2. **Bare duplicate records** (see Prompt 51) surface as empty comps or drop fields. The engine should prefer the enriched/complete record for an address and exclude bare duplicates from the comp set.
3. **Cap basis.** Selection/appraisal filtering must use the DISPLAYED cap (rent ÷ price) the workbook computes, not the stored `cap_rate` field, which is mislabeled on some records (e.g. Woodland Hills 6.62% stored vs 6.00% rent÷price).

## Task
1. In appraisal/similarity mode, do NOT hard-filter comps to the subject's tenant/operator; pull all dialysis operators and let the operator contribute to the similarity SCORE only. (Keep an explicit operator filter available when the user actually asks for "DaVita comps".)
2. When multiple property records share a normalized address, select the most-complete/enriched one and drop the bare duplicate from the comp set (until Prompt-51 consolidation lands, this is the runtime guard).
3. Compute the cap used for ranking, the appraisal cap-discipline check, and any cap band on rent ÷ price; flag/park records where the stored cap disagrees with rent÷price by >25 bps.
4. Appraisal cap policy (per Scott): comps within 35 bps of the subject target and the set AVERAGE cap below the subject; allow reaching back ~24 months but ensure a handful of sales in the trailing ~7–9 months.

## Verify
- An appraisal pull for a DaVita subject returns a mixed-operator set (DaVita + Fresenius + US Renal + independents) ranked by real similarity.
- Bare duplicate records (Snellville 45519, 9341 37547) never appear as comps; the enriched record is used.
- Displayed caps obey the ceiling; set average is below the subject; a handful of trailing-~7-month sales are present.
