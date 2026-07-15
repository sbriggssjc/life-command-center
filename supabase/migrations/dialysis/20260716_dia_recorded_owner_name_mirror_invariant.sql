-- ============================================================================
-- dia properties.recorded_owner_name — enforce the denormalized-mirror invariant
-- + one-time backfill (2026-07-15)
--
-- ROOT CAUSE (debugged 2026-07-15, gov 16500 investigation → dia drift):
-- dia `properties.recorded_owner_name` is a DENORMALIZED copy of the owning
-- `recorded_owners.name` (via the FK `recorded_owner_id`). Two independent
-- writers set the two columns from DIFFERENT "current owner" sources, so they
-- drift:
--   • the CoStar sidebar property upsert writes recorded_owner_name directly
--     from the capture's "Recorded Owner" panel (sidebar-pipeline.js ~L3581,
--     `recorded_owner_name: ownerContact?.name`) WITHOUT touching the FK, while
--   • recorded_owner_id (the FK — the join key the WHOLE system uses:
--     ownership_history, external_identities bridge, v_owner_source_conflict,
--     the BD spine / priority queue) is resolved separately from the ownership
--     chain (reconcilePropertyOwnership) / the deed grantee (R51).
-- Grounded live 2026-07-15: 1,233 FK-set rows drift (299 punctuation-only /
-- semantically-same, 47 FK-is-current-denorm-stale, 290 denorm-is-current-FK-
-- STALE [deed grantee == denorm, FK lagged], 31 neither, 261 no-deed). Because
-- the dia v_owner_source_conflict comparison reads the denorm (stale) name, the
-- 47 FK-current rows FALSELY surfaced as ownership conflicts (the deed-autofix
-- sweep no-op'd them as `already_current`), while the 290 genuinely-stale FKs
-- were MASKED (the denorm showed the newer owner so no conflict was flagged).
--
-- DOCTRINE: recorded_owner_id (FK) is the single source of truth for "who owns
-- this"; recorded_owner_name is a pure denormalized cache that must ALWAYS equal
-- recorded_owners.name via the FK. "Which owner is correct" (FK staleness) is a
-- SEPARATE concern owned by R51 / the deed-autofix sweep — not this migration.
--
-- THE FIX (dia only; gov `properties` has NO recorded_owner_name column, so gov
-- reads the FK-joined name already and is immune):
--   1. A reversible backup of every drifted denorm name.
--   2. A BEFORE INSERT/UPDATE trigger that forces recorded_owner_name to mirror
--      the FK owner's name whenever recorded_owner_id is set (left as-is when the
--      FK is null — a capture-time fallback for a not-yet-resolved owner). Fires
--      on EITHER column, so it catches the L3581 name-only write AND any FK
--      change, across ALL writers (sidebar, CMS sync, merges, manual edits) —
--      the single airtight enforcement point.
--   3. A one-time backfill syncing every FK-set row's denorm to the FK.
--
-- CONSEQUENCE (intended, self-healing): after the backfill the denorm == the FK
-- everywhere, so v_owner_source_conflict (which reads the denorm) now behaves as
-- if reading the FK — the 47 false conflicts CLEAR and the ~290 genuinely-stale
-- FKs are UNMASKED as real deed_newer_stale conflicts for the daily deed-autofix
-- sweep (lcc-owner-deed-autofix, DECISION_OWNER_DEED_WINS=on) to reconcile
-- (repoint the FK to the deed grantee → the trigger then syncs the name).
--
-- REVERSIBLE: DROP TRIGGER trg_dia_sync_recorded_owner_name; restore names from
-- dia_recorded_owner_name_drift_backup. Idempotent (CREATE OR REPLACE / DROP IF
-- EXISTS / ON CONFLICT DO NOTHING / the backfill is a no-op on replay).
-- Apply on the Dialysis DB (zqzrriwuavgrquhisnoa) ONLY.
-- ============================================================================

-- 1. Reversible backup of the drifted denorm names (capture-once).
CREATE TABLE IF NOT EXISTS public.dia_recorded_owner_name_drift_backup (
  property_id   bigint PRIMARY KEY,
  old_name      text,
  fk_owner_name text,
  backed_up_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.dia_recorded_owner_name_drift_backup (property_id, old_name, fk_owner_name)
SELECT p.property_id, p.recorded_owner_name, ro.name
FROM public.properties p
JOIN public.recorded_owners ro ON ro.recorded_owner_id = p.recorded_owner_id
WHERE p.recorded_owner_name IS DISTINCT FROM ro.name
ON CONFLICT (property_id) DO NOTHING;

-- 2. The invariant trigger — recorded_owner_name mirrors the FK owner's name.
CREATE OR REPLACE FUNCTION public.dia_sync_recorded_owner_name()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  v_name text;
BEGIN
  IF NEW.recorded_owner_id IS NOT NULL THEN
    SELECT ro.name INTO v_name
    FROM public.recorded_owners ro
    WHERE ro.recorded_owner_id = NEW.recorded_owner_id;
    -- Only enforce when the FK resolves to a real name; never null a
    -- capture-time fallback name for an unresolved (FK-null) owner.
    IF v_name IS NOT NULL THEN
      NEW.recorded_owner_name := v_name;
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_dia_sync_recorded_owner_name ON public.properties;
CREATE TRIGGER trg_dia_sync_recorded_owner_name
BEFORE INSERT OR UPDATE OF recorded_owner_id, recorded_owner_name ON public.properties
FOR EACH ROW EXECUTE FUNCTION public.dia_sync_recorded_owner_name();

-- 3. One-time backfill — sync every FK-set row's denorm to the FK owner.
UPDATE public.properties p
SET recorded_owner_name = ro.name
FROM public.recorded_owners ro
WHERE ro.recorded_owner_id = p.recorded_owner_id
  AND p.recorded_owner_name IS DISTINCT FROM ro.name;
