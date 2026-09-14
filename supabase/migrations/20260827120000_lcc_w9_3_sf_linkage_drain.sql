-- ============================================================================
-- W9.3 — SF linkage drain + live re-score (LCC Opps side).
--
-- Unlocks W9.2's input-starved donor pool by working the SF-link backlog:
--   WS1  assist pre-rank on the sf_link_candidate review lane (~3.3k needs_review)
--   WS2  live re-score of the ~23.8k no_match rows vs the CURRENT (grown) SF
--        registry (16,210+ accts, was 15,987 at W4.3)
--   WS3  donor handoff — expand a landed owner->account link into person-level
--        sf_contact_id on the owner's blank domain contacts (W9.2's donor key)
--
-- This LCC-Opps migration carries the ops-side plumbing ONLY (the domain writes +
-- reversible ledgers live in the government/ + dialysis/ companions):
--   1. Feature flags W9_3_SF_ASSIST / W9_3_RESCORE / W9_3_DONOR_HANDOFF (OFF).
--   2. Provenance citizenship for the two new domain link writers
--      (splink_v2 = the re-score model; sf_account_contact_expansion = the donor
--      handoff) + extend lcc_flush_provenance_events to PRESERVE them.
--   3. WS1 assist agree/disagree ledger + a metadata-only recorder RPC + the U4
--      accuracy view.
--   4. WS3 donor-coverage metric ledger + trend view (the acceptance metric:
--      blank-reachability contacts carrying an SF key, RISING = W9.2 unlock).
--   5. Nightly crons (no-ops while the flags are OFF), staggered after the W8/W9.2
--      chain.
--
-- DB-safety (LCC Opps is auth-critical): additive only (new tables/views/flags +
-- one function replace that is byte-identical to the W4.4 body except two entries
-- appended to the first-class-source allowlist). No auth-schema contact, no long
-- locks, idempotent (IF NOT EXISTS / OR REPLACE / ON CONFLICT).
--
-- REVERSAL: see each section's inline note; DELETE the fsp rows, drop the two
-- ledgers/views, unschedule the three crons, and restore lcc_flush_provenance_events
-- to the W4.4 two-entry allowlist.
-- ============================================================================

BEGIN;

-- ── 1. Feature flags (default OFF; the ticks no-op while off) ─────────────────
INSERT INTO public.feature_flags_registry (flag, purpose, surface, env_var, state, off_since, owner, notes)
VALUES
  ('W9_3_SF_ASSIST',
   'W9.3 WS1: nightly Ollama pre-rank of the sf_link_candidate review lane (~3.3k needs_review). Ranks each candidate owner<->SF-account pair same-party/not/uncertain with confidence + one-line evidence, stored as an ANNOTATION in lcc_clean_assist_proposals (source w9_3_sf_assist) — NEVER a verdict. The lane sorts easy-first; each human verdict self-measures agree/disagree into v_lcc_w9_3_sf_assist_accuracy.',
   'api/sf-link-assist-tick + lcc_clean_assist_proposals + v_lcc_w9_3_sf_assist_accuracy',
   'W9_3_SF_ASSIST', 'off', DATE '2026-08-08', 'Scott Briggs',
   'Annotation-only. GET reports counts; ?score=1 returns an inline sample (NO writes); POST (flag ON) annotates one bounded resumable batch (~20/night). Uses OLLAMA via invokeExtractionAI (surface sf_link_assist). Nightly cron 04:50 UTC no-ops while OFF.'),
  ('W9_3_RESCORE',
   'W9.3 WS2: live re-score of the ~23.8k no_match sf_link_research_queue rows (gov 21.5k + dia 2.4k) vs the CURRENT SF-account registry (grown since W4.3). Deterministic conservative name gate reproducing W4.3''s exact/near-exact auto-link tier (bands 0.9/0.1): exact clean-name unique -> auto_link (splink_v2 provenance), near-exact/ambiguous -> needs_review (assist-ranked lane), else no_match re-tagged. Reversible ledger w9_3_rescore_log (domain DBs).',
   'api/sf-link-rescore-tick + government/dialysis w9_3_rescore_log + splink_v2 field_source_priority',
   'W9_3_RESCORE', 'off', DATE '2026-08-08', 'Scott Briggs',
   'GET dry-run report; ?score=1 inline sample (NO writes); POST (flag ON) one bounded resumable batch. Null-guarded auto-link (a different pre-existing id -> conflict -> needs_review, never overwrite). Nightly cron 05:10 UTC no-ops while OFF.'),
  ('W9_3_DONOR_HANDOFF',
   'W9.3 WS3: account->contacts expansion. For an owner now linked to SF account A, enumerate A''s SF contacts (gov sf_contacts_import / dia salesforce_contacts), UNIQUE name-match against the owner''s blank domain contacts, and FILL-BLANKS stamp the person-level sf_contact_id (W9.2''s deterministic donor key). Reversible ledger w9_3_donor_handoff_log (domain DBs).',
   'api/sf-donor-handoff-tick + government/dialysis w9_3_donor_handoff_log + sf_account_contact_expansion field_source_priority',
   'W9_3_DONOR_HANDOFF', 'off', DATE '2026-08-08', 'Scott Briggs',
   'Fill-blanks only; UNIQUE name match only (ambiguous skipped, never guessed); never overwrites an existing sf_contact_id; never fabricates. GET dry-run + coverage metric; ?score=1 inline sample; POST (flag ON) one bounded batch. Nightly cron 05:30 UTC no-ops while OFF.')
ON CONFLICT (flag) DO UPDATE
  SET purpose = EXCLUDED.purpose, surface = EXCLUDED.surface, env_var = EXCLUDED.env_var,
      notes = EXCLUDED.notes, updated_at = now();

-- ── 2a. Provenance citizenship for the two new domain link writers ───────────
-- splink_v2 = the W9.3 re-score model (owner_sf, conservative name gate). Mirrors
-- splink_v1: priority 50, min_confidence 0.9, record_only. sf_account_contact_expansion
-- = the donor handoff (person-key fill), priority 45 record_only on contacts.sf_contact_id.
INSERT INTO public.field_source_priority (target_table, field_name, source, priority, min_confidence, enforce_mode, notes)
VALUES
  ('gov.true_owners',     'sf_account_id', 'splink_v2', 50, 0.9, 'record_only',
     'W9.3: live re-score SF-link batch (owner_sf, refreshed registry). record_only.'),
  ('gov.recorded_owners', 'sf_account_id', 'splink_v2', 50, 0.9, 'record_only',
     'W9.3: live re-score SF-link batch (owner_sf, refreshed registry). record_only.'),
  ('dia.true_owners',     'sf_company_id', 'splink_v2', 50, 0.9, 'record_only',
     'W9.3: live re-score SF-link batch (owner_sf, refreshed registry). record_only.'),
  ('gov.contacts',        'sf_contact_id', 'sf_account_contact_expansion', 45, 1.0, 'record_only',
     'W9.3 WS3: person-level sf_contact_id filled from the account->contacts bridge (unique name match). record_only.'),
  ('dia.contacts',        'sf_contact_id', 'sf_account_contact_expansion', 45, 1.0, 'record_only',
     'W9.3 WS3: person-level sf_contact_id filled from the account->contacts bridge (unique name match). record_only.')
ON CONFLICT (target_table, field_name, source) DO UPDATE
  SET priority = EXCLUDED.priority, min_confidence = EXCLUDED.min_confidence,
      enforce_mode = EXCLUDED.enforce_mode, notes = EXCLUDED.notes, updated_at = now();

-- ── 2b. Extend lcc_flush_provenance_events' first-class allowlist ─────────────
-- Byte-identical to the W4.4 body except v_first_class gains 'splink_v2' and
-- 'sf_account_contact_expansion' so their provenance_event_log rows are PRESERVED
-- under their own source in field_provenance (else collapsed to domain_trigger) —
-- keeping v_field_provenance_unranked at 0 given the fsp rows registered above.
CREATE OR REPLACE FUNCTION public.lcc_flush_provenance_events(
  p_domain              text,
  p_events              jsonb,
  p_default_confidence  numeric DEFAULT 0.9
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_target_db     text;
  v_e             jsonb;
  v_id            bigint;
  v_raw_table     text;
  v_table         text;
  v_pk            text;
  v_field         text;
  v_newval        jsonb;
  v_src           text;
  v_merge_source  text;
  v_conf          numeric;
  v_kind          text;
  v_runid         text;
  v_decision      text;
  v_is_marker     boolean;
  v_merged        bigint[] := ARRAY[]::bigint[];
  v_skipped       bigint[] := ARRAY[]::bigint[];
  v_errors        jsonb    := '[]'::jsonb;
  v_decisions     jsonb    := '{}'::jsonb;
  v_max_id        bigint   := 0;
  -- W4.4 + W9.3: sources allowed to keep their own identity in the ledger (rest
  -- collapse to domain_trigger). Must ALSO be registered for the (table, field).
  v_first_class   text[] := ARRAY['splink_v1','sf_link_review_human','splink_v2','sf_account_contact_expansion'];
BEGIN
  IF p_domain NOT IN ('dia','gov') THEN
    RAISE EXCEPTION 'p_domain must be dia or gov, got %', p_domain;
  END IF;
  v_target_db := CASE p_domain WHEN 'dia' THEN 'dia_db' ELSE 'gov_db' END;

  FOR v_e IN SELECT * FROM jsonb_array_elements(COALESCE(p_events, '[]'::jsonb))
  LOOP
    v_id        := NULLIF(v_e->>'id','')::bigint;
    IF v_id IS NULL THEN CONTINUE; END IF;
    IF v_id > v_max_id THEN v_max_id := v_id; END IF;

    v_raw_table := v_e->>'target_table';
    v_pk        := v_e->>'record_pk_value';
    v_field     := v_e->>'field_name';
    v_newval    := v_e->'new_value';
    v_src       := COALESCE(v_e->>'source','domain_trigger');
    v_conf      := COALESCE(NULLIF(v_e->>'confidence','')::numeric, p_default_confidence);
    v_kind      := v_e->'metadata'->>'kind';

    v_is_marker := (v_pk IS NULL)
                OR (v_pk LIKE '<%>')
                OR (v_kind = 'historical_bulk_update_marker')
                OR (v_newval IS NULL)
                OR (v_newval = 'null'::jsonb);
    IF v_is_marker THEN
      v_skipped := v_skipped || v_id;
      CONTINUE;
    END IF;

    v_table := CASE WHEN position('.' IN COALESCE(v_raw_table,'')) > 0
                    THEN v_raw_table
                    ELSE p_domain || '.' || v_raw_table END;

    v_merge_source := 'domain_trigger';
    IF v_src <> 'domain_trigger'
       AND v_src = ANY(v_first_class)
       AND EXISTS (
         SELECT 1 FROM public.field_source_priority fsp
          WHERE fsp.target_table = v_table
            AND fsp.field_name = v_field
            AND fsp.source = v_src
       ) THEN
      v_merge_source := v_src;
    END IF;

    v_runid := v_src || ':evt' || v_id;

    BEGIN
      SELECT lmf.decision INTO v_decision
      FROM public.lcc_merge_field(
        NULL, v_target_db, v_table, v_pk, v_field, v_newval,
        v_merge_source, v_runid, v_conf, NULL
      ) lmf;

      v_merged    := v_merged || v_id;
      v_decisions := jsonb_set(
                       v_decisions,
                       ARRAY[COALESCE(v_decision,'unknown')],
                       to_jsonb(COALESCE((v_decisions->>COALESCE(v_decision,'unknown'))::int,0) + 1),
                       true);
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object('id', v_id, 'error', left(SQLERRM, 400));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'merged_ids',   to_jsonb(v_merged),
    'skipped_ids',  to_jsonb(v_skipped),
    'errors',       v_errors,
    'decisions',    v_decisions,
    'max_event_id', v_max_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.lcc_flush_provenance_events(text, jsonb, numeric) FROM public;
GRANT EXECUTE ON FUNCTION public.lcc_flush_provenance_events(text, jsonb, numeric) TO service_role;

-- ── 3. WS1 assist agree/disagree ledger + recorder + U4 accuracy view ────────
-- Append-only measurement written by the sf_link_candidate verdict handler AFTER a
-- human verdict, when a W9.3 assist existed. It measures accuracy; it decides
-- nothing.
CREATE TABLE IF NOT EXISTS public.lcc_w9_3_sf_assist_measure (
  id               bigserial PRIMARY KEY,
  subject_ref      text NOT NULL,
  domain           text,
  assist_verdict   text,
  assist_confidence numeric,
  human_verdict    text,          -- entity_match_labels verdict: same_party | distinct
  agreed           boolean,       -- null when not measurable (uncertain assist)
  decided_by       text,
  decided_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lcc_w9_3_sf_assist_measure_decided
  ON public.lcc_w9_3_sf_assist_measure (decided_at);

-- Metadata-only recorder. Structurally cannot touch a queue row or an SF id — it
-- only appends a measurement.
CREATE OR REPLACE FUNCTION public.lcc_record_sf_assist_agreement(
  p_subject_ref     text,
  p_domain          text,
  p_assist_verdict  text,
  p_assist_conf     numeric,
  p_human_verdict   text,
  p_agreed          boolean,
  p_decided_by      text DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_id bigint;
BEGIN
  INSERT INTO public.lcc_w9_3_sf_assist_measure
    (subject_ref, domain, assist_verdict, assist_confidence, human_verdict, agreed, decided_by)
  VALUES (p_subject_ref, p_domain, p_assist_verdict, p_assist_conf, p_human_verdict, p_agreed, p_decided_by)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.lcc_record_sf_assist_agreement(text,text,text,numeric,text,boolean,text) FROM public;
GRANT EXECUTE ON FUNCTION public.lcc_record_sf_assist_agreement(text,text,text,numeric,text,boolean,text) TO service_role;

CREATE OR REPLACE VIEW public.v_lcc_w9_3_sf_assist_accuracy AS
SELECT to_char(date_trunc('month', decided_at), 'YYYY-MM')      AS period,
       count(*) FILTER (WHERE agreed IS NOT NULL)::int          AS measured,
       count(*) FILTER (WHERE agreed IS TRUE)::int              AS agreed,
       count(*) FILTER (WHERE agreed IS FALSE)::int             AS disagreed,
       count(*) FILTER (WHERE agreed IS NULL)::int              AS not_measured
  FROM public.lcc_w9_3_sf_assist_measure
 GROUP BY 1
 ORDER BY 1 DESC;
GRANT SELECT ON public.v_lcc_w9_3_sf_assist_accuracy TO anon, authenticated, service_role;

-- ── 4. WS3 donor-coverage metric ledger + trend view ─────────────────────────
-- The acceptance metric: # of blank-reachability contacts carrying an SF key, per
-- domain, appended by the donor tick each run (baseline ~15 dia + 5 gov). RISING =
-- W9.2's deterministic donor pool unlocking.
CREATE TABLE IF NOT EXISTS public.lcc_w9_3_donor_coverage_log (
  id                     bigserial PRIMARY KEY,
  domain                 text NOT NULL,
  blank_contacts_total   int,
  blank_with_sf_key      int,     -- blank (no email/phone) contacts carrying sf_contact_id
  stamped_this_run       int,     -- keys newly stamped this run
  batch_tag              text,
  source_run_id          text,
  recorded_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lcc_w9_3_donor_coverage_recorded
  ON public.lcc_w9_3_donor_coverage_log (domain, recorded_at);

CREATE OR REPLACE VIEW public.v_lcc_w9_3_donor_coverage AS
SELECT DISTINCT ON (domain)
       domain, blank_contacts_total, blank_with_sf_key, stamped_this_run,
       batch_tag, recorded_at
  FROM public.lcc_w9_3_donor_coverage_log
 ORDER BY domain, recorded_at DESC;
GRANT SELECT ON public.v_lcc_w9_3_donor_coverage TO anon, authenticated, service_role;

COMMIT;

-- ── 5. Nightly crons (outside the txn — pg_cron schedule changes aren't txnal).
-- Staggered AFTER the W8 chain (04:30) and W9.2 reachability (04:40): assist 04:50,
-- re-score 05:10, donor 05:30. Each no-ops while its flag is OFF.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'lcc_cron_post') THEN
    BEGIN PERFORM cron.unschedule('sf-link-assist-tick'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule('sf-link-assist-tick', '50 4 * * *',
      $cron$SELECT public.lcc_cron_post('/api/sf-link-assist-tick', '{"apply":true}'::jsonb, 'railway');$cron$);

    BEGIN PERFORM cron.unschedule('sf-link-rescore-tick'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule('sf-link-rescore-tick', '10 5 * * *',
      $cron$SELECT public.lcc_cron_post('/api/sf-link-rescore-tick', '{"apply":true}'::jsonb, 'railway');$cron$);

    BEGIN PERFORM cron.unschedule('sf-donor-handoff-tick'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule('sf-donor-handoff-tick', '30 5 * * *',
      $cron$SELECT public.lcc_cron_post('/api/sf-donor-handoff-tick', '{"apply":true}'::jsonb, 'railway');$cron$);
  END IF;
END;
$$;
