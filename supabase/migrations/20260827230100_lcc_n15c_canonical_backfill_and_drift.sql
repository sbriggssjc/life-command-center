-- =====================================================================
-- N15c Unit 2a — the attributability gate, the ledger, the backfill and
-- the standing drift instrument. INERT: applied live 2026-08-27.
-- =====================================================================
-- SAFE TO APPLY AT ANY TIME. Nothing here writes: the backfill function
-- defaults to p_dry_run => true and the view is read-only. The TRIGGER that
-- makes them meaningful is the sibling migration ...230200, which must be
-- applied only AFTER the JS deploy — see its header.
--
-- Why the trigger is separate: it writes the N15c key, and a build of
-- `ensureEntityLink` that still looks rows up by the PRE-N15c key would miss
-- every row it touches and mint a duplicate for each. The backfill here
-- rewrites ~15,310 rows, so invoking it (p_dry_run => false) against the old
-- JS would turn a ~4/day leak into a spike. Run the backfill only after the
-- deploy, in the sequence documented in ...230200.
--
-- WHAT IT DOES ---------------------------------------------------------
--   0. `lcc_entities_canonical_name_biu` — the trigger function (INERT here).
--   1. `lcc_n15c_canonical_is_attributable` — was the stored key DERIVED
--      from the current name, or left stale by a later name repair?
--   2. `lcc_n15c_backfill_canonical_names` — gated, reversible, dry-run
--      default. Only ever rewrites attributable rows.
--   3. `v_lcc_canonical_name_drift` — the standing Class 8 instrument.
--   4. The field_source_priority row for the trigger writer.
--
-- REVERSAL (of a backfill batch):
--   UPDATE entities e SET canonical_name = b.old_canonical_name
--     FROM lcc_n15c_canonical_backfill_log b
--    WHERE b.entity_id = e.id AND b.batch_tag = '<tag>';
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. The trigger FUNCTION. Inert until ...230200 attaches it to `entities`.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_entities_canonical_name_biu()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  NEW.canonical_name := public.lcc_entity_canonical_key(NEW.name);
  -- ⚠️ RETURN NEW, UNCONDITIONALLY. A BEFORE trigger that returns NULL to
  -- "skip" a row silently defeats ON CONFLICT DO UPDATE — the row never
  -- reaches the conflict clause and the DO UPDATE never runs (P196, found
  -- live on trg_lcc_entity_rel_resolve_survivor). `lcc_finalize_classified_owners`
  -- upserts ON CONFLICT (id) DO UPDATE through this table, so a skip here
  -- would be invisible and would drop owner-sync writes on the floor.
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------
-- 1. Was the stored value DERIVED from the current name, or is it stale?
-- ---------------------------------------------------------------------
-- The backfill may only touch rows whose stored key is explainable as some
-- prior normalization OF THE CURRENT NAME. Where it is not, `name` was
-- repaired later and canonical_name was left behind carrying the original
-- captured string ("Scott W. Beynon" keyed
-- "buyer contactsscott w beynon 801 568 1031 p"). Recomputing those would
-- DISCARD that string, which is Scott's call, not this migration's.
CREATE OR REPLACE FUNCTION public.lcc_n15c_canonical_is_attributable(p_name text, p_canonical text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  select p_canonical is null
      or p_canonical = lower(btrim(coalesce(p_name,'')))                       -- verbatim (3 SQL writers)
      or p_canonical = btrim(regexp_replace(regexp_replace(regexp_replace(     -- JS #1
           lower(btrim(coalesce(p_name,''))),
           '\m(llc|inc|corp|ltd|co|company|group|partners|lp|llp)\M\.?','','g'),
           '[^a-z0-9[:space:]]',' ','g'),'\s+',' ','g'))
      or p_canonical = btrim(regexp_replace(regexp_replace(regexp_replace(     -- JS #2 (the drifted copy)
           lower(btrim(coalesce(p_name,''))),
           '\m(llc|inc|corp|ltd|co|company|group|partners|lp|llp)\M\.?','','g'),
           '[^a-z0-9[:space:]]','','g'),'\s+',' ','g'))
      or p_canonical is not distinct from public.lcc_normalize_entity_name(p_name)  -- the aggressive one
      or p_canonical = public.lcc_owner_domain_core(p_name)
      or p_canonical = public.lcc_entity_canonical_key(p_name);
$function$;

-- ---------------------------------------------------------------------
-- 2. Reversible ledger + the backfill.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lcc_n15c_canonical_backfill_log (
  id                  bigserial PRIMARY KEY,
  entity_id           uuid        NOT NULL,
  entity_name         text,
  old_canonical_name  text        NOT NULL,
  new_canonical_name  text        NOT NULL,
  batch_tag           text        NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lcc_n15c_backfill_batch
  ON public.lcc_n15c_canonical_backfill_log (batch_tag);

CREATE OR REPLACE FUNCTION public.lcc_n15c_backfill_canonical_names(
  p_dry_run   boolean DEFAULT true,
  p_batch_tag text    DEFAULT NULL,
  p_limit     integer DEFAULT NULL
)
RETURNS TABLE (
  rows_rewritten        bigint,
  rows_held_stale       bigint,
  rows_already_correct  bigint,
  batch_tag             text
)
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tag  text := coalesce(p_batch_tag, 'n15c_' || to_char(now(),'YYYYMMDDHH24MISS'));
  v_done bigint := 0;
BEGIN
  CREATE TEMP TABLE _n15c_plan ON COMMIT DROP AS
  SELECT e.id, e.name, e.canonical_name AS old_canon,
         public.lcc_entity_canonical_key(e.name) AS new_canon
    FROM public.entities e
   WHERE e.merged_into_entity_id IS NULL
     AND e.canonical_name IS DISTINCT FROM public.lcc_entity_canonical_key(e.name)
     AND public.lcc_n15c_canonical_is_attributable(e.name, e.canonical_name)
   ORDER BY e.id
   LIMIT p_limit;

  IF NOT p_dry_run THEN
    -- The ledger is written FIRST, so a row can never be rewritten without a
    -- way back. Reversibility that has never been exercised is a claim, not a
    -- capability (P195) — the round trip is run in the gate below.
    INSERT INTO public.lcc_n15c_canonical_backfill_log
      (entity_id, entity_name, old_canonical_name, new_canonical_name, batch_tag)
    SELECT p.id, p.name, p.old_canon, p.new_canon, v_tag FROM _n15c_plan p;

    -- Sets canonical_name only. The trigger fires on UPDATE OF name and this
    -- statement does not touch name, so there is no interaction.
    UPDATE public.entities e
       SET canonical_name = p.new_canon
      FROM _n15c_plan p
     WHERE e.id = p.id;
    GET DIAGNOSTICS v_done = ROW_COUNT;
  ELSE
    SELECT count(*) INTO v_done FROM _n15c_plan;
  END IF;

  RETURN QUERY
  SELECT v_done,
         (SELECT count(*) FROM public.entities e
           WHERE e.merged_into_entity_id IS NULL
             AND e.canonical_name IS DISTINCT FROM public.lcc_entity_canonical_key(e.name)
             AND NOT public.lcc_n15c_canonical_is_attributable(e.name, e.canonical_name)),
         (SELECT count(*) FROM public.entities e
           WHERE e.merged_into_entity_id IS NULL
             AND e.canonical_name = public.lcc_entity_canonical_key(e.name)),
         v_tag;
END;
$function$;

-- ---------------------------------------------------------------------
-- 3. The standing instrument. A one-shot backfill of a LIVE producer is
--    Class 8; this is what says whether the producer is actually fixed.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_lcc_canonical_name_drift AS
  SELECT e.id AS entity_id,
         e.name,
         e.entity_type,
         e.canonical_name,
         public.lcc_entity_canonical_key(e.name) AS expected_canonical_name,
         CASE WHEN public.lcc_n15c_canonical_is_attributable(e.name, e.canonical_name)
              THEN 'backfillable'
              ELSE 'held_stale_name_repair' END AS drift_class,
         e.created_at,
         e.updated_at
    FROM public.entities e
   WHERE e.merged_into_entity_id IS NULL
     AND e.canonical_name IS DISTINCT FROM public.lcc_entity_canonical_key(e.name);

COMMENT ON VIEW public.v_lcc_canonical_name_drift IS
  'N15c Class 8 instrument. After the backfill this should hold at the held_stale_name_repair rows ONLY (537 at 2026-08-27, awaiting Scott). ⚠️ Read drift_class: a NEW backfillable row means a writer escaped the trigger — that is the producer regressing, and it is the number to watch, not the total.';

GRANT SELECT ON public.v_lcc_canonical_name_drift TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Register the writer (provenance doctrine).
-- ---------------------------------------------------------------------
INSERT INTO public.field_source_priority
  (target_table, field_name, source, priority, min_confidence, enforce_mode, notes)
VALUES
  ('entities', 'canonical_name', 'lcc_entity_canonical_key_trigger', 1, NULL, 'record_only',
   'N15c: the BEFORE trigger trg_lcc_entities_canonical_name is the SOLE writer of entities.canonical_name. Priority 1 because it is derived, not sourced - no other source may outrank a value the database computes.')
ON CONFLICT (target_table, field_name, source) DO UPDATE
  SET priority = EXCLUDED.priority, notes = EXCLUDED.notes;
