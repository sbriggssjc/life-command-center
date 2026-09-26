-- DUP-RECORDS1 (2026-09-26): merge duplicate dia property rows only on TWO independent signals, else card.
--
-- Scott's rule (2026-09-24, Saginaw): merge and consolidate into the most accurate source of truth for all
-- history, through the reversible merge. Where the evidence is not unambiguous, queue a twin card.
--
-- Measured live before this file (2026-09-26):
--   Kissimmee  24669 (CMS 102569, "802 John Young Parkway") / 37624 ("802 N John Young Pky", sale 14880)
--              / 37696 ("For Sale | 802 N John Young Pky", listing 12235). 37624 and 37696 share parcel
--              21-25-29-1908-0001-0010 and ONE LCC asset entity (932d0350). Signals vs 24669: address
--              + year_built 2002 / lot 31,799 vs 31,755 sf.                                     -> merge
--   Oak Forest 25570 (CMS 142764, "5340A W 159th St", listing 12686) / 38853 ("5340 159th St", sale
--              14875). Signals: address (civic 5340, suite letter dropped) + year 2013 / lot 78,408 vs
--              78,914 sf. Building size disagrees (7,310 vs 3,520): kept from the CMS anchor.   -> merge
--   Birmingham 35815 ("1929 324 Ave N", listing 11885) / 51242 ("1929 32nd Ave N", sale 15136). One LCC
--              entity (647da67e), identical 8,132 sf / 23,967 sf lot / 1999, seller LLC named for
--              "1929 32nd Avenue". But the street is a typo and the parcels differ by a leading digit
--              (12200143027001000 vs 22-00-14-3-027-001.000): ONE signal by this rule.        -> card
--   Dayton     27901 (CMS 362524, "1431 Business Center Ct", 13,421 sf) / 38412 ("1403-1431 Business
--              Center Ct", 11,920 sf, "Vacant Medical Office"). No parcel on either, no CoStar property
--              id, the addresses differ (a range vs a civic), sizes differ.                    -> card
--              The two ACTIVE listings are one offering: the flyer behind 15281 (LCC intake 0e9cf33c)
--              names 1431 Business Center Court, DaVita, 7.4% cap, $156/sf, Dan Cooper; 15006 is 7.40%,
--              $156.88/sf, Dan Cooper. Listing kept on 27901 (the property the flyer describes).
--
-- Signals (dia_dup1_pair_signals), each independent of the others:
--   parcel   — digits-only APN keys equal (>= 8 digits).
--   address  — same state + city + street key (dia_recon2_street_twin_key, plus: text before a '|' dropped,
--              a unit letter on the civic number dropped, pky -> pkwy).
--   medicare — both carry the same CCN.
--   physical — same year_built AND lot_sf within 1%. (Building size is NOT used: sources disagree on it.)
-- Coordinates are NOT a signal: dia geocodes from the address, so equal lat/long repeats the address.
-- Vetoes send the pair to a card whatever the signal count:
--   ccn_conflict      two different CCNs (co-located clinics are not twins; Indio 22701/24421);
--   operator_conflict two different operators — the curated column, the tenant text only where it is
--                     blank, legacy brands normalized (RCG/Qualicenters read as Fresenius; Altus DaVita vs USRC);
--   address_conflict  both sides name a street and not the same one — street key, directional or unit
--                     letter; never the city text (Pasco "Rd 68" vs "Rd 76" on one parcel;
--                     South Holland "178 E 162nd" vs "178 W 162nd").
-- A trailing city name is dropped before the street compare ("1208 Scottsville Rd Rochester").
--
-- dia_dup1_merge_pair(keep, drop, batch, dry_run default true):
--   < 2 signals -> a card in dia_property_twin_review (classification 'review_dup_records1').
--   >= 2 signals -> (1) fill the keep row's blanks from the drop row; (2) when both carry an active
--   listing, fill the keep listing's blanks from the drop listing and supersede the drop listing
--   (dia_merge_property would otherwise DELETE it, and dia_unmerge_property cannot bring a deleted
--   listing back); (3) dia_merge_property_reversible; (4) dia_reconcile_listing_sales on the keep row
--   (a listing and its sale now on one property close through the parity rule, never by guess);
--   (5) supersede listing↔sale reviews that step 4 settled.
-- dia_dup1_supersede_listing(keep_listing, drop_listing, batch, dry_run) — steps (2) alone, for one
--   offering listed twice on two properties that are not (yet) proven the same (Dayton).
-- Every write is in dia_dup1_merge_log. Undo: dia_dup1_restore(batch).
-- v_dia_dup1_property_pairs — the sizing surface: live pairs sharing parcel or address key, with signals.

BEGIN;

CREATE OR REPLACE FUNCTION public.dia_dup1_street_key(p_addr text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT nullif(btrim(regexp_replace(regexp_replace(regexp_replace(
           coalesce(public.dia_recon2_street_twin_key(regexp_replace(p_addr, '^.*\|\s*', '')), ''),
           '^(\d+)[a-z]\y', '\1'),
           '\ypky\y', 'pkwy', 'g'),
           '\s+', ' ', 'g')), '')
$fn$;

CREATE OR REPLACE FUNCTION public.dia_dup1_apn_key(p_apn text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE WHEN length(k) >= 8 THEN k END
    FROM (SELECT ltrim(regexp_replace(coalesce(p_apn, ''), '\D', '', 'g'), '0') AS k) q
$fn$;

-- Pure: the evidence comes in as arguments so the rule can be tested without a table.
CREATE OR REPLACE FUNCTION public.dia_dup1_signals(
  a_state text, a_city text, a_address text, a_parcel text, a_medicare text, a_year integer, a_lot numeric,
  b_state text, b_city text, b_address text, b_parcel text, b_medicare text, b_year integer, b_lot numeric)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_parcel boolean; v_address boolean; v_medicare boolean; v_physical boolean;
  a_st text := regexp_replace(coalesce(a_address, ''), '^.*\|\s*', '');
  b_st text := regexp_replace(coalesce(b_address, ''), '^.*\|\s*', '');
  ka text; kb text; da text; db text; la text; lb text;
BEGIN
  -- A trailing city name is part of the capture, not the street ("1208 Scottsville Rd Rochester").
  IF a_city IS NOT NULL AND lower(btrim(a_st)) LIKE '% ' || lower(btrim(a_city)) THEN
    a_st := left(btrim(a_st), length(btrim(a_st)) - length(btrim(a_city)) - 1);
  END IF;
  IF b_city IS NOT NULL AND lower(btrim(b_st)) LIKE '% ' || lower(btrim(b_city)) THEN
    b_st := left(btrim(b_st), length(btrim(b_st)) - length(btrim(b_city)) - 1);
  END IF;
  ka := public.dia_dup1_street_key(a_st);
  kb := public.dia_dup1_street_key(b_st);
  -- The key drops directionals and a unit letter; two DIFFERENT ones on the two sides are two places
  -- ("178 E 162nd St" / "178 W 162nd St"; "5340A" / "5340B").
  da := substring(public.dia_normalize_address(a_st) FROM '^\s*\d+[a-z]?\s+(ne|nw|se|sw|n|s|e|w)\M');
  db := substring(public.dia_normalize_address(b_st) FROM '^\s*\d+[a-z]?\s+(ne|nw|se|sw|n|s|e|w)\M');
  la := upper(substring(a_st FROM '^\s*\d+([A-Za-z])\y'));
  lb := upper(substring(b_st FROM '^\s*\d+([A-Za-z])\y'));

  v_parcel := public.dia_dup1_apn_key(a_parcel) IS NOT NULL
              AND public.dia_dup1_apn_key(a_parcel) = public.dia_dup1_apn_key(b_parcel);
  v_address := upper(btrim(a_state)) = upper(btrim(b_state))
               AND lower(btrim(a_city)) = lower(btrim(b_city))
               AND ka ~ '^\d' AND ka = kb
               AND NOT (da IS NOT NULL AND db IS NOT NULL AND da <> db)
               AND NOT (la IS NOT NULL AND lb IS NOT NULL AND la <> lb);
  v_medicare := nullif(btrim(a_medicare), '') IS NOT NULL AND btrim(a_medicare) = btrim(b_medicare);
  v_physical := a_year IS NOT NULL AND a_year = b_year
                AND a_lot > 0 AND b_lot > 0
                AND abs(a_lot - b_lot) <= 0.01 * greatest(a_lot, b_lot);
  RETURN jsonb_build_object(
    'parcel', coalesce(v_parcel, false), 'address', coalesce(v_address, false),
    'medicare', coalesce(v_medicare, false), 'physical', coalesce(v_physical, false),
    -- Both sides name a street and they are not the same one: a contradicting fact, not a missing one.
    -- Street-level only: a city spelled two ways ("Holly Springs (Mount Pleasant)") is not a conflict.
    'address_conflict', coalesce(ka ~ '^\d' AND kb ~ '^\d'
                                 AND (ka <> kb OR (da IS NOT NULL AND db IS NOT NULL AND da <> db)
                                      OR (la IS NOT NULL AND lb IS NOT NULL AND la <> lb)), false),
    'n', (coalesce(v_parcel, false)::int + coalesce(v_address, false)::int
          + coalesce(v_medicare, false)::int + coalesce(v_physical, false)::int));
END
$fn$;

-- Vetoes ride beside the signals: co-located is not twin (a CCN or an operator on each side that
-- disagree means two clinics at one address). A veto sends the pair to a card whatever the signal count.
CREATE OR REPLACE FUNCTION public.dia_dup1_pair_signals(p_a integer, p_b integer)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT public.dia_dup1_signals(
           a.state, a.city, a.address, a.parcel_number, a.medicare_id, a.year_built, a.lot_sf::numeric,
           b.state, b.city, b.address, b.parcel_number, b.medicare_id, b.year_built, b.lot_sf::numeric)
         || jsonb_build_object(
           'ccn_conflict', (nullif(btrim(a.medicare_id), '') IS NOT NULL AND nullif(btrim(b.medicare_id), '') IS NOT NULL
                            AND btrim(a.medicare_id) <> btrim(b.medicare_id)),
           -- The curated operator column decides; the tenant text only stands in when it is blank.
           'operator_conflict', coalesce(oa.op IS NOT NULL AND ob.op IS NOT NULL AND oa.op <> 'vacant'
                                         AND ob.op <> 'vacant' AND oa.op <> ob.op, false))
    FROM public.properties a
    CROSS JOIN public.properties b
    CROSS JOIN LATERAL (SELECT public.dia_normalize_operator(coalesce(nullif(btrim(a.operator), ''), a.tenant)) AS op) oa
    CROSS JOIN LATERAL (SELECT public.dia_normalize_operator(coalesce(nullif(btrim(b.operator), ''), b.tenant)) AS op) ob
   WHERE a.property_id = p_a AND b.property_id = p_b
$fn$;

CREATE TABLE IF NOT EXISTS public.dia_dup1_merge_log (
  log_id      bigserial PRIMARY KEY,
  batch_tag   text NOT NULL,
  action      text NOT NULL CHECK (action IN ('fill_keep', 'fill_listing', 'supersede_listing',
                                              'merge', 'reconcile', 'review_superseded', 'card')),
  keep_id     integer,
  drop_id     integer,
  listing_id  integer,
  signals     jsonb,
  prior       jsonb,
  detail      jsonb,
  backup_id   bigint,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  restored_at timestamptz
);
ALTER TABLE public.dia_dup1_merge_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dia_dup1_merge_log FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.dia_dup1_merge_log_log_id_seq FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.dia_dup1_merge_log TO service_role;
DROP POLICY IF EXISTS service_role_all_dia_dup1_merge_log ON public.dia_dup1_merge_log;
CREATE POLICY service_role_all_dia_dup1_merge_log ON public.dia_dup1_merge_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Fill one listing's blanks from another and take the other off market as a duplicate. Logged.
CREATE OR REPLACE FUNCTION public.dia_dup1_supersede_listing(
  p_keep_listing integer, p_drop_listing integer, p_batch text, p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE k record; d record; v_fill jsonb := '{}'::jsonb; v_prior jsonb;
BEGIN
  IF p_keep_listing = p_drop_listing THEN RAISE EXCEPTION 'keep and drop listing must differ'; END IF;
  SELECT * INTO k FROM public.available_listings WHERE listing_id = p_keep_listing FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'listing % not found', p_keep_listing; END IF;
  SELECT * INTO d FROM public.available_listings WHERE listing_id = p_drop_listing FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'listing % not found', p_drop_listing; END IF;
  IF d.is_active IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'drop_listing_not_active', 'drop_listing', p_drop_listing);
  END IF;

  -- initial_price is deliberately not filled: the capture-time trigger owns the original ask, and a
  -- second capture's "initial" is often a different field (15006 carries 799,900 against a 2,037,500 ask).
  v_fill := jsonb_strip_nulls(jsonb_build_object(
    'last_price',     CASE WHEN k.last_price IS NULL THEN d.last_price END,
    'cap_rate',       CASE WHEN k.cap_rate IS NULL THEN d.cap_rate END,
    'seller_name',    CASE WHEN nullif(btrim(k.seller_name), '') IS NULL THEN d.seller_name END,
    'listing_broker', CASE WHEN nullif(btrim(k.listing_broker), '') IS NULL THEN d.listing_broker END,
    'listing_broker_id', CASE WHEN k.listing_broker_id IS NULL THEN d.listing_broker_id END,
    'broker_email',   CASE WHEN nullif(btrim(k.broker_email), '') IS NULL THEN d.broker_email END,
    'price_per_sf',   CASE WHEN k.price_per_sf IS NULL THEN d.price_per_sf END,
    'listing_url',    CASE WHEN nullif(btrim(k.listing_url), '') IS NULL THEN d.listing_url END));

  IF p_dry_run THEN
    RETURN jsonb_build_object('ok', true, 'dry_run', true, 'keep_listing', p_keep_listing,
                              'drop_listing', p_drop_listing, 'would_fill', v_fill);
  END IF;

  IF v_fill <> '{}'::jsonb THEN
    INSERT INTO public.dia_dup1_merge_log (batch_tag, action, keep_id, listing_id, prior, detail)
    VALUES (p_batch, 'fill_listing', k.property_id, p_keep_listing,
            (SELECT jsonb_object_agg(key, to_jsonb(k) -> key) FROM jsonb_object_keys(v_fill) key), v_fill);
    UPDATE public.available_listings l SET
      last_price        = coalesce(l.last_price, d.last_price),
      cap_rate          = coalesce(l.cap_rate, d.cap_rate),
      seller_name       = coalesce(nullif(btrim(l.seller_name), ''), d.seller_name),
      listing_broker    = coalesce(nullif(btrim(l.listing_broker), ''), d.listing_broker),
      listing_broker_id = coalesce(l.listing_broker_id, d.listing_broker_id),
      broker_email      = coalesce(nullif(btrim(l.broker_email), ''), d.broker_email),
      price_per_sf      = coalesce(l.price_per_sf, d.price_per_sf),
      listing_url       = coalesce(nullif(btrim(l.listing_url), ''), d.listing_url)
     WHERE l.listing_id = p_keep_listing;
  END IF;

  v_prior := jsonb_build_object('status', d.status, 'is_active', d.is_active,
                                'off_market_date', d.off_market_date, 'off_market_reason', d.off_market_reason,
                                'exclude_from_listing_metrics', d.exclude_from_listing_metrics, 'notes', d.notes);
  INSERT INTO public.dia_dup1_merge_log (batch_tag, action, keep_id, drop_id, listing_id, prior, detail)
  VALUES (p_batch, 'supersede_listing', k.property_id, d.property_id, p_drop_listing, v_prior,
          jsonb_build_object('kept_listing', p_keep_listing));
  UPDATE public.available_listings l SET
    status = 'superseded', is_active = false,
    off_market_date = coalesce(l.off_market_date, current_date),
    off_market_reason = 'duplicate', exclude_from_listing_metrics = true,
    notes = coalesce(nullif(l.notes, '') || E'\n', '') || '[' || p_batch || ' ' || current_date
            || '] DUP-RECORDS1: same offering as listing ' || p_keep_listing
   WHERE l.listing_id = p_drop_listing;

  RETURN jsonb_build_object('ok', true, 'dry_run', false, 'keep_listing', p_keep_listing,
                            'drop_listing', p_drop_listing, 'filled', v_fill);
END
$fn$;

DROP FUNCTION IF EXISTS public.dia_dup1_merge_pair(integer, integer, text, boolean, text);
CREATE OR REPLACE FUNCTION public.dia_dup1_merge_pair(
  p_keep integer, p_drop integer, p_batch text, p_dry_run boolean DEFAULT true, p_card_note text DEFAULT NULL,
  p_human_confirmed boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  k record; d record; v_sig jsonb; v_fill jsonb; v_backup bigint; v_keep_listing integer;
  v_dl record; v_listings jsonb := '[]'::jsonb; v_rec record; v_rev record; v_closed jsonb := '[]'::jsonb;
  v_start timestamptz; v_close_ids jsonb;
BEGIN
  IF p_keep IS NULL OR p_drop IS NULL OR p_keep = p_drop THEN
    RAISE EXCEPTION 'dia_dup1_merge_pair: keep/drop must be non-null and differ (% / %)', p_keep, p_drop;
  END IF;
  SELECT * INTO k FROM public.properties WHERE property_id = p_keep;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'keep_not_found', 'keep', p_keep); END IF;
  SELECT * INTO d FROM public.properties WHERE property_id = p_drop;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'drop_not_found', 'drop', p_drop); END IF;

  v_sig := public.dia_dup1_pair_signals(p_keep, p_drop);

  -- A human verdict on a card (Decision Center) is the second signal.
  IF ((v_sig->>'n')::int < 2 OR coalesce((v_sig->>'ccn_conflict')::boolean, false)
      OR coalesce((v_sig->>'operator_conflict')::boolean, false)
      OR coalesce((v_sig->>'address_conflict')::boolean, false)) AND NOT p_human_confirmed THEN
    IF NOT p_dry_run THEN
      INSERT INTO public.dia_property_twin_review
        (shadow_property_id, anchor_property_id, classification, detail, batch_tag)
      VALUES (p_drop, p_keep, 'review_dup_records1',
              jsonb_strip_nulls(jsonb_build_object('detector', 'dup_records1', 'signals', v_sig,
                'anchor_address', k.address, 'shadow_address', d.address, 'note', p_card_note)),
              p_batch)
      ON CONFLICT (shadow_property_id, anchor_property_id) DO UPDATE
         SET classification = excluded.classification, detail = excluded.detail
       WHERE public.dia_property_twin_review.status = 'pending';
      INSERT INTO public.dia_dup1_merge_log (batch_tag, action, keep_id, drop_id, signals, detail)
      VALUES (p_batch, 'card', p_keep, p_drop, v_sig, jsonb_strip_nulls(jsonb_build_object('note', p_card_note)));
    END IF;
    RETURN jsonb_build_object('ok', true, 'outcome', 'card', 'dry_run', p_dry_run,
                              'keep', p_keep, 'drop', p_drop, 'signals', v_sig);
  END IF;

  -- The keep row takes the drop row's facts only where it has none. medicare_id is not filled here:
  -- the CMS link owns it.
  v_fill := jsonb_strip_nulls(jsonb_build_object(
    'parcel_number',       CASE WHEN nullif(btrim(k.parcel_number), '') IS NULL THEN d.parcel_number END,
    'zip_code',            CASE WHEN nullif(btrim(k.zip_code), '') IS NULL THEN d.zip_code END,
    'county',              CASE WHEN nullif(btrim(k.county), '') IS NULL THEN d.county END,
    'building_size',       CASE WHEN k.building_size IS NULL THEN d.building_size END,
    'land_area',           CASE WHEN k.land_area IS NULL THEN d.land_area END,
    'lot_sf',              CASE WHEN k.lot_sf IS NULL THEN d.lot_sf END,
    'year_built',          CASE WHEN k.year_built IS NULL THEN d.year_built END,
    'year_renovated',      CASE WHEN k.year_renovated IS NULL THEN d.year_renovated END,
    'recorded_owner_id',   CASE WHEN k.recorded_owner_id IS NULL THEN d.recorded_owner_id END,
    'true_owner_id',       CASE WHEN k.true_owner_id IS NULL THEN d.true_owner_id END,
    'recorded_owner_name', CASE WHEN nullif(btrim(k.recorded_owner_name), '') IS NULL THEN d.recorded_owner_name END,
    'true_owner_name',     CASE WHEN nullif(btrim(k.true_owner_name), '') IS NULL THEN d.true_owner_name END,
    'tenant',              CASE WHEN nullif(btrim(k.tenant), '') IS NULL THEN d.tenant END,
    'operator',            CASE WHEN nullif(btrim(k.operator), '') IS NULL THEN d.operator END));

  SELECT listing_id INTO v_keep_listing FROM public.available_listings
   WHERE property_id = p_keep AND is_active IS TRUE
   ORDER BY (last_price IS NOT NULL) DESC, on_market_date DESC NULLS LAST, listing_id DESC LIMIT 1;

  IF p_dry_run THEN
    RETURN jsonb_build_object('ok', true, 'outcome', 'would_merge', 'dry_run', true, 'keep', p_keep,
      'drop', p_drop, 'signals', v_sig, 'would_fill', v_fill, 'keep_listing', v_keep_listing,
      'drop_active_listings', (SELECT coalesce(jsonb_agg(listing_id), '[]'::jsonb) FROM public.available_listings
                                WHERE property_id = p_drop AND is_active IS TRUE),
      'drop_sales', (SELECT coalesce(jsonb_agg(sale_id), '[]'::jsonb) FROM public.sales_transactions
                      WHERE property_id = p_drop));
  END IF;

  IF v_fill <> '{}'::jsonb THEN
    INSERT INTO public.dia_dup1_merge_log (batch_tag, action, keep_id, drop_id, signals, prior, detail)
    VALUES (p_batch, 'fill_keep', p_keep, p_drop, v_sig,
            (SELECT jsonb_object_agg(key, to_jsonb(k) -> key) FROM jsonb_object_keys(v_fill) key), v_fill);
    UPDATE public.properties p SET
      parcel_number       = coalesce(nullif(btrim(p.parcel_number), ''), d.parcel_number),
      zip_code            = coalesce(nullif(btrim(p.zip_code), ''), d.zip_code),
      county              = coalesce(nullif(btrim(p.county), ''), d.county),
      building_size       = coalesce(p.building_size, d.building_size),
      land_area           = coalesce(p.land_area, d.land_area),
      lot_sf              = coalesce(p.lot_sf, d.lot_sf),
      year_built          = coalesce(p.year_built, d.year_built),
      year_renovated      = coalesce(p.year_renovated, d.year_renovated),
      recorded_owner_id   = coalesce(p.recorded_owner_id, d.recorded_owner_id),
      true_owner_id       = coalesce(p.true_owner_id, d.true_owner_id),
      recorded_owner_name = coalesce(nullif(btrim(p.recorded_owner_name), ''), d.recorded_owner_name),
      true_owner_name     = coalesce(nullif(btrim(p.true_owner_name), ''), d.true_owner_name),
      tenant              = coalesce(nullif(btrim(p.tenant), ''), d.tenant),
      operator            = coalesce(nullif(btrim(p.operator), ''), d.operator)
     WHERE p.property_id = p_keep;
  END IF;

  -- One offering listed on both rows: keep one, supersede the other before the merge can delete it.
  IF v_keep_listing IS NOT NULL THEN
    FOR v_dl IN SELECT listing_id FROM public.available_listings
                 WHERE property_id = p_drop AND is_active IS TRUE ORDER BY listing_id LOOP
      v_listings := v_listings || public.dia_dup1_supersede_listing(v_keep_listing, v_dl.listing_id, p_batch, false);
    END LOOP;
  END IF;

  v_start := clock_timestamp();
  v_backup := public.dia_merge_property_reversible(p_keep, p_drop, p_batch);
  INSERT INTO public.dia_dup1_merge_log (batch_tag, action, keep_id, drop_id, signals, backup_id, detail)
  VALUES (p_batch, 'merge', p_keep, p_drop, v_sig, v_backup,
          (SELECT rewired FROM public.dia_property_merge_backup WHERE backup_id = v_backup));

  UPDATE public.dia_property_twin_review
     SET status = 'merged', backup_id = v_backup, resolved_at = now(),
         resolution_note = 'merged via dia_dup1_merge_pair batch ' || p_batch
   WHERE status = 'pending'
     AND ((shadow_property_id = p_drop AND anchor_property_id = p_keep)
       OR (shadow_property_id = p_keep AND anchor_property_id = p_drop));

  -- A listing and its sale now on one property settle through the parity rule, never by guess.
  FOR v_rec IN SELECT * FROM public.dia_reconcile_listing_sales(ARRAY[p_keep], false, p_batch) LOOP
    v_closed := v_closed || to_jsonb(v_rec);
  END LOOP;
  -- The parity sale trigger usually closes the listing during the merge itself (batch 'sale_trigger').
  -- Record every close on this property since the merge began, whoever wrote it, so the undo can reverse it.
  SELECT coalesce(jsonb_agg(c.log_id ORDER BY c.log_id), '[]'::jsonb) INTO v_close_ids
    FROM public.dia_listing_sale_close_log c
    JOIN public.available_listings al ON al.listing_id = c.listing_id
   WHERE al.property_id = p_keep AND c.applied_at >= v_start AND c.restored_at IS NULL;
  IF jsonb_array_length(v_closed) > 0 OR jsonb_array_length(v_close_ids) > 0 THEN
    INSERT INTO public.dia_dup1_merge_log (batch_tag, action, keep_id, detail)
    VALUES (p_batch, 'reconcile', p_keep, jsonb_build_object('rows', v_closed, 'close_log_ids', v_close_ids));
  END IF;

  -- Reviews that only existed because the listing and the sale sat on two rows.
  FOR v_rev IN
    SELECT q.review_id, q.listing_id, q.sale_id, al.is_active
      FROM public.dia_listing_sale_review q
      JOIN public.available_listings al ON al.listing_id = q.listing_id
      JOIN public.sales_transactions s ON s.sale_id = q.sale_id
     WHERE q.status = 'open' AND al.property_id = p_keep AND s.property_id = p_keep
       AND (al.is_active IS NOT TRUE)
  LOOP
    UPDATE public.dia_listing_sale_review
       SET status = 'superseded', resolved_at = now(), decided_by = 'auto:dup_records1',
           decision = jsonb_build_object('decision', 'auto_supersede', 'at', now(),
                                         'auto_class', 'merged_onto_one_property', 'batch', p_batch,
                                         'backup_id', v_backup)
     WHERE review_id = v_rev.review_id;
    INSERT INTO public.dia_dup1_merge_log (batch_tag, action, keep_id, listing_id, detail)
    VALUES (p_batch, 'review_superseded', p_keep, v_rev.listing_id,
            jsonb_build_object('review_id', v_rev.review_id, 'sale_id', v_rev.sale_id));
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'outcome', 'merged', 'dry_run', false, 'keep', p_keep, 'drop', p_drop,
    'signals', v_sig, 'filled', v_fill, 'listings', v_listings, 'backup_id', v_backup, 'reconciled', v_closed);
END
$fn$;

-- Undo a batch, newest write first.
CREATE OR REPLACE FUNCTION public.dia_dup1_restore(p_batch text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE r record; v_n integer := 0; v_col text;
BEGIN
  FOR r IN SELECT * FROM public.dia_dup1_merge_log
            WHERE batch_tag = p_batch AND restored_at IS NULL ORDER BY log_id DESC LOOP
    IF r.action = 'review_superseded' THEN
      UPDATE public.dia_listing_sale_review
         SET status = 'open', resolved_at = NULL, decided_by = NULL,
             decision = coalesce(decision, '{}'::jsonb) || jsonb_build_object('undone_at', now(), 'undone_batch', p_batch)
       WHERE review_id = (r.detail->>'review_id')::bigint AND status = 'superseded';
    ELSIF r.action = 'reconcile' THEN
      -- Reverse exactly the closes recorded at merge time (the trigger's 'sale_trigger' rows included).
      PERFORM set_config('lcc.listing_sale_reconcile_off', 'on', true);
      UPDATE public.available_listings al
         SET status = c.prior->>'status', is_active = (c.prior->>'is_active')::boolean,
             off_market_date = (c.prior->>'off_market_date')::date,
             off_market_reason = c.prior->>'off_market_reason',
             sale_transaction_id = (c.prior->>'sale_transaction_id')::integer,
             sold_date = (c.prior->>'sold_date')::date, sold_price = (c.prior->>'sold_price')::numeric
        FROM public.dia_listing_sale_close_log c
       WHERE c.listing_id = al.listing_id AND c.restored_at IS NULL AND c.action <> 'stale_verify'
         AND c.log_id IN (SELECT jsonb_array_elements_text(coalesce(r.detail->'close_log_ids', '[]'::jsonb))::bigint);
      UPDATE public.dia_listing_sale_close_log SET restored_at = now()
       WHERE log_id IN (SELECT jsonb_array_elements_text(coalesce(r.detail->'close_log_ids', '[]'::jsonb))::bigint);
      PERFORM set_config('lcc.listing_sale_reconcile_off', 'off', true);
    ELSIF r.action = 'merge' THEN
      PERFORM public.dia_unmerge_property(r.backup_id);
      UPDATE public.dia_property_twin_review
         SET status = 'pending', resolved_at = NULL, backup_id = NULL,
             resolution_note = 'reopened by dia_dup1_restore ' || p_batch
       WHERE backup_id = r.backup_id;
    ELSIF r.action = 'supersede_listing' THEN
      UPDATE public.available_listings SET
        status = r.prior->>'status', is_active = (r.prior->>'is_active')::boolean,
        off_market_date = (r.prior->>'off_market_date')::date, off_market_reason = r.prior->>'off_market_reason',
        exclude_from_listing_metrics = (r.prior->>'exclude_from_listing_metrics')::boolean,
        notes = r.prior->>'notes'
       WHERE listing_id = r.listing_id;
    ELSIF r.action = 'fill_listing' THEN
      FOR v_col IN SELECT jsonb_object_keys(r.detail) LOOP
        EXECUTE format('UPDATE public.available_listings SET %I = NULL WHERE listing_id = $1 AND to_jsonb(%I) = $2',
                       v_col, v_col)
          USING r.listing_id, r.detail->v_col;
      END LOOP;
    ELSIF r.action = 'fill_keep' THEN
      FOR v_col IN SELECT jsonb_object_keys(r.detail) LOOP
        EXECUTE format('UPDATE public.properties SET %I = NULL WHERE property_id = $1 AND to_jsonb(%I) = $2',
                       v_col, v_col)
          USING r.keep_id, r.detail->v_col;
      END LOOP;
    ELSIF r.action = 'card' THEN
      DELETE FROM public.dia_property_twin_review
       WHERE shadow_property_id = r.drop_id AND anchor_property_id = r.keep_id
         AND status = 'pending' AND batch_tag = p_batch;
    END IF;
    UPDATE public.dia_dup1_merge_log SET restored_at = now() WHERE log_id = r.log_id;
    v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('batch', p_batch, 'restored_rows', v_n);
END
$fn$;

-- Sizing: live pairs that share a parcel key or an address key, with their signals.
CREATE OR REPLACE VIEW public.v_dia_dup1_property_pairs
WITH (security_invoker = on) AS
WITH keyed AS (
  SELECT p.property_id, upper(btrim(p.state)) AS st, lower(btrim(p.city)) AS city,
         public.dia_dup1_street_key(p.address) AS skey, public.dia_dup1_apn_key(p.parcel_number) AS akey
    FROM public.properties p
   WHERE p.merged_into_property_id IS NULL
), pairs AS (
  SELECT a.property_id AS a_id, b.property_id AS b_id, 'address'::text AS found_by
    FROM keyed a JOIN keyed b ON a.st = b.st AND a.city = b.city AND a.skey = b.skey AND a.property_id < b.property_id
   WHERE a.skey ~ '^\d'
  UNION
  SELECT a.property_id, b.property_id, 'parcel'
    FROM keyed a JOIN keyed b ON a.st = b.st AND a.akey = b.akey AND a.property_id < b.property_id
)
SELECT DISTINCT ON (q.a_id, q.b_id) q.a_id, q.b_id, q.found_by, s.signals, (s.signals->>'n')::int AS n_signals,
       pa.address AS a_address, pb.address AS b_address, pa.city, pa.state,
       pa.medicare_id AS a_medicare_id, pb.medicare_id AS b_medicare_id,
       EXISTS (SELECT 1 FROM public.dia_property_twin_review r
                WHERE r.status = 'pending'
                  AND ((r.shadow_property_id = q.a_id AND r.anchor_property_id = q.b_id)
                    OR (r.shadow_property_id = q.b_id AND r.anchor_property_id = q.a_id))) AS has_open_card
  FROM pairs q
  JOIN public.properties pa ON pa.property_id = q.a_id
  JOIN public.properties pb ON pb.property_id = q.b_id
  CROSS JOIN LATERAL (SELECT public.dia_dup1_pair_signals(q.a_id, q.b_id) AS signals) s
 ORDER BY q.a_id, q.b_id, q.found_by;

REVOKE ALL ON public.v_dia_dup1_property_pairs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_dia_dup1_property_pairs TO service_role;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.dia_dup1_supersede_listing(integer,integer,text,boolean)',
    'public.dia_dup1_merge_pair(integer,integer,text,boolean,text,boolean)',
    'public.dia_dup1_restore(text)',
    'public.dia_dup1_pair_signals(integer,integer)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM public, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'DUP-RECORDS1: % still client-executable', f;
    END IF;
  END LOOP;
END $$;

COMMIT;
