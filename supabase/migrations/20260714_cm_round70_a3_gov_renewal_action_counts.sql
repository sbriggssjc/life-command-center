-- Migration: gov — Round 70 Layer A3: gov lease renewal rate = TTM ACTION counts
-- Project: government (scknotsqkcheojiaewwh). Applied live + committed.
--
-- Scott (G24): "There are not 11,000 leases that commenced in 2014... needs to
-- be TTM action count per category, not a sum of the entire inventory."
--
-- ROOT CAUSE (receipts, TTM window ending 2024-06-30):
--   The commencement-side categories counted RAW gsa_lease_events rows. The GSA
--   monthly snapshot-diff emits a 'modified' event for essentially every lease
--   with ANY field change between snapshots, so 'succeeding_superseding'
--   (event_type='modified') = 7,644 (5,994 distinct leases) -- snapshot field
--   churn, not lease lifecycle ACTIONS. 'new_award'=572, 'renewed'=1,165.
--   Deck p.28 (2Q-2024) target magnitudes: 89 / 198 / 208 / 35 / 3.
--
-- FIX (commencement side): count TTM ACTIONS from gsa_leases.latest_action
-- (the curated GSA lease-action label) with lease_effective in the trailing
-- 12 months -- one action per lease, deck-scale:
--   first_generation_commencements  <- latest_action = 'New'
--   renewed_leases                  <- 'New/Replacing','Renewal','Extension','Holdover'
--   succeeding_superseding_leases   <- 'Succeeding','Superseding'
--
--   Before -> After at 2024-06-30 (deck target):
--     first_gen   572  -> 83   (deck 89)
--     renewed   1,165  -> 233  (deck 198)
--     succeeding 7,644 -> 223  (deck 208)
--   Same order of magnitude as the deck; the residual vs the 2Q-2024 deck is
--   snapshot vintage drift (the deck was built mid-2024; the live DB has since
--   ingested more snapshots/backfill adding leases with effective dates in that
--   window). The 7,644 -> 223 correction is the headline fix Scott flagged.
--
-- expired_leases / terminated_leases: LEFT AS-IS (events 'expired' +
-- gsa_leases.termination_date). KNOWN GAP vs deck (expired 637 vs 35,
-- terminated 440 vs 3): the deck's "expirations" count only NON-RENEWED lapses
-- and "terminations" only genuine early terminations -- neither is cleanly
-- reconstructable from current GSA fields (gsa_leases holds only the CURRENT
-- lease per number, so lease_expiration-in-window = 1; all 440 termination_dates
-- in the window are >60d before lease_expiration; 637 'expired' events are
-- mostly immediately re-let). Flagged for Scott: needs the master's
-- true-lapse / early-termination methodology. Tracked as a follow-up.
--
-- CREATE OR REPLACE preserves column names/order/types (5 metric cols).

CREATE OR REPLACE VIEW public.cm_gov_lease_renewal_rate_q AS
 WITH quarters AS (
   SELECT period_end FROM cm_period_anchor
   WHERE period_end >= '2013-04-01'::date AND period_end <= CURRENT_DATE
 ), sentinels AS (
   SELECT event_date, event_type FROM gsa_lease_events
   WHERE event_date IS NOT NULL
   GROUP BY event_date, event_type HAVING count(*) > 1000
 )
 SELECT q.period_end,
   ( SELECT count(*) FROM gsa_leases gl
      WHERE gl.lease_effective > (q.period_end - '1 year'::interval)
        AND gl.lease_effective <= q.period_end
        AND gl.latest_action = 'New' ) AS first_generation_commencements,
   ( SELECT count(*) FROM gsa_leases gl
      WHERE gl.lease_effective > (q.period_end - '1 year'::interval)
        AND gl.lease_effective <= q.period_end
        AND gl.latest_action IN ('New/Replacing','Renewal','Extension','Holdover') ) AS renewed_leases,
   ( SELECT count(*) FROM gsa_leases gl
      WHERE gl.lease_effective > (q.period_end - '1 year'::interval)
        AND gl.lease_effective <= q.period_end
        AND gl.latest_action IN ('Succeeding','Superseding') ) AS succeeding_superseding_leases,
   ( SELECT count(*) FROM gsa_lease_events e
      WHERE e.event_type = 'expired'
        AND e.event_date > (q.period_end - '1 year'::interval) AND e.event_date <= q.period_end
        AND NOT EXISTS (SELECT 1 FROM sentinels s WHERE s.event_date = e.event_date AND s.event_type = e.event_type) ) AS expired_leases,
   ( SELECT count(*) FROM gsa_leases gl
      WHERE gl.termination_date > (q.period_end - '1 year'::interval)
        AND gl.termination_date <= q.period_end ) AS terminated_leases
 FROM quarters q
 ORDER BY q.period_end;

CREATE OR REPLACE VIEW public.cm_gov_lease_renewal_rate_m AS
 WITH months AS (
   SELECT ((date_trunc('month', g.d) + '1 mon -1 days'::interval))::date AS period_end
   FROM generate_series('2014-01-01'::date::timestamptz, cm_last_completed_quarter_end()::timestamptz, '1 mon'::interval) g(d)
 ), sentinels AS (
   SELECT event_date, event_type FROM gsa_lease_events
   WHERE event_date IS NOT NULL
   GROUP BY event_date, event_type HAVING count(*) > 1000
 )
 SELECT m.period_end,
   ( SELECT count(*) FROM gsa_leases gl
      WHERE gl.lease_effective > (m.period_end - '1 year'::interval)
        AND gl.lease_effective <= m.period_end
        AND gl.latest_action = 'New' ) AS first_generation_commencements,
   ( SELECT count(*) FROM gsa_leases gl
      WHERE gl.lease_effective > (m.period_end - '1 year'::interval)
        AND gl.lease_effective <= m.period_end
        AND gl.latest_action IN ('New/Replacing','Renewal','Extension','Holdover') ) AS renewed_leases,
   ( SELECT count(*) FROM gsa_leases gl
      WHERE gl.lease_effective > (m.period_end - '1 year'::interval)
        AND gl.lease_effective <= m.period_end
        AND gl.latest_action IN ('Succeeding','Superseding') ) AS succeeding_superseding_leases,
   ( SELECT count(*) FROM gsa_lease_events e
      WHERE e.event_type = 'expired'
        AND e.event_date > (m.period_end - '1 year'::interval) AND e.event_date <= m.period_end
        AND NOT EXISTS (SELECT 1 FROM sentinels s WHERE s.event_date = e.event_date AND s.event_type = e.event_type) ) AS expired_leases,
   ( SELECT count(*) FROM gsa_leases gl
      WHERE gl.termination_date > (m.period_end - '1 year'::interval)
        AND gl.termination_date <= m.period_end ) AS terminated_leases
 FROM months m
 ORDER BY m.period_end;
