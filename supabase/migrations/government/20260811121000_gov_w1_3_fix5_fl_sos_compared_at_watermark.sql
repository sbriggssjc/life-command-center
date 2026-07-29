-- ============================================================================
-- W1.3 Fix 5 — FL SOS enrich→link stage 2 watermark (audit finding)
-- Government DB (scknotsqkcheojiaewwh)
-- ----------------------------------------------------------------------------
-- compareAndLink() (api/_shared/fl-sos-enrich-link.js) selected the owners to
-- compare with:
--     recorded_owners?sos_match_kind=eq.exact&...&limit=100
-- — NO ORDER BY and NO "already compared" marker. So every run re-fetched the
-- same physical-order first `limit` exact-matched owners and re-compared them,
-- never progressing to the rest. With 1,233 exact-matched owners and limit=100,
-- ~1,133 were never compared.
--
-- Fix: add a per-owner `sos_compared_at` watermark. Stage 2 orders by
-- recorded_owner_id, filters `sos_compared_at IS NULL`, and stamps each owner it
-- processes — so every enriched owner is compared exactly once and the cron
-- drains the full backlog. Additive/reversible: DROP COLUMN restores prior state
-- (and NULLing the column re-queues everything for a full re-compare).
-- ============================================================================

ALTER TABLE public.recorded_owners
  ADD COLUMN IF NOT EXISTS sos_compared_at timestamptz;  -- W1.3 Fix 5: stage-2 compare watermark

-- Partial index over the drain predicate (only the not-yet-compared exact
-- matches), so each tick's `sos_match_kind='exact' AND sos_compared_at IS NULL`
-- scan stays cheap as the compared set grows.
CREATE INDEX IF NOT EXISTS idx_recorded_owners_sos_compare_pending
  ON public.recorded_owners (recorded_owner_id)
  WHERE sos_match_kind = 'exact' AND sos_compared_at IS NULL;

-- ---------------------------------------------------------------------------
-- Verification (run after the next stage-2 apply run):
--   -- backlog should trend to 0 as ticks drain it (was ~1,133 unreachable):
--   SELECT count(*) FILTER (WHERE sos_compared_at IS NULL) AS pending,
--          count(*) FILTER (WHERE sos_compared_at IS NOT NULL) AS compared
--   FROM recorded_owners WHERE sos_match_kind = 'exact';
--   -- and no owner is ever compared twice: each processed owner has a single
--   -- non-null sos_compared_at (the column is a one-shot stamp).
-- Reverse: ALTER TABLE public.recorded_owners DROP COLUMN sos_compared_at;
-- ---------------------------------------------------------------------------
