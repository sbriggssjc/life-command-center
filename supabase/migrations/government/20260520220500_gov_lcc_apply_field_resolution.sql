-- ============================================================================
-- R4 Phase-4 Tier A: cross-DB field resolution RPC
--
-- Target: government (scknotsqkcheojiaewwh)
-- Mirror: Dialysis_DB (zqzrriwuavgrquhisnoa) — same body, mirrored in
--         supabase/migrations/dialysis/20260520220500_dia_lcc_apply_field_resolution.sql
--
-- Tracks: docs/architecture/provenance_resolution_ui_scope.md (Tier A)
--
-- Called by the LCC Opps `resolve_provenance_conflict` API endpoint when
-- the reviewer's `chosen` is `attempted` or `custom` (i.e., a domain DB
-- value needs to change). Performs three things atomically inside the
-- domain DB:
--
--   1. Schema-validity check  -- column exists on target table?
--   2. Capture before_value   -- to_jsonb(field) before the UPDATE
--   3. UPDATE the field via dynamic SQL, returning to_jsonb(field) after
--
-- Returns a single jsonb envelope:
--   { ok: bool, schema_ok: bool, before_value, after_value,
--     pk_column, error?, sqlstate? }
--
-- The LCC API endpoint records this envelope verbatim into
-- field_provenance_resolutions.domain_write_response so every change is
-- reversible with one SQL statement using the before_value.
--
-- Limitations:
--   * Single-column primary keys only. Composite-PK tables (e.g.
--     lease_rent_schedule) return ok=false; defer to a Tier C extension.
--   * Reverts NULL via p_new_value=jsonb 'null'.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_apply_field_resolution(
  p_target_table  text,
  p_record_pk     text,
  p_field_name    text,
  p_new_value     jsonb,
  p_workspace_id  uuid    DEFAULT NULL,
  p_resolved_by   uuid    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
  v_schema       text := 'public';
  v_table_oid    oid;
  v_pk_column    text;
  v_pk_count     int;
  v_col_exists   boolean;
  v_col_udt      text;
  v_cast_to      text;
  v_before       jsonb;
  v_after        jsonb;
  v_row_count    int;
  v_sql          text;
BEGIN
  -- 1. Resolve table oid (NULL if not found)
  v_table_oid := to_regclass(quote_ident(v_schema) || '.' || quote_ident(p_target_table));
  IF v_table_oid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'schema_ok', false,
      'error', format('table %s.%s not found', v_schema, p_target_table));
  END IF;

  -- 2. Verify the column exists AND fetch its udt_name (int4/int8/numeric/
  --    text/varchar/bool/date/timestamp/timestamptz/jsonb/...) so we can
  --    build a typed cast suffix. Without it Postgres rejects assignments
  --    like `SET year_built = ('2007'::jsonb #>> '{}')` with
  --    "expression is of type text"; the cast suffix turns it into
  --    `(...)::int4` which the input function accepts.
  SELECT udt_name INTO v_col_udt
  FROM information_schema.columns
  WHERE table_schema = v_schema
    AND table_name   = p_target_table
    AND column_name  = p_field_name;
  v_col_exists := v_col_udt IS NOT NULL;

  IF NOT v_col_exists THEN
    RETURN jsonb_build_object('ok', false, 'schema_ok', false,
      'error', format('column %s.%s does not exist', p_target_table, p_field_name));
  END IF;

  v_cast_to := CASE
    WHEN v_col_udt IN ('text','varchar','bpchar','citext','name') THEN ''
    ELSE '::' || quote_ident(v_col_udt)
  END;

  -- 3. Find single-column primary key
  SELECT a.attname, array_length(i.indkey, 1)
    INTO v_pk_column, v_pk_count
    FROM pg_index i
    JOIN pg_attribute a
      ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
   WHERE i.indrelid = v_table_oid
     AND i.indisprimary
   LIMIT 1;

  IF v_pk_column IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'schema_ok', false,
      'error', format('table %s has no primary key', p_target_table));
  END IF;
  IF v_pk_count > 1 THEN
    RETURN jsonb_build_object('ok', false, 'schema_ok', false,
      'error', format('table %s has composite PK (cols=%s); single-column PKs only in Tier A',
                      p_target_table, v_pk_count));
  END IF;

  -- 4. Capture before_value
  v_sql := format(
    'SELECT to_jsonb(t.%I) FROM %I.%I t WHERE t.%I::text = $1 LIMIT 1',
    p_field_name, v_schema, p_target_table, v_pk_column
  );
  EXECUTE v_sql INTO v_before USING p_record_pk;
  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'schema_ok', true,
      'error', format('row not found: %s.%s WHERE %s = %s',
                      v_schema, p_target_table, v_pk_column, p_record_pk));
  END IF;

  -- 5. UPDATE the field. Branches:
  --    a) NULL                 -> SET col = NULL
  --    b) boolean -> bool col  -> ($1::jsonb)::text::boolean (avoids jsonb's
  --                                "true"/"false" being read as text "true")
  --    c) jsonb column         -> SET col = $1::jsonb (preserves nested)
  --    d) everything else      -> ($1::jsonb #>> '{}')::<udt_name>
  IF p_new_value IS NULL OR jsonb_typeof(p_new_value) = 'null' THEN
    v_sql := format(
      'UPDATE %I.%I SET %I = NULL WHERE %I::text = $1 RETURNING to_jsonb(%I)',
      v_schema, p_target_table, p_field_name, v_pk_column, p_field_name);
    EXECUTE v_sql INTO v_after USING p_record_pk;
  ELSIF jsonb_typeof(p_new_value) = 'boolean' AND v_col_udt = 'bool' THEN
    v_sql := format(
      'UPDATE %I.%I SET %I = ($1::jsonb)::text::boolean WHERE %I::text = $2 RETURNING to_jsonb(%I)',
      v_schema, p_target_table, p_field_name, v_pk_column, p_field_name);
    EXECUTE v_sql INTO v_after USING p_new_value, p_record_pk;
  ELSIF v_col_udt = 'jsonb' THEN
    v_sql := format(
      'UPDATE %I.%I SET %I = $1::jsonb WHERE %I::text = $2 RETURNING to_jsonb(%I)',
      v_schema, p_target_table, p_field_name, v_pk_column, p_field_name);
    EXECUTE v_sql INTO v_after USING p_new_value, p_record_pk;
  ELSE
    v_sql := format(
      'UPDATE %I.%I SET %I = ($1::jsonb #>> ''{}'')%s WHERE %I::text = $2 RETURNING to_jsonb(%I)',
      v_schema, p_target_table, p_field_name, v_cast_to, v_pk_column, p_field_name);
    EXECUTE v_sql INTO v_after USING p_new_value, p_record_pk;
  END IF;

  RETURN jsonb_build_object(
    'ok',           true,
    'schema_ok',    true,
    'before_value', v_before,
    'after_value',  v_after,
    'pk_column',    v_pk_column,
    'column_udt',   v_col_udt,
    'resolved_at',  now(),
    'workspace_id', p_workspace_id,
    'resolved_by',  p_resolved_by
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'ok',        false,
      'schema_ok', true,
      'error',     SQLERRM,
      'sqlstate',  SQLSTATE
    );
END
$function$;

COMMENT ON FUNCTION public.lcc_apply_field_resolution IS
  'R4 Phase-4 Tier A: cross-DB UPDATE invoked by LCC Opps `resolve_provenance_conflict`. '
  'Schema-validates, captures before, UPDATEs via dynamic SQL, returns before/after envelope. '
  'Single-column PKs only.';
