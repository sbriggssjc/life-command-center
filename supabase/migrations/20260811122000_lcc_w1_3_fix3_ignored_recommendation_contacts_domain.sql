-- ============================================================================
-- W1.3 Fix 3 — recommendation_ignored loop: make the generator skip-set work
-- Life Command Center (LCC Opps xengecqvemvfknjvbvrq)
-- ----------------------------------------------------------------------------
-- Two halves of the negative-feedback arm were broken:
--   (a) NOTHING wrote signal_type='recommendation_ignored' (0 rows live), so the
--       "consistently ignored" view was always empty. The producer is added in
--       api/_shared/research-loop.js (closeResearchLoop emits it on a dismiss
--       outcome) + a Dismiss action on the Research page (ops.js).
--   (b) The research-task generator's skip-set query
--       (admin.js handleGenerateResearchTasks) filters
--       `ignored_recommendation_contacts?domain=eq.<domain>`, but the view had NO
--       `domain` column — so the request 400'd (PostgREST 42703) and the skip-set
--       fell back to an empty set (soft-fail), i.e. it never skipped anything.
--
-- This migration fixes (b): append a `domain` column (grouped, so the count is
-- per (entity_id, domain) — the grain the generator's per-domain loop expects and
-- which prevents a gov property id from false-skipping the same id in dia).
-- `signals.domain` carries 'government'/'dialysis' (long form), matching the
-- generator's `domain` (source==='dia' ? 'dialysis' : 'government') and the
-- research-loop dismissal signal's domain.
--
-- CREATE OR REPLACE VIEW is append-only for columns; `domain` is added at the END
-- of the SELECT (prior order entity_id, ignored_count, acted_count,
-- last_signal_at preserved). Reversible: re-create with the schema/027 body.
-- ============================================================================

CREATE OR REPLACE VIEW public.ignored_recommendation_contacts AS
SELECT
  entity_id,
  COUNT(*) FILTER (WHERE signal_type = 'recommendation_ignored') AS ignored_count,
  COUNT(*) FILTER (WHERE signal_type = 'recommendation_acted_on') AS acted_count,
  MAX(created_at) AS last_signal_at,
  domain
FROM public.signals
WHERE entity_type = 'contact'
  AND signal_type IN ('recommendation_acted_on', 'recommendation_ignored')
  AND created_at > now() - interval '90 days'
GROUP BY entity_id, domain
HAVING COUNT(*) FILTER (WHERE signal_type = 'recommendation_ignored') >= 3
   AND COUNT(*) FILTER (WHERE signal_type = 'recommendation_acted_on') = 0;

-- ---------------------------------------------------------------------------
-- Verification (after apply + once dismissals accumulate):
--   -- the generator query no longer 400s and returns the per-domain skip-set:
--   SELECT * FROM ignored_recommendation_contacts WHERE domain = 'government';
--   -- a contact needs >=3 recommendation_ignored (0 acted) in 90d to be skipped
--   -- (the intended "consistently ignored" threshold, unchanged).
-- ---------------------------------------------------------------------------
