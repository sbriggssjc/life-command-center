-- ============================================================================
-- W2.4 — mirror null-semantics + listing-event retraction regression proofs
--
-- Target: LCC Opps (OPS_SUPABASE_URL, ref xengecqvemvfknjvbvrq)
--
-- Re-runnable, self-asserting, 0-residue proofs that the DECLARED null model of
-- each mirror leg (audit 3.3.6) and the listing-event retraction (3.3.9) hold
-- through one apply/sync cycle. Each gate runs as one DO block: any failed
-- assertion RAISEs and rolls the whole block back (synthetic rows never
-- persist); on success the block deletes its own synthetic rows. All synthetic
-- keys are prefixed zz_w24_ / the reserved 1111…/2222… UUIDs.
--
--   Gate A  lcc_property_attributes  = FILL-BLANKS + cleared-field TOMBSTONE
--   Gate B  lcc_property_owner_facts = LAST-WRITER-WINS including NULLs
--   Gate C  lcc_listing_events       = INSERT-ONLY + retraction EXCLUDES a
--           retracted event from the buyer-SPE / P-BUYER classifiers + queue,
--           plus a structural guard that every consumer view carries the filter.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Gate A — lcc_property_attributes FILL-BLANKS + TOMBSTONE
-- ---------------------------------------------------------------------------
DO $ga$
DECLARE v_yb int; v_city text; v_log int;
BEGIN
  INSERT INTO public.lcc_property_attributes
    (source_domain, source_property_id, asset_class, city, year_built, updated_at)
  VALUES ('gov','zz_w24_pa1','government','OldCity',1990, now());

  -- FILL-BLANKS: a page missing year_built must NOT clobber it; a present city updates.
  PERFORM public.lcc_apply_property_attributes_page('gov',
    '[{"property_id":"zz_w24_pa1","city":"NewCity"}]'::jsonb);
  SELECT year_built, city INTO v_yb, v_city
    FROM public.lcc_property_attributes WHERE source_domain='gov' AND source_property_id='zz_w24_pa1';
  IF v_yb IS DISTINCT FROM 1990 THEN
    RAISE EXCEPTION 'A FAIL (fill-blanks): source NULL clobbered year_built -> %', v_yb; END IF;
  IF v_city IS DISTINCT FROM 'NewCity' THEN
    RAISE EXCEPTION 'A FAIL (fill-blanks): present value did not update city -> %', v_city; END IF;

  -- TOMBSTONE: a deliberate operator field-clear (decision=cleared) must null the
  -- mirror value past the fill-blanks COALESCE.
  INSERT INTO public.field_provenance
    (target_database, target_table, record_pk_value, field_name, decision, source, recorded_at)
  VALUES ('gov_db','gov.properties','zz_w24_pa1','year_built','cleared','w24_selftest', now());
  PERFORM public.lcc_apply_cleared_tombstones(false, ARRAY['gov']);
  SELECT year_built INTO v_yb FROM public.lcc_property_attributes
    WHERE source_domain='gov' AND source_property_id='zz_w24_pa1';
  SELECT count(*) INTO v_log FROM public.lcc_property_attributes_tombstone_log
    WHERE source_domain='gov' AND source_property_id='zz_w24_pa1' AND mirror_column='year_built';
  IF v_yb IS NOT NULL THEN
    RAISE EXCEPTION 'A FAIL (tombstone): cleared field not nulled -> %', v_yb; END IF;
  IF v_log < 1 THEN
    RAISE EXCEPTION 'A FAIL (tombstone): no reversible log row written'; END IF;

  DELETE FROM public.lcc_property_attributes_tombstone_log WHERE source_property_id='zz_w24_pa1';
  DELETE FROM public.field_provenance WHERE source='w24_selftest';
  DELETE FROM public.lcc_property_attributes WHERE source_property_id='zz_w24_pa1';
  RAISE NOTICE 'Gate A PASS: property_attributes fill-blanks + tombstone';
END $ga$;

-- ---------------------------------------------------------------------------
-- Gate B — lcc_property_owner_facts LAST-WRITER-WINS including NULLs
-- ---------------------------------------------------------------------------
DO $gb$
DECLARE v_owner text;
BEGIN
  INSERT INTO public.lcc_property_owner_facts
    (source_domain, source_property_id, true_owner_name, updated_at)
  VALUES ('gov','zz_w24_of1','OldOwner', now());

  -- LWW incl NULL: a page missing true_owner_name OVERWRITES it to null
  -- (the opposite of fill-blanks — this is the intended owner-facts model).
  PERFORM public.lcc_apply_property_owner_facts_page('gov',
    '[{"property_id":"zz_w24_of1"}]'::jsonb);
  SELECT true_owner_name INTO v_owner FROM public.lcc_property_owner_facts
    WHERE source_domain='gov' AND source_property_id='zz_w24_of1';
  IF v_owner IS NOT NULL THEN
    RAISE EXCEPTION 'B FAIL (LWW): source NULL did not overwrite (fill-blanks leak) -> %', v_owner; END IF;

  -- and a present value wins.
  PERFORM public.lcc_apply_property_owner_facts_page('gov',
    '[{"property_id":"zz_w24_of1","true_owner_name":"NewOwner"}]'::jsonb);
  SELECT true_owner_name INTO v_owner FROM public.lcc_property_owner_facts
    WHERE source_domain='gov' AND source_property_id='zz_w24_of1';
  IF v_owner IS DISTINCT FROM 'NewOwner' THEN
    RAISE EXCEPTION 'B FAIL (LWW): present value did not win -> %', v_owner; END IF;

  DELETE FROM public.lcc_property_owner_facts WHERE source_property_id='zz_w24_of1';
  RAISE NOTICE 'Gate B PASS: owner_facts last-writer-wins incl. NULL';
END $gb$;

-- ---------------------------------------------------------------------------
-- Gate C — lcc_listing_events retraction EXCLUDES from the P-BUYER classifiers
-- ---------------------------------------------------------------------------
DO $gc$
DECLARE
  v_ws uuid; v_child uuid := '11111111-1111-1111-1111-1111111111e1';
  v_parent uuid := '22222222-2222-2222-2222-2222222222f2';
  v_spe int; v_canon int; v_queue int; v_missing int;
BEGIN
  SELECT id INTO v_ws FROM public.workspaces LIMIT 1;

  INSERT INTO public.entities (id, workspace_id, entity_type, name, canonical_name, developer_flag_sources)
  VALUES (v_parent, v_ws, 'organization', 'ZZ W24 Parent', 'zz w24 parent', '{}'),
         (v_child,  v_ws, 'organization', 'ZZ W24 Child',  'zz w24 child',  '{}');
  INSERT INTO public.lcc_operator_affiliate_patterns (parent_entity_id, pattern_name, pattern_type, relationship)
  VALUES (v_parent, 'zzw24buyer', 'exact', 'buyer_parent');
  INSERT INTO public.lcc_entity_portfolio_facts (entity_id, source_domain, source_property_id, updated_at)
  VALUES (v_child, 'gov', 'zz_w24_le1', now());
  INSERT INTO public.lcc_listing_events
    (source_domain, source_event_type, source_event_id, source_property_id, event_date, buyer_name, seller_name)
  VALUES ('gov','sale','zz_w24_le1_evt','zz_w24_le1', CURRENT_DATE, 'zzw24buyer', 'zzw24seller');

  -- BEFORE retraction: the event feeds the empirical_portfolio SPE tier, the
  -- canonical-buyer map, and the operator queue.
  SELECT count(*) INTO v_spe FROM public.v_lcc_buyer_spe_entities_live
    WHERE entity_id=v_child AND parent_entity_id=v_parent AND match_tier='empirical_portfolio';
  SELECT count(*) INTO v_canon FROM public.v_lcc_buyer_name_canonical
    WHERE raw_buyer_name='zzw24buyer' AND parent_entity_id=v_parent;
  SELECT count(*) INTO v_queue FROM public.v_lcc_listing_event_queue WHERE source_event_id='zz_w24_le1_evt';
  IF v_spe < 1 THEN RAISE EXCEPTION 'C setup FAIL: event not in empirical SPE tier before retraction'; END IF;
  IF v_canon < 1 THEN RAISE EXCEPTION 'C setup FAIL: event not in buyer_name_canonical before retraction'; END IF;
  IF v_queue < 1 THEN RAISE EXCEPTION 'C setup FAIL: event not in listing_event_queue before retraction'; END IF;

  -- RETRACT
  UPDATE public.lcc_listing_events SET retracted_at = now(), retracted_reason='source_not_live'
    WHERE source_event_id='zz_w24_le1_evt';

  -- AFTER: excluded from all three consumers.
  SELECT count(*) INTO v_spe FROM public.v_lcc_buyer_spe_entities_live
    WHERE entity_id=v_child AND parent_entity_id=v_parent AND match_tier='empirical_portfolio';
  SELECT count(*) INTO v_canon FROM public.v_lcc_buyer_name_canonical
    WHERE raw_buyer_name='zzw24buyer' AND parent_entity_id=v_parent;
  SELECT count(*) INTO v_queue FROM public.v_lcc_listing_event_queue WHERE source_event_id='zz_w24_le1_evt';
  IF v_spe <> 0 THEN RAISE EXCEPTION 'C FAIL: retracted event still in empirical SPE tier (P-BUYER pool)'; END IF;
  IF v_canon <> 0 THEN RAISE EXCEPTION 'C FAIL: retracted event still in buyer_name_canonical'; END IF;
  IF v_queue <> 0 THEN RAISE EXCEPTION 'C FAIL: retracted event still in listing_event_queue'; END IF;

  -- STRUCTURAL guard: every live consumer view must carry the retracted filter,
  -- so a future re-create can't silently drop it.
  SELECT count(*) INTO v_missing FROM (VALUES
      ('v_lcc_buyer_spe_entities_live'),('v_lcc_entity_tier0_parent'),
      ('v_lcc_buyer_name_canonical'),('v_lcc_listing_event_queue')
    ) AS v(name)
   WHERE pg_get_viewdef(('public.'||v.name)::regclass, true) NOT ILIKE '%retracted_at%';
  IF v_missing <> 0 THEN
    RAISE EXCEPTION 'C FAIL (structural): % consumer view(s) missing the retracted_at filter', v_missing; END IF;

  DELETE FROM public.lcc_listing_events WHERE source_event_id='zz_w24_le1_evt';
  DELETE FROM public.lcc_entity_portfolio_facts WHERE source_property_id='zz_w24_le1';
  DELETE FROM public.lcc_operator_affiliate_patterns WHERE pattern_name='zzw24buyer';
  DELETE FROM public.entities WHERE id IN (v_child, v_parent);
  RAISE NOTICE 'Gate C PASS: listing_events retraction excludes from P-BUYER classifiers + queue';
END $gc$;

-- All three gates PASS + self-clean ⇒ 0 residue.
