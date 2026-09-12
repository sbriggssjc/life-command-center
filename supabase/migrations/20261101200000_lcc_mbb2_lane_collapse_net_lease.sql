-- ============================================================================
-- lcc_mbb2_lane_collapse_net_lease — collapse the EB1 'net_lease' and
-- 'broad_net_lease' Market Brief swimlanes into a single 'net_lease' lane.
--
-- Why: EXEC-BRIEFS-SPEC.md originally scoped these as two distinct lanes,
-- but Scott (2026-09-12) called them redundant for his purposes and asked
-- for one. Verified via Supabase MCP immediately before this migration that
-- ZERO rows existed under either lane in market_brief_facts or
-- market_brief_issues (both producers are dialysis-only today — see EB1's
-- own comment "no new gov/NL lanes here" — so neither lane had ever emitted
-- a fact or a frozen issue). No data migration/backfill is needed: this is
-- a pure constraint + monitoring-view narrowing.
--
-- api/_shared/market-brief-render.js's KNOWN_LANES/LANE_LABELS and app.js's
-- MARKET_BRIEF_LANES/MARKET_BRIEF_LANE_LABELS were updated in the same PR to
-- match. Should 'broad_net_lease' data ever need reviving, re-widen the
-- CHECK constraints and re-add the lane to both app.js and
-- market-brief-render.js together — never one without the other (the
-- KNOWN_LANES-mirrors-chk_mbf_lane contract this migration preserves).
-- ============================================================================

-- 1. market_brief_facts.lane — drop + recreate chk_mbf_lane with 3 lanes.
ALTER TABLE public.market_brief_facts
  DROP CONSTRAINT IF EXISTS chk_mbf_lane;
ALTER TABLE public.market_brief_facts
  ADD CONSTRAINT chk_mbf_lane CHECK (lane IN ('dialysis', 'government', 'net_lease'));

-- 2. market_brief_issues.lane — same collapse.
ALTER TABLE public.market_brief_issues
  DROP CONSTRAINT IF EXISTS chk_mbi_lane;
ALTER TABLE public.market_brief_issues
  ADD CONSTRAINT chk_mbi_lane CHECK (lane IN ('dialysis', 'government', 'net_lease'));

-- 3. v_market_brief_staleness — identical to the EB1 definition except the
--    `lanes` CTE's unnest array is narrowed from 4 lanes to 3. Every other
--    column/join is untouched, so the XB audit (spec §5) keeps reading the
--    same shape.
CREATE OR REPLACE VIEW public.v_market_brief_staleness AS
WITH lanes AS (
  SELECT unnest(ARRAY['dialysis', 'government', 'net_lease']) AS lane
),
sections AS (
  SELECT unnest(ARRAY['operators', 'policy', 'capital_markets', 'implications', 'trades']) AS section
),
-- Every (lane, section) cell, so a section with ZERO facts reads as a named
-- "missing" row instead of being invisible to a GROUP BY (the Class-20
-- lesson: "a lane that has never emitted has no row to GROUP BY" — cross the
-- dimensions FIRST, then LEFT JOIN the facts).
cells AS (
  SELECT l.lane, s.section
  FROM lanes l
  CROSS JOIN sections s
),
fact_agg AS (
  SELECT
    f.lane,
    f.section,
    count(*) FILTER (WHERE f.status = 'live' AND (f.stale_after IS NULL OR f.stale_after > now())) AS live_count,
    count(*) FILTER (WHERE f.status = 'live' AND f.stale_after IS NOT NULL AND f.stale_after <= now()) AS stale_count,
    count(*) FILTER (WHERE f.status = 'superseded') AS superseded_count,
    count(*) FILTER (WHERE f.status = 'expired') AS expired_count,
    count(*) FILTER (WHERE f.status = 'conflict') AS conflict_count,
    max(f.fetched_at) FILTER (WHERE f.status = 'live') AS newest_live_fetched_at
  FROM public.market_brief_facts f
  GROUP BY f.lane, f.section
),
-- Latest producer run per lane, regardless of which section it touched — a
-- producer_run is not section-scoped (spec §2: P-SQL/P-RSS/P-WEB run per
-- lane, writing facts into whichever sections their pass covers).
last_run AS (
  SELECT DISTINCT ON (pr.lane)
    pr.lane,
    pr.producer          AS last_producer,
    pr.started_at         AS last_run_started_at,
    pr.finished_at         AS last_run_finished_at,
    pr.status             AS last_run_status,
    pr.skip_reason        AS last_run_skip_reason
  FROM public.producer_runs pr
  WHERE pr.lane IS NOT NULL
  ORDER BY pr.lane, pr.started_at DESC
)
SELECT
  c.lane,
  c.section,
  COALESCE(fa.live_count, 0)       AS live_count,
  COALESCE(fa.stale_count, 0)      AS stale_count,
  COALESCE(fa.superseded_count, 0) AS superseded_count,
  COALESCE(fa.expired_count, 0)    AS expired_count,
  COALESCE(fa.conflict_count, 0)   AS conflict_count,
  -- "missing" = this cell has NEVER had a live fact, ever (not "currently
  -- zero after everything expired" — that is stale/expired territory, a
  -- different, worse fact worth distinguishing on the audited surface).
  (COALESCE(fa.live_count, 0) = 0 AND COALESCE(fa.stale_count, 0) = 0
     AND COALESCE(fa.superseded_count, 0) = 0 AND COALESCE(fa.expired_count, 0) = 0
     AND COALESCE(fa.conflict_count, 0) = 0) AS is_missing,
  fa.newest_live_fetched_at,
  lr.last_producer,
  lr.last_run_started_at,
  lr.last_run_finished_at,
  lr.last_run_status,
  lr.last_run_skip_reason
FROM cells c
LEFT JOIN fact_agg fa ON fa.lane = c.lane AND fa.section = c.section
LEFT JOIN last_run lr ON lr.lane = c.lane;

COMMENT ON VIEW public.v_market_brief_staleness IS
  'EB1/MB-b2 — per (lane, section): live/stale/superseded/expired/conflict '
  'counts, whether the cell has NEVER had a fact (is_missing), and the last '
  'producer run for that lane. This is the instrument the XB audit (spec §5) '
  'reads to report decay. Lanes narrowed to dialysis/government/net_lease '
  '2026-09-12 (net_lease + broad_net_lease collapsed to one, per Scott) — '
  'CROSS JOINs every (lane, section) combination FIRST so a section that has '
  'never produced a fact is a visible row, not an absent one (Class 20).';
