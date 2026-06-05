-- ============================================================================
-- R7 Phase 1 (Slice 3) — gov true_owner manual write-back (gov side FIRST)
-- ============================================================================
-- The Decision Center's "Stale — new owner is…" verdict needs to correct the
-- curated gov `properties.true_owner_id` when Scott judges the domain owner
-- stale (pre-acquisition). Per the R6 rule, the GOV migration lands first
-- (before any LCC consumer), and the write goes through the EXISTING gov
-- provenance path with source='manual_decision':
--
--   * manual_change_events  — the human-edit audit row (source_action=
--     'manual_decision', status='approved', idempotency_key)
--   * field_value_provenance — authority ladder; manual_override=true at the
--     top of the rank (manual 90 > salesforce 55 > excel 50 > public_feed 40 >
--     agency_classifier 30 > estimated 20)
--   * provenance_event_log   — the cross-DB change log that flushes to LCC Opps
--   * ownership_history      — append a manual_correction row documenting it
--
-- SAFE BY CONSTRUCTION:
--   * p_dry_run DEFAULTS TO TRUE — a call without explicit dry_run=false plans
--     the change and writes NOTHING. The LCC side only passes dry_run=false
--     when the DECISION_GOV_WRITEBACK flag is set (Scott's blessing).
--   * Idempotent on (idempotency_key) — re-running a decision's write-back is a
--     no-op ('already_applied').
--   * SECURITY DEFINER + EXECUTE granted to service_role ONLY (REVOKEd from
--     anon/authenticated) — the anon BD pulls can never reach it; only LCC's
--     service-role domainQuery can.
--
-- Idempotent migration (CREATE OR REPLACE). Additive: no schema changes to
-- existing tables, no data backfill.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.gov_apply_manual_true_owner(
  p_property_id     bigint,
  p_new_owner_name  text,
  p_actor           text    DEFAULT 'decision_center',
  p_idempotency_key text    DEFAULT NULL,
  p_dry_run         boolean DEFAULT true
)
RETURNS TABLE(
  wrote               boolean,
  dry_run             boolean,
  property_id         bigint,
  old_true_owner_id   uuid,
  old_true_owner_name text,
  new_true_owner_id   uuid,
  new_owner_name      text,
  change_event_id     uuid,
  note                text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
-- OUT params (property_id, change_event_id, …) share names with table columns;
-- resolve ambiguous in-query references to the COLUMN (CLAUDE.md BD gotcha #3).
#variable_conflict use_column
DECLARE
  v_old_id uuid; v_old_name text; v_new_id uuid; v_clean text; v_evt uuid; v_idem text;
  v_found boolean;
BEGIN
  dry_run := COALESCE(p_dry_run, true);
  property_id := p_property_id;
  v_clean := NULLIF(btrim(COALESCE(p_new_owner_name, '')), '');

  SELECT p.true_owner_id, t.name, true
    INTO v_old_id, v_old_name, v_found
  FROM properties p
  LEFT JOIN true_owners t ON t.true_owner_id = p.true_owner_id
  WHERE p.property_id = p_property_id;

  old_true_owner_id := v_old_id; old_true_owner_name := v_old_name; new_owner_name := v_clean;

  IF v_found IS NOT TRUE THEN
    wrote := false; note := 'property_not_found'; new_true_owner_id := NULL; change_event_id := NULL;
    RETURN NEXT; RETURN;
  END IF;
  IF v_clean IS NULL THEN
    wrote := false; note := 'no_new_owner'; new_true_owner_id := NULL; change_event_id := NULL;
    RETURN NEXT; RETURN;
  END IF;

  -- Resolve an existing owner by canonical/name (case-insensitive, not merged).
  SELECT t.true_owner_id INTO v_new_id
  FROM true_owners t
  WHERE t.merged_into_true_owner_id IS NULL
    AND (lower(t.canonical_name) = lower(v_clean) OR lower(t.name) = lower(v_clean))
  ORDER BY (lower(t.name) = lower(v_clean)) DESC
  LIMIT 1;

  v_idem := COALESCE(p_idempotency_key, 'prop:' || p_property_id || ':' || lower(v_clean));

  IF dry_run THEN
    wrote := false;
    note := CASE WHEN v_new_id IS NULL THEN 'would_create_owner_and_write' ELSE 'would_write' END;
    new_true_owner_id := v_new_id; change_event_id := NULL;
    RETURN NEXT; RETURN;
  END IF;

  -- Idempotency: this decision's write-back already applied?
  IF EXISTS (SELECT 1 FROM manual_change_events
             WHERE idempotency_key = v_idem
               AND table_name = 'properties' AND field_name = 'true_owner_id') THEN
    wrote := false; note := 'already_applied'; new_true_owner_id := v_old_id; change_event_id := NULL;
    RETURN NEXT; RETURN;
  END IF;

  -- Create the owner if we don't have one.
  IF v_new_id IS NULL THEN
    INSERT INTO true_owners (true_owner_id, name, canonical_name, created_at, updated_at)
    VALUES (gen_random_uuid(), v_clean, v_clean, now(), now())
    RETURNING true_owner_id INTO v_new_id;
  END IF;
  new_true_owner_id := v_new_id;

  -- The curated write. (Qualify the column — property_id is also an OUT param;
  -- CLAUDE.md BD gotcha #3.)
  UPDATE properties SET true_owner_id = v_new_id, updated_at = now()
  WHERE properties.property_id = p_property_id;

  -- Human-edit audit row. The gov vocab is constrained (source_action /
  -- source_app / status enums), so the audit row uses the closest canonical
  -- values and stashes the manual_decision origin in actor_context. The
  -- authoritative 'manual_decision' provenance lives in provenance_event_log
  -- below (free-text source).
  INSERT INTO manual_change_events
    (change_event_id, table_name, record_id, field_name, old_value, new_value,
     source_action, source_app, actor, actor_context, status, approved_by, approved_at,
     idempotency_key, created_at)
  VALUES (gen_random_uuid(), 'properties', p_property_id::text, 'true_owner_id',
     v_old_id::text, v_new_id::text, 'save_ownership_resolution', 'lcc', p_actor,
     jsonb_build_object('origin', 'decision_center', 'provenance_source', 'manual_decision',
        'idempotency_key', v_idem),
     'applied', p_actor, now(), v_idem, now())
  RETURNING change_event_id INTO v_evt;

  -- Authority ladder: the manual override sits at the top (authority_source
  -- vocab is constrained to 'manual'; manual_override=true is the guard).
  INSERT INTO field_value_provenance
    (provenance_id, table_name, record_id, field_name, authority_source, authority_rank,
     last_change_event_id, last_confirmed_at, manual_override, created_at, updated_at)
  VALUES (gen_random_uuid(), 'properties', p_property_id::text, 'true_owner_id',
     'manual', 90, v_evt, now(), true, now(), now())
  ON CONFLICT (table_name, record_id, field_name) DO UPDATE SET
     authority_source = 'manual', authority_rank = 90,
     last_change_event_id = v_evt, last_confirmed_at = now(),
     manual_override = true, updated_at = now();

  -- Cross-DB change log (flushes to LCC Opps) — this carries the authoritative
  -- source='manual_decision'. target_database vocab requires 'gov_db'.
  INSERT INTO provenance_event_log
    (target_database, target_table, record_pk_value, field_name, old_value, new_value,
     source, confidence, recorded_at, metadata)
  VALUES ('gov_db', 'properties', p_property_id::text, 'true_owner_name',
     to_jsonb(v_old_name), to_jsonb(v_clean), 'manual_decision', 1.0, now(),
     jsonb_build_object('change_event_id', v_evt, 'idempotency_key', v_idem));

  -- Document the change in ownership history.
  INSERT INTO ownership_history
    (ownership_id, property_id, prior_owner, new_owner, true_owner_id, true_owner_name,
     change_type, data_source, ownership_state, transfer_date, created_at)
  VALUES (gen_random_uuid(), p_property_id, v_old_name, v_clean, v_new_id, v_clean,
     'manual_correction', 'manual_decision', 'active', current_date, now());

  wrote := true; change_event_id := v_evt; note := 'applied';
  RETURN NEXT;
END;
$fn$;

-- Only LCC's service-role writer can call this; the anon BD pulls cannot.
REVOKE ALL ON FUNCTION public.gov_apply_manual_true_owner(bigint, text, text, text, boolean) FROM PUBLIC;
DO $g$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.gov_apply_manual_true_owner(bigint,text,text,text,boolean) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.gov_apply_manual_true_owner(bigint,text,text,text,boolean) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.gov_apply_manual_true_owner(bigint,text,text,text,boolean) TO service_role';
  END IF;
END
$g$;
