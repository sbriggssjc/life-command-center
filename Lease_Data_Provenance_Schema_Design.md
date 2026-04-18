# Lease Data Provenance & Responsibility Tracking — Schema Design

**Date:** April 16, 2026 | **Context:** Dialysis_DB lease underwriting data quality

---

## Problem Statement

Across 4,746 active leases in the Dialysis_DB:

- **Zero** have roof, HVAC, parking, or structure responsibility populated
- 21 different `expense_structure` spellings ("NNN", "NN", "Modified Gross", "Abs. NNN", "NNN; R&S", etc.) with no normalization
- No way to distinguish whether a rent figure came from an executed lease vs a CoStar scrape vs an OM flyer
- No protection against low-quality data overwriting high-quality data during ingestion
- DaVita alone: 2,022 "NNN" + 309 "Modified Gross" + 136 "Full Service Gross" + 122 "NN" — and the actual responsibility allocation for roof/structure/HVAC could be identical across all of them or wildly different

This matters because a $200K roof replacement liability swings a BOV's IRR by 50-100bps on a typical $5M dialysis NNN deal.

---

## Architecture Overview

Three new tables, one guard function, two reconciliation views. Designed to fit the existing DB patterns (`record_field_overrides`, `public_data_sources.confidence_tier`, `clinic_financial_estimates.confidence_score`).

### Source Tier Hierarchy

| Tier | Label | Description | Example |
|------|-------|-------------|---------|
| 1 | `lease_document` | Executed lease PDF or verified lease abstract from diligence | "Section 7.2: Tenant responsible for roof repair and replacement" |
| 2 | `lease_amendment` | Signed amendment modifying original terms | "Amendment #3 extends term, adds landlord roof obligation" |
| 3 | `om_lease_abstract` | Offering Memorandum lease summary from listing broker | "Per OM: Absolute NNN, tenant responsible for all maintenance" |
| 4 | `broker_package` | Marketing materials, broker opinion, deal sheet | "Per Matt Hagar: NNN with landlord roof and structure" |
| 5 | `costar_verified` | CoStar Research-verified data | "CoStar Lease tab: NNN, $29.33/SF" |
| 6 | `loopnet_listing` | LoopNet or other listing platform | "LoopNet listing: NNN" |
| 7 | `inferred` | Calculated from other data or operator defaults | "DaVita standard form is typically Absolute NNN" |

**Rule: A lower-tier-number source NEVER gets overwritten by a higher-tier-number source.** Tier 1 (lease document) always wins. Tier 7 (inferred) only fills gaps.

---

## Migration SQL

### Table 1: `expense_structure_canonical` — Normalization mapping

```sql
CREATE TABLE expense_structure_canonical (
  raw_value text PRIMARY KEY,
  canonical text NOT NULL,
  responsibility_defaults jsonb NOT NULL DEFAULT '{}',
  notes text,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

-- Seed with current values in the DB
INSERT INTO expense_structure_canonical (raw_value, canonical, responsibility_defaults, notes) VALUES
  ('Absolute NNN',   'Absolute NNN', '{"roof":"tenant","hvac":"tenant","structure":"tenant","parking":"tenant","cam":"tenant","insurance":"tenant","taxes":"tenant"}', 'Tenant responsible for everything including structural and capital'),
  ('Abs. NNN',       'Absolute NNN', '{"roof":"tenant","hvac":"tenant","structure":"tenant","parking":"tenant","cam":"tenant","insurance":"tenant","taxes":"tenant"}', NULL),
  ('Abs NNN',        'Absolute NNN', '{"roof":"tenant","hvac":"tenant","structure":"tenant","parking":"tenant","cam":"tenant","insurance":"tenant","taxes":"tenant"}', NULL),
  ('Absolute NNN (GL)', 'Absolute NNN', '{"roof":"tenant","hvac":"tenant","structure":"tenant","parking":"tenant","cam":"tenant","insurance":"tenant","taxes":"tenant"}', 'Ground lease variant'),
  ('NNN',            'NNN',          '{"roof":"varies","hvac":"varies","structure":"varies","parking":"tenant","cam":"tenant","insurance":"tenant","taxes":"tenant"}', 'Roof/HVAC/structure responsibility varies by deal — must verify from lease'),
  ('NNN; R&S',       'NNN',          '{"roof":"landlord","hvac":"varies","structure":"landlord","parking":"tenant","cam":"tenant","insurance":"tenant","taxes":"tenant"}', 'NNN with landlord roof & structure'),
  ('NNN (Roof, Parking & HVAC subject to tenant reimbursement)', 'NNN', '{"roof":"tenant","hvac":"tenant","structure":"varies","parking":"tenant","cam":"tenant","insurance":"tenant","taxes":"tenant"}', 'Explicit tenant roof/HVAC/parking'),
  ('Modified Triple Net (NNN)', 'Modified NNN', '{"roof":"landlord","hvac":"varies","structure":"landlord","parking":"tenant","cam":"tenant","insurance":"tenant","taxes":"tenant"}', NULL),
  ('NN',             'NN',           '{"roof":"landlord","hvac":"landlord","structure":"landlord","parking":"varies","cam":"tenant","insurance":"tenant","taxes":"tenant"}', 'Typically landlord covers roof/structure/HVAC'),
  ('NN & MG',        'NN',           '{"roof":"landlord","hvac":"landlord","structure":"landlord","parking":"varies","cam":"varies","insurance":"varies","taxes":"tenant"}', 'Hybrid'),
  ('NN; Ground Lease','NN',          '{"roof":"landlord","hvac":"landlord","structure":"landlord","parking":"varies","cam":"tenant","insurance":"tenant","taxes":"tenant"}', 'Ground lease variant'),
  ('Modified Gross', 'Modified Gross','{"roof":"landlord","hvac":"landlord","structure":"landlord","parking":"landlord","cam":"varies","insurance":"varies","taxes":"varies"}', 'Landlord typically covers structure/roof; tenant shares operating'),
  ('MG',             'Modified Gross','{"roof":"landlord","hvac":"landlord","structure":"landlord","parking":"landlord","cam":"varies","insurance":"varies","taxes":"varies"}', NULL),
  ('Full Service Gross','Full Service Gross','{"roof":"landlord","hvac":"landlord","structure":"landlord","parking":"landlord","cam":"landlord","insurance":"landlord","taxes":"landlord"}', 'Landlord covers everything'),
  ('Gross',          'Full Service Gross','{"roof":"landlord","hvac":"landlord","structure":"landlord","parking":"landlord","cam":"landlord","insurance":"landlord","taxes":"landlord"}', NULL),
  ('Standard/Full',  'Full Service Gross','{"roof":"landlord","hvac":"landlord","structure":"landlord","parking":"landlord","cam":"landlord","insurance":"landlord","taxes":"landlord"}', NULL),
  ('Net Lease',      'NNN',          '{"roof":"varies","hvac":"varies","structure":"varies","parking":"tenant","cam":"tenant","insurance":"tenant","taxes":"tenant"}', 'Generic net — treat as NNN until verified'),
  ('Net',            'NNN',          '{"roof":"varies","hvac":"varies","structure":"varies","parking":"tenant","cam":"tenant","insurance":"tenant","taxes":"tenant"}', NULL),
  ('single tenant',  'NNN',          '{"roof":"varies","hvac":"varies","structure":"varies","parking":"varies","cam":"varies","insurance":"varies","taxes":"varies"}', 'Not an expense structure — reclassify based on actual terms'),
  ('leasehold',      'Ground Lease', '{"roof":"tenant","hvac":"tenant","structure":"tenant","parking":"tenant","cam":"tenant","insurance":"tenant","taxes":"varies"}', 'Leasehold/ground lease — tenant typically responsible for building');

-- Add canonical column to leases for normalized lookup
ALTER TABLE leases ADD COLUMN IF NOT EXISTS expense_structure_canonical text;

-- Backfill canonical values
UPDATE leases l SET expense_structure_canonical = esc.canonical
FROM expense_structure_canonical esc
WHERE l.expense_structure = esc.raw_value;
```

### Table 2: `lease_field_provenance` — Per-field source tracking

```sql
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
  source_file text,             -- filename, URL, or document reference
  source_detail text,           -- e.g. "Section 7.2" or "Page 3, Lease Abstract"
  captured_at timestamptz NOT NULL DEFAULT NOW(),
  captured_by text NOT NULL DEFAULT 'manual',  -- 'sidebar_pipeline','manual','intake','bov_skill'
  superseded_at timestamptz,    -- NULL = current active value
  superseded_by bigint REFERENCES lease_field_provenance(id),
  notes text
);

-- Only one active (non-superseded) provenance per lease+field
CREATE UNIQUE INDEX uix_lfp_active 
  ON lease_field_provenance(lease_id, field_name) 
  WHERE superseded_at IS NULL;

-- For querying all provenance history for a lease
CREATE INDEX ix_lfp_lease ON lease_field_provenance(lease_id, field_name, captured_at DESC);

-- For finding low-confidence records to upgrade
CREATE INDEX ix_lfp_tier ON lease_field_provenance(source_tier, field_name) WHERE superseded_at IS NULL;

COMMENT ON TABLE lease_field_provenance IS 
'Tracks the source and confidence tier for underwriting-critical lease fields. 
Lower source_tier = more authoritative (1=lease doc, 7=inferred). 
Pipeline guard function prevents lower-quality sources from overwriting higher-quality data.';
```

### Tracked Field Names

```
expense_structure        -- canonical expense type
roof_responsibility      -- tenant|landlord|shared
hvac_responsibility      -- tenant|landlord|shared
structure_responsibility -- tenant|landlord|shared
parking_responsibility   -- tenant|landlord|shared
roof_detail              -- "repair, replace, maintain" or "repair only, landlord replaces"
hvac_detail              -- same pattern
structure_detail         -- same pattern
rent                     -- annual rent amount
rent_per_sf              -- rent per square foot
leased_area              -- square footage
escalation_schedule      -- "10% every 5 years" or "3% annual" or "CPI"
renewal_options          -- structured renewal data
guarantor                -- lease guarantor
```

### Guard Function

```sql
CREATE OR REPLACE FUNCTION should_update_lease_field(
  p_lease_id integer,
  p_field_name text,
  p_new_source_tier smallint
) RETURNS boolean
LANGUAGE sql STABLE AS $$
  -- Returns TRUE if the field should be updated (no existing higher-tier data)
  -- Returns FALSE if existing data is from a more authoritative source
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
```

### Upsert Helper Function

```sql
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
  -- Check existing provenance
  SELECT id, source_tier INTO v_existing_id, v_existing_tier
  FROM lease_field_provenance
  WHERE lease_id = p_lease_id AND field_name = p_field_name AND superseded_at IS NULL;

  -- If existing data is from a MORE authoritative source, skip
  IF v_existing_tier IS NOT NULL AND v_existing_tier < p_source_tier THEN
    RETURN FALSE;
  END IF;

  -- Supersede existing record if present
  IF v_existing_id IS NOT NULL THEN
    UPDATE lease_field_provenance SET superseded_at = NOW() WHERE id = v_existing_id;
  END IF;

  -- Insert new provenance
  INSERT INTO lease_field_provenance (
    lease_id, field_name, field_value, source_tier, source_label,
    source_file, source_detail, captured_by, notes
  ) VALUES (
    p_lease_id, p_field_name, p_field_value, p_source_tier, p_source_label,
    p_source_file, p_source_detail, p_captured_by, p_notes
  ) RETURNING id INTO v_new_id;

  -- Link supersession chain
  IF v_existing_id IS NOT NULL THEN
    UPDATE lease_field_provenance SET superseded_by = v_new_id WHERE id = v_existing_id;
  END IF;

  -- Update the denormalized column on leases if it exists
  -- (roof_responsibility, hvac_responsibility, etc.)
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
```

### Reconciliation Views

```sql
-- View 1: Leases missing responsibility data (prioritized for research)
CREATE OR REPLACE VIEW v_lease_responsibility_gaps AS
SELECT 
  l.lease_id, l.property_id, l.tenant, l.operator,
  l.expense_structure, l.expense_structure_canonical,
  l.rent, l.leased_area,
  l.roof_responsibility,
  l.hvac_responsibility,
  l.structure_responsibility,
  l.parking_responsibility,
  -- Count how many responsibility fields are populated
  (CASE WHEN l.roof_responsibility IS NOT NULL THEN 1 ELSE 0 END +
   CASE WHEN l.hvac_responsibility IS NOT NULL THEN 1 ELSE 0 END +
   CASE WHEN l.structure_responsibility IS NOT NULL THEN 1 ELSE 0 END +
   CASE WHEN l.parking_responsibility IS NOT NULL THEN 1 ELSE 0 END) as responsibility_fields_populated,
  -- Best source tier across all provenance fields
  (SELECT MIN(source_tier) FROM lease_field_provenance lfp 
   WHERE lfp.lease_id = l.lease_id AND lfp.superseded_at IS NULL) as best_source_tier,
  -- Worst source tier (weakest link)
  (SELECT MAX(source_tier) FROM lease_field_provenance lfp 
   WHERE lfp.lease_id = l.lease_id AND lfp.superseded_at IS NULL) as worst_source_tier,
  p.current_value_estimate,
  p.priority_score
FROM leases l
JOIN properties p ON p.property_id = l.property_id
WHERE l.is_active = true
ORDER BY 
  responsibility_fields_populated ASC,  -- least data first
  p.current_value_estimate DESC NULLS LAST;  -- highest value properties first

-- View 2: Cross-record reconciliation — flag same operator/vintage with different structures  
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

-- View 3: Provenance audit trail for a given lease
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
```

---

## Seed Script: Backfill Default Responsibilities from Canonical Structure

```sql
-- For leases with a canonical expense structure, seed tier-7 (inferred) 
-- responsibility defaults so there's SOMETHING to start from
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
AND resp.value #>> '{}' != 'varies'  -- only seed definitive defaults, not "varies"
ON CONFLICT DO NOTHING;

-- Also update the denormalized columns on leases
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
```

---

## Pipeline Integration Points

### 1. Sidebar Pipeline (sidebar-pipeline.js)

When the pipeline writes lease data from CoStar, it should call `upsert_lease_field()` with `source_tier=5` (`costar_verified`) for each field instead of directly updating the leases table. The function handles the tier check and denormalized column sync.

### 2. OM / Lease Document Intake

When Scott uploads an OM or lease document through the intake pipeline, the lease abstract extraction should call `upsert_lease_field()` with `source_tier=3` (OM) or `source_tier=1` (lease doc). This automatically upgrades any CoStar-sourced data.

### 3. BOV Skill

When the BOV skill pulls lease data, it should show the source tier alongside each field so Scott knows the confidence level. Fields at tier 5+ should be flagged as "verify from lease" in the workbook.

### 4. Manual Override (Sidebar / Cowork)

When Scott manually corrects a field through the LCC sidebar or Cowork, that should be tier 1 or 2 depending on context, ensuring it never gets overwritten by a subsequent CoStar scrape.

---

## Usage Examples

```sql
-- Record that a lease document says tenant handles roof repair + replacement
SELECT upsert_lease_field(
  5126,                        -- lease_id
  'roof_responsibility',       -- field
  'tenant',                    -- value
  1,                           -- tier 1 = lease document
  'lease_document',            -- source label
  'manual',                    -- captured by
  'DaVita_Vista_Del_Sol_Lease_2016.pdf',  -- source file
  'Section 7.2(a)',            -- source detail
  'Tenant responsible for repair, replacement and maintenance of roof per original lease'
);

-- Later, CoStar scrape tries to set it to "landlord" — blocked by guard
SELECT upsert_lease_field(
  5126, 'roof_responsibility', 'landlord', 
  5, 'costar_verified', 'sidebar_pipeline'
);
-- Returns FALSE — tier 5 cannot overwrite tier 1

-- Query: Which high-value properties have unverified lease responsibility data?
SELECT * FROM v_lease_responsibility_gaps 
WHERE current_value_estimate > 3000000 
AND (best_source_tier IS NULL OR worst_source_tier >= 5)
LIMIT 50;
```
