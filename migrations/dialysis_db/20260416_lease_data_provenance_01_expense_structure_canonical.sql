-- Migration 1: expense_structure_canonical table + seed data + backfill
-- Applied to Dialysis_DB (zqzrriwuavgrquhisnoa) on 2026-04-16

CREATE TABLE expense_structure_canonical (
  raw_value text PRIMARY KEY,
  canonical text NOT NULL,
  responsibility_defaults jsonb NOT NULL DEFAULT '{}',
  notes text,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

INSERT INTO expense_structure_canonical (raw_value, canonical, responsibility_defaults, notes) VALUES
  ('Absolute NNN',   'Absolute NNN', '{"roof":"tenant","hvac":"tenant","structure":"tenant","parking":"tenant","cam":"tenant","insurance":"tenant","taxes":"tenant"}', 'Tenant responsible for everything including structural and capital'),
  ('Abs. NNN',       'Absolute NNN', '{"roof":"tenant","hvac":"tenant","structure":"tenant","parking":"tenant","cam":"tenant","insurance":"tenant","taxes":"tenant"}', NULL),
  ('Abs NNN',        'Absolute NNN', '{"roof":"tenant","hvac":"tenant","structure":"tenant","parking":"tenant","cam":"tenant","insurance":"tenant","taxes":"tenant"}', NULL),
  ('Absolute NNN (GL)', 'Absolute NNN', '{"roof":"tenant","hvac":"tenant","structure":"tenant","parking":"tenant","cam":"tenant","insurance":"tenant","taxes":"tenant"}', 'Ground lease variant'),
  ('NNN',            'NNN',          '{"roof":"varies","hvac":"varies","structure":"varies","parking":"tenant","cam":"tenant","insurance":"tenant","taxes":"tenant"}', 'Roof/HVAC/structure responsibility varies by deal'),
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
  ('Net Lease',      'NNN',          '{"roof":"varies","hvac":"varies","structure":"varies","parking":"tenant","cam":"tenant","insurance":"tenant","taxes":"tenant"}', 'Generic net - treat as NNN until verified'),
  ('Net',            'NNN',          '{"roof":"varies","hvac":"varies","structure":"varies","parking":"tenant","cam":"tenant","insurance":"tenant","taxes":"tenant"}', NULL),
  ('single tenant',  'NNN',          '{"roof":"varies","hvac":"varies","structure":"varies","parking":"varies","cam":"varies","insurance":"varies","taxes":"varies"}', 'Not an expense structure - reclassify based on actual terms'),
  ('leasehold',      'Ground Lease', '{"roof":"tenant","hvac":"tenant","structure":"tenant","parking":"tenant","cam":"tenant","insurance":"tenant","taxes":"varies"}', 'Leasehold/ground lease - tenant typically responsible for building');

ALTER TABLE leases ADD COLUMN IF NOT EXISTS expense_structure_canonical text;

UPDATE leases l SET expense_structure_canonical = esc.canonical
FROM expense_structure_canonical esc
WHERE l.expense_structure = esc.raw_value;
