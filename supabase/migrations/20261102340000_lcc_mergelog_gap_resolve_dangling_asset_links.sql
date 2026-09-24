-- MERGELOG-GAP (2026-09-24) — one-shot resolution of the asset entities whose
-- domain_property_id names a property that no longer exists.
--
-- Measured by the new guard (lcc_check_dangling_asset_links, run
-- 6d45cb98-35ac-44ad-a5f4-949ecbf8c28f, 2026-09-24): dia 48 entities / 47 ids,
-- gov 5 entities / 5 ids (plus 3 gov entities on ARCHIVED rows, left alone —
-- the row exists; archive is gov's soft-merge state).
--
-- Every verdict below comes from classifyDanglingLink()
-- (api/_shared/merge-log-reconcile.js), replayed on this exact evidence by
-- test/mergelog-gap.test.mjs. The rule: map only on a merge ledger, or on TWO
-- independent signals (own live identity + address, or address + parcel APN).
-- One signal, or two signals naming different rows, is a candidate for a human.
--
--   mapped 18      dia 6 via dia_property_redirects (geospatial_cron, 09-14..22)
--                  dia 3 via own live dia/asset identity + same address
--                  dia 4 + gov 4 via unique address + matching parcel APN
--                  gov 1 via own live gov/asset identity + address + APN
--   candidate 14   dia; research_type asset_property_link_review
--   unknowable 20  dia ids / 21 entities; no ledger row, no live identity, no
--                  address hit. Flagged metadata.domain_property_missing; the
--                  stale id is KEPT on the entity (it is the only record of what
--                  the capture pointed at). The panel renders "Not on file".
--
-- Reverse a mapped row: SELECT lcc_unrepoint_entity_property_id(domain, dropped, kept)
--   for each ledger row with verdict='mapped' AND batch_tag='mergelog_gap_20260924'.
-- Reverse the flags:  UPDATE entities SET metadata = metadata - 'domain_property_missing'
--   WHERE metadata->'domain_property_missing'->>'batch' = 'mergelog_gap_20260924'.
-- Reverse the tasks:  UPDATE research_tasks SET status='dismissed' WHERE
--   research_type='asset_property_link_review' AND metadata->>'batch'='mergelog_gap_20260924'.

BEGIN;

CREATE TEMP TABLE _mg (domain text, dropped text, verdict text, kept text, rule text, evidence jsonb) ON COMMIT DROP;
INSERT INTO _mg VALUES
 -- dia · redirect ledger (dia_property_redirects, source geospatial_cron)
 ('dia','51217','mapped','25383','redirect_ledger','{"redirect_source":"geospatial_cron","merged_at":"2026-09-14","address_agrees":true}'),
 ('dia','51227','mapped','23405','redirect_ledger','{"redirect_source":"geospatial_cron","merged_at":"2026-09-15","address_agrees":true}'),
 ('dia','51230','mapped','33706','redirect_ledger','{"redirect_source":"geospatial_cron","merged_at":"2026-09-16","address_agrees":true}'),
 ('dia','51232','mapped','31514','redirect_ledger','{"redirect_source":"geospatial_cron","merged_at":"2026-09-16","address_agrees":true}'),
 ('dia','51239','mapped','51238','redirect_ledger','{"redirect_source":"geospatial_cron","merged_at":"2026-09-17","address_agrees":true,"own_identity":"51238"}'),
 ('dia','51250','mapped','25336','redirect_ledger','{"redirect_source":"geospatial_cron","merged_at":"2026-09-22","address_agrees":true}'),
 -- dia · own live identity + address
 ('dia','37597','mapped','28953','own_identity_and_address','{"own_identity":"dia/asset=28953","address":"200 Interchange Park Drive, TN"}'),
 ('dia','46080','mapped','37106','own_identity_and_address','{"own_identity":"dia/asset=37106","address":"198 N Springfield Ave, IL"}'),
 ('dia','51192','mapped','51191','own_identity_and_address','{"own_identity":"dia/asset=51191","address":"4783-4815 Marlboro Pike, MD"}'),
 -- dia · unique address + parcel APN
 ('dia','45395','mapped','25203','address_and_parcel','{"apn":"14-0045-0006-015-0","address":"418 Decatur St SE, GA"}'),
 ('dia','51180','mapped','22331','address_and_parcel','{"apn":"7253-026-033","address":"4223 E Anaheim St, CA"}'),
 ('dia','2776955','mapped','26656','address_and_parcel','{"apn":"093115100215-09-31-151-00215-09-31-177-003","address":"46360 Gratiot Ave, MI","note":"entity city New Baltimore, property city Chesterfield; parcel decides"}'),
 ('dia','3005557','mapped','27006','address_and_parcel','{"apn":"15-4.0-20-004-022-006.0000015402000402200600000","address":"801 W Broadway St, MO"}'),
 -- gov · unique address + parcel APN (no gov ledger names any of the 5)
 ('gov','16572','mapped','1945','address_and_parcel','{"apn":"01350312600000135-031-26-0000","address":"605 N Arrowhead Ave, CA"}'),
 ('gov','23324','mapped','1203','address_and_parcel','{"apn":"1650121600165-012-16-00","address":"2160 S El Camino Real, CA"}'),
 ('gov','23431','mapped','5592','address_and_parcel','{"apn":"2314400018000023144000190000","address":"10718 S Roberts Rd, IL"}'),
 ('gov','23447','mapped','7578','address_and_parcel','{"apn":"2033354055","address":"140 N Crooks Rd, MI"}'),
 ('gov','32026','mapped','8074','own_identity_and_address','{"own_identity":"gov/asset=8074","apn":"08J-23-0912","address":"880 Rue St Francois, MO"}'),
 -- dia · candidates (one signal, or two naming different rows)
 ('dia','27725','candidate',null,'single_signal_or_conflict','{"candidates":["45194"],"signals":["address"],"note":"entity APN 19700045; candidate has no parcel on file"}'),
 ('dia','28020','candidate',null,'single_signal_or_conflict','{"candidates":["37622"],"signals":["address"]}'),
 ('dia','31513','candidate',null,'single_signal_or_conflict','{"candidates":["37744"],"signals":["address"]}'),
 ('dia','35430','candidate',null,'single_signal_or_conflict','{"candidates":["26729"],"signals":["address"]}'),
 ('dia','35557','candidate',null,'single_signal_or_conflict','{"candidates":["37636"],"signals":["address"]}'),
 ('dia','35593','candidate',null,'single_signal_or_conflict','{"candidates":["27815"],"signals":["address"]}'),
 ('dia','37613','candidate',null,'single_signal_or_conflict','{"candidates":["23551"],"signals":["address"],"note":"property_merge_log says 37613 -> 35601, and 35601 is itself gone with no redirect"}'),
 ('dia','37643','candidate',null,'single_signal_or_conflict','{"candidates":["23872"],"signals":["address"],"note":"entity APN 29-00-24-3-006-002.000; candidate has no parcel on file"}'),
 ('dia','37724','candidate',null,'single_signal_or_conflict','{"candidates":["23007"],"signals":["address"],"note":"candidate tenant is Kentucky Childrens Hospital"}'),
 ('dia','45536','candidate',null,'single_signal_or_conflict','{"candidates":["37732"],"signals":["address"]}'),
 ('dia','45555','candidate',null,'single_signal_or_conflict','{"candidates":["27288"],"signals":["address"]}'),
 ('dia','36851','candidate',null,'single_signal_or_conflict','{"candidates":["37545","29507"],"signals":["own_identity","address"],"note":"own identity 37545 and the address hit 29507 are two live rows at one building (twin)"}'),
 ('dia','36922','candidate',null,'single_signal_or_conflict','{"candidates":["37519","35599"],"signals":["own_identity","address"],"note":"own identity 37519 and the address hit 35599 are two live rows at one building (twin)"}'),
 ('dia','37618','candidate',null,'single_signal_or_conflict','{"candidates":["37558","26495"],"signals":["own_identity","address"],"note":"own identity 37558 and the address hit 26495 are two live rows at one building (twin)"}'),
 -- dia · unknowable
 ('dia','15243','unknowable',null,'no_evidence','{"note":"entity has no address (asset 15243)"}'),
 ('dia','24622','unknowable',null,'no_evidence','{}'),
 ('dia','26734','unknowable',null,'no_evidence','{}'),
 ('dia','28360','unknowable',null,'no_evidence','{}'),
 ('dia','28427','unknowable',null,'no_evidence','{}'),
 ('dia','29092','unknowable',null,'no_evidence','{}'),
 ('dia','29100','unknowable',null,'no_evidence','{"note":"two entities carry this id"}'),
 ('dia','30300','unknowable',null,'no_evidence','{}'),
 ('dia','30444','unknowable',null,'no_evidence','{}'),
 ('dia','30828','unknowable',null,'no_evidence','{}'),
 ('dia','33738','unknowable',null,'no_evidence','{}'),
 ('dia','37480','unknowable',null,'no_evidence','{}'),
 ('dia','37482','unknowable',null,'no_evidence','{}'),
 ('dia','37734','unknowable',null,'no_evidence','{}'),
 ('dia','39924','unknowable',null,'no_evidence','{}'),
 ('dia','39931','unknowable',null,'no_evidence','{}'),
 ('dia','39958','unknowable',null,'no_evidence','{}'),
 ('dia','2051464','unknowable',null,'no_evidence','{}'),
 ('dia','2140657','unknowable',null,'no_evidence','{}'),
 ('dia','3230009','unknowable',null,'no_evidence','{}');

-- 1. Ledger, one row per entity (29100 carries two).
INSERT INTO public.lcc_asset_property_link_resolution
  (batch_tag, domain, entity_id, dropped_property_id, verdict, kept_property_id, evidence)
SELECT 'mergelog_gap_20260924', m.domain, e.id, m.dropped, m.verdict, m.kept,
       m.evidence || jsonb_build_object('rule', m.rule)
  FROM _mg m
  JOIN public.entities e
    ON e.entity_type = 'asset' AND e.merged_into_entity_id IS NULL
   AND e.domain IN (m.domain, CASE m.domain WHEN 'dia' THEN 'dialysis' ELSE 'government' END)
   AND coalesce(e.metadata->>'domain_property_id', e.metadata->'_pipeline_summary'->>'domain_property_id') = m.dropped
ON CONFLICT (batch_tag, entity_id, dropped_property_id) DO NOTHING;

-- 2. Repoint the mapped links (same helper the reconcile uses; it stamps
--    _round_76ee_prev_property_id so lcc_unrepoint_entity_property_id can undo it).
DO $$
DECLARE r record; n int;
BEGIN
  FOR r IN SELECT DISTINCT domain, dropped_property_id, kept_property_id
             FROM public.lcc_asset_property_link_resolution
            WHERE batch_tag = 'mergelog_gap_20260924' AND verdict = 'mapped' AND applied_at IS NULL LOOP
    n := public.lcc_repoint_entity_property_id(r.domain, r.kept_property_id, r.dropped_property_id);
    UPDATE public.lcc_asset_property_link_resolution
       SET applied_at = now(), evidence = evidence || jsonb_build_object('entities_repointed', n)
     WHERE batch_tag = 'mergelog_gap_20260924' AND domain = r.domain
       AND dropped_property_id = r.dropped_property_id AND verdict = 'mapped';
  END LOOP;
END $$;

-- 3. Candidates → research lane (existing research_tasks queue).
WITH ins AS (
  INSERT INTO public.research_tasks
    (workspace_id, research_type, title, instructions, entity_id, domain, priority,
     source_table, source_record_id, metadata)
  SELECT e.workspace_id, 'asset_property_link_review',
         'Relink asset: dia property #' || l.dropped_property_id || ' no longer exists — ' || coalesce(e.address, e.name),
         'This asset''s dia property was deleted by a merge no ledger recorded. Evidence names '
           || (SELECT string_agg('#' || c, ', ') FROM jsonb_array_elements_text(l.evidence->'candidates') c)
           || '. Confirm which property this capture is, then repoint with '
           || 'lcc_repoint_entity_property_id(''dia'', <kept>, ''' || l.dropped_property_id || ''').',
         l.entity_id, 'dia', 60, 'lcc_asset_property_link_resolution', l.id::text,
         jsonb_build_object('batch', l.batch_tag, 'dropped_property_id', l.dropped_property_id,
                            'candidates', l.evidence->'candidates', 'evidence', l.evidence)
    FROM public.lcc_asset_property_link_resolution l
    JOIN public.entities e ON e.id = l.entity_id
   WHERE l.batch_tag = 'mergelog_gap_20260924' AND l.verdict = 'candidate' AND l.research_task_id IS NULL
  RETURNING id, source_record_id
)
UPDATE public.lcc_asset_property_link_resolution l
   SET research_task_id = ins.id, applied_at = now()
  FROM ins WHERE l.id::text = ins.source_record_id;

-- 4. Flag candidates + unknowables so the panel says "Not on file".
UPDATE public.entities e
   SET metadata = coalesce(e.metadata, '{}'::jsonb) || jsonb_build_object('domain_property_missing',
         jsonb_build_object('property_id', l.dropped_property_id, 'verdict', l.verdict,
                            'checked_at', now(), 'batch', l.batch_tag,
                            'research_task_id', l.research_task_id)),
       updated_at = now()
  FROM public.lcc_asset_property_link_resolution l
 WHERE l.entity_id = e.id AND l.batch_tag = 'mergelog_gap_20260924'
   AND l.verdict IN ('candidate', 'unknowable');

UPDATE public.lcc_asset_property_link_resolution
   SET applied_at = now()
 WHERE batch_tag = 'mergelog_gap_20260924' AND verdict = 'unknowable' AND applied_at IS NULL;

COMMIT;
