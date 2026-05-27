-- ============================================================================
-- Deferred LCC Opps audit_run_log backfill — C2 sales writer + enrichment
--
-- LCC Opps SQL endpoint (xengecqvemvfknjvbvrq) continued to time out at the
-- Supabase MCP layer through the C2 session (same pattern as the C4 +
-- A6b outages on 2026-05-24).
--
-- The work itself completed against the reachable dia + gov endpoints. This
-- file captures the audit_run_log + record_cleanup_provenance writes once
-- LCC Opps SQL access recovers.
-- ============================================================================

-- C2 Part A — gov sales enrichment from loans
--   - New function: public.sales_enrich_from_loans() on gov
--   - One-shot run results:
--     * lender_name_enriched: 425 (0% -> 12.5% of gov live sales)
--     * financing_type_enriched: 425 (2.3% -> 14.7%)
--     * loans_sale_id_linked: 394 (0 -> 41% of gov.loans linked to sales)
--   - New cron: lcc-gov-sales-enrich-from-loans-tick (hourly :20)
WITH opened AS (
  SELECT public.audit_run_begin(
    'C2a_gov_sales_enrich_from_loans_2026_05_27_001',
    'C2a_sales_enrich_from_loans',
    'gov_db',
    FALSE,
    1244,
    'C2 Part A: enrich gov.sales_transactions.lender_name + financing_type from gov.loans.originator + is_cmbs, plus back-link loans.sale_id (BACKFILLED — LCC Opps SQL was timing out during the live run). Match on property_id + origination_date within ±6 months of sale_date, excluding refinance loans. Idempotent. Created public.sales_enrich_from_loans() + lcc-gov-sales-enrich-from-loans-tick cron (hourly :20).',
    '{"lender_name_enriched":425,"financing_type_enriched":425,"loans_sale_id_linked":394,"new_function":"sales_enrich_from_loans","new_cron":"lcc-gov-sales-enrich-from-loans-tick"}'::jsonb
  ) AS log_id
)
SELECT public.audit_run_finish(log_id, 'succeeded', 1244, NULL, NULL) FROM opened;
SELECT public.record_cleanup_provenance(
  'C2a_gov_sales_enrich_from_loans_2026_05_27_001', 'gov_db', 'sales_transactions', 'BULK',
  'lender_name + financing_type + loans.sale_id',
  '{"lender_enriched":425,"financing_enriched":425,"loans_linked":394,"source":"loans.originator + loans.is_cmbs","filter":"exclude refinance loans, ±6 month window"}'::jsonb,
  'C2 Part A sales enrichment from loans', 0.85
);

-- C2 Part C — dia transaction_type backfill via signal heuristics
--   - One-shot run: 199 sales classified from notes/deed_type/buyer-seller-equality signals
--     * Investment: 73, Portfolio: 47, Nominal Transfer: 37, 1031 Exchange: 19,
--       Land Sale: 16, Build-to-Suit: 6, Foreclosure: 1
--   - JS classifySaleType also extended with same patterns for new captures
WITH opened AS (
  SELECT public.audit_run_begin(
    'C2c_dia_classify_sale_type_2026_05_27_001',
    'C2c_classify_sale_type_backfill',
    'dia_db',
    FALSE,
    199,
    'C2 Part C: dia.sales_transactions.transaction_type backfill via signal heuristics (BACKFILLED). Inspects notes (deed_type, sale_notes_raw), buyer/seller equality, and sold_price to classify previously-NULL rows. JS classifySaleType in sidebar-pipeline.js extended with same patterns so new captures classify the same way.',
    '{"classified":199,"by_type":{"Investment":73,"Portfolio":47,"Nominal Transfer":37,"1031 Exchange":19,"Land Sale":16,"Build-to-Suit":6,"Foreclosure":1},"writer_extended":true}'::jsonb
  ) AS log_id
)
SELECT public.audit_run_finish(log_id, 'succeeded', 199, NULL, NULL) FROM opened;
SELECT public.record_cleanup_provenance(
  'C2c_dia_classify_sale_type_2026_05_27_001', 'dia_db', 'sales_transactions', 'BULK',
  'transaction_type',
  '{"classified":199,"sources":["notes","deed_type","buyer_seller_equality","sold_price"]}'::jsonb,
  'C2 Part C dia transaction_type backfill', 0.75
);

-- C2 Part B — contacts schema extension (PII persistence per Decision #5)
--   - dia.contacts + gov.contacts: ADD sale_id + sale_role columns + indexes
--   - sidebar-pipeline.js::upsertDomainSales now calls persistSaleContacts()
--     after each successful sale write, writing buyer/seller/broker PII
--     (phone/email/address/website) to contacts when at least one PII field
--     is present beyond the name. Forward-only — no retroactive backfill.
WITH opened AS (
  SELECT public.audit_run_begin(
    'C2b_contacts_pii_persistence_2026_05_27_001',
    'C2b_contacts_schema_extension',
    'cross_domain',
    FALSE,
    0,
    'C2 Part B: schema extension to support Decision #5 buyer/seller PII persistence (BACKFILLED metadata). ADD sale_id FK + sale_role column to both dia.contacts and gov.contacts + indexes. sidebar-pipeline.js::persistSaleContacts() now runs after every successful sale write. Forward-only — no retroactive backfill (most legacy buyer/seller names landed without PII).',
    '{"row_changes":0,"schema_changes":{"dia":"contacts.sale_id (integer) + sale_role + 2 indexes","gov":"contacts.sale_id (uuid) + sale_role + 2 indexes"},"js_change":"persistSaleContacts() helper + call from upsertDomainSales loop"}'::jsonb
  ) AS log_id
)
SELECT public.audit_run_finish(log_id, 'succeeded', 0, NULL, NULL) FROM opened;

SELECT log_id, run_id, target_database, status, rows_affected
FROM public.audit_run_log
WHERE run_id LIKE 'C2%_2026_05_27%'
ORDER BY log_id;
