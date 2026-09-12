-- ID2b — market-brief-facts.js is explicitly blocked on operator_id (CLAUDE.md prompt spec,
-- docs/claude-code/prompts/ID2b-consumer-switch-to-operator-id.md §3 "Unblock the market brief").
--
-- v_market_brief_cms_operator_counts (the only source `market-brief-psql-tick.js` reads for the
-- CMS-operator-census facts) grouped on raw medicare_clinics.chain_organization TEXT, so it still
-- produced the exact fragmentation Scott flagged in ID1 -- measured live 2026-09-12:
-- "Satellite Healthcare" (54) vs "Satellite Dialysis" (14) as two separate fact rows.
--
-- Switch grouping to the guarded operator_id registry via properties.operator_id, resolved to its
-- merge survivor (dia_operator_survivor -- the same function v_id2a_operator_registry_parity uses),
-- with a FILL-BLANKS fallback to the raw chain_organization text for any clinic that cannot be
-- resolved (unlinked property, or a property with no operator_id) -- so nothing that used to be
-- counted silently disappears, and the unresolved population is named rather than hidden.
--
-- Measured before/after (2026-09-12, live on zqzrriwuavgrquhisnoa):
--   population: 6,695 clinics before == 6,695 after (0 dropped, 0 added -- row-count parity)
--   "Satellite Healthcare" 54 + "Satellite Dialysis" 14 -> "Satellite Healthcare" 69 (one bucket)
--   top 6 by clinic_count after the switch: Fresenius Medical Care 2,528 / DaVita 2,389 /
--     Independent 653 (unresolved bucket, raw text) / US Renal Care 341 /
--     Dialysis Clinic, Inc. 216 / American Renal Associates 203
--   85.3% of clinics (6,544 / 7,674 non-demoted) resolve an operator_id via their linked property;
--     the remaining 14.7% keep their raw chain_organization text and are marked
--     all_rows_operator_id_resolved=false so a consumer can tell the two apart.
--
-- Reversible: CREATE OR REPLACE VIEW restores the prior body verbatim if needed (see the diff in
-- docs/audits/ID2b_OPERATOR_ID_CONSUMER_SWITCH_2026-09-12.md for the exact prior definition).
-- Idempotent: view-only, no base-table writes.

CREATE OR REPLACE VIEW public.v_market_brief_cms_operator_counts AS
WITH resolved AS (
  SELECT
    mc.medicare_id,
    mc.last_seen_date,
    COALESCE(o.name, mc.chain_organization) AS operator,
    (o.name IS NOT NULL) AS operator_id_resolved
  FROM public.medicare_clinics mc
  LEFT JOIN public.properties p ON p.property_id = mc.property_id
  LEFT JOIN public.operators surv ON surv.operator_id = public.dia_operator_survivor(p.operator_id::bigint)
  LEFT JOIN public.operators o ON o.operator_id = COALESCE(surv.operator_id, p.operator_id)
  WHERE mc.dedup_status IS DISTINCT FROM 'demoted_duplicate'
    AND mc.chain_organization IS NOT NULL
)
SELECT
  operator,
  count(*) AS clinic_count,
  max(last_seen_date) AS source_as_of,
  bool_and(operator_id_resolved) AS all_rows_operator_id_resolved
FROM resolved
GROUP BY operator
ORDER BY clinic_count DESC, operator;

COMMENT ON VIEW public.v_market_brief_cms_operator_counts IS
  'ID2b (2026-09-12): groups by properties.operator_id (survivor-resolved via
   dia_operator_survivor), falling back to raw chain_organization text only when the clinic has no
   linked/resolved operator_id (~14.7% of clinics). all_rows_operator_id_resolved=false marks a
   bucket that is still raw text (unresolved population, not a registry canonical name) so a
   consumer can tell the two apart. Prior body (pre-ID2b) grouped on raw
   medicare_clinics.chain_organization alone -- see git history of this file / the ID2a parity
   view v_id2a_operator_registry_parity for the fragmentation that produced.';
