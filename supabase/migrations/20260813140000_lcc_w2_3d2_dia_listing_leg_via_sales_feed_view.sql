-- W2.3d2 — point the dia listing_events mirror leg + W2.4 retraction census at the
-- dia scoped-definer view v_sales_feed_portfolio (LCC Opps xengecqvemvfknjvbvrq).
-- ---------------------------------------------------------------------------
-- Companion to dia migration 20260730_dia_w2_3d2_sales_feed_portfolio_view.sql.
--
-- W2.3d flipped dia's v_property_attributes_portfolio / v_property_owner_facts_portfolio
-- to security_invoker=off so the anon pg_net mirror key can read them, but the third mirror
-- leg (listing_events) and the W2.4 retraction census still fetched dia's public.sales_transactions
-- DIRECTLY — which has no anon-read policy — so the dia listing_events leg stayed frozen at 0
-- rows and the dia retraction no-opped (live-sale census returned [] to anon → below the
-- min_live guard → skipped_below_min_live). gov was unaffected (it already reads its own
-- security_invoker=off v_sales_transactions_portfolio).
--
-- This re-CREATEs the two functions byte-for-byte from W2.3 (20260812140000) / W2.4
-- (20260813130000) with ONLY the dia branch repointed:
--   * lcc_mirror_tick               dia listing_events leg  → /rest/v1/v_sales_feed_portfolio
--     (select drops cap_rate/data_source — not exposed by the view; the feed keys on
--      buyer/seller counterparty signals, transaction_state stays the &-filter)
--   * lcc_retract_listing_events_fetch  dia census path     → /rest/v1/v_sales_feed_portfolio
-- gov branches, guards, watermark/keyset logic, grants and cron wiring are UNCHANGED.
--
-- Reversible: re-apply the W2.3 / W2.4 function bodies (dia branch → sales_transactions).
-- ---------------------------------------------------------------------------

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
              v_path := '/rest/v1/v_sales_feed_portfolio';   -- W2.3d2: scoped definer view (anon-readable)
              v_select := 'sale_id,property_id,sale_date,sold_price,buyer_name,seller_name,updated_at';   -- W2.3d2: view omits cap_rate/data_source
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
      v_path := '/rest/v1/v_sales_feed_portfolio?select=sale_id&transaction_state=eq.live';   -- W2.3d2
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
