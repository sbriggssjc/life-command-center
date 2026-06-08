-- =============================================================================
-- Round 73 Layer B — #20 gov: re-derive is_northmarq from authoritative listing
-- broker. Project: government (scknotsqkcheojiaewwh). APPLIED LIVE 2026-06-08.
-- Scott-gated. Flag column ONLY -- no price/term/cap touched.
--
-- ROOT CAUSE: is_northmarq contaminated by the loose R23 broker-string backfill
-- (169 flagged; NM cohort averaged 7.92% vs deck NM 6.78%). RULE (Scott): a gov
-- sale is Northmarq iff its LISTING broker is Stan Johnson Company ("SJC") or
-- Northmarq (Team Briggs + individuals sit under the SJC prefix). Source: master
-- Sold sheet L. BROKER (staging.gov_master_sold, 116 NM-listed). Matched sales
-- take the master verdict on (lease_no, sale_date); unmatched fall back to our
-- own listing_broker on the same pattern (NOT purchasing broker).
--
-- AUDIT (verified): 169 -> 66. 96 removed = 92 with NO NM broker at all + 4
-- NM-as-buyer; 0 false drops. Clean NM 2024-Q2 (1yr TTM) = 6.79% (deck 6.78%).
-- Idempotent.
--
-- NOTE (see reports/CM_ROUND73_LAYER_B_RECEIPTS.md): the flag fix corrects the
-- NM LEVEL but does NOT by itself flip the NM-vs-market SPREAD to the deck's
-- ~50-72bps -- our non-NM "market" cap (~6.87% 1yr) is ~63bps below the deck's
-- 7.50%, a cap-rate-BASIS difference (deck uses master-curated caps, we use
-- transaction sold_cap_rate). The spread resolution is a follow-up (cap basis),
-- not this flag fix.
-- =============================================================================
WITH master_all AS (
  SELECT lease_no, sale_date, bool_or(l_broker ~* '^\s*(SJC|Stan Johnson|Northmarq)') AS is_nm
  FROM staging.gov_master_sold
  WHERE lease_no IS NOT NULL AND sale_date IS NOT NULL
  GROUP BY lease_no, sale_date
)
UPDATE public.sales_transactions s
SET is_northmarq = CASE
      WHEN ma.lease_no IS NOT NULL THEN ma.is_nm
      ELSE COALESCE(s.listing_broker ~* '^\s*(SJC|Stan Johnson|Northmarq)', false)
    END
FROM (SELECT s2.sale_id, s2.lease_number, s2.sale_date, s2.listing_broker FROM public.sales_transactions s2) src
LEFT JOIN master_all ma ON ma.lease_no = src.lease_number AND ma.sale_date = src.sale_date
WHERE src.sale_id = s.sale_id
  AND s.is_northmarq IS DISTINCT FROM (CASE
      WHEN ma.lease_no IS NOT NULL THEN ma.is_nm
      ELSE COALESCE(src.listing_broker ~* '^\s*(SJC|Stan Johnson|Northmarq)', false) END);
