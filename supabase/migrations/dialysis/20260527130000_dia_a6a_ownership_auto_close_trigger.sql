-- A6a (2026-05-27) — forward-only guard on dia.ownership_history.
--
-- BEFORE INSERT trigger that auto-closes prior "open" rows on the same
-- property when a new open ownership lands. Mirrors the
-- auto_supersede_expired_leases pattern. Applied via Supabase MCP migration
-- dia_a6a_ownership_auto_close_prior_trigger.

CREATE OR REPLACE FUNCTION public.auto_close_prior_open_ownership()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  new_eff_start date;
  closed_n      int;
BEGIN
  IF COALESCE(NEW.end_date, NEW.ownership_end) IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.property_id IS NULL OR NEW.ownership_state IS DISTINCT FROM 'active' THEN
    RETURN NEW;
  END IF;

  new_eff_start := COALESCE(NEW.start_date, NEW.ownership_start);
  IF new_eff_start IS NULL THEN
    RETURN NEW;
  END IF;

  WITH closed AS (
    UPDATE public.ownership_history oh
       SET end_date      = COALESCE(oh.end_date,      new_eff_start),
           ownership_end = COALESCE(oh.ownership_end, new_eff_start),
           updated_at    = now()
     WHERE oh.property_id = NEW.property_id
       AND oh.ownership_state = 'active'
       AND COALESCE(oh.end_date, oh.ownership_end) IS NULL
       AND COALESCE(oh.start_date, oh.ownership_start) IS NOT NULL
       AND COALESCE(oh.start_date, oh.ownership_start) <= new_eff_start
       AND (NEW.ownership_id IS NULL OR oh.ownership_id <> NEW.ownership_id)
     RETURNING 1
  )
  SELECT count(*) INTO closed_n FROM closed;

  IF closed_n > 0 THEN
    RAISE NOTICE 'auto_close_prior_open_ownership: closed % open row(s) on property %', closed_n, NEW.property_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ownership_history_auto_close_prior_bi ON public.ownership_history;
CREATE TRIGGER ownership_history_auto_close_prior_bi
  BEFORE INSERT ON public.ownership_history
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_close_prior_open_ownership();
