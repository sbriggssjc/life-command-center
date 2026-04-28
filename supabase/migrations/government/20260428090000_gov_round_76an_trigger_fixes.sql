-- ============================================================================
-- Round 76an — gov DB trigger sweep
--
-- Two more bugs found mirroring those fixed in dia in Round 76al:
--
-- 1. trg_gov_sale_event_cap_rate_snapshot: same v_rent unassigned-RECORD
--    crash as the gov sale_cap_rate_snapshot fixed in Round 76al. Was
--    silently failing on every property_sale_events insert/update where
--    cap_rate was NULL or out of range. Same fix: replace v_rent (RECORD)
--    with v_rent_gross (numeric scalar).
--
-- 2. trg_contact_auto_link: same FK race as the dia version fixed in
--    Round 76al. BEFORE INSERT/UPDATE on contacts tried to UPDATE
--    recorded_owners.contact_id = NEW.contact_id from inside the trigger,
--    before the contact row was committed. Split into BEFORE (mutates NEW)
--    + AFTER (updates related tables now that contact exists).
--
-- Apply on government Supabase project (scknotsqkcheojiaewwh).
-- ============================================================================

-- ── 1. trg_gov_sale_event_cap_rate_snapshot fix ───────────────────────────
CREATE OR REPLACE FUNCTION public.trg_gov_sale_event_cap_rate_snapshot()
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
  IF NEW.price IS NULL OR NEW.price <= 0 THEN RETURN NEW; END IF;

  v_event_date := COALESCE(NEW.sale_date, CURRENT_DATE);
  v_ingested := NEW.cap_rate;

  SELECT * INTO v_result
  FROM public.gov_compute_cap_rate(NEW.property_id, NEW.price, v_event_date);

  IF v_ingested IS NOT NULL AND v_ingested BETWEEN 0.005 AND 0.30 THEN
    SELECT vr.rent_gross INTO v_rent_gross
    FROM public.gov_validated_rent_at_date(NEW.property_id, v_event_date) vr;

    IF v_rent_gross IS NOT NULL AND v_rent_gross > 0 THEN
      v_noi_implied := NEW.price * v_ingested;
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
      ingested_cap_rate, anchor_method, notes, source_file
    ) VALUES (
      NEW.property_id, 'sale', v_event_date,
      COALESCE(v_rent_gross, v_result.income_used),
      NEW.price,
      v_result.cap_rate, v_result.income_type, v_result.income_source, v_result.income_confidence,
      v_noi_implied, v_opex_implied, v_expense_ratio,
      v_ingested, v_anchor_method,
      COALESCE(v_result.income_source, 'no_income') || ' (conf: ' || COALESCE(v_result.income_confidence, 'n/a') || ')'
        || CASE WHEN v_anchor_method IS NOT NULL THEN ' [opex anchor]' ELSE '' END,
      'trg_gov_sale_event_cap_rate_snapshot'
    )
    ON CONFLICT (property_id, event_type, event_date, COALESCE(price_at_event, -1))
    DO UPDATE SET
      noi_at_event           = COALESCE(EXCLUDED.noi_at_event,           public.cap_rate_history.noi_at_event),
      opex_at_event          = COALESCE(EXCLUDED.opex_at_event,          public.cap_rate_history.opex_at_event),
      expense_ratio_at_event = COALESCE(EXCLUDED.expense_ratio_at_event, public.cap_rate_history.expense_ratio_at_event),
      ingested_cap_rate      = COALESCE(EXCLUDED.ingested_cap_rate,      public.cap_rate_history.ingested_cap_rate),
      anchor_method          = COALESCE(EXCLUDED.anchor_method,          public.cap_rate_history.anchor_method);

    IF NEW.cap_rate IS NULL AND v_result.cap_rate IS NOT NULL THEN
      NEW.cap_rate := v_result.cap_rate;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 2. trg_contact_auto_link split ────────────────────────────────────────
DROP TRIGGER IF EXISTS contact_auto_link ON public.contacts;
DROP TRIGGER IF EXISTS trg_contact_auto_link ON public.contacts;

CREATE OR REPLACE FUNCTION public.trg_contact_auto_link_before()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_true_owner_id UUID; v_rec_owner_id UUID;
BEGIN
  NEW.normalized_name := normalize_entity_name(NEW.name);
  NEW.updated_at := now();

  IF NEW.true_owner_id IS NULL AND NEW.normalized_name IS NOT NULL AND NEW.normalized_name != '' THEN
    SELECT a.entity_id INTO v_true_owner_id FROM contact_aliases a
    WHERE a.alias_name = NEW.normalized_name AND a.entity_table = 'true_owners' AND a.entity_id IS NOT NULL LIMIT 1;
    IF v_true_owner_id IS NOT NULL THEN NEW.true_owner_id := v_true_owner_id; END IF;
  END IF;
  IF NEW.true_owner_id IS NULL AND NEW.normalized_name IS NOT NULL AND NEW.normalized_name != '' THEN
    SELECT t.true_owner_id INTO v_true_owner_id FROM true_owners t
    WHERE normalize_entity_name(t.name) = NEW.normalized_name LIMIT 1;
    IF v_true_owner_id IS NOT NULL THEN NEW.true_owner_id := v_true_owner_id; END IF;
  END IF;

  IF NEW.recorded_owner_id IS NULL AND NEW.normalized_name IS NOT NULL AND NEW.normalized_name != '' THEN
    SELECT a.entity_id INTO v_rec_owner_id FROM contact_aliases a
    WHERE a.alias_name = NEW.normalized_name AND a.entity_table = 'recorded_owners' AND a.entity_id IS NOT NULL LIMIT 1;
    IF v_rec_owner_id IS NOT NULL THEN NEW.recorded_owner_id := v_rec_owner_id; END IF;
  END IF;
  IF NEW.recorded_owner_id IS NULL AND NEW.normalized_name IS NOT NULL AND NEW.normalized_name != '' THEN
    SELECT r.recorded_owner_id INTO v_rec_owner_id FROM recorded_owners r
    WHERE normalize_entity_name(r.name) = NEW.normalized_name LIMIT 1;
    IF v_rec_owner_id IS NOT NULL THEN NEW.recorded_owner_id := v_rec_owner_id; END IF;
  END IF;

  IF NEW.property_id IS NULL AND NEW.true_owner_id IS NOT NULL THEN
    SELECT p.property_id INTO NEW.property_id FROM properties p WHERE p.true_owner_id = NEW.true_owner_id LIMIT 1;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.trg_contact_auto_link_after()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.true_owner_id IS NOT NULL THEN
    UPDATE true_owners SET contact_id = NEW.contact_id
     WHERE true_owner_id = NEW.true_owner_id AND contact_id IS NULL;
  END IF;
  IF NEW.recorded_owner_id IS NOT NULL THEN
    UPDATE recorded_owners SET contact_id = NEW.contact_id
     WHERE recorded_owner_id = NEW.recorded_owner_id AND contact_id IS NULL;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER contact_auto_link_before BEFORE INSERT OR UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.trg_contact_auto_link_before();
CREATE TRIGGER contact_auto_link_after  AFTER  INSERT OR UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.trg_contact_auto_link_after();
