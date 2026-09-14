-- ============================================================================
-- PR5c — why 33 ladder rungs on six LCC-internal tables have never produced a
--        field_provenance row.  2026-09-02 · LCC Opps xengecqvemvfknjvbvrq
--
-- PR5 §1a recorded the zero. PR12 §4 sized the quote-loss mechanism against the
-- STORED CURATED VALUES on those columns (break-class ~0.03%) and concluded it
-- did not explain the zero. Both facts are right; the conclusion was reached on
-- the wrong population, and the real cause is one line above the hash:
--
--     field_provenance_target_database_check
--       CHECK (target_database = ANY (ARRAY['lcc_opps','dia_db','gov_db']))
--
-- lcc_merge_field() ALWAYS inserts a field_provenance row -- write, skip and
-- conflict all land, there is no early return -- so zero rows means the RPC
-- never COMPLETED, not that it decided against writing. Five call sites passed
-- a value outside that vocabulary and therefore raised 23514 on 100% of calls,
-- into a bare `catch (_e) { /* best-effort */ }`:
--
--   api/admin.js       reachability harvest (x2)   'dia' / 'gov'
--   api/admin.js       w8_u3 link propagation      'lcc'
--   api/_shared/cre-registry.js  folder-feed CRE   'lcc_db'
--   supabase/functions/availability-checker        'dia' / 'gov'
--
-- Measured by replaying each site's exact payload in a rolled-back transaction
-- on 2026-09-02: 6 of the 6 PR5 §2 `writer_live_zero_rows` sources fail, 5 with
-- 23514; the 6th (lcc_generated) SUCCEEDS -- its lane simply has not run.
--
-- ⚠️ The rung lookup keys on (target_table, field_name, source) ONLY. target_
--    database is not part of it. So a wrong value here is invisible to every
--    detector that reasons about ladders; it fails at the INSERT.
--
-- ⚠️ PR5 §1a's headline "field_provenance has never run on any LCC-internal
--    table" is CORRECTED here: it has -- public.activity_events carries 22 rows
--    from comms_owner_bridge (2026-08-14) plus one audit smoke row. That lane is
--    the ONE that passes 'lcc_opps' and does not JSON.stringify its value, and
--    the code comment beside it says so. The lesson was written down once, next
--    to one call site, and the class was never swept.
--
-- THIS MIGRATION WRITES NOTHING BUT `notes` AND ONE APPENDED VIEW COLUMN.
-- Predicted merge-outcome delta: ZERO, and it is structural rather than
-- measured-and-hoped -- lcc_merge_field reads priority, min_confidence and
-- enforce_mode from field_source_priority and never reads notes. No rung is
-- deleted, retired, re-prioritised or re-registered (PR5: "unregistered" is a
-- different BRANCH of lcc_merge_field, not a lower rung, so a registry edit
-- moves merge outcomes in both directions).
--
-- REVERSAL
--   update public.field_source_priority
--      set notes = regexp_replace(notes, E'\\n?PR5c:[^\\n]*', '', 'g')
--    where notes like '%PR5c:%';
--   -- then re-create v_field_source_priority_triage from 20261009120000.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. reached_and_broken — the lane RUNS and every stamp 23514s.
--    folder_feed_cre: lcc_cre_properties 311 rows (3 touched in 30d),
--    lcc_cre_property_documents 1,066 rows (13 in 30d, newest 2026-08-27).
--    performCreRegister() calls recordProvenance() on every registration.
--    This is a real, recoverable loss: 10 rungs.
-- ---------------------------------------------------------------------------
update public.field_source_priority
   set notes = coalesce(notes || E'\n', '') ||
       'PR5c:reached_and_broken (2026-09-02) - api/_shared/cre-registry.js passed '
       || 'p_target_database=''lcc_db'', outside the field_provenance CHECK '
       || '(lcc_opps/dia_db/gov_db), so every stamp raised 23514 into a best-effort '
       || 'catch. The lane is live (311 CRE properties / 1,066 documents; 13 docs in '
       || 'the last 30 days). Caller fixed to provenanceTargetDatabase(''lcc_opps''); '
       || 'rows land from the next Railway deploy onward. Rung unchanged.',
       updated_at = now()
 where source = 'folder_feed_cre'
   and target_table in ('public.lcc_cre_properties', 'public.lcc_cre_property_documents');

-- ---------------------------------------------------------------------------
-- 2. unreached_and_broken — TWO independent facts, and both matter.
--    (a) the branch has never completed: w8_u3_link_apply_log holds ONE row,
--        status='conflict' (ambiguous_entity_match, 2026-08-07), which returns
--        before the edge insert and therefore before the stamp. The 26 reviews
--        reading 'applied' are all proposal_type='person_email_merge', a
--        different sub-lane that creates no edge (applied_log_id null on all 26).
--        prior_owner_link -- the sub-lane that reaches the stamp -- has 2 rows
--        ever, both terminal non-applies.
--    (b) and the string is invalid anyway, so the first successful apply would
--        have lost its provenance silently. Fixing the caller now is what stops
--        that trap firing on the day the lane finally works.
--    ⚠️ NOT a PR7 orphan column: `developed`/`owns` are relationship TYPES, and
--       the caller passes relType as p_field_name deliberately. The rungs were
--       registered to that convention and are correct. Do not retire them.
-- ---------------------------------------------------------------------------
update public.field_source_priority
   set notes = coalesce(notes || E'\n', '') ||
       'PR5c:unreached_and_broken (2026-09-02) - api/admin.js passed '
       || 'p_target_database=''lcc'' (23514 on every call), AND the apply branch has '
       || 'never completed: prior_owner_link holds 2 rows ever (1 conflict, 1 '
       || 'rejected, newest 2026-08-07); the 26 ''applied'' reviews are '
       || 'person_email_merge, a sub-lane that creates no edge. field_name is the '
       || 'relationship TYPE by design, not a column - NOT a PR7 orphan. Caller '
       || 'fixed; rung unchanged.',
       updated_at = now()
 where source = 'w8_u3_link_propagation'
   and target_table = 'entity_relationships';

-- ---------------------------------------------------------------------------
-- 3. no_merge_path_caller — the ladder exists, real writers exist, and NOT ONE
--    of them routes through lcc_merge_field. Repo-wide: no call site anywhere
--    passes p_target_table='entities' (every dynamic targetTable resolves to a
--    domain-schema table). Meanwhile `entities` is PATCHed from a dozen places
--    (admin.js, contact-writeback, owner-contact-propagate, lease-extractor,
--    operations.js, sync.js...). This is a BUILD gap, not a broken string and
--    not an unreachable lane -- see backlog PR5c-entities.
-- ---------------------------------------------------------------------------
update public.field_source_priority
   set notes = coalesce(notes || E'\n', '') ||
       'PR5c:no_merge_path_caller (2026-09-02) - no lcc_merge_field call site '
       || 'anywhere passes p_target_table=''entities''; the column has many direct '
       || 'PATCH writers and none stamps provenance. Ladder registered '
       || 'aspirationally. Nothing fixed here - backlog PR5c-entities.',
       updated_at = now()
 where target_table = 'entities';

-- ---------------------------------------------------------------------------
-- 4. ledger_is_elsewhere — a DESIGN answer, not a defect. These six are the
--    property-owner authority ladder scored by lcc_reconcile_property_owner
--    over lcc_property_owner_evidence (15,052 rows; domain_true_owner wrote
--    2026-09-02). That resolver emits no field_provenance and is not being
--    wired to (PR10: "one source, two ladders" is a decision, not plumbing).
--    Soft-recorded, NOT retired: a rung deletion changes merge outcomes.
-- ---------------------------------------------------------------------------
update public.field_source_priority
   set notes = coalesce(notes || E'\n', '') ||
       'PR5c:ledger_is_elsewhere (2026-09-02) - scored by '
       || 'lcc_reconcile_property_owner over lcc_property_owner_evidence, which '
       || 'emits no field_provenance. Correct as designed; the zero here is a '
       || 'second-ledger artifact (PR10), not a broken writer. Left registered on '
       || 'purpose - deleting a rung changes lcc_merge_field''s branch.',
       updated_at = now()
 where target_table = 'lcc.lcc_property_owner';

-- ---------------------------------------------------------------------------
-- 5. producer_never_wired — A2 wrote 304 portfolio facts with no stamp;
--    ownership-chain-apply.js exports A2_PROVENANCE_SOURCE and nothing imports
--    it (PR5e owns the wire-or-retire call).
-- ---------------------------------------------------------------------------
update public.field_source_priority
   set notes = coalesce(notes || E'\n', '') ||
       'PR5c:producer_never_wired (2026-09-02) - A2_PROVENANCE_SOURCE '
       || '(api/_shared/ownership-chain-apply.js) is a dead constant with no '
       || 'importer; A2 wrote 304 facts unstamped. Decision belongs to PR5e.',
       updated_at = now()
 where target_table = 'lcc.lcc_entity_portfolio_facts';

-- ---------------------------------------------------------------------------
-- 6. Surface it. CREATE OR REPLACE VIEW is append-only for columns, so
--    pr5c_verdict goes at the END. The extractor is a TOKEN regex, never an
--    offset (PR5 §"anchor a parse on a token"): note that 'PR5:([a-z_]+)'
--    cannot match inside 'PR5c:' -- the character after PR5 is 'c', not ':' --
--    so the two markers coexist on one notes string without interfering.
-- ---------------------------------------------------------------------------
create or replace view public.v_field_source_priority_triage as
 SELECT id,
    target_table,
    field_name,
    source,
    priority,
    enforce_mode,
    "substring"(notes, 'PR5:([a-z_]+)'::text) AS pr5_verdict,
    notes ~~ '%PR7:orphan_column%'::text AS is_orphan_column,
    COALESCE("substring"(notes, 'PR5:([a-z_]+)'::text) = ANY (ARRAY['retire'::text, 'retired_by_decision'::text]), false) AS is_retired,
    notes,
    updated_at,
    "substring"(notes, 'PR5c:([a-z_]+)'::text) AS pr5c_verdict
   FROM field_source_priority f;

comment on view public.v_field_source_priority_triage is
  'PR5/PR7/PR5c triage of the ladder. pr5c_verdict explains why a rung on an '
  'LCC-internal table has no field_provenance row: reached_and_broken (the lane '
  'runs and the stamp 23514s on an out-of-vocabulary target_database), '
  'unreached_and_broken (both), no_merge_path_caller (writers exist, none stamps), '
  'ledger_is_elsewhere (scored on a second ledger by design), producer_never_wired.';

commit;
