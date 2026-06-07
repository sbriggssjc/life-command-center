-- Round 70 B5 / A3 tail — GOV TERMINATED master splice (applied live 2026-06-07)
--
-- Replaces cm_gov_lease_renewal_rate_q.terminated_leases (the deck's amber
-- "Terminated" stacked bar) with the validated master series. The prior value
-- counted gsa_leases.termination_date in the trailing year — that field is the
-- GSA firm-term / termination-RIGHT date (~1,614d before expiration), NOT actual
-- early terminations. The R70 snapshot-disappearance heuristic could not
-- reproduce the master either (flat ~50 vs the master's 339->88->41->3->0
-- collapse — receipts §5d), so per Scott's doctrine the validated master series
-- is the honest carrier (same pattern as the gov/dia valuation-index splices).
--
-- Master values = abs(Copy Government Master Document.xlsx / All Charts ·
-- "Terminated Leases (ttm)"), quarter-end keyed. They match the deck anchors to
-- the unit: Q2-2022=88, Q2-2023=41, Q1/Q2-2024=3, Q4-2021=107, Q2-2025=0.
-- Coverage Q1-2020..Q2-2025; outside that, terminated_leases is NULL
-- (terminated_source='no_data') — honest, never the old wrong count.
-- Column shape preserved; terminated_source appended (append-only).

CREATE TABLE IF NOT EXISTS public.cm_gov_lease_terminated_master_curated (
  period_end     date PRIMARY KEY,
  terminated_ttm integer NOT NULL
);
TRUNCATE public.cm_gov_lease_terminated_master_curated;
INSERT INTO public.cm_gov_lease_terminated_master_curated (period_end, terminated_ttm) VALUES
('2020-03-31',143),('2020-06-30',138),('2020-09-30',119),('2020-12-31',170),('2021-03-31',339),
('2021-06-30',190),('2021-09-30',133),('2021-12-31',107),('2022-03-31',93),('2022-06-30',88),
('2022-09-30',88),('2022-12-31',74),('2023-03-31',61),('2023-06-30',41),('2023-09-30',17),
('2023-12-31',7),('2024-03-31',3),('2024-06-30',3),('2024-09-30',3),('2024-12-31',2),
('2025-03-31',1),('2025-06-30',0);

CREATE OR REPLACE VIEW public.cm_gov_lease_renewal_rate_q AS
 WITH quarters AS (
         SELECT cm_period_anchor.period_end FROM cm_period_anchor
          WHERE cm_period_anchor.period_end >= '2013-04-01'::date AND cm_period_anchor.period_end <= CURRENT_DATE
        ), sentinels AS (
         SELECT gsa_lease_events.event_date, gsa_lease_events.event_type FROM gsa_lease_events
          WHERE gsa_lease_events.event_date IS NOT NULL
          GROUP BY gsa_lease_events.event_date, gsa_lease_events.event_type HAVING count(*) > 1000
        )
 SELECT q.period_end,
    ( SELECT count(*) FROM gsa_leases gl WHERE gl.lease_effective > (q.period_end - '1 year'::interval) AND gl.lease_effective <= q.period_end AND gl.latest_action = 'New'::text) AS first_generation_commencements,
    ( SELECT count(*) FROM gsa_leases gl WHERE gl.lease_effective > (q.period_end - '1 year'::interval) AND gl.lease_effective <= q.period_end AND (gl.latest_action = ANY (ARRAY['New/Replacing'::text, 'Renewal'::text, 'Extension'::text, 'Holdover'::text]))) AS renewed_leases,
    ( SELECT count(*) FROM gsa_leases gl WHERE gl.lease_effective > (q.period_end - '1 year'::interval) AND gl.lease_effective <= q.period_end AND (gl.latest_action = ANY (ARRAY['Succeeding'::text, 'Superseding'::text]))) AS succeeding_superseding_leases,
    ( SELECT count(*) FROM gsa_lease_events e WHERE e.event_type = 'expired'::text AND e.event_date > (q.period_end - '1 year'::interval) AND e.event_date <= q.period_end AND NOT (EXISTS ( SELECT 1 FROM sentinels s WHERE s.event_date = e.event_date AND s.event_type = e.event_type))) AS expired_leases,
    mc.terminated_ttm::bigint AS terminated_leases,
    CASE WHEN mc.terminated_ttm IS NOT NULL THEN 'master_curated'::text ELSE 'no_data'::text END AS terminated_source
   FROM quarters q
   LEFT JOIN cm_gov_lease_terminated_master_curated mc ON mc.period_end = q.period_end
  ORDER BY q.period_end;
