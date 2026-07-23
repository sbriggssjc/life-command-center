-- ============================================================================
-- ORE Build 2 — continuous owner-address reconcile (the connective tissue)
-- LCC Opps (xengecqvemvfknjvbvrq). Additive · reversible · guarded ·
-- reuse-not-fork · records-only (NEVER a silent merge).
-- ----------------------------------------------------------------------------
-- Build 1 (deed byte-capture) is live: deeds flow to text_extracted / deed_parsed
-- and the grantee-address propagation lands owner mailing addresses. Build 2 makes
-- every owner address that lands reconcile owners CONTINUOUSLY, so as the address
-- sources fill (Build 1's deed drain → recorded_owners.mailing_address; forward
-- deed/OM capture; ORE Phase A1 parcel-mailing; SF; Build 3's SOS), duplicate
-- owners collapse and contacts propagate automatically.
--
-- It COMPOSES the EXISTING multi-signal reconciliation engine (2026-07-16) — it
-- does NOT fork it. That engine already:
--   • reads `entities.address` into `lcc_owner_evidence` / `lcc_owner_evidence_cache`
--     (the `shared_mailing_address`=50 signal is ALREADY wired to the owner entity
--     address);
--   • clusters same-address candidates in `lcc_reconcile_owner` (the addr_key
--     discovery branch);
--   • draws the auto-merge-vs-review line at `match_threshold` (60): address(50)
--     + name_core(40) = 90 → same_party (auto-merge-eligible); a BARE shared
--     address (50) → review (never a silent merge) — exactly Scott's doctrine.
-- What Build 2 ADDS: (1) an owner-address DIMENSION + COVERAGE for observability +
-- as the feed substrate; (2) a SAFE continuous review SWEEP that RUNS the resolver
-- over owners whose SHARED-address evidence changed and RECORDS the verdicts
-- (review + auto-merge-eligible) to the evidence trace — records only, never
-- merges (the gated engine-drain owns consolidation); (3) a review-feed view.
--
-- ⚠️ GROUNDING (2026-07-23, live) refuted the task's Unit-1 premise: the domain
-- `recorded_owners.*address*` + SOS `entity_registry_records` are NOT reachable in
-- LCC — `lcc_property_owner_facts` is names-only, `lcc_owner_contact_signals`
-- exposes only a `has_reg_address` BOOLEAN (the Slice-1 PII posture), and
-- `entity_registry_records` is a gov-side table (0 rows in LCC). So the ONLY
-- owner-address source reachable in LCC today is `entities.address` (43 org rows;
-- 3 shared-address groups / 6 owners). Immediate yield is SMALL by construction
-- and grows as (a) CoStar captures more owner addresses onto entities and (b) a
-- gov/dia-blessed mirror extension surfaces the domain address STRING (the
-- documented gap — 302 owners carry has_reg_address in the signals mirror but the
-- string is not in LCC). This is the consume-as-produced engine, wired now.
--
-- REVERSAL: drop the views + the sweep fn + the state table (and unschedule the
-- cron migration's job) → zero trace. No existing object is mutated.
-- ============================================================================

-- ============================================================================
-- UNIT 1 — the unified owner-address DIMENSION (observability + feed substrate)
-- One row per (owner entity, normalized address, source, authority), normalized
-- through the EXISTING lcc_normalize_address. `matchable` marks a notice address
-- that feeds the same-address reconcile signal; `asset_location` is CONTEXT only
-- (an owner-AT-property signal, not a notice address) at a lower authority.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_lcc_owner_address_dimension AS
-- entity_capture: the org owner's OWN captured mailing / notice address (the
-- CoStar owner panel address, ORE Phase B+D). The one live matchable source.
SELECT
  e.id                                       AS owner_entity_id,
  e.name                                     AS owner_name,
  'entity_capture'::text                     AS source,
  50                                         AS authority,   -- mirrors shared_mailing_address weight
  true                                       AS matchable,   -- a notice address → same-address signal
  btrim(e.address)                           AS address_raw,
  public.lcc_normalize_address(e.address)    AS addr_norm,
  nullif(lower(btrim(e.city)), '')           AS city_key,
  nullif(upper(btrim(e.state)), '')          AS state_key
FROM public.entities e
WHERE e.entity_type = 'organization'
  AND e.merged_into_entity_id IS NULL
  AND public.lcc_normalize_address(e.address) IS NOT NULL
  AND public.lcc_owner_name_usable(e.name)
UNION ALL
-- asset_location: the owner's OWNED-asset location. CONTEXT only (an owner-at-
-- property signal, NOT a notice address) → matchable=false so it NEVER feeds the
-- same-address reconcile signal (the engine's same_asset path already handles
-- co-ownership). Lower authority. Reachable via the R17 owns→asset→attributes link.
SELECT
  e.id,
  e.name,
  'asset_location'::text,
  10,
  false,
  btrim(pa.address),
  public.lcc_normalize_address(pa.address),
  nullif(lower(btrim(pa.city)), ''),
  nullif(upper(btrim(pa.state)), '')
FROM public.entities e
JOIN public.entity_relationships r
  ON r.from_entity_id = e.id AND r.relationship_type = 'owns'
JOIN public.external_identities xi
  ON xi.entity_id = r.to_entity_id AND xi.source_type = 'asset'
JOIN public.lcc_property_attributes pa
  ON pa.source_domain = xi.source_system AND pa.source_property_id = xi.external_id
WHERE e.entity_type = 'organization'
  AND e.merged_into_entity_id IS NULL
  AND public.lcc_normalize_address(pa.address) IS NOT NULL
  AND public.lcc_owner_name_usable(e.name);

COMMENT ON VIEW public.v_lcc_owner_address_dimension IS
  'ORE Build 2: unified owner-address dimension — one row per (owner entity, normalized address, source, authority). entity_capture (matchable notice address, the live source) + asset_location (context, not matchable). Schema-ready for domain_mailing / sos_registry / salesforce sources once the mirror carries the address STRING (not reachable in LCC today — the signals mirror is boolean-only). Reversible.';

-- Fast, decoupled shared-address candidate source for the sweep — computed
-- DIRECTLY from the matchable org entity addresses (not through the full
-- dimension view, so the sweep's hot path never touches the asset-location leg).
-- `shared_addr_fingerprint` changes whenever the sharer set of any of the owner's
-- addresses changes (a new address lands OR a new co-owner of an existing address
-- appears) — the "reconcile the moment a shared address appears" trigger.
CREATE OR REPLACE VIEW public.v_lcc_owner_shared_address AS
WITH owner_addr AS (
  SELECT e.id AS owner_entity_id,
         public.lcc_normalize_address(e.address) AS addr_norm
  FROM public.entities e
  WHERE e.entity_type = 'organization'
    AND e.merged_into_entity_id IS NULL
    AND public.lcc_normalize_address(e.address) IS NOT NULL
    AND public.lcc_owner_name_usable(e.name)
),
grp AS (   -- addresses shared by >= 2 distinct owners
  SELECT addr_norm,
         array_agg(DISTINCT owner_entity_id ORDER BY owner_entity_id) AS owners
  FROM owner_addr
  GROUP BY addr_norm
  HAVING count(DISTINCT owner_entity_id) >= 2
),
owner_grp AS (
  SELECT og.owner_entity_id, g.addr_norm, g.owners
  FROM grp g
  CROSS JOIN LATERAL unnest(g.owners) AS og(owner_entity_id)
)
SELECT
  owner_entity_id,
  count(*) AS n_shared_addresses,
  md5(string_agg(addr_norm || '#' || array_to_string(owners, ','), '|'
                 ORDER BY addr_norm)) AS shared_addr_fingerprint
FROM owner_grp
GROUP BY owner_entity_id;

COMMENT ON VIEW public.v_lcc_owner_shared_address IS
  'ORE Build 2: owners that share a normalized notice address with >=1 other owner (the same-address reconcile candidate set). shared_addr_fingerprint changes when the sharer set changes → the fingerprint watermark re-reviews the owner. Fast (org entities.address only).';

-- One-row coverage / honesty view: how many owners carry a matchable address per
-- source, how many share one, AND the documented DOMAIN gap (owners whose
-- registered/notice address exists in the domain — has_reg_address — but whose
-- address STRING is not reachable in LCC; a gov/dia-blessed mirror extension would
-- surface it).
CREATE OR REPLACE VIEW public.v_lcc_owner_address_coverage AS
SELECT
  (SELECT count(DISTINCT owner_entity_id) FROM public.v_lcc_owner_address_dimension WHERE source = 'entity_capture')                 AS owners_entity_capture,
  (SELECT count(DISTINCT owner_entity_id) FROM public.v_lcc_owner_address_dimension WHERE source = 'asset_location')                 AS owners_asset_location,
  (SELECT count(DISTINCT addr_norm)       FROM public.v_lcc_owner_address_dimension WHERE matchable)                                 AS distinct_matchable_addresses,
  (SELECT count(*)                        FROM public.v_lcc_owner_shared_address)                                                    AS owners_in_shared_address,
  (SELECT count(*)                        FROM public.lcc_owner_contact_signals WHERE has_reg_address)                               AS owners_domain_addr_not_in_lcc;

COMMENT ON VIEW public.v_lcc_owner_address_coverage IS
  'ORE Build 2: owner-address coverage. owners_domain_addr_not_in_lcc = the DOCUMENTED gap — owners with a registered/notice address in the domain (signals mirror has_reg_address=true) whose address STRING is not reachable in LCC (boolean-only PII posture). Yield grows as this gap closes + CoStar captures more entity addresses.';

-- ============================================================================
-- UNIT 2 — the continuous REVIEW sweep (records only; NEVER merges)
-- ============================================================================

-- Per-owner watermark so the sweep is BOUNDED + RESUMABLE + no re-hammer: an owner
-- is (re)reviewed only when its shared-address fingerprint CHANGES (a new address /
-- new co-owner appeared) or its last review is stale.
CREATE TABLE IF NOT EXISTS public.lcc_owner_address_reconcile_state (
  entity_id                uuid PRIMARY KEY,
  shared_addr_fingerprint  text,
  reviewed_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.lcc_owner_address_reconcile_state IS
  'ORE Build 2: fingerprint watermark for the owner-address review sweep. Re-review an owner only when its shared_addr_fingerprint changes (a new shared address appeared) or after the staleness window. Reversible (drop → zero trace).';

-- The sweep: for each owner whose SHARED-address evidence changed, run the EXISTING
-- multi-signal resolver and RECORD the full verdict set to the evidence trace.
-- Records ONLY — the gated engine drain (lcc_merge_entity) owns consolidation, so
-- a bare shared-address match (review) is surfaced and never silently merged, and
-- an above-threshold same_party is recorded `auto_merge_eligible` (drain-ready) but
-- NOT merged here. Reuses lcc_reconcile_owner's existing verdict logic + threshold.
-- Bounded by p_limit; runs off v_lcc_owner_shared_address (tiny + fingerprint-gated).
CREATE OR REPLACE FUNCTION public.lcc_owner_address_reconcile_sweep(
  p_limit int DEFAULT 200,
  p_staleness interval DEFAULT interval '30 days')
RETURNS TABLE(owners_reviewed int, same_party_flagged int, review_flagged int,
              distinct_recorded int, evidence_written int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS
$$
DECLARE
  r record; p record;
  v_owners int := 0; v_same int := 0; v_rev int := 0; v_dist int := 0; v_ev int := 0;
  v_action text;
BEGIN
  FOR r IN
    SELECT s.owner_entity_id AS entity_id, s.shared_addr_fingerprint, s.n_shared_addresses
    FROM public.v_lcc_owner_shared_address s
    LEFT JOIN public.lcc_owner_address_reconcile_state st ON st.entity_id = s.owner_entity_id
    WHERE st.entity_id IS NULL
       OR st.shared_addr_fingerprint IS DISTINCT FROM s.shared_addr_fingerprint
       OR st.reviewed_at < now() - p_staleness
    ORDER BY s.n_shared_addresses DESC, s.owner_entity_id
    LIMIT greatest(1, least(coalesce(p_limit, 200), 1000))
  LOOP
    v_owners := v_owners + 1;
    FOR p IN SELECT * FROM public.lcc_reconcile_owner(r.entity_id) LOOP
      IF p.high_authority_conflict THEN
        v_action := 'none'; v_dist := v_dist + 1;
      ELSIF p.verdict = 'same_party' THEN
        -- above the bar (address + name-core, or another corroborating signal):
        -- record as drain-ready, NEVER merge here.
        v_action := 'auto_merge_eligible'; v_same := v_same + 1;
      ELSIF p.verdict = 'review' THEN
        -- a bare shared address (or below-threshold agreement) → the review lane.
        v_action := 'flagged_review'; v_rev := v_rev + 1;
      ELSE
        v_action := 'none'; v_dist := v_dist + 1;
      END IF;
      INSERT INTO public.lcc_owner_reconcile_evidence
        (entity_id, candidate_entity_id, verdict, weighted_score, threshold,
         agreeing_signals, high_authority_conflict, action, detail, created_at)
      VALUES
        (r.entity_id, p.candidate_entity_id, p.verdict, p.weighted_score, p.threshold,
         p.agreeing_signals, p.high_authority_conflict, v_action,
         jsonb_build_object('candidate_name', p.candidate_name,
                            'sweep', 'owner_address_reconcile',
                            'n_shared_addresses', r.n_shared_addresses),
         now());
      v_ev := v_ev + 1;
    END LOOP;
    INSERT INTO public.lcc_owner_address_reconcile_state (entity_id, shared_addr_fingerprint, reviewed_at)
    VALUES (r.entity_id, r.shared_addr_fingerprint, now())
    ON CONFLICT (entity_id) DO UPDATE
      SET shared_addr_fingerprint = EXCLUDED.shared_addr_fingerprint, reviewed_at = now();
  END LOOP;
  RETURN QUERY SELECT v_owners, v_same, v_rev, v_dist, v_ev;
END;
$$;

COMMENT ON FUNCTION public.lcc_owner_address_reconcile_sweep(int, interval) IS
  'ORE Build 2: continuous owner-address review sweep. Runs lcc_reconcile_owner over owners whose shared-address fingerprint changed and RECORDS the verdicts (auto_merge_eligible / flagged_review / none) to lcc_owner_reconcile_evidence — records ONLY, never merges (the gated engine drain owns consolidation). Bounded + resumable via the fingerprint watermark.';

-- Review feed: the address-driven review + auto-merge-eligible pairs, newest
-- first — the surface a future Decision-Center lane renders (records, not merges).
CREATE OR REPLACE VIEW public.v_lcc_owner_reconcile_review AS
SELECT
  ev.id,
  ev.entity_id,
  e1.name                    AS owner_name,
  ev.candidate_entity_id,
  e2.name                    AS candidate_name,
  ev.verdict,
  ev.weighted_score,
  ev.threshold,
  ev.action,
  ev.agreeing_signals,
  ev.high_authority_conflict,
  ev.detail,
  ev.created_at
FROM public.lcc_owner_reconcile_evidence ev
JOIN public.entities e1 ON e1.id = ev.entity_id AND e1.merged_into_entity_id IS NULL
LEFT JOIN public.entities e2 ON e2.id = ev.candidate_entity_id
WHERE ev.action IN ('flagged_review', 'auto_merge_eligible')
ORDER BY ev.created_at DESC;

COMMENT ON VIEW public.v_lcc_owner_reconcile_review IS
  'ORE Build 2: owner-reconcile review feed (flagged_review + auto_merge_eligible pairs), newest first — the surface a future Decision-Center lane renders. Records-only; a merge is the operator/gated-drain decision, never silent.';

-- Grants (mirror the sibling ORE artifacts).
GRANT SELECT ON
  public.v_lcc_owner_address_dimension,
  public.v_lcc_owner_shared_address,
  public.v_lcc_owner_address_coverage,
  public.v_lcc_owner_reconcile_review,
  public.lcc_owner_address_reconcile_state
  TO anon, authenticated, service_role;
GRANT INSERT, UPDATE ON public.lcc_owner_address_reconcile_state TO service_role;
GRANT EXECUTE ON FUNCTION public.lcc_owner_address_reconcile_sweep(int, interval)
  TO service_role;
