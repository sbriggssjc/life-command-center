-- Lease duplicate fix (Scott, 2026-07-31) — applied live to Dialysis_DB.
--
-- Problem: the property tab showed the same lease twice (e.g. "DaVita Kidney
-- Care" AND "DVA Healthcare Renal Care, Inc." on one property). Two root causes:
--   1. v_lease_detail selected ALL leases — it never filtered superseded_at /
--      is_active (it only surfaced them as columns), so historical/inactive rows
--      leaked into the limit-5 property fetch.
--   2. The client dedup (_udFilterAndDedupeLeases) keys on the tenant STRING, so
--      the same lease under a friendly name vs a full legal name both survived.
--
-- Fix 1 (broad, at source): v_lease_detail now returns LIVE leases only
--   (superseded_at IS NULL AND COALESCE(is_active,true)=true), ordered best-first
--   (documented > estimated > inferred, then has-rent, then newest) so the
--   limit-5 fetch gets the authoritative rows. This dropped the view from 12,818
--   rows to 6,594 and multi-lease properties from thousands to 8.
--
-- Fix 2 (targeted dedup): 7 redundant same-lease rows superseded (reversible) on
--   the 6 properties where the duplicate carried consistent rent (underwriting
--   unaffected) — keeping the documented/most-complete row:
--     property 25336: superseded 25392, 25393 (null-rent inferred costar dupes)
--     property 31115: superseded 16950  (kept 25382; rent identical)
--     property 34043: superseded 25180  (inferred; kept documented 25386)
--     property 35724: superseded 17096  (suspect 2028 start; kept 25390 / 2022)
--     property 35749: superseded 18413  (inferred, null start; kept 25388)
--     property 35766: superseded 17106  (kept 25383; rent/exp identical)
--
-- LEFT FOR HUMAN REVIEW (materially conflicting values — NOT auto-deduped):
--     property 23772: 25381 (exp 2032 / $133,937) vs 16314 (exp 2035 / $139,000,
--                     future 2025 start) — may be a renewal, not a duplicate.
--     property 31964: 25384 ($206,108) vs 18657 ($68,252) — 3x rent gap.
--
-- Reversal: UPDATE leases SET superseded_at=NULL, is_active=true
--           WHERE lease_id IN (25392,25393,16950,25180,17096,18413,17106);
--           and restore the prior v_lease_detail definition (pre-live-filter).

create or replace view v_lease_detail as
 SELECT l.lease_id, l.property_id, NULL::text AS lease_number, 'dia'::text AS source_db,
    norm_text(l.tenant) AS tenant,
    norm_text(COALESCE(l.guarantor, g.guarantor_name)) AS guarantor, g.guarantor_type,
    NULL::date AS original_occupancy, l.lease_start, l.lease_expiration, NULL::date AS termination_date,
    CASE WHEN ((l.lease_start IS NOT NULL) AND (l.lease_expiration IS NOT NULL))
      THEN round((((l.lease_expiration - l.lease_start))::numeric / 365.25), 1) ELSE NULL::numeric END AS initial_term_years,
    NULL::numeric AS total_term_years, NULL::integer AS num_renewals,
    CASE WHEN (l.lease_expiration IS NOT NULL)
      THEN round((((l.lease_expiration - CURRENT_DATE))::numeric / 365.25), 1) ELSE NULL::numeric END AS term_remaining_years,
    l.rent AS annual_rent, l.rent_per_sf AS rent_psf, NULL::numeric AS future_rent_psf, NULL::numeric AS rent_cagr,
    l.expense_structure, NULL::text AS lease_structure, l.renewal_option_text AS renewal_options,
    NULL::boolean AS is_renewed, NULL::boolean AS is_first_generation, NULL::boolean AS is_superseding,
    le_agg.last_extension_date, le_agg.extension_count, l.source_confidence AS data_source,
    l.parent_lease_id, l.term_number, l.term_type, l.is_active, l.superseded_at,
    l.annual_rent AS base_annual_rent, l.leased_area, l.operator, l.renewal_options AS renewal_options_short,
    l.annualized_escalation_percent_current, l.escalation_frequency_years_current, l.escalation_raw_text_current
   FROM ((leases l
     LEFT JOIN guarantors g ON ((g.guarantor_id = l.guarantor_id)))
     LEFT JOIN ( SELECT lease_escalations.lease_id, max(lease_escalations.effective_date) AS last_extension_date,
            count(*) AS extension_count FROM lease_escalations GROUP BY lease_escalations.lease_id) le_agg
       ON ((le_agg.lease_id = l.lease_id)))
  WHERE l.superseded_at IS NULL AND COALESCE(l.is_active, true) = true
  ORDER BY l.property_id,
    (CASE l.source_confidence WHEN 'documented' THEN 0 WHEN 'estimated' THEN 1 WHEN 'inferred' THEN 2 ELSE 3 END),
    (CASE WHEN l.rent IS NOT NULL THEN 0 ELSE 1 END), l.lease_id DESC;

-- Targeted supersession of the 7 redundant same-lease rows (reversible).
update leases set superseded_at = now(), is_active = false
where lease_id in (25393, 25392, 16950, 25180, 17096, 18413, 17106) and superseded_at is null;
