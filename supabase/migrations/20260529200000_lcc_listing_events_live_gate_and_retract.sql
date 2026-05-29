-- ============================================================================
-- LCC Opps — BD listing events: gate the sync on transaction_state='live'
--
-- Target: LCC Opps Supabase (xengecqvemvfknjvbvrq)
--
-- 2026-05-29 comps review (#7). lcc_sync_listing_events pulled dia
-- /rest/v1/sales_transactions and gov /rest/v1/v_sales_transactions_portfolio
-- with NO transaction_state filter, so the BD listing-event pipeline ingested
-- duplicate_superseded / ownership_stub / needs_review rows. Audit found that of
-- 293 'sale' events in the queue, only 58 were real unique sales (dia 37 / gov
-- 21) — 235 were noise (gov alone: 160 ownership_stub GSA-lessor swaps, 55
-- needs_review, 6 superseded; dia: 12 needs_review, 2 superseded).
--
-- BD gate = transaction_state='live' ONLY (NOT exclude_from_market_metrics): a
-- real sale with an implausible cap rate is still a genuine ownership-change
-- event worth BD attention; only non-unique/non-real rows are dropped.
--
-- Fix has two parts:
--  1. (this file) gate the dia pull URL with &transaction_state=eq.live; the gov
--     pull is gated at the source via gov.v_sales_transactions_portfolio
--     (see government/20260529200000).
--  2. one-time retraction of the 235 already-ingested non-live events, backed up
--     to lcc_listing_events_retract_backup_20260529 (applied live 2026-05-29;
--     all 293 were still unprocessed, so no opportunities were derived from the
--     noise). The sync is insert-only (ON CONFLICT DO NOTHING) so retraction is
--     a one-time manual step; the gate prevents recurrence.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_sync_listing_events(p_domain text DEFAULT 'both'::text, p_lookback_days integer DEFAULT 30)
 RETURNS TABLE(domain text, request_id bigint)
 LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_url text; v_anon_key text; v_request bigint; v_domain text; v_domains text[];
  v_url_path text; v_cutoff text := (CURRENT_DATE - p_lookback_days)::text;
BEGIN
  IF p_domain = 'both' THEN v_domains := ARRAY['dia','gov']; ELSE v_domains := ARRAY[p_domain]; END IF;
  FOREACH v_domain IN ARRAY v_domains LOOP
    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets
     WHERE name = (CASE v_domain WHEN 'dia' THEN 'dia_supabase_url' ELSE 'gov_supabase_url' END);
    SELECT decrypted_secret INTO v_anon_key FROM vault.decrypted_secrets
     WHERE name = (CASE v_domain WHEN 'dia' THEN 'dia_supabase_anon_key' ELSE 'gov_supabase_anon_key' END);
    IF v_url IS NULL OR v_anon_key IS NULL THEN
      RAISE NOTICE 'lcc_sync_listing_events(%): missing vault secret, skipping', v_domain; CONTINUE;
    END IF;
    IF v_domain = 'dia' THEN
      v_url_path := '/rest/v1/sales_transactions?select=sale_id,property_id,sale_date,sold_price,buyer_name,seller_name,cap_rate,data_source&transaction_state=eq.live';
    ELSE
      v_url_path := '/rest/v1/v_sales_transactions_portfolio?select=sale_id,property_id,sale_date,sale_price,buyer_name,seller_name,cap_rate,data_source';
    END IF;
    SELECT net.http_get(
      url := v_url || v_url_path || '&sale_date=gte.' || v_cutoff || '&order=sale_date.desc' || '&limit=1000',
      headers := jsonb_build_object('apikey', v_anon_key, 'Authorization', 'Bearer ' || v_anon_key)
    ) INTO v_request;
    INSERT INTO public.lcc_listing_event_sync_inflight (request_id, source_domain) VALUES (v_request, v_domain);
    domain := v_domain; request_id := v_request; RETURN NEXT;
  END LOOP;
END;
$function$;

-- One-time retraction was applied live 2026-05-29 (deleting the 235 non-live
-- sale events, dia by bad-id list + gov by keeping only the 21 live ids), with
-- the removed rows preserved in lcc_listing_events_retract_backup_20260529.
-- Not re-expressed here as portable SQL because it depends on the live
-- transaction_state of dia/gov sales at that moment.
