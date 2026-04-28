-- ============================================================================
-- Round 76by — fix matcher accuracy double-counting in v_matcher_accuracy_recent
--
-- Audit observation: the view shows total=7 / corrected=7 / approval_rate=0.000
-- for fuzzy_address_lcc, suggesting 100% wrong high-confidence matches.
-- Inspection of matcher_accuracy_stats reveals 7 rows, all with
-- total_matches=1 and corrected_count=1, with 7 different (period_start,
-- period_end) tuples. They're 7 daily snapshots of the SAME single
-- feedback event — the rollup function uses 30-day rolling windows that
-- overlap day-to-day, so each event is re-counted in every snapshot
-- whose window contains its date.
--
-- The view then SUMs across all overlapping snapshots in the last 90
-- days, multiplying the real count by ~30.
--
-- Fix: keep only the most recent (period_start, period_end) per
-- (match_reason, domain, confidence_band). That's the freshest 30-day
-- rolling snapshot — non-overlapping, correctly counted.
--
-- Real metrics will now show: 1 feedback event over the last 30 days
-- (1 correction, 0 approvals) for fuzzy_address_lcc — small sample but
-- accurate. Matchers don't yet have enough human feedback to draw
-- accuracy conclusions; the previous 100% wrong reading was an artifact.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_matcher_accuracy_recent AS
WITH latest_snapshot AS (
  SELECT MAX(period_end) AS period_end
  FROM public.matcher_accuracy_stats
)
SELECT s.match_reason,
       s.domain,
       s.confidence_band,
       s.total_matches    AS total,
       s.approved_count   AS approved,
       s.rejected_count   AS rejected,
       s.corrected_count  AS corrected,
       s.deferred_count   AS deferred,
       s.no_match_count   AS no_match,
       s.approval_rate
FROM public.matcher_accuracy_stats s
JOIN latest_snapshot ls ON s.period_end = ls.period_end
ORDER BY s.total_matches DESC;
