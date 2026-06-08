-- Round 74 Task 3 — dia is_northmarq provenance column.
-- Adds is_northmarq_source so the Salesforce-authoritative flag fix (and future
-- live PA-push re-derivation) can tag which writes came from the CRM vs the
-- legacy R23 broker-string backfill. Applied live to Dialysis_DB 2026-06-08.
ALTER TABLE public.sales_transactions
  ADD COLUMN IF NOT EXISTS is_northmarq_source text;

COMMENT ON COLUMN public.sales_transactions.is_northmarq_source IS
  'Provenance of is_northmarq: salesforce (CRM-authoritative, Round 74) | r23_broker_string (legacy) | null. See docs/architecture/salesforce_nm_authoritative_sync.md';
