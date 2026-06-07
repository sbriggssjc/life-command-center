-- ===========================================================================
-- entities.domain canonicalization (5th dia/gov alias-class fix)
-- Target DB: LCC Opps (xengecqvemvfknjvbvrq)
-- Date: 2026-06-07
--
-- Problem (grounded live 2026-06-07): public.entities.domain carried BOTH the
-- canonical short forms AND the long-form aliases:
--   gov 8,950 · dia 6,713 · government 871 · dialysis 142 · lcc 35 · NULL 1,293
-- The long-form rows are nearly all from the last 7 days; the writer is the
-- CoStar sidebar entity bridge (ensureEntityLink received classifyDomain()'s
-- long-form 'government'/'dialysis' and stored it verbatim). R4-A canonicalized
-- external_identities.source_system but entities.domain itself was never
-- normalized at the writer. This is the 5th instance of the alias class (after
-- getDomainCredentials, QA#9, E2E#5, R4-A).
--
-- Canonical scheme: entities.domain ∈ {dia, gov, lcc, NULL}.
--   - dialysis → dia, government → gov.
--   - 'lcc' is a LEGIT third value (LCC-internal entities, E2E#5 rule) — never
--      remapped.  NULL is left NULL.
--
-- Writer fix ships separately on the Railway redeploy (entity-link.js
-- canonicalEntityDomain at the ensureEntityLink choke point + domains.js +
-- entities-handler.js). The CHECK constraint is in a SEPARATE migration
-- (20260607171000) deferred to AFTER that redeploy — same deploy-ordering rule
-- as R4-A's 20260604121000.
--
-- Idempotent: re-running finds no long-form rows to dedup or flip.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Dedup cross-spelling duplicate twins BEFORE the relabel.
--    A long-form row ('dialysis'/'government') and a short-form row
--    ('dia'/'gov') can share the same (workspace_id, entity_type,
--    canonical_name) — the same concept fragmented across two spellings. Merge
--    the long-form (newer, last-7-days artifact) loser INTO the short-form
--    (established) winner via lcc_merge_entity (the canonical direction: newer
--    artifact → established entity). lcc_merge_entity moves portfolio_facts +
--    external_identities and tombstones the loser (merged_into_entity_id); it
--    does NOT touch lcc_developer_classification_log, so we repoint that ledger
--    explicitly here. Live audit 2026-06-07: ~17 such pairs.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r           RECORD;
  v_merged    int := 0;
  v_log_moved int := 0;
  v_anoms     int := 0;
  v_has_log   boolean := to_regclass('public.lcc_developer_classification_log') IS NOT NULL;
BEGIN
  FOR r IN
    WITH norm AS (
      SELECT id, workspace_id, entity_type, canonical_name, domain, created_at,
             CASE WHEN lower(domain) = 'dialysis'   THEN 'dia'
                  WHEN lower(domain) = 'government' THEN 'gov'
                  ELSE lower(domain) END AS canon_domain
      FROM public.entities
      WHERE lower(domain) IN ('dia','gov','dialysis','government')
        AND canonical_name IS NOT NULL AND canonical_name <> ''
        AND merged_into_entity_id IS NULL
    ),
    pairs AS (
      SELECT lo.id          AS loser_id,
             lo.created_at   AS loser_created,
             lo.domain       AS loser_domain,
             wi.id           AS winner_id,
             wi.created_at   AS winner_created,
             lo.canonical_name, lo.entity_type, lo.canon_domain
      FROM norm lo
      JOIN norm wi
        ON  wi.workspace_id  = lo.workspace_id
        AND wi.entity_type   = lo.entity_type
        AND wi.canonical_name = lo.canonical_name
        AND wi.canon_domain  = lo.canon_domain
      WHERE lower(lo.domain) IN ('dialysis','government')   -- loser = long-form
        AND lower(wi.domain) IN ('dia','gov')               -- winner = short-form
    )
    -- One winner per loser: the OLDEST short-form twin.
    SELECT DISTINCT ON (loser_id)
           loser_id, winner_id, canonical_name, entity_type, canon_domain,
           loser_created, winner_created
    FROM pairs
    WHERE loser_id <> winner_id
    ORDER BY loser_id, winner_created NULLS LAST, winner_id
  LOOP
    -- Anomaly report: established direction expects the short-form winner to be
    -- the OLDER row. Warn (don't skip) when it isn't, for human review.
    IF r.winner_created IS NOT NULL AND r.loser_created IS NOT NULL
       AND r.winner_created > r.loser_created THEN
      v_anoms := v_anoms + 1;
      RAISE WARNING '[entities-domain-dedup] ANOMALY: short-form winner % is NEWER than long-form loser % (canonical_name=%, type=%, domain=%)',
        r.winner_id, r.loser_id, r.canonical_name, r.entity_type, r.canon_domain;
    END IF;

    PERFORM public.lcc_merge_entity(r.loser_id, r.winner_id);
    v_merged := v_merged + 1;
    RAISE NOTICE '[entities-domain-dedup] merged loser % -> winner % (canonical_name=%, type=%, domain=%)',
      r.loser_id, r.winner_id, r.canonical_name, r.entity_type, r.canon_domain;

    -- Repoint the classification ledger the merge function does not touch.
    IF v_has_log THEN
      UPDATE public.lcc_developer_classification_log
      SET entity_id = r.winner_id
      WHERE entity_id = r.loser_id;
      GET DIAGNOSTICS v_log_moved = ROW_COUNT;
    END IF;
  END LOOP;

  RAISE NOTICE '[entities-domain-dedup] done: % pairs merged, % classification-log rows repointed, % anomalies flagged',
    v_merged, v_log_moved, v_anoms;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Flip every remaining long-form domain to the canonical short form. This
--    INCLUDES tombstoned merge losers (merged_into_entity_id set) so that NO
--    long-form spelling survives anywhere — the CHECK constraint (separate
--    migration) applies to every row. 'lcc' and NULL are untouched.
-- ---------------------------------------------------------------------------
UPDATE public.entities
SET domain = 'dia', updated_at = now()
WHERE lower(domain) = 'dialysis';

UPDATE public.entities
SET domain = 'gov', updated_at = now()
WHERE lower(domain) = 'government';

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification (run manually after apply):
--   SELECT domain, count(*) FROM entities GROUP BY 1 ORDER BY 2 DESC;
--   -- expect ONLY dia / gov / lcc / NULL (no 'dialysis' / 'government')
-- ---------------------------------------------------------------------------
