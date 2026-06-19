-- ============================================================================
-- NEXT-BEST-TOUCHPOINT #1 — Slice 1a: the ranking view (read-only)
-- ----------------------------------------------------------------------------
-- Scott does outreach against his REAL Salesforce book + the value-ranked owner
-- graph, but the cadence engine was pointed at 520 cold auto-generated
-- prospects he never contacts. This view is the surface that answers "who is the
-- next biggest-value touchpoint", seeded from his book ∩ the owner graph.
--
-- SEED (one row per entity):
--   (a) SF-linked OWNERS — an entity that carries BOTH a Salesforce Account
--       identity (external_identities source_system='salesforce',
--       source_type='Account') AND a true_owner bridge identity
--       (source_type='true_owner'). The true_owner filter is load-bearing:
--       grounded live 2026-06-19, the highest raw connected-value SF accounts
--       are TENANTS / agencies (GSA $211M, DOJ, CBP, USPS-as-tenant) because
--       connected value counts `leases` edges; the true_owner filter strips
--       that tenant/agency noise and leaves the genuine owners (CoreCivic, RMR,
--       Blackstone, Boyd Watterson, Easterly, GPI Trust, Massmutual …).
--   (b) Open BD-opportunity accounts — UNION'd in so an entity Scott is already
--       actively pursuing is always present even if not (yet) an SF-linked owner.
--
-- RANK (rank_value): REUSES the EXACT R34 / priority-queue value chain — the
--   portfolio rollup (v_entity_portfolio_all.current_annual_rent_total, unique
--   per entity) then the R17 connected-property value
--   (lcc_entity_connected_value, PK per entity). NOT a new metric, and NOT
--   joined off v_priority_queue_enriched (which only covers entities already in
--   the queue — 32 of the seed — and carries duplicate entity_ids). NULLS LAST
--   keeps genuinely value-less accounts at the bottom (no faked rank).
--
-- last_touch_at: the cadence's last_touch_at when a cadence exists, else the
--   latest Salesforce activity_event for the entity (sparse today — the SF sync
--   does not yet pull Activities; that is Phase 2). days_since_touch derived.
--
-- has_open_opportunity / priority_band are informational (LEFT JOINs).
--
-- READ-ONLY, additive, security_invoker, cache-or-live safe. LCC Opps only;
-- nothing here touches the auth schema, dia/gov, or any write path.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_next_best_touchpoint
WITH (security_invoker = true) AS
WITH sf_account AS (
  -- one SF Account id per entity (deterministic pick)
  SELECT DISTINCT ON (entity_id)
         entity_id,
         external_id AS sf_account_id
  FROM public.external_identities
  WHERE source_system = 'salesforce'
    AND source_type   = 'Account'
  ORDER BY entity_id, created_at DESC NULLS LAST, id DESC
),
seed AS (
  -- (a) SF-linked owners: SF Account identity AND a true_owner bridge identity
  SELECT sa.entity_id, sa.sf_account_id
  FROM sf_account sa
  WHERE EXISTS (
    SELECT 1 FROM public.external_identities b
    WHERE b.entity_id = sa.entity_id
      AND b.source_type = 'true_owner'
  )
  UNION
  -- (b) open BD-opportunity accounts (resolve the SF id when present)
  SELECT bo.entity_id, sa.sf_account_id
  FROM public.bd_opportunities bo
  LEFT JOIN sf_account sa ON sa.entity_id = bo.entity_id
  WHERE bo.closed_at IS NULL
    AND bo.entity_id IS NOT NULL
),
seed1 AS (
  -- one row per entity (fanout-proof)
  SELECT entity_id, max(sf_account_id) AS sf_account_id
  FROM seed
  GROUP BY entity_id
),
open_opp AS (
  SELECT DISTINCT entity_id
  FROM public.bd_opportunities
  WHERE closed_at IS NULL AND entity_id IS NOT NULL
),
pq AS (
  SELECT DISTINCT ON (entity_id) entity_id, priority_band
  FROM public.lcc_priority_queue_resolved
  ORDER BY entity_id, priority_band
),
lt AS (
  -- last touch: cadence last_touch_at first, else latest SF activity_event
  SELECT s.entity_id,
         COALESCE(
           (SELECT max(c.last_touch_at)
              FROM public.touchpoint_cadence c
             WHERE c.entity_id = s.entity_id),
           (SELECT max(a.occurred_at)
              FROM public.activity_events a
             WHERE a.entity_id = s.entity_id
               AND a.source_type = 'salesforce')
         ) AS last_touch_at
  FROM seed1 s
)
SELECT
  e.id                                              AS entity_id,
  e.name,
  e.entity_type,
  e.workspace_id,
  s.sf_account_id,
  -- R34 / priority-queue value chain (portfolio rollup → R17 connected value)
  COALESCE(NULLIF(pa.current_annual_rent_total, 0::numeric),
           cv.connected_property_value)             AS rank_value,
  CASE
    WHEN COALESCE(pa.current_annual_rent_total, 0::numeric) > 0
      THEN pa.current_property_count
    ELSE cv.connected_property_count
  END                                               AS rank_property_count,
  lt.last_touch_at,
  CASE
    WHEN lt.last_touch_at IS NULL THEN NULL
    ELSE EXTRACT(day FROM now() - lt.last_touch_at)::int
  END                                               AS days_since_touch,
  (oo.entity_id IS NOT NULL)                        AS has_open_opportunity,
  pq.priority_band
FROM seed1 s
JOIN public.entities e
  ON e.id = s.entity_id
 AND e.merged_into_entity_id IS NULL
LEFT JOIN public.v_entity_portfolio_all pa ON pa.entity_id = e.id
LEFT JOIN public.lcc_entity_connected_value cv ON cv.entity_id = e.id
LEFT JOIN lt ON lt.entity_id = e.id
LEFT JOIN open_opp oo ON oo.entity_id = e.id
LEFT JOIN pq ON pq.entity_id = e.id
ORDER BY rank_value DESC NULLS LAST, lt.last_touch_at ASC NULLS FIRST;

GRANT SELECT ON public.v_next_best_touchpoint TO authenticated;

COMMENT ON VIEW public.v_next_best_touchpoint IS
  'NBT Slice 1a: one row per Scott-relevant account (SF-linked owners ∪ open '
  'BD-opportunity accounts), value-ranked by rank_value (R34/priority-queue '
  'chain: portfolio rollup → R17 connected value, NULLS LAST). Carries '
  'sf_account_id, last_touch_at (cadence, else latest SF activity), '
  'days_since_touch, has_open_opportunity, priority_band. Read-only — the '
  '"next biggest value touchpoint" surface.';
