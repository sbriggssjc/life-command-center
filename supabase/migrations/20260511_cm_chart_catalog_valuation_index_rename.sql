-- Rename the valuation_index catalog row's display name so it doesn't carry
-- a vertical-specific label. The chart applies to gov AND dialysis (and will
-- apply to national_st once that view ships) — but the catalog name was set
-- to "Government-Leased Valuation Index" back when only gov was wired up.
--
-- The dashboard uses cm_chart_catalog.name verbatim in the chart card header,
-- so the gov-flavored label was leaking onto the dialysis tab. The active
-- vertical tab already supplies the context; the chart card title should be
-- vertical-agnostic.
--
-- Companion fix: PR #615 (api/capital-markets.js) corrected the
-- annual-view ordering bug that emptied buyer_class_pct_by_year on dialysis.

UPDATE public.cm_chart_catalog
SET name = 'Capital Markets Valuation Index'
WHERE chart_template_id = 'valuation_index'
  AND name = 'Government-Leased Valuation Index';
