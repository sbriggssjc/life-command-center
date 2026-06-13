-- ============================================================================
-- R17 — value-rank the connect-the-data work (P0.4 + P-CONTACT)
-- ----------------------------------------------------------------------------
-- The priority queue already guides the operator to the right KIND of work
-- (connect-the-data vs next-touch), and the touch bands (P1-P8, P-BUYER) are
-- value-ranked via rank_annual_rent (R11 + R14). But the two big CONNECT bands
-- were NOT value-ranked:
--   * P0.4 (resolve ownership)        — 543 rows, 59% rank-zero
--   * P-CONTACT (select prospecting    — 316 rows, 99% rank-zero
--     contact)
-- Connect-work is ~87% of all surfaced work, so the larger half of "guide where
-- to spend time" was sorting NULLS-LAST (noise) — a user could burn research
-- time connecting a worthless owner while a high-value one waits.
--
-- WHY it's fixable: these rank-zero connect entities lack an
-- lcc_entity_portfolio_facts edge (so rank_annual_rent is null — no rollup, no
-- representative property), but many DO carry owns / purchases / leases edges in
-- entity_relationships to ASSET entities, and those assets have value in
-- lcc_property_attributes (annual_rent, fallback noi). The value exists; it was
-- just never joined into the connect-band rank.
--
-- THE FALLBACK: for the connect bands only, add a relationship-graph fallback
-- tier to rank_annual_rent's COALESCE chain (R11/R14):
--   rollup rent -> representative-property rent -> CONNECTED-property value
--   -> P-BUYER SPE rollup -> NULLS LAST
-- "Connected-property value" = SUM over the DISTINCT domain properties the
-- entity controls via owns/purchases/leases edges (owner = from_entity, asset =
-- to_entity; verified live 2026-06-13) of COALESCE(NULLIF(annual_rent,0), noi).
-- brokers/sells/finances are EXCLUDED (past/agency edges, not control).
--
-- BOUNDING THE COST (the one new cost — mirror the portfolio join's bound):
-- the aggregation walks ~45k owns/purchases/leases edges -> external_identities
-- (asset) -> lcc_property_attributes; standalone ~270ms. Adding that live to
-- every items-page enriched read (ordered by rank_annual_rent, LIMIT 150) would
-- blow the budget. So it is MATERIALIZED into a small cron-refreshed cache table
-- (lcc_entity_connected_value, ~3k rows) and the enriched view hash-joins it
-- cheaply — exactly the R7 caching doctrine and the way lcc_property_attributes
-- bounds the representative-property join.
--
-- SAFE BY CONSTRUCTION: an EMPTY cache => connected_property_value is NULL for
-- every row => the COALESCE tier is inert => byte-identical pre-R17 behavior
-- (connect rows sort NULLS-LAST). So DB-vs-Railway deploy order is irrelevant
-- and a stalled cron only ever costs ranking quality, never correctness. The
-- cv join is GATED on priority_band IN ('P0.4','P-CONTACT'), so the touch bands
-- (P1-P8, P-BUYER) and P0.5 are byte-identical — their rank cannot change.
--
-- DB-safety: additive (one ~3k-row table, one STABLE-ish refresh fn, one cron)
-- + a CREATE OR REPLACE VIEW that appends two columns at the END (append-only
-- rule) and extends one existing expression. No table rewrites, no locks on
-- auth/GoTrue/public.users, bounded-size work, ANALYZE baked into the refresh.
--
-- JS (admin.js select + ops.js card context) ships on the Railway redeploy; the
-- ORDER BY already keys on rank_annual_rent, so ordering improves with ZERO JS
-- change the moment this migration lands.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Cache table — one row per entity that controls at least one valued
--    property via an ownership/control edge. Tiny (~3k rows); fully replaced
--    each refresh tick (DELETE+INSERT), so fire autovacuum on absolute
--    dead-tuple count, not a scale factor of a tiny table (R7 lesson).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lcc_entity_connected_value (
  entity_id                uuid PRIMARY KEY,
  connected_property_value numeric,
  connected_property_count integer,
  refreshed_at             timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.lcc_entity_connected_value IS
  'R17: per-entity SUM of controlled-property value (annual_rent, fallback noi) '
  'over DISTINCT properties reached via owns/purchases/leases edges. Fallback '
  'rank tier for the P0.4 / P-CONTACT connect bands. Empty => pre-R17 behavior.';

ALTER TABLE public.lcc_entity_connected_value SET (
  autovacuum_vacuum_scale_factor  = 0.0, autovacuum_vacuum_threshold  = 500,
  autovacuum_analyze_scale_factor = 0.0, autovacuum_analyze_threshold = 500);

-- ---------------------------------------------------------------------------
-- 2. Refresh function — snapshot the relationship-graph aggregation, swap,
--    ANALYZE. SECURITY DEFINER (reads entity_relationships / external_identities
--    / lcc_property_attributes). DELETE+INSERT in one tx so concurrent readers
--    never observe an empty cache mid-refresh (= never a transient rank drop).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_refresh_entity_connected_value()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_n integer;
BEGIN
  DELETE FROM public.lcc_entity_connected_value;
  INSERT INTO public.lcc_entity_connected_value
    (entity_id, connected_property_value, connected_property_count, refreshed_at)
  SELECT d.entity_id,
         COALESCE(SUM(pv.val), 0::numeric) AS connected_property_value,
         COUNT(*)                          AS connected_property_count,
         now()
  FROM (
    -- DISTINCT controlled property per entity, so multiple edges (owns +
    -- purchases) to the same asset are counted once. owner = from_entity,
    -- asset = to_entity (verified live 2026-06-13).
    SELECT DISTINCT er.from_entity_id AS entity_id,
           ei.source_system           AS source_domain,
           ei.external_id             AS source_property_id
    FROM public.entity_relationships er
    JOIN public.external_identities ei
      ON ei.entity_id = er.to_entity_id
     AND ei.source_type = 'asset'::text
    WHERE er.relationship_type = ANY (ARRAY['owns'::text, 'purchases'::text, 'leases'::text])
  ) d
  JOIN LATERAL (
    SELECT COALESCE(NULLIF(pa.annual_rent, 0::numeric), pa.noi) AS val
    FROM public.lcc_property_attributes pa
    WHERE pa.source_domain = d.source_domain
      AND pa.source_property_id = d.source_property_id
  ) pv ON pv.val IS NOT NULL
  GROUP BY d.entity_id;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  ANALYZE public.lcc_entity_connected_value;
  RETURN v_n;
END;
$fn$;

REVOKE ALL ON FUNCTION public.lcc_refresh_entity_connected_value() FROM PUBLIC;

-- 3. Populate now so the rank is value-ranked immediately on apply.
SELECT public.lcc_refresh_entity_connected_value();

-- ---------------------------------------------------------------------------
-- 4. Gentle cron — connected value is a slow-moving signal (asset edges change
--    on capture; property attributes sync daily). Hourly is ample; the connect
--    bands are a worklist, not a real-time surface. A band-moving CONNECT verdict
--    (attach a person/contact) moves the row OUT of P0.4/P-CONTACT regardless,
--    so this cache does not need the */5 queue cadence.
-- ---------------------------------------------------------------------------
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-entity-connected-value-refresh') THEN
    PERFORM cron.unschedule('lcc-entity-connected-value-refresh');
  END IF;
  PERFORM cron.schedule(
    'lcc-entity-connected-value-refresh',
    '17 * * * *',
    $job$SELECT public.lcc_refresh_entity_connected_value();$job$
  );
END
$cron$;

-- ---------------------------------------------------------------------------
-- 5. v_priority_queue_enriched — join the cache (GATED on the two connect
--    bands), extend rank_annual_rent's COALESCE with the connected-value tier
--    (AFTER representative-property rent), and append connected_property_value /
--    connected_property_count at the END (append-only rule). Every other column
--    and every other join is byte-identical to the R14 definition.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_priority_queue_enriched AS
 SELECT q.entity_id,
    q.name,
    q.workspace_id,
        CASE q.vertical
            WHEN 'dialysis'::text THEN 'dia'::text
            WHEN 'government'::text THEN 'gov'::text
            ELSE q.vertical
        END AS vertical,
    q.owner_user_id,
    q.contact_id,
    q.bd_opportunity_id,
    q.priority_band,
    q.reason,
    q.next_touch_due,
    q.days_overdue,
    q.last_touch_at,
    q.last_touch_type,
    q.effective_owner_role,
    q.owner_role_confidence,
    COALESCE(p.total_property_count, 0::bigint) AS total_property_count,
    COALESCE(p.current_property_count, 0::bigint) AS current_property_count,
    COALESCE(p.dia_property_count, 0::bigint) AS dia_property_count,
    COALESCE(p.gov_property_count, 0::bigint) AS gov_property_count,
    COALESCE(p.is_cross_vertical, false) AS is_cross_vertical,
    p.earliest_acquisition_date,
    p.latest_acquisition_date,
    p.latest_disposition_date,
    COALESCE(p.current_annual_rent_total, 0::numeric) AS current_annual_rent_total,
    p.avg_cap_rate,
        CASE q.source_domain
            WHEN 'dialysis'::text THEN 'dia'::text
            WHEN 'government'::text THEN 'gov'::text
            ELSE q.source_domain
        END AS source_domain,
    q.source_property_id,
    pa.address AS source_property_address,
    pa.city AS source_property_city,
    pa.state AS source_property_state,
    pa.lease_expiration AS source_property_lease_expiration,
    pa.firm_term_remaining AS source_property_firm_term_remaining,
    pa.term_remaining AS source_property_term_remaining,
    br.spe_count AS buyer_spe_count,
    br.rollup_property_count AS buyer_rollup_property_count,
    br.rollup_annual_rent AS buyer_rollup_annual_rent,
    br.last_acquisition_date AS buyer_last_acquisition_date,
    br.sf_account_id AS buyer_sf_account_id,
    br.needs_sf_mapping AS buyer_needs_sf_mapping,
    rs.resolve_reason,
    rs.true_owner_name AS resolve_true_owner_name,
    rs.is_connected AS resolve_is_connected,
    pa.annual_rent AS source_property_rent,
    pa.noi AS source_property_noi,
    -- R17: connected-property value is inserted as a fallback tier AFTER the
    -- representative-property rent and before the P-BUYER rollup. cv is NULL on
    -- non-connect bands (the join is gated), so this is inert for P1-P8/P-BUYER/
    -- P0.5 and rank_annual_rent stays byte-identical there.
    COALESCE(NULLIF(tr.trigger_rollup_annual_rent, 0::numeric), NULLIF(COALESCE(p.current_annual_rent_total, 0::numeric), 0::numeric), NULLIF(pa.annual_rent, 0::numeric), NULLIF(cv.connected_property_value, 0::numeric), NULLIF(br.rollup_annual_rent, 0::numeric)) AS rank_annual_rent,
    tr.trigger_property_count,
    tr.trigger_rollup_annual_rent,
        CASE q.priority_band
            WHEN 'P1'::text THEN
            CASE
                WHEN pa.lease_expiration IS NOT NULL THEN to_char(pa.lease_expiration::timestamp without time zone, 'Mon YYYY'::text)
                ELSE NULL::text
            END
            WHEN 'P3'::text THEN
            CASE
                WHEN pa.term_remaining IS NOT NULL THEN round(pa.term_remaining, 1)::text || ' yr term left'::text
                ELSE NULL::text
            END
            WHEN 'P5'::text THEN
            CASE
                WHEN pa.year_built IS NOT NULL THEN 'built '::text || pa.year_built::text
                ELSE NULL::text
            END
            WHEN 'P8'::text THEN
            CASE
                WHEN pa.sam_active_opportunities IS NOT NULL THEN (pa.sam_active_opportunities::text || ' active solicitation'::text) ||
                CASE
                    WHEN pa.sam_active_opportunities = 1 THEN ''::text
                    ELSE 's'::text
                END
                ELSE NULL::text
            END
            ELSE NULL::text
        END AS trigger_top_fact,
    -- R17 (appended): the connect-band fallback value + how many controlled
    -- properties it sums, so the card can show "$X across N connected properties".
    cv.connected_property_value,
    cv.connected_property_count
   FROM v_priority_queue q
     LEFT JOIN v_entity_portfolio_all p ON p.entity_id = q.entity_id
     LEFT JOIN lcc_property_attributes pa ON pa.source_domain = q.source_domain AND pa.source_property_id = q.source_property_id
     LEFT JOIN v_lcc_buyer_parent_rollup br ON q.priority_band = 'P-BUYER'::text AND br.parent_entity_id = q.entity_id
     LEFT JOIN v_lcc_trigger_band_rollup tr ON (q.priority_band = ANY (ARRAY['P1'::text, 'P3'::text, 'P5'::text, 'P8'::text])) AND tr.entity_id = q.entity_id AND tr.priority_band = q.priority_band AND tr.source_domain = q.source_domain
     LEFT JOIN lcc_entity_connected_value cv ON (q.priority_band = ANY (ARRAY['P0.4'::text, 'P-CONTACT'::text])) AND cv.entity_id = q.entity_id
     LEFT JOIN LATERAL ( SELECT tof.true_owner_name,
            conn.is_connected,
                CASE
                    WHEN conn.is_connected THEN 'connected'::text
                    WHEN tof.true_owner_name IS NOT NULL AND lower(tof.true_owner_name) <> lower(q.name) THEN 'true_owner_known_connect'::text
                    WHEN lcc_is_spe_shell_name(q.name) THEN 'recorded_owner_shell_true_owner_unresolved'::text
                    ELSE 'owner_known_connect'::text
                END AS resolve_reason
           FROM ( SELECT (EXISTS ( SELECT 1
                           FROM external_identities ei
                          WHERE ei.entity_id = q.entity_id AND ei.source_system = 'salesforce'::text)) OR (EXISTS ( SELECT 1
                           FROM entity_relationships er
                             JOIN entities pe ON pe.id = er.to_entity_id AND pe.entity_type = 'person'::entity_type
                          WHERE er.from_entity_id = q.entity_id)) OR (EXISTS ( SELECT 1
                           FROM entity_relationships er
                             JOIN entities pe ON pe.id = er.from_entity_id AND pe.entity_type = 'person'::entity_type
                          WHERE er.to_entity_id = q.entity_id)) AS is_connected) conn
             LEFT JOIN LATERAL ( SELECT pof.true_owner_name
                   FROM lcc_entity_portfolio_facts pf
                     JOIN lcc_property_owner_facts pof ON pof.source_domain = pf.source_domain AND pof.source_property_id = pf.source_property_id
                  WHERE pf.entity_id = q.entity_id AND pf.is_current = true
                  ORDER BY pf.ownership_start_date DESC NULLS LAST
                 LIMIT 1) tof ON true) rs ON true
  WHERE q.entity_id IS NOT NULL AND
        CASE q.vertical
            WHEN 'dialysis'::text THEN 'dia'::text
            WHEN 'government'::text THEN 'gov'::text
            ELSE q.vertical
        END IS NOT NULL;

GRANT SELECT ON public.v_priority_queue_enriched TO authenticated;

COMMIT;
