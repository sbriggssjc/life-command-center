-- ============================================================================
-- Round 76al — fix trg_contact_auto_link FK race
--
-- The original trigger was BEFORE INSERT OR UPDATE on contacts and tried to
-- UPDATE recorded_owners.contact_id = NEW.contact_id (and same for
-- true_owners) inside the same trigger function. On a fresh INSERT, the
-- contacts row hasn't been committed yet when the trigger body runs, so the
-- FK constraint on recorded_owners.contact_id rejects the UPDATE with:
--
--   23503: insert or update on table "recorded_owners" violates foreign key
--          constraint "recorded_owners_contact_id_fkey"
--   DETAIL: Key (contact_id)=(<uuid>) is not present in table "contacts"
--
-- This blocked Round 76ak's recorded_owner stub-creation backfill (663 rows
-- couldn't get a contact stub) and would also block any non-trivial contact
-- import going forward.
--
-- Fix: split into two triggers.
--   BEFORE: only mutates NEW (normalized_name, updated_at, true_owner_id,
--           recorded_owner_id, property_id). Safe — NEW is the row being
--           written, no FK check happens until the actual INSERT.
--   AFTER:  runs the UPDATE statements on true_owners + recorded_owners now
--           that the contacts row is fully visible to FK checks.
--
-- Apply on dialysis Supabase project (zqzrriwuavgrquhisnoa).
-- ============================================================================

-- 1. Drop the old combined trigger
DROP TRIGGER IF EXISTS contact_auto_link ON public.contacts;

-- 2. Replace the function with a BEFORE-safe version (no related-table UPDATEs)
CREATE OR REPLACE FUNCTION public.trg_contact_auto_link_before()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_true_owner_id UUID;
  v_rec_owner_id  UUID;
BEGIN
  NEW.normalized_name := normalize_entity_name(NEW.contact_name);
  NEW.updated_at := now();

  -- Resolve true_owner_id via aliases first, then exact normalized match.
  IF NEW.true_owner_id IS NULL AND NEW.normalized_name IS NOT NULL AND NEW.normalized_name != '' THEN
    SELECT a.entity_id INTO v_true_owner_id
    FROM entity_name_aliases a
    WHERE a.alias_name = NEW.normalized_name AND a.entity_table = 'true_owners'
    LIMIT 1;
    IF v_true_owner_id IS NOT NULL THEN NEW.true_owner_id := v_true_owner_id; END IF;
  END IF;

  IF NEW.true_owner_id IS NULL AND NEW.normalized_name IS NOT NULL AND NEW.normalized_name != '' THEN
    SELECT t.true_owner_id INTO v_true_owner_id
    FROM true_owners t WHERE t.normalized_name = NEW.normalized_name LIMIT 1;
    IF v_true_owner_id IS NOT NULL THEN NEW.true_owner_id := v_true_owner_id; END IF;
  END IF;

  -- Resolve recorded_owner_id via aliases, then exact normalized match.
  IF NEW.recorded_owner_id IS NULL AND NEW.normalized_name IS NOT NULL AND NEW.normalized_name != '' THEN
    SELECT a.entity_id INTO v_rec_owner_id
    FROM entity_name_aliases a
    WHERE a.alias_name = NEW.normalized_name AND a.entity_table = 'recorded_owners'
    LIMIT 1;
    IF v_rec_owner_id IS NOT NULL THEN NEW.recorded_owner_id := v_rec_owner_id; END IF;
  END IF;

  IF NEW.recorded_owner_id IS NULL AND NEW.normalized_name IS NOT NULL AND NEW.normalized_name != '' THEN
    SELECT r.recorded_owner_id INTO v_rec_owner_id
    FROM recorded_owners r WHERE normalize_entity_name(r.name) = NEW.normalized_name LIMIT 1;
    IF v_rec_owner_id IS NOT NULL THEN NEW.recorded_owner_id := v_rec_owner_id; END IF;
  END IF;

  -- Link to property via the resolved true_owner_id (when both unset).
  IF NEW.property_id IS NULL AND NEW.true_owner_id IS NOT NULL THEN
    SELECT p.property_id INTO NEW.property_id
    FROM properties p WHERE p.true_owner_id = NEW.true_owner_id LIMIT 1;
  END IF;

  RETURN NEW;
END $function$;

-- 3. New AFTER function does the related-table UPDATEs once the contact row
--    is fully visible to FK checks.
CREATE OR REPLACE FUNCTION public.trg_contact_auto_link_after()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
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
END $function$;

-- 4. Wire both triggers
CREATE TRIGGER contact_auto_link_before
  BEFORE INSERT OR UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.trg_contact_auto_link_before();

CREATE TRIGGER contact_auto_link_after
  AFTER INSERT OR UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.trg_contact_auto_link_after();

-- 5. Original combined function kept around for now in case other code
--    references it. Dropping in a follow-up.
COMMENT ON FUNCTION public.trg_contact_auto_link IS
  'DEPRECATED Round 76al — split into _before/_after to avoid FK race on INSERT';
