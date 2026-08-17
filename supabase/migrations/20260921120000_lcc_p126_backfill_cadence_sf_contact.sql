-- ===========================================================================
-- P126 -- give cadences their Salesforce contact id, so LCC can drive the Task
-- APPLIED LIVE to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-17.
-- ===========================================================================
-- The cadence engine ALREADY implements Scott's touchpoint spec faithfully
-- (docs/architecture/touchpoint_cadence_spec.md): the 7-touch arc at
-- 0/10/15/10/12/10/10 days, tier multipliers A 0.7 / B 1.0 / C 2.0, and every
-- cool-down (flyer 3d, meeting 48h, phone-decline 30d, quarterly 90d). Nothing
-- about the SCHEDULE needed designing or changing -- 1,941 of 1,948 cadences
-- already carry a computed next_touch_due.
--
-- That number has never reached Salesforce, and the blocker is a JOIN. To push a
-- due date LCC must know WHICH Task, and the only viable link is
-- cadence.sf_contact_id -> Task.WhoId (which is why WhoId is in the P125 audit
-- read). Live before this migration:
--
--   cadences ....................................... 1,948
--   ... with next_touch_due ........................ 1,941
--   ... with sf_contact_id (driveable) .............   131
--
-- bd_opportunity_id is a dead end here: only 7 cadences carry one, and
-- bd_opportunities.sf_opp_id holds an OPPORTUNITY id on 605 of 607 rows.
--
-- LCC already held 9,877 salesforce/Contact external_identities. This connects
-- what it has -- no new source, no enrichment.
--
-- GATES, each measured rather than assumed:
--   * EXACTLY ONE salesforce/Contact identity on the entity. 163 entities carry
--     2-4 of them; picking one would be a guess. The 8 cadences sitting on those
--     go to a review lane.
--   * entity_type = 'person'. 2 otherwise-eligible cadences sit on non-person
--     entities -- an SF Contact identity on an organization is the person/org
--     conflation sf-account-link.js exists to prevent. Surfaced, not filled.
--   * FILL-BLANKS: only sf_contact_id IS NULL. An existing value is never
--     overwritten.
--
-- VERIFIED LIVE: 609 filled, 8 ambiguous + 2 non-person surfaced, re-run writes
-- 0. Driveable cadences 130 -> 739. All 609 written ids carry the '003' Contact
-- key prefix (a real SF Contact, not an Account or User id).
--
-- Writes ONLY sf_contact_id. No schedule change, no Salesforce write, no cadence
-- advanced, retired or created.
--
-- REMAINING CEILING (1,198 cadences with no SF contact identity at all):
--   organization  709  (58 with an email)  -- LLC owner shells; the cadence is on
--                                             the company, so there is no CONTACT
--                                             to link. Needs a named person first.
--   person        497  (339 with an email) -- real people LCC tracks who are not
--                                             in Salesforce, or not yet matched.
--                                             An email-based match is the obvious
--                                             next lever, NOT built here.
--   asset           2                      -- cadences on an asset entity; wrong
--                                             by construction, worth a look.
--
-- REVERSAL:
--   UPDATE touchpoint_cadence SET sf_contact_id = NULL
--    WHERE metadata->>'sf_contact_backfill' = 'p126';
-- ===========================================================================

CREATE OR REPLACE FUNCTION lcc_backfill_cadence_sf_contact(p_dry_run boolean DEFAULT true)
RETURNS TABLE(verdict text, n bigint, distinct_entities bigint)
LANGUAGE plpgsql
AS $fn$
#variable_conflict use_column
DECLARE v_filled bigint := 0;
BEGIN
  CREATE TEMP TABLE _p126 ON COMMIT DROP AS
  WITH ident AS (
    SELECT entity_id,
           min(external_id) AS sf_contact_id,
           count(DISTINCT external_id) AS n_ids
    FROM public.external_identities
    WHERE source_system = 'salesforce' AND source_type = 'Contact'
    GROUP BY entity_id
  )
  SELECT c.id AS cadence_id,
         c.entity_id,
         i.sf_contact_id,
         CASE
           WHEN i.entity_id IS NULL                 THEN 'skip_no_sf_contact_identity'
           WHEN i.n_ids > 1                         THEN 'review_ambiguous_identities'
           WHEN e.entity_type::text <> 'person'     THEN 'review_not_a_person'
           ELSE 'fill'
         END AS verdict
  FROM public.touchpoint_cadence c
  LEFT JOIN ident i    ON i.entity_id = c.entity_id
  LEFT JOIN public.entities e ON e.id = c.entity_id
  WHERE c.sf_contact_id IS NULL          -- FILL-BLANKS
    AND c.entity_id IS NOT NULL;

  IF NOT p_dry_run THEN
    UPDATE public.touchpoint_cadence t
       SET sf_contact_id = p.sf_contact_id,
           metadata = COALESCE(t.metadata,'{}'::jsonb)
                      || jsonb_build_object('sf_contact_backfill','p126',
                                            'sf_contact_backfilled_at', now()::text),
           updated_at = now()
      FROM _p126 p
     WHERE t.id = p.cadence_id AND p.verdict = 'fill';
    GET DIAGNOSTICS v_filled = ROW_COUNT;
  END IF;

  RETURN QUERY
  SELECT p.verdict, count(*)::bigint, count(DISTINCT p.entity_id)::bigint
  FROM _p126 p GROUP BY p.verdict
  UNION ALL
  SELECT CASE WHEN p_dry_run THEN 'DRY_RUN_no_write' ELSE 'rows_written' END,
         CASE WHEN p_dry_run THEN 0::bigint ELSE v_filled END, 0::bigint;
END;
$fn$;

COMMENT ON FUNCTION lcc_backfill_cadence_sf_contact(boolean) IS
  'P126: fill touchpoint_cadence.sf_contact_id from the entity''s single salesforce/Contact identity so the cadence can be matched to its SF Task by WhoId. Fill-blanks, exactly-one-identity, person-only. Dry-run default.';

CREATE OR REPLACE VIEW v_lcc_cadence_sf_contact_review AS
WITH ident AS (
  SELECT entity_id,
         count(DISTINCT external_id) AS n_ids,
         string_agg(DISTINCT external_id, ', ') AS candidate_sf_contact_ids
  FROM public.external_identities
  WHERE source_system = 'salesforce' AND source_type = 'Contact'
  GROUP BY entity_id
)
SELECT
  c.id            AS cadence_id,
  c.entity_id,
  e.name          AS entity_name,
  e.entity_type::text AS entity_type,
  c.priority_tier,
  c.phase,
  c.next_touch_due,
  i.n_ids,
  i.candidate_sf_contact_ids,
  CASE WHEN i.n_ids > 1 THEN 'ambiguous_identities'
       ELSE 'not_a_person' END AS reason
FROM public.touchpoint_cadence c
JOIN ident i ON i.entity_id = c.entity_id
LEFT JOIN public.entities e ON e.id = c.entity_id
WHERE c.sf_contact_id IS NULL
  AND (i.n_ids > 1 OR COALESCE(e.entity_type::text,'') <> 'person');

COMMENT ON VIEW v_lcc_cadence_sf_contact_review IS
  'P126: cadences that could NOT be auto-linked to a Salesforce contact -- either the entity carries several Contact identities (picking one would be a guess) or the cadence sits on a non-person entity (the person/org conflation). Human call.';

GRANT SELECT ON v_lcc_cadence_sf_contact_review TO anon, authenticated, service_role;
