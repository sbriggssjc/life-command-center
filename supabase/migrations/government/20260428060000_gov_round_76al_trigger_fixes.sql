-- ============================================================================
-- Round 76al — government DB trigger fix
--
-- trg_gov_sale_cap_rate_snapshot was silently failing on every gov
-- sales_transactions insert/update where sold_cap_rate was NULL or out of
-- range, with error:
--
--   55000: record "v_rent" is not assigned yet
--   DETAIL: The tuple structure of a not-yet-assigned record is indeterminate.
--
-- Root cause: v_rent was declared as RECORD but only assigned inside the
-- `IF v_ingested BETWEEN 0.005 AND 0.30 THEN ... SELECT * INTO v_rent ...`
-- block. Outside the block, the INSERT statement referenced v_rent.rent_gross,
-- which crashed when v_rent had never been assigned.
--
-- Fix: change v_rent (RECORD) to v_rent_gross (numeric scalar). Scalars
-- default to NULL when never set, so the COALESCE works safely.
--
-- Apply on government Supabase project (scknotsqkcheojiaewwh).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.trg_gov_sale_cap_rate_snapshot()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_result RECORD;
  v_rent_gross numeric;
  v_event_date date;
  v_ingested numeric;
  v_noi_implied numeric;
  v_opex_implied numeric;
  v_expense_ratio numeric;
  v_anchor_method text;
BEGIN
  IF NEW.property_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.sold_price IS NULL OR NEW.sold_price <= 0 THEN RETURN NEW; END IF;

  v_event_date := COALESCE(NEW.sale_date, CURRENT_DATE);
  v_ingested := NEW.sold_cap_rate;

  SELECT * INTO v_result
  FROM public.gov_compute_cap_rate(NEW.property_id, NEW.sold_price, v_event_date);

  IF v_ingested IS NOT NULL AND v_ingested BETWEEN 0.005 AND 0.30 THEN
    SELECT vr.rent_gross INTO v_rent_gross
    FROM public.gov_validated_rent_at_date(NEW.property_id, v_event_date) vr;

    IF v_rent_gross IS NOT NULL AND v_rent_gross > 0 THEN
      v_noi_implied := NEW.sold_price * v_ingested;
      v_opex_implied := v_rent_gross - v_noi_implied;
      v_expense_ratio := v_opex_implied / v_rent_gross;

      IF v_opex_implied > 0 AND v_expense_ratio BETWEEN 0 AND 0.6 THEN
        v_anchor_method := 'direct';
      ELSE
        v_noi_implied := NULL; v_opex_implied := NULL; v_expense_ratio := NULL;
      END IF;
    END IF;
  END IF;

  IF v_result.cap_rate IS NOT NULL OR v_anchor_method IS NOT NULL THEN
    INSERT INTO public.cap_rate_history (
      property_id, event_type, event_date, rent_at_event, price_at_event,
      cap_rate, income_type, income_source, income_confidence,
      noi_at_event, opex_at_event, expense_ratio_at_event,
      ingested_cap_rate, anchor_method,
      notes, source_file
    ) VALUES (
      NEW.property_id, 'sale', v_event_date,
      COALESCE(v_rent_gross, v_result.income_used),
      NEW.sold_price,
      v_result.cap_rate, v_result.income_type, v_result.income_source, v_result.income_confidence,
      v_noi_implied, v_opex_implied, v_expense_ratio,
      v_ingested, v_anchor_method,
      COALESCE(v_result.income_source, 'no_income') || ' (conf: ' || COALESCE(v_result.income_confidence, 'n/a') || ')'
        || CASE WHEN v_anchor_method IS NOT NULL THEN ' [opex anchor]' ELSE '' END,
      'trg_gov_sale_cap_rate_snapshot'
    )
    ON CONFLICT (property_id, event_type, event_date, COALESCE(price_at_event, -1))
    DO UPDATE SET
      noi_at_event            = COALESCE(EXCLUDED.noi_at_event,           public.cap_rate_history.noi_at_event),
      opex_at_event           = COALESCE(EXCLUDED.opex_at_event,          public.cap_rate_history.opex_at_event),
      expense_ratio_at_event  = COALESCE(EXCLUDED.expense_ratio_at_event, public.cap_rate_history.expense_ratio_at_event),
      ingested_cap_rate       = COALESCE(EXCLUDED.ingested_cap_rate,      public.cap_rate_history.ingested_cap_rate),
      anchor_method           = COALESCE(EXCLUDED.anchor_method,          public.cap_rate_history.anchor_method);

    IF NEW.sold_cap_rate IS NULL AND v_result.cap_rate IS NOT NULL THEN
      NEW.sold_cap_rate := v_result.cap_rate;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
