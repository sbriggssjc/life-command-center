-- W9.4 (Prompt 94, 2026-08-12): Comms-harvest arm — the THIRD arm of the W9.2
-- reachability-harvest tick. It does NOT fork a new unit: it extends the existing
-- reachability_harvest_review lane + writer + cron + flag (W9_2_REACHABILITY_HARVEST)
-- with correspondence (activity_events) as a new input source. Additive + idempotent
-- on LCC Opps (xengecqvemvfknjvbvrq).
--
-- WHY comms is yield-rich: correspondence LCC already ingests carries (a) header
-- from/to/cc pairs — display name + email (deterministic when a display name is
-- present); (b) signature-block phones — the best PHONE source in the system;
-- (c) thread participants attributable to an owner who has NO contact row yet.
--
-- THREE arms under ONE flag (the W9.2 machinery already runs deterministic + llm):
--   * comms header pair  → routed through the DETERMINISTIC arm (arithmetic name+
--     value bind, confidence 1.0) but provenance comms_observed (OBSERVED in mail).
--   * comms signature    → routed through the LLM arm with the SAME verbatim-quote
--     validator (the quote must contain the phone/email AND the name).
--   * create-contact      → target_kind='owner' proposal (a NEW contact for an owner
--     with none on file) — minted ONLY via a human verdict, NEVER auto.
--
-- The reachability_harvest_review table already CHECK-allows arm IN
-- ('deterministic','llm'), target_kind IN ('contact','owner'), and provenance_source
-- IN ('w9_2_internal_harvest','comms_observed'), so the comms arm needs NO schema
-- change. The email/phone comms_observed field_source_priority rows are already
-- registered (W9.2 migration 20260826120000). This migration adds ONLY the missing
-- NAME-field comms_observed rows (the create-contact writer stamps provenance on the
-- new contact's name too) so v_field_provenance_unranked stays 0, and refreshes the
-- flag notes to describe all three arms.
--
-- DISCIPLINE (inherited, non-negotiable): fill-blanks / create-only-via-verdict;
-- conservative — a create-contact needs a NAME + a real external email; privacy-
-- scoped — harvest ONLY from business-attributed, visibility<>'private' threads;
-- provenance-tagged (comms_observed@40); reversible (reachability_harvest_apply_log —
-- a created contact's ledger row carries reversal.record_id = the new contact_id);
-- idempotent; NEVER fabricated.
--
-- REVERSAL RUNBOOK
--   -- No canonical data is written until a HUMAN accepts a proposal.
--   -- A create-contact accept INSERTs a domain contact + stamps provenance; the
--   --   apply-log row carries reversal={target_database, target_table:'contacts',
--   --   record_id:<new contact_id>, field:'__create__', provenance_ids[]}.
--   -- To reverse a created contact:
--   SELECT * FROM public.reachability_harvest_apply_log
--     WHERE status='applied' AND details->>'create_contact'='true' ORDER BY created_at DESC;
--   --   DELETE the domain contact by reversal.record_id via /api/apply-change
--   --   (or domainQuery), then flip the log row status='reversed'.
--   -- To retire the arm: flip W9_2_REACHABILITY_HARVEST off (default) — the whole
--   --   tick (all three arms) no-ops.

BEGIN;

-- field_source_priority: register comms_observed on the domain contact NAME columns
-- (the create-contact writer stamps name provenance alongside email/phone). The
-- email/phone comms_observed rows already exist (W9.2). comms_observed sits BELOW
-- manual(1)/recorded(3)/county(5)/salesforce(20)/om_extraction(35-45) — an observed
-- value never outranks a curated or signed source.
INSERT INTO public.field_source_priority (target_table, field_name, source, priority, min_confidence, enforce_mode, notes)
SELECT v.target_table, v.field_name, v.source, v.priority, v.min_confidence, 'record_only', v.notes
FROM (VALUES
  ('dia.contacts', 'contact_name', 'comms_observed', 40, 0.60, 'W9.4: contact NAME minted from a correspondence thread participant attributable to an owner (create-contact).'),
  ('gov.contacts', 'name',         'comms_observed', 40, 0.60, 'W9.4: contact NAME minted from a correspondence thread participant attributable to an owner (create-contact).')
) AS v(target_table, field_name, source, priority, min_confidence, notes)
WHERE NOT EXISTS (
  SELECT 1 FROM public.field_source_priority f
  WHERE f.target_table = v.target_table AND f.field_name = v.field_name AND f.source = v.source
);

-- Refresh the flag notes/purpose to describe all three arms (state UNCHANGED — the
-- flag stays whatever it is; W9.4 does not flip it — that is the operator gate).
UPDATE public.feature_flags_registry
SET purpose = 'W9.2/W9.4 data-connectedness: contact-reachability harvest from sources LCC ALREADY HOLDS. THREE arms under this ONE flag: (1) DETERMINISTIC exact-identity fills (a synced SF/sidebar record of the SAME person, confidence 1.0, NO LLM) + comms HEADER name+value binds (provenance comms_observed); (2) LLM-attributed fills from intake snapshots + comms SIGNATURE blocks, quoted VERBATIM (validator drops a value not in the quote → reachability_harvest_dropped_log); (3) CREATE-CONTACT (target_kind=owner) — a NEW contact for an owner with none on file, from a business-attributed, non-private correspondence thread participant, minted ONLY via a human verdict. Human confirm lane (Decision Center reachability_harvest_review) → deterministic fill-blanks / create-contact writer (domain contacts + provenance comms_observed@40 / w9_2_internal_harvest@60, reversible). NEVER auto-writes, never fabricates. Harvests ONLY business-attributed, visibility<>private threads (correspondence-privacy). External acquisition (SOS/deed) is W9.1; web-search proxy stays PAUSED.',
    notes = 'W9.2 built the tick + lane + fill-blanks writer; W9.4 (Prompt 94) added the comms arm (header pairs → deterministic, signature phones → llm verbatim, create-contact → target_kind=owner, never auto). One flag, three arms, 04:40 UTC cron. Proposal-only — ZERO auto-writes. Flip on after the ?score=1 dry-run sample (per-source header/signature/create-contact counts + verbatim quotes) is reviewed. LLM arm uses OLLAMA_URL/OLLAMA_MODEL via invokeExtractionAI (surface clean_assist).',
    updated_at = now()
WHERE flag = 'W9_2_REACHABILITY_HARVEST';

COMMIT;
