-- ============================================================================
-- R15 — generic CRE property registry (the "high-value middle")  ·  LCC Opps
-- Phase 1: the store + register-by-path + owner-entity + doc-attach.
--
-- LCC is two deep verticals (dia = CMS, gov = GSA). But the PROPERTIES tree is
-- Briggs's WHOLE net-lease book — office / retail / bank / entertainment / MOB.
-- ~84% of enrich docs are these other asset classes; today they PARK
-- (skip_reason='out_of_domain_asset_class') because they have no home DB. This
-- registry is the LIGHTWEIGHT middle: capture the property + connect its docs +
-- mint the OWNER as a first-class entity, WITHOUT a third underwriting engine
-- (no scoring / NOI / cap-rate columns — deliberately).
--
-- Additive only. Drop these two tables → zero trace, exactly like the rest of
-- the folder-feed footprint.
-- ============================================================================

-- ---- The store -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lcc_cre_properties (
  id                 bigserial PRIMARY KEY,
  -- Natural-key surface: a normalized street address when we have one, else the
  -- tenant_brand + city fallback. Both are deduped by the partial unique
  -- indexes below (a row never carries scoring/financial columns — by design).
  normalized_address text,
  address            text,
  city               text,
  state              text,
  tenant_brand       text,
  asset_class        text NOT NULL DEFAULT 'unknown',   -- office/retail/bank/entertainment/mob/industrial/unknown
  owner_entity_id    uuid REFERENCES public.entities(id) ON DELETE SET NULL,
  source_path        text,                              -- the SharePoint server-relative path that registered it
  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Natural-key dedupe: address+state when an address is known; tenant+city+state
-- otherwise. Partial + lower()/upper()-folded so casing variance can't
-- duplicate a property.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lcc_cre_prop_address
  ON public.lcc_cre_properties (normalized_address, upper(state))
  WHERE normalized_address IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_lcc_cre_prop_tenant_city
  ON public.lcc_cre_properties (lower(tenant_brand), lower(city), upper(state))
  WHERE normalized_address IS NULL AND tenant_brand IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lcc_cre_prop_owner
  ON public.lcc_cre_properties (owner_entity_id) WHERE owner_entity_id IS NOT NULL;

COMMENT ON TABLE public.lcc_cre_properties IS
  'R15 generic CRE property registry for non-dia/gov asset classes (office/retail/bank/...). Relationship-tracked, NOT underwritten — no scoring/NOI/cap-rate columns by design.';

-- ---- The connected documents ----------------------------------------------
CREATE TABLE IF NOT EXISTS public.lcc_cre_property_documents (
  id              bigserial PRIMARY KEY,
  cre_property_id bigint NOT NULL REFERENCES public.lcc_cre_properties(id) ON DELETE CASCADE,
  file_name       text NOT NULL,
  document_type   text,
  source_url      text,
  source          text NOT NULL DEFAULT 'folder_feed_cre',
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cre_property_id, file_name)
);

CREATE INDEX IF NOT EXISTS idx_lcc_cre_doc_property
  ON public.lcc_cre_property_documents (cre_property_id);

COMMENT ON TABLE public.lcc_cre_property_documents IS
  'R15: docs attached to a CRE property (mirrors dia/gov property_documents the enrich path writes).';

-- ---- Provenance registry: register source='folder_feed_cre' so the
-- ---- v_field_provenance_unranked drift detector stays at 0 rows. -----------
INSERT INTO public.field_source_priority (target_table, field_name, source, priority, min_confidence, enforce_mode)
SELECT v.target_table, v.field_name, 'folder_feed_cre', 50, 0.5, 'record_only'
FROM (VALUES
  ('public.lcc_cre_properties', 'address'),
  ('public.lcc_cre_properties', 'city'),
  ('public.lcc_cre_properties', 'state'),
  ('public.lcc_cre_properties', 'tenant_brand'),
  ('public.lcc_cre_properties', 'asset_class'),
  ('public.lcc_cre_properties', 'owner_entity_id'),
  ('public.lcc_cre_properties', 'source_path'),
  ('public.lcc_cre_property_documents', 'file_name'),
  ('public.lcc_cre_property_documents', 'document_type'),
  ('public.lcc_cre_property_documents', 'source_url')
) AS v(target_table, field_name)
ON CONFLICT (target_table, field_name, source) DO NOTHING;
