-- ============================================================================
-- P160 — lcc_merge_entity: the defect flagged twice, finally closed.
-- Applied live to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-20.
-- ----------------------------------------------------------------------------
-- lcc_merge_entity delegates to lcc_reconcile_tombstone_backrefs, which moves
-- lcc_entity_portfolio_facts, external_identities, entity_relationships and
-- touchpoint_cadence. It does NOT move the OWNERSHIP tables. Measured live
-- before the fix:
--
--   lcc_property_owner.owner_entity_id -> tombstone     63   <- a DEAD OWNER on
--                                                              63 assets: the
--                                                              asset still shows
--                                                              an owner, and that
--                                                              owner no longer
--                                                              exists
--   owner_contact_pivot.entity_id      -> tombstone     99
--   entities merged INTO a tombstone (chains)           15
--   lcc_property_owner_evidence        -> tombstone      0   (cleaned by P150a/b)
--
-- Every merge LCC has ever run left this residue, and it is silent -- nothing
-- errors, nothing reports, the ownership just quietly points into the void.
-- This is why it was worth closing rather than patching the data a third time:
-- P150a cleaned the evidence, P154 cleaned the prospect view, and the function
-- kept re-creating the same class.
--
-- ⚠️ AND THERE WAS NO CYCLE GUARD -- proven the hard way the day before. P153
-- merged a live entity into its own May-2026 tombstone and produced a mutual
-- merge (A->B, B->A) in which NEITHER row was a survivor, so anything pointing
-- at either could never resolve. The one-hop follow used everywhere else cannot
-- detect that, and an uncapped follow-the-pointer loop hangs on it.
--
-- ── FIX ─────────────────────────────────────────────────────────────────────
-- 1. RESOLVE the winner to its terminal survivor before merging. A caller naming
--    a tombstone as the winner plainly means the surviving entity -- which is
--    exactly what P153 did -- so follow the chain rather than fail. This alone
--    makes the P153 accident impossible.
-- 2. REFUSE when that resolution lands back on the loser (a genuine cycle), and
--    REFUSE an already-tombstoned loser.
-- 3. REPOINT the backrefs the reconcile never touched, dedup-then-update so a PK
--    collision can never abort a merge midway:
--      lcc_property_owner           PK (entity_id)  -- BOTH FK columns
--      lcc_property_owner_evidence  PK (entity_id, candidate_owner_entity, source)
--      owner_contact_pivot          PK (entity_id)
--      bd_opportunities             (entity_id, no unique constraint on it)
--
-- The existing residue is cleaned in the same migration. Fixing the function
-- while leaving the 63 dead owners it already created would be half a job.
--
-- ── GATE (self-rolling-back, run live, 0 residue) ───────────────────────────
-- Synthetic loser/winner/asset with an owner row, an evidence row and a pivot:
--   1. all three backrefs repointed to the winner                     PASS
--   2. merging into a TOMBSTONE resolved to its survivor, no chain    PASS
--   3. a genuine cycle was REFUSED with a cycle-specific error        PASS
--   4. re-merging an already-tombstoned loser was REFUSED             PASS
-- Rolled back; 0 gate entities left behind.
--
-- LIVE AFTER: resolved owners on tombstones 63 -> 0, pivots 99 -> 0, evidence 0,
-- cycles 0. Prospects unchanged at 4,120.
--
-- REVERSAL: restore the prior two-statement body of lcc_merge_entity. The
-- backfill is not reversible per-row -- the tombstone linkage it repaired was
-- the only record of where each row pointed -- which is why it is gated.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_merge_entity(p_loser uuid, p_winner uuid)
 RETURNS TABLE(portfolio_edges_moved integer, external_identities_moved integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb;
  v_winner uuid;
BEGIN
  IF p_loser = p_winner THEN
    RAISE EXCEPTION 'lcc_merge_entity: loser and winner must differ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.entities WHERE id=p_winner) THEN
    RAISE EXCEPTION 'lcc_merge_entity: winner % does not exist', p_winner;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.entities WHERE id=p_loser) THEN
    RAISE EXCEPTION 'lcc_merge_entity: loser % does not exist', p_loser;
  END IF;

  -- P160: never merge an entity that is already merged away.
  IF EXISTS (SELECT 1 FROM public.entities WHERE id=p_loser AND merged_into_entity_id IS NOT NULL) THEN
    RAISE EXCEPTION 'lcc_merge_entity: loser % is already a tombstone', p_loser;
  END IF;

  -- P160: a caller naming a tombstone as the winner means the SURVIVOR.
  v_winner := public.lcc_entity_survivor(p_winner);

  IF v_winner = p_loser THEN
    RAISE EXCEPTION
      'lcc_merge_entity: refusing to create a merge cycle -- winner % resolves to the loser %',
      p_winner, p_loser;
  END IF;
  IF v_winner IS NULL OR EXISTS (SELECT 1 FROM public.entities
                                  WHERE id=v_winner AND merged_into_entity_id IS NOT NULL) THEN
    RAISE EXCEPTION 'lcc_merge_entity: winner % does not resolve to a live survivor', p_winner;
  END IF;

  v := public.lcc_reconcile_tombstone_backrefs(p_loser, v_winner, false);

  -- P160: ownership + BD backrefs the reconcile does not handle. Dedup, then move.
  DELETE FROM public.lcc_property_owner l
   WHERE l.entity_id = p_loser
     AND EXISTS (SELECT 1 FROM public.lcc_property_owner w WHERE w.entity_id = v_winner);
  UPDATE public.lcc_property_owner SET entity_id = v_winner WHERE entity_id = p_loser;
  UPDATE public.lcc_property_owner SET owner_entity_id = v_winner,
         owner_name = COALESCE((SELECT name FROM public.entities WHERE id=v_winner), owner_name)
   WHERE owner_entity_id = p_loser;

  DELETE FROM public.lcc_property_owner_evidence l
   WHERE l.candidate_owner_entity = p_loser
     AND EXISTS (SELECT 1 FROM public.lcc_property_owner_evidence w
                  WHERE w.entity_id = l.entity_id
                    AND w.candidate_owner_entity = v_winner
                    AND w.source = l.source);
  UPDATE public.lcc_property_owner_evidence SET candidate_owner_entity = v_winner
   WHERE candidate_owner_entity = p_loser;

  DELETE FROM public.lcc_property_owner_evidence l
   WHERE l.entity_id = p_loser
     AND EXISTS (SELECT 1 FROM public.lcc_property_owner_evidence w
                  WHERE w.entity_id = v_winner
                    AND w.candidate_owner_entity = l.candidate_owner_entity
                    AND w.source = l.source);
  UPDATE public.lcc_property_owner_evidence SET entity_id = v_winner WHERE entity_id = p_loser;

  DELETE FROM public.owner_contact_pivot l
   WHERE l.entity_id = p_loser
     AND EXISTS (SELECT 1 FROM public.owner_contact_pivot w WHERE w.entity_id = v_winner);
  UPDATE public.owner_contact_pivot SET entity_id = v_winner WHERE entity_id = p_loser;

  UPDATE public.bd_opportunities SET entity_id = v_winner WHERE entity_id = p_loser;

  UPDATE public.entities SET merged_into_entity_id=v_winner, updated_at=now() WHERE id=p_loser;

  portfolio_edges_moved     := (v->>'portfolio_edges_moved')::int;
  external_identities_moved := (v->>'external_identities_moved')::int;
  RETURN NEXT;
END;
$function$;

COMMENT ON FUNCTION public.lcc_merge_entity(uuid, uuid) IS
  'P160. Merge loser into winner. Resolves the winner to its TERMINAL survivor '
  '(a caller naming a tombstone means the survivor -- P153 did exactly that and '
  'created a mutual A->B/B->A merge in which neither row was a survivor), '
  'refuses a genuine cycle, refuses an already-tombstoned loser, and repoints '
  'the ownership/BD backrefs lcc_reconcile_tombstone_backrefs does not touch: '
  'lcc_property_owner (both FK columns), lcc_property_owner_evidence, '
  'owner_contact_pivot, bd_opportunities. Dedup-then-update so a PK collision '
  'cannot abort a merge.';

-- ---- clean the residue the old function already created ---------------------
UPDATE public.lcc_property_owner o
   SET owner_entity_id = public.lcc_entity_survivor(o.owner_entity_id),
       owner_name = COALESCE((SELECT name FROM public.entities
                               WHERE id = public.lcc_entity_survivor(o.owner_entity_id)), o.owner_name)
  FROM public.entities e
 WHERE e.id = o.owner_entity_id
   AND e.merged_into_entity_id IS NOT NULL
   AND public.lcc_entity_survivor(o.owner_entity_id) IS DISTINCT FROM o.owner_entity_id;

DELETE FROM public.owner_contact_pivot l
 USING public.entities e
 WHERE e.id = l.entity_id
   AND e.merged_into_entity_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.owner_contact_pivot w
                WHERE w.entity_id = public.lcc_entity_survivor(l.entity_id));

UPDATE public.owner_contact_pivot l
   SET entity_id = public.lcc_entity_survivor(l.entity_id)
  FROM public.entities e
 WHERE e.id = l.entity_id AND e.merged_into_entity_id IS NOT NULL;

DO $$
DECLARE n_owner int; n_pivot int; n_ev int; n_cycle int;
BEGIN
  SELECT count(*) INTO n_owner FROM public.lcc_property_owner o
    JOIN public.entities e ON e.id=o.owner_entity_id WHERE e.merged_into_entity_id IS NOT NULL;
  SELECT count(*) INTO n_pivot FROM public.owner_contact_pivot p
    JOIN public.entities e ON e.id=p.entity_id WHERE e.merged_into_entity_id IS NOT NULL;
  SELECT count(*) INTO n_ev FROM public.lcc_property_owner_evidence v
    JOIN public.entities e ON e.id=v.candidate_owner_entity WHERE e.merged_into_entity_id IS NOT NULL;
  SELECT count(*) INTO n_cycle FROM public.entities a
    JOIN public.entities b ON b.id=a.merged_into_entity_id WHERE b.merged_into_entity_id=a.id;

  IF n_owner > 0 THEN RAISE EXCEPTION 'P160 gate: % resolved owners still on tombstones', n_owner; END IF;
  IF n_pivot > 0 THEN RAISE EXCEPTION 'P160 gate: % contact pivots still on tombstones', n_pivot; END IF;
  IF n_ev    > 0 THEN RAISE EXCEPTION 'P160 gate: % evidence rows still on tombstones', n_ev; END IF;
  IF n_cycle > 0 THEN RAISE EXCEPTION 'P160 gate: % merge cycles present', n_cycle; END IF;
  RAISE NOTICE 'P160 ok: owner/pivot/evidence tombstone residue all zero, no cycles';
END $$;
