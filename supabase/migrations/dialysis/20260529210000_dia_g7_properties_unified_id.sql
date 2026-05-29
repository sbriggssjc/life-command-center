-- G7 (dia half, 2026-05-29): give dia.properties a unified_id pointing at the
-- canonical LCC Opps entity (entities.id, uuid) for the property's owner.
-- Per decision: dia properties link to the BD `entities` canonical layer, NOT
-- the people-Contacts hub (which would bloat the now-live Contacts feature).
-- Cross-DB reference (LCC Opps), so no FK — just a stored uuid.
--
-- Backfilled by scripts/A9b_dia_property_unified_id.mjs:
--   1) authoritative now: lcc_entity_portfolio_facts (current owner→entity),
--   2) full coverage once the BD entity sync populates
--      dia.true_owners.lcc_canonical_entity_id (re-run the script then).
--
-- Applied to Dialysis_DB (zqzrriwuavgrquhisnoa). Idempotent.
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS unified_id uuid;

COMMENT ON COLUMN public.properties.unified_id IS
  'G7: canonical LCC Opps entities.id (uuid) for this property''s owner. Cross-DB ref (no FK). Backfilled via A9b_dia_property_unified_id.mjs from lcc_entity_portfolio_facts (authoritative) + dia.true_owners.lcc_canonical_entity_id (once the BD entity sync runs).';

CREATE INDEX IF NOT EXISTS idx_properties_unified_id
  ON public.properties (unified_id) WHERE unified_id IS NOT NULL;
