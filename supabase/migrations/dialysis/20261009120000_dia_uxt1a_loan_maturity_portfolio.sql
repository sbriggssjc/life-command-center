-- UX-T1a-debt (dia half) — anon-readable, non-PII loan-maturity feed for the LCC mirror.
-- APPLIED LIVE to zqzrriwuavgrquhisnoa 2026-09-03 as `dia_uxt1a_loan_maturity_portfolio`.
-- Sibling of gov's v_loan_maturity_portfolio; see that view's header for the full
-- rationale. Column list is IDENTICAL so the mirror leg needs one select= list.
--
-- Measured 2026-09-03: dia 660 loans, 155 with a maturity date, 22 maturing inside 24
-- months across 21 properties. dia also ships `v_loan_maturity_watch` (72 properties).
--
-- ⚠️ SCHEMA DIVERGENCE FROM gov, mapped here rather than in the mirror. The two domains
-- name the SAME facts differently and DIFFERENT facts similarly:
--   dia `current_balance`   <- gov `loan_balance`
--   dia `lenders.lender_name` <- gov `lenders.name`  (the first cut of this migration
--     assumed gov's spelling and failed 42703 -- read each domain's schema, never assume
--     the sibling's)
--   dia `loans.lender_name` ALSO exists as a column on the loan itself: 525 rows carry
--     the text, 372 the id, so BOTH are consulted (text first -- it is the value recorded
--     on the loan) rather than picking one and losing rows.
--   dia has no `status`; it has `is_active`. That is a DIFFERENT fact from gov's
--     active/defaulted, so it is NOT mapped onto `loan_status` -- doing so would report
--     every dia loan as "active" in a column where gov's `defaulted` is a real signal.
--     `loan_status` is an honest NULL for dia, and `is_active` filters instead.
--   ⚠️ dia `lenders` carries `primary_contact` / `secondary_contact` / `contact_id`.
--     None is exposed. Do not add one; contacts have their own path.
--
-- Reverse: DROP VIEW public.v_loan_maturity_portfolio;  (nothing is written)

CREATE OR REPLACE VIEW public.v_loan_maturity_portfolio AS
SELECT l.loan_id::text                              AS loan_ref,
       l.property_id,
       l.maturity_date,
       l.loan_amount                                AS original_amount,
       l.current_balance                            AS current_balance,
       COALESCE(NULLIF(btrim(l.lender_name), ''), ld.lender_name) AS lender_name,
       l.loan_type,
       COALESCE(l.is_cmbs, false)                   AS is_cmbs,
       NULL::text                                   AS loan_status,
       l.data_source,
       l.updated_at
  FROM public.loans l
  LEFT JOIN public.lenders ld ON ld.lender_id = l.lender_id
 WHERE l.property_id   IS NOT NULL
   AND l.maturity_date IS NOT NULL
   AND COALESCE(l.is_active, true);

ALTER VIEW public.v_loan_maturity_portfolio SET (security_invoker = off);

GRANT SELECT ON public.v_loan_maturity_portfolio TO anon, authenticated, service_role;

COMMENT ON VIEW public.v_loan_maturity_portfolio IS
  'UX-T1a-debt: anon-readable non-PII loan maturities for the LCC cross-DB mirror leg '
  '(loan_maturity). Sibling of gov''s view with an identical column list. loan_status is '
  'always NULL for dia -- this domain records is_active, not gov''s active/defaulted, and '
  'mapping one onto the other would fabricate a status.';

-- VERIFIED live as anon: 155 rows, 153 lender names, 22 maturing <=24mo over 21
-- properties -- reproducing the base-table counts exactly.
