-- UX-T1a-debt (gov half) — anon-readable, non-PII loan-maturity feed for the LCC mirror.
-- APPLIED LIVE to scknotsqkcheojiaewwh 2026-09-03 as `gov_uxt1a_loan_maturity_portfolio`.
--
-- WHY: a maturing loan is the strongest of the four D's in the operator doctrine's
-- "reason to sell" (operator-doctrine 1.8.0 §0b.2), and LCC Opps holds NO loan, lender or
-- CMBS table of any kind, so the signal could not reach the BD spine at all.
-- Measured 2026-09-03: gov 1,559 loans, 413 with a maturity date, 170 maturing inside 24
-- months across 117 properties.
--
-- SHAPE RULE: this is a `*_portfolio` view like every other cross-DB feed -- it exposes a
-- NON-PII slice so LCC's anon pg_net pull works without loosening RLS on the base table.
-- ⚠️ `lenders` carries `contact_name` / `contact_email` / `contact_phone`. Only `name` is
-- exposed here. Do not add a contact column to this view; contacts have their own path.
--
-- The column list is deliberately IDENTICAL to dia's sibling view so the mirror leg needs
-- one select= list rather than a per-domain branch -- which is exactly how dia's lease
-- columns went missing from the property_attributes leg (see UX-T1a-mirror-dia-lease).
--
-- NOT filtered to 24 months. The window is a QUEUE decision and belongs in
-- `v_lcc_bd_worklist`, not in the feed -- a feed that pre-filters to one window cannot
-- answer a different one, and re-mirroring to widen it is a migration.
--
-- Reverse: DROP VIEW public.v_loan_maturity_portfolio;  (nothing is written)

CREATE OR REPLACE VIEW public.v_loan_maturity_portfolio AS
SELECT l.loan_id::text                      AS loan_ref,
       l.property_id,
       l.maturity_date,
       l.loan_amount                        AS original_amount,
       l.loan_balance                       AS current_balance,
       ld.name                              AS lender_name,
       l.loan_type,
       COALESCE(l.is_cmbs, false)           AS is_cmbs,
       l.status                             AS loan_status,
       l.data_source,
       l.updated_at
  FROM public.loans l
  LEFT JOIN public.lenders ld ON ld.lender_id = l.lender_id
 WHERE l.property_id   IS NOT NULL
   AND l.maturity_date IS NOT NULL;

-- security_invoker=off is LOAD-BEARING: LCC reads this as `anon`, and with invoker=on the
-- caller's RLS applies to `loans`/`lenders` and PostgREST answers HTTP 200 with `[]` --
-- indistinguishable from "no loans are maturing" (P157). A silent empty feed here would
-- read exactly like the gap this view exists to close.
ALTER VIEW public.v_loan_maturity_portfolio SET (security_invoker = off);

GRANT SELECT ON public.v_loan_maturity_portfolio TO anon, authenticated, service_role;

COMMENT ON VIEW public.v_loan_maturity_portfolio IS
  'UX-T1a-debt: anon-readable non-PII loan maturities for the LCC cross-DB mirror leg '
  '(loan_maturity). Non-PII by construction -- lenders.contact_* is NOT exposed. Every '
  'loan with a property_id and a maturity_date; the 24-month window is applied downstream '
  'in v_lcc_bd_worklist, never here.';

-- VERIFIED live as anon: 413 rows, 351 lender names, 170 maturing <=24mo over 117
-- properties -- reproducing the base-table counts exactly.
