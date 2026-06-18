-- R42 (2026-06-18): propagate new rent/NOI -> recompute derived cap rates (gov).
--
-- PROBLEM (audit AUDIT_rent_to_caprate_propagation_2026-06-16.md): a sale's
-- derived cap rate is computed ONCE, by the auto_cap_rate snapshot trigger, at
-- the moment the SALE row changes. The leases / lease_escalations /
-- property_financials tables have no cap-rate recompute -- so when we learn the
-- real rent/NOI AFTER a sale was ingested, the sale's derived cap is never
-- refreshed. The gov CM export reads cap_rate_history.cap_rate as its source of
-- truth (COALESCE crh.cap_rate first; see 20260521_cm_gov_completed_quarter_
-- clamp_and_caprate_fix.sql), so a frozen derived cap distorts the published
-- numbers. Grounded live 2026-06-18: 590 of 4,552 gov live sales carry a derived
-- ledger cap that drifts > 50 bps from what current rent yields (max ~15.5 pts).
--
-- FIX: the derived ledger (cap_rate_history.cap_rate) always reflects best-known
-- rent. We recompute via the AUTHORITATIVE gov_compute_cap_rate() -- never a
-- reimplementation of the hierarchy -- and rewrite ONLY the derived ledger cap.
-- The RAW ingested broker cap (cap_rate_history.ingested_cap_rate) and the raw
-- of-record sales_transactions.sold_cap_rate (gov's single-source raw value,
-- managed by gov_sales_cap_source_tg) are NEVER touched. cap_rate_history rows
-- only ever store DERIVED caps in the cap_rate column (raw lives in
-- ingested_cap_rate), so refreshing cap_rate is provenance-safe by construction.
--
-- Three artifacts:
--   1. gov_recompute_caps_for_property(property_id)  -- the per-property recompute
--   2. propagate_sales_recompute(lookback_hours)     -- extended to call (1) for
--      properties whose rent/NOI changed in the window (bounded daily pass)
--   3. gov_recompute_caps_backfill(dry_run, max)     -- Unit 2 one-time backfill,
--      reversible (cap_recompute_backup), GATED -- dry_run defaults TRUE.
--
-- Idempotent: re-running changes nothing if rent is unchanged (the UPDATEs are
-- all guarded `cap_rate IS DISTINCT FROM <fresh>`). Cap-rate range guard is the
-- compute function's own [0.005,0.30] drop -- out-of-band recomputes are simply
-- not written.

-- ---------------------------------------------------------------------------
-- Reversible backup ledger (Unit 2). Append-only; one row per overwritten value.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cap_recompute_backup (
  id          bigserial PRIMARY KEY,
  run_tag     text NOT NULL,
  scope       text NOT NULL,           -- 'ledger_sale' | 'ledger_listing' | 'ledger_sale_event'
  property_id bigint,
  event_date  date,
  price_at_event numeric,
  ref_id      bigint,                  -- cap_rate_history.id
  col         text NOT NULL,           -- column overwritten
  old_value   numeric,
  new_value   numeric,
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cap_recompute_backup_tag ON public.cap_recompute_backup(run_tag);

-- ---------------------------------------------------------------------------
-- 1. Per-property recompute. Refreshes the DERIVED ledger cap for the
--    property's live sales, listings, and sale_events. Preserves ingested_cap_rate
--    + the opex-anchor columns. p_backup_tag != '' snapshots prior values first.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gov_recompute_caps_for_property(
  p_property_id bigint,
  p_backup_tag  text DEFAULT ''
) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_sale_caps        int := 0;
  v_listing_caps     int := 0;
  v_sale_event_caps  int := 0;
  r RECORD;
  v_fresh RECORD;
  v_event_date date;
  v_price numeric;
BEGIN
  IF p_property_id IS NULL THEN RETURN '{}'::jsonb; END IF;

  -- --- live sales -> cap_rate_history(event_type='sale') ---
  FOR r IN
    SELECT s.sale_id, s.sale_date, s.sold_price
    FROM public.sales_transactions s
    WHERE s.property_id = p_property_id
      AND COALESCE(s.exclude_from_market_metrics, false) = false
      AND s.sold_price > 0 AND s.sale_date IS NOT NULL
  LOOP
    SELECT * INTO v_fresh FROM public.gov_compute_cap_rate(p_property_id, r.sold_price, r.sale_date);
    IF v_fresh.cap_rate IS NULL THEN CONTINUE; END IF;

    IF p_backup_tag <> '' THEN
      INSERT INTO public.cap_recompute_backup(run_tag, scope, property_id, event_date, price_at_event, ref_id, col, old_value, new_value)
      SELECT p_backup_tag, 'ledger_sale', p_property_id, h.event_date, h.price_at_event, h.id, 'cap_rate', h.cap_rate, v_fresh.cap_rate
      FROM public.cap_rate_history h
      WHERE h.property_id = p_property_id AND h.event_type='sale'
        AND h.event_date = r.sale_date AND COALESCE(h.price_at_event,-1)=COALESCE(r.sold_price,-1)
        AND h.cap_rate IS DISTINCT FROM v_fresh.cap_rate AND h.cap_rate IS NOT NULL;
    END IF;

    WITH upd AS (
      UPDATE public.cap_rate_history h SET
        cap_rate          = v_fresh.cap_rate,
        rent_at_event     = COALESCE(v_fresh.rent_gross, v_fresh.income_used),
        income_type       = v_fresh.income_type,
        income_source     = v_fresh.income_source,
        income_confidence = v_fresh.income_confidence,
        notes             = COALESCE(v_fresh.income_source,'no_income') || ' (conf: ' || COALESCE(v_fresh.income_confidence,'n/a') || ') [r42 recompute]'
      WHERE h.property_id = p_property_id AND h.event_type='sale'
        AND h.event_date = r.sale_date AND COALESCE(h.price_at_event,-1)=COALESCE(r.sold_price,-1)
        AND h.cap_rate IS NOT NULL AND h.cap_rate IS DISTINCT FROM v_fresh.cap_rate
      RETURNING 1
    ) SELECT v_sale_caps + count(*) INTO v_sale_caps FROM upd;
  END LOOP;

  -- --- listings -> cap_rate_history(event_type='listing') ---
  FOR r IN
    SELECT al.listing_id, COALESCE(al.asking_price, al.original_price) AS price,
           COALESCE(al.last_price_change, al.listing_date) AS evdate
    FROM public.available_listings al
    WHERE al.property_id = p_property_id
      AND COALESCE(al.asking_price, al.original_price) > 0
  LOOP
    v_event_date := COALESCE(r.evdate, CURRENT_DATE);
    SELECT * INTO v_fresh FROM public.gov_compute_cap_rate(p_property_id, r.price, v_event_date);
    IF v_fresh.cap_rate IS NULL THEN CONTINUE; END IF;

    IF p_backup_tag <> '' THEN
      INSERT INTO public.cap_recompute_backup(run_tag, scope, property_id, event_date, price_at_event, ref_id, col, old_value, new_value)
      SELECT p_backup_tag, 'ledger_listing', p_property_id, h.event_date, h.price_at_event, h.id, 'cap_rate', h.cap_rate, v_fresh.cap_rate
      FROM public.cap_rate_history h
      WHERE h.property_id = p_property_id AND h.event_type='listing'
        AND h.event_date = v_event_date AND COALESCE(h.price_at_event,-1)=COALESCE(r.price,-1)
        AND h.cap_rate IS DISTINCT FROM v_fresh.cap_rate AND h.cap_rate IS NOT NULL;
    END IF;

    WITH upd AS (
      UPDATE public.cap_rate_history h SET
        cap_rate          = v_fresh.cap_rate,
        rent_at_event     = COALESCE(v_fresh.rent_gross, v_fresh.income_used),
        income_type       = v_fresh.income_type,
        income_source     = v_fresh.income_source,
        income_confidence = v_fresh.income_confidence,
        notes             = COALESCE(v_fresh.income_source,'no_income') || ' (conf: ' || COALESCE(v_fresh.income_confidence,'n/a') || ') [r42 recompute]'
      WHERE h.property_id = p_property_id AND h.event_type='listing'
        AND h.event_date = v_event_date AND COALESCE(h.price_at_event,-1)=COALESCE(r.price,-1)
        AND h.cap_rate IS NOT NULL AND h.cap_rate IS DISTINCT FROM v_fresh.cap_rate
      RETURNING 1
    ) SELECT v_listing_caps + count(*) INTO v_listing_caps FROM upd;
  END LOOP;

  -- --- property_sale_events -> cap_rate_history(event_type='sale') ---
  FOR r IN
    SELECT pse.sale_event_id, pse.price, COALESCE(pse.sale_date, CURRENT_DATE) AS evdate
    FROM public.property_sale_events pse
    WHERE pse.property_id = p_property_id AND pse.price > 0
  LOOP
    SELECT * INTO v_fresh FROM public.gov_compute_cap_rate(p_property_id, r.price, r.evdate);
    IF v_fresh.cap_rate IS NULL THEN CONTINUE; END IF;

    IF p_backup_tag <> '' THEN
      INSERT INTO public.cap_recompute_backup(run_tag, scope, property_id, event_date, price_at_event, ref_id, col, old_value, new_value)
      SELECT p_backup_tag, 'ledger_sale_event', p_property_id, h.event_date, h.price_at_event, h.id, 'cap_rate', h.cap_rate, v_fresh.cap_rate
      FROM public.cap_rate_history h
      WHERE h.property_id = p_property_id AND h.event_type='sale'
        AND h.event_date = r.evdate AND COALESCE(h.price_at_event,-1)=COALESCE(r.price,-1)
        AND h.cap_rate IS DISTINCT FROM v_fresh.cap_rate AND h.cap_rate IS NOT NULL;
    END IF;

    WITH upd AS (
      UPDATE public.cap_rate_history h SET
        cap_rate          = v_fresh.cap_rate,
        rent_at_event     = COALESCE(v_fresh.rent_gross, v_fresh.income_used),
        income_type       = v_fresh.income_type,
        income_source     = v_fresh.income_source,
        income_confidence = v_fresh.income_confidence,
        notes             = COALESCE(v_fresh.income_source,'no_income') || ' (conf: ' || COALESCE(v_fresh.income_confidence,'n/a') || ') [r42 recompute]'
      WHERE h.property_id = p_property_id AND h.event_type='sale'
        AND h.event_date = r.evdate AND COALESCE(h.price_at_event,-1)=COALESCE(r.price,-1)
        AND h.cap_rate IS NOT NULL AND h.cap_rate IS DISTINCT FROM v_fresh.cap_rate
      RETURNING 1
    ) SELECT v_sale_event_caps + count(*) INTO v_sale_event_caps FROM upd;
  END LOOP;

  RETURN jsonb_build_object(
    'sale_caps', v_sale_caps,
    'listing_caps', v_listing_caps,
    'sale_event_caps', v_sale_event_caps
  );
END $$;

COMMENT ON FUNCTION public.gov_recompute_caps_for_property IS
  'R42: recompute the DERIVED cap_rate_history.cap_rate for a property''s sales/listings/sale_events via the authoritative gov_compute_cap_rate(). Preserves ingested_cap_rate + opex-anchor columns + raw sold_cap_rate. Idempotent. p_backup_tag snapshots prior values to cap_recompute_backup.';

-- ---------------------------------------------------------------------------
-- 2. Extend the nightly propagate-recompute tick to ALSO recompute caps for
--    properties whose rent/NOI changed in the lookback window. Bounded per tick.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.propagate_sales_recompute(p_lookback_hours int DEFAULT 24)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_sale_updated int := 0;
  v_cap_props    int := 0;
  v_cap_caps     int := 0;
  v_cutoff       timestamptz := now() - (p_lookback_hours || ' hours')::interval;
  r RECORD;
  v_one jsonb;
  c_max_props_per_tick constant int := 1500;  -- bound the per-tick cap recompute
BEGIN
  -- (1) Existing sales-propagation backstop (unchanged).
  WITH live_max AS (
    SELECT DISTINCT ON (s.property_id)
      s.property_id, s.sale_date, s.sold_price, s.buyer, s.seller
    FROM public.sales_transactions s
    WHERE s.transaction_state = 'live'
      AND s.sale_date IS NOT NULL
      AND s.property_id IS NOT NULL
    ORDER BY s.property_id, s.sale_date DESC, s.sale_id DESC
  ),
  touched_recent AS (
    SELECT DISTINCT property_id
    FROM public.sales_transactions
    WHERE updated_at > v_cutoff
      AND property_id IS NOT NULL
  ),
  candidates AS (
    SELECT p.property_id, lm.sale_date, lm.sold_price, lm.buyer, lm.seller
    FROM public.properties p
    JOIN live_max lm ON lm.property_id = p.property_id
    WHERE COALESCE(p.latest_deed_date, '1900-01-01'::date) < lm.sale_date
       OR p.property_id IN (SELECT property_id FROM touched_recent)
  ),
  upd_sales AS (
    UPDATE public.properties p SET
      latest_deed_date    = c.sale_date,
      latest_sale_price   = COALESCE(c.sold_price, p.latest_sale_price),
      latest_sale_grantor = COALESCE(c.seller,     p.latest_sale_grantor),
      latest_deed_grantee = COALESCE(c.buyer,      p.latest_deed_grantee),
      updated_at = now()
    FROM candidates c
    WHERE p.property_id = c.property_id
      AND (p.latest_deed_date IS DISTINCT FROM c.sale_date
        OR p.latest_sale_price IS DISTINCT FROM c.sold_price
        OR p.latest_sale_grantor IS DISTINCT FROM c.seller
        OR p.latest_deed_grantee IS DISTINCT FROM c.buyer)
    RETURNING 1
  )
  SELECT count(*) INTO v_sale_updated FROM upd_sales;

  -- (2) R42: cap-rate recompute for properties whose RENT/NOI changed in the
  -- window. Sources: leases.updated_at, property_financials.updated_at,
  -- lease_escalations.created_at (no updated_at on gov lease_escalations).
  FOR r IN
    WITH changed AS (
      SELECT property_id FROM public.leases
        WHERE updated_at > v_cutoff AND property_id IS NOT NULL
      UNION
      SELECT property_id FROM public.property_financials
        WHERE updated_at > v_cutoff AND property_id IS NOT NULL
      UNION
      SELECT l.property_id FROM public.lease_escalations le
        JOIN public.leases l ON l.lease_id = le.lease_id
        WHERE le.created_at > v_cutoff AND l.property_id IS NOT NULL
    )
    SELECT DISTINCT property_id FROM changed
    WHERE property_id IS NOT NULL
    LIMIT c_max_props_per_tick
  LOOP
    v_one := public.gov_recompute_caps_for_property(r.property_id, '');
    v_cap_props := v_cap_props + 1;
    v_cap_caps  := v_cap_caps
                 + COALESCE((v_one->>'sale_caps')::int,0)
                 + COALESCE((v_one->>'listing_caps')::int,0)
                 + COALESCE((v_one->>'sale_event_caps')::int,0);
  END LOOP;

  RETURN jsonb_build_object(
    'sales_propagation_fixed', v_sale_updated,
    'ownership_owner_id_fixed', 0,
    'ownership_skipped_reason', 'gov.ownership_history is point-in-time only (transfer_date)',
    'cap_recompute_props_scanned', v_cap_props,
    'cap_recompute_caps_updated', v_cap_caps,
    'lookback_hours', p_lookback_hours,
    'ran_at', now()
  );
END $$;

-- (cron 'gov-propagate-recompute-tick' already scheduled; CREATE OR REPLACE
--  above changes its behavior on the next nightly run -- no re-schedule needed.)

-- ---------------------------------------------------------------------------
-- 3. Unit 2 -- one-time reversible backfill of the currently-stale set. GATED:
--    p_dry_run defaults TRUE. Dry-run writes NOTHING and returns the before/after
--    diff. A real run snapshots prior values to cap_recompute_backup first.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gov_recompute_caps_backfill(
  p_dry_run    boolean DEFAULT true,
  p_min_drift  numeric DEFAULT 0.005,
  p_max_props  int     DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_tag text := 'r42_backfill_' || to_char(now(),'YYYYMMDDHH24MISS');
  v_props int := 0;
  v_caps  int := 0;
  r RECORD;
  v_one jsonb;
BEGIN
  -- Drifting properties: any live sale/listing/sale_event whose fresh cap differs
  -- from the current derived ledger cap by >= p_min_drift.
  CREATE TEMP TABLE _r42_drift ON COMMIT DROP AS
  WITH ev AS (
    SELECT s.property_id, s.sale_date AS evdate, s.sold_price AS price, 'sale'::text AS et
    FROM public.sales_transactions s
    WHERE COALESCE(s.exclude_from_market_metrics,false)=false
      AND s.property_id IS NOT NULL AND s.sold_price>0 AND s.sale_date IS NOT NULL
    UNION ALL
    SELECT al.property_id, COALESCE(al.last_price_change, al.listing_date), COALESCE(al.asking_price, al.original_price), 'listing'
    FROM public.available_listings al
    WHERE al.property_id IS NOT NULL AND COALESCE(al.asking_price, al.original_price)>0
    UNION ALL
    SELECT pse.property_id, COALESCE(pse.sale_date, CURRENT_DATE), pse.price, 'sale'
    FROM public.property_sale_events pse
    WHERE pse.property_id IS NOT NULL AND pse.price>0
  ),
  drift AS (
    SELECT DISTINCT ev.property_id
    FROM ev
    JOIN public.cap_rate_history h
      ON h.property_id=ev.property_id AND h.event_type::text=ev.et
     AND h.event_date=ev.evdate AND COALESCE(h.price_at_event,-1)=COALESCE(ev.price,-1)
     AND h.cap_rate IS NOT NULL
    JOIN LATERAL public.gov_compute_cap_rate(ev.property_id, ev.price, ev.evdate) fc ON true
    WHERE fc.cap_rate IS NOT NULL AND abs(fc.cap_rate - h.cap_rate) >= p_min_drift
  )
  SELECT property_id FROM drift;

  IF p_dry_run THEN
    -- Non-destructive: return the before/after diff (per drifting event).
    RETURN (
      WITH ev AS (
        SELECT s.property_id, s.sale_date AS evdate, s.sold_price AS price, 'sale'::text AS et
        FROM public.sales_transactions s
        WHERE COALESCE(s.exclude_from_market_metrics,false)=false
          AND s.property_id IS NOT NULL AND s.sold_price>0 AND s.sale_date IS NOT NULL
          AND s.property_id IN (SELECT property_id FROM _r42_drift)
        UNION ALL
        SELECT al.property_id, COALESCE(al.last_price_change, al.listing_date), COALESCE(al.asking_price, al.original_price), 'listing'
        FROM public.available_listings al
        WHERE al.property_id IN (SELECT property_id FROM _r42_drift) AND COALESCE(al.asking_price, al.original_price)>0
        UNION ALL
        SELECT pse.property_id, COALESCE(pse.sale_date, CURRENT_DATE), pse.price, 'sale'
        FROM public.property_sale_events pse
        WHERE pse.property_id IN (SELECT property_id FROM _r42_drift) AND pse.price>0
      ),
      diff AS (
        SELECT ev.property_id, ev.et, ev.evdate, ev.price,
               h.cap_rate AS old_cap, fc.cap_rate AS new_cap,
               round(fc.cap_rate - h.cap_rate, 4) AS delta, fc.income_source AS new_source
        FROM ev
        JOIN public.cap_rate_history h
          ON h.property_id=ev.property_id AND h.event_type::text=ev.et
         AND h.event_date=ev.evdate AND COALESCE(h.price_at_event,-1)=COALESCE(ev.price,-1)
         AND h.cap_rate IS NOT NULL
        JOIN LATERAL public.gov_compute_cap_rate(ev.property_id, ev.price, ev.evdate) fc ON true
        WHERE fc.cap_rate IS NOT NULL AND abs(fc.cap_rate - h.cap_rate) >= p_min_drift
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

  -- Real run: recompute (with snapshot) for each drifting property.
  FOR r IN SELECT property_id FROM _r42_drift LIMIT COALESCE(p_max_props, 1000000) LOOP
    v_one := public.gov_recompute_caps_for_property(r.property_id, v_tag);
    v_props := v_props + 1;
    v_caps  := v_caps
             + COALESCE((v_one->>'sale_caps')::int,0)
             + COALESCE((v_one->>'listing_caps')::int,0)
             + COALESCE((v_one->>'sale_event_caps')::int,0);
  END LOOP;

  RETURN jsonb_build_object(
    'dry_run', false, 'run_tag', v_tag,
    'properties_recomputed', v_props, 'caps_updated', v_caps
  );
END $$;

COMMENT ON FUNCTION public.gov_recompute_caps_backfill IS
  'R42 Unit 2 (GATED): one-time reversible backfill of stale derived caps. p_dry_run defaults TRUE (returns before/after diff, writes nothing). Real run snapshots prior values to cap_recompute_backup (run_tag). Reverse via UPDATE cap_rate_history h SET cap_rate=b.old_value FROM cap_recompute_backup b WHERE b.ref_id=h.id AND b.run_tag=...';
