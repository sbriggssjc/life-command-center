-- ===========================================================================
-- P121 -- ONE canonical "what is this decision worth", plus a rerank sweep
-- APPLIED LIVE to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-17.
-- ===========================================================================
-- P118 (confirm_true_owner) and P120 (junk_entity_name) each fixed a lane whose
-- rank_value was not a value. Measuring the rest found the same defect in four
-- more lanes, and this time the hidden money is concentrated:
--
--   lane                          open   would rank   rent behind rank 0
--   sf_link_conflict                 6      6 (100%)        $16,053,980
--   sf_link_collision               30     12                $8,590,543
--   sf_contact_account_mismatch      4      3 (cadence)              $0
--   confirm_true_owner (residue)     2      1                        $0
--   junk_entity_name (pipe-comps)   45      0                        $0
--
-- sf_link_conflict is SIX rows, every one a real owner, five owning assets --
-- Agree Realty ($6.9M), HC Government Realty Trust ($5.4M), JB Harrison
-- Properties ($2.0M), Cove Capital ($1.0M) -- sitting at the bottom of every
-- sort because their producer never set a rank.
--
-- Rather than paste the value expression a FOURTH time, this defines it ONCE.
-- Repeating it is exactly the "two definitions drift apart" failure this repo
-- keeps re-learning: P116's strict-core vs the fuzzy core, the NON_REACHABLE_ROLES
-- pair that must be edited together, the three definitions of owner-reachable.
--
-- SCOPE / SAFETY
--   * ORDERING ONLY. No verdict, no effect, no row created, closed or reopened.
--   * FILL-BLANKS: only stamps rows whose rank is 0/NULL, so it never overrides
--     a producer that computed a better lane-specific value. P118 deliberately
--     ranks confirm_true_owner by the ASSET's rent (the decision is about one
--     building, not the owner's whole book) -- a different and correct value,
--     left alone. Verified after: that lane's median is unchanged at $498,431.
--   * Entity-anchored rows only. milestone_confirm (40) carries NO
--     subject_entity_id -- its deal reference is free text in context.deal_name
--     -- so it is honestly out of scope rather than guessed at.
--
-- ORDERING FOOTGUN (the reason for the wrapper): lcc_open_decision re-stamps
-- rank_value on every reseed (ON CONFLICT DO UPDATE SET rank_value = EXCLUDED).
-- So the sweep MUST run AFTER lcc_refresh_decisions(), never before, or the
-- producer immediately overwrites it back to 0. cron job 98 (lcc-decision-refresh,
-- every 15 min) was therefore repointed from lcc_refresh_decisions() to
-- lcc_refresh_and_rerank_decisions() so a caller cannot get the order wrong.
--
-- VERIFIED LIVE: 6 of 6 sf_link_conflict and 12 of 30 sf_link_collision now
-- ranked; re-run writes 0 rows (idempotent); P118 and P120 lane medians
-- unchanged; $366M of rent now visible across ranked lanes; open total 406.
--
-- REVERSAL:
--   SELECT cron.alter_job(98, command => 'SELECT public.lcc_refresh_decisions();');
--   UPDATE lcc_decisions SET rank_value = 0
--    WHERE status='open' AND decision_type IN ('sf_link_conflict','sf_link_collision','sf_contact_account_mismatch');
--   DROP FUNCTION lcc_refresh_and_rerank_decisions(), lcc_rerank_open_decisions(boolean), lcc_decision_entity_value(uuid);
-- ===========================================================================

-- The canonical value of an entity-anchored decision.
-- Dollars dominate; the tiers only separate rows that carry no rent figure.
CREATE OR REPLACE FUNCTION lcc_decision_entity_value(p_entity_id uuid)
RETURNS numeric
LANGUAGE sql STABLE
AS $fn$
  SELECT
    COALESCE((SELECT sum(f.annual_rent) FROM public.lcc_entity_portfolio_facts f
               WHERE f.entity_id = p_entity_id AND f.is_current), 0)
  + CASE WHEN EXISTS (SELECT 1 FROM public.bd_opportunities b
                       WHERE b.entity_id = p_entity_id AND b.is_open) THEN 5000 ELSE 0 END
  + CASE WHEN EXISTS (SELECT 1 FROM public.lcc_property_owner o
                       WHERE o.owner_entity_id = p_entity_id) THEN 1000 ELSE 0 END
  + CASE WHEN EXISTS (SELECT 1 FROM public.touchpoint_cadence t
                       WHERE t.entity_id = p_entity_id) THEN 100 ELSE 0 END
  + CASE WHEN EXISTS (SELECT 1 FROM public.external_identities x
                       WHERE x.entity_id = p_entity_id
                         AND lower(x.source_system) IN ('salesforce','sf')) THEN 10 ELSE 0 END
$fn$;

COMMENT ON FUNCTION lcc_decision_entity_value(uuid) IS
  'P121: the single definition of what an entity-anchored decision is worth (portfolio rent + open-opp/owns-assets/cadence/SF tiers). Any new value-ranked lane MUST call this rather than re-implementing it.';

-- Fill-blanks rerank of open, entity-anchored decisions.
CREATE OR REPLACE FUNCTION lcc_rerank_open_decisions(p_dry_run boolean DEFAULT true)
RETURNS TABLE(decision_type text, rows_considered bigint, rows_reranked bigint, rent_surfaced numeric)
LANGUAGE plpgsql
AS $fn$
#variable_conflict use_column
BEGIN
  CREATE TEMP TABLE _p121_plan ON COMMIT DROP AS
  SELECT d.id, d.decision_type::text AS decision_type,
         public.lcc_decision_entity_value(d.subject_entity_id) AS new_rank
  FROM public.lcc_decisions d
  WHERE d.status = 'open'
    AND d.subject_entity_id IS NOT NULL
    AND COALESCE(d.rank_value, 0) = 0;      -- FILL-BLANKS: never override a producer

  IF NOT p_dry_run THEN
    UPDATE public.lcc_decisions d
       SET rank_value = p.new_rank, updated_at = now()
      FROM _p121_plan p
     WHERE d.id = p.id AND p.new_rank > 0;
  END IF;

  RETURN QUERY
  SELECT p.decision_type, count(*)::bigint,
         count(*) FILTER (WHERE p.new_rank > 0)::bigint,
         COALESCE(sum(p.new_rank) FILTER (WHERE p.new_rank >= 1000), 0)
  FROM _p121_plan p
  GROUP BY p.decision_type
  ORDER BY 4 DESC;
END;
$fn$;

COMMENT ON FUNCTION lcc_rerank_open_decisions(boolean) IS
  'P121: stamp lcc_decision_entity_value onto open entity-anchored decisions whose rank is 0. Ordering only, fill-blanks. MUST run AFTER lcc_refresh_decisions() -- the producer re-stamps rank on reseed.';

-- Correct-order wrapper so a caller cannot reseed after reranking.
CREATE OR REPLACE FUNCTION lcc_refresh_and_rerank_decisions()
RETURNS TABLE(seeded_true_owner integer, seeded_buyer_parent integer,
              seeded_junk_entity integer, seeded_botblock integer,
              superseded integer, reranked bigint)
LANGUAGE plpgsql
AS $fn$
DECLARE r record; v_rr bigint := 0;
BEGIN
  SELECT * INTO r FROM public.lcc_refresh_decisions();
  SELECT COALESCE(sum(x.rows_reranked), 0) INTO v_rr
    FROM public.lcc_rerank_open_decisions(false) x;
  RETURN QUERY SELECT r.seeded_true_owner, r.seeded_buyer_parent, r.seeded_junk_entity,
                      r.seeded_botblock, r.superseded, v_rr;
END;
$fn$;

COMMENT ON FUNCTION lcc_refresh_and_rerank_decisions() IS
  'P121: refresh THEN rerank, in that order. Schedule this instead of lcc_refresh_decisions() alone.';

-- Repoint the 15-minute decision-refresh cron at the correct-order wrapper.
-- (Applied live; kept here so a rebuild reproduces it.)
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-decision-refresh') THEN
    PERFORM cron.alter_job(
      (SELECT jobid FROM cron.job WHERE jobname = 'lcc-decision-refresh'),
      command => 'SELECT public.lcc_refresh_and_rerank_decisions();');
  END IF;
END $cron$;
