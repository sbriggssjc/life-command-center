-- Migration 3: Guard and upsert functions
-- Applied to Dialysis_DB (zqzrriwuavgrquhisnoa) on 2026-04-16

CREATE OR REPLACE FUNCTION should_update_lease_field(
  p_lease_id integer,
  p_field_name text,
  p_new_source_tier smallint
) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM lease_field_provenance
    WHERE lease_id = p_lease_id
    AND field_name = p_field_name
    AND superseded_at IS NULL
    AND source_tier < p_new_source_tier
  );
$$;

COMMENT ON FUNCTION should_update_lease_field IS
'Returns TRUE if a lease field can be updated from the given source tier.
Prevents lower-quality sources (higher tier number) from overwriting
higher-quality data (lower tier number). Tier 1 (lease doc) always wins.';

CREATE OR REPLACE FUNCTION upsert_lease_field(
  p_lease_id integer,
  p_field_name text,
  p_field_value text,
  p_source_tier smallint,
  p_source_label text,
  p_captured_by text DEFAULT 'manual',
  p_source_file text DEFAULT NULL,
  p_source_detail text DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  v_existing_id bigint;
  v_existing_tier smallint;
  v_new_id bigint;
BEGIN
  SELECT id, source_tier INTO v_existing_id, v_existing_tier
  FROM lease_field_provenance
  WHERE lease_id = p_lease_id AND field_name = p_field_name AND superseded_at IS NULL;

  IF v_existing_tier IS NOT NULL AND v_existing_tier < p_source_tier THEN
    RETURN FALSE;
  END IF;

  IF v_existing_id IS NOT NULL THEN
    UPDATE lease_field_provenance SET superseded_at = NOW() WHERE id = v_existing_id;
  END IF;

  INSERT INTO lease_field_provenance (
    lease_id, field_name, field_value, source_tier, source_label,
    source_file, source_detail, captured_by, notes
  ) VALUES (
    p_lease_id, p_field_name, p_field_value, p_source_tier, p_source_label,
    p_source_file, p_source_detail, p_captured_by, p_notes
  ) RETURNING id INTO v_new_id;

  IF v_existing_id IS NOT NULL THEN
    UPDATE lease_field_provenance SET superseded_by = v_new_id WHERE id = v_existing_id;
  END IF;

  IF p_field_name IN ('roof_responsibility','hvac_responsibility','structure_responsibility','parking_responsibility') THEN
    EXECUTE format('UPDATE leases SET %I = $1, updated_at = NOW() WHERE lease_id = $2', p_field_name)
    USING p_field_value, p_lease_id;
  ELSIF p_field_name = 'expense_structure' THEN
    UPDATE leases SET expense_structure = p_field_value, updated_at = NOW() WHERE lease_id = p_lease_id;
  ELSIF p_field_name = 'rent' THEN
    UPDATE leases SET rent = p_field_value::numeric, updated_at = NOW() WHERE lease_id = p_lease_id;
  ELSIF p_field_name = 'rent_per_sf' THEN
    UPDATE leases SET rent_per_sf = p_field_value::numeric, updated_at = NOW() WHERE lease_id = p_lease_id;
  ELSIF p_field_name = 'leased_area' THEN
    UPDATE leases SET leased_area = p_field_value::numeric, updated_at = NOW() WHERE lease_id = p_lease_id;
  END IF;

  RETURN TRUE;
END;
$$;
