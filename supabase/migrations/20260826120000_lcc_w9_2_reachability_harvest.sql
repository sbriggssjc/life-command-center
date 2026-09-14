-- W9.2 (Prompt 88, 2026-08-08): Contact-reachability INTERNAL harvest.
--
-- Wave 9 (data connectedness) unit 1. Reuses the W8 U1–U5 house shapes (pure
-- planner module, GET dry-run / ?score=1&n= inline sample / POST flag-gated tick,
-- reversible batch ledger, in-migration flag registration, nightly no-op-while-off
-- cron, bounded + resumable scoring, loud scan_errors) — it does NOT fork a new
-- pattern. Additive + idempotent on LCC Opps (xengecqvemvfknjvbvrq).
--
-- THE GAP (grounded live 2026-08-08): domain contacts with NEITHER email nor phone
--   * dia.contacts 4,234 / 5,951 (71%)
--   * gov.contacts 10,542 / 15,434 (68%)  ← measured this unit
-- LCC already HOLDS much of the missing reachability data — synced SF contact
-- records, sidebar captures, intake extraction snapshots (owner/seller/broker
-- email+phone), correspondence/activity. W9.2 harvests INTERNAL sources ONLY.
-- External acquisition (SOS / deed chain) is W9.1 — NOT this unit. The web-search
-- proxy stays PAUSED.
--
-- DOCTRINE (non-negotiable — deterministic-first, the U5/85 lesson):
--   ARM 1 (deterministic, NO LLM): exact-identity matches — the SAME person's
--     synced record (matched via sf_contact_id / salesforce_id / cross_domain link,
--     NOT name-fuzz) carries an email/phone the target contact lacks → a
--     fill-blanks proposal with a source pointer, provider 'none', confidence 1.0.
--     Arithmetic, not judgment — bulk-confirmable, excluded from any distribution
--     guard.
--   ARM 2 (llm, surface clean_assist): fuzzy attribution — an email/phone observed
--     in an intake snapshot / on an attributed thread that LIKELY belongs to this
--     contact (name in the same evidence). U3-pattern: a VERBATIM quote is REQUIRED
--     (the span containing the harvested email/phone AND the name); the validator
--     DROPS a non-verbatim proposal (dropped log = precision floor) and a value not
--     present in the quote. no_evidence_found is honest + counted (no LLM writes).
--   A HUMAN confirm lane decides; a deterministic fill-blanks writer applies with
--   provenance (field_source_priority rows registered below so
--   v_field_provenance_unranked stays 0). NEVER fabricate a contact detail.
--
-- This migration creates:
--   * reachability_harvest_batch      — per-run reversible scan ledger
--   * reachability_harvest_review     — the proposed reachability fills (one per target/field)
--   * reachability_harvest_apply_log  — the deterministic-writer reversal ledger
--   * reachability_harvest_dropped_log — the precision-floor metric (validator drops)
--   * v_reachability_harvest_review_open — the Decision Center lane source (open proposals)
--   * v_lcc_reachability_harvest_health  — Health-surface tile
--   * field_source_priority rows for sources 'w9_2_internal_harvest'(60) +
--     'comms_observed'(40) on dia/gov contacts email/phone so the writer's
--     provenance stamps are ranked (drift view stays 0)
--   * feature flag W9_2_REACHABILITY_HARVEST (default OFF, registered here per 36y)
--   * a nightly off-hours pg_cron POST to /api/reachability-harvest-tick (4:40 UTC,
--     after the W8 chain — GaryBuilt is serial; no-ops while OFF)
--
-- REVERSAL RUNBOOK
--   -- This unit writes NO canonical data until a HUMAN accepts a proposal. On
--   --   accept the deterministic writer fill-blanks the domain contact's email/phone
--   --   + stamps field_provenance; every write is logged to reachability_harvest_apply_log.
--   -- To retire a scan batch's un-worked proposals:
--   SELECT * FROM public.reachability_harvest_batch WHERE status='open' ORDER BY created_at DESC;
--   DELETE FROM public.reachability_harvest_review
--     WHERE scan_batch_id=<id> AND status='proposed';   -- worked rows are kept
--   -- To reverse an APPLIED fill (accepted proposal):
--   SELECT * FROM public.reachability_harvest_apply_log WHERE status='applied' ORDER BY created_at DESC;
--   --   each row carries reversal={target_database, target_table, record_id, field,
--   --   prior_value (null — fill-blanks only), provenance_ids[]};
--   --   set the domain field back to prior_value via /api/apply-change (or domainQuery),
--   --   then flip the log row status='reversed'.
--   -- To retire the feature: flip W9_2_REACHABILITY_HARVEST off (default) — the cron
--   --   POST no-ops and the tick GET stays a dry-run.

BEGIN;

-- Reversible scan ledger — one row per tick run (batch_kind='scan'). Mirrors the
-- W8 U3 batch. The resumable scored-marker cursors live in details.scored_markers.
CREATE TABLE IF NOT EXISTS public.reachability_harvest_batch (
  batch_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_kind    text NOT NULL DEFAULT 'scan'
                  CHECK (batch_kind IN ('scan')),
  source_run_id text NOT NULL,
  status        text NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'closed', 'reversed')),
  actor         uuid,
  details       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reachability_harvest_batch_run
  ON public.reachability_harvest_batch (source_run_id, created_at DESC);

COMMENT ON TABLE public.reachability_harvest_batch IS
  'W9.2: reversible ledger for the contact-reachability internal-harvest tick. scan rows = a run (details carry per-arm/per-source generated/scored/proposed/no_evidence/dropped counts + resumable scored_markers + loud scan_errors).';

-- Proposed reachability fills. One per scored (target contact, field), keyed by
-- subject_ref (rh:<arm>:<domain>:<contactId>:<field>) so a re-scan is idempotent
-- (merge-duplicates) and a decided row is excluded from re-proposal.
CREATE TABLE IF NOT EXISTS public.reachability_harvest_review (
  review_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject_ref      text NOT NULL UNIQUE,
  arm              text NOT NULL                    -- 'deterministic' | 'llm'
                     CHECK (arm IN ('deterministic', 'llm')),
  domain           text NOT NULL                    -- 'dia' | 'gov'
                     CHECK (domain IN ('dia', 'gov')),
  target_kind      text NOT NULL DEFAULT 'contact'  -- 'contact' (fill blank) | 'owner' (propose-new — future)
                     CHECK (target_kind IN ('contact', 'owner')),
  target_contact_id text,                           -- domain contacts PK (uuid text)
  target_owner_id  text,                            -- true_owner id (for value-rank + owner-scope)
  owner_name       text,
  contact_name     text,
  -- The PROPOSAL (proposal-only; a human confirm-lane decides; the writer applies).
  field            text NOT NULL                    -- 'email' | 'phone'
                     CHECK (field IN ('email', 'phone')),
  proposed_value   text NOT NULL,
  proposed_verdict text NOT NULL DEFAULT 'fill_proposal'
                     CHECK (proposed_verdict IN ('fill_proposal', 'no_evidence_found')),
  evidence_quote   text,                            -- VERBATIM (validated) span (llm arm)
  evidence_source  text,                            -- source pointer ([E#] / donor contact_id / intake_id)
  evidence_hash    text,                            -- resumable scored-marker key
  source_pointer   jsonb NOT NULL DEFAULT '{}'::jsonb, -- {donor_contact_id?, donor_key?, intake_id?, table?}
  confidence       numeric NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  reason           text,
  rank_value       numeric,
  seeder           text NOT NULL DEFAULT 'w9_2_reachability_harvest',
  provenance_source text NOT NULL DEFAULT 'w9_2_internal_harvest'
                     CHECK (provenance_source IN ('w9_2_internal_harvest', 'comms_observed')),
  model_provider   text,
  model_name       text,
  source_run_id    text NOT NULL,
  scan_batch_id    bigint REFERENCES public.reachability_harvest_batch(batch_id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'proposed'
                     CHECK (status IN ('proposed', 'applied', 'rejected', 'conflict', 'superseded')),
  applied_log_id   bigint,
  decided_by       uuid,
  decided_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reachability_harvest_review_open
  ON public.reachability_harvest_review (status, arm, confidence DESC, rank_value DESC NULLS LAST, created_at DESC)
  WHERE status = 'proposed';
CREATE INDEX IF NOT EXISTS idx_reachability_harvest_review_target
  ON public.reachability_harvest_review (domain, target_contact_id, field, status);

COMMENT ON TABLE public.reachability_harvest_review IS
  'W9.2: contact-reachability internal-harvest PROPOSALS (seeder w9_2_reachability_harvest). Proposal-only — a deterministic (arm=deterministic, confidence 1.0, provider none) exact-identity fill, or an LLM-attributed (arm=llm) fill that carries a VERBATIM evidence_quote containing the value (validator-enforced). A HUMAN verdict (Decision Center reachability_harvest_review lane) applies via the deterministic fill-blanks writer (domain contacts email/phone + provenance). NEVER an auto-write; NEVER fabricated.';

CREATE OR REPLACE FUNCTION public.reachability_harvest_review_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reachability_harvest_review_touch ON public.reachability_harvest_review;
CREATE TRIGGER trg_reachability_harvest_review_touch
  BEFORE UPDATE ON public.reachability_harvest_review
  FOR EACH ROW EXECUTE FUNCTION public.reachability_harvest_review_touch();

-- The deterministic-writer reversal ledger — one row per APPLIED fill (human accept).
CREATE TABLE IF NOT EXISTS public.reachability_harvest_apply_log (
  apply_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  review_id      bigint REFERENCES public.reachability_harvest_review(review_id) ON DELETE SET NULL,
  subject_ref    text NOT NULL,
  source_run_id  text NOT NULL DEFAULT 'verdict',
  status         text NOT NULL DEFAULT 'applied'
                   CHECK (status IN ('applied', 'reversed', 'conflict')),
  actor          uuid,
  reversal       jsonb NOT NULL DEFAULT '{}'::jsonb,
  details        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reachability_harvest_apply_log_review
  ON public.reachability_harvest_apply_log (review_id, created_at DESC);

COMMENT ON TABLE public.reachability_harvest_apply_log IS
  'W9.2: reversible ledger for accepted reachability fills. reversal={target_database, target_table, record_id, field, prior_value (null — fill-blanks only), provenance_ids[]} — recorded BEFORE the mutation so an accept is always undoable.';

-- The precision-floor metric (W7.4 pattern): every LLM proposal the validator
-- DROPPED (value not in quote / non-verbatim / below confidence). Audit-only.
CREATE TABLE IF NOT EXISTS public.reachability_harvest_dropped_log (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject_ref    text,
  arm            text,
  domain         text,
  field          text,
  proposed_value text,
  quote          text,
  reason         text NOT NULL,        -- value_not_in_quote | quote_not_verbatim | no_quote | below_confidence | invalid_value
  source_run_id  text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reachability_harvest_dropped_log_run
  ON public.reachability_harvest_dropped_log (source_run_id, created_at DESC);

COMMENT ON TABLE public.reachability_harvest_dropped_log IS
  'W9.2: evidence-validator drops (value-not-in-quote / non-verbatim / below-confidence reachability proposals). The free precision floor — logged for audit, never surfaced on the lane.';

GRANT SELECT ON public.reachability_harvest_batch      TO anon, authenticated, service_role;
GRANT SELECT ON public.reachability_harvest_review     TO anon, authenticated, service_role;
GRANT SELECT ON public.reachability_harvest_apply_log  TO anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.reachability_harvest_dropped_log TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.reachability_harvest_dropped_log_id_seq TO anon, authenticated, service_role;

-- Decision Center lane source: open reachability proposals. Deterministic fills
-- (arm=deterministic, confidence 1.0) rank FIRST (bulk-confirmable), then by $ value.
CREATE OR REPLACE VIEW public.v_reachability_harvest_review_open AS
SELECT review_id, subject_ref, arm, domain, target_kind, target_contact_id, target_owner_id,
       owner_name, contact_name, field, proposed_value, proposed_verdict,
       evidence_quote, evidence_source, source_pointer, confidence, reason, rank_value,
       provenance_source, model_provider, model_name, source_run_id, created_at
  FROM public.reachability_harvest_review
 WHERE status = 'proposed'
   AND proposed_verdict = 'fill_proposal'
 ORDER BY (arm = 'deterministic') DESC, confidence DESC, rank_value DESC NULLS LAST, created_at DESC;

GRANT SELECT ON public.v_reachability_harvest_review_open TO anon, authenticated, service_role;

-- Health tile — flag state + open/applied counts + the dropped precision-floor
-- ratio. amber while the flag is off (a flag-gated no-op must be visible).
CREATE OR REPLACE VIEW public.v_lcc_reachability_harvest_health AS
WITH p AS (
  SELECT count(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS proposals_24h,
         count(*) FILTER (WHERE status = 'proposed' AND proposed_verdict = 'fill_proposal')::int AS open_proposals,
         count(*) FILTER (WHERE status = 'proposed' AND proposed_verdict = 'fill_proposal' AND arm = 'deterministic')::int AS open_deterministic,
         count(*) FILTER (WHERE status = 'proposed' AND proposed_verdict = 'fill_proposal' AND arm = 'llm')::int AS open_llm,
         count(*) FILTER (WHERE status = 'applied')::int AS applied_total,
         count(*) FILTER (WHERE status = 'rejected')::int AS rejected_total,
         max(created_at) AS latest_proposal_at
    FROM public.reachability_harvest_review
),
d AS (
  SELECT count(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS dropped_24h
    FROM public.reachability_harvest_dropped_log
),
f AS (
  SELECT state FROM public.feature_flags_registry
   WHERE flag = 'W9_2_REACHABILITY_HARVEST' LIMIT 1
)
SELECT 'reachability_harvest'::text AS subsystem,
       'contact_reachability_harvest'::text AS check_name,
       CASE WHEN coalesce((SELECT state FROM f), 'off') = 'off' THEN 'amber' ELSE 'green' END AS status,
       coalesce((SELECT open_proposals FROM p), 0)::int AS count,
       coalesce((SELECT latest_proposal_at FROM p), now()) AS first_seen,
       now() AS ts,
       CASE WHEN coalesce((SELECT state FROM f), 'off') = 'off'
            THEN 'W9_2_REACHABILITY_HARVEST feature flag is off' ELSE NULL END AS last_error,
       NULL::text AS external_url,
       jsonb_build_object(
         'feature_flag_state', coalesce((SELECT state FROM f), 'off'),
         'proposals_24h', coalesce((SELECT proposals_24h FROM p), 0),
         'open_proposals', coalesce((SELECT open_proposals FROM p), 0),
         'open_deterministic', coalesce((SELECT open_deterministic FROM p), 0),
         'open_llm', coalesce((SELECT open_llm FROM p), 0),
         'applied_total', coalesce((SELECT applied_total FROM p), 0),
         'rejected_total', coalesce((SELECT rejected_total FROM p), 0),
         'dropped_24h', coalesce((SELECT dropped_24h FROM d), 0),
         'latest_proposal_at', (SELECT latest_proposal_at FROM p)
       ) AS details;

GRANT SELECT ON public.v_lcc_reachability_harvest_health TO anon, authenticated, service_role;

-- field_source_priority: register the deterministic writer's provenance sources so
-- v_field_provenance_unranked stays 0. The writer stamps field_provenance on the
-- domain contact's reachability field (target_table 'dia.contacts'/'gov.contacts',
-- field_name email/phone via the domain's column names). Two sources:
--   * comms_observed        (40) — a value OBSERVED in real correspondence/intake,
--                                  attributed to this contact (higher trust band).
--   * w9_2_internal_harvest (60) — the generic internal-harvest fill (deterministic
--                                  exact-identity donor). BOTH sit BELOW manual (1),
--                                  recorded/county (3-5), salesforce (20), and
--                                  om_extraction (35-45) — a harvested/observed value
--                                  never outranks a curated or signed source.
INSERT INTO public.field_source_priority (target_table, field_name, source, priority, min_confidence, enforce_mode, notes)
SELECT v.target_table, v.field_name, v.source, v.priority, v.min_confidence, 'record_only', v.notes
FROM (VALUES
  ('dia.contacts', 'contact_email', 'comms_observed',        40, 0.60, 'W9.2: email observed in correspondence/intake, attributed to this contact (verbatim-quoted).'),
  ('dia.contacts', 'contact_email', 'w9_2_internal_harvest', 60, 0.00, 'W9.2: email harvested from an internal exact-identity source (fill-blanks).'),
  ('dia.contacts', 'contact_phone', 'comms_observed',        40, 0.60, 'W9.2: phone observed in correspondence/intake, attributed to this contact (verbatim-quoted).'),
  ('dia.contacts', 'contact_phone', 'w9_2_internal_harvest', 60, 0.00, 'W9.2: phone harvested from an internal exact-identity source (fill-blanks).'),
  ('gov.contacts', 'email',         'comms_observed',        40, 0.60, 'W9.2: email observed in correspondence/intake, attributed to this contact (verbatim-quoted).'),
  ('gov.contacts', 'email',         'w9_2_internal_harvest', 60, 0.00, 'W9.2: email harvested from an internal exact-identity source (fill-blanks).'),
  ('gov.contacts', 'phone',         'comms_observed',        40, 0.60, 'W9.2: phone observed in correspondence/intake, attributed to this contact (verbatim-quoted).'),
  ('gov.contacts', 'phone',         'w9_2_internal_harvest', 60, 0.00, 'W9.2: phone harvested from an internal exact-identity source (fill-blanks).')
) AS v(target_table, field_name, source, priority, min_confidence, notes)
WHERE NOT EXISTS (
  SELECT 1 FROM public.field_source_priority f
  WHERE f.target_table = v.target_table AND f.field_name = v.field_name AND f.source = v.source
);

-- Feature flag (36y rule: registered IN the migration, default OFF).
INSERT INTO public.feature_flags_registry (flag, purpose, surface, env_var, state, off_since, owner, notes)
VALUES (
  'W9_2_REACHABILITY_HARVEST',
  'W9.2 data-connectedness: contact-reachability INTERNAL harvest. For domain contacts lacking email AND phone (dia 71% / gov 68%), fill the blank from sources LCC ALREADY HOLDS — ARM 1 deterministic exact-identity (a synced SF/sidebar record of the SAME person via sf_contact_id/salesforce_id, confidence 1.0, NO LLM), ARM 2 llm-attributed (an email/phone in an intake snapshot naming this contact, quoted VERBATIM; validator drops a value not in the quote → reachability_harvest_dropped_log). Human confirm lane (Decision Center reachability_harvest_review) → deterministic fill-blanks writer (domain contacts email/phone + provenance). NEVER auto-writes, never fabricates. External acquisition (SOS/deed) is W9.1, not this unit; web-search proxy stays PAUSED.',
  'api/admin.js?_route=reachability-harvest-tick + reachability_harvest_review + Decision Center (reachability_harvest_review lane)',
  'W9_2_REACHABILITY_HARVEST',
  'off',
  DATE '2026-08-08',
  'Scott Briggs',
  'Proposal-only — ZERO auto-writes. Deterministic fills (arm=deterministic) are arithmetic (bulk-confirmable); LLM fills (arm=llm) carry a verbatim quote containing the value. A human verdict applies via the deterministic fill-blanks writer (domain contacts email/phone + field_provenance, sources w9_2_internal_harvest@60 / comms_observed@40, reversible reachability_harvest_apply_log). no_evidence_found is honest/counted. Flip on after the ?score=1 dry-run sample is reviewed. LLM arm uses OLLAMA_URL/OLLAMA_MODEL via invokeExtractionAI (surface clean_assist).'
)
ON CONFLICT (flag) DO UPDATE
  SET purpose = EXCLUDED.purpose,
      surface = EXCLUDED.surface,
      env_var = EXCLUDED.env_var,
      notes = EXCLUDED.notes,
      updated_at = now();

-- Nightly off-hours cron (04:40 UTC, AFTER the W8 chain — U1 03:40 / U2 03:50 /
-- U3 04:10 / U5 04:25 — GaryBuilt is serial). POSTs the Railway tick; the tick
-- itself no-ops while the flag is off, so this is inert until the flag flips.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'lcc_cron_post') THEN
    BEGIN
      PERFORM cron.unschedule('reachability-harvest-tick');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM cron.schedule(
      'reachability-harvest-tick',
      '40 4 * * *',
      $cron$SELECT public.lcc_cron_post('/api/reachability-harvest-tick', '{"apply":true,"limit":15}'::jsonb, 'railway');$cron$
    );
  END IF;
END;
$$;

COMMIT;
