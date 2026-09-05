-- ===========================================================================
-- GOVDUP1-a Unit 3 — the live rows, dispositioned PER ROW, and the 154
-- orphaned advisories resolved.  gov (scknotsqkcheojiaewwh), applied live
-- 2026-09-05.  Depends on 20260905130000 (the dedupe) -- the fix ships BEFORE
-- the cleanup, because a one-shot retire of a recurring producer is a chore
-- you repeat silently forever (P176), and this class has already been cleaned
-- twice (junk_backfill_archived_2026-06-09, then GOVDUP1's 154).
--
-- ⚠️ THE BRIEF SAID 8 LIVE ROWS; RE-MEASURED 2026-09-05 IT IS **6**.
--   736 rows / 53 fanned-out SF ids both reproduce exactly; the live count
--   does not.  Reported as measured, not as briefed.
--
-- ⚠️ AND "RETIRE THEM THE GOVDUP1 WAY" IS WRONG FOR 4 OF THE 6.  Reading the
--   rows before flipping status is the whole of this unit:
--
--   | pid   | address                | data_source                       | other LIVE row at same addr | disposition |
--   |-------|------------------------|-----------------------------------|-----------------------------|-------------|
--   | 36822 | 17925 SE Division St   | unknown_writer (SF auto-create)   | 11316 costar_sidebar        | RETIRE      |
--   | 36823 | 12819 Country Pl Dr    | unknown_writer (SF auto-create)   | 8216  excel_master (curated)| RETIRE      |
--   | 39128 | 700 Technology Dr      | unknown_writer (SF auto-create)   | 39064 (the pair)            | RETIRE      |
--   | 39064 | 700 technology dr      | costar_sidebar                    | 39128                       | KEEP        |
--   | 22102 | 50 Commerce Way        | gov_master_backfill_r71_anchored  | NONE                        | NO ACTION   |
--   | 18945 | 41810 N Venture Dr B   | gov_master_backfill_r71_anchored  | NONE                        | NO ACTION   |
--
--   22102 and 18945 are NOT this producer's mints.  They were created
--   2026-05-17 12:28/12:29, ~20 minutes BEFORE the oldest '_new_property'
--   advisory (12:48), they carry data_source 'gov_master_backfill_r71_anchored'
--   -- the *anchored* row the June cleanup deliberately KEPT -- and every one
--   of their ~120 same-address siblings is already
--   'junk_backfill_archived_2026-06-09'.  They are the SOLE LIVE gov row at
--   their address.  Archiving them would delete the only record of the
--   property and silently reverse a decision somebody already made.  The
--   advisory row against them was logged against an already-linked property,
--   not against a fresh insert.
--
-- ⚠️ 39064/39128 IS RETIRED, NOT MERGED, AND THAT IS A DELIBERATE DEVIATION.
--   The brief says a merge "may be" right now that MERGE1 shipped the fold.
--   Measured, the pair carries 0 leases, 0 sales, 0 documents, 0 financials
--   and exactly one `investment_scores` row each -- and investment_scores is
--   classified `re_derivable` by gov_merge_child_policy, so a merge would
--   DELETE the drop row's score and repoint nothing else.  A merge therefore
--   buys nothing over a retire here, while gov_merge_property_apply is a
--   hard-DELETE path whose reversal (gov_unmerge_property) is a partial
--   restore.  A status flip is strictly more reversible for identical effect.
--   39064 is kept as the survivor: it is the earlier row (08-24 vs 08-25) and
--   it carries the costar_sidebar provenance stamp, i.e. a second system has
--   since spoken about it.
--
-- REVERSAL RUNBOOK (both halves, keyed on the batch tag):
--   update public.properties p set status = l.prior_status
--     from public.gov_property_dup_retire_log l
--    where l.property_id = p.property_id
--      and l.batch_tag = 'govdup1a_sf_autocreate_retire_20260905';
--   update public.pending_updates
--      set status='pending', resolved_by=null, resolved_at=null, resolution_notes=null
--    where resolved_by = 'govdup1a:archived_parent_20260905';
-- ===========================================================================

-- ── 1. retire the three genuine duplicate mints (status flip only) ─────────
insert into public.gov_property_dup_retire_log (batch_tag, property_id, prior_status, reason)
select 'govdup1a_sf_autocreate_retire_20260905', p.property_id, p.status,
       case p.property_id
         when 36822 then 'SF auto-create duplicate of live property 11316 (same address, costar_sidebar)'
         when 36823 then 'SF auto-create duplicate of live property 8216 (same address, excel_master curated)'
         when 39128 then 'SF auto-create duplicate of live property 39064 (same sf_property_id a06Vs00000gdMepIAE)'
       end
  from public.properties p
 where p.property_id in (36822, 36823, 39128)
   and coalesce(p.status,'') <> 'archived';

update public.properties p
   set status = 'archived', updated_at = now()
  from public.gov_property_dup_retire_log l
 where l.batch_tag = 'govdup1a_sf_autocreate_retire_20260905'
   and l.property_id = p.property_id
   and coalesce(p.status,'') <> 'archived';

-- ── 2. GOVDUP1-c: resolve the orphaned advisories, naming the retire batch ─
-- NEVER deleted -- status flip to 'auto_resolved' (a value already in the
-- table's CHECK vocabulary and already used by expire_orphan_pending_updates),
-- with the batch that retired the parent named in resolution_notes so the
-- provenance survives.
update public.pending_updates pu
   set status           = 'auto_resolved',
       resolved_by      = 'govdup1a:archived_parent_20260905',
       resolved_at      = now(),
       resolution_notes = 'parent property archived by retire batch '
                          || coalesce((select l.batch_tag
                                         from public.gov_property_dup_retire_log l
                                        where l.property_id = pu.property_id
                                        order by l.created_at desc limit 1),
                                      'junk_backfill_archived_2026-06-09')
                          || '; the "verify this auto-created property" advisory is moot',
       updated_at       = now()
 where pu.status = 'pending'
   and pu.table_name = 'properties'
   and exists (select 1 from public.properties p
                where p.property_id = pu.property_id and p.status = 'archived');
