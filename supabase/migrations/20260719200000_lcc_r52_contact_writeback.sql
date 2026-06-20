-- ============================================================================
-- R52 — close the contact loop: Salesforce contact writeback (LCC Opps)
-- 2026-06-20
--
-- The system learns contacts (CoStar/SF pull → entities, R39 dedup, R16/R20
-- acquisition) but the CRM never sees them — the ONLY SF write op was
-- create_opportunity. Grounded live 2026-06-20: 1,159 of 2,045 emailable LCC
-- person entities (57%) carry an email but NO Salesforce Contact identity.
--
-- This migration adds the VALUE-RANKED candidate view that drives the writeback
-- worker (api/_handlers/contact-writeback.js) + a GENTLE gated cron. The
-- worker pushes each candidate to Salesforce UPSERT-BY-EMAIL (never duplicating
-- SF), mirrors the SF Contact identity back, and promotes the SF contact's
-- mailing address to first-class (R52 Unit 1).
--
-- Additive + read-only (a VIEW). Drop the view → zero trace. Apply on LCC Opps
-- (xengecqvemvfknjvbvrq).
-- ============================================================================

-- ── Unit 3: value-ranked writeback candidates ──────────────────────────────
-- Emailable PERSON entities (active, not merged) with NO Salesforce Contact
-- identity. rank_value = the highest BD value reachable from the contact:
--   the person's OWN connected-property value / portfolio rent (R17/BD), else
--   the MAX over the owners the person is associated_with (the contact's value
--   IS the value of the relationship they unlock). NULLS-LAST honest zeros for
--   contacts with no linked value (same posture as P-CONTACT). sf_account_id =
--   a linked owner's Salesforce Account id (so the pushed contact can be filed
--   under the right account); NULL when no linked owner is SF-mapped.
CREATE OR REPLACE VIEW public.v_lcc_contact_writeback_candidates AS
WITH cand AS (
  SELECT e.id AS entity_id, e.workspace_id, e.name, e.email, e.phone, e.domain,
         e.metadata->>'company' AS company
  FROM public.entities e
  WHERE e.entity_type = 'person'
    AND e.merged_into_entity_id IS NULL
    AND e.email IS NOT NULL AND btrim(e.email) <> ''
    AND NOT EXISTS (
      SELECT 1 FROM public.external_identities x
      WHERE x.entity_id = e.id
        AND x.source_system = 'salesforce' AND x.source_type = 'Contact'
    )
),
-- owners (orgs/persons) this contact is associated_with: owner = from, contact = to.
owner_link AS (
  SELECT er.to_entity_id AS person_id, er.from_entity_id AS owner_id
  FROM public.entity_relationships er
  WHERE er.relationship_type = 'associated_with'
)
SELECT
  c.entity_id,
  c.workspace_id,
  c.name,
  c.email,
  c.phone,
  c.company,
  c.domain,
  -- a linked owner's SF Account id (prefer one that is SF-mapped)
  (SELECT xa.external_id
     FROM owner_link ol
     JOIN public.external_identities xa
       ON xa.entity_id = ol.owner_id
      AND xa.source_system = 'salesforce' AND xa.source_type = 'Account'
    WHERE ol.person_id = c.entity_id
    LIMIT 1) AS sf_account_id,
  GREATEST(
    COALESCE(NULLIF(cvself.connected_property_value, 0), 0),
    COALESCE(NULLIF(pself.current_annual_rent_total, 0), 0),
    COALESCE((
      SELECT max(GREATEST(
                 COALESCE(cv.connected_property_value, 0),
                 COALESCE(p.current_annual_rent_total, 0)))
        FROM owner_link ol
        LEFT JOIN public.lcc_entity_connected_value cv ON cv.entity_id = ol.owner_id
        LEFT JOIN public.v_entity_portfolio_all     p  ON p.entity_id  = ol.owner_id
       WHERE ol.person_id = c.entity_id), 0)
  ) AS rank_value,
  GREATEST(
    COALESCE(cvself.connected_property_count, 0),
    COALESCE(pself.current_property_count, 0),
    COALESCE((
      SELECT max(GREATEST(
                 COALESCE(cv.connected_property_count, 0),
                 COALESCE(p.current_property_count, 0)))
        FROM owner_link ol
        LEFT JOIN public.lcc_entity_connected_value cv ON cv.entity_id = ol.owner_id
        LEFT JOIN public.v_entity_portfolio_all     p  ON p.entity_id  = ol.owner_id
       WHERE ol.person_id = c.entity_id), 0)
  ) AS rank_property_count
FROM cand c
LEFT JOIN public.lcc_entity_connected_value cvself ON cvself.entity_id = c.entity_id
LEFT JOIN public.v_entity_portfolio_all     pself  ON pself.entity_id  = c.entity_id;

COMMENT ON VIEW public.v_lcc_contact_writeback_candidates IS
  'R52: emailable person entities with no Salesforce Contact identity, value-ranked by the highest BD value reachable from the contact (own or linked-owner). Drives the contact-writeback worker.';

-- ── GENTLE gated cron ───────────────────────────────────────────────────────
-- DAILY 06:50 UTC. The worker POST is GATED on env SF_CONTACT_WRITEBACK: until
-- Scott sets it (deliberate) + wires the PA `upsert_contact` flow, the POST is a
-- record-only no-op (mode=gated, no writes, no 403 — clean cron). So this cron
-- is INERT until activation; safe to apply now. Endpoint 404s on Railway until
-- api/operations.js ships (same go-live posture as lcc-sf-link-reconcile).
-- Idempotent (unschedule-then-schedule).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('lcc-contact-writeback');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM cron.schedule(
      'lcc-contact-writeback',
      '50 6 * * *',
      $cmd$SELECT public.lcc_cron_post('/api/contact-writeback-tick?limit=50', '{}'::jsonb, 'vercel')$cmd$
    );
  END IF;
END $$;
