-- PERF-SPQ2 (2026-09-22) — v_lcc_seller_prospect_queue_summary in ONE pass over the universe.
--
-- ============================ WHY ============================
-- The funnel view was 11 `UNION ALL` branches, each re-running
-- v_lcc_seller_prospect_universe (a stack of CTEs with regex owner-name guards and an
-- EXISTS join to activity_events). Postgres inlines a view per reference, so ONE read of
-- the summary did the universe's full work 11 times, plus once more through the
-- 'queue' branch (v_lcc_seller_prospect_queue is the universe, filtered).
--
-- Measured 2026-09-22 on LCC Opps (idle, same session):
--   summary, old definition ............ 6,567 ms
--   summary, this definition ...........   815 ms
--   one pass of v_lcc_seller_prospect_queue ~ 850 ms
-- pg_stat_statements over real traffic: the summary read averaged 7,281 ms (max 28,334 ms)
-- across 523 calls. It is the single most expensive read /api/seller-prospect-queue made,
-- and Home's BD lane paid for it on every cold boot although no renderer reads `funnel`.
--
-- ============================ EQUIVALENCE ============================
-- Same columns (bucket text, rows bigint, owners bigint), same order, same 11 buckets.
-- Proven before apply: `old EXCEPT ALL new` = 0 rows AND `new EXCEPT ALL old` = 0 rows.
-- The 'queue' bucket used to read v_lcc_seller_prospect_queue. Here it is the same
-- predicate written inline over the universe: in_band IS TRUE AND (newer_lease IS TRUE
-- OR reason_to_sell <> 'reason_to_sell_unmeasured') AND reach_state <> 'touched'. If the
-- queue view's WHERE ever changes, this bucket must change with it. That is guarded by
-- test/perf-spq2-seller-queue-boot.test.mjs, which compares the two predicates.
--
-- NULL handling is unchanged: `reach_state <> 'touched'` and `= 'touched'` are both NULL
-- for a NULL reach_state, and FILTER treats NULL as false, exactly as WHERE did.
--
-- Reverse: re-run the CREATE OR REPLACE VIEW block of
--          20261016120000_lcc_uxt1a_seller_prospect_queue.sql (view only, no data).

CREATE OR REPLACE VIEW public.v_lcc_seller_prospect_queue_summary AS
WITH u AS (
  SELECT entity_id,
         value_basis = 'value_unknown'                              AS b_value_unknown,
         in_band IS TRUE                                            AS b_in_band,
         in_band IS TRUE AND newer_lease IS NULL                    AS b_term_unknown,
         in_band IS TRUE AND newer_lease IS FALSE                   AS b_older,
         in_band IS TRUE AND newer_lease IS TRUE                    AS b_newer,
         in_band IS TRUE AND reason_debt                            AS b_debt,
         in_band IS TRUE AND reason_value_creation_developer        AS b_dev,
         in_band IS TRUE AND (newer_lease IS TRUE
                              OR reason_to_sell <> 'reason_to_sell_unmeasured') AS b_variant_f,
         reach_state = 'touched'                                    AS b_touched,
         reach_state <> 'touched'                                   AS b_not_touched
    FROM public.v_lcc_seller_prospect_universe
), agg AS (
  SELECT
    count(*)                                                  AS r0,
    count(DISTINCT entity_id)                                 AS o0,
    count(*) FILTER (WHERE b_value_unknown)                   AS r1,
    count(DISTINCT entity_id) FILTER (WHERE b_value_unknown)  AS o1,
    count(*) FILTER (WHERE b_in_band)                         AS r2,
    count(DISTINCT entity_id) FILTER (WHERE b_in_band)        AS o2,
    count(*) FILTER (WHERE b_term_unknown)                    AS r3,
    count(DISTINCT entity_id) FILTER (WHERE b_term_unknown)   AS o3,
    count(*) FILTER (WHERE b_older)                           AS r4,
    count(DISTINCT entity_id) FILTER (WHERE b_older)          AS o4,
    count(*) FILTER (WHERE b_newer)                           AS r5,
    count(DISTINCT entity_id) FILTER (WHERE b_newer)          AS o5,
    count(*) FILTER (WHERE b_debt)                            AS r6,
    count(DISTINCT entity_id) FILTER (WHERE b_debt)           AS o6,
    count(*) FILTER (WHERE b_dev)                             AS r7,
    count(DISTINCT entity_id) FILTER (WHERE b_dev)            AS o7,
    count(*) FILTER (WHERE b_variant_f)                       AS r8,
    count(DISTINCT entity_id) FILTER (WHERE b_variant_f)      AS o8,
    count(*) FILTER (WHERE b_variant_f AND b_touched)         AS r9,
    count(DISTINCT entity_id) FILTER (WHERE b_variant_f AND b_touched)     AS o9,
    count(*) FILTER (WHERE b_variant_f AND b_not_touched)     AS r10,
    count(DISTINCT entity_id) FILTER (WHERE b_variant_f AND b_not_touched) AS o10
  FROM u
)
SELECT v.bucket, v.rows, v.owners
  FROM agg
 CROSS JOIN LATERAL (VALUES
   (1,  'universe'::text,            r0,  o0),
   (2,  'value_unknown',             r1,  o1),
   (3,  'in_band',                   r2,  o2),
   (4,  'in_band_term_unknown',      r3,  o3),
   (5,  'in_band_older_lease',       r4,  o4),
   (6,  'in_band_newer_lease',       r5,  o5),
   (7,  'in_band_reason_debt',       r6,  o6),
   (8,  'in_band_reason_developer',  r7,  o7),
   (9,  'variant_f_before_reach',    r8,  o8),
   (10, 'excluded_touched',          r9,  o9),
   (11, 'queue',                     r10, o10)
 ) AS v(ord, bucket, rows, owners)
 ORDER BY v.ord;

COMMENT ON VIEW public.v_lcc_seller_prospect_queue_summary IS
  'UX-T1a-queue funnel, single pass over the universe (PERF-SPQ2). Each count equals the rows a filter over the universe would show.';
