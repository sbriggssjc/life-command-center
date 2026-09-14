-- PDR14b: the one-time sweep's actual data corrections, applied live 2026-09-11.
-- Idempotent — every branch is fill-blanks/state-guarded, so a replay after the
-- corrections already landed changes nothing (WHERE metadata->>'domain_property_id'
-- = <dead pid> fails once the row has already moved on).

-- 1) PDR14a redirect resolutions (31 entities) — dia_resolve_property_id(<dead>).
UPDATE entities e
SET metadata = e.metadata
  || jsonb_build_object(
       'domain_property_id', v.resolved,
       'domain_property_id_corrected_from', e.metadata->>'domain_property_id',
       'domain_property_id_corrected_at', to_jsonb(now()),
       'domain_property_id_corrected_via', 'pdr14b_redirect'
     )
  || jsonb_build_object('domain_property_ids', COALESCE(e.metadata->'domain_property_ids','{}'::jsonb) || jsonb_build_object('dialysis', v.resolved))
FROM (VALUES
  ('27024','31060'),('29642','29905'),('30602','23753'),('31110','23152'),
  ('31881','28958'),('31901','23592'),('31907','27843'),('31919','30514'),
  ('35478','24874'),('35523','35735'),('35570','30375'),('37491','35722'),
  ('37503','38953'),('37562','35419'),('37567','31856'),('37572','28958'),
  ('37582','31345'),('37591','35597'),('37595','2120020'),('37606','24609'),
  ('37608','23861'),('37611','29848'),('37616','25203'),('37621','24609'),
  ('37710','39874'),('37722','39874'),('39932','26852'),('39935','27793'),
  ('39947','26788'),('39975','28949'),('46017','44522')
) AS v(dead_pid, resolved)
WHERE e.domain='dia' AND e.metadata->>'domain_property_id' = v.dead_pid;

-- 2) PDR13-style unambiguous parcel_number fallback (13 entities).
UPDATE entities e
SET metadata = e.metadata
  || jsonb_build_object(
       'domain_property_id', v.resolved,
       'domain_property_id_corrected_from', e.metadata->>'domain_property_id',
       'domain_property_id_corrected_at', to_jsonb(now()),
       'domain_property_id_corrected_via', 'pdr14b_parcel_match'
     )
  || jsonb_build_object('domain_property_ids', COALESCE(e.metadata->'domain_property_ids','{}'::jsonb) || jsonb_build_object('dialysis', v.resolved))
FROM (VALUES
  ('3719807','25896'),('40001','27327'),('2461249','27691'),('31239','28226'),
  ('46159','25767'),('39919','25356'),('38928','25866'),('1955418','25889'),
  ('37716','25986'),('46039','25336'),('29310','22784'),('45371','27486'),
  ('45398','30025')
) AS v(dead_pid, resolved)
WHERE e.domain='dia' AND e.metadata->>'domain_property_id' = v.dead_pid;

-- 3) The remaining 45 distinct dead pids (46 entity/pid pairs — one dead pid, 29100,
--    is shared by two entities) — flagged, never guessed.
INSERT INTO lcc_dia_property_link_review (entity_id, dangling_property_id, reason)
SELECT e.id, e.metadata->>'domain_property_id', 'no_confident_match'
FROM entities e
WHERE e.domain='dia'
  AND e.metadata ? 'domain_property_id'
  AND e.metadata->>'domain_property_id' IN (
    '24622','26734','27725','28020','28360','28427','29092','29100','29310',
    '30300','30444','30828','31239','31513','33482','33738','35430','35557',
    '35593','36851','36922','37480','37482','37571','37597','37613','37618',
    '37643','37716','37724','37734','38928','39919','39924','39931','39958',
    '40001','45371','45395','45398','45536','45555','46019','46039','46041',
    '46080','46159','47483','51180','51192','1955418','2051464','2140657',
    '2461249','2776955','3005557','3230009','3719807'
  )
  AND e.metadata->>'domain_property_id_corrected_via' IS DISTINCT FROM 'pdr14b_parcel_match'
ON CONFLICT (entity_id, dangling_property_id) DO UPDATE
  SET last_seen_at = now();
