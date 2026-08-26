-- ============================================================================
-- P175 — the portfolio sync must resolve a merged-away owner to its SURVIVOR
--        (2026-08-26). Applied live to LCC Opps (xengecqvemvfknjvbvrq).
--
-- ⚠️ A NEW DEFECT CLASS: NOT "the merge path missed a column" (P160/P167), BUT
--    "A PRODUCER RE-CREATES WHAT THE MERGE PATH CLEANED."
--
-- Found while auditing duplicates: 119 tombstones carried 198 live portfolio
-- facts totalling $71.8M of current annual rent. The merge path is NOT at
-- fault — lcc_reconcile_tombstone_backrefs dedup-deletes colliding facts and
-- repoints the rest, correctly. It moves them; the daily sync puts them back.
--
-- ROOT CAUSE, one line of lcc_finalize_entity_portfolios:
--
--     WHERE EXISTS (SELECT 1 FROM entities e WHERE e.id = aggregated.entity_id)
--
-- **A TOMBSTONE STILL EXISTS.** It is a row in `entities` carrying
-- merged_into_entity_id. The guard checks EXISTENCE, not LIVENESS, so it passes
-- for every ghost. Same shape as the playbook's "a guard checks the label, not
-- the substance."
--
-- And entity_id arrives as the DOMAIN's `true_owner_id`. The domain DBs know
-- nothing about LCC merges, so every sync re-sends the pre-merge id and the
-- finalizer resurrects it. Evidence it is a LIVE tap, not history: all 8
-- (domain, ownership_source) groups carried updated_at = TODAY.
--
-- ⚠️ THE FIX MUST RESOLVE **BEFORE** THE GROUP BY, AND THAT IS NOT COSMETIC.
-- Two pre-merge ids that collapse to one survivor would otherwise arrive as two
-- rows with the same (entity_id, source_domain, source_property_id) inside one
-- INSERT, which Postgres rejects: "ON CONFLICT DO UPDATE command cannot affect
-- row a second time." Resolving in `normalized`/`with_window` makes them
-- aggregate together instead of colliding.
--
-- BOTH BRANCHES ARE PATCHED (dia and gov) — a fix applied to one leg of a
-- two-leg tick is the P118 lesson.
--
-- The liveness guard is kept as well as the resolve (belt and braces):
-- lcc_entity_survivor is PASS-THROUGH for an unknown uuid, so an id that names
-- nothing real still needs the EXISTS gate, and a genuine merge cycle (which
-- lcc_entity_survivor refuses, returning the input) must be skipped rather than
-- resurrected.
--
-- Verified on all 92 then-live ghosts: 92 resolve to a LIVE entity, 0 refusals,
-- 0 cycles.
--
-- ⚠️ NOT PATCHED, DELIBERATELY: lcc_sync_property_owner_to_portfolio (the P117
-- feeder) carries the identical defect but has no cron, no SQL caller and no
-- app caller (grep: migrations and docs only). Attribution confirms it is not
-- the producer here — every ghost fact carried a DOMAIN ownership_source
-- (gsa_lease_diff 32, sales_transaction, county_records, …). Left alone and
-- recorded in the audit list rather than changed on suspicion.
--
-- VERIFICATION GATE:
--   -- after the next lcc-portfolio-sync-finalize run:
--   select count(*) from lcc_entity_portfolio_facts f join entities e on e.id=f.entity_id
--    where e.merged_into_entity_id is not null;   -- must not grow past the 12 held conflicts
--
-- REVERSAL: restore the prior function body (the only changes are the two
--   COALESCE(lcc_entity_survivor(...)) wrappers and the two liveness guards).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_finalize_entity_portfolios()
 RETURNS TABLE(domain text, finalized_requests integer, edges_upserted integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_finalized int;
  v_upserted int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.lcc_portfolio_sync_inflight WHERE source_domain = 'dia') THEN
    WITH consumed AS (
      SELECT i.request_id, r.content
      FROM public.lcc_portfolio_sync_inflight i
      JOIN net._http_response r ON r.id = i.request_id
      WHERE i.source_domain = 'dia' AND r.status_code = 200
    ),
    rows AS (
      SELECT jsonb_array_elements(content::jsonb) AS row FROM consumed
    ),
    normalized AS (
      SELECT
        -- P175: the domain DB does not know about LCC merges, so it keeps
        -- sending the pre-merge owner id. Resolve it HERE, before GROUP BY, so
        -- two ids collapsing to one survivor aggregate together instead of
        -- colliding inside the INSERT ("cannot affect row a second time").
        COALESCE(public.lcc_entity_survivor((row->>'true_owner_id')::uuid),
                 (row->>'true_owner_id')::uuid) AS entity_id,
        'dia'::text AS source_domain,
        (row->>'property_id')::text AS source_property_id,
        NULLIF(row->>'transfer_date','')::date       AS owner_start,
        NULLIF(row->>'ownership_end_date','')::date  AS owner_end,
        NULLIF(row->>'annual_rent','')::numeric AS annual_rent,
        NULLIF(row->>'sale_price','')::numeric  AS sale_price,
        NULLIF(row->>'cap_rate','')::numeric    AS cap_rate,
        row->>'data_source' AS ownership_source
      FROM rows
      WHERE row->>'true_owner_id' IS NOT NULL
        AND row->>'property_id' IS NOT NULL
    ),
    aggregated AS (
      SELECT
        entity_id, source_domain, source_property_id,
        MIN(owner_start) AS owner_start,
        CASE WHEN bool_or(owner_end IS NULL) THEN NULL ELSE MAX(owner_end) END AS owner_end,
        AVG(annual_rent) FILTER (WHERE annual_rent IS NOT NULL) AS annual_rent,
        MAX(sale_price)  AS sale_price,
        AVG(cap_rate) FILTER (WHERE cap_rate IS NOT NULL) AS cap_rate,
        MAX(ownership_source) AS ownership_source
      FROM normalized
      GROUP BY entity_id, source_domain, source_property_id
    ),
    upsert AS (
      INSERT INTO public.lcc_entity_portfolio_facts (
        entity_id, source_domain, source_property_id,
        ownership_start_date, ownership_end_date,
        annual_rent, sale_price, cap_rate, ownership_source, updated_at
      )
      SELECT entity_id, source_domain, source_property_id,
             owner_start, owner_end, annual_rent, sale_price, cap_rate,
             ownership_source, now()
      FROM aggregated
      -- P175: EXISTS alone passes for a TOMBSTONE (it is still a row in
      -- entities). Require liveness, so an unresolvable id is skipped rather
      -- than resurrected.
      WHERE EXISTS (SELECT 1 FROM public.entities e
                     WHERE e.id = aggregated.entity_id
                       AND e.merged_into_entity_id IS NULL)
      ON CONFLICT (entity_id, source_domain, source_property_id) DO UPDATE SET
        ownership_start_date = LEAST(EXCLUDED.ownership_start_date, public.lcc_entity_portfolio_facts.ownership_start_date),
        ownership_end_date = EXCLUDED.ownership_end_date,
        annual_rent = COALESCE(EXCLUDED.annual_rent, public.lcc_entity_portfolio_facts.annual_rent),
        sale_price = COALESCE(EXCLUDED.sale_price, public.lcc_entity_portfolio_facts.sale_price),
        cap_rate = COALESCE(EXCLUDED.cap_rate, public.lcc_entity_portfolio_facts.cap_rate),
        ownership_source = COALESCE(EXCLUDED.ownership_source, public.lcc_entity_portfolio_facts.ownership_source),
        updated_at = now()
      RETURNING 1
    ),
    cleanup AS (
      DELETE FROM public.lcc_portfolio_sync_inflight
      WHERE request_id IN (SELECT request_id FROM consumed)
      RETURNING 1
    )
    SELECT (SELECT COUNT(*) FROM consumed), (SELECT COUNT(*) FROM upsert)
    INTO v_finalized, v_upserted;

    domain := 'dia';
    finalized_requests := v_finalized;
    edges_upserted := v_upserted;
    RETURN NEXT;
  END IF;

  IF EXISTS (SELECT 1 FROM public.lcc_portfolio_sync_inflight WHERE source_domain = 'gov') THEN
    WITH consumed AS (
      SELECT i.request_id, r.content
      FROM public.lcc_portfolio_sync_inflight i
      JOIN net._http_response r ON r.id = i.request_id
      WHERE i.source_domain = 'gov' AND r.status_code = 200
    ),
    rows AS (
      SELECT jsonb_array_elements(content::jsonb) AS row FROM consumed
    ),
    with_window AS (
      SELECT
        COALESCE(public.lcc_entity_survivor((row->>'true_owner_id')::uuid),
                 (row->>'true_owner_id')::uuid) AS entity_id,
        'gov'::text AS source_domain,
        (row->>'property_id')::text AS source_property_id,
        (row->>'transfer_date')::date AS transfer_date,
        NULLIF(row->>'annual_rent','')::numeric AS annual_rent,
        NULLIF(row->>'sale_price','')::numeric  AS sale_price,
        NULLIF(row->>'cap_rate','')::numeric    AS cap_rate,
        row->>'data_source' AS ownership_source,
        MAX((row->>'transfer_date')::date) OVER (PARTITION BY (row->>'property_id')::text) AS latest_property_transfer
      FROM rows
      WHERE row->>'true_owner_id' IS NOT NULL
        AND row->>'property_id' IS NOT NULL
    ),
    normalized AS (
      SELECT
        entity_id, source_domain, source_property_id,
        MIN(transfer_date) AS owner_start,
        CASE WHEN MAX(transfer_date) = MAX(latest_property_transfer) THEN NULL
             ELSE MAX(latest_property_transfer) END AS owner_end,
        AVG(annual_rent) FILTER (WHERE annual_rent IS NOT NULL) AS annual_rent,
        MAX(sale_price)  AS sale_price,
        AVG(cap_rate) FILTER (WHERE cap_rate IS NOT NULL) AS cap_rate,
        MAX(ownership_source) AS ownership_source
      FROM with_window
      GROUP BY entity_id, source_domain, source_property_id
    ),
    upsert AS (
      INSERT INTO public.lcc_entity_portfolio_facts (
        entity_id, source_domain, source_property_id,
        ownership_start_date, ownership_end_date,
        annual_rent, sale_price, cap_rate, ownership_source, updated_at
      )
      SELECT entity_id, source_domain, source_property_id,
             owner_start, owner_end, annual_rent, sale_price, cap_rate,
             ownership_source, now()
      FROM normalized
      WHERE EXISTS (SELECT 1 FROM public.entities e
                     WHERE e.id = normalized.entity_id
                       AND e.merged_into_entity_id IS NULL)
      ON CONFLICT (entity_id, source_domain, source_property_id) DO UPDATE SET
        ownership_start_date = LEAST(EXCLUDED.ownership_start_date, public.lcc_entity_portfolio_facts.ownership_start_date),
        ownership_end_date = EXCLUDED.ownership_end_date,
        annual_rent = COALESCE(EXCLUDED.annual_rent, public.lcc_entity_portfolio_facts.annual_rent),
        sale_price = COALESCE(EXCLUDED.sale_price, public.lcc_entity_portfolio_facts.sale_price),
        cap_rate = COALESCE(EXCLUDED.cap_rate, public.lcc_entity_portfolio_facts.cap_rate),
        ownership_source = COALESCE(EXCLUDED.ownership_source, public.lcc_entity_portfolio_facts.ownership_source),
        updated_at = now()
      RETURNING 1
    ),
    cleanup AS (
      DELETE FROM public.lcc_portfolio_sync_inflight
      WHERE request_id IN (SELECT request_id FROM consumed)
      RETURNING 1
    )
    SELECT (SELECT COUNT(*) FROM consumed), (SELECT COUNT(*) FROM upsert)
    INTO v_finalized, v_upserted;

    domain := 'gov';
    finalized_requests := v_finalized;
    edges_upserted := v_upserted;
    RETURN NEXT;
  END IF;

  DELETE FROM public.lcc_portfolio_sync_inflight
  WHERE issued_at < NOW() - interval '24 hours';
END;
$function$;
