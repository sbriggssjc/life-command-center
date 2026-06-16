-- R35 Unit 1 (2026-06-16): retype the dia CCN-mislabel external_identities rows
-- from (source_system='dia', source_type='asset') to the canonical CMS clinic
-- identity (source_system='cms', source_type='medicare_ccn').  Target DB: LCC
-- Opps (xengecqvemvfknjvbvrq).
--
-- WHY (cross-DB referential-integrity sweep, AUDIT 2026-06-16): the one table
-- R22/R23 never reconciled is external_identities asset rows. Grounding the dia
-- asset rows live found 359 with a 6-digit external_id; cross-checking dia DB:
--   * 345 are CMS Medicare CCNs that exist in dia.medicare_clinics.medicare_id
--     and are NOT dia.properties.property_id -> CCN MISLABELS (this migration).
--   * 14 are real 6-digit dia property_ids (present in dia.properties)
--     -> genuine asset identities, LEFT ALONE.
-- These are NOT distributed clinic identities: 343 of the 345 hang off a single
-- junk-named entity "Property link approved" (a captured UI status string), +2
-- on "Clinic lead outcome recorded" / "Research outcome saved". The recurrence
-- source was api/operations.js bridgeLogActivity minting a (dia, asset,
-- <external_id>) identity from the activity TITLE, fed by dialysis.js property-
-- review log_activity calls passing the clinic CCN as external_id. That writer
-- is fixed at the choke point in the same R35 commit (ensureEntityLink
-- resolveOnly) so no new CCN-as-asset rows can be minted.
--
-- The CCN VALUES are valid Medicare identifiers, so we RETYPE (never delete):
-- relabel them to the canonical CMS identity convention (cms / medicare_ccn).
-- This (a) records the true identity, (b) removes them from the (dia, asset, *)
-- space so the R35 Unit 2 census-based asset-orphan prune cannot falsely treat a
-- CCN (which is not a dia property_id, so absent from the property census) as a
-- hard-gone orphan. Hence Unit 1 MUST be applied BEFORE Unit 2's first prune.
--
-- The junk entity "Property link approved" itself is a separate concern (a
-- writer-bug artifact) — surfaced for Scott, NOT touched here.
--
-- SAFE / REVERSIBLE / IDEMPOTENT:
--   * Relabel only (entity_id, external_id, metadata untouched) -> reversible by
--     flipping the two columns back for these external_id values.
--   * The 345 CCN values are embedded below (grounded from dia on 2026-06-16:
--     in medicare_clinics, not in properties). Stable identifiers.
--   * No unique-constraint risk: the key is
--     (workspace_id, source_system, source_type, external_id); each CCN is
--     distinct in the single workspace, and there are ZERO (cms, medicare_ccn, *)
--     rows pre-existing, so no collision.
--   * Re-run is a no-op (the WHERE matches source_system='dia'/source_type='asset'
--     which no longer holds for these rows after the first run).

BEGIN;

WITH ccn(external_id) AS (
  SELECT unnest(ARRAY[
    '012505','012517','012558','012559','012572','012599','012606','012612','012614','012617','012618','012625','012630','012653','012657','012670','012672','012716','032501','032506','032525','032528','032543','032564','032575','032604','032605','032612','032638','032639','032647','032650','042513','042525','042528','042547','042548','042553','042567','042568','042571','042573','042574','042600','052334','052380','052404','052502','052521','052525','052528','052531','052534','052538','052541','052543','052545','052550','052552','052556','052560','052564','052568','052571','052572','052576','052581','052589','052590','052600','052602','052612','052620','052627','052628','052653','052658','052665','052686','052699','052713','052720','052721','052725','052726','052729','052734','052739','052744','052747','052759','052760','052764','052773','052781','052782','052783','052786','052788','052791','052794','052801','052802','052806','052807','052808','052814','052819','052826','052827','052828','052834','052838','052842','052843','052854','052856','052858','052859','052860','052868','052877','052879','052882','052883','052886','052889','052893','052897','053526','062505','062537','062541','062546','062553','062558','062562','062563','062564','062581','062583','072501','072511','072514','072516','072518','072521','072522','072523','072528','072532','072533','072537','072540','072543','082506','082509','082512','082513','082514','082517','082520','082529','092527','102531','102596','102646','102676','102772','102821','102835','112760','112777','112779','112841','112867','122537','142337','142338','142507','142508','142511','142519','142594','142669','142686','142732','142743','142785','142787','142793','142826','142834','142849','142857','142863','142865','152592','152696','152702','162516','172562','182586','182589','182599','182631','192757','192758','212545','212594','212691','212730','222517','232525','232530','232647','232678','232689','232697','232710','232714','242513','262535','262541','262641','262690','262692','282528','292517','292537','292552','292557','302506','332538','332550','332613','332746','332803','332825','342512','342586','342640','342744','342765','342771','362508','362528','362660','362688','362841','362854','362855','362875','362886','362888','382515','392523','392530','392560','392605','392742','392751','392752','392756','392773','392775','392787','392818','392840','422543','422611','422612','422650','422668','422689','442505','442593','442701','442723','442758','442771','452526','452550','452579','452656','452665','452668','452845','462524','492679','492681','492686','492740','502586','522566','522623','552577','552582','552594','552616','552691','552694','552713','552716','552733','552746','552756','552757','552762','552765','552785','552792','552825','552850','552870','552881','672526','672530','672696','672778','672826','672833','672855','672886','682522','682630','682652','682664','682712','682726','682727','742561','742582','742598','742603','742732','752512','752526','752544','752552','752589','752590','852510','852526','852578'
  ])
)
UPDATE public.external_identities ei
   SET source_system = 'cms',
       source_type   = 'medicare_ccn',
       last_synced_at = now()
  FROM ccn
 WHERE ei.source_system = 'dia'
   AND ei.source_type   = 'asset'
   AND ei.external_id    = ccn.external_id;

COMMIT;
