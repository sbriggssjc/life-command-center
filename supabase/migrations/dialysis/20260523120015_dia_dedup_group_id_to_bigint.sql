-- ============================================================================
-- 20260523120015_dia_dedup_group_id_to_bigint.sql
-- OWNERSHIP_AND_SALES_REMEDIATION_PLAN — F2 hotfix (dia)
--
-- The F2 quarantine migration (20260523120010) typed dedup_group_id as
-- UUID. That works for gov (where sale_id is UUID) but is wrong for dia
-- (where sale_id is INTEGER). Live-data apply caught it at the first A2a
-- sales-dedup run. The column is empty at this point so the ALTER is
-- a no-op rewrite.
-- ============================================================================

ALTER TABLE public.sales_transactions
  ALTER COLUMN dedup_group_id DROP DEFAULT;

ALTER TABLE public.sales_transactions
  ALTER COLUMN dedup_group_id TYPE BIGINT USING NULL;

COMMENT ON COLUMN public.sales_transactions.dedup_group_id IS
  'When a row is duplicate_superseded, points at the survivor sale_id within the dedup group. Type matches dia.sales_transactions.sale_id (INTEGER). NULL for live survivors.';
