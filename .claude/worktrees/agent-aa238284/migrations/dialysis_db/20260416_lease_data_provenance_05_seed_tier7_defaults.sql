-- Migration 5: Seed tier-7 (inferred) responsibility defaults
-- Applied to Dialysis_DB (zqzrriwuavgrquhisnoa) on 2026-04-16
-- Result: 6,118 provenance records seeded

INSERT INTO lease_field_provenance (lease_id, field_name, field_value, source_tier, source_label, captured_by, notes)
SELECT
  l.lease_id,
  resp.key as field_name,
  resp.value #>> '{}' as field_value,
  7 as source_tier,
  'inferred' as source_label,
  'schema_seed' as captured_by,
  'Default from expense_structure_canonical mapping for ' || l.expense_structure
FROM leases l
JOIN expense_structure_canonical esc ON esc.raw_value = l.expense_structure
CROSS JOIN LATERAL jsonb_each(esc.responsibility_defaults) resp(key, value)
WHERE l.is_active = true
AND resp.key IN ('roof','hvac','structure','parking')
AND resp.value #>> '{}' != 'varies'
ON CONFLICT DO NOTHING;

UPDATE leases l SET
  roof_responsibility = COALESCE(l.roof_responsibility, (esc.responsibility_defaults->>'roof')),
  hvac_responsibility = COALESCE(l.hvac_responsibility, (esc.responsibility_defaults->>'hvac')),
  structure_responsibility = COALESCE(l.structure_responsibility, (esc.responsibility_defaults->>'structure')),
  parking_responsibility = COALESCE(l.parking_responsibility, (esc.responsibility_defaults->>'parking'))
FROM expense_structure_canonical esc
WHERE esc.raw_value = l.expense_structure
AND l.is_active = true
AND (l.roof_responsibility IS NULL OR l.hvac_responsibility IS NULL
     OR l.structure_responsibility IS NULL OR l.parking_responsibility IS NULL);
