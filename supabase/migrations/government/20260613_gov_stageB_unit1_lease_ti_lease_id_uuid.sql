-- ============================================================================
-- Stage B Unit 1 — lease_ti_amortization.lease_id type fix (GOVERNMENT)
-- 2026-06-13 · corrective; applied live (table empty, 0 rows)
--
-- The original Unit 1 gov migration copied dia's `lease_id bigint`, but
-- gov.leases.lease_id is a UUID — so a TI row could never link to its lease
-- (the lease-less-property re-gate surfaced ti_rows:0). Two fixes:
--
--   1. lease_id bigint → uuid, so it matches gov.leases.lease_id and the
--      gov-engine (#64) can join the TI schedule to the lease directly.
--   2. The unique index was a COALESCE() expression index, which PostgREST's
--      `on_conflict=lease_id,property_id,schedule_year` upsert can't infer
--      (42P10). Replace it with a plain unique index on those exact columns,
--      NULLS NOT DISTINCT (PG15+) so null lease_id / schedule_year still dedupe.
--
-- Safe: table has 0 rows, so the type change loses nothing. Idempotent.
-- ============================================================================

-- The COALESCE(lease_id, 0::bigint) expression index is invalid once lease_id
-- is uuid, so drop it before the type change.
DROP INDEX IF EXISTS public.uq_lease_ti_lease_year;

ALTER TABLE public.lease_ti_amortization
  ALTER COLUMN lease_id TYPE uuid USING NULL::uuid;

-- on_conflict-inferable unique index. NULLS NOT DISTINCT keeps null-keyed rows
-- deduped the way the old COALESCE index intended.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lease_ti_lease_year
  ON public.lease_ti_amortization (lease_id, property_id, schedule_year) NULLS NOT DISTINCT;

COMMENT ON COLUMN public.lease_ti_amortization.lease_id IS
  'Stage B Unit 1 — → gov.leases.lease_id (uuid). Nullable for pre-link rows.';
