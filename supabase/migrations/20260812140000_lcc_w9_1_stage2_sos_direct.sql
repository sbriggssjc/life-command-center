-- ============================================================================
-- W9.1 Stage 2 — SOS-direct via the GaryBuilt residential fetch proxy (Prompt 99)
-- ----------------------------------------------------------------------------
-- Registers the Stage-2 feature flag and the `sos_registry` field-source-priority
-- rows the SOS-direct enrichment writes under (the drift the audit flagged: the
-- gov `gov_sync_sos_registry_managers` sync already tags writes provenance
-- 'sos_registry', but the LCC field_source_priority table had NO sos_registry row,
-- so v_field_provenance_unranked would flag it). Additive, idempotent, reversible.
--
-- The residential fetch proxy (government-lease/sos-proxy/) + the transport option
-- (SOS_PROXY_URL) are code; this migration is the flag + provenance ladder they
-- flow under. The SOS stage in api/_handlers/contact-acquisition-engine.js is
-- proposal-only (contact_acquisition_review lane, human verdict — confirm never
-- auto) and no-ops while W9_1_SOS_DIRECT is off.
-- ============================================================================

BEGIN;

-- 1) Feature-flag registry row (Inert-feature registry — make "off" visible).
INSERT INTO public.feature_flags_registry
  (flag, purpose, surface, env_var, state, off_since, owner, notes)
VALUES
  ('W9_1_SOS_DIRECT',
   'Contact-acquisition Stage 2: SOS-direct managing-member/agent fetch (Stage runner STAGE_SOS) via the GaryBuilt residential fetch proxy',
   'api/_handlers/contact-acquisition-engine.js',
   'W9_1_SOS_DIRECT',
   'off', DATE '2026-08-12',
   'Scott Briggs',
   'Off ⇒ the contact-acquisition runner uses STAGE_1_ORDER (no SOS fetch); on ⇒ appends STAGE_SOS (weekly cadence, capped by CONTACT_ACQ_SOS_MAX). Needs OWNER_ENRICH_SOS_URL + SOS_PROXY_URL (+ dedicated SOS_PROXY_CF_ACCESS_CLIENT_ID/SECRET) and ≥1 enabled SOS_STATE_ADAPTERS entry; any absent ⇒ honest-blocked no-op. Runbook: government-lease/docs/RUNBOOK_sos_proxy_garybuilt.md.')
ON CONFLICT (flag) DO UPDATE SET
  purpose  = EXCLUDED.purpose,
  surface  = EXCLUDED.surface,
  env_var  = EXCLUDED.env_var,
  notes    = EXCLUDED.notes;

-- 2) field_source_priority: register `sos_registry` for the owner manager / agent /
--    mailing fields the SOS-direct enrichment informs. Priority 55 = the SOS-official
--    tier (matches the ORE owner-address authority ladder's sos_registry=70-band intent
--    and the CLAUDE.md "sos_registry (5–55)" ladder): above CoStar/aggregators, below
--    county_records(5-10)/recorded_deed(3)/manual(1). record_only (observe) — consistent
--    with the LLC-research rows on these same fields. Idempotent.
INSERT INTO public.field_source_priority
  (target_table, field_name, source, priority, enforce_mode, notes)
SELECT nr.target_table, nr.field_name, 'sos_registry', 55, 'record_only',
       'W9.1 Stage 2: SOS-direct verified filing (managing member / registered agent / notice address). Below county/deed/manual, above aggregators.'
FROM (VALUES
    ('gov.recorded_owners','manager_name'),
    ('gov.recorded_owners','manager_role'),
    ('gov.recorded_owners','registered_agent_name'),
    ('gov.recorded_owners','registered_agent_address'),
    ('gov.recorded_owners','mailing_address'),
    ('dia.recorded_owners','manager_name'),
    ('dia.recorded_owners','manager_role'),
    ('dia.recorded_owners','registered_agent_name'),
    ('dia.recorded_owners','registered_agent_address'),
    ('dia.recorded_owners','address')
) AS nr(target_table, field_name)
ON CONFLICT (target_table, field_name, source) DO NOTHING;

COMMIT;

-- ── REVERSAL RUNBOOK ────────────────────────────────────────────────────────
-- DELETE FROM public.field_source_priority
--   WHERE source = 'sos_registry'
--     AND notes LIKE 'W9.1 Stage 2:%';
-- DELETE FROM public.feature_flags_registry WHERE flag = 'W9_1_SOS_DIRECT';
