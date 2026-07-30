-- ============================================================================
-- W2.4 — Unify mirror null semantics + listing-event retraction
--        (LCC Opps, xengecqvemvfknjvbvrq). Audit 3.3.6 + 3.3.9.
--
-- Two problems, one migration:
--
-- (3.3.6) The three cross-DB mirror legs each carry a DIFFERENT, UNDOCUMENTED
--   null model. Nothing stated the intended semantics, so a future edit could
--   silently flip one, and a fill-blanks leg could NEVER propagate a deliberate
--   operator field-CLEAR (the fill-blanks COALESCE re-preserves the stale value
--   forever). This migration DOCUMENTS the chosen model per leg AND adds the
--   missing "cleared-field tombstone" path to the fill-blanks leg.
--
--     | mirror table               | null model                | this migration |
--     |----------------------------|---------------------------|----------------|
--     | lcc_property_attributes    | FILL-BLANKS (COALESCE)    | + tombstone    |
--     | lcc_property_owner_facts   | LAST-WRITER-WINS incl NULL| doc only       |
--     | lcc_listing_events         | INSERT-ONLY               | + retraction   |
--
--   * FILL-BLANKS (lcc_property_attributes): a NULL from the source never
--     overwrites a curated mirror value — `col = COALESCE(EXCLUDED.col, old)`
--     (W2.3 lcc_apply_property_attributes_page). CORRECT for a mirror that
--     enriches from several partial sources. Its one gap: a field the operator
--     DELIBERATELY CLEARED in the domain (recorded W2.2 field_provenance
--     decision='cleared') stays null at the source but the mirror keeps the old
--     value forever. TOMBSTONE FIX below: when a mirror field's domain value is
--     null AND its latest field_provenance decision is 'cleared', clear the
--     mirror value too. (Under the W2.1 single-live-write invariant, a "latest
--     decision = cleared" key IS a currently-null domain field: a later refill
--     would have recorded a newer 'write' row, making 'cleared' no longer the
--     latest — so live-cleared ⟹ domain-null without re-fetching the source.)
--
--   * LAST-WRITER-WINS incl. NULL (lcc_property_owner_facts): the apply writes
--     straight `EXCLUDED.col` (recorded_owner_name / true_owner_name /
--     developer_name), so a source NULL DOES overwrite the mirror. This is the
--     INTENDED model — the owner-facts portfolio view is the single authority
--     for these three fields, so a cleared owner name must propagate as null.
--     The W2.3 stale-overwrite guard (source_updated_at) still prevents a late
--     out-of-order page regressing a newer row. No tombstone needed — nulls
--     already propagate. This migration only makes the model EXPLICIT in a
--     COMMENT ON FUNCTION so a future edit can't silently "fix" it to COALESCE.
--
--   * INSERT-ONLY (lcc_listing_events): ON CONFLICT DO NOTHING; a row, once
--     ingested, is never overwritten OR removed. Retraction (3.3.9) is the
--     removal path.
--
-- (3.3.9) lcc_listing_events is insert-only and live-GATED at pull time
--   (transaction_state='live'), but nothing RETRACTS an event whose source sale
--   LATER flips to non-live (duplicate_superseded / needs_review / hard-deleted).
--   The 2026-05-29 cleanup was a one-time manual DELETE (see
--   20260529200000_lcc_listing_events_live_gate_and_retract.sql). A stale event
--   keeps feeding the buyer-SPE classification (the empirical_portfolio tier of
--   v_lcc_buyer_spe_entities_live, the counterparty gate of
--   v_lcc_entity_tier0_parent, v_lcc_buyer_name_canonical) → the P-BUYER pool,
--   and shows in the operator queue (v_lcc_listing_event_queue). This migration
--   adds a REVERSIBLE, self-healing retraction as a recurring step in the
--   mirror-reconcile cron and EXCLUDES retracted events from all four consumers.
--
-- Discipline: additive · reversible (soft-mark + reversible logs, NEVER
-- hard-delete) · idempotent · dry-run-able · conservative (completeness +
-- anomaly guards before any state change). LCC-only (reads dia
-- sales_transactions + gov v_sales_transactions_portfolio via the existing anon
-- pg_net path — both already live-gated; no domain migration needed).
--
-- VERIFICATION (post-apply, see PR body): retraction backfill count + P-BUYER
-- pool size before/after.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. DOCUMENT the null model per mirror leg (audit 3.3.6). These COMMENTs are
--    the durable statement of intent the audit asked for — the enforcement for
--    each leg lives in its apply function, unchanged here except the tombstone.
-- ---------------------------------------------------------------------------
COMMENT ON FUNCTION public.lcc_apply_property_attributes_page(text, jsonb) IS
  'W2.3 apply for the lcc_property_attributes mirror. NULL MODEL = FILL-BLANKS '
  '(audit 3.3.6): every column is COALESCE(EXCLUDED.col, existing.col) so a '
  'source NULL never clobbers a curated mirror value; enriches from multiple '
  'partial sources. The one exception is the W2.4 cleared-field TOMBSTONE '
  '(lcc_apply_cleared_tombstones, a mirror-reconcile step): a field the operator '
  'deliberately cleared in the domain (field_provenance decision=cleared) is '
  'nulled in the mirror instead of preserved. Stale-overwrite guarded by '
  'source_updated_at.';

COMMENT ON FUNCTION public.lcc_apply_property_owner_facts_page(text, jsonb) IS
  'W2.3 apply for the lcc_property_owner_facts mirror. NULL MODEL = '
  'LAST-WRITER-WINS INCLUDING NULLS (audit 3.3.6): recorded_owner_name / '
  'true_owner_name / developer_name are written straight from EXCLUDED (NOT '
  'COALESCE), so a source NULL DOES overwrite the mirror — the owner-facts '
  'portfolio view is the single authority for these fields, so a cleared owner '
  'name must propagate as null. NO tombstone needed (nulls already propagate). '
  'Do NOT "fix" this to COALESCE — that would strand a cleared owner name. The '
  'W2.3 source_updated_at stale guard still blocks a late out-of-order regress.';

COMMENT ON FUNCTION public.lcc_apply_listing_events_page(text, jsonb) IS
  'W2.3 apply for the lcc_listing_events mirror. NULL MODEL = INSERT-ONLY '
  '(audit 3.3.6): ON CONFLICT DO NOTHING — a row is never overwritten. Removal '
  'is the W2.4 RETRACTION path (lcc_retract_listing_events_apply, a '
  'mirror-reconcile step): an event whose source sale flips to '
  'transaction_state<>live is soft-marked retracted_at (reversible, self-heals '
  'if it goes live again) and excluded from the buyer-SPE / P-BUYER classifiers '
  'and the operator queue.';

COMMENT ON TABLE public.lcc_property_attributes  IS
  'W2.3 cross-DB property-attribute mirror. NULL MODEL: FILL-BLANKS + W2.4 '
  'cleared-field tombstone (see lcc_apply_property_attributes_page comment).';
COMMENT ON TABLE public.lcc_property_owner_facts IS
  'W2.3 cross-DB owner-facts mirror. NULL MODEL: LAST-WRITER-WINS incl. NULL '
  '(see lcc_apply_property_owner_facts_page comment) — a cleared owner name '
  'propagates as null; do not COALESCE.';
COMMENT ON TABLE public.lcc_listing_events IS
  'W2.3 cross-DB sale-event feed (recency window). NULL MODEL: INSERT-ONLY + '
  'W2.4 retraction (retracted_at). Feeds the buyer-SPE / P-BUYER classifiers.';

-- ---------------------------------------------------------------------------
-- 2. v_field_provenance_live_cleared — the keys whose LATEST field_provenance
--    decision is 'cleared' (the W2.2 enum value). Sibling of
--    v_field_provenance_current (which surfaces only decision='write', so a
--    cleared field is invisible there); this surfaces the cleared keys the
--    tombstone consumes. SECURITY INVOKER (default).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_field_provenance_live_cleared AS
  SELECT t.target_database, t.target_table, t.record_pk_value, t.field_name,
         t.recorded_at, t.id
  FROM (
    SELECT DISTINCT ON (target_database, target_table, record_pk_value, field_name)
           target_database, target_table, record_pk_value, field_name,
           decision, recorded_at, id
    FROM public.field_provenance
    ORDER BY target_database, target_table, record_pk_value, field_name,
             recorded_at DESC, id DESC
  ) t
  WHERE t.decision = 'cleared';

COMMENT ON VIEW public.v_field_provenance_live_cleared IS
  'W2.4: (target_database, target_table, record_pk_value, field_name) whose '
  'MOST RECENT field_provenance decision is ''cleared'' (W2.2). Under the W2.1 '
  'single-live-write invariant a live-cleared key is a currently-null domain '
  'field (a refill would record a newer ''write''). Drives the '
  'lcc_property_attributes cleared-field tombstone.';

-- ---------------------------------------------------------------------------
-- 3. Cleared-field TOMBSTONE for the fill-blanks lcc_property_attributes mirror.
--    Reversible ledger + the sweep function. Runs as a mirror-reconcile step.
--
--    Mapping is restricted to 1:1 domain-field → mirror-column pairs (a domain
--    null unambiguously means the mirror should clear). Composite/renamed
--    derivations are DELIBERATELY excluded because a null in one source column
--    doesn't mean the mirror value is unbacked:
--      * building_type   = COALESCE(building_type, property_type)  — property_type may still back it
--      * tenant_label    ← operator (dia)  — not a curated 'properties' field
--      * latitude/longitude — geocoder-owned, not operator-cleared
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lcc_property_attributes_tombstone_log (
  id             bigserial PRIMARY KEY,
  source_domain  text NOT NULL,
  source_property_id text NOT NULL,
  mirror_column  text NOT NULL,
  old_value      text,                 -- the value cleared (for reversal/audit)
  provenance_field text NOT NULL,      -- the domain field_name whose 'cleared' triggered it
  cleared_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.lcc_property_attributes_tombstone_log IS
  'W2.4 reversible ledger of cleared-field tombstones applied to '
  'lcc_property_attributes. old_value is the mirror value that was nulled; '
  'reverse by writing it back where the domain re-fills (a later '
  'field_provenance ''write'' clears the live-cleared state automatically).';

CREATE OR REPLACE FUNCTION public.lcc_apply_cleared_tombstones(
  p_dry_run boolean DEFAULT true,
  p_domains text[] DEFAULT ARRAY['dia','gov']
) RETURNS TABLE(source_domain text, mirror_column text, cleared int)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_dom text; v_db text; map record; v_n int;
BEGIN
  -- Materialize the live-cleared keys for the property tables ONCE (the source
  -- view is a DISTINCT ON over the whole field_provenance table; the per-column
  -- loop below references it ~24×, so scan it a single time into a temp table
  -- keyed for a cheap join). Scoped to the two domains' 'properties' tables
  -- (both bare + schema-prefixed target_table conventions).
  CREATE TEMP TABLE IF NOT EXISTS _w24_cleared (
    target_database text, record_pk_value text, field_name text
  ) ON COMMIT DROP;
  TRUNCATE _w24_cleared;
  INSERT INTO _w24_cleared (target_database, record_pk_value, field_name)
  SELECT c.target_database, c.record_pk_value, c.field_name
  FROM public.v_field_provenance_live_cleared c
  WHERE c.target_database IN ('dia_db','gov_db')
    AND c.target_table IN ('properties','dia.properties','gov.properties');
  CREATE INDEX IF NOT EXISTS _w24_cleared_idx
    ON _w24_cleared (target_database, record_pk_value, field_name);

  FOREACH v_dom IN ARRAY p_domains LOOP
    v_db := CASE v_dom WHEN 'dia' THEN 'dia_db' WHEN 'gov' THEN 'gov_db' ELSE NULL END;
    IF v_db IS NULL THEN CONTINUE; END IF;

    -- (mirror_column, domain field_name(s) recorded in field_provenance)
    FOR map IN
      SELECT * FROM (VALUES
        -- shared 1:1 fields
        ('dia','address',            ARRAY['address']),
        ('dia','city',               ARRAY['city']),
        ('dia','state',              ARRAY['state']),
        ('dia','postal_code',        ARRAY['zip_code']),
        ('dia','county',             ARRAY['county']),
        ('dia','year_built',         ARRAY['year_built']),
        ('dia','year_renovated',     ARRAY['year_renovated']),
        ('dia','building_size_sqft', ARRAY['building_size']),
        ('dia','tenant_short',       ARRAY['tenant']),
        ('dia','annual_rent',        ARRAY['annual_rent']),
        ('dia','noi',                ARRAY['noi']),
        ('gov','address',            ARRAY['address']),
        ('gov','city',               ARRAY['city']),
        ('gov','state',              ARRAY['state']),
        ('gov','postal_code',        ARRAY['zip_code']),
        ('gov','county',             ARRAY['county']),
        ('gov','metro_area',         ARRAY['metro_area']),
        ('gov','year_built',         ARRAY['year_built']),
        ('gov','year_renovated',     ARRAY['year_renovated']),
        ('gov','land_acres',         ARRAY['land_acres']),
        ('gov','lease_commencement', ARRAY['lease_commencement']),
        ('gov','lease_expiration',   ARRAY['lease_expiration']),
        ('gov','noi',                ARRAY['noi']),
        ('gov','annual_rent',        ARRAY['annual_rent','gross_rent'])
      ) AS t(dom, mcol, fields)
      WHERE t.dom = v_dom
    LOOP
      -- Snapshot the values about to be cleared (reversibility), then null them.
      -- A tombstone fires only where the mirror still HOLDS a value AND a
      -- live-cleared provenance row exists for that pk + one of the domain
      -- fields (matching BOTH bare 'properties' and '<dom>.properties'
      -- target_table conventions seen in field_provenance).
      IF NOT p_dry_run THEN
        EXECUTE format($q$
          INSERT INTO public.lcc_property_attributes_tombstone_log
            (source_domain, source_property_id, mirror_column, old_value, provenance_field)
          SELECT m.source_domain, m.source_property_id, %L, m.%I::text, c.field_name
          FROM public.lcc_property_attributes m
          JOIN _w24_cleared c
            ON c.record_pk_value = m.source_property_id
           AND c.field_name = ANY (%L::text[])
           AND c.target_database = %L
          WHERE m.source_domain = %L
            AND m.%I IS NOT NULL
        $q$, map.mcol, map.mcol, map.fields, v_db, v_dom, map.mcol);
      END IF;

      EXECUTE format($q$
        WITH tomb AS (
          UPDATE public.lcc_property_attributes m
          SET %I = NULL, updated_at = now()
          WHERE m.source_domain = %L
            AND m.%I IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM _w24_cleared c
              WHERE c.record_pk_value = m.source_property_id
                AND c.field_name = ANY (%L::text[])
                AND c.target_database = %L)
            AND %L::boolean = false   -- only mutate on a real (non-dry-run) pass
          RETURNING 1)
        SELECT count(*) FROM tomb
      $q$, map.mcol, v_dom, map.mcol, map.fields, v_db, p_dry_run)
      INTO v_n;

      -- On a dry run, still REPORT what WOULD clear (count only, no mutation).
      IF p_dry_run THEN
        EXECUTE format($q$
          SELECT count(*) FROM public.lcc_property_attributes m
          WHERE m.source_domain = %L
            AND m.%I IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM _w24_cleared c
              WHERE c.record_pk_value = m.source_property_id
                AND c.field_name = ANY (%L::text[])
                AND c.target_database = %L)
        $q$, v_dom, map.mcol, map.fields, v_db)
        INTO v_n;
      END IF;

      IF v_n > 0 THEN
        source_domain := v_dom; mirror_column := map.mcol; cleared := v_n; RETURN NEXT;
      END IF;
    END LOOP;
  END LOOP;
END $fn$;
REVOKE ALL ON FUNCTION public.lcc_apply_cleared_tombstones(boolean, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lcc_apply_cleared_tombstones(boolean, text[]) TO service_role;

COMMENT ON FUNCTION public.lcc_apply_cleared_tombstones(boolean, text[]) IS
  'W2.4 cleared-field tombstone sweep for the FILL-BLANKS lcc_property_attributes '
  'mirror. Nulls a mirror column whose latest domain field_provenance decision is '
  '''cleared'' (v_field_provenance_live_cleared), so a deliberate operator field-'
  'clear finally propagates past COALESCE fill-blanks. Reversible '
  '(lcc_property_attributes_tombstone_log), idempotent, dry-run default. Runs as '
  'a mirror-reconcile step (lcc_mirror_reconcile_apply_all).';

-- ---------------------------------------------------------------------------
-- 4. lcc_listing_events RETRACTION — schema (soft-mark + reversible ledger +
--    a dedicated fetch inflight table, separate from the property-census
--    reconcile inflight so the working property prune is untouched).
-- ---------------------------------------------------------------------------
ALTER TABLE public.lcc_listing_events
  ADD COLUMN IF NOT EXISTS retracted_at     timestamptz,
  ADD COLUMN IF NOT EXISTS retracted_reason text;

COMMENT ON COLUMN public.lcc_listing_events.retracted_at IS
  'W2.4: non-null ⇒ the source sale is no longer transaction_state=live '
  '(flipped/deleted). Reversible (cleared if the sale goes live again). '
  'Retracted events are excluded from the buyer-SPE / P-BUYER classifiers and '
  'the operator queue.';

CREATE TABLE IF NOT EXISTS public.lcc_listing_events_retract_log (
  id             bigserial PRIMARY KEY,
  event_id       uuid NOT NULL,
  source_domain  text NOT NULL,
  source_event_id text NOT NULL,
  action         text NOT NULL CHECK (action IN ('retract','unretract')),
  reason         text,
  acted_at       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.lcc_listing_events_retract_log IS
  'W2.4 reversible audit of listing-event retract/unretract actions.';

CREATE TABLE IF NOT EXISTS public.lcc_listing_retract_inflight (
  request_id    bigint,
  source_domain text NOT NULL,
  page_offset   int  NOT NULL DEFAULT 0,
  page_size     int  NOT NULL DEFAULT 1000,
  issued_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.lcc_listing_retract_inflight IS
  'W2.4 pg_net inflight tracker for the live-sale-id census that drives listing '
  'retraction (separate from lcc_mirror_reconcile_inflight).';

-- ---------------------------------------------------------------------------
-- 5. Retraction fetch: fire the live-sale-id census per domain. dia gates on
--    transaction_state=live at the URL; gov's v_sales_transactions_portfolio is
--    live-gated at source. Windowed to sale_date >= now()-lookback (covers the
--    accumulated feed with margin; events older than the window are left as-is).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_retract_listing_events_fetch(
  p_domain text DEFAULT 'both',
  p_lookback_days int DEFAULT 550,
  p_max_pages int DEFAULT 8
) RETURNS TABLE(domain text, pages_fired int)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_url text; v_anon text; v_req bigint; v_page int; v_fired int;
  v_dom text; v_doms text[]; v_path text; v_floor text := to_char(CURRENT_DATE - p_lookback_days,'YYYY-MM-DD');
  v_page_size int := 1000;
BEGIN
  v_doms := CASE WHEN p_domain='both' THEN ARRAY['dia','gov'] ELSE ARRAY[p_domain] END;
  FOREACH v_dom IN ARRAY v_doms LOOP
    IF v_dom NOT IN ('dia','gov') THEN CONTINUE; END IF;
    SELECT decrypted_secret INTO v_url  FROM vault.decrypted_secrets WHERE name = v_dom||'_supabase_url';
    SELECT decrypted_secret INTO v_anon FROM vault.decrypted_secrets WHERE name = v_dom||'_supabase_anon_key';
    IF v_url IS NULL OR v_anon IS NULL THEN
      RAISE NOTICE 'lcc_retract_listing_events_fetch(%): missing vault secret, skipping', v_dom; CONTINUE;
    END IF;

    IF v_dom='dia' THEN
      v_path := '/rest/v1/sales_transactions?select=sale_id&transaction_state=eq.live';
    ELSE
      v_path := '/rest/v1/v_sales_transactions_portfolio?select=sale_id';
    END IF;

    v_fired := 0;
    FOR v_page IN 0..p_max_pages LOOP
      SELECT net.http_get(
        v_url || v_path || '&sale_date=gte.'||v_floor
          || '&order=sale_id.asc&limit='||v_page_size||'&offset='||(v_page*v_page_size),
        '{}'::jsonb,
        jsonb_build_object('apikey',v_anon,'Authorization','Bearer '||v_anon), 15000
      ) INTO v_req;
      INSERT INTO public.lcc_listing_retract_inflight (request_id, source_domain, page_offset, page_size)
      VALUES (v_req, v_dom, v_page*v_page_size, v_page_size);
      v_fired := v_fired + 1;
    END LOOP;
    domain := v_dom; pages_fired := v_fired; RETURN NEXT;
  END LOOP;
END $fn$;
REVOKE ALL ON FUNCTION public.lcc_retract_listing_events_fetch(text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lcc_retract_listing_events_fetch(text, int, int) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Retraction apply: assemble the live sale-id set (completeness-guarded),
--    then mark stale events retracted and un-retract any that went live again.
--    Conservative guards mirror the property reconcile: every fired page must
--    have returned 200, the tail page must be empty, and a minimum live-sales
--    floor + a max-retract fraction prevent a partial/empty fetch retracting the
--    whole window. Reversible (soft-mark + ledger, never delete).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_retract_listing_events_apply(
  p_dry_run boolean DEFAULT true,
  p_domains text[] DEFAULT ARRAY['dia','gov'],
  p_lookback_days int DEFAULT 550,
  p_min_live_sales int DEFAULT 10,
  p_max_retract_frac numeric DEFAULT 0.5
) RETURNS TABLE(domain text, in_window_events int, live_sales int,
                retracted int, unretracted int, status text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_dom text; v_fired int; v_responded int; v_tail_empty boolean;
  v_live int; v_events int; v_cand int; v_ret int; v_unret int;
  v_floor date := CURRENT_DATE - p_lookback_days;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _w24_live_sales (sale_id text PRIMARY KEY) ON COMMIT DROP;

  FOREACH v_dom IN ARRAY p_domains LOOP
    IF v_dom NOT IN ('dia','gov') THEN CONTINUE; END IF;

    SELECT count(*) INTO v_fired FROM public.lcc_listing_retract_inflight WHERE source_domain=v_dom;
    SELECT count(*) INTO v_responded FROM public.lcc_listing_retract_inflight i
      JOIN net._http_response r ON r.id=i.request_id
      WHERE i.source_domain=v_dom AND r.status_code=200;

    IF v_fired=0 OR v_responded<v_fired THEN
      domain:=v_dom; in_window_events:=0; live_sales:=0; retracted:=0; unretracted:=0;
      status:='skipped_incomplete_fetch'; RETURN NEXT; CONTINUE;
    END IF;

    SELECT (jsonb_array_length(r.content::jsonb)=0) INTO v_tail_empty
      FROM public.lcc_listing_retract_inflight i JOIN net._http_response r ON r.id=i.request_id
      WHERE i.source_domain=v_dom AND r.status_code=200
      ORDER BY i.page_offset DESC LIMIT 1;
    IF NOT COALESCE(v_tail_empty,false) THEN
      domain:=v_dom; in_window_events:=0; live_sales:=0; retracted:=0; unretracted:=0;
      status:='skipped_tail_not_reached'; RETURN NEXT; CONTINUE;
    END IF;

    TRUNCATE _w24_live_sales;
    INSERT INTO _w24_live_sales (sale_id)
      SELECT DISTINCT (elem->>'sale_id')::text
      FROM public.lcc_listing_retract_inflight i JOIN net._http_response r ON r.id=i.request_id,
           LATERAL jsonb_array_elements(r.content::jsonb) AS elem
      WHERE i.source_domain=v_dom AND r.status_code=200 AND elem->>'sale_id' IS NOT NULL
      ON CONFLICT (sale_id) DO NOTHING;
    SELECT count(*) INTO v_live FROM _w24_live_sales;

    IF v_live < p_min_live_sales THEN
      domain:=v_dom; in_window_events:=0; live_sales:=v_live; retracted:=0; unretracted:=0;
      status:='skipped_below_min_live'; RETURN NEXT;
      IF NOT p_dry_run THEN
        DELETE FROM net._http_response r USING public.lcc_listing_retract_inflight i
          WHERE i.request_id=r.id AND i.source_domain=v_dom;
        DELETE FROM public.lcc_listing_retract_inflight WHERE source_domain=v_dom;
      END IF;
      CONTINUE;
    END IF;

    SELECT count(*) INTO v_events FROM public.lcc_listing_events
      WHERE source_domain=v_dom AND source_event_type='sale' AND event_date >= v_floor;
    SELECT count(*) INTO v_cand FROM public.lcc_listing_events e
      WHERE e.source_domain=v_dom AND e.source_event_type='sale' AND e.event_date >= v_floor
        AND e.retracted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM _w24_live_sales l WHERE l.sale_id = e.source_event_id);

    IF v_events > 0 AND v_cand > (p_max_retract_frac * v_events) THEN
      domain:=v_dom; in_window_events:=v_events; live_sales:=v_live; retracted:=0; unretracted:=0;
      status:='skipped_anomaly_over_frac'; RETURN NEXT;
      IF NOT p_dry_run THEN
        DELETE FROM net._http_response r USING public.lcc_listing_retract_inflight i
          WHERE i.request_id=r.id AND i.source_domain=v_dom;
        DELETE FROM public.lcc_listing_retract_inflight WHERE source_domain=v_dom;
      END IF;
      CONTINUE;
    END IF;

    v_ret := 0; v_unret := 0;
    IF NOT p_dry_run THEN
      -- retract: in-window live-gap events not currently retracted
      WITH tor AS (
        UPDATE public.lcc_listing_events e
        SET retracted_at = now(), retracted_reason = 'source_not_live'
        WHERE e.source_domain=v_dom AND e.source_event_type='sale' AND e.event_date >= v_floor
          AND e.retracted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM _w24_live_sales l WHERE l.sale_id = e.source_event_id)
        RETURNING e.event_id, e.source_event_id)
      INSERT INTO public.lcc_listing_events_retract_log (event_id, source_domain, source_event_id, action, reason)
      SELECT event_id, v_dom, source_event_id, 'retract', 'source_not_live' FROM tor;
      GET DIAGNOSTICS v_ret = ROW_COUNT;

      -- self-heal: un-retract events whose sale is live again (only our own reason)
      WITH tun AS (
        UPDATE public.lcc_listing_events e
        SET retracted_at = NULL, retracted_reason = NULL
        WHERE e.source_domain=v_dom AND e.source_event_type='sale' AND e.event_date >= v_floor
          AND e.retracted_at IS NOT NULL AND e.retracted_reason = 'source_not_live'
          AND EXISTS (SELECT 1 FROM _w24_live_sales l WHERE l.sale_id = e.source_event_id)
        RETURNING e.event_id, e.source_event_id)
      INSERT INTO public.lcc_listing_events_retract_log (event_id, source_domain, source_event_id, action, reason)
      SELECT event_id, v_dom, source_event_id, 'unretract', 'source_live_again' FROM tun;
      GET DIAGNOSTICS v_unret = ROW_COUNT;

      DELETE FROM net._http_response r USING public.lcc_listing_retract_inflight i
        WHERE i.request_id=r.id AND i.source_domain=v_dom;
      DELETE FROM public.lcc_listing_retract_inflight WHERE source_domain=v_dom;
    ELSE
      v_ret := v_cand;
      SELECT count(*) INTO v_unret FROM public.lcc_listing_events e
        WHERE e.source_domain=v_dom AND e.source_event_type='sale' AND e.event_date >= v_floor
          AND e.retracted_at IS NOT NULL AND e.retracted_reason='source_not_live'
          AND EXISTS (SELECT 1 FROM _w24_live_sales l WHERE l.sale_id = e.source_event_id);
    END IF;

    domain:=v_dom; in_window_events:=v_events; live_sales:=v_live;
    retracted:=v_ret; unretracted:=v_unret;
    status := CASE WHEN p_dry_run THEN 'dry_run' ELSE 'applied' END; RETURN NEXT;
  END LOOP;

  DELETE FROM public.lcc_listing_retract_inflight WHERE issued_at < now() - interval '6 hours';
END $fn$;
REVOKE ALL ON FUNCTION public.lcc_retract_listing_events_apply(boolean, text[], int, int, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lcc_retract_listing_events_apply(boolean, text[], int, int, numeric) TO service_role;

COMMENT ON FUNCTION public.lcc_retract_listing_events_apply(boolean, text[], int, int, numeric) IS
  'W2.4 listing-event retraction step (audit 3.3.9). Marks events whose source '
  'sale is no longer transaction_state=live as retracted_at (reversible, '
  'self-healing), excluding them from the buyer-SPE / P-BUYER classifiers. '
  'Completeness + anomaly guarded; dry-run default. Runs in the mirror-reconcile '
  'cron via lcc_mirror_reconcile_apply_all.';

-- ---------------------------------------------------------------------------
-- 7. Exclude RETRACTED events from every live consumer of lcc_listing_events
--    (the P-BUYER classifiers + the operator queue). Definitions reproduced
--    verbatim from the live catalog with only `retracted_at IS NULL` added, so
--    output columns are unchanged (CREATE OR REPLACE VIEW stays legal).
-- ---------------------------------------------------------------------------

-- 7a. v_lcc_buyer_name_canonical (reads le.buyer_name directly)
CREATE OR REPLACE VIEW public.v_lcc_buyer_name_canonical AS
 SELECT DISTINCT le.source_domain,
    le.buyer_name AS raw_buyer_name,
    parent.id AS parent_entity_id,
    parent.name AS canonical_buyer_name
   FROM lcc_listing_events le
     JOIN lcc_operator_affiliate_patterns p ON p.relationship = 'buyer_parent'::text AND
        CASE p.pattern_type
            WHEN 'exact'::text THEN lower(le.buyer_name) = lower(p.pattern_name)
            WHEN 'prefix'::text THEN lower(le.buyer_name) ~~ lower(p.pattern_name)
            WHEN 'contains'::text THEN lower(le.buyer_name) ~~ (('%'::text || lower(p.pattern_name)) || '%'::text)
            ELSE NULL::boolean
        END
     JOIN entities parent ON parent.id = p.parent_entity_id
  WHERE le.buyer_name IS NOT NULL AND le.retracted_at IS NULL;

-- 7b. v_lcc_entity_tier0_parent (counterparty-exclusion NOT EXISTS reads le)
CREATE OR REPLACE VIEW public.v_lcc_entity_tier0_parent AS
 WITH ent_prop AS (
         SELECT DISTINCT pf.entity_id,
            pf.source_domain,
            pf.source_property_id,
            m.parent_entity_id,
            m.parent_name
           FROM lcc_entity_portfolio_facts pf
             JOIN entities e ON e.id = pf.entity_id AND e.entity_type = 'organization'::entity_type AND e.merged_into_entity_id IS NULL
             LEFT JOIN lcc_property_owner_facts pof ON pof.source_domain = pf.source_domain AND pof.source_property_id = pf.source_property_id
             LEFT JOIN LATERAL lcc_match_buyer_parent_by_name(pof.true_owner_name) m(parent_entity_id, parent_name) ON true
          WHERE pf.is_current = true AND NOT (EXISTS ( SELECT 1
                   FROM lcc_buyer_parents bp
                  WHERE bp.parent_entity_id = pf.entity_id))
        ), totals AS (
         SELECT ent_prop.entity_id,
            count(DISTINCT ROW(ent_prop.source_domain, ent_prop.source_property_id)) AS total_props
           FROM ent_prop
          GROUP BY ent_prop.entity_id
        ), pcount AS (
         SELECT ent_prop.entity_id,
            ent_prop.parent_entity_id,
            ent_prop.parent_name,
            count(DISTINCT ROW(ent_prop.source_domain, ent_prop.source_property_id)) AS matched_props
           FROM ent_prop
          WHERE ent_prop.parent_entity_id IS NOT NULL AND ent_prop.parent_entity_id <> ent_prop.entity_id
          GROUP BY ent_prop.entity_id, ent_prop.parent_entity_id, ent_prop.parent_name
        ), ranked AS (
         SELECT pc.entity_id,
            pc.parent_entity_id,
            pc.parent_name,
            pc.matched_props,
            t.total_props,
            pc.matched_props::numeric / NULLIF(t.total_props, 0)::numeric AS concentration,
            row_number() OVER (PARTITION BY pc.entity_id ORDER BY pc.matched_props DESC, pc.parent_name) AS rn
           FROM pcount pc
             JOIN totals t ON t.entity_id = pc.entity_id
        )
 SELECT entity_id,
    parent_entity_id,
    parent_name,
    total_props,
    matched_props,
    concentration
   FROM ranked r
  WHERE rn = 1 AND concentration >= 0.80 AND (total_props > 2 OR concentration >= 1.0) AND NOT (EXISTS ( SELECT 1
           FROM lcc_entity_portfolio_facts pf2
             JOIN lcc_listing_events le ON le.source_domain = pf2.source_domain AND le.source_property_id = pf2.source_property_id
             JOIN LATERAL lcc_match_buyer_parent_by_name(le.buyer_name) bm(parent_entity_id, parent_name) ON true
             JOIN entities se ON se.id = r.entity_id
          WHERE pf2.entity_id = r.entity_id AND pf2.is_current = true AND le.seller_name IS NOT NULL AND le.retracted_at IS NULL AND NOT lcc_normalize_entity_name(le.seller_name) IS DISTINCT FROM lcc_normalize_entity_name(se.name) AND bm.parent_entity_id = r.parent_entity_id));

-- 7c. v_lcc_buyer_spe_entities_live (empirical_portfolio tier reads le)
CREATE OR REPLACE VIEW public.v_lcc_buyer_spe_entities_live AS
 SELECT t.entity_id,
    t.parent_entity_id,
    t.parent_name,
    'domain_true_owner'::text AS match_tier
   FROM v_lcc_entity_tier0_parent t
UNION
 SELECT bp.parent_entity_id AS entity_id,
    bp.parent_entity_id,
    pe.name AS parent_name,
    'parent_self'::text AS match_tier
   FROM lcc_buyer_parents bp
     JOIN entities pe ON pe.id = bp.parent_entity_id
UNION
 SELECT e.id AS entity_id,
    p.parent_entity_id,
    parent.name AS parent_name,
    'prefix'::text AS match_tier
   FROM entities e
     JOIN lcc_operator_affiliate_patterns p ON p.relationship = 'buyer_parent'::text AND
        CASE p.pattern_type
            WHEN 'exact'::text THEN lower(e.name) = lower(p.pattern_name)
            WHEN 'prefix'::text THEN lower(e.name) ~~ lower(p.pattern_name)
            WHEN 'contains'::text THEN lower(e.name) ~~ (('%'::text || lower(p.pattern_name)) || '%'::text)
            ELSE NULL::boolean
        END
     JOIN entities parent ON parent.id = p.parent_entity_id
  WHERE e.entity_type = 'organization'::entity_type AND e.merged_into_entity_id IS NULL AND e.id <> p.parent_entity_id
UNION
 SELECT e.id AS entity_id,
    par_p.parent_entity_id,
    parent.name AS parent_name,
    'empirical_portfolio'::text AS match_tier
   FROM entities e
     JOIN lcc_entity_portfolio_facts f ON f.entity_id = e.id AND f.is_current = true
     JOIN LATERAL ( SELECT le.buyer_name
           FROM lcc_listing_events le
          WHERE le.source_domain = f.source_domain AND le.source_property_id = f.source_property_id AND le.buyer_name IS NOT NULL AND le.retracted_at IS NULL
          ORDER BY le.event_date DESC NULLS LAST
         LIMIT 1) lev ON true
     JOIN lcc_operator_affiliate_patterns par_p ON par_p.relationship = 'buyer_parent'::text AND
        CASE par_p.pattern_type
            WHEN 'exact'::text THEN lower(lev.buyer_name) = lower(par_p.pattern_name)
            WHEN 'prefix'::text THEN lower(lev.buyer_name) ~~ lower(par_p.pattern_name)
            WHEN 'contains'::text THEN lower(lev.buyer_name) ~~ (('%'::text || lower(par_p.pattern_name)) || '%'::text)
            ELSE NULL::boolean
        END
     JOIN entities parent ON parent.id = par_p.parent_entity_id
  WHERE e.entity_type = 'organization'::entity_type AND e.merged_into_entity_id IS NULL AND e.id <> par_p.parent_entity_id;

-- 7d. v_lcc_listing_event_queue (operator queue — retracted events are not actionable)
CREATE OR REPLACE VIEW public.v_lcc_listing_event_queue AS
 SELECT e.event_id,
    e.source_domain,
    e.source_property_id,
    e.source_event_id,
    e.event_date,
    e.sale_price,
    e.buyer_name,
    e.seller_name,
    e.cap_rate,
    e.data_source,
    e.detected_at,
    e.processed_at,
    e.processed_reason,
    EXTRACT(day FROM now() - e.detected_at)::integer AS days_since_detected,
    pa.address AS property_address,
    pa.city AS property_city,
    pa.state AS property_state,
    pa.building_size_sqft,
    pa.year_built,
    pa.latitude,
    pa.longitude,
    seller.id AS seller_entity_id,
    seller.name AS seller_entity_name,
    seller.owner_role AS seller_owner_role,
    buyer.id AS buyer_entity_id,
    buyer.name AS buyer_entity_name,
    buyer.owner_role AS buyer_owner_role,
    COALESCE(e.sale_price, 0::numeric) AS rank_value,
    e.buyer_name IS NOT NULL AND e.seller_name IS NOT NULL AND length(regexp_replace(lower(e.seller_name), '[^a-z0-9]'::text, ''::text, 'g'::text)) >= 6 AND "left"(regexp_replace(lower(e.seller_name), '[^a-z0-9]'::text, ''::text, 'g'::text), 8) = "left"(regexp_replace(lower(e.buyer_name), '[^a-z0-9]'::text, ''::text, 'g'::text), 8) AS is_sale_leaseback
   FROM lcc_listing_events e
     LEFT JOIN lcc_property_attributes pa ON pa.source_domain = e.source_domain AND pa.source_property_id = e.source_property_id
     LEFT JOIN LATERAL ( SELECT en.id,
            en.name,
            en.owner_role
           FROM lcc_entity_portfolio_facts f
             JOIN entities en ON en.id = f.entity_id AND en.merged_into_entity_id IS NULL
          WHERE f.source_domain = e.source_domain AND f.source_property_id = e.source_property_id AND f.ownership_end_date IS NOT NULL
          ORDER BY f.ownership_end_date DESC
         LIMIT 1) seller ON true
     LEFT JOIN LATERAL ( SELECT en.id,
            en.name,
            en.owner_role
           FROM lcc_entity_portfolio_facts f
             JOIN entities en ON en.id = f.entity_id AND en.merged_into_entity_id IS NULL
          WHERE f.source_domain = e.source_domain AND f.source_property_id = e.source_property_id AND f.is_current = true
          ORDER BY f.ownership_start_date DESC NULLS LAST
         LIMIT 1) buyer ON true
  WHERE e.retracted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 8. Wire both W2.4 sweeps into the mirror-reconcile cron as recurring steps
--    via thin orchestrators, so the EXISTING reconcile functions (the working
--    property prune) are UNTOUCHED. The fetch orchestrator fires the property
--    census + the live-sale census; the apply orchestrator runs the prune, the
--    retraction, the cleared-field tombstone, then refreshes the buyer-SPE cache
--    so a retraction moves the P-BUYER pool immediately.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_mirror_reconcile_fetch_all(p_domain text DEFAULT 'both')
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  PERFORM public.lcc_reconcile_mirrors_fetch(p_domain);
  PERFORM public.lcc_retract_listing_events_fetch(p_domain);
END $fn$;
REVOKE ALL ON FUNCTION public.lcc_mirror_reconcile_fetch_all(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lcc_mirror_reconcile_fetch_all(text) TO service_role;

CREATE OR REPLACE FUNCTION public.lcc_mirror_reconcile_apply_all(p_dry_run boolean DEFAULT false)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  PERFORM public.lcc_reconcile_mirrors_apply(p_dry_run);
  PERFORM public.lcc_retract_listing_events_apply(p_dry_run);
  PERFORM public.lcc_apply_cleared_tombstones(p_dry_run);
  -- A retraction / tombstone can change buyer-SPE membership → refresh the cache
  -- (safe no-op when nothing changed; the P-BUYER band reads this cache).
  IF NOT p_dry_run THEN PERFORM public.lcc_refresh_buyer_spe_resolved(); END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.lcc_mirror_reconcile_apply_all(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lcc_mirror_reconcile_apply_all(boolean) TO service_role;

COMMENT ON FUNCTION public.lcc_mirror_reconcile_apply_all(boolean) IS
  'W2.4 mirror-reconcile apply orchestrator: property orphan prune (R22/R23) + '
  'listing-event retraction (3.3.9) + cleared-field tombstone (3.3.6) + '
  'buyer-SPE cache refresh. Driven by cron lcc-mirror-reconcile-apply.';

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    PERFORM cron.unschedule('lcc-mirror-reconcile-fetch') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='lcc-mirror-reconcile-fetch');
    PERFORM cron.unschedule('lcc-mirror-reconcile-apply') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='lcc-mirror-reconcile-apply');
    PERFORM cron.schedule('lcc-mirror-reconcile-fetch', '10 5 * * *', $$SELECT public.lcc_mirror_reconcile_fetch_all('both')$$);
    PERFORM cron.schedule('lcc-mirror-reconcile-apply', '15 5 * * *', $$SELECT public.lcc_mirror_reconcile_apply_all(false)$$);
  ELSE
    RAISE NOTICE 'pg_cron not installed; schedule lcc_mirror_reconcile_fetch_all/apply_all manually.';
  END IF;
END $cron$;

-- ============================================================================
-- VERIFICATION (post-apply, async pg_net spans the fetch→apply gap):
--   -- dry-run first:
--   SELECT public.lcc_retract_listing_events_fetch('both');   -- fire census
--   -- wait ~10s for responses, then:
--   SELECT * FROM public.lcc_retract_listing_events_apply(true);   -- dry_run report
--   -- P-BUYER pool before/after (distinct SPE entities feeding the band):
--   SELECT count(DISTINCT entity_id) FROM public.v_lcc_buyer_spe_entities;
--   -- real apply + backfill:
--   SELECT public.lcc_retract_listing_events_fetch('both');
--   SELECT * FROM public.lcc_retract_listing_events_apply(false);
--   SELECT public.lcc_refresh_buyer_spe_resolved();
--   -- tombstone dry-run (0 today until a property field is cleared under W2.2):
--   SELECT * FROM public.lcc_apply_cleared_tombstones(true);
-- REVERSAL:
--   -- un-retract everything: UPDATE lcc_listing_events SET retracted_at=NULL,
--   --   retracted_reason=NULL WHERE retracted_reason='source_not_live';
--   -- un-tombstone: write lcc_property_attributes_tombstone_log.old_value back.
-- ============================================================================
