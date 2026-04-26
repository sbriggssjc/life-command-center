-- ============================================================================
-- Migration: auto-supersede stale overlapping leases when a new lease lands
--
-- Target: dialysis Supabase (DIA_SUPABASE_URL)
--
-- Pattern: a property gets repeated CoStar captures or OM intakes, each
-- writing a new "active" lease row. Without auto-cleanup, properties
-- accumulate 5-12+ active leases (audit 2026-04-25 found 1,018 such
-- properties; the worst had 12 active leases on a single building).
--
-- Rule: when a new active lease is inserted (or an existing lease becomes
-- active via UPDATE), any OTHER active lease on the same property whose
-- lease_expiration is BEFORE the new lease's lease_start gets marked
-- superseded. Conservative: doesn't touch leases that overlap (those
-- need human reconciliation — could be legitimate multi-tenant).
--
-- Skip conditions:
--   - New lease has no lease_start → can't determine ordering, no-op
--   - Old lease has no lease_expiration → can't determine if it's expired
--   - Same lease_id (don't supersede self)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.auto_supersede_expired_leases()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF NEW.is_active IS DISTINCT FROM TRUE THEN
    RETURN NEW;
  END IF;
  IF NEW.lease_start IS NULL THEN
    RETURN NEW;
  END IF;

  WITH superseded AS (
    UPDATE public.leases
    SET is_active  = false,
        status     = 'superseded',
        updated_at = now()
    WHERE property_id        = NEW.property_id
      AND lease_id           <> NEW.lease_id
      AND is_active          = true
      AND lease_expiration   IS NOT NULL
      AND lease_expiration   < NEW.lease_start
    RETURNING lease_id
  )
  SELECT count(*) INTO v_count FROM superseded;

  IF v_count > 0 THEN
    RAISE NOTICE 'auto_supersede: marked % expired lease(s) inactive for property_id=%',
      v_count, NEW.property_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_supersede_expired_leases ON public.leases;

CREATE TRIGGER trg_auto_supersede_expired_leases
  AFTER INSERT OR UPDATE OF is_active, lease_start ON public.leases
  FOR EACH ROW EXECUTE FUNCTION public.auto_supersede_expired_leases();

COMMENT ON FUNCTION public.auto_supersede_expired_leases() IS
  'When a new active lease is inserted/activated, mark any other active
   leases on the same property whose lease_expiration is before the new
   lease_start as superseded. Conservative — does not touch overlapping
   leases (those need human reconciliation).';
