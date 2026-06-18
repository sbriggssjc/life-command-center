-- R42 (2026-06-18): propagate new rent -> recompute derived cap rates (dia).
--
-- PROBLEM (audit AUDIT_rent_to_caprate_propagation_2026-06-16.md): a dia sale's
-- derived cap is computed ONCE by trg_sale_cap_rate_snapshot at sale-write time
-- (cap_rate_history.cap_rate + sales_transactions.calculated_cap_rate, both
-- ON-CONFLICT-DO-NOTHING / NULL-fill = frozen). When rent is learned AFTER the
-- sale, neither refreshes. dia is partly mitigated (v_sales_comps projects rent
-- at refresh) but the STORED caps + the dialysis.js bypass loader stay frozen.
-- The published dia CM views read cap_rate_final (the of-record), whose
-- noi_derived candidate = rent_at_sale/sold_price -- also frozen. Grounded live
-- 2026-06-18: 650 of 3,040 dia live sales carry a ledger cap drifting > 50 bps
-- from current rent.
--
-- FIX: recompute via the AUTHORITATIVE dia_compute_cap_rate() (NNN: rent IS NOI)
-- and refresh the DERIVED fields only:
--   * cap_rate_history.cap_rate (the ledger)
--   * sales_transactions.calculated_cap_rate  (the explicit derived field)
--   * sales_transactions.rent_at_sale         (-> dia_sales_cap_of_record_tg
--     re-derives cap_rate_final; the of-record ladder still ranks broker_stated /
--     source_reported ABOVE noi_derived, so RAW reported caps are preserved)
-- RAW caps (cap_rate, stated_cap_rate) and manual overrides (cap_rate_source=
-- 'manual') are NEVER touched. Idempotent + bounded + reversible.

CREATE TABLE IF NOT EXISTS public.cap_recompute_backup (
  id          bigserial PRIMARY KEY,
  run_tag     text NOT NULL,
  scope       text NOT NULL,          -- 'ledger_sale'|'ledger_listing'|'sale_calc'|'sale_rent'
  property_id bigint,
  event_date  date,
  price_at_event numeric,
  ref_id      bigint,                 -- cap_rate_history.id OR sales_transactions.sale_id
  col         text NOT NULL,
  old_value   numeric,
  new_value   numeric,
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cap_recompute_backup_tag ON public.cap_recompute_backup(run_tag);

-- ---------------------------------------------------------------------------
-- 1. Per-property recompute.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dia_recompute_caps_for_property(
  p_property_id bigint,
  p_backup_tag  text DEFAULT ''
) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_ledger_caps   int := 0;
  v_calc_caps     int := 0;
  v_listing_caps  int := 0;
  r RECORD;
  v_fresh RECORD;
  v_event_date date;
BEGIN
  IF p_property_id IS NULL THEN RETURN '{}'::jsonb; END IF;

  -- --- live sales: ledger + calculated_cap_rate + rent_at_sale ---
  FOR r IN
    SELECT s.sale_id, s.sale_date, s.sold_price, s.calculated_cap_rate, s.rent_at_sale, s.cap_rate_source
    FROM public.sales_transactions s
    WHERE s.property_id = p_property_id
      AND COALESCE(s.exclude_from_market_metrics, false) = false
      AND s.sold_price > 0 AND s.sale_date IS NOT NULL
  LOOP
    SELECT * INTO v_fresh FROM public.dia_compute_cap_rate(p_property_id, r.sold_price, r.sale_date);
    -- match the snapshot trigger's band so we never write an out-of-band derived cap
    IF v_fresh.cap_rate IS NULL OR v_fresh.cap_rate < 0.01 OR v_fresh.cap_rate > 0.25 THEN CONTINUE; END IF;

    -- a) derived ledger (cap_rate_history)
    IF p_backup_tag <> '' THEN
      INSERT INTO public.cap_recompute_backup(run_tag, scope, property_id, event_date, price_at_event, ref_id, col, old_value, new_value)
      SELECT p_backup_tag, 'ledger_sale', p_property_id, h.event_date, h.price_at_event, h.id, 'cap_rate', h.cap_rate, v_fresh.cap_rate
      FROM public.cap_rate_history h
      WHERE h.property_id = p_property_id AND h.event_type='sale'
        AND h.event_date = r.sale_date AND COALESCE(h.price_at_event,-1)=COALESCE(r.sold_price,-1)
        AND h.cap_rate IS NOT NULL AND h.cap_rate IS DISTINCT FROM v_fresh.cap_rate;
    END IF;
    WITH upd AS (
      UPDATE public.cap_rate_history h SET
        cap_rate      = v_fresh.cap_rate,
        rent_at_event = v_fresh.rent_used,
        notes         = v_fresh.rent_source || ' (conf: ' || v_fresh.rent_confidence || ') [r42 recompute]'
      WHERE h.property_id = p_property_id AND h.event_type='sale'
        AND h.event_date = r.sale_date AND COALESCE(h.price_at_event,-1)=COALESCE(r.sold_price,-1)
        AND h.cap_rate IS NOT NULL AND h.cap_rate IS DISTINCT FROM v_fresh.cap_rate
      RETURNING 1
    ) SELECT v_ledger_caps + count(*) INTO v_ledger_caps FROM upd;

    -- b) derived displayed (calculated_cap_rate + rent_at_sale) -> of-record trigger
    --    re-derives cap_rate_final. Skip manual overrides.
    IF r.cap_rate_source IS DISTINCT FROM 'manual'
       AND (r.calculated_cap_rate IS DISTINCT FROM v_fresh.cap_rate
            OR r.rent_at_sale IS DISTINCT FROM v_fresh.rent_used) THEN
      IF p_backup_tag <> '' THEN
        INSERT INTO public.cap_recompute_backup(run_tag, scope, property_id, event_date, price_at_event, ref_id, col, old_value, new_value)
        VALUES (p_backup_tag, 'sale_calc', p_property_id, r.sale_date, r.sold_price, r.sale_id, 'calculated_cap_rate', r.calculated_cap_rate, v_fresh.cap_rate),
               (p_backup_tag, 'sale_rent', p_property_id, r.sale_date, r.sold_price, r.sale_id, 'rent_at_sale', r.rent_at_sale, v_fresh.rent_used);
      END IF;
      UPDATE public.sales_transactions s SET
        calculated_cap_rate = v_fresh.cap_rate,
        rent_at_sale        = v_fresh.rent_used
      WHERE s.sale_id = r.sale_id;
      v_calc_caps := v_calc_caps + 1;
    END IF;
  END LOOP;

  -- --- active listings: ledger only (asking caps are theater; leave displayed) ---
  FOR r IN
    SELECT al.listing_id, COALESCE(al.last_price, al.initial_price) AS price,
           COALESCE(al.price_change_date, CURRENT_DATE) AS evdate
    FROM public.available_listings al
    WHERE al.property_id = p_property_id
      AND COALESCE(al.is_active, true) = true
      AND COALESCE(al.last_price, al.initial_price) > 0
  LOOP
    v_event_date := COALESCE(r.evdate, CURRENT_DATE);
    SELECT * INTO v_fresh FROM public.dia_compute_cap_rate(p_property_id, r.price, v_event_date);
    IF v_fresh.cap_rate IS NULL OR v_fresh.cap_rate < 0.02 OR v_fresh.cap_rate > 0.25 THEN CONTINUE; END IF;

    IF p_backup_tag <> '' THEN
      INSERT INTO public.cap_recompute_backup(run_tag, scope, property_id, event_date, price_at_event, ref_id, col, old_value, new_value)
      SELECT p_backup_tag, 'ledger_listing', p_property_id, h.event_date, h.price_at_event, h.id, 'cap_rate', h.cap_rate, v_fresh.cap_rate
      FROM public.cap_rate_history h
      WHERE h.property_id = p_property_id AND h.event_type='listing'
        AND h.event_date = v_event_date AND COALESCE(h.price_at_event,-1)=COALESCE(r.price,-1)
        AND h.cap_rate IS NOT NULL AND h.cap_rate IS DISTINCT FROM v_fresh.cap_rate;
    END IF;
    WITH upd AS (
      UPDATE public.cap_rate_history h SET
        cap_rate      = v_fresh.cap_rate,
        rent_at_event = v_fresh.rent_used,
        notes         = v_fresh.rent_source || ' (conf: ' || v_fresh.rent_confidence || ') [r42 recompute]'
      WHERE h.property_id = p_property_id AND h.event_type='listing'
        AND h.event_date = v_event_date AND COALESCE(h.price_at_event,-1)=COALESCE(r.price,-1)
        AND h.cap_rate IS NOT NULL AND h.cap_rate IS DISTINCT FROM v_fresh.cap_rate
      RETURNING 1
    ) SELECT v_listing_caps + count(*) INTO v_listing_caps FROM upd;
  END LOOP;

  RETURN jsonb_build_object('ledger_caps', v_ledger_caps, 'calc_caps', v_calc_caps, 'listing_caps', v_listing_caps);
END $$;

COMMENT ON FUNCTION public.dia_recompute_caps_for_property IS
  'R42: recompute dia derived caps for a property via dia_compute_cap_rate(). Refreshes cap_rate_history.cap_rate (ledger), sales_transactions.calculated_cap_rate + rent_at_sale (-> of-record trigger refreshes cap_rate_final). Preserves raw cap_rate/stated_cap_rate + manual overrides. Idempotent; p_backup_tag snapshots to cap_recompute_backup.';

-- ---------------------------------------------------------------------------
-- 2. Extend the nightly tick.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.propagate_sales_recompute(p_lookback_hours int DEFAULT 24)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_sale_updated int := 0;
  v_owner_updated int := 0;
  v_cap_props int := 0;
  v_cap_caps  int := 0;
  v_cutoff timestamptz := now() - (p_lookback_hours || ' hours')::interval;
  r RECORD; v_one jsonb;
  c_max_props_per_tick constant int := 1500;
BEGIN
  -- (1) sales-propagation backstop (unchanged)
  WITH live_max AS (
    SELECT DISTINCT ON (s.property_id)
      s.property_id, s.sale_date, s.sold_price, s.buyer_name, s.seller_name
    FROM public.sales_transactions s
    WHERE s.transaction_state = 'live' AND s.sale_date IS NOT NULL AND s.property_id IS NOT NULL
    ORDER BY s.property_id, s.sale_date DESC, s.sale_id DESC
  ),
  touched_recent AS (
    SELECT DISTINCT property_id FROM public.sales_transactions
    WHERE updated_at > v_cutoff AND property_id IS NOT NULL
  ),
  candidates AS (
    SELECT p.property_id, lm.sale_date, lm.sold_price, lm.buyer_name, lm.seller_name
    FROM public.properties p JOIN live_max lm ON lm.property_id = p.property_id
    WHERE COALESCE(p.latest_deed_date, '1900-01-01'::date) < lm.sale_date
       OR p.property_id IN (SELECT property_id FROM touched_recent)
  ),
  upd_sales AS (
    UPDATE public.properties p SET
      latest_deed_date    = c.sale_date,
      latest_sale_price   = COALESCE(c.sold_price, p.latest_sale_price),
      latest_sale_grantor = COALESCE(c.seller_name, p.latest_sale_grantor),
      latest_deed_grantee = COALESCE(c.buyer_name,  p.latest_deed_grantee),
      recorded_owner_name = COALESCE(c.buyer_name,  p.recorded_owner_name),
      updated_at = now()
    FROM candidates c
    WHERE p.property_id = c.property_id
      AND (p.latest_deed_date IS DISTINCT FROM c.sale_date
        OR p.latest_sale_price IS DISTINCT FROM c.sold_price
        OR p.latest_sale_grantor IS DISTINCT FROM c.seller_name
        OR p.latest_deed_grantee IS DISTINCT FROM c.buyer_name)
    RETURNING 1
  )
  SELECT count(*) INTO v_sale_updated FROM upd_sales;

  -- (1b) ownership owner_id backstop (unchanged)
  WITH open_owner AS (
    SELECT DISTINCT ON (oh.property_id) oh.property_id, oh.recorded_owner_id
    FROM public.ownership_history oh
    WHERE oh.ownership_state = 'active' AND oh.property_id IS NOT NULL AND oh.recorded_owner_id IS NOT NULL
      AND COALESCE(oh.end_date, oh.ownership_end) IS NULL
    ORDER BY oh.property_id, oh.ownership_id DESC
  ),
  upd_owner AS (
    UPDATE public.properties p SET recorded_owner_id = oo.recorded_owner_id, updated_at = now()
    FROM open_owner oo
    WHERE p.property_id = oo.property_id AND p.recorded_owner_id IS DISTINCT FROM oo.recorded_owner_id
    RETURNING 1
  )
  SELECT count(*) INTO v_owner_updated FROM upd_owner;

  -- (2) R42: cap-rate recompute for properties whose RENT changed in the window.
  -- Sources: leases.updated_at, property_financials.updated_at. (anchor_rent on
  -- properties is excluded -- properties.updated_at is self-bumped by the
  -- propagation above; anchor edits ride lease writes via OM/sidebar. The Unit-2
  -- backfill covers any anchor-only changes.)
  FOR r IN
    WITH changed AS (
      SELECT property_id FROM public.leases WHERE updated_at > v_cutoff AND property_id IS NOT NULL
      UNION
      SELECT property_id FROM public.property_financials WHERE updated_at > v_cutoff AND property_id IS NOT NULL
    )
    SELECT DISTINCT property_id FROM changed WHERE property_id IS NOT NULL
    LIMIT c_max_props_per_tick
  LOOP
    v_one := public.dia_recompute_caps_for_property(r.property_id, '');
    v_cap_props := v_cap_props + 1;
    v_cap_caps  := v_cap_caps + COALESCE((v_one->>'ledger_caps')::int,0)
                 + COALESCE((v_one->>'calc_caps')::int,0) + COALESCE((v_one->>'listing_caps')::int,0);
  END LOOP;

  RETURN jsonb_build_object(
    'sales_propagation_fixed', v_sale_updated,
    'ownership_owner_id_fixed', v_owner_updated,
    'cap_recompute_props_scanned', v_cap_props,
    'cap_recompute_caps_updated', v_cap_caps,
    'lookback_hours', p_lookback_hours, 'ran_at', now()
  );
END $$;

-- ---------------------------------------------------------------------------
-- 3. Unit 2 -- reversible backfill (GATED; dry_run defaults TRUE).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dia_recompute_caps_backfill(
  p_dry_run boolean DEFAULT true, p_min_drift numeric DEFAULT 0.005, p_max_props int DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_tag text := 'r42_backfill_' || to_char(now(),'YYYYMMDDHH24MISS');
  v_props int := 0; v_caps int := 0; r RECORD; v_one jsonb;
BEGIN
  CREATE TEMP TABLE _r42_drift ON COMMIT DROP AS
  WITH ev AS (
    SELECT s.property_id, s.sale_date AS evdate, s.sold_price AS price, 'sale'::text AS et
    FROM public.sales_transactions s
    WHERE COALESCE(s.exclude_from_market_metrics,false)=false AND s.property_id IS NOT NULL AND s.sold_price>0 AND s.sale_date IS NOT NULL
    UNION ALL
    SELECT al.property_id, COALESCE(al.price_change_date, CURRENT_DATE), COALESCE(al.last_price, al.initial_price), 'listing'
    FROM public.available_listings al
    WHERE al.property_id IS NOT NULL AND COALESCE(al.is_active,true)=true AND COALESCE(al.last_price, al.initial_price)>0
  ),
  drift AS (
    SELECT DISTINCT ev.property_id FROM ev
    JOIN public.cap_rate_history h ON h.property_id=ev.property_id AND h.event_type::text=ev.et
       AND h.event_date=ev.evdate AND COALESCE(h.price_at_event,-1)=COALESCE(ev.price,-1) AND h.cap_rate IS NOT NULL
    JOIN LATERAL public.dia_compute_cap_rate(ev.property_id, ev.price, ev.evdate) fc ON true
    WHERE fc.cap_rate IS NOT NULL AND fc.cap_rate BETWEEN 0.01 AND 0.25 AND abs(fc.cap_rate - h.cap_rate) >= p_min_drift
  )
  SELECT property_id FROM drift;

  IF p_dry_run THEN
    RETURN (
      WITH ev AS (
        SELECT s.property_id, s.sale_date AS evdate, s.sold_price AS price, 'sale'::text AS et
        FROM public.sales_transactions s
        WHERE COALESCE(s.exclude_from_market_metrics,false)=false AND s.property_id IS NOT NULL AND s.sold_price>0 AND s.sale_date IS NOT NULL
          AND s.property_id IN (SELECT property_id FROM _r42_drift)
        UNION ALL
        SELECT al.property_id, COALESCE(al.price_change_date, CURRENT_DATE), COALESCE(al.last_price, al.initial_price), 'listing'
        FROM public.available_listings al WHERE al.property_id IN (SELECT property_id FROM _r42_drift) AND COALESCE(al.is_active,true)=true AND COALESCE(al.last_price, al.initial_price)>0
      ),
      diff AS (
        SELECT ev.property_id, ev.et, ev.evdate, ev.price, h.cap_rate AS old_cap, fc.cap_rate AS new_cap,
               round(fc.cap_rate - h.cap_rate, 4) AS delta, fc.rent_source AS new_source
        FROM ev
        JOIN public.cap_rate_history h ON h.property_id=ev.property_id AND h.event_type::text=ev.et
           AND h.event_date=ev.evdate AND COALESCE(h.price_at_event,-1)=COALESCE(ev.price,-1) AND h.cap_rate IS NOT NULL
        JOIN LATERAL public.dia_compute_cap_rate(ev.property_id, ev.price, ev.evdate) fc ON true
        WHERE fc.cap_rate IS NOT NULL AND fc.cap_rate BETWEEN 0.01 AND 0.25 AND abs(fc.cap_rate - h.cap_rate) >= p_min_drift
      )
      SELECT jsonb_build_object(
        'dry_run', true,
        'drifting_properties', (SELECT count(*) FROM _r42_drift),
        'drifting_events', (SELECT count(*) FROM diff),
        'max_abs_delta', (SELECT max(abs(delta)) FROM diff),
        'sample', (SELECT jsonb_agg(d) FROM (SELECT * FROM diff ORDER BY abs(delta) DESC LIMIT 50) d)
      )
    );
  END IF;

  FOR r IN SELECT property_id FROM _r42_drift LIMIT COALESCE(p_max_props, 1000000) LOOP
    v_one := public.dia_recompute_caps_for_property(r.property_id, v_tag);
    v_props := v_props + 1;
    v_caps  := v_caps + COALESCE((v_one->>'ledger_caps')::int,0) + COALESCE((v_one->>'calc_caps')::int,0) + COALESCE((v_one->>'listing_caps')::int,0);
  END LOOP;

  RETURN jsonb_build_object('dry_run', false, 'run_tag', v_tag, 'properties_recomputed', v_props, 'caps_updated', v_caps);
END $$;

COMMENT ON FUNCTION public.dia_recompute_caps_backfill IS
  'R42 Unit 2 (GATED): reversible backfill of stale dia derived caps. dry_run defaults TRUE (diff only). Real run snapshots to cap_recompute_backup (run_tag). Reverse: restore cap_rate_history.cap_rate by ref_id (scope ledger_*) and sales_transactions.calculated_cap_rate/rent_at_sale by ref_id=sale_id (scope sale_calc/sale_rent) from the tagged backup.';
