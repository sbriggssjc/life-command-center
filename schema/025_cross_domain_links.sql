-- ============================================================================
-- 025: Cross-Domain Contact Link Indexes + View
-- Life Command Center — Cross-Domain Intelligence
--
-- Supports the nightly cross-domain contact matcher that identifies contacts
-- present in both Gov and Dia domain databases.
-- ============================================================================

-- Index to speed up lookups by source_system + entity_id
CREATE INDEX IF NOT EXISTS idx_external_identities_source_domain
ON external_identities(source_system, entity_id);

-- Partial GIN index on entities tagged as cross_domain_owner
CREATE INDEX IF NOT EXISTS idx_entities_cross_domain
ON entities USING GIN(tags) WHERE 'cross_domain_owner' = ANY(tags);

-- Convenience view: cross-domain contacts with their Gov and Dia external IDs
CREATE OR REPLACE VIEW cross_domain_contacts AS
SELECT
  e.id,
  e.name,
  e.email,
  e.phone,
  MAX(CASE WHEN ei.source_system = 'gov_db' THEN ei.external_id END) AS gov_contact_id,
  MAX(CASE WHEN ei.source_system = 'dia_db' THEN ei.external_id END) AS dia_contact_id
FROM entities e
JOIN external_identities ei ON ei.entity_id = e.id
WHERE 'cross_domain_owner' = ANY(e.tags)
GROUP BY e.id, e.name, e.email, e.phone
HAVING COUNT(DISTINCT ei.source_system) >= 2;
