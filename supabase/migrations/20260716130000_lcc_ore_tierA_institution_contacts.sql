-- ORE Tier A (2026-07-15): institution-contacts registry + owner→sponsor resolve
-- + gaps/archetype surfaces. LCC-Opps only; additive; reversible; ≤12 api/*.js.
--
-- Grounded live 2026-07-15 (v_lcc_owner_reconcile_candidates × lcc_property_
-- owner_facts): the high-value contactless owner ENTITY is an asset-named SPE
-- shell (Cira Square Master Tenant LLC, LCPC Pentagon Property LLC, Two
-- Independence Hana OW LLC, ARLINGTON VA I FGF LLC), but the property's
-- true_owner_name already carries the real SPONSOR institution:
--   Cira Square Master Tenant LLC → Brandywine Realty Trust
--   LCPC Pentagon Property LLC    → Korea Investment
--   Two Independence Hana OW LLC  → Hana Asset Management
--   Reston VA II FGF LLC          → Hyundai Securities
--   ARLINGTON VA I FGF LLC        → The Shooshan Company
-- So the sponsor is ALREADY in the data — the missing piece is a CONTACT for the
-- institution. Register ONE contact for a top sponsor and it fans out across the
-- sponsor's whole SPE portfolio (Gardner Tannenbaum 30 SPEs, Blackstone 8,
-- Global Net Lease 8, C-III 5, Lincoln Property 4 …).
--
-- Doctrine (Scott, 2026-07-15): reconciliation-first — prefer the in-data
-- true_owner sponsor (a captured, higher-authority field than a naming guess);
-- NEVER invent a contact (an absent institution stays a directed research task).
-- Operators-as-true_owner (DaVita 211 / Fresenius 120 / U.S. Renal 15 SPEs — the
-- R8 dia artifact) are EXCLUDED: an operator is not an owner decision-maker.
--
-- Reuse (don't fork): R47 lcc_resolve_owner_parent + lcc_buyer_parents remain the
-- SPE→parent-by-name machinery; this round adds the CONTACT layer keyed on the
-- true_owner sponsor directly (the reliable gov signal — asset-named SPEs make
-- naming-core clustering weak). The B1 candidate view is the clean contactless-
-- valued-owner universe (buyer-SPE/junk already excluded); the gaps/archetype
-- surfaces build on it. Drop the two objects → zero trace.

BEGIN;

-- ---------------------------------------------------------------------------
-- Institution-name normalizer — the resolution key. Lowercase + collapse all
-- non-alnum to single spaces + trim. Conservative: NO legal-token stripping, so
-- "Brandywine Realty Trust" stays distinct from a hypothetical "Brandywine
-- Realty LLC" (never a false-merge of two firms). IMMUTABLE so the registry, the
-- resolver, and the gaps view agree exactly.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_institution_norm(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(btrim(regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', ' ', 'g')), '');
$$;

-- ---------------------------------------------------------------------------
-- The curated registry: sponsor institution → its decision-maker contact(s).
-- Each row is a CURATED FACT (source-tagged, traceable) — never fabricated.
-- institution_entity_id is OPTIONAL (the sponsor may not be a bridged LCC
-- entity; the norm key is the authoritative match). Drop the table → zero trace.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lcc_institution_contacts (
  id                bigserial PRIMARY KEY,
  institution_norm  text NOT NULL,                 -- lcc_institution_norm(institution_name)
  institution_name  text NOT NULL,                 -- display / source string
  institution_entity_id uuid REFERENCES public.entities(id) ON DELETE SET NULL,
  contact_name      text NOT NULL,
  contact_title     text,
  contact_email     text,
  contact_phone     text,
  source            text NOT NULL DEFAULT 'manual', -- manual | public_ir | sos | deed | referral
  source_url        text,
  note              text,
  confidence        text NOT NULL DEFAULT 'medium'
                      CHECK (confidence IN ('high','medium','low')),
  is_active         boolean NOT NULL DEFAULT true,
  added_by          uuid,
  added_at          timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- One row per (institution, contact-name) — a re-add updates, never dups.
CREATE UNIQUE INDEX IF NOT EXISTS uq_institution_contacts_norm_name
  ON public.lcc_institution_contacts (institution_norm, lower(contact_name));
CREATE INDEX IF NOT EXISTS idx_institution_contacts_norm
  ON public.lcc_institution_contacts (institution_norm) WHERE is_active;

COMMENT ON TABLE public.lcc_institution_contacts IS
  'ORE Tier A: curated sponsor-institution → decision-maker contact registry. '
  'institution_norm (=lcc_institution_norm(name)) is the match key against the '
  'property true_owner sponsor. Source-tagged, traceable; NEVER fabricated — an '
  'absent institution stays a directed research task (v_institution_registry_gaps). '
  'One contact fans out across all of a sponsor''s contactless SPEs.';

-- Keep updated_at fresh (append-only edits).
CREATE OR REPLACE FUNCTION public.lcc_institution_contacts_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.institution_norm IS NULL OR btrim(NEW.institution_norm) = '' THEN
    NEW.institution_norm := public.lcc_institution_norm(NEW.institution_name);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_institution_contacts_touch ON public.lcc_institution_contacts;
CREATE TRIGGER trg_institution_contacts_touch
  BEFORE INSERT OR UPDATE ON public.lcc_institution_contacts
  FOR EACH ROW EXECUTE FUNCTION public.lcc_institution_contacts_touch();

-- ---------------------------------------------------------------------------
-- The resolver: owner SPE entity → its sponsor institution → primary contact.
-- Reconciliation-first (Unit 0): tier-0 prefers the in-data true_owner sponsor
-- (a captured field), tier-1 falls back to the entity's OWN name (the entity IS
-- the sponsor). Operator sponsors are excluded (never an owner decision-maker).
-- Primary contact = highest confidence, then most recent. Empty registry ⇒ no
-- row (safe — the worker/gaps then just surface the institution to fill).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_resolve_institution_contact(p_entity_id uuid)
RETURNS TABLE(
  contact_name text, contact_title text, contact_email text, contact_phone text,
  institution_name text, institution_norm text, contact_id bigint,
  source text, confidence text, match_tier text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sponsor text; v_norm text; v_tier text; v_own text;
BEGIN
  -- tier-0: the current property's true_owner sponsor (excluding operators).
  SELECT pof.true_owner_name INTO v_sponsor
  FROM public.lcc_entity_portfolio_facts pf
  JOIN public.lcc_property_owner_facts pof
    ON pof.source_domain = pf.source_domain AND pof.source_property_id = pf.source_property_id
  WHERE pf.entity_id = p_entity_id AND pf.is_current = true
    AND pof.true_owner_name IS NOT NULL
    AND NOT public.lcc_is_operator_owner_name(pof.true_owner_name)
  LIMIT 1;

  IF v_sponsor IS NOT NULL THEN
    v_norm := public.lcc_institution_norm(v_sponsor); v_tier := 'domain_true_owner';
  END IF;

  -- If the sponsor has no registry contact (or no sponsor), try the entity's own
  -- name (tier-1: the entity itself is the sponsor).
  IF v_norm IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.lcc_institution_contacts ic
                     WHERE ic.is_active AND ic.institution_norm = v_norm) THEN
    SELECT e.name INTO v_own FROM public.entities e WHERE e.id = p_entity_id;
    IF v_own IS NOT NULL AND NOT public.lcc_is_operator_owner_name(v_own)
       AND EXISTS (SELECT 1 FROM public.lcc_institution_contacts ic
                    WHERE ic.is_active AND ic.institution_norm = public.lcc_institution_norm(v_own)) THEN
      v_sponsor := v_own; v_norm := public.lcc_institution_norm(v_own); v_tier := 'owner_name';
    END IF;
  END IF;

  IF v_norm IS NULL THEN RETURN; END IF;

  RETURN QUERY
    SELECT ic.contact_name, ic.contact_title, ic.contact_email, ic.contact_phone,
           v_sponsor, v_norm, ic.id, ic.source, ic.confidence, v_tier
    FROM public.lcc_institution_contacts ic
    WHERE ic.is_active AND ic.institution_norm = v_norm
    ORDER BY CASE ic.confidence WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
             ic.updated_at DESC
    LIMIT 1;
END;
$$;

-- ---------------------------------------------------------------------------
-- v_institution_registry_gaps — the "which institution to fill FIRST" surface.
-- Groups the CONTACTLESS valued owners (the B1 candidate universe filtered to
-- sf-null + no-person-contact — buyer-SPE/junk already excluded there) by their
-- property true_owner SPONSOR, EXCLUDING operators. count of contactless SPEs +
-- rolled-up rent + whether a registry contact exists. Value-ranked. A row with
-- has_registry_contact=false and a high spe_count/total_rent is the highest-value
-- manual action: add ONE contact → resolve many SPEs.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_institution_registry_gaps
WITH (security_invoker = true) AS
WITH contactless AS (
  SELECT c.entity_id, c.owner_name, c.rank_value, c.primary_domain
  FROM public.v_lcc_owner_reconcile_candidates c
  WHERE c.sf_account_id IS NULL AND c.has_person_contact = false
),
sponsored AS (
  SELECT cl.entity_id, cl.owner_name, cl.rank_value, cl.primary_domain,
         s.true_owner_name AS sponsor, public.lcc_institution_norm(s.true_owner_name) AS sponsor_norm
  FROM contactless cl
  JOIN LATERAL (
    SELECT pof.true_owner_name
    FROM public.lcc_entity_portfolio_facts pf
    JOIN public.lcc_property_owner_facts pof
      ON pof.source_domain = pf.source_domain AND pof.source_property_id = pf.source_property_id
    WHERE pf.entity_id = cl.entity_id AND pf.is_current = true AND pof.true_owner_name IS NOT NULL
    LIMIT 1
  ) s ON true
  WHERE s.true_owner_name IS NOT NULL
    AND NOT public.lcc_is_operator_owner_name(s.true_owner_name)
    AND public.lcc_institution_norm(s.true_owner_name) IS NOT NULL
)
SELECT
  sp.sponsor_norm,
  (array_agg(sp.sponsor ORDER BY length(sp.sponsor)))[1]        AS institution_name,
  count(*)                                                       AS spe_count,
  round(sum(COALESCE(sp.rank_value, 0)))::bigint                 AS total_rent,
  array_agg(DISTINCT sp.primary_domain)                          AS domains,
  EXISTS (SELECT 1 FROM public.lcc_institution_contacts ic
           WHERE ic.is_active AND ic.institution_norm = sp.sponsor_norm) AS has_registry_contact,
  (SELECT ic.contact_name FROM public.lcc_institution_contacts ic
    WHERE ic.is_active AND ic.institution_norm = sp.sponsor_norm
    ORDER BY CASE ic.confidence WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, ic.updated_at DESC
    LIMIT 1)                                                     AS registry_contact_name,
  (array_agg(DISTINCT sp.owner_name))[1:5]                       AS sample_spe_names
FROM sponsored sp
GROUP BY sp.sponsor_norm
ORDER BY total_rent DESC NULLS LAST, spe_count DESC;

-- ---------------------------------------------------------------------------
-- v_institution_contact_attachable — the fan-out driver: one row per contactless
-- valued owner SPE whose sponsor HAS a registry contact, carrying the resolved
-- contact fields inline (so the worker attaches with no per-row RPC). Value-
-- ranked. Empty registry ⇒ 0 rows (the worker no-ops cleanly). This is where
-- "one contact fans out across a sponsor's whole SPE portfolio" is expressed —
-- every SPE of a contacted sponsor appears with the SAME contact.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_institution_contact_attachable
WITH (security_invoker = true) AS
WITH contactless AS (
  SELECT c.entity_id, c.owner_name, c.workspace_id, c.rank_value
  FROM public.v_lcc_owner_reconcile_candidates c
  WHERE c.sf_account_id IS NULL AND c.has_person_contact = false
),
sponsored AS (
  SELECT cl.entity_id, cl.owner_name, cl.workspace_id, cl.rank_value,
         s.true_owner_name AS institution_name, public.lcc_institution_norm(s.true_owner_name) AS sponsor_norm
  FROM contactless cl
  JOIN LATERAL (
    SELECT pof.true_owner_name
    FROM public.lcc_entity_portfolio_facts pf
    JOIN public.lcc_property_owner_facts pof
      ON pof.source_domain = pf.source_domain AND pof.source_property_id = pf.source_property_id
    WHERE pf.entity_id = cl.entity_id AND pf.is_current = true AND pof.true_owner_name IS NOT NULL
    LIMIT 1
  ) s ON true
  WHERE s.true_owner_name IS NOT NULL
    AND NOT public.lcc_is_operator_owner_name(s.true_owner_name)
    AND public.lcc_institution_norm(s.true_owner_name) IS NOT NULL
)
SELECT sp.entity_id, sp.owner_name, sp.workspace_id, sp.rank_value,
       sp.institution_name, sp.sponsor_norm,
       ic.id AS registry_contact_id, ic.contact_name, ic.contact_title,
       ic.contact_email, ic.contact_phone, ic.source AS contact_source, ic.confidence AS contact_confidence
FROM sponsored sp
JOIN LATERAL (
  SELECT ic.id, ic.contact_name, ic.contact_title, ic.contact_email, ic.contact_phone, ic.source, ic.confidence
  FROM public.lcc_institution_contacts ic
  WHERE ic.is_active AND ic.institution_norm = sp.sponsor_norm
  ORDER BY CASE ic.confidence WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, ic.updated_at DESC
  LIMIT 1
) ic ON true
ORDER BY sp.rank_value DESC NULLS LAST;

-- ---------------------------------------------------------------------------
-- v_owner_archetype — per contactless valued owner: institutional (its property
-- rolls up to a DISTINCT non-operator sponsor → SPE→parent hop available →
-- resolve_parent_then_registry) vs local (terminal owner, no distinct sponsor →
-- fetch_public_records). Drives the Unit-4 route split + the directed residual.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_owner_archetype
WITH (security_invoker = true) AS
WITH base AS (
  SELECT c.entity_id, c.owner_name, c.rank_value, c.primary_domain,
         c.sf_account_id, c.has_person_contact,
         s.true_owner_name AS sponsor, public.lcc_institution_norm(s.true_owner_name) AS sponsor_norm
  FROM public.v_lcc_owner_reconcile_candidates c
  LEFT JOIN LATERAL (
    SELECT pof.true_owner_name
    FROM public.lcc_entity_portfolio_facts pf
    JOIN public.lcc_property_owner_facts pof
      ON pof.source_domain = pf.source_domain AND pof.source_property_id = pf.source_property_id
    WHERE pf.entity_id = c.entity_id AND pf.is_current = true AND pof.true_owner_name IS NOT NULL
    LIMIT 1
  ) s ON true
)
SELECT
  b.entity_id, b.owner_name, b.rank_value, b.primary_domain,
  b.sponsor AS sponsor_institution, b.sponsor_norm,
  -- institutional: a distinct, non-operator sponsor to resolve+register.
  CASE WHEN b.sponsor_norm IS NOT NULL
        AND NOT public.lcc_is_operator_owner_name(b.sponsor)
        AND b.sponsor_norm <> public.lcc_institution_norm(b.owner_name)
       THEN 'institutional' ELSE 'local' END AS owner_archetype,
  EXISTS (SELECT 1 FROM public.lcc_institution_contacts ic
           WHERE ic.is_active AND ic.institution_norm = b.sponsor_norm) AS has_registry_contact
FROM base b;

-- ---------------------------------------------------------------------------
-- Grants. Views are security_invoker; the SECURITY DEFINER resolver + the
-- guard/norm helpers it calls need EXECUTE. The registry table is readable by
-- the authenticated operator surface; writes go through the service-role API.
-- ---------------------------------------------------------------------------
GRANT SELECT ON public.lcc_institution_contacts,
                public.v_institution_registry_gaps,
                public.v_institution_contact_attachable,
                public.v_owner_archetype TO authenticated;
GRANT EXECUTE ON FUNCTION public.lcc_institution_norm(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lcc_resolve_institution_contact(uuid) TO authenticated, service_role;

COMMIT;
