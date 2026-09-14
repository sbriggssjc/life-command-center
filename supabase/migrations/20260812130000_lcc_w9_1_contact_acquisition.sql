-- W9.1 (Prompt 98, 2026-08-12): Contact-acquisition engine — STAGE 1 (internal sources).
--
-- Wave 9 (data connectedness) unit 1 — the lever on the 68-73% no-contact gap. For
-- the value-ranked pool of true owners with NO contact row (ops-side
-- v_owner_contact_worklist; dia/gov ~3,151 valued owners, 300 >= $1M), run the
-- sanctioned acquisition chain per owner in cost order, stopping at first success.
-- Every stage emits a PROPOSAL (never a direct write); proposals land in a Decision
-- Center confirm lane (contact_acquisition_review). A HUMAN verdict resolves the
-- proposal into the OPS entity graph (attach an existing person / mint a lane-only
-- contact) via the shared contact-attach helpers — NEVER an auto-write.
--
-- This migration reuses the W9.2 house shapes (reversible batch/review/apply-log/
-- dropped-log ledgers, an open-proposals view, a health tile, in-migration flag
-- registration default OFF, a nightly no-op-while-off pg_cron POST, ?score=1&n=
-- inline dry-run) — it does NOT fork a new pattern. Additive + idempotent on LCC
-- Opps (xengecqvemvfknjvbvrq).
--
-- STAGED: this is STAGE 1 — INTERNAL sources only, no external fetches:
--   * Stage 1a cross-reference resolver (deterministic, cheap) — the SAME human/org
--     already carries a contact under a DIFFERENT owner entity (lcc_resolve_owner_
--     cross_reference) or is an institution-class owner with a registry contact
--     (lcc_resolve_institution_contact). Proposal = ATTACH-existing-person (an
--     association, NOT a mint).
--   * Stage 1b deed mining — the owner's own recorded deeds name their people. The
--     deterministic arm fill-blanks the owner mailing address from the grantee
--     block; the LLM arm proposes a CREATE-contact from a deed signatory/officer
--     name with a VERBATIM quote + deed pointer (lane-only mint).
--   * Stage 1c intake/OM broker-of-record — the listing broker on the OM that SOLD
--     the owner their building. Proposal = the broker as an ASSOCIATED research
--     contact, explicitly typed broker_of_record (NEVER conflated with the owner's
--     own people).
-- Stage 2 (SOS-direct via a non-datacenter egress) is a SEPARATE prompt; the stage
-- runner takes a pluggable stage list so it slots in later without rework. The
-- web-search proxy (owner-contact-websearch) STAYS PAUSED.
--
-- DOCTRINE (non-negotiable):
--   * PROPOSAL-ONLY — zero auto-writes; a human verdict applies via the shared
--     contact-attach helpers (ensureEntityLink / linkPersonToEntity /
--     stampContactOnActiveCadence) — the exact steps owner-contact-enrich.js already
--     uses, run ONLY on confirm.
--   * Value-gated (owner rank_value), windowed + cursored pool walk (anti-joins its
--     own proposals — the 92-class guard), stop-at-first-success per owner, capped.
--   * Attach vs mint routed by stage; a broker is ALWAYS typed broker_of_record and
--     NEVER minted as a direct owner contact.
--   * Verbatim-quote validator on every deed/officer-name mint (the U3 pattern);
--     a non-verbatim proposal is DROPPED (dropped log = the precision floor).
--   * Reversible ledgers; idempotent (subject_ref UNIQUE); never fabricate.
--
-- FIELD PROVENANCE: Stage-1 verdicts resolve into the OPS entity graph
-- (entities + entity_relationships + owner_contact_pivot) via ensureEntityLink /
-- linkPersonToEntity — they do NOT stamp field_provenance on domain contacts
-- tables. So NO new field_source_priority rows are required and
-- v_field_provenance_unranked stays 0 (verified; deed/broker/sos source spellings
-- already exist on the domain-contact fields for the domain-side writers). Stage 2
-- (SOS-direct) will register any new spelling IF it writes a domain-contact field.
--
-- This migration creates:
--   * contact_acquisition_batch       — per-run reversible scan ledger (resumable cursor in details)
--   * contact_acquisition_review      — the acquisition PROPOSALS (one per owner/stage/candidate)
--   * contact_acquisition_apply_log   — the verdict-writer reversal ledger
--   * contact_acquisition_dropped_log — the verbatim-validator precision floor
--   * v_contact_acquisition_review_open — the Decision Center lane source (open, value-ranked)
--   * v_lcc_contact_acquisition_health  — the Health-surface tile
--   * feature flag W9_1_CONTACT_ACQUISITION (default OFF)
--   * a nightly off-hours pg_cron POST to /api/contact-acquisition-engine-tick
--     (4:55 UTC — after the owner-contact-signal chain + the W9.3 sf-assist 04:50;
--     no-ops while OFF)
--
-- REVERSAL RUNBOOK
--   -- Writes NO canonical data until a HUMAN accepts a proposal. On accept the
--   --   verdict writer attaches/mints in the ops graph; every write is logged to
--   --   contact_acquisition_apply_log (reversal payload recorded BEFORE the mutation).
--   -- Retire a scan batch's un-worked proposals:
--   SELECT * FROM public.contact_acquisition_batch WHERE status='open' ORDER BY created_at DESC;
--   DELETE FROM public.contact_acquisition_review
--     WHERE scan_batch_id=<id> AND status='proposed';   -- worked rows are kept
--   -- Reverse an APPLIED acquisition (accepted proposal): each apply-log row carries
--   --   reversal={kind, owner_entity_id, contact_entity_id, relationship_id?,
--   --   minted_entity_id?, pivot_prior} — delete the created edge / soft-retire the
--   --   minted entity / restore the pivot pointer, then flip the log row status='reversed'.
--   -- Retire the feature: flip W9_1_CONTACT_ACQUISITION off (default) — the cron POST
--   --   no-ops and the tick GET stays a dry-run.

BEGIN;

-- Reversible scan ledger — one row per tick run (batch_kind='scan'). The resumable
-- cursor (last owner rank_value/entity_id walked) lives in details.cursor.
CREATE TABLE IF NOT EXISTS public.contact_acquisition_batch (
  batch_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_kind    text NOT NULL DEFAULT 'scan'
                  CHECK (batch_kind IN ('scan', 'apply')),
  source_run_id text NOT NULL,
  status        text NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'closed', 'applied', 'conflict', 'reversed')),
  actor         uuid,
  details       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_acquisition_batch_run
  ON public.contact_acquisition_batch (source_run_id, created_at DESC);

COMMENT ON TABLE public.contact_acquisition_batch IS
  'W9.1: reversible ledger for the contact-acquisition engine tick. scan rows = a run (details carry per-stage generated/proposed/dropped/no_source counts + a resumable cursor + loud scan_errors). apply rows = a human verdict.';

-- Proposed acquisitions. One per (owner, stage, candidate), keyed by subject_ref
-- (ca:<stage>:<ownerEntityId>:<candidateHash>) so a re-scan is idempotent
-- (merge-duplicates) and a decided row is excluded from re-proposal.
CREATE TABLE IF NOT EXISTS public.contact_acquisition_review (
  review_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject_ref      text NOT NULL UNIQUE,
  -- The stage that produced this proposal (pluggable; stage-2 'sos_direct' reserved).
  stage            text NOT NULL
                     CHECK (stage IN ('crossref', 'institution', 'deed_signatory', 'broker_of_record', 'sos_direct')),
  -- attach an EXISTING person entity, or MINT a new lane-only contact.
  proposed_kind    text NOT NULL
                     CHECK (proposed_kind IN ('attach', 'mint')),
  domain           text,                             -- 'dia' | 'gov' | 'lcc' (owner primary domain)
  owner_entity_id  uuid NOT NULL,                    -- the contactless owner (ops entities.id)
  owner_name       text,
  rank_value       numeric,                          -- owner portfolio value (value-gate/rank)
  -- The proposed contact.
  candidate_entity_id uuid,                          -- attach: the existing person entity
  candidate_name   text NOT NULL,
  candidate_role   text,                             -- the person's role at the SOURCE owner (attach)
  candidate_title  text,
  -- The role this contact takes on THIS owner. broker_of_record is ALWAYS distinct
  -- from the owner's own people (never a direct owner contact).
  proposed_contact_role text NOT NULL DEFAULT 'prospecting_contact'
                     CHECK (proposed_contact_role IN ('prospecting_contact', 'broker_of_record', 'deed_signatory')),
  -- Evidence (verbatim-validated for mint stages; a source pointer for attach stages).
  evidence_quote   text,
  evidence_source  text,
  source_pointer   jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence       numeric NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  reason           text,
  seeder           text NOT NULL DEFAULT 'w9_1_contact_acquisition',
  model_provider   text,
  model_name       text,
  source_run_id    text NOT NULL,
  scan_batch_id    bigint REFERENCES public.contact_acquisition_batch(batch_id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'proposed'
                     CHECK (status IN ('proposed', 'applied', 'rejected', 'conflict', 'superseded')),
  applied_log_id   bigint,
  decided_by       uuid,
  decided_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_acquisition_review_open
  ON public.contact_acquisition_review (status, confidence DESC, rank_value DESC NULLS LAST, created_at DESC)
  WHERE status = 'proposed';
CREATE INDEX IF NOT EXISTS idx_contact_acquisition_review_owner
  ON public.contact_acquisition_review (owner_entity_id, stage, status);

COMMENT ON TABLE public.contact_acquisition_review IS
  'W9.1: contact-acquisition PROPOSALS (seeder w9_1_contact_acquisition). Proposal-only. proposed_kind attach = link an EXISTING person entity (cross-reference / institution registry); mint = create a lane-only contact from a deed signatory or an OM broker-of-record (VERBATIM-quoted). A HUMAN verdict (Decision Center contact_acquisition_review lane) applies via the shared contact-attach helpers (ops entity graph). NEVER an auto-write; NEVER fabricated; a broker is ALWAYS typed broker_of_record, never a direct owner contact.';

CREATE OR REPLACE FUNCTION public.contact_acquisition_review_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contact_acquisition_review_touch ON public.contact_acquisition_review;
CREATE TRIGGER trg_contact_acquisition_review_touch
  BEFORE UPDATE ON public.contact_acquisition_review
  FOR EACH ROW EXECUTE FUNCTION public.contact_acquisition_review_touch();

-- The verdict-writer reversal ledger — one row per APPLIED acquisition (human accept).
CREATE TABLE IF NOT EXISTS public.contact_acquisition_apply_log (
  apply_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  review_id      bigint REFERENCES public.contact_acquisition_review(review_id) ON DELETE SET NULL,
  subject_ref    text NOT NULL,
  source_run_id  text NOT NULL DEFAULT 'verdict',
  status         text NOT NULL DEFAULT 'applied'
                   CHECK (status IN ('applied', 'reversed', 'conflict')),
  actor          uuid,
  reversal       jsonb NOT NULL DEFAULT '{}'::jsonb,
  details        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_acquisition_apply_log_review
  ON public.contact_acquisition_apply_log (review_id, created_at DESC);

COMMENT ON TABLE public.contact_acquisition_apply_log IS
  'W9.1: reversible ledger for accepted acquisitions. reversal={kind (attach|mint), owner_entity_id, contact_entity_id, relationship_id?, minted_entity_id?, pivot_prior} — recorded BEFORE the mutation so an accept is always undoable.';

-- The precision-floor metric (U3 pattern): every MINT proposal the verbatim
-- validator DROPPED (name/quote not verbatim in the deed text, or junk name).
CREATE TABLE IF NOT EXISTS public.contact_acquisition_dropped_log (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject_ref    text,
  stage          text,
  domain         text,
  owner_entity_id uuid,
  proposed_name  text,
  quote          text,
  reason         text NOT NULL,   -- name_not_in_quote | quote_not_verbatim | no_quote | junk_name | below_confidence
  source_run_id  text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_acquisition_dropped_log_run
  ON public.contact_acquisition_dropped_log (source_run_id, created_at DESC);

COMMENT ON TABLE public.contact_acquisition_dropped_log IS
  'W9.1: verbatim-validator drops (a deed/officer-name mint whose name/quote is not a verbatim span of the deed text, or a junk name). The free precision floor — logged for audit, never surfaced on the lane.';

GRANT SELECT ON public.contact_acquisition_batch      TO anon, authenticated, service_role;
GRANT SELECT ON public.contact_acquisition_review     TO anon, authenticated, service_role;
GRANT SELECT ON public.contact_acquisition_apply_log  TO anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.contact_acquisition_dropped_log TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.contact_acquisition_dropped_log_id_seq TO anon, authenticated, service_role;

-- Decision Center lane source: open acquisition proposals. Attach proposals
-- (deterministic, cheap) rank FIRST, then by owner $ value.
CREATE OR REPLACE VIEW public.v_contact_acquisition_review_open AS
SELECT review_id, subject_ref, stage, proposed_kind, domain,
       owner_entity_id, owner_name, rank_value,
       candidate_entity_id, candidate_name, candidate_role, candidate_title,
       proposed_contact_role, evidence_quote, evidence_source, source_pointer,
       confidence, reason, model_provider, model_name, source_run_id, created_at
  FROM public.contact_acquisition_review
 WHERE status = 'proposed'
 ORDER BY (proposed_kind = 'attach') DESC, confidence DESC, rank_value DESC NULLS LAST, created_at DESC;

GRANT SELECT ON public.v_contact_acquisition_review_open TO anon, authenticated, service_role;

-- Health tile — flag state + open/applied counts + per-stage open + the dropped
-- precision-floor ratio. amber while the flag is off (a flag-gated no-op must be visible).
CREATE OR REPLACE VIEW public.v_lcc_contact_acquisition_health AS
WITH p AS (
  SELECT count(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS proposals_24h,
         count(*) FILTER (WHERE status = 'proposed')::int AS open_proposals,
         count(*) FILTER (WHERE status = 'proposed' AND proposed_kind = 'attach')::int AS open_attach,
         count(*) FILTER (WHERE status = 'proposed' AND proposed_kind = 'mint')::int AS open_mint,
         count(*) FILTER (WHERE status = 'proposed' AND stage = 'crossref')::int AS open_crossref,
         count(*) FILTER (WHERE status = 'proposed' AND stage = 'institution')::int AS open_institution,
         count(*) FILTER (WHERE status = 'proposed' AND stage = 'deed_signatory')::int AS open_deed,
         count(*) FILTER (WHERE status = 'proposed' AND stage = 'broker_of_record')::int AS open_broker,
         count(*) FILTER (WHERE status = 'applied')::int AS applied_total,
         count(*) FILTER (WHERE status = 'rejected')::int AS rejected_total,
         max(created_at) AS latest_proposal_at
    FROM public.contact_acquisition_review
),
d AS (
  SELECT count(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS dropped_24h
    FROM public.contact_acquisition_dropped_log
),
f AS (
  SELECT state FROM public.feature_flags_registry
   WHERE flag = 'W9_1_CONTACT_ACQUISITION' LIMIT 1
)
SELECT 'contact_acquisition'::text AS subsystem,
       'contact_acquisition_engine'::text AS check_name,
       CASE WHEN coalesce((SELECT state FROM f), 'off') = 'off' THEN 'amber' ELSE 'green' END AS status,
       coalesce((SELECT open_proposals FROM p), 0)::int AS count,
       coalesce((SELECT latest_proposal_at FROM p), now()) AS first_seen,
       now() AS ts,
       CASE WHEN coalesce((SELECT state FROM f), 'off') = 'off'
            THEN 'W9_1_CONTACT_ACQUISITION feature flag is off' ELSE NULL END AS last_error,
       NULL::text AS external_url,
       jsonb_build_object(
         'feature_flag_state', coalesce((SELECT state FROM f), 'off'),
         'proposals_24h', coalesce((SELECT proposals_24h FROM p), 0),
         'open_proposals', coalesce((SELECT open_proposals FROM p), 0),
         'open_attach', coalesce((SELECT open_attach FROM p), 0),
         'open_mint', coalesce((SELECT open_mint FROM p), 0),
         'open_crossref', coalesce((SELECT open_crossref FROM p), 0),
         'open_institution', coalesce((SELECT open_institution FROM p), 0),
         'open_deed', coalesce((SELECT open_deed FROM p), 0),
         'open_broker', coalesce((SELECT open_broker FROM p), 0),
         'applied_total', coalesce((SELECT applied_total FROM p), 0),
         'rejected_total', coalesce((SELECT rejected_total FROM p), 0),
         'dropped_24h', coalesce((SELECT dropped_24h FROM d), 0),
         'latest_proposal_at', (SELECT latest_proposal_at FROM p)
       ) AS details;

GRANT SELECT ON public.v_lcc_contact_acquisition_health TO anon, authenticated, service_role;

-- Feature flag (36y rule: registered IN the migration, default OFF).
INSERT INTO public.feature_flags_registry (flag, purpose, surface, env_var, state, off_since, owner, notes)
VALUES (
  'W9_1_CONTACT_ACQUISITION',
  'W9.1 data-connectedness (Stage 1, internal sources): the contact-acquisition engine. For the value-ranked pool of true owners with NO contact (ops v_owner_contact_worklist), run the sanctioned chain per owner in cost order, stopping at first success — Stage 1a cross-reference resolver (a person already under a DIFFERENT owner entity, or an institution-registry contact) = ATTACH-existing-person; Stage 1b deed mining (grantee mailing → owner address fill-blanks; deed signatory/officer name → CREATE-contact, VERBATIM-quoted); Stage 1c OM broker-of-record = the listing broker who sold the owner their building, ASSOCIATED + typed broker_of_record. Proposal-only → Decision Center contact_acquisition_review lane; a human verdict applies via the shared contact-attach helpers (ops entity graph). Stage 2 (SOS-direct) is a separate prompt (pluggable stage list); web-search proxy stays PAUSED.',
  'operations.js?_route=contact-acquisition-engine-tick + contact_acquisition_review + Decision Center (contact_acquisition_review lane)',
  'W9_1_CONTACT_ACQUISITION',
  'off',
  DATE '2026-08-12',
  'Scott Briggs',
  'Proposal-only — ZERO auto-writes. Stage 1a attach (cross-reference / institution registry) is deterministic; Stage 1b/1c mints carry a VERBATIM quote (validator drops a non-verbatim name → contact_acquisition_dropped_log). A broker is ALWAYS typed broker_of_record, never a direct owner contact. A human verdict attaches/mints in the OPS entity graph (ensureEntityLink / linkPersonToEntity / stampContactOnActiveCadence — the owner-contact-enrich confirm steps), reversible via contact_acquisition_apply_log. Stage-1 verdicts do NOT stamp domain-contact field_provenance, so no new field_source_priority rows (drift view stays 0). Flip on after the ?score=1 dry-run sample is reviewed.'
)
ON CONFLICT (flag) DO UPDATE
  SET purpose = EXCLUDED.purpose,
      surface = EXCLUDED.surface,
      env_var = EXCLUDED.env_var,
      notes = EXCLUDED.notes,
      updated_at = now();

-- Nightly off-hours cron (04:55 UTC — after the owner-contact-signal chain (05:00
-- LCC pull is a DIFFERENT job) and the W9.3 sf-assist 04:50; a clean staggered slot).
-- POSTs the Railway tick; the tick no-ops while the flag is off, so this is inert
-- until the flag flips.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'lcc_cron_post') THEN
    BEGIN
      PERFORM cron.unschedule('contact-acquisition-engine-tick');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM cron.schedule(
      'contact-acquisition-engine-tick',
      '55 4 * * *',
      $cron$SELECT public.lcc_cron_post('/api/contact-acquisition-engine-tick', '{"apply":true,"limit":40}'::jsonb, 'railway');$cron$
    );
  END IF;
END;
$$;

COMMIT;
