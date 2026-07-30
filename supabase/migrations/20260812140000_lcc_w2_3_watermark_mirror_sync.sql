-- ============================================================================
-- W2.3 — Watermark-based incremental mirror sync (LCC Opps, xengecqvemvfknjvbvrq)
-- Audit 3.3.4 (offset-ceiling truncation) + 3.3.5 (late-response stale overwrite)
--
-- PROBLEM (grounded live 2026-07-30):
--   The three cross-DB pg_net mirrors paged by a HARD OFFSET CEILING and then
--   blindly discarded any still-inflight page after 24h:
--     * lcc_sync_property_attributes  — 14 pages (dia) / 18 pages (gov) → 15k/19k cap
--     * lcc_sync_property_owner_facts — 14 (dia) / 18 (gov) page cap
--     * lcc_sync_listing_events       — a bare limit=1000, no paging at all
--   gov holds 20,175 properties; the view-level archived filter is the only thing
--   keeping the mirror under the 19,000-row ceiling — one filter/volume change away
--   from silent truncation. And the two-phase (fire-all-then-finalize) design
--   blindly discarded inflight pages after 24h and could let an out-of-order late
--   response overwrite a newer mirror row.
--
-- FIX — KEYSET (watermark) walk on (updated_at, <natural key>):
--   fetch WHERE updated_at > watermark ORDER BY updated_at, <key> LIMIT 1000,
--   advancing the watermark ONLY on consumed HTTP-200 pages. The COMPOSITE key
--   defeats the PostgREST 1000-row cap even when >1000 rows share one updated_at
--   (gov.properties has one timestamp on 1,126 rows — a strict `updated_at > wm`
--   cursor would skip 126 of them; the keyset does not). A per-row stale-overwrite
--   guard (source_updated_at) drops a late page whose source row is older than what
--   the mirror already holds (audit 3.3.5).
--
--   MECHANISM — resumable multi-tick state machine (NOT a single blocking loop):
--   pg_net dispatches a request only AFTER the queuing transaction commits, and
--   pg_cron runs each job inside ONE atomic transaction that FORBIDS intra-job
--   COMMIT ("invalid transaction termination" — verified live on this instance
--   2026-07-30). A keyset walk is inherently sequential, so it is realized as a
--   tick (lcc_mirror_tick): each invocation CONSUMES the prior tick's response
--   (applies it + advances the watermark durably), then FIRES exactly one next
--   page. The request dispatches when the tick's transaction commits; the next
--   tick consumes it. One page per tick → the walk is fully resumable, advances
--   only on consumed 200s, and has no ceiling and no blind TTL discard. During
--   backfill it pages every tick; when caught up it re-probes every
--   p_refresh_minutes. The old inflight tables are abandoned (left in place).
--
-- SOURCE updated_at exposed by companions government/20260812140000 +
-- dialysis/20260812140000 (append-only view column). dia.sales_transactions +
-- gov.v_sales_transactions_portfolio already carry updated_at.
--
-- Additive / reversible / idempotent. Legacy lcc_sync_*/lcc_finalize_* functions
-- are LEFT DEFINED (unused after the cron repoint) for rollback/manual resolution.
--
-- ⚠️ DISCOVERED PRE-EXISTING BLOCKER — dia mirror is not anon-readable (NOT caused
--   by W2.3). gov.properties/true_owners carry `anon_read_*` RLS policies (qual=true)
--   so gov's security_invoker portfolio views return rows to the anon pg_net key; the
--   dia tables have NO anon policy, so dia's (identically security_invoker) portfolio
--   views return [] to anon. The dia mirror has therefore been FROZEN independently of
--   this change — the legacy offset sync hit the same wall (verified live: `SET ROLE
--   anon; SELECT count(*) FROM dia.v_property_owner_facts_portfolio` = 0 vs gov = 13,518).
--   W2.3 causes NO regression: the dia mirror rows are retained (fill-blanks, never
--   deleted), and the new suspect_empty_source status makes the freeze LOUD instead of
--   silent — a full re-walk from the epoch seed that returns an empty first page opens a
--   `bd_sync_leg_stale` alert. FIX (separate, security-reviewed): restore dia anon-read
--   parity with gov — either add `anon_read_properties`/`anon_read_true_owners` (qual
--   true) on dia to mirror gov, OR flip the dia portfolio views to security_invoker=off
--   (definer) so anon reads ONLY the non-PII view columns. NOT done here because it is an
--   outward-facing exposure decision for the operator, and dia is under the ceiling
--   (~12.3k rows) so it is not the urgent case — gov (20,175, the truncation risk) is.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Watermark + pending-request state (per leg, per domain) + seed.
--    property_attributes / property_owner_facts seed at EPOCH → full incremental
--    re-walk of the whole source (backfill safety, requirement 3).
--    listing_events is NOT a forward mirror — it is a recency-WINDOW feed keyed on
--    sale_date (the leg feeds an operator queue + the P-BUYER pool). Its walk pages
--    a `sale_date >= now()-lookback` window by sale_id, resetting the cursor each
--    cycle; the keyset removes the latent 1000-row cap without switching to an
--    updated_at cursor (sales' updated_at is churned by domain recompute crons —
--    gov has 4,781 sales touched in 30d vs 4 sold, so an updated_at cursor would
--    flood the queue, violating the Consumption-Layer doctrine). Its watermark
--    row's updated_at column is unused; watermark_source_key is the in-window
--    sale_id cursor. Parity is verified against live sales with sale_date>=window.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lcc_mirror_sync_watermark (
  leg                    text NOT NULL,
  source_domain          text NOT NULL CHECK (source_domain IN ('dia','gov')),
  watermark_updated_at   timestamptz NOT NULL DEFAULT '1970-01-01T00:00:00Z',
  watermark_source_key   text,                   -- composite tiebreak (property_id / sale_id); NULL at seed
  pending_request_id     bigint,                  -- the in-flight pg_net request awaiting consumption
  pending_fired_at       timestamptz,
  last_run_started_at    timestamptz,
  last_run_finished_at   timestamptz,             -- set when a walk cycle catches up (empty/short page)
  last_run_pages         int  NOT NULL DEFAULT 0,
  last_run_rows          int  NOT NULL DEFAULT 0,
  last_run_status        text,                    -- ok | walking | partial_no_response | http_error | no_secret
  last_error             text,
  rows_synced_lifetime   bigint NOT NULL DEFAULT 0,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (leg, source_domain)
);

COMMENT ON TABLE public.lcc_mirror_sync_watermark IS
  'W2.3 keyset cursor + pending-request state for the cross-DB pg_net mirror '
  'walks. One row per (leg, source_domain). watermark_(updated_at, source_key) is '
  'the last consumed (updated_at, natural key); the tick fetches strictly after '
  'it. last_run_finished_at is the freshness signal read by '
  'lcc_check_bd_sync_freshness.';

INSERT INTO public.lcc_mirror_sync_watermark (leg, source_domain, watermark_updated_at)
VALUES
  ('property_attributes','dia','1970-01-01T00:00:00Z'),
  ('property_attributes','gov','1970-01-01T00:00:00Z'),
  ('property_owner_facts','dia','1970-01-01T00:00:00Z'),
  ('property_owner_facts','gov','1970-01-01T00:00:00Z'),
  ('listing_events','dia', now() - interval '30 days'),
  ('listing_events','gov', now() - interval '30 days')
ON CONFLICT (leg, source_domain) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. source_updated_at on the mirror tables — the stale-overwrite guard key.
--    Holds the SOURCE row's updated_at (not the LCC write time). Additive.
-- ---------------------------------------------------------------------------
ALTER TABLE public.lcc_property_attributes  ADD COLUMN IF NOT EXISTS source_updated_at timestamptz;
ALTER TABLE public.lcc_property_owner_facts ADD COLUMN IF NOT EXISTS source_updated_at timestamptz;
ALTER TABLE public.lcc_listing_events       ADD COLUMN IF NOT EXISTS source_updated_at timestamptz;

-- ---------------------------------------------------------------------------
-- 3. Per-leg apply helpers (pure upsert, no transaction control). Each returns
--    rows_applied. Stale-overwrite guard on DO UPDATE: skip when the incoming
--    source row is OLDER than the mirror's stored source_updated_at (NULLs allow,
--    so the first backfill populates source_updated_at everywhere).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_apply_property_attributes_page(p_domain text, p_content jsonb)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_applied int := 0;
BEGIN
  IF p_domain = 'dia' THEN
    WITH rows AS (SELECT jsonb_array_elements(p_content) AS row),
    up AS (
      INSERT INTO public.lcc_property_attributes (
        source_domain, source_property_id,
        address, city, state, postal_code, county,
        latitude, longitude, building_size_sqft,
        year_built, year_renovated, building_type,
        asset_class, tenant_short, tenant_label,
        annual_rent, noi, source_updated_at, updated_at)
      SELECT 'dia', (row->>'property_id')::text,
        row->>'address', row->>'city', row->>'state', row->>'zip_code', row->>'county',
        NULLIF(row->>'latitude','')::numeric, NULLIF(row->>'longitude','')::numeric,
        NULLIF(row->>'building_size','')::numeric,
        NULLIF(row->>'year_built','')::int, NULLIF(row->>'year_renovated','')::int,
        COALESCE(row->>'building_type', row->>'property_type'),
        'dialysis', row->>'tenant', row->>'operator',
        NULLIF(row->>'annual_rent','')::numeric, NULLIF(row->>'noi','')::numeric,
        NULLIF(row->>'updated_at','')::timestamptz, now()
      FROM rows WHERE row->>'property_id' IS NOT NULL
      ON CONFLICT (source_domain, source_property_id) DO UPDATE SET
        address            = COALESCE(EXCLUDED.address, public.lcc_property_attributes.address),
        city               = COALESCE(EXCLUDED.city, public.lcc_property_attributes.city),
        state              = COALESCE(EXCLUDED.state, public.lcc_property_attributes.state),
        postal_code        = COALESCE(EXCLUDED.postal_code, public.lcc_property_attributes.postal_code),
        county             = COALESCE(EXCLUDED.county, public.lcc_property_attributes.county),
        latitude           = COALESCE(EXCLUDED.latitude, public.lcc_property_attributes.latitude),
        longitude          = COALESCE(EXCLUDED.longitude, public.lcc_property_attributes.longitude),
        building_size_sqft = COALESCE(EXCLUDED.building_size_sqft, public.lcc_property_attributes.building_size_sqft),
        year_built         = COALESCE(EXCLUDED.year_built, public.lcc_property_attributes.year_built),
        year_renovated     = COALESCE(EXCLUDED.year_renovated, public.lcc_property_attributes.year_renovated),
        building_type      = COALESCE(EXCLUDED.building_type, public.lcc_property_attributes.building_type),
        tenant_short       = COALESCE(EXCLUDED.tenant_short, public.lcc_property_attributes.tenant_short),
        tenant_label       = COALESCE(EXCLUDED.tenant_label, public.lcc_property_attributes.tenant_label),
        annual_rent        = COALESCE(EXCLUDED.annual_rent, public.lcc_property_attributes.annual_rent),
        noi                = COALESCE(EXCLUDED.noi, public.lcc_property_attributes.noi),
        source_updated_at  = EXCLUDED.source_updated_at,
        updated_at         = now()
      WHERE public.lcc_property_attributes.source_updated_at IS NULL
         OR EXCLUDED.source_updated_at IS NULL
         OR EXCLUDED.source_updated_at >= public.lcc_property_attributes.source_updated_at
      RETURNING 1)
    SELECT count(*) INTO v_applied FROM up;
  ELSE  -- gov
    WITH rows AS (SELECT jsonb_array_elements(p_content) AS row),
    up AS (
      INSERT INTO public.lcc_property_attributes (
        source_domain, source_property_id,
        address, city, state, postal_code, county, metro_area,
        latitude, longitude, building_size_sqft, land_acres,
        year_built, year_renovated, building_type,
        asset_class, tenant_short, tenant_label,
        lease_commencement, lease_expiration, firm_term_remaining, term_remaining,
        annual_rent, noi, source_updated_at, updated_at)
      SELECT 'gov', (row->>'property_id')::text,
        row->>'address', row->>'city', row->>'state', row->>'zip_code', row->>'county', row->>'metro_area',
        NULLIF(row->>'latitude','')::numeric, NULLIF(row->>'longitude','')::numeric,
        NULLIF(row->>'building_size_sqft','')::numeric, NULLIF(row->>'land_acres','')::numeric,
        NULLIF(row->>'year_built','')::int, NULLIF(row->>'year_renovated','')::int,
        row->>'building_type', 'government',
        row->>'tenant_short', row->>'tenant_label',
        NULLIF(row->>'lease_commencement','')::date, NULLIF(row->>'lease_expiration','')::date,
        NULLIF(row->>'firm_term_remaining','')::numeric, NULLIF(row->>'term_remaining','')::numeric,
        NULLIF(row->>'annual_rent','')::numeric, NULLIF(row->>'noi','')::numeric,
        NULLIF(row->>'updated_at','')::timestamptz, now()
      FROM rows WHERE row->>'property_id' IS NOT NULL
      ON CONFLICT (source_domain, source_property_id) DO UPDATE SET
        address            = COALESCE(EXCLUDED.address, public.lcc_property_attributes.address),
        city               = COALESCE(EXCLUDED.city, public.lcc_property_attributes.city),
        state              = COALESCE(EXCLUDED.state, public.lcc_property_attributes.state),
        postal_code        = COALESCE(EXCLUDED.postal_code, public.lcc_property_attributes.postal_code),
        county             = COALESCE(EXCLUDED.county, public.lcc_property_attributes.county),
        metro_area         = COALESCE(EXCLUDED.metro_area, public.lcc_property_attributes.metro_area),
        latitude           = COALESCE(EXCLUDED.latitude, public.lcc_property_attributes.latitude),
        longitude          = COALESCE(EXCLUDED.longitude, public.lcc_property_attributes.longitude),
        building_size_sqft = COALESCE(EXCLUDED.building_size_sqft, public.lcc_property_attributes.building_size_sqft),
        land_acres         = COALESCE(EXCLUDED.land_acres, public.lcc_property_attributes.land_acres),
        year_built         = COALESCE(EXCLUDED.year_built, public.lcc_property_attributes.year_built),
        year_renovated     = COALESCE(EXCLUDED.year_renovated, public.lcc_property_attributes.year_renovated),
        building_type      = COALESCE(EXCLUDED.building_type, public.lcc_property_attributes.building_type),
        tenant_short       = COALESCE(EXCLUDED.tenant_short, public.lcc_property_attributes.tenant_short),
        tenant_label       = COALESCE(EXCLUDED.tenant_label, public.lcc_property_attributes.tenant_label),
        lease_commencement = COALESCE(EXCLUDED.lease_commencement, public.lcc_property_attributes.lease_commencement),
        lease_expiration   = COALESCE(EXCLUDED.lease_expiration, public.lcc_property_attributes.lease_expiration),
        firm_term_remaining= COALESCE(EXCLUDED.firm_term_remaining, public.lcc_property_attributes.firm_term_remaining),
        term_remaining     = COALESCE(EXCLUDED.term_remaining, public.lcc_property_attributes.term_remaining),
        annual_rent        = COALESCE(EXCLUDED.annual_rent, public.lcc_property_attributes.annual_rent),
        noi                = COALESCE(EXCLUDED.noi, public.lcc_property_attributes.noi),
        source_updated_at  = EXCLUDED.source_updated_at,
        updated_at         = now()
      WHERE public.lcc_property_attributes.source_updated_at IS NULL
         OR EXCLUDED.source_updated_at IS NULL
         OR EXCLUDED.source_updated_at >= public.lcc_property_attributes.source_updated_at
      RETURNING 1)
    SELECT count(*) INTO v_applied FROM up;
  END IF;
  RETURN v_applied;
END $fn$;
REVOKE ALL ON FUNCTION public.lcc_apply_property_attributes_page(text, jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.lcc_apply_property_owner_facts_page(p_domain text, p_content jsonb)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_applied int := 0;
BEGIN
  -- last-writer-wins (straight EXCLUDED), matching the leg's null-semantics; the
  -- stale guard prevents a late page regressing a newer row.
  WITH rows AS (SELECT jsonb_array_elements(p_content) AS row),
  up AS (
    INSERT INTO public.lcc_property_owner_facts (
      source_domain, source_property_id,
      recorded_owner_name, true_owner_name, developer_name, source_updated_at, updated_at)
    SELECT p_domain, (row->>'property_id')::text,
      NULLIF(row->>'recorded_owner_name',''),
      NULLIF(row->>'true_owner_name',''),
      NULLIF(row->>'developer_name',''),
      NULLIF(row->>'updated_at','')::timestamptz, now()
    FROM rows WHERE row->>'property_id' IS NOT NULL
    ON CONFLICT (source_domain, source_property_id) DO UPDATE SET
      recorded_owner_name = EXCLUDED.recorded_owner_name,
      true_owner_name     = EXCLUDED.true_owner_name,
      developer_name      = EXCLUDED.developer_name,
      source_updated_at   = EXCLUDED.source_updated_at,
      updated_at          = now()
    WHERE public.lcc_property_owner_facts.source_updated_at IS NULL
       OR EXCLUDED.source_updated_at IS NULL
       OR EXCLUDED.source_updated_at >= public.lcc_property_owner_facts.source_updated_at
    RETURNING 1)
  SELECT count(*) INTO v_applied FROM up;
  RETURN v_applied;
END $fn$;
REVOKE ALL ON FUNCTION public.lcc_apply_property_owner_facts_page(text, jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.lcc_apply_listing_events_page(p_domain text, p_content jsonb)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_applied int := 0;
BEGIN
  -- insert-only (ON CONFLICT DO NOTHING) — no overwrite, so no stale guard needed;
  -- source_updated_at is stored for observability. dia uses sold_price; gov's view
  -- aliases to sale_price → COALESCE covers both.
  WITH rows AS (SELECT jsonb_array_elements(p_content) AS row),
  src AS (
    SELECT (row->>'sale_id')::text AS source_event_id,
           (row->>'property_id')::text AS source_property_id,
           NULLIF(row->>'sale_date','')::date AS event_date,
           COALESCE(NULLIF(row->>'sale_price','')::numeric, NULLIF(row->>'sold_price','')::numeric) AS sale_price,
           row->>'buyer_name' AS buyer_name,
           row->>'seller_name' AS seller_name,
           NULLIF(row->>'cap_rate','')::numeric AS cap_rate,
           row->>'data_source' AS data_source,
           NULLIF(row->>'updated_at','')::timestamptz AS source_updated_at
    FROM rows
    WHERE row->>'sale_id' IS NOT NULL AND row->>'property_id' IS NOT NULL),
  ins AS (
    INSERT INTO public.lcc_listing_events (
      source_domain, source_event_type, source_event_id, source_property_id,
      event_date, sale_price, buyer_name, seller_name, cap_rate, data_source, source_updated_at)
    SELECT p_domain, 'sale', source_event_id, source_property_id,
      event_date, sale_price, buyer_name, seller_name, cap_rate, data_source, source_updated_at
    FROM src
    ON CONFLICT (source_domain, source_event_type, source_event_id) DO NOTHING
    RETURNING 1)
  SELECT count(*) INTO v_applied FROM ins;
  RETURN v_applied;
END $fn$;
REVOKE ALL ON FUNCTION public.lcc_apply_listing_events_page(text, jsonb) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 4. The keyset walk tick (cron-safe; no transaction control). For each selected
--    (leg, domain): consume the prior tick's pg_net response (apply + advance the
--    watermark), then fire exactly one next page. The request dispatches on the
--    tick's commit; the next tick consumes it. Backfill pages one step per tick;
--    when caught up it re-probes every p_refresh_minutes.
-- ---------------------------------------------------------------------------
-- Drop any prior signature so the param-list change can't leave an ambiguous overload.
DROP FUNCTION IF EXISTS public.lcc_mirror_tick(text,text,int,int,int);
CREATE OR REPLACE FUNCTION public.lcc_mirror_tick(
  p_leg                    text DEFAULT NULL,   -- NULL = all legs
  p_domain                 text DEFAULT NULL,   -- NULL/both = dia+gov
  p_page_size              int  DEFAULT 1000,
  p_refresh_minutes        int  DEFAULT 60,     -- re-probe cadence once caught up
  p_response_grace_minutes int  DEFAULT 10,     -- how long to wait for a lost response before re-firing
  p_listing_lookback_days  int  DEFAULT 30      -- listing_events sale_date recency floor
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_legs text[] := CASE WHEN p_leg IS NULL THEN ARRAY['property_attributes','property_owner_facts','listing_events'] ELSE ARRAY[p_leg] END;
  v_doms text[] := CASE WHEN p_domain IS NULL OR p_domain='both' THEN ARRAY['dia','gov'] ELSE ARRAY[p_domain] END;
  v_leg text; v_domain text; r public.lcc_mirror_sync_watermark%ROWTYPE;
  v_status int; v_content text; v_found boolean;
  v_arr jsonb; v_len int; v_applied int; v_last jsonb;
  v_did_full boolean; v_new_cycle boolean; v_should_fire boolean; v_window boolean;
  v_url text; v_anon text; v_path text; v_select text; v_keycol text; v_extra text;
  v_ts_enc text; v_keyset text; v_order text; v_url_full text; v_req bigint;
  v_wm_ts timestamptz; v_wm_key text;
  v_fired int := 0; v_consumed int := 0; v_applied_total int := 0; v_errors int := 0;
BEGIN
  FOREACH v_leg IN ARRAY v_legs LOOP
    IF v_leg NOT IN ('property_attributes','property_owner_facts','listing_events') THEN CONTINUE; END IF;
    FOREACH v_domain IN ARRAY v_doms LOOP
      IF v_domain NOT IN ('dia','gov') THEN CONTINUE; END IF;

      SELECT * INTO r FROM public.lcc_mirror_sync_watermark
        WHERE leg=v_leg AND source_domain=v_domain FOR UPDATE;
      IF NOT FOUND THEN CONTINUE; END IF;

      v_did_full := false;
      v_wm_ts  := r.watermark_updated_at;
      v_wm_key := r.watermark_source_key;
      v_keycol := CASE WHEN v_leg='listing_events' THEN 'sale_id' ELSE 'property_id' END;
      v_window := (v_leg = 'listing_events');   -- recency-window mode (not a forward mirror)

      -- 1) CONSUME prior pending response
      IF r.pending_request_id IS NOT NULL THEN
        SELECT status_code, content INTO v_status, v_content FROM net._http_response WHERE id = r.pending_request_id;
        v_found := FOUND;
        IF v_found THEN
          IF v_status IS NOT DISTINCT FROM 200 THEN
            v_arr := COALESCE(v_content,'[]')::jsonb;
            v_len := jsonb_array_length(v_arr);
            IF v_len > 0 THEN
              v_applied := CASE v_leg
                WHEN 'property_attributes' THEN public.lcc_apply_property_attributes_page(v_domain, v_arr)
                WHEN 'property_owner_facts' THEN public.lcc_apply_property_owner_facts_page(v_domain, v_arr)
                ELSE public.lcc_apply_listing_events_page(v_domain, v_arr) END;
              v_last := v_arr -> (v_len - 1);
              IF v_window THEN
                v_wm_key := v_last->>'sale_id';               -- window cursor (updated_at unused)
              ELSE
                v_wm_ts  := (v_last->>'updated_at')::timestamptz;
                v_wm_key := v_last->>v_keycol;
              END IF;
              r.last_run_pages := r.last_run_pages + 1;
              r.last_run_rows  := r.last_run_rows + v_len;
              r.rows_synced_lifetime := r.rows_synced_lifetime + v_applied;
              v_applied_total := v_applied_total + v_applied;
              IF v_len >= p_page_size THEN
                v_did_full := true; r.last_run_status := 'walking';
              ELSE
                r.last_run_finished_at := now(); r.last_run_status := 'ok';  -- short page → caught up
                IF v_window THEN v_wm_key := NULL; END IF;                    -- restart the window next cycle
              END IF;
            ELSE
              r.last_run_finished_at := now();
              -- A full-mirror re-walk from the seed (key still NULL) that returns an
              -- EMPTY first page is not "caught up" — the source view returned nothing
              -- when it should hold thousands of rows (e.g. anon can't read it). Flag
              -- it loudly so the freshness check alarms instead of masking a freeze.
              IF (NOT v_window) AND v_wm_key IS NULL THEN
                r.last_run_status := 'suspect_empty_source';
              ELSE
                r.last_run_status := 'ok';                                     -- empty page → genuinely caught up
              END IF;
              IF v_window THEN v_wm_key := NULL; END IF;
            END IF;
            DELETE FROM net._http_response WHERE id = r.pending_request_id;
            r.pending_request_id := NULL; r.pending_fired_at := NULL;
            v_consumed := v_consumed + 1;
          ELSE
            r.last_run_status := 'http_error'; r.last_error := 'http '||COALESCE(v_status::text,'null');
            DELETE FROM net._http_response WHERE id = r.pending_request_id;
            r.pending_request_id := NULL; r.pending_fired_at := NULL;
            v_errors := v_errors + 1;
          END IF;
        ELSE
          -- response not yet landed
          IF r.pending_fired_at IS NOT NULL AND now() - r.pending_fired_at > (p_response_grace_minutes||' minutes')::interval THEN
            r.pending_request_id := NULL; r.pending_fired_at := NULL; r.last_run_status := 'partial_no_response';
          ELSE
            UPDATE public.lcc_mirror_sync_watermark SET updated_at=now()
              WHERE leg=v_leg AND source_domain=v_domain;
            CONTINUE;  -- still waiting; do not fire a duplicate
          END IF;
        END IF;
      END IF;

      -- 2) Decide whether to FIRE the next page
      -- NB: suspect_empty_source is deliberately NOT here — it must PERSIST as the
      -- leg status so lcc_check_bd_sync_freshness alarms it; it re-probes on the
      -- normal p_refresh_minutes cadence (and auto-heals when the source is fixed).
      v_should_fire := r.pending_request_id IS NULL AND (
           v_did_full
        OR r.last_run_finished_at IS NULL
        OR (now() - r.last_run_finished_at) > (p_refresh_minutes||' minutes')::interval
        OR r.last_run_status = 'http_error');

      IF v_should_fire THEN
        SELECT decrypted_secret INTO v_url  FROM vault.decrypted_secrets WHERE name = v_domain||'_supabase_url';
        SELECT decrypted_secret INTO v_anon FROM vault.decrypted_secrets WHERE name = v_domain||'_supabase_anon_key';
        IF v_url IS NULL OR v_anon IS NULL THEN
          r.last_run_status := 'no_secret';
        ELSE
          -- fresh cycle bookkeeping (a re-probe after caught-up starts a new count)
          v_new_cycle := (NOT v_did_full) AND (r.last_run_status IS DISTINCT FROM 'http_error');
          IF v_new_cycle THEN
            r.last_run_started_at := now(); r.last_run_pages := 0; r.last_run_rows := 0;
            r.last_error := NULL; r.last_run_status := 'walking';
          END IF;

          -- per-(leg,domain) source config
          v_extra := '';
          IF v_leg = 'property_attributes' THEN
            v_path := '/rest/v1/v_property_attributes_portfolio';
            IF v_domain='dia' THEN
              v_select := 'property_id,address,city,state,zip_code,county,latitude,longitude,building_size,year_built,year_renovated,building_type,property_type,tenant,operator,annual_rent,noi,updated_at';
            ELSE
              v_select := 'property_id,address,city,state,zip_code,county,metro_area,latitude,longitude,building_size_sqft,land_acres,year_built,year_renovated,building_type,tenant_short,tenant_label,lease_commencement,lease_expiration,firm_term_remaining,term_remaining,annual_rent,noi,updated_at';
            END IF;
          ELSIF v_leg = 'property_owner_facts' THEN
            v_path := '/rest/v1/v_property_owner_facts_portfolio';
            v_select := 'property_id,recorded_owner_name,true_owner_name,developer_name,updated_at';
          ELSE  -- listing_events: recency-window feed (sale_date floor), NOT a full mirror
            IF v_domain='dia' THEN
              v_path := '/rest/v1/sales_transactions';
              v_select := 'sale_id,property_id,sale_date,sold_price,buyer_name,seller_name,cap_rate,data_source,updated_at';
              v_extra := '&transaction_state=eq.live';
            ELSE
              v_path := '/rest/v1/v_sales_transactions_portfolio';
              v_select := 'sale_id,property_id,sale_date,sale_price,buyer_name,seller_name,cap_rate,data_source,updated_at';
            END IF;
            v_extra := v_extra || '&sale_date=gte.'||to_char(CURRENT_DATE - p_listing_lookback_days, 'YYYY-MM-DD');
          END IF;

          IF v_window THEN
            -- listing_events keyset on sale_id WITHIN the sale_date window; the cursor
            -- RESETS each cycle so only genuinely recent SALES surface. (Sales'
            -- updated_at is churned by domain recompute crons — gov has 4,781 sales
            -- touched in 30d vs 4 actually sold, so a persistent updated_at cursor
            -- would flood the operator queue. sale_date is the real recency signal.)
            IF v_wm_key IS NULL THEN v_keyset := NULL; ELSE v_keyset := 'sale_id=gt.'||v_wm_key; END IF;
            v_order := 'sale_id.asc';
          ELSE
            -- full mirror: strict (updated_at, key) > (wm_ts, wm_key), microsecond-exact
            v_ts_enc := replace(to_char(v_wm_ts AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'Z', ':','%3A');
            IF v_wm_key IS NULL THEN
              v_keyset := 'updated_at=gt.'||v_ts_enc;
            ELSE
              v_keyset := 'or=(updated_at.gt.'||v_ts_enc||',and(updated_at.eq.'||v_ts_enc||','||v_keycol||'.gt.'||v_wm_key||'))';
            END IF;
            v_order := 'updated_at.asc,'||v_keycol||'.asc';
          END IF;

          v_url_full := v_url||v_path||'?select='||v_select||v_extra
                     || COALESCE('&'||v_keyset,'')
                     || '&order='||v_order||'&limit='||p_page_size;

          SELECT net.http_get(v_url_full, '{}'::jsonb,
            jsonb_build_object('apikey',v_anon,'Authorization','Bearer '||v_anon), 15000) INTO v_req;
          r.pending_request_id := v_req; r.pending_fired_at := now();
          v_fired := v_fired + 1;
        END IF;
      END IF;

      -- 3) persist state (watermark advances only from a consumed 200 above)
      UPDATE public.lcc_mirror_sync_watermark SET
        watermark_updated_at = v_wm_ts,
        watermark_source_key = v_wm_key,
        pending_request_id   = r.pending_request_id,
        pending_fired_at     = r.pending_fired_at,
        last_run_started_at  = r.last_run_started_at,
        last_run_finished_at = r.last_run_finished_at,
        last_run_pages       = r.last_run_pages,
        last_run_rows        = r.last_run_rows,
        last_run_status      = r.last_run_status,
        last_error           = r.last_error,
        rows_synced_lifetime = r.rows_synced_lifetime,
        updated_at           = now()
      WHERE leg=v_leg AND source_domain=v_domain;
    END LOOP;
  END LOOP;

  -- Each consumed response is deleted by request_id above; the shared
  -- lcc-pg-net-response-cleanup cron (hourly, >24h) bounds anything left behind.
  -- No broad delete here — it could reap other syncs' still-inflight responses.
  RETURN jsonb_build_object('fired',v_fired,'consumed',v_consumed,'applied',v_applied_total,'errors',v_errors);
END $fn$;
REVOKE ALL ON FUNCTION public.lcc_mirror_tick(text,text,int,int,int,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lcc_mirror_tick(text,text,int,int,int,int) TO service_role;

COMMENT ON FUNCTION public.lcc_mirror_tick(text,text,int,int,int,int) IS
  'W2.3 resumable keyset walk tick for the cross-DB pg_net mirrors. Consumes the '
  'prior tick''s response (apply + advance lcc_mirror_sync_watermark), then fires '
  'one next page. Cron-safe (no COMMIT). One page per tick; re-probes every '
  'p_refresh_minutes once caught up. Advances the watermark only on consumed 200s.';

-- ---------------------------------------------------------------------------
-- 5. Freshness: per-(leg,domain) staleness from the watermark last-run signal,
--    so a single stalled leg alarms individually (requirement 4). Keeps the
--    original secret-missing + lcc_property_attributes checks.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_check_bd_sync_freshness(p_stale_days int DEFAULT 2)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_missing text[]; v_age_days numeric;
  v_secret_alerts int := 0; v_stale_alerts int := 0;
  v_leg_alerts int := 0; v_leg_resolved int := 0;
  r record; v_leg_age numeric; v_rc int;
BEGIN
  -- 1) Root cause: domain vault secret presence.
  SELECT array_agg(req.name ORDER BY req.name) INTO v_missing
  FROM (VALUES ('dia_supabase_url'),('dia_supabase_anon_key'),
               ('gov_supabase_url'),('gov_supabase_anon_key')) req(name)
  WHERE NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets s
     WHERE s.name = req.name AND COALESCE(length(s.decrypted_secret),0) > 0);

  IF v_missing IS NOT NULL THEN
    INSERT INTO public.lcc_health_alerts (alert_kind, source, severity, summary, details)
    SELECT 'bd_sync_secret_missing','vault','critical',
      'BD mirror sync is no-opping: missing domain vault secret(s) '||array_to_string(v_missing,', ')||
      '. The mirror walks report success/0 rows while lcc_property_attributes / owner_facts / listing_events silently freeze.',
      jsonb_build_object('missing', v_missing)
    WHERE NOT EXISTS (SELECT 1 FROM public.lcc_health_alerts a
      WHERE a.alert_kind='bd_sync_secret_missing' AND a.source='vault' AND a.resolved_at IS NULL);
    GET DIAGNOSTICS v_secret_alerts = ROW_COUNT;
  ELSE
    UPDATE public.lcc_health_alerts a SET resolved_at=now(),
      resolved_note='Auto-resolved: all 4 domain vault secrets present'
    WHERE a.alert_kind='bd_sync_secret_missing' AND a.source='vault' AND a.resolved_at IS NULL;
  END IF;

  -- 2) Legacy symptom: lcc_property_attributes freshness (kept for continuity).
  SELECT EXTRACT(EPOCH FROM (now() - max(updated_at)))/86400.0 INTO v_age_days
  FROM public.lcc_property_attributes;
  IF v_age_days IS NULL OR v_age_days > p_stale_days THEN
    INSERT INTO public.lcc_health_alerts (alert_kind, source, severity, summary, details)
    SELECT 'bd_sync_stale','lcc_property_attributes','warn',
      'BD mirror lcc_property_attributes is stale ('||round(COALESCE(v_age_days,9999),1)||
      'd; threshold '||p_stale_days||'d) — sync may be no-opping or failing.',
      jsonb_build_object('age_days', round(COALESCE(v_age_days,9999),1), 'stale_days_threshold', p_stale_days)
    WHERE NOT EXISTS (SELECT 1 FROM public.lcc_health_alerts a
      WHERE a.alert_kind='bd_sync_stale' AND a.source='lcc_property_attributes' AND a.resolved_at IS NULL);
    GET DIAGNOSTICS v_stale_alerts = ROW_COUNT;
  ELSE
    UPDATE public.lcc_health_alerts a SET resolved_at=now(),
      resolved_note='Auto-resolved: lcc_property_attributes refreshed '||round(v_age_days,1)||'d ago'
    WHERE a.alert_kind='bd_sync_stale' AND a.source='lcc_property_attributes' AND a.resolved_at IS NULL;
  END IF;

  -- 3) W2.3 per-(leg,domain) freshness — a stalled leg alarms individually.
  FOR r IN SELECT leg, source_domain, last_run_finished_at, last_run_status
             FROM public.lcc_mirror_sync_watermark LOOP
    v_leg_age := EXTRACT(EPOCH FROM (now() - r.last_run_finished_at))/86400.0;
    IF r.last_run_finished_at IS NULL
       OR v_leg_age > p_stale_days
       OR r.last_run_status IN ('http_error','no_secret','partial_no_response','suspect_empty_source') THEN
      INSERT INTO public.lcc_health_alerts (alert_kind, source, severity, summary, details)
      SELECT 'bd_sync_leg_stale', r.leg||':'||r.source_domain, 'warn',
        'BD mirror leg '||r.leg||' ('||r.source_domain||') stale/failing: last finished '||
        COALESCE(round(v_leg_age,1)||'d ago','never')||', status '||COALESCE(r.last_run_status,'(none)')||
        '. The keyset walk tick may be disabled, erroring, or the source unreachable.',
        jsonb_build_object('leg', r.leg, 'domain', r.source_domain,
          'age_days', round(COALESCE(v_leg_age,9999),1), 'last_status', r.last_run_status,
          'stale_days_threshold', p_stale_days)
      WHERE NOT EXISTS (SELECT 1 FROM public.lcc_health_alerts a
        WHERE a.alert_kind='bd_sync_leg_stale' AND a.source=r.leg||':'||r.source_domain AND a.resolved_at IS NULL);
      GET DIAGNOSTICS v_rc = ROW_COUNT; v_leg_alerts := v_leg_alerts + v_rc;
    ELSE
      UPDATE public.lcc_health_alerts a SET resolved_at=now(),
        resolved_note='Auto-resolved: leg refreshed '||round(v_leg_age,1)||'d ago (status '||COALESCE(r.last_run_status,'ok')||')'
      WHERE a.alert_kind='bd_sync_leg_stale' AND a.source=r.leg||':'||r.source_domain AND a.resolved_at IS NULL;
      GET DIAGNOSTICS v_rc = ROW_COUNT; v_leg_resolved := v_leg_resolved + v_rc;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'missing_secrets', COALESCE(v_missing, ARRAY[]::text[]),
    'attrs_age_days', round(COALESCE(v_age_days,9999),1),
    'new_secret_alerts', v_secret_alerts, 'new_stale_alerts', v_stale_alerts,
    'new_leg_alerts', v_leg_alerts, 'resolved_leg_alerts', v_leg_resolved);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Disabled-cron watchdog: add the mirror + reconcile + signal + freshness
--    crons to the allowlist so a silently disabled mirror walk alarms
--    (requirement 4). A disabled mirror walk freezes the BD spine's view of the
--    domain DBs — the W2.3 failure mode — so they belong here alongside the
--    retention jobs. NOTE: the watchdog reads THIS project's cron.job only; the
--    dia/gov-resident propagate/recompute crons cannot be seen from here, so the
--    §5 per-leg freshness check is the cross-DB signal that catches a stalled
--    domain-side pipeline (the mirror stops advancing). Phantom dia/gov jobnames
--    are deliberately NOT added (they would perpetually alarm 'missing').
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_check_disabled_critical_crons()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_new int := 0; v_resolved int := 0; v_down jsonb;
begin
  with allow(jobname) as (
    values
      ('lcc-artifact-offload-edge'),('sf-sync-log-prune'),('field-provenance-prune'),
      ('lcc-context-packet-prune'),('lcc-staged-intake-artifacts-prune'),
      ('lcc-disk-health-check'),('lcc-pg-net-response-cleanup'),
      ('lcc-feed-freshness-sync'),('lcc-feed-freshness-finalize'),
      -- W2.3 BD mirror walk + reconcile + signal + freshness crons
      ('lcc-mirror-walk-tick'),
      ('lcc-property-attrs-sync-fire'),('lcc-property-attrs-sync-finalize'),
      ('lcc-r6-owner-facts-sync'),('lcc-r6-owner-facts-finalize'),
      ('lcc-listing-event-sync-fire'),('lcc-listing-event-sync-finalize'),
      ('lcc-mirror-reconcile-fetch'),('lcc-mirror-reconcile-apply'),
      ('lcc-owner-contact-signals-sync'),('lcc-owner-contact-signals-finalize'),
      ('lcc-bd-sync-health-check')
  ),
  state as (
    select a.jobname, count(j.jobid)=0 as is_missing,
           coalesce(bool_or(j.active),false) as any_active, max(j.schedule) as schedule
      from allow a left join cron.job j on j.jobname=a.jobname group by a.jobname
  ),
  down as (
    select jobname, case when is_missing then 'missing' else 'inactive' end as reason, schedule
      from state where is_missing or not any_active
  ),
  ins as (
    insert into public.lcc_health_alerts (alert_kind, source, severity, summary, details)
    select 'maintenance_cron_disabled', d.jobname, 'warn',
           'Critical maintenance/data-freshness cron '||d.jobname||' is '||
             case when d.reason='missing' then 'MISSING (not scheduled)' else 'DISABLED (active=false)' end||
             '. While it is off, its table bloats or its BD mirror silently freezes. Re-enable it.',
           jsonb_build_object('jobname', d.jobname, 'reason', d.reason, 'schedule', d.schedule)
      from down d
     where not exists (select 1 from public.lcc_health_alerts a
        where a.alert_kind='maintenance_cron_disabled' and a.source=d.jobname and a.resolved_at is null)
    returning 1)
  select count(*) into v_new from ins;

  update public.lcc_health_alerts a set resolved_at=now(),
         resolved_note='Auto-resolved: cron re-enabled (active)'
   where a.alert_kind='maintenance_cron_disabled' and a.resolved_at is null
     and exists (select 1 from cron.job j where j.jobname=a.source and j.active is true);
  get diagnostics v_resolved = row_count;

  select coalesce(jsonb_agg(a.jobname),'[]'::jsonb) into v_down
    from (values
      ('lcc-artifact-offload-edge'),('sf-sync-log-prune'),('field-provenance-prune'),
      ('lcc-context-packet-prune'),('lcc-staged-intake-artifacts-prune'),
      ('lcc-disk-health-check'),('lcc-pg-net-response-cleanup'),
      ('lcc-feed-freshness-sync'),('lcc-feed-freshness-finalize'),
      ('lcc-mirror-walk-tick'),
      ('lcc-property-attrs-sync-fire'),('lcc-property-attrs-sync-finalize'),
      ('lcc-r6-owner-facts-sync'),('lcc-r6-owner-facts-finalize'),
      ('lcc-listing-event-sync-fire'),('lcc-listing-event-sync-finalize'),
      ('lcc-mirror-reconcile-fetch'),('lcc-mirror-reconcile-apply'),
      ('lcc-owner-contact-signals-sync'),('lcc-owner-contact-signals-finalize'),
      ('lcc-bd-sync-health-check')
    ) as a(jobname)
   where not exists (select 1 from cron.job j where j.jobname=a.jobname and j.active is true);

  return jsonb_build_object('new_alerts', v_new, 'resolved', v_resolved, 'down', coalesce(v_down,'[]'::jsonb));
end;
$function$;

-- ---------------------------------------------------------------------------
-- 7. Crons. A single `lcc-mirror-walk-tick` (every 3 min) drives all six
--    (leg,domain) pairs: backfill pages one step per pair per tick (~30–45 min to
--    fully re-walk from the epoch seed), then re-probes each pair hourly. The
--    legacy per-leg sync/finalize crons are REPOINTED to the tick as well (kept in
--    the watchdog allowlist for continuity) so nothing calls the ceiling-paged
--    functions; they run the tick for their own leg as a redundant driver.
-- ---------------------------------------------------------------------------
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    PERFORM cron.unschedule(j) FROM (VALUES
      ('lcc-mirror-walk-tick'),
      ('lcc-property-attrs-sync-fire'),('lcc-property-attrs-sync-finalize'),
      ('lcc-r6-owner-facts-sync'),('lcc-r6-owner-facts-finalize'),
      ('lcc-listing-event-sync-fire'),('lcc-listing-event-sync-finalize')
    ) v(j) WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname=v.j);

    -- primary driver: all legs, both domains, every 3 minutes
    PERFORM cron.schedule('lcc-mirror-walk-tick', '*/3 * * * *',
      $$SELECT public.lcc_mirror_tick()$$);

    -- legacy leg crons repointed to the per-leg tick (defensive redundancy)
    PERFORM cron.schedule('lcc-property-attrs-sync-fire',     '35 4 * * *', $$SELECT public.lcc_mirror_tick('property_attributes')$$);
    PERFORM cron.schedule('lcc-property-attrs-sync-finalize', '40 4 * * *', $$SELECT public.lcc_mirror_tick('property_attributes')$$);
    PERFORM cron.schedule('lcc-r6-owner-facts-sync',          '50 4 * * *', $$SELECT public.lcc_mirror_tick('property_owner_facts')$$);
    PERFORM cron.schedule('lcc-r6-owner-facts-finalize',      '55 4 * * *', $$SELECT public.lcc_mirror_tick('property_owner_facts')$$);
    PERFORM cron.schedule('lcc-listing-event-sync-fire',      '25 */4 * * *', $$SELECT public.lcc_mirror_tick('listing_events')$$);
    PERFORM cron.schedule('lcc-listing-event-sync-finalize',  '30 */4 * * *', $$SELECT public.lcc_mirror_tick('listing_events')$$);
  ELSE
    RAISE NOTICE 'pg_cron not installed; run SELECT public.lcc_mirror_tick() on a schedule manually.';
  END IF;
END $cron$;

-- ============================================================================
-- VERIFICATION (post-apply). The walk spans ticks (pg_net is async across commit;
-- pg_cron forbids intra-job COMMIT), so drive it by calling the tick repeatedly:
--
--   SELECT public.lcc_mirror_tick('property_owner_facts','gov');  -- repeat ~15×, ~2s apart
--   SELECT leg, source_domain, watermark_updated_at, watermark_source_key,
--          last_run_status, last_run_pages, last_run_rows, pending_request_id
--     FROM public.lcc_mirror_sync_watermark ORDER BY 1,2;
--
--   -- Row-count parity per leg/domain (must match source ±0.1%):
--   --   lcc_property_attributes vs dia/gov v_property_attributes_portfolio
--   --   lcc_property_owner_facts vs dia/gov v_property_owner_facts_portfolio
--   --   lcc_listing_events vs live sales with updated_at >= now()-30d
--
--   -- Stale-overwrite guard proof: set a mirror row's source_updated_at to now(),
--   -- apply a page carrying an OLDER updated_at for that key, confirm 0 rows applied
--   -- and the row is unchanged (see PR body).
--
--   SELECT public.lcc_check_bd_sync_freshness();
-- ============================================================================
