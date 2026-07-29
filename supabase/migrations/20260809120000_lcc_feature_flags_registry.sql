-- ============================================================================
-- Inert-Feature Registry (LCC Opps)  —  audit §4.4.3
-- ----------------------------------------------------------------------------
-- One table listing every env-gated capability in the codebase: what it does,
-- which surface it lives on, the env var / adapter flag that gates it, whether
-- it is on / off / partial, since when it has been off, who owns re-enabling
-- it, and a note. The daily briefing email reads this and prints a "Dormant
-- capabilities" line per flag off > 30 days.
--
-- WHY (audit finding 3.1.3): "Half the 'automation' found in this audit was
-- silently off; a flag-gated no-op looks identical to a healthy quiet
-- pipeline." Making "off" visible is the whole point — this table is the
-- single source of truth for that visibility.
--
-- Discipline: additive, idempotent, reversible (DROP TABLE). Seed rows use
-- ON CONFLICT so re-running the migration refreshes the canonical set without
-- clobbering an operator's manual state/notes edits on rows NOT in the seed.
--   * `state`      — 'on' | 'off' | 'partial' (CHECK-enforced).
--   * `off_since`  — best-effort "off since" date. NULL == never enabled /
--                    duration unknown (still surfaced by the briefing).
--   * `flag`       — PK; the human-facing flag name. For the SOS per-state
--                    adapters (gated in code by SOS_STATE_ADAPTERS[X].enabled
--                    AND the shared OWNER_ENRICH_SOS_URL webhook) the flag is
--                    `SOS_STATE_ADAPTERS.<ST>` and `env_var` names the webhook.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.feature_flags_registry (
  flag        text PRIMARY KEY,
  purpose     text,
  surface     text,
  env_var     text,
  state       text NOT NULL CHECK (state IN ('on', 'off', 'partial')),
  off_since   date,
  owner       text,
  notes       text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.feature_flags_registry IS
  'Inert-feature registry (audit §4.4.3): every env-gated capability with its on/off/partial state and since-when-off date. The daily briefing prints a Dormant-capabilities line per flag off > 30 days.';

-- Keep updated_at honest on any manual state change.
CREATE OR REPLACE FUNCTION public.feature_flags_registry_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_feature_flags_registry_touch ON public.feature_flags_registry;
CREATE TRIGGER trg_feature_flags_registry_touch
  BEFORE UPDATE ON public.feature_flags_registry
  FOR EACH ROW EXECUTE FUNCTION public.feature_flags_registry_touch();

-- Anon/auth read so the briefing edge/proxy paths and the app can surface it;
-- writes stay service-role (registry is curated, not user-editable).
GRANT SELECT ON public.feature_flags_registry TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Seed — every env-gated inert capability found in the audit (§3.1.3, §4.4.3)
-- plus the dark-shipped capability toggles caught by grepping api/ and
-- supabase/functions for process.env / Deno.env.get. All default-OFF or
-- never-wired; CONTACTS_HUB is 'partial' (default 'gov' path active, the 'ops'
-- repoint is dormant).
-- ----------------------------------------------------------------------------
INSERT INTO public.feature_flags_registry
  (flag, purpose, surface, env_var, state, off_since, owner, notes)
VALUES
  -- ---- Audit §3.1.3 explicitly-named inert integrations --------------------
  ('SHAREPOINT_LIST_URL',
   'SharePoint folder-feed worker (Power Automate "List folder" ingest of dropped OM/lease files)',
   'api/_handlers/folder-feed.js', 'SHAREPOINT_LIST_URL', 'off', DATE '2026-05-30',
   'Scott Briggs',
   'Unset ⇒ worker no-ops cleanly (returns SHAREPOINT_LIST_URL unset). Depends on a PA "List folder" flow.'),

  ('SF_LIST_IMPORT_URL',
   'Salesforce campaign/list import (PA-flow pull of SF list membership into intake)',
   'api/_handlers/sf-list-import.js', 'SF_LIST_IMPORT_URL', 'off', DATE '2026-05-30',
   'Scott Briggs',
   'PA-flow gate: unset ⇒ the flow never runs. Institution-registry seed is separately gated by SF_LIST_SEED_INSTITUTION.'),

  ('SF_LIST_SEED_INSTITUTION',
   'Seed lcc_institution_contacts from an imported SF list (institution-registry seed)',
   'api/_handlers/sf-list-import.js', 'SF_LIST_SEED_INSTITUTION', 'off', DATE '2026-05-30',
   'Scott Briggs',
   'Sub-gate of SF_LIST_IMPORT_URL; !!env decides seed_institution_enabled. Off ⇒ no institution seed.'),

  ('OPENCORPORATES_API_KEY',
   'OpenCorporates LLC-officer research provider (llc-research tick)',
   'api/_shared/llc-research.js', 'OPENCORPORATES_API_KEY', 'off', DATE '2026-06-27',
   'Scott Briggs',
   'Unset ⇒ OpenCorporates provider disabled. Audit §4.1.5: set the key or explicitly decide against it and delete the tick.'),

  ('OWNER_ENRICH_SOS_URL',
   'Owner-contact SOS-lookup adapter webhook (managing-member/agent from a state SOS)',
   'api/_shared/sos-lookup.js', 'OWNER_ENRICH_SOS_URL', 'off', DATE '2026-06-28',
   'Scott Briggs',
   'isSosAdapterConfigured() needs this webhook AND ≥1 enabled SOS_STATE_ADAPTERS entry. Both absent ⇒ unconfigured no-op.'),

  ('OWNER_ENRICH_ADDRESS_URL',
   'Owner-contact address reverse-lookup adapter webhook',
   'api/_shared/address-reverse.js', 'OWNER_ENRICH_ADDRESS_URL', 'off', DATE '2026-06-27',
   'Scott Briggs',
   'No-ops until a free rate-limited reverse-lookup source is wired. (Audit listed this as OWNER_ENRICH_SOS_ADDRESS_URL; actual env var is OWNER_ENRICH_ADDRESS_URL.)'),

  ('OWNER_ENRICH_DEED_URL',
   'Owner-contact deed-signatory parse adapter webhook (grantee signatory from deed text)',
   'api/_shared/deed-signatory.js', 'OWNER_ENRICH_DEED_URL', 'off', DATE '2026-06-27',
   'Scott Briggs',
   'Adapter deferred until this webhook + a fetchDocText dep are configured.'),

  ('OWNER_ENRICH_WEBSEARCH_URL',
   'Owner-contact web-search enrichment adapter webhook (owner-contact-websearch edge fn)',
   'api/_shared/web-search-enrich.js', 'OWNER_ENRICH_WEBSEARCH_URL', 'off', DATE '2026-06-29',
   'Scott Briggs',
   'PAUSED per CLAUDE.md footgun — do NOT activate. Contact acquisition goes through the public-records chain, not web search.'),

  ('DECISION_OWNER_DEED_WINS',
   'Decision Center bulk "deed-wins" owner apply (recorded-deed source overrides via Unit-2 propagation)',
   'api/admin.js / api/operations.js', 'DECISION_OWNER_DEED_WINS', 'off', DATE '2026-06-27',
   'Scott Briggs',
   'Must equal ''on'' to enable the bulk deed-wins apply; otherwise the endpoint refuses with a set-the-env message.'),

  ('GEOCODIO_API_KEY',
   'Geocodio geocoding tier for the geocode-backfill tick',
   'api/_handlers/geocode-backfill.js', 'GEOCODIO_API_KEY', 'off', NULL,
   'Scott Briggs',
   'Not set ⇒ [geocode-tick] logs "GEOCODIO_API_KEY not set — Geocodio tier disabled." Duration unknown (never configured).'),

  ('GOOGLE_MAPS_API_KEY',
   'Google Maps final-resort geocode fallback for the geocode-backfill tick',
   'api/_handlers/geocode-backfill.js', 'GOOGLE_MAPS_API_KEY', 'off', NULL,
   'Scott Briggs',
   'Not set ⇒ Google final-resort fallback disabled. Duration unknown (never configured).'),

  ('CONTACTS_HUB',
   'Repoint unified_contacts operations from the gov domain DB to the LCC Opps hub',
   'api/operations.js / api/_handlers/contacts-handler.js', 'CONTACTS_HUB', 'partial', NULL,
   'Scott Briggs',
   'Default ''gov'' path is ACTIVE; the ''ops'' repoint is dormant until CONTACTS_HUB=ops. Partial: the flag itself is wired and serving, one branch is unused.'),

  -- ---- SOS per-state adapters (all enabled:false in code) -------------------
  ('SOS_STATE_ADAPTERS.FL',
   'FL Sunbiz SOS detail adapter (managing-member / registered-agent parse)',
   'api/_shared/sos-lookup.js (SOS_STATE_ADAPTERS.FL)', 'OWNER_ENRICH_SOS_URL', 'off', DATE '2026-06-28',
   'Scott Briggs',
   'enabled:false + parse:null. Gov-side FL fetcher confirmed blocked from CI (Cloudflare 403) — see gov docs/SOS_ENDPOINT_VERIFICATION_2026-07-22.md.'),

  ('SOS_STATE_ADAPTERS.CA',
   'CA bizfile SOS detail adapter (managing-member / registered-agent parse)',
   'api/_shared/sos-lookup.js (SOS_STATE_ADAPTERS.CA)', 'OWNER_ENRICH_SOS_URL', 'off', DATE '2026-06-28',
   'Scott Briggs',
   'enabled:false + parse:null. CA bizfile confirmed blocked from CI (Incapsula 403).'),

  ('SOS_STATE_ADAPTERS.TX',
   'TX Comptroller/SOSDirect SOS detail adapter (managing-member / registered-agent parse)',
   'api/_shared/sos-lookup.js (SOS_STATE_ADAPTERS.TX)', 'OWNER_ENRICH_SOS_URL', 'off', DATE '2026-06-28',
   'Scott Briggs',
   'enabled:false + parse:null. TX SOSDirect is a PAID source — deferred.'),

  -- ---- Dark-shipped capability toggles (default OFF), caught by grep --------
  ('DECISION_GOV_WRITEBACK',
   'Decision Center writeback of resolved verdicts into the gov domain DB',
   'api/admin.js', 'DECISION_GOV_WRITEBACK', 'off', NULL,
   'Scott Briggs',
   'writebackOn only when env matches on|1|true|yes|enabled; default OFF ⇒ no gov writeback.'),

  ('DECISION_PROVENANCE_LEARN',
   'Decision Center provenance-learning (learn field_source_priority from human verdicts)',
   'api/admin.js', 'DECISION_PROVENANCE_LEARN', 'off', NULL,
   'Scott Briggs',
   'Default OFF ⇒ unchanged behavior (queue a review instead of learning).'),

  ('DEED_IMPLIED_PRICE_FILL',
   'Fill an implied sale price from deed consideration/transfer-tax when the price is blank',
   'api/_handlers/deed-parser.js', 'DEED_IMPLIED_PRICE_FILL', 'off', NULL,
   'Scott Briggs',
   'Requires DEED_IMPLIED_PRICE_FILL=on|true; default OFF ⇒ no implied-price writes.'),

  ('SF_CONTACT_WRITEBACK',
   'Write resolved contact fields back into Salesforce (contact-writeback drain)',
   'api/_handlers/contact-writeback.js', 'SF_CONTACT_WRITEBACK', 'off', NULL,
   'Scott Briggs',
   'Off ⇒ no writes ("SF_CONTACT_WRITEBACK off — no writes. Set it (deliberate) to drain.").'),

  ('CADENCE_OPEN_TRACKING_ACTIVE',
   'Treat email-open tracking pixels as cadence-advancing signal',
   'api/_shared/cadence-engine.js', 'CADENCE_OPEN_TRACKING_ACTIVE', 'off', NULL,
   'Scott Briggs',
   'Requires CADENCE_OPEN_TRACKING_ACTIVE=true; default OFF ⇒ opens do not advance cadence.'),

  ('CADENCE_TEMPLATE_AUTOSELECT',
   'Auto-select the best outreach template for a cadence step',
   'api/operations.js', 'CADENCE_TEMPLATE_AUTOSELECT', 'off', NULL,
   'Scott Briggs',
   'Ships dark (default OFF); requires CADENCE_TEMPLATE_AUTOSELECT=true.'),

  ('TEAMS_COLD_ALERTS_ENABLED',
   'Post cold-lead / gone-cold cadence alerts to Teams from the briefing data layer',
   'api/_shared/briefing-data.js', 'TEAMS_COLD_ALERTS_ENABLED', 'off', NULL,
   'Scott Briggs',
   'Requires TEAMS_COLD_ALERTS_ENABLED=true; default OFF ⇒ no cold-alert Teams posts.')
ON CONFLICT (flag) DO UPDATE SET
  purpose   = EXCLUDED.purpose,
  surface   = EXCLUDED.surface,
  env_var   = EXCLUDED.env_var,
  state     = EXCLUDED.state,
  off_since = EXCLUDED.off_since,
  owner     = EXCLUDED.owner,
  notes     = EXCLUDED.notes,
  updated_at = now();

-- ----------------------------------------------------------------------------
-- REVERSAL runbook:
--   DROP TRIGGER IF EXISTS trg_feature_flags_registry_touch ON public.feature_flags_registry;
--   DROP FUNCTION IF EXISTS public.feature_flags_registry_touch();
--   DROP TABLE IF EXISTS public.feature_flags_registry;
-- ============================================================================
