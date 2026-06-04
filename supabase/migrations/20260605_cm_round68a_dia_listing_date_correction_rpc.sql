-- Migration: dia — Round 68-A Task 1 listing_date correction RPC
-- Project: Dialysis_DB (zqzrriwuavgrquhisnoa).
--
-- Receipt-gated re-dating. The availability-checker calls this when a CREXi /
-- CoStar / LoopNet page exposes a marketing-start marker ("Listed on" /
-- "Date on Market" / "Days on Market" / JSON-LD datePosted) that predates the
-- stored listing_date by > 30 days. NO blind / inference re-dating — the caller
-- must supply a concrete recovered date; this function only applies it when it
-- is materially earlier than what we have, and stamps listing_date_source so the
-- provenance is visible.
--
-- Returns a jsonb decision so the worker can log corrected vs skipped.

CREATE OR REPLACE FUNCTION public.dia_record_listing_date_correction(
  p_listing_id integer,
  p_new_date   date,
  p_source_url text DEFAULT NULL,
  p_marker     text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old        date;
  v_source     text;
  v_updated    integer;
BEGIN
  -- Sanity bounds on the recovered date — reject anything implausible so a
  -- mis-parsed page can never stamp a garbage date.
  IF p_new_date IS NULL
     OR p_new_date < DATE '2005-01-01'
     OR p_new_date > (CURRENT_DATE + 7) THEN
    RETURN jsonb_build_object('action','skipped','reason','date_out_of_bounds','new_date',p_new_date);
  END IF;

  SELECT listing_date, data_source
    INTO v_old, v_source
  FROM public.available_listings
  WHERE listing_id = p_listing_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('action','skipped','reason','listing_not_found');
  END IF;

  -- Never touch a synthesized row (Task 2) — its listing_date is an imputation,
  -- not a captured value, and is owned by the synthesis backfill.
  IF v_source = 'synthetic_from_sale' THEN
    RETURN jsonb_build_object('action','skipped','reason','synthetic_row');
  END IF;

  -- Only correct when the receipt is materially earlier (>30d) than what we
  -- have, or when we currently have no date at all.
  IF v_old IS NOT NULL AND p_new_date >= (v_old - 30) THEN
    RETURN jsonb_build_object('action','skipped','reason','not_materially_earlier',
                              'old_date',v_old,'new_date',p_new_date);
  END IF;

  UPDATE public.available_listings
     SET listing_date        = p_new_date,
         listing_date_source  = 'page_marker',
         notes = COALESCE(NULLIF(notes,'') || E'\n','')
                 || '[dia_record_listing_date_correction ' || CURRENT_DATE || '] listing_date '
                 || COALESCE(v_old::text,'(null)') || ' -> ' || p_new_date::text
                 || ' via ' || COALESCE(p_marker,'page marker')
                 || COALESCE(' (' || p_source_url || ')','')
   WHERE listing_id = p_listing_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('action','corrected','old_date',v_old,'new_date',p_new_date,
                            'marker',p_marker,'rows',v_updated);
END;
$$;

GRANT EXECUTE ON FUNCTION public.dia_record_listing_date_correction(integer, date, text, text)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.dia_record_listing_date_correction(integer, date, text, text) IS
  'Round 68-A Task 1: receipt-gated listing_date correction from an availability-'
  'checker page marker. Applies p_new_date only when it predates the stored '
  'listing_date by >30d (or it is NULL), stamps listing_date_source=''page_marker''. '
  'Never touches synthetic_from_sale rows.';
