-- ============================================================================
-- Tier 4 Unit 2 — dia recorded-owner backfill from the existing
-- recorded_owner_name text (name -> recorded_owners -> recorded_owner_id).
--
-- Grounding (live 2026-06-16): 9,932 dia properties have a NULL
-- recorded_owner_id. The audit's primary source (linked CMS clinic
-- medicare_clinics.owner_name) is the OPERATOR (DaVita / Fresenius / US Renal
-- Care / "Independent"), NOT the landlord — unusable for recorded_owner_id.
-- dia deed_records grantees = 0; assessed_owner / tax_mailing_owner = 0.
-- The one clean, in-book source is the 3,344 properties that already carry a
-- real recorded_owner_name (e.g. "PMG Leasing, L.L.C.",
-- "Delaware Phillips Holdings, LLC"). After the operator + shape guard,
-- 3,272 are linkable (72 operator names rejected). This takes dia
-- recorded-owner coverage 19.1% -> ~45.8% (2,349 -> ~5,621) using data
-- already in the book, no external dependency.
--
-- Design:
--   * Reuses the EXISTING machinery: public.is_known_operator (operator guard,
--     same one dia_resolve_ownership_save uses) + public.normalize_entity_name
--     (the normalized_name dedup key writer). Find-or-create on recorded_owners,
--     then set properties.recorded_owner_id.
--   * FILL-BLANKS ONLY by selection: only rows WHERE recorded_owner_id IS NULL
--     are ever touched, so there is no clobber and no conflict (nothing to
--     disagree with) — "conflicts -> Decision Center" is vacuous here.
--   * REVERSIBLE: every link is recorded in dia_recorded_owner_backfill_log
--     (property_id, recorded_owner_id, owner_created, batch). Created owner
--     rows are tagged source='recorded_owner_backfill'. Revert =
--     UPDATE properties SET recorded_owner_id=NULL WHERE property_id IN (log)
--     and optionally DELETE the created owners.
--   * SAFE BY DEFAULT: p_dry_run DEFAULTS TRUE — a call without an explicit
--     dry_run=false writes nothing (mirrors gov_apply_manual_true_owner).
--   * BOUNDED one-time drain run in capped batches (capped batch -> verify ->
--     full drain) — NOT a cron (this is a one-shot intra-dia fix, not an
--     ongoing inflow; re-run the function to sweep any future inflow).
--
-- Deferred follow-up (NOT this unit): the ~6,586 properties with NO owner-name
-- signal anywhere (CMS = operator, no deed/assessor data) need external
-- county/SOS sourcing — a separate, lower-confidence, source-dependent project.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.dia_recorded_owner_backfill_log (
  id                 bigserial PRIMARY KEY,
  property_id        integer NOT NULL,
  recorded_owner_id  uuid    NOT NULL,
  owner_name         text,
  owner_created      boolean NOT NULL DEFAULT false,
  batch_run_id       uuid,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dia_ro_backfill_log_property
  ON public.dia_recorded_owner_backfill_log (property_id);

CREATE OR REPLACE FUNCTION public.dia_backfill_recorded_owner_from_name(
  p_limit   integer DEFAULT 500,
  p_dry_run boolean DEFAULT true
)
RETURNS TABLE(
  scanned        integer,
  linked         integer,
  owner_created  integer,
  owner_reused   integer,
  dry_run        boolean,
  batch_run_id   uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rec          record;
  v_nm           text;
  v_norm         text;
  v_ro_id        uuid;
  v_created      boolean;
  v_scanned      integer := 0;
  v_linked       integer := 0;
  v_created_cnt  integer := 0;
  v_reused_cnt   integer := 0;
  v_batch        uuid := gen_random_uuid();
BEGIN
  FOR v_rec IN
    SELECT p.property_id, btrim(p.recorded_owner_name) AS nm
    FROM public.properties p
    WHERE p.recorded_owner_id IS NULL
      AND nullif(btrim(p.recorded_owner_name), '') IS NOT NULL
      AND length(btrim(p.recorded_owner_name)) >= 3
      AND btrim(p.recorded_owner_name) !~ '^[0-9.\-\s]+$'
      AND NOT public.is_known_operator(btrim(p.recorded_owner_name))
    ORDER BY p.property_id
    LIMIT GREATEST(p_limit, 0)
  LOOP
    v_scanned := v_scanned + 1;
    v_nm := v_rec.nm;
    v_norm := public.normalize_entity_name(v_nm);
    v_ro_id := NULL;
    v_created := false;

    -- 1) exact name match (resolve merge pointer to the canonical owner)
    SELECT COALESCE(r.merged_into_recorded_owner_id, r.recorded_owner_id)
      INTO v_ro_id
    FROM public.recorded_owners r
    WHERE lower(btrim(r.name)) = lower(v_nm)
    ORDER BY (r.merged_into_recorded_owner_id IS NULL) DESC
    LIMIT 1;

    -- 2) normalized_name match (the active dedup key)
    IF v_ro_id IS NULL AND v_norm IS NOT NULL AND v_norm <> '' THEN
      SELECT r.recorded_owner_id INTO v_ro_id
      FROM public.recorded_owners r
      WHERE r.normalized_name = v_norm
        AND r.merged_into_recorded_owner_id IS NULL
      LIMIT 1;
    END IF;

    -- 3) create if still unresolved
    IF v_ro_id IS NULL THEN
      v_created := true;
      IF NOT p_dry_run THEN
        INSERT INTO public.recorded_owners (name, normalized_name, source)
        VALUES (v_nm, v_norm, 'recorded_owner_backfill')
        ON CONFLICT DO NOTHING
        RETURNING recorded_owners.recorded_owner_id INTO v_ro_id;

        IF v_ro_id IS NULL THEN
          -- lost a race / pre-existing exact-name row: re-resolve
          SELECT COALESCE(r.merged_into_recorded_owner_id, r.recorded_owner_id)
            INTO v_ro_id
          FROM public.recorded_owners r
          WHERE lower(btrim(r.name)) = lower(v_nm)
             OR r.normalized_name = v_norm
          ORDER BY (r.merged_into_recorded_owner_id IS NULL) DESC
          LIMIT 1;
          v_created := false;
        END IF;
      END IF;
    END IF;

    IF v_created THEN v_created_cnt := v_created_cnt + 1;
                 ELSE v_reused_cnt  := v_reused_cnt  + 1;
    END IF;

    -- 4) link the property (fill-blanks guard) + log for reversibility
    IF NOT p_dry_run AND v_ro_id IS NOT NULL THEN
      UPDATE public.properties
         SET recorded_owner_id = v_ro_id
       WHERE property_id = v_rec.property_id
         AND recorded_owner_id IS NULL;

      IF FOUND THEN
        v_linked := v_linked + 1;
        INSERT INTO public.dia_recorded_owner_backfill_log
          (property_id, recorded_owner_id, owner_name, owner_created, batch_run_id)
        VALUES (v_rec.property_id, v_ro_id, v_nm, v_created, v_batch);
      END IF;
    ELSIF p_dry_run THEN
      v_linked := v_linked + 1;  -- projected
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_scanned, v_linked, v_created_cnt, v_reused_cnt, p_dry_run, v_batch;
END;
$function$;

-- Reversal helper (manual; not auto-run). Undo a batch or the whole backfill:
--   SELECT public.dia_revert_recorded_owner_backfill(<batch_run_id> | NULL);
-- NULL reverts ALL backfill links. Deletes created owners only when they no
-- longer back any property and carry no other references.
CREATE OR REPLACE FUNCTION public.dia_revert_recorded_owner_backfill(
  p_batch_run_id uuid DEFAULT NULL
)
RETURNS TABLE(properties_unlinked integer, owners_deleted integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_unlinked integer := 0;
  v_deleted  integer := 0;
BEGIN
  WITH tgt AS (
    SELECT property_id, recorded_owner_id
    FROM public.dia_recorded_owner_backfill_log
    WHERE p_batch_run_id IS NULL OR batch_run_id = p_batch_run_id
  ),
  upd AS (
    UPDATE public.properties p
       SET recorded_owner_id = NULL
      FROM tgt
     WHERE p.property_id = tgt.property_id
       AND p.recorded_owner_id = tgt.recorded_owner_id
    RETURNING p.property_id
  )
  SELECT count(*) INTO v_unlinked FROM upd;

  WITH del AS (
    DELETE FROM public.recorded_owners r
    WHERE r.source = 'recorded_owner_backfill'
      AND r.recorded_owner_id IN (
        SELECT DISTINCT recorded_owner_id FROM public.dia_recorded_owner_backfill_log
        WHERE p_batch_run_id IS NULL OR batch_run_id = p_batch_run_id
      )
      AND NOT EXISTS (SELECT 1 FROM public.properties p WHERE p.recorded_owner_id = r.recorded_owner_id)
      AND NOT EXISTS (SELECT 1 FROM public.properties p WHERE p.true_owner_id = r.recorded_owner_id)
    RETURNING r.recorded_owner_id
  )
  SELECT count(*) INTO v_deleted FROM del;

  DELETE FROM public.dia_recorded_owner_backfill_log
   WHERE p_batch_run_id IS NULL OR batch_run_id = p_batch_run_id;

  RETURN QUERY SELECT v_unlinked, v_deleted;
END;
$function$;
