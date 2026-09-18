-- PERF-SPQ1-c -- one SQL pass for the seller-prospect-queue chip counts.
--
-- PERF-SPQ1 tried to buy speed by firing the 7 chip-count queries (plus the items
-- page and the funnel summary) CONCURRENTLY instead of sequentially. That does not
-- reduce how many full passes Postgres does over v_lcc_seller_prospect_queue --
-- v_lcc_seller_prospect_queue is itself a stack of CTEs over lcc_entity_portfolio_facts
-- with regex owner-name guards and an EXISTS join to activity_events, so each pass is
-- real work (~0.9s alone per PERF-SPQ1-c's filed prompt). Nine of those at once on one
-- Postgres connection pool contend with EACH OTHER, and the one that matters -- the
-- items page -- is the one that starves and aborts. PERF-SPQ1-b changed the shape of
-- the resulting error (500 -> 502) without changing that outcome.
--
-- The actual fix: compute every chip's count in ONE query, with ONE materialization of
-- the queue (a CTE) and count(*) FILTER (WHERE ...) per chip -- Postgres does not
-- re-scan the CTE per filter. That is 7 aggregate passes replaced by 1 view-scan pass.
-- Read `api/_shared/seller-prospect-queue.js` `SELLER_QUEUE_CHIPS` for the predicate
-- vocabulary this mirrors -- this migration is the SQL side of that same list, so
-- adding a chip means adding both a JS predicate string AND a row here (no automatic
-- sync; there is no third place either could drift to).
--
-- Domain filter matches `normalizeDomain()` in the JS module: null/absent means no
-- filter, else 'dia' or 'gov' exactly.
--
-- STABLE + SECURITY INVOKER: this is a read over an already-invoker view; no elevated
-- privilege is introduced (mirrors the view's own GRANT).
--
-- Reverse: DROP FUNCTION public.lcc_seller_prospect_chip_counts(text);

CREATE OR REPLACE FUNCTION public.lcc_seller_prospect_chip_counts(p_domain text DEFAULT NULL)
RETURNS TABLE(chip_key text, chip_label text, n bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH q AS (
    SELECT *
      FROM public.v_lcc_seller_prospect_queue
     WHERE p_domain IS NULL OR source_domain = p_domain
  ),
  agg AS (
    SELECT
      count(*) AS all_n,
      count(*) FILTER (WHERE newer_lease IS TRUE) AS newer_lease_n,
      count(*) FILTER (WHERE reason_debt) AS debt_n,
      count(*) FILTER (WHERE reason_value_creation_developer) AS developer_n,
      count(*) FILTER (WHERE reach_state = 'no_linked_person') AS no_linked_person_n,
      count(*) FILTER (WHERE reach_state = 'never_touched') AS never_touched_n,
      count(*) FILTER (WHERE reach_state = 'in_pipeline_untouched') AS in_pipeline_untouched_n
      FROM q
  )
  SELECT 'all',                   'All',                          all_n                   FROM agg
  UNION ALL SELECT 'newer_lease', 'Newer lease',                  newer_lease_n            FROM agg
  UNION ALL SELECT 'debt',        'Debt maturing',                debt_n                   FROM agg
  UNION ALL SELECT 'developer',   'Developer',                    developer_n              FROM agg
  UNION ALL SELECT 'no_linked_person', 'No contact linked',       no_linked_person_n       FROM agg
  UNION ALL SELECT 'never_touched', 'Never touched',              never_touched_n          FROM agg
  UNION ALL SELECT 'in_pipeline_untouched', 'In pipeline, untouched', in_pipeline_untouched_n FROM agg;
$$;

COMMENT ON FUNCTION public.lcc_seller_prospect_chip_counts(text) IS
  'PERF-SPQ1-c: every seller-prospect-queue chip''s exact count from ONE pass over '
  'v_lcc_seller_prospect_queue (a CTE + count(*) FILTER per chip), replacing 7 '
  'independent count=exact reads that were contending with the items page for the '
  'same view. Predicate list mirrors SELLER_QUEUE_CHIPS in '
  'api/_shared/seller-prospect-queue.js -- keep both in sync by hand.';

GRANT EXECUTE ON FUNCTION public.lcc_seller_prospect_chip_counts(text) TO authenticated, service_role;
