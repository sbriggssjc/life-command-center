-- =====================================================================
-- Mis-ingestion sweep — AUGMENT: property 40041 + the %Anchored%/%Center%
-- name-signal gap surfaced by the lease-backfill at-scale gate (2026-06-15).
-- Project: zqzrriwuavgrquhisnoa (Dialysis_DB). READ-ONLY. Re-runnable.
-- Companion to candidates_dia.sql / FINDINGS.md / remediation_dia.DRAFT.sql.
-- =====================================================================
-- WHY THIS AUGMENT EXISTS
--   The Stage B lease BACKFILL gate (PR #1193) touched its first multi-tenant
--   deal folder, "/PROPERTIES/Multi/DaVita Anchored - Springfield, IL", and the
--   ONE unit whose street address is in the dia book matched:
--
--     dia properties.property_id = 40041
--       building_name = 'DaVita-Anchored Center - Springfield - IL'
--       tenant        = 'THE HERTZ CORPORATION'   (a co-tenant of the center)
--       building_size = 11,054
--
--   40041 is the `whole_center_multitenant` class — a whole multi-tenant center
--   mis-ingested into the dia single-tenant book. It belongs in the frozen sweep
--   candidate set so its sale(s) get `exclude_from_market_metrics` review and it
--   stays OUT of the single-tenant cap/rent/$psf cohorts.
--
-- WHY candidates_dia.sql MISSES IT (the name-signal gap)
--   building_size 11,054 < 25,000 → s_size=0; sold_price < $30M → tail miss;
--   tenant 'THE HERTZ CORPORATION' → s_nottenant=1 (only ONE signal, < the ≥2
--   threshold). The `name` regex catches 'town center'/'business center' but NOT
--   bare 'center'/'centre' or 'anchored', so the headline "DaVita-Anchored
--   Center" scores s_name=0. That single-signal miss is exactly this finding.
--
-- THE EXTENSION (proposed for the frozen query — review, not auto-applied)
--   Add 'anchored' and a bounded center/centre token to the `name` regex so
--   "<brand> Anchored …" / "… Center" whole-center rows reach the ≥2 threshold.
--   Kept conservative (anchored OR center-with-a-preceding-word) so a legitimate
--   single-tenant "Dialysis Center" clinic is NOT swept on the name alone — it
--   still needs a corroborating psf/size/ptype signal.
-- =====================================================================

-- 1) The specific row this finding flags (confirm 40041 is in the book + its sale).
SELECT p.property_id, p.building_name, p.address, p.city, p.state, p.tenant,
       p.operator, p.building_size,
       st.sale_id, st.sale_date, st.sold_price, st.exclude_from_market_metrics,
       st.data_source
FROM   properties p
LEFT JOIN sales_transactions st ON st.property_id = p.property_id
WHERE  p.property_id = 40041;

-- 2) Siblings the augmented name-signal surfaces: %Anchored% / "… Center(s)"
--    whole-center rows in the dia book NOT already excluded, with at least one
--    corroborating signal (psf high OR size big OR non-dialysis tenant). Review
--    set for the gate — these JOIN the existing candidate list, never auto-apply.
WITH s AS (
  SELECT st.sale_id, st.sold_price, st.exclude_from_market_metrics,
         p.property_id,
         coalesce(p.building_name,'')||' '||coalesce(p.address,'')        AS name_str,
         coalesce(p.tenant,'')||' '||coalesce(p.operator,'')              AS to_str,
         p.building_size                                                  AS bsf,
         st.sold_price / NULLIF(p.building_size,0)                        AS psf
  FROM sales_transactions st
  JOIN properties p ON p.property_id = st.property_id
  WHERE st.exclude_from_market_metrics IS NOT TRUE
    AND st.sold_price > 0
)
SELECT sale_id, property_id, round(psf) AS psf, bsf::int AS bsf, name_str,
       'whole_center_multitenant'::text AS proposed_class
FROM s
WHERE name_str ~* '(anchored|\manchor\M|\m(shopping|strip|retail|power|town|life\s*style|life-style)\s+cent(er|re)\M|-?\s*anchored\s+cent(er|re))'
  AND (
        (psf > 1500)
     OR (bsf > 25000)
     OR (to_str !~* '(davita|fresenius|fmc|fkc|fmcna|renal|kidney|dialysis|satellite|nephrolog|rogosin|dialyspa|dcc|dci|hemodialysis)'
         AND nullif(trim(to_str),'') IS NOT NULL)
      )
ORDER BY sold_price DESC;

-- 3) After Scott confirms, the rows above (and 40041 specifically) are added to
--    public._sweep_candidates_2026_06_11 with proposed_class='whole_center_multitenant'
--    (the gated remediation STEP 3 then sets exclude_from_market_metrics +
--    sales_record_classification + a field_provenance row — never a hard delete).
--    The contaminated lease itself (dia leases.lease_id=25312) is handled
--    separately by scripts/cleanup-contaminated-hertz-lease.mjs (guarantor scrub).
