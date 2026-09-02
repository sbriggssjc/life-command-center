-- ============================================================================
-- PR5 — triage the registered ladder sources that have never written a field.
--
-- Measured live on xengecqvemvfknjvbvrq, 2026-09-02, keyed on
-- v_field_provenance_effective_source (i.e. AFTER PR8 recovered relabelled
-- names):  68 registered sources · 39 never written · 21 write-but-unregistered.
--
-- ⚠️ THE HEADLINE NUMBER IS NOT A DEFECT COUNT. Of the 39, only 14 are rungs
-- nothing will ever exercise. The other 25 split into five causes that read
-- IDENTICALLY as a zero and need opposite handling:
--
--   exercised_elsewhere        7  the source IS live — on a SECOND ladder that
--                                 does not write field_provenance at all.
--   writer_live_zero_rows      6  a correct lcc_merge_field call site exists and
--                                 its lane has produced nothing (or its stamp
--                                 was swallowed — every one is wrapped in a
--                                 best-effort catch; see PR12).
--   build_pending              9  a producer is planned/gated/unbuilt.
--   refused_by_decision        1  county_records (PR1/PR8 — must NOT be armed).
--   retired_by_decision        1  gliner_extract — DEMOTED on measurement, rung
--                                 deliberately kept.
--   keep_structural            1  domain_trigger — by design never the effective
--                                 source; it is the honest fallback name.
--   retire                    14  no writer anywhere, or the string is a
--                                 different vocabulary entirely.
--
-- 🚨 THE BIGGEST SINGLE FINDING IS `exercised_elsewhere`, AND IT INVERTS THE
-- BRIEF'S FRAME. Six of the 39 — manual, rel_purchase, rel_owns, sf_seller,
-- domain_true_owner, gov_ownership_transition — are the property-owner
-- authority ladder on lcc.lcc_property_owner. They carry 15,052 rows in
-- lcc_property_owner_evidence, and domain_true_owner wrote TODAY. They are not
-- unexercised; they are scored by lcc_reconcile_property_owner, which has never
-- emitted a field_provenance row. A "never written" detector keyed on ONE
-- ledger reports a second ledger's whole population as absent. Same class as
-- PR10 (one source, two ladders) but seven times larger, and the same shape as
-- P197: before recording that something has no writes, enumerate the ledgers.
--
-- 🚨 SECOND FINDING: field_provenance holds ZERO rows for EVERY LCC-internal
-- target_table that carries rungs — entities (13 rungs), entity_relationships
-- (2), lcc.lcc_property_owner (6), lcc.lcc_entity_portfolio_facts (2),
-- public.lcc_cre_properties (7), public.lcc_cre_property_documents (3).
-- 33 rungs govern a merge path that has never run on those tables.
--
-- ⚠️ AND THE BRIEF'S PREDICTED reverse-arm DELTA IS WRONG: the 21
-- write-but-unregistered sources stay 21. costar_sidebar is a REGISTERED source
-- (73 rungs), so it never appeared in that arm — the gov.properties
-- .government_type gap is invisible at SOURCE grain and only exists at
-- (table, field, source) grain, which is what v_field_provenance_unranked keys
-- on. A detector's GRAIN decides what it can see; the two arms answer different
-- questions and must not be quoted as one number.
--
-- ============================================================================
-- WHAT THIS MIGRATION DOES
--
--   1. Registers costar_sidebar -> gov.properties.government_type at 95 — the
--      one real member of the write-but-unregistered set at field grain.
--   2. Stamps a machine-readable PR5 verdict into field_source_priority.notes
--      for all 39 sources. NOTHING IS DELETED (see below).
--   3. Marks the 49 rungs that sit on a column the target table does not have
--      (PR7, re-measured: 19 (table, column) pairs, not 1).
--   4. Adds v_field_source_priority_triage — the standing surface.
--
-- ⚠️ WHY SOFT-RETIRE AND NEVER DELETE — PROVEN, NOT ASSERTED. "Unregistered" is
-- not a rung, it is a DIFFERENT ALGORITHM inside lcc_merge_field: an
-- unregistered source may fill a blank, may never override a value, and is
-- itself overridable by anyone (`replacing_unregistered_source`). So deleting a
-- rung does not demote a source — it moves it onto a different branch and can
-- change outcomes in BOTH directions. A 72-combination self-rolling-back replay
-- (below) measured exactly that.
--
-- ============================================================================
-- THE ONE OUTCOME-CHANGING WRITE: costar_sidebar @ gov.properties.government_type
--
-- Measured before choosing the rung. On that field, all-time:
--   agency_classifier   6,564 rows, 6,564 writes, ALL `no_prior_provenance`
--   costar_sidebar         54 rows,    16 writes, 38 skips — every skip
--                          `unregistered_source_with_existing_value`
--   om_extraction           1 row,      1 write
-- Current value is held by agency_classifier on 6,564 records, costar_sidebar on
-- 16, om_extraction on 1. No source has ever superseded another there.
--
-- So the vendor capture loses to the domain's own deterministic classifier on
-- every contested record TODAY, and the rung is chosen to keep it that way: 95,
-- BELOW agency_classifier@90. Note this is deliberately below costar_sidebar's
-- own gov.properties family (45-70) — a per-field call, because on
-- government_type the in-DB classifier over curated lookups is authoritative and
-- a CoStar label is not. ⚠️ If PR10 re-ranks agency_classifier, THIS RUNG MOVES
-- WITH IT; they are a pair.
--
-- PREDICTED vs ACTUAL merge-outcome delta (72-combo replay, 3 sources x 3
-- sources x {same,diff} x {seeded value, seeded null}, run twice in one
-- transaction that was rolled back). Four decision classes change:
--
--   A  cur=agency_classifier(value NULL), new=costar_sidebar
--        write `unregistered_source_filling_blank` -> skip `lower-priority`
--        ⚠️ A REAL LOSS OF COVERAGE, and the branch order is why: once both
--        priorities are known lcc_merge_field never consults the null again.
--        EXPOSURE ON THIS POPULATION: 0 records (no agency_classifier row on
--        this field holds a null value). Hypothetical today, real in principle.
--   B  cur=costar_sidebar, new=costar_sidebar, different value
--        skip -> write `same_source_refresh_newest_wins`  (16 records; a fix —
--        a source could not previously refresh its own capture)
--   C  cur=costar_sidebar, new=costar_sidebar, same value
--        skip -> write `same_priority_same_value_refresh` (cosmetic)
--   D  cur=om_extraction, new=costar_sidebar
--        skip -> write `replacing_unregistered_source`   (1 record)
--
--   UNCHANGED, and this is the point: the 38 costar_sidebar skips against an
--   agency_classifier value stay skips. Only their stated REASON improves, from
--   `unregistered_source_with_existing_value` to `lower-priority source
--   costar_sidebar (95) cannot override agency_classifier (90)`.
--
-- Total exposure of the changed classes on the live population: 17 records.
-- om_extraction remains unregistered on this field (1 row, 2026-08-20) — named,
-- not fixed; registering it is a separate evidenced call.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The one registration.
-- ---------------------------------------------------------------------------
INSERT INTO public.field_source_priority
  (target_table, field_name, source, priority, min_confidence, enforce_mode, notes)
VALUES
  ('gov.properties', 'government_type', 'costar_sidebar', 95, NULL, 'record_only',
   'PR5:registered (2026-09-02). CoStar page label for a gov property''s government_type. '
   'Ranked BELOW agency_classifier@90 deliberately — measured, the classifier holds the value on '
   '6,564 of 6,581 records and the sidebar has never once overridden it (38 of 38 attempts skipped). '
   'This rung makes that outcome explicit instead of an accident of being unregistered. '
   'Deliberately below costar_sidebar''s own gov.properties family (45-70): a per-field call. '
   'PAIRED WITH agency_classifier — if PR10 re-ranks that source, re-rank this one in the same change.')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. PR5 verdicts. Append-only to `notes`; no rung is deleted, re-ranked or
--    re-pointed. The prefix `PR5:<verdict>` is what v_field_source_priority_triage
--    reads, so the vocabulary is closed and greppable.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS _pr5_verdict;
CREATE TEMP TABLE _pr5_verdict(source text PRIMARY KEY, verdict text, evidence text);

INSERT INTO _pr5_verdict(source, verdict, evidence) VALUES
-- exercised_elsewhere ---------------------------------------------------------
 ('manual','exercised_elsewhere','lcc_property_owner_evidence: 8 rows. Scored by lcc_reconcile_property_owner, which emits no field_provenance.'),
 ('rel_purchase','exercised_elsewhere','lcc_property_owner_evidence: 5,667 rows (newest 2026-08-17).'),
 ('rel_owns','exercised_elsewhere','lcc_property_owner_evidence: 2,459 rows (newest 2026-07-31).'),
 ('sf_seller','exercised_elsewhere','lcc_property_owner_evidence: 32 rows (newest 2026-07-31).'),
 ('domain_true_owner','exercised_elsewhere','lcc_property_owner_evidence: 5,402 rows, newest 2026-09-02 — wrote TODAY.'),
 ('gov_ownership_transition','exercised_elsewhere','lcc_property_owner_evidence: 1,484 rows (newest 2026-08-19).'),
 ('property_sale_events','exercised_elsewhere','gov trg_gov_pse_propagate_to_sale (B6c-dup) records into gov''s own field_value_provenance ladder, not LCC''s.'),
-- refused_by_decision ---------------------------------------------------------
 ('county_records','refused_by_decision','PR1: the producer has no county fetch (gpt-4o recall). PR8 v_never_first_class denies it explicitly. Retire ONLY with PR1d (REGRID_API_KEY), never as plumbing.'),
-- retired_by_decision ---------------------------------------------------------
 ('gliner_extract','retired_by_decision','W5.1b measured the A-only lane ~80% entity-WRONG and demoted it to log-only. api/_handlers/party-extract.js:27 states the rung is kept on purpose. The reason lived only in a code comment; it lives here now.'),
-- keep_structural -------------------------------------------------------------
 ('domain_trigger','keep_structural','The honest fallback name lcc_flush_provenance_events assigns to an UNREGISTERED event (PR8). All 17,371 raw rows carry a :evt run id, so v_field_provenance_effective_source recovers the real writer and domain_trigger is by design never the effective source. Do not retire — the rung is what keeps v_field_provenance_unranked meaningful.'),
-- writer_live_zero_rows -------------------------------------------------------
 ('comms_observed','writer_live_zero_rows','api/admin.js:9727 p_source. Reachability-harvest verdict path; reachability_harvest_apply_log has 2 rows. Stamp is best-effort inside catch(_e) — see PR12.'),
 ('w9_2_internal_harvest','writer_live_zero_rows','api/admin.js:9798 p_source. Same lane, same best-effort catch.'),
 ('w8_u3_link_propagation','writer_live_zero_rows','api/admin.js:10609 p_source, target entity_relationships (115,790 rows, 0 provenance). Best-effort catch.'),
 ('folder_feed_cre','writer_live_zero_rows','api/_shared/cre-registry.js:398 p_source. lcc_cre_properties holds 311 rows and lcc_cre_property_documents 1,066, with 0 provenance on either.'),
 ('lcc_generated','writer_live_zero_rows','api/_handlers/property-doc-writeback.js — the authoritative-document channel, priority 1.'),
 ('availability_scraper','writer_live_zero_rows','supabase/functions/availability-checker/index.ts:490 p_source, a real lcc_merge_field POST.'),
-- build_pending ---------------------------------------------------------------
 ('costar_cmbs_loan','build_pending','Writer IS live (sidebar-pipeline.js:8966 pushProvenance ... ''costar_cmbs_loan''), but the CMBS-loan capture arm has never produced a row: loans.data_source holds no costar_cmbs_loan on EITHER domain (dia 358/215/86/1, gov 1393/124/39/3). 121 rungs for an arm that has never fired.'),
 ('folder_feed_bov','build_pending','Only a table DEFAULT (stageB unit0 valuation_advisory). No writer emits provenance under it.'),
 ('folder_feed_master','build_pending','Same as folder_feed_bov.'),
 ('lease_document','build_pending','intake-promoter.js:91 says it "would be used by a future signed-lease ingester". 25 rungs at 10-25 — high authority, unused.'),
 ('opencorporates','build_pending','api/_shared/llc-research.js is a complete adapter, gated on OPENCORPORATES_API_KEY. Reaches the network but records no provenance.'),
 ('sos_registry','build_pending','contact-acquisition-planner.js:302. Flag W9_1_SOS_DIRECT is OFF and the adapters are bot-walled (gov CLAUDE.md 25).'),
 ('domain_owner_contact','build_pending','Referenced only in a comment (owner-contact-propagate.js:37). Target table `entities` has 0 provenance rows.'),
 ('gov_ownership_chain','build_pending','api/_shared/ownership-chain-apply.js:44 exports A2_PROVENANCE_SOURCE and NOTHING IMPORTS IT — a dead constant. A2 wrote 304 portfolio facts with no stamp.'),
 ('gsa_lessor','build_pending','No JS writer. Both rungs are on gov.properties.recorded_owner_{name,id}; the _name one is an orphan column (see PR7 below), so half of this source is unexercisable by construction.'),
-- retire ----------------------------------------------------------------------
 ('mi_lara','retire','No adapter anywhere in any repo — the only hits are its own registration migration and a comment. The live spelling for a state registry is sos_registry (itself unbuilt).'),
 ('excel_master','retire','Vocabulary collision: government-lease/src/ingest_excel_master.py writes "excel_master" as a data_source COLUMN VALUE on gov rows, never as a provenance source.'),
 ('loopnet','retire','api/sync.js uses it as a lead-ingest channel label. No provenance writer.'),
 ('cms_chain_org','retire','Registration only (20260425210000). No writer in any repo.'),
 ('sales_transactions','retire','Vocabulary collision: entities-handler.js:3255 uses it as an entity `source` label. A table name is not a provenance source.'),
 ('sidebar_capture','retire','Vocabulary collision / rename: entities-handler.js validMethods — an entity capture_method enum. The provenance spelling for the same concept is costar_sidebar (registered, live).'),
 ('sidebar_inline_match','retire','Registration only. The live spellings for dia auto-linking are auto_link_exact_singleton / auto_link_high_confidence / auto_link_orphan_property, all of which DO write these two fields.'),
 ('auto_relink_misrouted_lease','retire','One-shot Dialysis migration 20260429260000; it writes source_name into its own log table, never field_provenance.'),
 ('derived_from_rent','retire','Registration only (20260425210000); referenced in one intake-promoter comment.'),
 ('lcc_entity_canonical_key_trigger','retire','N15c made a BEFORE trigger the single writer of entities.canonical_name. A trigger writes the column directly and never calls lcc_merge_field, so this rung can never be exercised.'),
 ('projected_from_om','retire','Registration only (20260425210000).'),
 ('qa24_canonicalize_agency','retire','One-shot gov migration 20260518220000. Its provenance_event_log events are gov-side and never reached LCC: 0 rows in field_provenance under the raw source AND 0 under any :evt run id.'),
 ('qa30_canonicalize_agency','retire','Same as qa24 (gov migration 20260518240000, 4 rows).'),
 ('shell_chain_research','retire','Registration only (20260425210000) — "manual chain-of-title research", never wired.');

UPDATE public.field_source_priority f
   SET notes = 'PR5:' || v.verdict || ' (2026-09-02) — ' || v.evidence
               || CASE WHEN f.notes IS NULL OR btrim(f.notes) = '' THEN '' ELSE ' || prior note: ' || f.notes END,
       updated_at = now()
  FROM _pr5_verdict v
 WHERE f.source = v.source
   AND COALESCE(f.notes, '') NOT LIKE 'PR5:%';

-- ---------------------------------------------------------------------------
-- 3. PR7 — rungs on a column the target table does not have.
--
-- Re-measured 2026-09-02 against each domain's information_schema: 19 (table,
-- column) pairs carrying 49 rungs, NOT the single pair PR7 was filed for.
-- Split by whether anything is still writing them:
--
--   LIVE   gov.properties.recorded_owner_name — 448 rows, 28 in the last 30
--          days, newest 2026-08-25. gov.properties has recorded_owner_id ONLY.
--          This is the one that is still happening.
--   STOPPED gov.sales_transactions.{buyer_name 7,916 / seller_name 6,039 /
--          procuring_broker 33} — all stop dead at 2026-07-14..29, i.e. the gov
--          branch of the sidebar was fixed to write buyer/seller and nobody
--          cleaned the rungs. gov.properties.{tenant 16, parcel_number 9} stop
--          2026-04-28. Historical residue, not live drift — which is a
--          materially calmer reading than the row counts alone suggest, and it
--          is only visible once the dates are split out.
--   NEVER  the remaining 13 pairs have 0 provenance rows ever. Note
--          dia.recorded_owners.sf_company_id is simply on the WRONG TABLE —
--          dia.true_owners.sf_company_id exists and is separately registered.
--
-- SALES_PROV_FIELDS (sidebar-pipeline.js:298) is explicitly "a superset across
-- dia + gov ... only keys actually present in the SENT payload are recorded",
-- so the ledger faithfully recorded whatever the gov payload carried. The
-- defect was upstream in the payload, and it is closed.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS _pr5_orphan;
CREATE TEMP TABLE _pr5_orphan(target_table text, field_name text, note text);

INSERT INTO _pr5_orphan(target_table, field_name, note) VALUES
 ('gov.properties','recorded_owner_name','LIVE — 28 writes in the last 30 days (newest 2026-08-25). gov.properties has recorded_owner_id only.'),
 ('gov.sales_transactions','buyer_name','STOPPED 2026-07-29 (7,916 rows). gov column is `buyer`.'),
 ('gov.sales_transactions','seller_name','STOPPED 2026-07-29 (6,039 rows). gov column is `seller`.'),
 ('gov.sales_transactions','procuring_broker','STOPPED 2026-07-14 (33 rows). gov column is `purchasing_broker`.'),
 ('gov.properties','tenant','STOPPED 2026-04-28 (16 rows).'),
 ('gov.properties','parcel_number','STOPPED 2026-04-28 (9 rows). gov keeps the APN on parcel_records.'),
 ('gov.sales_transactions','asking_cap','NEVER written.'),
 ('gov.sales_transactions','asking_price','NEVER written.'),
 ('gov.sales_transactions','last_price_change','NEVER written.'),
 ('gov.sales_transactions','listing_price','NEVER written.'),
 ('gov.sales_transactions','original_price','NEVER written.'),
 ('dia.recorded_owners','sf_company_id','NEVER written. WRONG TABLE — dia.true_owners.sf_company_id exists and is registered.'),
 ('dia.sales_transactions','asking_cap','NEVER written.'),
 ('dia.sales_transactions','asking_price','NEVER written.'),
 ('dia.sales_transactions','last_price','NEVER written.'),
 ('dia.sales_transactions','last_price_change','NEVER written.'),
 ('dia.sales_transactions','listing_price','NEVER written.'),
 ('dia.sales_transactions','original_price','NEVER written.'),
 ('dia.sales_transactions','sold_cap_rate','NEVER written. dia carries cap_rate / stated_cap_rate / calculated_cap_rate / cap_rate_final.');

UPDATE public.field_source_priority f
   SET notes = 'PR7:orphan_column (2026-09-02) — ' || o.note
               || CASE WHEN f.notes IS NULL OR btrim(f.notes) = '' THEN '' ELSE ' || prior note: ' || f.notes END,
       updated_at = now()
  FROM _pr5_orphan o
 WHERE f.target_table = o.target_table
   AND f.field_name  = o.field_name
   AND COALESCE(f.notes, '') NOT LIKE 'PR7:%';

-- ---------------------------------------------------------------------------
-- 4. The standing surface.
--
-- ⚠️ It reports the verdict and the orphan flag; it deliberately does NOT try
-- to recompute "has this source ever written", because that answer depends on
-- v_field_provenance_effective_source AND on the second ladders this migration
-- documents, and a surface that silently re-derives only the first would put
-- the exercised_elsewhere seven straight back into the "dead" bucket.
-- ---------------------------------------------------------------------------
-- ⚠️ THE VERDICT IS EXTRACTED BY REGEX, NOT BY PREFIX, AND THAT IS LOAD-BEARING.
-- The first cut of this view read split_part(notes,'PR5:',2) — a FIXED-POSITION
-- parse. The PR7 marker below stamps a subset of the SAME rows and lands its own
-- prefix in front, so 26 rungs across county_records / folder_feed_bov /
-- folder_feed_master / gsa_lessor silently reported pr5_verdict = NULL while the
-- text sat intact two words to the right. Measured: 400 verdicted before the
-- regex, 426 after — county_records read 92 of its 93 rungs. Same family as the
-- fixed-character source window (CLAUDE.md, DOC17): anchor on the token, never on
-- the offset.
CREATE OR REPLACE VIEW public.v_field_source_priority_triage AS
SELECT f.id,
       f.target_table,
       f.field_name,
       f.source,
       f.priority,
       f.enforce_mode,
       substring(f.notes from 'PR5:([a-z_]+)')    AS pr5_verdict,
       f.notes LIKE '%PR7:orphan_column%'         AS is_orphan_column,
       COALESCE(substring(f.notes from 'PR5:([a-z_]+)')
                  IN ('retire','retired_by_decision'), false) AS is_retired,
       f.notes,
       f.updated_at
  FROM public.field_source_priority f;

COMMENT ON VIEW public.v_field_source_priority_triage IS
  'PR5 (2026-09-02): the ladder-source triage surface. pr5_verdict is one of '
  'exercised_elsewhere | refused_by_decision | retired_by_decision | keep_structural | '
  'writer_live_zero_rows | build_pending | retire | registered. is_orphan_column marks a rung '
  'whose (table, field) does not exist on the target database (PR7). '
  'NOTHING IS DELETED: "unregistered" is a DIFFERENT BRANCH of lcc_merge_field, not a lower rung, '
  'so removing a rung changes merge outcomes in both directions.';

GRANT SELECT ON public.v_field_source_priority_triage TO anon, authenticated, service_role;

DROP TABLE IF EXISTS _pr5_verdict;
DROP TABLE IF EXISTS _pr5_orphan;


-- ============================================================================
-- REVERSAL RUNBOOK
--   DELETE FROM public.field_source_priority
--    WHERE target_table='gov.properties' AND field_name='government_type'
--      AND source='costar_sidebar' AND priority=95;
--   UPDATE public.field_source_priority
--      SET notes = NULLIF(btrim(split_part(notes, ' || prior note: ', 2)), '')
--    WHERE notes LIKE 'PR5:%' OR notes LIKE 'PR7:%';
--   DROP VIEW IF EXISTS public.v_field_source_priority_triage;
-- ⚠️ Deleting the costar_sidebar rung restores the UNREGISTERED branch, which is
-- a behaviour change of its own (classes A-D above, inverted) — not a no-op.
-- ============================================================================
