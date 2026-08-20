-- ============================================================================
-- P159 — the enrich tick spent two-thirds of every run on rows it cannot help,
-- and the highest-value owners were the ones jamming the queue head.
-- Applied live to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-20.
-- ----------------------------------------------------------------------------
-- OBSERVED, then EXPLAINED, then CONFIRMED.
--
-- A live tick returned {"processed":25,"attached":1,"drillthrough":7,"skipped":17}.
-- Predicting the same figure from the other direction: of the top 25 rows by
-- rank_value, exactly 17 are rows the tick can do nothing with. Two independent
-- observations, one cause.
--
-- The queue is ordered `rank_value DESC NULLS LAST, updated_at ASC`. A row with
-- an OPEN owner_contact_manual research task returns `manual_research_pending`
-- having done no work; a row whose enrichment_action is the literal string
-- 'manual_research' has nothing automated to try at all. Both still satisfy the
-- handler's only work-filter, `or=(active_contact_name.not.is.null,
-- enrichment_action.not.is.null)` -- because enrichment_action is NEVER null:
-- v_owner_active_contact's CASE ends in ELSE 'manual_research'.
--
-- ⚠️ THE ROTATION THAT USED TO SAVE US IS GONE, AND A COMMENT STILL CLAIMS IT.
-- api/_handlers/owner-contact-enrich.js:502 still says `updated_at ASC` is "the
-- tiebreak that keeps the queue moving". Once value-ranking was introduced
-- (20260729120000) updated_at became ONLY a tiebreak among equal rank_value, so
-- a high-value unresolvable row is re-served at the head of EVERY tick forever.
-- The comment describes a protection that no longer exists -- worth correcting
-- in the handler when it is next touched.
--
-- ── SIZE ────────────────────────────────────────────────────────────────────
--   queue                                                    4,472
--   open research task (zero work, re-served daily)             95
--   enrichment_action = 'manual_research' (nothing to try)    3,643
--   ACTUALLY ACTIONABLE                                        757
--
-- ── FIX, AND WHY IT BELONGS IN THE VIEW ─────────────────────────────────────
-- Rows the tick cannot act on do not belong in the tick's QUEUE. That is the
-- Consumption-Layer rule (surface actionable-only), and it makes this view-only:
-- no handler edit, no Railway redeploy. The only two readers are the enrich
-- worker (owner-contact-enrich.js:504) and its drain script
-- (scripts/owner-contact-enrich-drain.mjs); both want exactly this narrowing.
--
-- Nothing is hidden from humans: the 3,643 manual-research owners remain on
-- v_owner_contact_worklist and in the P158 named-lead lane, which are the
-- surfaces a person actually works.
--
-- SELF-HEALING: a row re-enters the moment its research task closes, because the
-- exclusion reads live task status rather than a stored flag.
--
-- ── LIVE RESULT (same limit=25, before vs after) ────────────────────────────
--   before  attached 1 · drillthrough  7 · skipped 17   (32% useful)
--   after   attached 1 · drillthrough 21 · skipped  3   (88% useful)
--
-- REVERSAL: re-create the view without the WHERE clause (body otherwise identical).
-- ============================================================================

CREATE OR REPLACE VIEW public.v_owner_contact_enrich_queue AS
 SELECT p.entity_id,
    p.owner_name,
    p.workspace_id,
    p.active_contact_name,
    p.active_contact_entity_id,
    p.active_authority_level,
    p.active_contact_role,
    p.enrichment_action,
    p.status,
    p.updated_at,
    COALESCE(NULLIF(pa.current_annual_rent_total, 0::numeric), cv.connected_property_value) AS rank_value
   FROM owner_contact_pivot p
     LEFT JOIN v_entity_portfolio_all pa ON pa.entity_id = p.entity_id
     LEFT JOIN lcc_entity_connected_value cv ON cv.entity_id = p.entity_id
  WHERE
    -- P159: nothing automated is possible for these; they are human work and
    -- live on v_owner_contact_worklist / the named-lead lane instead.
    p.enrichment_action IS DISTINCT FROM 'manual_research'
    -- P159: already surfaced to a human; re-processing does nothing but occupy
    -- the highest-value slots in the batch.
    AND NOT EXISTS (
      SELECT 1 FROM public.research_tasks t
       WHERE t.entity_id = p.entity_id
         AND t.research_type = 'owner_contact_manual'
         AND t.status IN ('queued','in_progress'));

COMMENT ON VIEW public.v_owner_contact_enrich_queue IS
  'P159. Value-ranked queue for the owner-contact enrich tick, ACTIONABLE ONLY. '
  'Excludes enrichment_action=''manual_research'' (nothing automated to try) and '
  'owners with an open owner_contact_manual research task (already surfaced to a '
  'human). Both classes previously occupied the head of every batch under '
  'rank_value DESC ordering and returned manual_research_pending forever -- 17 of '
  'the top 25 slots, matching the live tick''s skipped count exactly. Rows '
  're-enter automatically when their task closes. Humans still see the excluded '
  'owners via v_owner_contact_worklist and v_lcc_named_lead_worklist.';

DO $$
DECLARE n_queue int; n_dead int;
BEGIN
  SELECT count(*) INTO n_queue FROM public.v_owner_contact_enrich_queue
   WHERE active_contact_entity_id IS NULL AND status IN ('active','exhausted')
     AND (active_contact_name IS NOT NULL OR enrichment_action IS NOT NULL);
  SELECT count(*) INTO n_dead FROM (
    SELECT * FROM public.v_owner_contact_enrich_queue
     WHERE active_contact_entity_id IS NULL AND status IN ('active','exhausted')
     ORDER BY rank_value DESC NULLS LAST, updated_at ASC LIMIT 25) t
   WHERE t.enrichment_action = 'manual_research'
      OR EXISTS (SELECT 1 FROM public.research_tasks rt
                  WHERE rt.entity_id = t.entity_id
                    AND rt.research_type='owner_contact_manual'
                    AND rt.status IN ('queued','in_progress'));
  IF n_dead > 0 THEN
    RAISE EXCEPTION 'P159 gate: % dead-weight rows still in the top 25', n_dead;
  END IF;
  RAISE NOTICE 'P159 ok: queue now % actionable rows, 0 dead weight in the head', n_queue;
END $$;
