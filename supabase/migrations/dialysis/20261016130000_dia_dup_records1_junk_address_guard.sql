-- DUP-RECORDS1 (2026-09-26): the property writer refuses a junk address, at the database.
--
-- The sidebar already strips "For Sale | " and refuses OM-junk (upsertDomainProperty), but a writer that
-- skips those guards can still mint a row: live 2026-09-26 dia carries 8 such rows, among them
-- 37696 "For Sale | 802 N John Young Pky" (the Kissimmee duplicate, merged by this round),
-- 37693 "For Sale | 1164 Route 130 North", 37512 "Sale Comps | 1550 Sheridan", two HTML
-- "Broker Of Record | ..." blocks and an Excel row dump ("Unnamed: 0: ...").
--
-- dia_address_is_junk(text) — true for a pipe, an HTML tag, or a leading listing-status / sheet label.
-- trg_dia_property_junk_address_guard — BEFORE INSERT, and BEFORE UPDATE only when the address CHANGES,
-- raises 23514 'junk_address_refused'. An INSERT that re-creates a row recorded as dropped in
-- dia_property_merge_backup (an unmerge) is exempt: it restores history. Existing rows are untouched until someone rewrites their address,
-- so the nightly jobs that touch other columns keep working.

BEGIN;

CREATE OR REPLACE FUNCTION public.dia_address_is_junk(p_address text)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT coalesce(
       p_address ~ '\|'
    OR p_address ~ '<[A-Za-z/!][^>]*>'
    OR p_address ~* '^\s*(for sale|for lease|reduced|price reduced|sold|under contract|new listing|sale comps|lease comps|unnamed:)\M',
    false)
$fn$;

CREATE OR REPLACE FUNCTION public.dia_property_junk_address_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.address IS NOT DISTINCT FROM OLD.address THEN
    RETURN NEW;
  END IF;
  -- Undoing a merge re-inserts the dropped row as it was; that restores history, it is not a new write.
  IF TG_OP = 'INSERT' AND EXISTS (SELECT 1 FROM public.dia_property_merge_backup b
                                   WHERE b.dropped_property_id = NEW.property_id) THEN
    RETURN NEW;
  END IF;
  IF public.dia_address_is_junk(NEW.address) THEN
    RAISE EXCEPTION 'junk_address_refused: %', left(NEW.address, 120)
      USING ERRCODE = '23514',
            HINT = 'Strip the listing-status prefix / parse the street line before writing a property (DUP-RECORDS1).';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_dia_property_junk_address_guard ON public.properties;
CREATE TRIGGER trg_dia_property_junk_address_guard
  BEFORE INSERT OR UPDATE OF address ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.dia_property_junk_address_guard();

COMMIT;
