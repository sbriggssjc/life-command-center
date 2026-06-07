-- Round 70 B5 / A3 tail — TRUE early-termination heuristic (snapshot disappearance)
--
-- *** CANDIDATE — NOT APPLIED LIVE, NOT wired into any chart. ***
-- Held for Scott's definitional call (see receipts §5). Two open questions:
--   1. Does "termination" exclude RELOCATIONS? This heuristic still counts a
--      lease that ended early because the agency moved to a NEW building (new
--      lease elsewhere, no old_lease_number / same-location link). The deck's
--      "~3 TTM at 2024-Q2" implies a narrower give-back definition.
--   2. The receipts series is a STEADY ~50 TTM (2024-Q2 TTM = 49, 5-yr avg ~49)
--      and does NOT reproduce the deck's "3 vs 107" swing. That swing likely
--      came from a different definition; this view will not fabricate it.
--
-- The live cm_gov_lease_termination_rate_q counts gsa_leases.termination_date
-- (the GSA firm-term / termination-RIGHT date, ~1,614d before expiration) — not
-- actual early terminations. This candidate instead detects leases that vanish
-- from gsa_snapshots before lease_expiration.
--
-- Snapshot hygiene baked in (receipts §5a):
--   * valid snapshot = count > 1000 (drops the broken 2019-02 partial, 11 rows).
--   * frozen tail (2026-03..06 identical 7,495) flagged via `reliable=false`.
-- A lease "permanently disappeared" if its last valid snapshot precedes the last
-- valid snapshot overall. A TRUE early termination = vanished > 180d before its
-- last-snapshot lease_expiration, latest_action NOT in (Succeeding, Extension),
-- and no successor (old_lease_number chain OR same-location_code replacement).

CREATE OR REPLACE VIEW public.cm_gov_lease_termination_true_q AS
WITH counts AS (
  SELECT snapshot_date, count(*) AS n FROM gsa_snapshots GROUP BY snapshot_date
), valid_snaps AS (
  SELECT snapshot_date FROM counts WHERE n > 1000
), last_valid AS ( SELECT max(snapshot_date) AS md FROM valid_snaps ),
final_n AS ( SELECT n FROM counts ORDER BY snapshot_date DESC LIMIT 1 ),
frozen_start AS (   -- earliest snapshot in the maximal trailing run equal to final_n
  SELECT min(c.snapshot_date) AS d
  FROM counts c, final_n f
  WHERE c.n = f.n
    AND NOT EXISTS (SELECT 1 FROM counts c2 WHERE c2.snapshot_date > c.snapshot_date AND c2.n <> f.n)
), reliable_through AS (
  SELECT max(snapshot_date) AS d FROM valid_snaps
  WHERE snapshot_date < (SELECT d FROM frozen_start)
), last_seen AS (
  SELECT s.lease_number, max(s.snapshot_date) AS last_seen_date
  FROM gsa_snapshots s JOIN valid_snaps v USING (snapshot_date)
  GROUP BY s.lease_number
), disappeared AS (
  SELECT ls.lease_number, ls.last_seen_date,
    (SELECT min(v.snapshot_date) FROM valid_snaps v WHERE v.snapshot_date > ls.last_seen_date) AS disappeared_on
  FROM last_seen ls, last_valid lv
  WHERE ls.last_seen_date < lv.md
), enriched AS (
  SELECT d.lease_number, d.last_seen_date, d.disappeared_on,
    s.lease_expiration, s.latest_action, s.location_code
  FROM disappeared d
  JOIN gsa_snapshots s ON s.lease_number = d.lease_number AND s.snapshot_date = d.last_seen_date
), true_term AS (
  SELECT e.disappeared_on
  FROM enriched e
  WHERE e.disappeared_on < e.lease_expiration - interval '180 days'
    AND (e.latest_action IS NULL OR e.latest_action NOT IN ('Succeeding','Extension'))
    AND NOT EXISTS (SELECT 1 FROM gsa_snapshots s2 WHERE s2.old_lease_number = e.lease_number)
    AND NOT EXISTS (
      SELECT 1 FROM gsa_snapshots s3
      WHERE s3.location_code = e.location_code AND s3.lease_number <> e.lease_number
        AND s3.lease_effective >= e.last_seen_date - interval '365 days'
        AND s3.snapshot_date >= e.disappeared_on)
), q AS (
  SELECT cm_period_anchor.period_end
  FROM cm_period_anchor
  WHERE cm_period_anchor.period_end >= '2014-04-01'::date
    AND cm_period_anchor.period_end <= cm_last_completed_quarter_end()
)
SELECT q.period_end,
  count(tt.disappeared_on) FILTER (
    WHERE tt.disappeared_on > (q.period_end - interval '1 year') AND tt.disappeared_on <= q.period_end
  ) AS terminated_true_ttm,
  (q.period_end <= (SELECT d FROM reliable_through)) AS reliable
FROM q
LEFT JOIN true_term tt ON TRUE
GROUP BY q.period_end
ORDER BY q.period_end;
