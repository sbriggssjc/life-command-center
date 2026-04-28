-- ============================================================================
-- Round 76cr — domain classification flag for dia properties with gov tenants
--
-- User flag: 1711 Church St (Norfolk VA) shown in dia DB but had US Dept of
-- Veterans Affairs as a tenant. Suggests possible domain misclassification.
--
-- Audit found 3 dia properties whose primary tenant matches a government-
-- agency pattern:
--   22826 'Wilmington Va Medical Center' (1601 Kirkwood Hwy, Wilmington DE)
--         -- pure VA medical center -> flag 'misclassified_gov'
--   28859 'Va Medical Center - Hot Springs' (500 N 5th St, Hot Springs SD)
--         -- pure VA medical center -> flag 'misclassified_gov'
--   29832 'DaVita Dialysis | VA Clinic' (930 Furman Dr, Waupaca WI)
--         -- hybrid: DaVita primary + VA secondary tenant -> NOT flagged
--         (legitimate dia property with VA clinic component)
--
-- The user-reported 1711 Church St (35625) didn't match the audit because
-- its primary stored tenant is 'In Home Clinical & Case Worker Services'
-- (a private clinical practice). The VA tenants from the CoStar capture
-- got filtered or didn't persist to leases, so the property correctly
-- routed to dia by primary-tenant rule.
--
-- This round delivers the audit + flag + triage view. We do NOT auto-
-- migrate to gov DB (cross-DB copy is risky for 2 rows; safer to flag
-- for human review and let the user choose). A follow-up round
-- (76cr-Phase2+) will add a forward-routing helper that warns at
-- capture time when the primary tenant looks government.
-- ============================================================================

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS domain_classification_flag text;

ALTER TABLE public.properties
  DROP CONSTRAINT IF EXISTS properties_domain_classification_flag_check;
ALTER TABLE public.properties
  ADD CONSTRAINT properties_domain_classification_flag_check
  CHECK (domain_classification_flag IS NULL
         OR domain_classification_flag IN ('misclassified_gov','review_pending','confirmed_dia'));

UPDATE public.properties
   SET domain_classification_flag = 'misclassified_gov'
 WHERE property_id IN (22826, 28859);

CREATE OR REPLACE VIEW public.v_dia_domain_classification_review AS
SELECT
  p.property_id,
  p.address,
  p.city,
  p.state,
  p.tenant,
  p.domain_classification_flag,
  (SELECT array_agg(l.tenant ORDER BY l.lease_start DESC NULLS LAST)
     FROM public.leases l
    WHERE l.property_id = p.property_id AND l.is_active = TRUE) AS active_tenants,
  (SELECT MAX(s.sale_date) FROM public.sales_transactions s WHERE s.property_id = p.property_id) AS most_recent_sale_date
FROM public.properties p
WHERE p.domain_classification_flag IS NOT NULL
ORDER BY p.domain_classification_flag, p.state, p.city;
