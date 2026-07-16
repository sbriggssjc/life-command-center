-- ===========================================================================
-- Salesforce "Lists" (Campaigns / CampaignMembers) — list membership record
-- ---------------------------------------------------------------------------
-- Scott's SF "Lists" are standard Campaigns; "List members" are CampaignMembers.
-- The `POST /api/sf-list-import` route ingests them: reconciles each person by
-- email into the LCC entity graph (no dup), relates them to their Company org,
-- and RECORDS the list membership here as the reusable segmentation
-- (product_type / side / broker). This table is the single home for "which
-- curated SF list is this person on, and what does that mean for BD."
--
-- Additive · reversible (DROP TABLE → zero trace) · no domain writes · no auth
-- touch. One row per (campaign_id, entity_id): a re-ingest UPDATES, never dups.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.lcc_sf_list_membership (
  id             bigserial PRIMARY KEY,
  entity_id      uuid NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  campaign_id    text NOT NULL,
  campaign_name  text,
  parent_name    text,
  -- Segmentation derived from the list name:
  product_type   text,           -- GSA / Dialysis / Drug Store / Industrial / …
  side           text NOT NULL DEFAULT 'unknown'
                   CHECK (side IN ('buyer', 'seller', 'unknown')),
  broker         text,           -- "* Seller Prospects" prefix / the Team column
  -- Member facts:
  status         text,           -- CM Relationship / member Status (Open / Assigned …)
  member_type    text,           -- CampaignMember.Type
  city           text,
  state          text,
  company_name   text,
  org_entity_id  uuid REFERENCES public.entities(id) ON DELETE SET NULL,
  sf_contact_id  text,           -- CampaignMember.ContactId
  sf_lead_id     text,           -- CampaignMember.LeadId
  last_activity  text,           -- as reported by the list (free text / date string)
  source         text NOT NULL DEFAULT 'sf_list_import',
  raw            jsonb,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now()
);

-- One membership per (campaign, entity) — the upsert conflict target.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sf_list_membership_campaign_entity
  ON public.lcc_sf_list_membership (campaign_id, entity_id);
CREATE INDEX IF NOT EXISTS idx_sf_list_membership_entity
  ON public.lcc_sf_list_membership (entity_id);
CREATE INDEX IF NOT EXISTS idx_sf_list_membership_side_product
  ON public.lcc_sf_list_membership (side, product_type);
CREATE INDEX IF NOT EXISTS idx_sf_list_membership_org
  ON public.lcc_sf_list_membership (org_entity_id) WHERE org_entity_id IS NOT NULL;

COMMENT ON TABLE public.lcc_sf_list_membership IS
  'Salesforce Lists (Campaigns/CampaignMembers) membership. One row per '
  '(campaign_id, entity_id); segmentation (product_type/side/broker) derived '
  'from the list name. Buyers feed the P-BUYER buy-side pool; sellers feed '
  'owner-prospect + the institution registry. Ingested by /api/sf-list-import. '
  'Additive/reversible — DROP TABLE → zero trace.';
