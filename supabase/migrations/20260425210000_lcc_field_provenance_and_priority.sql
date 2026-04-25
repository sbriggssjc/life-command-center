-- ============================================================================
-- Migration: field-level data provenance + per-field source priority registry
--
-- Target: LCC Opps Supabase (OPS_SUPABASE_URL)
--
-- Why: every cross-table write to a curated field (properties, leases,
-- available_listings, contacts, etc.) needs to record its source,
-- confidence, and the run that produced it. A registry says — per
-- table.field — which source wins when multiple sources disagree. A
-- merge function consults the registry, decides write/skip/conflict,
-- and records provenance.
--
-- Generalizes the JS-only FIELD_PRIORITY map in
-- api/_handlers/contacts-handler.js into a queryable, table-driven
-- registry that all write paths can share.
--
-- Rollout: enforce_mode='record_only' by default, so deploying this
-- migration changes no behavior — it only OBSERVES. A subsequent PR
-- migrates write paths to call lcc_merge_field() and respect its
-- decision (warn/strict). See
-- docs/architecture/data_quality_self_learning_loop.md.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.field_provenance (
  id                BIGSERIAL PRIMARY KEY,
  workspace_id      UUID,
  target_database   TEXT NOT NULL CHECK (target_database IN ('lcc_opps','dia_db','gov_db')),
  target_table      TEXT NOT NULL,
  record_pk_value   TEXT NOT NULL,
  field_name        TEXT NOT NULL,
  value             JSONB,
  value_text_hash   TEXT GENERATED ALWAYS AS (
    encode(sha224(coalesce(value::text,'')::bytea), 'hex')
  ) STORED,
  source            TEXT NOT NULL,
  source_run_id     TEXT,
  confidence        NUMERIC(4,3) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by       UUID,
  decision          TEXT NOT NULL CHECK (decision IN ('write','skip','conflict','superseded')),
  decision_reason   TEXT,
  superseded_by_id  BIGINT REFERENCES public.field_provenance(id),
  metadata          JSONB
);

CREATE INDEX IF NOT EXISTS idx_field_prov_target
  ON public.field_provenance (target_database, target_table, record_pk_value, field_name, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_field_prov_source_recent
  ON public.field_provenance (source, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_field_prov_run
  ON public.field_provenance (source_run_id) WHERE source_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_field_prov_pending_conflicts
  ON public.field_provenance (target_database, target_table, record_pk_value, field_name)
  WHERE decision = 'conflict';

COMMENT ON TABLE public.field_provenance IS
  'Append-only log of every field write to curated tables. Records source,
   confidence, run id, and the merge decision (write/skip/conflict/superseded).
   The most recent row with decision=write per (target_database, target_table,
   record_pk_value, field_name) is the current authoritative provenance.';

CREATE TABLE IF NOT EXISTS public.field_source_priority (
  id                BIGSERIAL PRIMARY KEY,
  target_table      TEXT NOT NULL,
  field_name        TEXT NOT NULL,
  source            TEXT NOT NULL,
  priority          INTEGER NOT NULL,
  min_confidence    NUMERIC(4,3) DEFAULT 0,
  enforce_mode      TEXT NOT NULL DEFAULT 'record_only'
                    CHECK (enforce_mode IN ('record_only','warn','strict')),
  notes             TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (target_table, field_name, source)
);

CREATE INDEX IF NOT EXISTS idx_field_priority_lookup
  ON public.field_source_priority (target_table, field_name, priority);

COMMENT ON TABLE public.field_source_priority IS
  'Per-field source authority registry. Lower priority number = higher trust.
   When multiple sources write the same field, lcc_merge_field() consults
   this table to decide whether the new write supersedes the current value
   or is skipped/flagged. enforce_mode lets us roll out gradually:
   record_only (observe), warn (log conflicts), strict (block low-priority
   writes from clobbering high-priority values).';

-- Seed the registry with the user-stated rules.
-- Priority bands:
--   1-19   = hard authoritative (manual edits, county records of record)
--   20-39  = primary trusted (signed leases, OM source-of-truth)
--   40-59  = secondary trusted (OM extraction by AI, lease abstracts)
--   60-79  = aggregator/scraper (CoStar, LoopNet, broker flyers)
--   80-99  = derived/inferred (computed values, fallbacks)

INSERT INTO public.field_source_priority
  (target_table, field_name, source, priority, min_confidence, notes)
VALUES
  ('dia.properties', 'address',          'manual_edit',       1,  null, 'Explicit human override always wins.'),
  ('dia.properties', 'address',          'county_records',    10, null, 'County tax-assessor records of record.'),
  ('dia.properties', 'address',          'om_extraction',     50, 0.5,  'AI-extracted address from OM PDF; lower trust than county.'),
  ('dia.properties', 'address',          'costar_sidebar',    65, null, 'CoStar address; useful but not authoritative.'),
  ('gov.properties', 'address',          'manual_edit',       1,  null, 'Explicit human override always wins.'),
  ('gov.properties', 'address',          'county_records',    10, null, 'County tax-assessor records of record.'),
  ('gov.properties', 'address',          'om_extraction',     50, 0.5,  'AI-extracted address from OM PDF.'),
  ('gov.properties', 'address',          'costar_sidebar',    65, null, 'CoStar address.'),

  ('dia.properties', 'tenant',           'manual_edit',       1,  null, 'Explicit human override.'),
  ('dia.properties', 'tenant',           'cms_chain_org',     15, null, 'Medicare/CMS facility chain reporting — compliance-grade.'),
  ('dia.properties', 'tenant',           'lease_document',    25, null, 'Signed lease document (PDF or abstract).'),
  ('dia.properties', 'tenant',           'om_extraction',     45, 0.5,  'OM-stated tenant; verify against lease when possible.'),
  ('dia.properties', 'tenant',           'costar_sidebar',    65, null, 'CoStar tenant; often parent-company-rolled.'),

  ('dia.leases', 'rent',                 'manual_edit',       1,  null, 'Explicit human override.'),
  ('dia.leases', 'rent',                 'lease_document',    20, null, 'Direct lease document.'),
  ('dia.leases', 'rent',                 'om_extraction',     30, 0.5,  'OM-stated annual rent. High trust.'),
  ('dia.leases', 'rent',                 'projected_from_om', 55, 0.4,  'Old OM rent projected forward via cap rate. Useful when no current data.'),
  ('dia.leases', 'rent',                 'costar_sidebar',    70, null, 'CoStar stated rent — often a per-SF estimate.'),
  ('dia.leases', 'rent',                 'loopnet',           75, null, 'LoopNet stated rent. Lower trust than CoStar.'),

  ('dia.available_listings', 'cap_rate',       'manual_edit',       1,  null, 'Explicit human override.'),
  ('dia.available_listings', 'cap_rate',       'derived_from_rent', 20, null, 'Computed from confirmed rent / confirmed sale price. Most reliable.'),
  ('dia.available_listings', 'cap_rate',       'om_extraction',     40, 0.5,  'OM-stated cap rate.'),
  ('dia.available_listings', 'cap_rate',       'costar_sidebar',    70, null, 'CoStar stated cap. Often broker-aspirational.'),
  ('dia.available_listings', 'cap_rate',       'loopnet',           75, null, 'LoopNet stated cap.'),

  ('dia.available_listings', 'initial_price',  'manual_edit',       1,  null, 'Explicit human override.'),
  ('dia.available_listings', 'initial_price',  'om_extraction',     25, 0.5,  'OM stated asking price.'),
  ('dia.available_listings', 'initial_price',  'costar_sidebar',    60, null, 'CoStar listing price.'),
  ('dia.available_listings', 'initial_price',  'loopnet',           70, null, 'LoopNet listing price.'),

  ('dia.properties', 'year_built',       'manual_edit',       1,  null, 'Explicit human override.'),
  ('dia.properties', 'year_built',       'county_records',    10, null, 'County tax-assessor build year.'),
  ('dia.properties', 'year_built',       'om_extraction',     50, 0.5,  'OM-stated build year (verify against county).'),
  ('dia.properties', 'year_built',       'costar_sidebar',    65, null, 'CoStar build year.'),

  ('dia.properties', 'lot_sf',           'manual_edit',       1,  null, 'Explicit human override.'),
  ('dia.properties', 'lot_sf',           'county_records',    10, null, 'County parcel acreage.'),
  ('dia.properties', 'lot_sf',           'om_extraction',     50, 0.5,  'OM-stated lot SF.'),
  ('dia.properties', 'lot_sf',           'costar_sidebar',    65, null, 'CoStar lot SF.'),

  ('dia.properties', 'parcel_number',    'manual_edit',       1,  null, 'Explicit human override.'),
  ('dia.properties', 'parcel_number',    'county_records',    5,  null, 'County tax assessor parcel number — definitional.'),
  ('dia.properties', 'parcel_number',    'om_extraction',     45, 0.5,  'OM-stated parcel number.'),
  ('dia.properties', 'parcel_number',    'costar_sidebar',    60, null, 'CoStar parcel.'),

  ('dia.properties', 'recorded_owner_id','manual_edit',       1,  null, 'Explicit human override.'),
  ('dia.properties', 'recorded_owner_id','county_records',    10, null, 'County deed records.'),
  ('dia.properties', 'recorded_owner_id','costar_sidebar',    50, null, 'CoStar reported owner.'),

  ('dia.properties', 'true_owner_id',    'manual_edit',          1,  null, 'Explicit human override.'),
  ('dia.properties', 'true_owner_id',    'shell_chain_research', 20, null, 'Manual chain-of-title research.'),
  ('dia.properties', 'true_owner_id',    'cms_chain_org',        30, null, 'CMS facility chain organization.'),
  ('dia.properties', 'true_owner_id',    'costar_sidebar',       55, null, 'CoStar reported true owner.')
ON CONFLICT (target_table, field_name, source) DO NOTHING;

-- Drop-and-create rather than CREATE OR REPLACE because if a prior version
-- of this function exists with a different OUT-row shape, OR REPLACE rejects
-- the change. Safe to drop because no application yet calls this function
-- (Phase 2.1 — record-only). Future column additions to the OUT row should
-- repeat this pattern in a new migration file.
DROP FUNCTION IF EXISTS public.lcc_merge_field(uuid,text,text,text,text,jsonb,text,text,numeric,uuid);

CREATE FUNCTION public.lcc_merge_field(
  p_workspace_id     UUID,
  p_target_database  TEXT,
  p_target_table     TEXT,
  p_record_pk        TEXT,
  p_field_name       TEXT,
  p_value            JSONB,
  p_source           TEXT,
  p_source_run_id    TEXT,
  p_confidence       NUMERIC,
  p_recorded_by      UUID DEFAULT NULL
) RETURNS TABLE (
  provenance_id      BIGINT,
  decision           TEXT,
  decision_reason    TEXT,
  current_value      JSONB,
  current_source     TEXT,
  current_priority   INTEGER,
  new_priority       INTEGER,
  enforce_mode       TEXT
) LANGUAGE plpgsql AS $$
DECLARE
  -- Variable names must NOT shadow OUT parameter names (decision,
  -- decision_reason, etc.) or the table's column names. PL/pgSQL throws
  -- "column reference is ambiguous" when a SELECT in the function body
  -- references a column that has the same name as a declared variable
  -- or OUT param. Use v_ prefixes everywhere.
  v_current_id        BIGINT;
  v_current_value     JSONB;
  v_current_source    TEXT;
  v_new_priority      INTEGER;
  v_current_priority  INTEGER;
  v_min_conf          NUMERIC;
  v_enforce           TEXT := 'record_only';
  v_decision          TEXT;
  v_reason            TEXT;
  v_inserted_id       BIGINT;
BEGIN
  SELECT fp.id, fp.value, fp.source
    INTO v_current_id, v_current_value, v_current_source
  FROM public.field_provenance fp
  WHERE fp.target_database = p_target_database
    AND fp.target_table    = p_target_table
    AND fp.record_pk_value = p_record_pk
    AND fp.field_name      = p_field_name
    AND fp.decision        = 'write'
  ORDER BY fp.recorded_at DESC
  LIMIT 1;

  SELECT fsp.priority, fsp.min_confidence, fsp.enforce_mode
    INTO v_new_priority, v_min_conf, v_enforce
  FROM public.field_source_priority fsp
  WHERE fsp.target_table = p_target_table
    AND fsp.field_name   = p_field_name
    AND fsp.source       = p_source
  LIMIT 1;

  IF v_current_id IS NOT NULL THEN
    SELECT fsp.priority INTO v_current_priority
    FROM public.field_source_priority fsp
    WHERE fsp.target_table = p_target_table
      AND fsp.field_name   = p_field_name
      AND fsp.source       = v_current_source
    LIMIT 1;
  END IF;

  IF v_min_conf IS NOT NULL AND p_confidence IS NOT NULL AND p_confidence < v_min_conf THEN
    v_decision := 'skip';
    v_reason   := format('confidence %s below min %s for source %s',
                         p_confidence, v_min_conf, p_source);
  ELSIF v_current_id IS NULL THEN
    v_decision := 'write';
    v_reason   := 'no_prior_provenance';
  ELSIF v_new_priority IS NULL THEN
    IF v_current_value IS NULL OR v_current_value = 'null'::jsonb THEN
      v_decision := 'write';
      v_reason   := 'unregistered_source_filling_blank';
    ELSE
      v_decision := 'skip';
      v_reason   := 'unregistered_source_with_existing_value';
    END IF;
  ELSIF v_current_priority IS NULL THEN
    v_decision := 'write';
    v_reason   := 'replacing_unregistered_source';
  ELSIF v_new_priority < v_current_priority THEN
    v_decision := 'write';
    v_reason   := format('source %s outranks %s (%s < %s)',
                         p_source, v_current_source, v_new_priority, v_current_priority);
  ELSIF v_new_priority = v_current_priority THEN
    IF v_current_value IS DISTINCT FROM p_value THEN
      v_decision := 'conflict';
      v_reason   := format('same-priority disagreement: was %s, now %s',
                           v_current_value::text, p_value::text);
    ELSE
      v_decision := 'write';
      v_reason   := 'same_priority_same_value_refresh';
    END IF;
  ELSE
    IF v_current_value IS DISTINCT FROM p_value THEN
      v_decision := 'skip';
      v_reason   := format('lower-priority source %s (%s) cannot override %s (%s)',
                           p_source, v_new_priority, v_current_source, v_current_priority);
    ELSE
      v_decision := 'skip';
      v_reason   := 'lower_priority_same_value';
    END IF;
  END IF;

  INSERT INTO public.field_provenance AS fp_ins (
    workspace_id, target_database, target_table, record_pk_value,
    field_name, value, source, source_run_id, confidence,
    recorded_by, decision, decision_reason
  ) VALUES (
    p_workspace_id, p_target_database, p_target_table, p_record_pk,
    p_field_name, p_value, p_source, p_source_run_id, p_confidence,
    p_recorded_by, v_decision, v_reason
  )
  RETURNING fp_ins.id INTO v_inserted_id;

  IF v_decision = 'write' AND v_current_id IS NOT NULL THEN
    UPDATE public.field_provenance fp_up
    SET decision = 'superseded', superseded_by_id = v_inserted_id
    WHERE fp_up.id = v_current_id;
  END IF;

  RETURN QUERY SELECT
    v_inserted_id,
    v_decision,
    v_reason,
    v_current_value,
    v_current_source,
    v_current_priority,
    v_new_priority,
    v_enforce;
END;
$$;

COMMENT ON FUNCTION public.lcc_merge_field IS
  'Records a field-level write to provenance log and returns the merge
   decision (write|skip|conflict). Application write paths consult the
   decision before performing the actual UPDATE on the target table.
   In record_only enforce_mode, the application still always writes;
   in strict mode (future), the application skips when decision != write.';

CREATE OR REPLACE VIEW public.v_field_provenance_current AS
SELECT DISTINCT ON (target_database, target_table, record_pk_value, field_name)
  id, target_database, target_table, record_pk_value, field_name,
  value, source, confidence, source_run_id, recorded_at
FROM public.field_provenance
WHERE decision = 'write'
ORDER BY target_database, target_table, record_pk_value, field_name, recorded_at DESC;

COMMENT ON VIEW public.v_field_provenance_current IS
  'Latest authoritative provenance row per (db, table, pk, field).
   Use to ask "where did the current value of dia.properties.29237.tenant
   come from, and how confident are we?"';

CREATE OR REPLACE VIEW public.v_field_provenance_conflicts AS
SELECT
  fp.target_database, fp.target_table, fp.record_pk_value, fp.field_name,
  fp.value AS conflicting_value, fp.source AS conflicting_source,
  fp.confidence AS conflicting_confidence,
  fp.recorded_at AS conflict_recorded_at, fp.decision_reason,
  cur.value AS current_value, cur.source AS current_source
FROM public.field_provenance fp
LEFT JOIN public.v_field_provenance_current cur
  ON cur.target_database = fp.target_database
 AND cur.target_table    = fp.target_table
 AND cur.record_pk_value = fp.record_pk_value
 AND cur.field_name      = fp.field_name
WHERE fp.decision = 'conflict'
ORDER BY fp.recorded_at DESC;

COMMENT ON VIEW public.v_field_provenance_conflicts IS
  'Conflicts surfaced by lcc_merge_field — same-priority sources disagreed.
   Triage UI can render these for human resolution.';
