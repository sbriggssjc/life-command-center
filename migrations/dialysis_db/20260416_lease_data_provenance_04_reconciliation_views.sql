-- Migration 4: Reconciliation views
-- Applied to Dialysis_DB (zqzrriwuavgrquhisnoa) on 2026-04-16

CREATE OR REPLACE VIEW v_lease_responsibility_gaps AS
SELECT
  l.lease_id, l.property_id, l.tenant, l.operator,
  l.expense_structure, l.expense_structure_canonical,
  l.rent, l.leased_area,
  l.roof_responsibility,
  l.hvac_responsibility,
  l.structure_responsibility,
  l.parking_responsibility,
  (CASE WHEN l.roof_responsibility IS NOT NULL THEN 1 ELSE 0 END +
   CASE WHEN l.hvac_responsibility IS NOT NULL THEN 1 ELSE 0 END +
   CASE WHEN l.structure_responsibility IS NOT NULL THEN 1 ELSE 0 END +
   CASE WHEN l.parking_responsibility IS NOT NULL THEN 1 ELSE 0 END) as responsibility_fields_populated,
  (SELECT MIN(source_tier) FROM lease_field_provenance lfp
   WHERE lfp.lease_id = l.lease_id AND lfp.superseded_at IS NULL) as best_source_tier,
  (SELECT MAX(source_tier) FROM lease_field_provenance lfp
   WHERE lfp.lease_id = l.lease_id AND lfp.superseded_at IS NULL) as worst_source_tier,
  p.current_value_estimate,
  p.priority_score
FROM leases l
JOIN properties p ON p.property_id = l.property_id
WHERE l.is_active = true
ORDER BY
  responsibility_fields_populated ASC,
  p.current_value_estimate DESC NULLS LAST;

CREATE OR REPLACE VIEW v_lease_expense_structure_inconsistencies AS
WITH operator_structure_stats AS (
  SELECT
    l.operator,
    l.expense_structure_canonical as canonical,
    COUNT(*) as lease_count,
    AVG(EXTRACT(YEAR FROM l.lease_start)) as avg_vintage
  FROM leases l
  WHERE l.is_active = true AND l.operator IS NOT NULL
  GROUP BY l.operator, l.expense_structure_canonical
)
SELECT
  operator,
  canonical,
  lease_count,
  ROUND(avg_vintage) as avg_vintage_year,
  ROUND(100.0 * lease_count / SUM(lease_count) OVER (PARTITION BY operator), 1) as pct_of_operator
FROM operator_structure_stats
ORDER BY operator, lease_count DESC;

CREATE OR REPLACE VIEW v_lease_provenance_audit AS
SELECT
  l.lease_id, l.property_id, l.tenant,
  lfp.field_name, lfp.field_value,
  lfp.source_tier, lfp.source_label,
  lfp.source_file, lfp.source_detail,
  lfp.captured_at, lfp.captured_by,
  lfp.superseded_at,
  CASE WHEN lfp.superseded_at IS NULL THEN 'ACTIVE' ELSE 'SUPERSEDED' END as status
FROM lease_field_provenance lfp
JOIN leases l ON l.lease_id = lfp.lease_id
ORDER BY lfp.lease_id, lfp.field_name, lfp.captured_at DESC;
