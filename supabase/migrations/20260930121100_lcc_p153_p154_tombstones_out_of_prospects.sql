-- ============================================================================
-- P153 / P150b / P154 — merged-away entities were still being sold to.
-- Applied live to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-19.
-- ----------------------------------------------------------------------------
-- Started as a small cleanup (5 duplicate owner pairs differing only by a
-- leading article) and turned up a user-visible integrity defect: 30 entities
-- that had been MERGED AWAY were still appearing in Scott's seller-prospect
-- list carrying $38.6M, and 30 of the 45 stranded portfolio facts duplicated a
-- property the survivor already held -- so the book was DOUBLE-COUNTING $32.5M.
--
-- ── P153: the merge pass, widened ───────────────────────────────────────────
-- P150's pass used EXACT name equality and so missed article/punctuation
-- variants: The RMR Group / RMR Group · Rockwell Debt Free Properties /
-- Rockwell Debt-Free Properties · LOBO DA TERRA, LLC / LOBO DA TERRA LLC.
--
-- ⚠️ I described this to Scott as "5 pairs" and it merged **86** losers. The
-- grouping keys on the article/punctuation core and does NOT require the names
-- to differ, so exact-name duplicates were swept in as well. That is correct
-- behaviour -- all 86 were verified to share the core with their winner, and
-- the sample is plainly duplicates (106-108 Bayard Street Corp -> itself,
-- American Finance Trust -> itself) -- but it is 17x what I said, and the gate
-- I wrote only compared members[1] vs members[2], so it would not have caught a
-- bad THIRD member. Widen the gate before reusing this shape.
--
-- ── P150b: a one-hop repoint cannot cross a merge CHAIN ─────────────────────
-- P150a repointed owner evidence off tombstones with a single
-- merged_into_entity_id hop. 17 chains (A->B->C) were live, so the hop landed on
-- another tombstone. lcc_entity_survivor() follows to the terminal survivor,
-- hop-capped at 20.
--
-- ── P154: and the cap was load-bearing, because there was a CYCLE ───────────
-- Two entities named "The Corotto Company Inc" were merged INTO EACH OTHER.
-- Neither was a survivor, so nothing pointing at either could ever resolve, and
-- an uncapped follow-the-pointer loop would have hung.
--
-- I CREATED IT, and the root cause is the defect above:
--   07904b31 was tombstoned in MAY yet still appeared in v_lcc_top_seller_
--   prospects (the view never filtered merged entities). P153 therefore saw it
--   as a live prospect and merged the empty 01f920b9 into it -- closing the loop
--   back onto its own tombstone. Content decides the survivor: 07904b31 holds
--   17 edges, 3 identities, 2 facts and 2 evidence rows; 01f920b9 holds nothing.
--
-- **lcc_merge_entity has no cycle guard** -- it will merge an entity into
-- something that already points back at it. Flagged, not fixed here: it is a
-- core write path used by other surfaces (same reason P150a left the evidence
-- repoint out of it) and deserves its own change with its own gate.
--
-- ── ORDER OF OPERATIONS (the rule at the top of CLAUDE.md, applied) ─────────
-- Of the 45 stranded facts, 30 duplicated a property the survivor already had
-- and 15 ($6.1M) existed ONLY on the tombstone. Hiding first would have silently
-- dropped those 15. So: break the cycle -> MOVE the 15 -> repoint evidence ->
-- only THEN exclude tombstones from the view. Each step gated.
--
-- ⚠️ The PK on lcc_entity_portfolio_facts is (entity_id, source_domain,
-- source_property_id) with NO is_current. My first attempt guarded the move with
-- `not exists (... and g.is_current)` and hit 23505 on a NON-current row for the
-- same property. A uniqueness guard must mirror the actual key, not the rows you
-- happen to be thinking about.
--
-- LIVE RESULT: prospects 4,220 -> 4,120 · $3,847.4M -> $3,771.9M (the drop is
-- the double-count and the tombstones leaving, not lost pipeline) · needs a
-- contact 3,609 / $2,582.3M · tombstoned prospects 0 · evidence on tombstones 0
-- · merge cycles 0 · resolved owners 4,057 unchanged.
--
-- REVERSAL: P153/P154 merges are entities.merged_into_entity_id (set null to
--   unwind); moved facts and repointed evidence carry
--   detail->>'p150b_repointed_from'; the cycle break carries
--   metadata->>'p154_cycle_broken'; drop the `merged_into_entity_id is null`
--   clause to restore the view.
-- ============================================================================

-- ---- P150b: terminal-survivor resolver --------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_entity_survivor(p_id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE AS $$
declare cur uuid := p_id; nxt uuid; hops int := 0;
begin
  loop
    select merged_into_entity_id into nxt from public.entities where id = cur;
    exit when nxt is null;
    cur := nxt; hops := hops + 1;
    exit when hops > 20;   -- cycle guard: a mutually-merged pair must not hang
  end loop;
  return cur;
end $$;

COMMENT ON FUNCTION public.lcc_entity_survivor(uuid) IS
  'P150b. Follow entities.merged_into_entity_id to the TERMINAL survivor. A merge '
  'chain (A->B->C) defeats a one-hop repoint; 17 chains and one 2-CYCLE were live. '
  'Hop-capped at 20 so a cycle returns rather than hanging -- callers must still '
  'check whether the returned id is itself tombstoned.';

-- ---- P153: merge article/punctuation duplicates ------------------------------
DO $$
DECLARE grp record; v_win uuid; v_lose uuid; v_n int := 0;
BEGIN
  CREATE TEMPORARY TABLE _p153 ON COMMIT DROP AS
  WITH need AS (
    SELECT p.entity_id, p.owner_name, p.annual_rent, p.asset_count
      FROM v_lcc_top_seller_prospects p
     WHERE p.pursuit_status='needs a contact first'
  ), k AS (
    SELECT entity_id, owner_name, annual_rent, asset_count,
           lower(regexp_replace(regexp_replace(owner_name,'^\s*the\s+','','i'),'[^A-Za-z0-9]','','g')) ck
      FROM need
  )
  SELECT ck,
         (array_agg(entity_id ORDER BY asset_count DESC,
              (SELECT count(*) FROM entity_relationships er WHERE er.from_entity_id=k.entity_id) DESC,
              entity_id))[1] AS winner,
         array_agg(entity_id ORDER BY asset_count DESC,
              (SELECT count(*) FROM entity_relationships er WHERE er.from_entity_id=k.entity_id) DESC,
              entity_id) AS members
    FROM k
   WHERE length(ck) >= 6
   GROUP BY ck HAVING count(*) > 1;

  -- NB: compares only the first two members. Widen this before reuse.
  PERFORM 1 FROM _p153 g JOIN entities a ON a.id = g.members[1]
    JOIN entities b ON b.id = g.members[2]
   WHERE lower(regexp_replace(regexp_replace(a.name,'^\s*the\s+','','i'),'[^A-Za-z0-9]','','g'))
      <> lower(regexp_replace(regexp_replace(b.name,'^\s*the\s+','','i'),'[^A-Za-z0-9]','','g'));
  IF FOUND THEN RAISE EXCEPTION 'P153 gate: group members are not article/punctuation variants'; END IF;

  FOR grp IN SELECT * FROM _p153 LOOP
    v_win := grp.winner;
    FOREACH v_lose IN ARRAY grp.members LOOP
      IF v_lose <> v_win THEN
        PERFORM lcc_merge_entity(v_lose, v_win);
        v_n := v_n + 1;
      END IF;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'P153 merged % losers', v_n;
END $$;

-- ---- P154 step 1: break the merge CYCLE -------------------------------------
UPDATE public.entities
   SET merged_into_entity_id = null,
       metadata = coalesce(metadata,'{}'::jsonb)
               || jsonb_build_object('p154_cycle_broken','was mutually merged with '
                                     || '01f920b9-bf8f-4b97-b0ca-f866d7882ff6')
 WHERE id = '07904b31-9f76-4638-a48d-6d557489eb1d'
   AND merged_into_entity_id = '01f920b9-bf8f-4b97-b0ca-f866d7882ff6';

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.entities a JOIN public.entities b ON b.id=a.merged_into_entity_id
   WHERE b.merged_into_entity_id = a.id;
  IF n > 0 THEN RAISE EXCEPTION 'P154: % merge cycles remain', n; END IF;
END $$;

-- ---- P154 step 2: MOVE facts that exist ONLY on the tombstone ----------------
-- PK is (entity_id, source_domain, source_property_id) with NO is_current, so the
-- guard must NOT filter on is_current or a non-current row collides (23505).
UPDATE public.lcc_entity_portfolio_facts f
   SET entity_id = public.lcc_entity_survivor(f.entity_id)
  FROM public.entities e
 WHERE e.id = f.entity_id
   AND e.merged_into_entity_id IS NOT NULL
   AND f.is_current
   AND NOT EXISTS (
     SELECT 1 FROM public.lcc_entity_portfolio_facts g
      WHERE g.entity_id = public.lcc_entity_survivor(f.entity_id)
        AND g.source_domain = f.source_domain
        AND g.source_property_id = f.source_property_id);

-- ---- P154 step 3: evidence off tombstones, chain-resolved --------------------
DELETE FROM public.lcc_property_owner_evidence v USING public.entities l
 WHERE v.candidate_owner_entity = l.id
   AND l.merged_into_entity_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.lcc_property_owner_evidence w
                WHERE w.entity_id = v.entity_id
                  AND w.candidate_owner_entity = public.lcc_entity_survivor(l.id)
                  AND w.source = v.source);

UPDATE public.lcc_property_owner_evidence v
   SET candidate_owner_entity = public.lcc_entity_survivor(v.candidate_owner_entity),
       detail = coalesce(v.detail,'{}'::jsonb)
             || jsonb_build_object('p150b_repointed_from', v.candidate_owner_entity::text)
  FROM public.entities l
 WHERE v.candidate_owner_entity = l.id
   AND l.merged_into_entity_id IS NOT NULL;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.lcc_property_owner_evidence v
    JOIN public.entities e ON e.id = v.candidate_owner_entity
   WHERE e.merged_into_entity_id IS NOT NULL;
  IF n > 0 THEN RAISE EXCEPTION 'P154: % evidence rows still on tombstones', n; END IF;
END $$;

-- ---- P154 step 4: a tombstone is not a prospect ------------------------------
CREATE OR REPLACE VIEW public.v_lcc_top_seller_prospects AS
 WITH portfolio AS (
         SELECT f.entity_id,
            sum(f.annual_rent) AS annual_rent,
            count(*) AS asset_count,
            string_agg(DISTINCT f.source_domain, '/'::text ORDER BY f.source_domain) AS domains
           FROM lcc_entity_portfolio_facts f
          WHERE f.is_current
          GROUP BY f.entity_id
        )
 SELECT e.id AS entity_id,
    e.name AS owner_name,
    p.annual_rent,
    p.asset_count,
    p.domains,
    lcc_entity_cadence_reachable(e.id) AS reachable,
    COALESCE(e.email, ( SELECT x.email
           FROM entities x
             JOIN entity_relationships r ON r.to_entity_id = x.id
          WHERE r.from_entity_id = e.id AND x.email IS NOT NULL
         LIMIT 1)) AS contact_route,
    (EXISTS ( SELECT 1 FROM touchpoint_cadence t WHERE t.entity_id = e.id)) AS on_cadence,
    ( SELECT t.sf_contact_id FROM touchpoint_cadence t
       WHERE t.entity_id = e.id AND t.sf_contact_id IS NOT NULL LIMIT 1) AS sf_contact_id,
    ( SELECT count(*) AS count FROM lcc_property_owner o
       WHERE o.owner_entity_id = e.id) AS owned_assets_resolved,
        CASE
            WHEN (EXISTS ( SELECT 1 FROM touchpoint_cadence t WHERE t.entity_id = e.id)) THEN 'pursuing'::text
            WHEN lcc_entity_cadence_reachable(e.id) THEN 'READY — reachable, not pursued'::text
            ELSE 'needs a contact first'::text
        END AS pursuit_status
   FROM portfolio p
     JOIN entities e ON e.id = p.entity_id
  WHERE p.annual_rent > 0::numeric
    AND e.merged_into_entity_id IS NULL                     -- P154
    AND NOT lcc_owner_name_is_brokerage(e.name)
    AND NOT lcc_is_operator_owner_name(e.name)
    AND NOT lcc_owner_name_is_public_body(e.name)
    AND COALESCE(e.metadata ->> 'junk_name_flagged'::text, ''::text) <> 'true'::text;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.v_lcc_top_seller_prospects p
    JOIN public.entities e ON e.id = p.entity_id
   WHERE e.merged_into_entity_id IS NOT NULL;
  IF n > 0 THEN RAISE EXCEPTION 'P154: % tombstoned entities still in prospects', n; END IF;
END $$;
