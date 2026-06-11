-- ============================================================================
-- Stage B Unit 0 — cap_rate_history ledger boundary (GOVERNMENT, #64 domain)
-- 2026-06-11 · written, NOT applied · APPLY AFTER the enum-value file
--
-- THE LEAK PATH (confirmed live 2026-06-11): the field-write guards protect
-- field WRITES, but two REPORTED cohort views read cap_rate_history directly —
--   cm_gov_core_cap_rate_dots, cm_gov_market_quarterly_master_m.
-- Both select the cap via a correlated subquery scoped to
--   event_type = 'sale' AND (property_id, event_date) = a real sales_transactions row.
-- So an extracted economic-cap written as event_type='valuation' (NOT 'sale') and
-- NOT tied to a sale row is excluded from the reported cohorts BY CONSTRUCTION.
--
-- "Enforced, not assumed" (Scott) — two explicit guards on top of that:
--   1) a CHECK so an extracted-source row (income_source LIKE 'folder_feed_%')
--      can NEVER carry a reported event type ('sale'/'listing') — the boundary is
--      made structurally impossible to violate at the WRITE side;
--   2) the small cm_gov_core_cap_rate_dots cohort is recreated with an explicit
--      income_source guard on its cap subquery (belt-and-suspenders at the READ
--      side). cm_gov_market_quarterly_master_m (22.8K-char reported view) is NOT
--      recreated blind here — its event_type='sale' scope + guard (1) already
--      exclude extracted caps; an explicit income_source guard there is a
--      documented apply-time follow-on, validated against its live body.
--
-- The reported market cap stays the OBSERVED sale cap. Our internal economic cap
-- can live in the ledger for BOVs + #64 but can never be a row a cohort counts.
-- Additive + idempotent (CREATE OR REPLACE keeps the column list).
-- ============================================================================

-- (1) WRITE-SIDE: an extracted-source row can never be a reported event type.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cap_rate_history_extracted_not_reported') THEN
    ALTER TABLE public.cap_rate_history
      ADD CONSTRAINT chk_cap_rate_history_extracted_not_reported
      CHECK (
        income_source IS NULL
        OR income_source NOT LIKE 'folder_feed_%'
        OR event_type NOT IN ('sale'::cap_rate_event_type, 'listing'::cap_rate_event_type)
      );
  END IF;
END$$;

-- (2) READ-SIDE: recreate the small cap-rate-dots cohort with an explicit
-- income_source guard (faithful copy of the live body + the one added predicate).
CREATE OR REPLACE VIEW public.cm_gov_core_cap_rate_dots AS
 SELECT s.sale_date,
    ( SELECT
            CASE
                WHEN s.cap_rate_quality = 'implausible_unverified'::text THEN NULL::numeric
                ELSE COALESCE(crh.cap_rate, s.sold_cap_rate, s.last_cap_rate, s.initial_cap_rate)
            END
       FROM cap_rate_history crh
      WHERE crh.property_id = s.property_id
        AND crh.event_date = s.sale_date
        AND crh.event_type = 'sale'::cap_rate_event_type
        AND crh.cap_rate IS NOT NULL
        AND (crh.income_source IS NULL OR crh.income_source NOT LIKE 'folder_feed_%')  -- Stage B Unit 0 ledger boundary
      ORDER BY crh.created_at DESC
     LIMIT 1) AS cap_rate,
    COALESCE(s.firm_term_years_at_sale, ( SELECT (l.firm_term_years - GREATEST(0::numeric,
              EXTRACT(epoch FROM s.sale_date::timestamp without time zone
                - COALESCE(l.commencement_date, l.effective_date, s.sale_date)::timestamp without time zone)
              / (86400.0 * 365.25)))::numeric(5,2)
       FROM leases l
      WHERE l.property_id = s.property_id
        AND l.firm_term_years IS NOT NULL
        AND l.expiration_date >= s.sale_date
        AND (l.commencement_date IS NULL OR l.commencement_date <= s.sale_date)
        AND COALESCE(l.effective_date, l.commencement_date, s.sale_date) <= s.sale_date
        AND (l.superseded_at IS NULL OR l.superseded_at::date > s.sale_date)
      ORDER BY (COALESCE(l.effective_date, l.commencement_date)) DESC NULLS LAST, l.expiration_date DESC
     LIMIT 1))::numeric(5,2) AS firm_term_years,
    s.is_northmarq,
    s.sold_price
   FROM sales_transactions s
  WHERE s.sale_date IS NOT NULL
    AND s.sold_price IS NOT NULL
    AND s.sold_price > 0::numeric
    AND NOT COALESCE(s.exclude_from_market_metrics, false);
