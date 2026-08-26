-- ============================================================================
-- P131 — ownership-history chain DRAFTER: store + flag registration.
--
-- Additive and reversible. Two changes:
--   1. Widen the lcc_clean_assist_proposals `source` CHECK to admit the new
--      annotation stream 'ownership_chain_draft'. The store's UNIQUE
--      (decision_type, subject_ref, proposal_kind, source) keeps this stream
--      from colliding with ollama_clean_assist / w9_3_sf_assist /
--      property_twin_assist.
--   2. Register the two feature flags in feature_flags_registry, BOTH OFF, so
--      the capability is visible while inert (audit §4.4.3: a flag-gated no-op
--      must not look like a healthy quiet pipeline).
--
-- Why this stream is deterministic rather than model-generated is documented at
-- length in api/_shared/ownership-chain-draft-planner.js. Short version, measured
-- live 2026-08-26: 453 of the 545 open `establish_ownership_history` rows already
-- have a clean, dated, guard-passing chain in gov.ownership_history (707 links)
-- that LCC never read; gov.deed_records carries ZERO legal_description text so the
-- "verbatim deed quote" the lane was imagined around does not exist; and the LLM
-- proposer for this same gap (W8 U3) is already ON and dropped 35 proposals
-- `quote_not_verbatim` against 32 shipped.
--
-- DEPLOY ORDER: this migration is ADDITIVE (a widened CHECK admits strictly more
-- values) so it is safe to apply BEFORE the JS ships — the constraint-after-writer
-- rule applies only to constraints that TIGHTEN what a writer may emit.
--
-- REVERSAL RUNBOOK
--   delete from lcc_clean_assist_proposals where source = 'ownership_chain_draft';
--   alter table lcc_clean_assist_proposals drop constraint lcc_clean_assist_proposals_source_check;
--   alter table lcc_clean_assist_proposals add constraint lcc_clean_assist_proposals_source_check
--     check (source = any (array['ollama_clean_assist','w9_3_sf_assist','property_twin_assist']));
--   delete from feature_flags_registry where flag in ('OWNERSHIP_CHAIN_DRAFT','OWNERSHIP_CHAIN_ROLE_LABELS');
-- ============================================================================

alter table public.lcc_clean_assist_proposals
  drop constraint if exists lcc_clean_assist_proposals_source_check;

alter table public.lcc_clean_assist_proposals
  add constraint lcc_clean_assist_proposals_source_check
  check (source = any (array[
    'ollama_clean_assist',
    'w9_3_sf_assist',
    'property_twin_assist',
    'ownership_chain_draft'
  ]));

insert into public.feature_flags_registry (flag, purpose, surface, env_var, state, off_since, owner, notes)
values
  ('OWNERSHIP_CHAIN_DRAFT',
   'Draft the ownership chain of title for the never-consumed establish_ownership_history research lane (545 open / 0 lifetime completions), so the operator confirms a draft instead of researching from scratch.',
   'GET/POST /api/ownership-chain-draft-tick',
   'OWNERSHIP_CHAIN_DRAFT',
   'off', current_date, 'scott',
   'Annotation-only — writes ONLY lcc_clean_assist_proposals (source ownership_chain_draft). NEVER writes a portfolio fact, NEVER merges, NEVER closes a research task; a human confirms on the P179 capture path. The chain is assembled DETERMINISTICALLY from gov.ownership_history via v_ownership_transitions_portfolio with the P138 guards re-applied (self-transition / oscillating-pair / name-variant / unclean-party / undated), so its citation is a RECORD REFERENCE and cannot be hallucinated. A gap in the chain is reported "Not on file", never bridged. GET is a dry run with honest per-reason counts (?sample=N renders real drafts for grading). Flip on after the dry-run sample is human-graded.'),
  ('OWNERSHIP_CHAIN_ROLE_LABELS',
   'Optional local-model Layer 2 for the chain drafter: label each ALREADY-DRAFTED transfer with a transfer TYPE (developer_sale / sponsor_internal_transfer / reit_acquisition / portfolio_trade / arms_length_sale / foreclosure_or_distress).',
   'GET/POST /api/ownership-chain-draft-tick (Layer 2)',
   'OWNERSHIP_CHAIN_ROLE_LABELS',
   'off', current_date, 'scott',
   'Strictly additive annotation. The model may NOT add, remove, reorder, re-date or re-name a link — Layer 1 owns the chain. Closed label vocabulary, one label per existing link index, and a validator drops any label whose rationale names a party not already in that link. "unknown" is dropped rather than stored. Requires OWNERSHIP_CHAIN_DRAFT to also be on; the drafter is fully useful with this OFF. Kept off by default because the sibling LLM surface on this same gap (W8 U3) measured ~52% hallucinated citations.')
on conflict (flag) do update
  set purpose = excluded.purpose,
      surface = excluded.surface,
      env_var = excluded.env_var,
      notes   = excluded.notes;
