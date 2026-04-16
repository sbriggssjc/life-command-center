-- Migration 2: lease_field_provenance table + indexes
-- Applied to Dialysis_DB (zqzrriwuavgrquhisnoa) on 2026-04-16

CREATE TABLE lease_field_provenance (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lease_id integer NOT NULL REFERENCES leases(lease_id) ON DELETE CASCADE,
  field_name text NOT NULL,
  field_value text,
  source_tier smallint NOT NULL CHECK (source_tier BETWEEN 1 AND 7),
  source_label text NOT NULL CHECK (source_label IN (
    'lease_document','lease_amendment','om_lease_abstract',
    'broker_package','costar_verified','loopnet_listing','inferred'
  )),
  source_file text,
  source_detail text,
  captured_at timestamptz NOT NULL DEFAULT NOW(),
  captured_by text NOT NULL DEFAULT 'manual',
  superseded_at timestamptz,
  superseded_by bigint REFERENCES lease_field_provenance(id),
  notes text
);

CREATE UNIQUE INDEX uix_lfp_active
  ON lease_field_provenance(lease_id, field_name)
  WHERE superseded_at IS NULL;

CREATE INDEX ix_lfp_lease ON lease_field_provenance(lease_id, field_name, captured_at DESC);

CREATE INDEX ix_lfp_tier ON lease_field_provenance(source_tier, field_name) WHERE superseded_at IS NULL;

COMMENT ON TABLE lease_field_provenance IS
'Tracks the source and confidence tier for underwriting-critical lease fields.
Lower source_tier = more authoritative (1=lease doc, 7=inferred).
Pipeline guard function prevents lower-quality sources from overwriting higher-quality data.';
