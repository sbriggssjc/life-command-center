-- R2-C Unit 4 (gov) — re-base cm_gov_lease_renewal_rate_m to TRUE departures.
-- Depends on Unit 3 (cm_gov_lease_termination_rate_m) being applied first.
--
-- Grounded live 2026-06-29 (gov scknotsqkcheojiaewwh): the renewal/turnover
-- chart read ~927 "Expired" + ~498 "Terminated" = ~1,425 leases "out" vs ~205
-- "in" on a stable ~7,500-lease portfolio (active 8,050 in 2018 -> 7,495 in
-- 2026, ~70/yr net) — impossible. Two faults:
--   (a) "expired" (gsa_lease_events event_type='expired') is OPTION-DATE
--       expirations, the vast majority of which renew / hold over, not
--       departures; and it is corrupted by snapshot-diff MASS-STAMP events. The
--       2026-03 TTM of 927 includes a 471-row batch stamp on 2026-02-01 that
--       escapes the >1000 sentinel filter (a 2,086-row 2026-03-01 stamp IS
--       caught; normal months are 25-70). True departures that period were 480.
--   (b) the chart sums expired + terminated as disjoint "out" categories, but a
--       terminated lease also expires — double-counting the real ~480-664/yr
--       departures.
--
-- Fix:
--   1. Tighten the mass-stamp sentinel filter from count > 1000 to count > 200,
--      removing batch-stamp artifacts (471, 2086) while keeping real months
--      (<= ~70). De-corrupts expired_leases (2026-03: 927 -> ~456).
--   2. Surface the SNAPSHOT-based true departure count (net_departures_ttm) —
--      the authoritative "left the portfolio" measure, immune to event stamps —
--      sourced from the sibling termination view's terminated_ttm (single source
--      of truth for snapshot departures). Recent ~480-664/yr.
--   3. Decompose true departures for the chart without double-counting:
--      non_renewed_expirations = max(net_departures - terminated, 0) (expirations
--      that actually left), and expirations_renewed_or_held = the continuation
--      (holdover/renewal) share of option-date expirations — making explicit
--      that "expired" is mostly NOT a loss.
--
-- New columns appended at the END (CREATE OR REPLACE is column-append-only).
-- The chart (cm-native-chart-injector.js + cm-chart-image-renderer.js) re-points
-- the below-zero exit from expired_leases to non_renewed_expirations so the net
-- line reads real turnover (~hundreds, not -1,096). Existing count columns are
-- retained for audit.
--
-- Reversible: restore the > 1000 sentinel and drop the appended columns.

CREATE OR REPLACE VIEW public.cm_gov_lease_renewal_rate_m AS
 WITH months AS (
         SELECT (date_trunc('month'::text, g.d) + '1 mon -1 days'::interval)::date AS period_end
           FROM generate_series('2014-01-01'::date::timestamp with time zone, cm_last_completed_quarter_end()::timestamp with time zone, '1 mon'::interval) g(d)
        ), sentinels AS (
         -- R2-C Unit 4: tightened > 1000 -> > 200 to catch sub-1000 batch stamps.
         SELECT gsa_lease_events.event_date,
            gsa_lease_events.event_type
           FROM gsa_lease_events
          WHERE gsa_lease_events.event_date IS NOT NULL
          GROUP BY gsa_lease_events.event_date, gsa_lease_events.event_type
         HAVING count(*) > 200
        ), lease_counts AS (
         SELECT m.period_end,
            count(*) FILTER (WHERE gl.latest_action = 'New'::text AND gl.lease_effective > (m.period_end - '1 year'::interval) AND gl.lease_effective <= m.period_end) AS first_generation_commencements,
            count(*) FILTER (WHERE (gl.latest_action = ANY (ARRAY['New/Replacing'::text, 'Renewal'::text, 'Extension'::text, 'Holdover'::text])) AND gl.lease_effective > (m.period_end - '1 year'::interval) AND gl.lease_effective <= m.period_end) AS renewed_leases,
            count(*) FILTER (WHERE (gl.latest_action = ANY (ARRAY['Succeeding'::text, 'Superseding'::text])) AND gl.lease_effective > (m.period_end - '1 year'::interval) AND gl.lease_effective <= m.period_end) AS succeeding_superseding_leases,
            count(*) FILTER (WHERE gl.termination_date > (m.period_end - '1 year'::interval) AND gl.termination_date <= m.period_end) AS terminated_leases
           FROM months m
             LEFT JOIN gsa_leases gl ON gl.lease_effective > (m.period_end - '1 year'::interval) AND gl.lease_effective <= m.period_end OR gl.termination_date > (m.period_end - '1 year'::interval) AND gl.termination_date <= m.period_end
          GROUP BY m.period_end
        ), expired_counts AS (
         SELECT m.period_end,
            count(e.event_id) AS expired_leases
           FROM months m
             LEFT JOIN gsa_lease_events e ON e.event_type = 'expired'::text AND e.event_date > (m.period_end - '1 year'::interval) AND e.event_date <= m.period_end AND NOT (EXISTS ( SELECT 1
                   FROM sentinels s
                  WHERE s.event_date = e.event_date AND s.event_type = e.event_type))
          GROUP BY m.period_end
        )
 SELECT lc.period_end,
    lc.first_generation_commencements,
    lc.renewed_leases,
    lc.succeeding_superseding_leases,
    COALESCE(ec.expired_leases, 0::bigint) AS expired_leases,
    lc.terminated_leases,
    -- R2-C Unit 4 (appended): authoritative snapshot departures + decomposition.
    tr.terminated_ttm AS net_departures_ttm,
    GREATEST(COALESCE(tr.terminated_ttm, 0::bigint) - lc.terminated_leases, 0::bigint) AS non_renewed_expirations,
    GREATEST(COALESCE(ec.expired_leases, 0::bigint) - GREATEST(COALESCE(tr.terminated_ttm, 0::bigint) - lc.terminated_leases, 0::bigint), 0::bigint) AS expirations_renewed_or_held
   FROM lease_counts lc
     LEFT JOIN expired_counts ec USING (period_end)
     LEFT JOIN cm_gov_lease_termination_rate_m tr USING (period_end)
  ORDER BY lc.period_end;
