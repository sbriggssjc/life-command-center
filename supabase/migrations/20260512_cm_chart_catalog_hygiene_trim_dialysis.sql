-- Catalog hygiene: trim 'dialysis' from applies_to_verticals on chart_template_ids
-- whose backing dialysis view doesn't exist AND won't be shipped in the near
-- term. This stops fetchQuarterly from issuing PostgREST requests that 404,
-- and stops the dashboard from rendering empty cards for charts that won't
-- have meaningful data.
--
-- Audit performed against Dialysis_DB on 2026-05-06 (zqzrriwuavgrquhisnoa).
-- Each decision below records WHY this template is or isn't shippable for
-- dialysis right now.
--
-- TRIMMED (dialysis removed from applies_to_verticals):
-- ─────────────────────────────────────────────────────
--   nm_share_of_market   — NM share of dialysis is essentially 0% in 2023-2026
--                          (0 NM deals across 124+84+95+26 = 329 sales) and
--                          ≤0.7% of volume 2018-2022. Annual stacked bar of
--                          NM-vs-market would be visually dishonest and not
--                          editorially defensible. Revisit if NM grows the
--                          dialysis book.
--
--   ppsf_box_quarterly   — sales_transactions has no price_per_sf column for
--                          dialysis (clinics rarely transact on a $/SF basis;
--                          comp value is per-clinic + cap-rate-driven). No
--                          path to ship this view. Trim permanently.
--
--   cap_rate_yoy_change  — dialysis cap_rate_ttm_q exists, but a YoY-change
--                          variant view (cm_dialysis_cap_yoy_q) hasn't been
--                          built. Could ship if there's demand; trimming for
--                          now to keep the catalog honest.
--
--   predicted_cap_rate   — Phase 3 forecast model not started. Trim until
--                          the forecaster lands; re-flip dialysis on at that
--                          time.
--
-- KEPT (dialysis retained — will ship views in the inventory analysis PR):
-- ──────────────────────────────────────────────────────────────────────
--   available_cap_rate_scatter — on-market scatter of asking cap × DOM. Will
--                                ship cm_dialysis_available_scatter alongside
--                                listing_snapshots infra.
--   dom_price_adjustments       — on-market price-change frequency. Same PR.
--   listings_count_q            — on-market count over time. Same PR.
--   rent_psf_box_quarterly      — rent_per_sf has ~33% coverage on leases
--                                (1303 of 4097 rows in [5, 100] range). Not
--                                a priority but plausibly shippable, so the
--                                catalog flag stays for now.

UPDATE public.cm_chart_catalog
SET applies_to_verticals = ARRAY(
  SELECT v FROM unnest(applies_to_verticals) v WHERE v <> 'dialysis'
)
WHERE chart_template_id IN (
  'nm_share_of_market',
  'ppsf_box_quarterly',
  'cap_rate_yoy_change',
  'predicted_cap_rate'
)
  AND 'dialysis' = ANY(applies_to_verticals);
