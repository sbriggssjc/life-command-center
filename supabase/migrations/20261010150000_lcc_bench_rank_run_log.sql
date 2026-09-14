-- ACI-phase2-unitC (2026-09-10) — AC2 bench ranking reversibility ledger.
-- LCC Opps. Purely additive: two new tables, no change to owner_contact_pivot
-- or any existing object. Drop both -> zero trace.
--
-- ⚠️ NOT APPLIED LIVE IN THE SESSION THAT WROTE THIS FILE. This session had
-- live read access to xengecqvemvfknjvbvrq (used to confirm the `bench`
-- column shape and the Pulliam/Shuler facts cited in
-- account-based-contact-intelligence.md and STATUS.md) but made no live
-- writes — applying a migration against the production database without an
-- explicit instruction to do so was judged out of scope for this pass. An
-- operator must apply this migration before `POST /api/bench-rank-tick` can
-- write anything: until then `lcc_bench_rank_write_log` inserts fail soft
-- (logged, non-fatal — see bench-rank-tick.js's `ledgerBeforeWrite`), and the
-- bench PATCH itself is additionally gated on `BENCH_RANK_WRITE`, so leaving
-- this unapplied is a SAFE default, never a silent loss of reversibility.

BEGIN;

-- Run-level lifecycle (mirrors lcc_tier0_auto_attach_run_log's shape: opened
-- before the work, closed on the way out, so a row stuck at 'started' is the
-- signature of a drop, per the P123 doctrine).
CREATE TABLE IF NOT EXISTS public.lcc_bench_rank_run_log (
  run_id        bigserial PRIMARY KEY,
  status        text NOT NULL DEFAULT 'started',
  batch_tag     text,
  flag_enabled  boolean,
  dry_run       boolean,
  batch_limit   integer,
  owners_ranked integer,
  owners_gated  integer,
  error         text,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  duration_ms   integer
);
REVOKE ALL ON public.lcc_bench_rank_run_log FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.lcc_bench_rank_run_log TO service_role;

-- Per-owner reversibility ledger — ONE row per bench write, carrying the FULL
-- prior bench array so a batch (or a single owner) can be restored byte-for-
-- byte. Never hard-deleted; `reverted_at` marks a reversal without destroying
-- the record of it.
CREATE TABLE IF NOT EXISTS public.lcc_bench_rank_write_log (
  log_id            bigserial PRIMARY KEY,
  batch_tag         text NOT NULL,
  owner_entity_id   uuid NOT NULL,
  owner_name        text,
  prior_bench       jsonb NOT NULL DEFAULT '[]'::jsonb,
  new_bench         jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  reverted_at       timestamptz
);
CREATE INDEX IF NOT EXISTS idx_lcc_bench_rank_write_log_batch ON public.lcc_bench_rank_write_log (batch_tag);
CREATE INDEX IF NOT EXISTS idx_lcc_bench_rank_write_log_owner ON public.lcc_bench_rank_write_log (owner_entity_id, created_at DESC);
REVOKE ALL ON public.lcc_bench_rank_write_log FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.lcc_bench_rank_write_log TO service_role;

COMMIT;

-- REVERT RUNBOOK:
--   BEGIN;
--   DROP TABLE IF EXISTS public.lcc_bench_rank_write_log;
--   DROP TABLE IF EXISTS public.lcc_bench_rank_run_log;
--   COMMIT;
--
-- REVERSE A SINGLE BATCH WRITE (once applied and run):
--   UPDATE owner_contact_pivot p
--      SET bench = w.prior_bench, updated_at = now()
--     FROM lcc_bench_rank_write_log w
--    WHERE w.batch_tag = '<tag>' AND w.owner_entity_id = p.entity_id
--      AND w.reverted_at IS NULL;
--   UPDATE lcc_bench_rank_write_log SET reverted_at = now()
--    WHERE batch_tag = '<tag>' AND reverted_at IS NULL;
