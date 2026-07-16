-- ============================================================================
-- SF-CONFLATION Unit C3 — retire the `salesforce/Account` identities stamped on
-- PERSON entities (the 559 account-on-person rows)
-- ----------------------------------------------------------------------------
-- Doctrine (Scott, 2026-07-16 — ORE_SF_AS_SOURCE_AUDIT): an SF Account belongs
-- on an ORGANIZATION entity the person is RELATED to, never as an identity ON the
-- person. `syncSalesforceForEntity` used to stamp the contact's companion
-- `salesforce/Account` id straight onto the person (Capra's rel_count=0). The
-- forward writer is fixed (relatePersonToSfAccount, Unit C2/B); this is the
-- one-time, reversible cleanup of the existing rows.
--
-- Grounded live 2026-07-16 (LCC Opps xengecqvemvfknjvbvrq): 559 person entities
-- carry a `salesforce/Account` identity; ALL 559 have NO account NAME available
-- (neither on the identity nor the entity metadata) and 0 of the account ids
-- exist as an org entity — so we CANNOT mint a well-named org for them here. The
-- correct cleanup is therefore: DETACH the account identity from the person,
-- PRESERVE the account id as provenance on the person (metadata.sf_account), and
-- soft-flag the org-NAMED subset (e.g. "Boyd Watterson Global" carrying Eric
-- Dowling's email) into the junk_entity_name lane for rename/merge/retype.
-- When a name IS available later, the forward writer creates the org + edge.
--
-- Reversible (NO hard delete): every detached identity is snapshotted to
-- sf_account_on_person_cleanup_backup; lcc_restore_sf_account_on_person(batch)
-- re-inserts them. Idempotent: a re-run finds 0 (the identities are gone).
-- ============================================================================

-- Reversible backup of every detached identity.
CREATE TABLE IF NOT EXISTS public.sf_account_on_person_cleanup_backup (
  id              bigserial PRIMARY KEY,
  batch_tag       text        NOT NULL,
  entity_id       uuid        NOT NULL,
  workspace_id    uuid,
  external_id     text        NOT NULL,
  source_type     text        NOT NULL,
  external_url    text,
  metadata        jsonb,
  entity_name     text,
  is_org_shaped   boolean,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_sf_account_on_person_cleanup_backup_batch
  ON public.sf_account_on_person_cleanup_backup (batch_tag);

-- ----------------------------------------------------------------------------
-- lcc_cleanup_sf_account_on_person(dry_run, batch_tag) → jsonb report
--   dry_run TRUE (default): counts only, writes NOTHING.
--   dry_run FALSE: snapshot → detach identity → write provenance → soft-flag the
--                  org-named subset. Returns the counts actually applied.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_cleanup_sf_account_on_person(
  p_dry_run   boolean DEFAULT true,
  p_batch_tag text    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  -- Mirror of entity-link.js ENTITY_FIRM_SUFFIX_RE (org-shaped person names). A
  -- firm-suffixed "person" carrying an account identity is a legacy mistype →
  -- soft-flag it into the junk_entity_name lane for retype/merge. Standard firm
  -- suffixes ONLY — no per-case tokens (an org-named dup like "Boyd Watterson
  -- Global" that shares its email with the real person rides the existing
  -- person-email merge lane; this pass only DETACHES its account identity).
  c_firm_rx text := '\y(LLC|L\.L\.C|LP|LLP|Inc|Incorporated|Corp|Corporation|Ltd|Trust|Fund|Holdings|Partners|Ptnrs|Capital|Advisors|Realty|Ventures|Cos|Company|Properties|Property|Associates|Group|Management|Mgmt|Development|Developers|Investments|Investors|Enterprises|Bancorp|Bank|Co)\y';
  v_batch     text := COALESCE(p_batch_tag, 'sf_conflation_c3_' || to_char(now(),'YYYYMMDDHH24MISS'));
  v_total     int  := 0;
  v_org_named int  := 0;
  v_detached  int  := 0;
  v_flagged   int  := 0;
BEGIN
  -- The target set: person entities carrying a salesforce/Account identity.
  CREATE TEMP TABLE _tgt ON COMMIT DROP AS
  SELECT ei.id AS ident_id, ei.entity_id, ei.workspace_id, ei.external_id,
         ei.source_type, ei.external_url, ei.metadata AS ident_meta,
         e.name AS entity_name, e.metadata AS ent_meta,
         (e.name ~* c_firm_rx) AS is_org_shaped
  FROM public.external_identities ei
  JOIN public.entities e ON e.id = ei.entity_id
  WHERE ei.source_system = 'salesforce'
    AND ei.source_type   = 'Account'
    AND e.entity_type    = 'person'
    AND e.merged_into_entity_id IS NULL;

  SELECT count(*), count(*) FILTER (WHERE is_org_shaped) INTO v_total, v_org_named FROM _tgt;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'mode', 'dry_run', 'batch_tag', v_batch,
      'account_on_person_total', v_total,
      'org_shaped_persons', v_org_named,
      'would_detach', v_total, 'would_flag_junk', v_org_named);
  END IF;

  -- 1) Snapshot every identity we are about to detach (reversible).
  INSERT INTO public.sf_account_on_person_cleanup_backup
    (batch_tag, entity_id, workspace_id, external_id, source_type, external_url, metadata, entity_name, is_org_shaped)
  SELECT v_batch, entity_id, workspace_id, external_id, source_type, external_url, ident_meta, entity_name, is_org_shaped
  FROM _tgt;

  -- 2) Preserve provenance on the person (metadata.sf_account) + soft-flag the
  --    org-named subset for the junk_entity_name lane. Merge, never clobber.
  UPDATE public.entities e
  SET metadata = COALESCE(e.metadata, '{}'::jsonb)
                 || jsonb_build_object('sf_account',
                      jsonb_build_object('id', t.external_id,
                                         'detached_from_person', true,
                                         'detached_at', now()::text,
                                         'via', v_batch))
                 || CASE WHEN t.is_org_shaped
                         AND COALESCE(e.metadata->>'junk_name_reviewed','') <> 'true'
                    THEN jsonb_build_object(
                           'junk_name_flagged', 'true',
                           'junk_name_flagged_was', COALESCE(e.metadata->>'junk_name_flagged','false'),
                           'junk_name_source', 'sf_conflation_cleanup')
                    ELSE '{}'::jsonb END
  FROM _tgt t
  WHERE e.id = t.entity_id;
  GET DIAGNOSTICS v_detached = ROW_COUNT;

  SELECT count(*) INTO v_flagged FROM _tgt t
   JOIN public.entities e ON e.id = t.entity_id
   WHERE t.is_org_shaped AND (e.metadata->>'junk_name_flagged') = 'true'
     AND (e.metadata->>'junk_name_source') = 'sf_conflation_cleanup';

  -- 3) Detach the account identity from the person (kept in the backup).
  DELETE FROM public.external_identities ei
  USING _tgt t
  WHERE ei.id = t.ident_id;

  RETURN jsonb_build_object(
    'mode', 'applied', 'batch_tag', v_batch,
    'account_on_person_total', v_total,
    'detached', v_total,
    'provenance_written', v_detached,
    'org_shaped_flagged', v_flagged);
END;
$$;

-- ----------------------------------------------------------------------------
-- Reversal — re-insert the detached identities for a batch (idempotent).
-- Does NOT remove the provenance/junk flags (harmless, additive); to fully
-- revert those, clear metadata.sf_account / restore junk_name_flagged_was.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_restore_sf_account_on_person(p_batch_tag text)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE v_restored int := 0;
BEGIN
  INSERT INTO public.external_identities
    (workspace_id, entity_id, source_system, source_type, external_id, external_url, metadata, last_synced_at)
  SELECT b.workspace_id, b.entity_id, 'salesforce', b.source_type, b.external_id, b.external_url, b.metadata, now()
  FROM public.sf_account_on_person_cleanup_backup b
  WHERE b.batch_tag = p_batch_tag
  ON CONFLICT (workspace_id, source_system, source_type, external_id) DO NOTHING;
  GET DIAGNOSTICS v_restored = ROW_COUNT;
  RETURN jsonb_build_object('batch_tag', p_batch_tag, 'restored', v_restored);
END;
$$;

COMMENT ON FUNCTION public.lcc_cleanup_sf_account_on_person(boolean, text) IS
  'SF-CONFLATION Unit C3: detach salesforce/Account identities from PERSON entities (reversible via sf_account_on_person_cleanup_backup + lcc_restore_sf_account_on_person). Provenance kept in entities.metadata.sf_account; org-named persons soft-flagged into the junk_entity_name lane.';
