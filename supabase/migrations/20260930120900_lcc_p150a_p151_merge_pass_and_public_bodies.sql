-- ============================================================================
-- P150a / P151 — the merge pass Scott asked for, and public bodies out of the
-- prospect pipeline. Applied live to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-19.
-- ----------------------------------------------------------------------------
-- Scott, 2026-08-19, answering the two open questions:
--   "No, municipalities or states are not going to be prospects for us."
--   "Yes, let's take a merge pass because the one you pointed out should be the
--    same group."
--
-- ── THE MERGE PASS ───────────────────────────────────────────────────────────
-- 14 EXACT-name duplicate pairs in the tie lane, merged with lcc_merge_entity
-- (winner = the entity carrying more graph: edges + identities + portfolio
-- facts). Gd Davita Llc / Gd Da Vita Llc · JM Davita LLC / Jm Da Vita Llc ·
-- TBF Group Penn Hills LLC / T B F GROUP PENN HILLS L L C · Global Net Lease ×2
-- · Colliers ×2 · Rodney Hildebrandt ×2 · and 8 more.
--
-- ⚠️ EXACT names only, NOT strict-core. Strict core collapses
--     FSC FMC Carbondale IL DST  vs  FSC FMC Carbondale IL LLC
--     CINCINNATI DST PH          vs  PH Cincinnati LLC
-- and a DST is a genuinely DIFFERENT legal entity from the LLC in a 1031
-- structure. It also collapses "Siegel Sherwin Trust" onto "Sherwin Siegel" --
-- the person and their vehicle, which P144 is precisely about keeping apart.
--
-- ── P150a: THE MERGE DID NOT MOVE THE LANE, AND THAT WAS THE FINDING ─────────
-- The merges worked on their own terms (Colliers winner 275 -> 320 edges, loser
-- 45 -> 0 edges and 5 -> 0 identities) and the tie lane did not change at all:
-- still 14 duplicate groups, 130 ties, 0 new resolutions.
--
-- lcc_merge_entity delegates to lcc_reconcile_tombstone_backrefs and then stamps
-- entities.merged_into_entity_id. It reconciles portfolio, identities,
-- relationships and cadence -- NOT lcc_property_owner_evidence. A merged-away
-- entity therefore keeps competing as an owner candidate for ever.
--
-- THIS PREDATES TODAY: 2,274 tombstoned entities exist and 35 owner-evidence
-- rows still pointed at them; only 17 came from this pass. Every merge LCC has
-- ever done left this residue.
--
-- ⚠️ MY FIRST ATTEMPT AT THIS WAS A SILENT NO-OP. I keyed it on
-- metadata->>'lcc_merged_into' -- a marker I invented instead of looking up. The
-- real one is the COLUMN entities.merged_into_entity_id. The migration ran,
-- reported success, and changed nothing. Only the verification query caught it.
--
-- lcc_merge_entity should gain this step. Flagged, not done here: it is a core
-- write path used by other surfaces and deserves its own change and gate.
--
-- RESULT: evidence-on-tombstones 35 -> 0 · 22 repointed, 13 colliding duplicates
-- deleted · duplicate groups in the tie lane 14 -> 0 · ties 130 -> 129.
--
-- ── P151: PUBLIC BODIES ARE NOT PROSPECTS ───────────────────────────────────
-- 234 public bodies sat in v_lcc_top_seller_prospects carrying $87.2M, 232 of
-- them in 'needs a contact first' -- BD work that will never be worked, which is
-- the Consumption-Layer failure the doctrine exists to prevent.
--
-- Added as a NAMED exclusion beside the two the view already applies
-- (lcc_owner_name_is_brokerage, lcc_is_operator_owner_name).
--
-- ⚠️ MATCHES THE GOVERNMENTAL FORM, NOT THE WORD "CITY". A naive \mcity\M
-- catches private companies named after the places they sit in, and four were in
-- the first sample: Space Center Kansas City Inc · Oklahoma City Partners LLC ·
-- Salt Lake City Investments LLC · Jersey City Holdings LP. Gated 14/14 with
-- those as explicit negatives.
--
-- Ownership is UNAFFECTED -- a county genuinely owning a building stays in
-- lcc_property_owner. This removes them from the PROSPECT pipeline only.
--
-- LIVE: municipalities in prospects -> 0; the private city-named company that
-- exists in the data is retained.
--
-- REVERSAL: P150a repointed rows carry detail->>'p150_repointed_from' (deleted
-- collisions were exact duplicates of a surviving row and are not recoverable).
-- P151: drop the lcc_owner_name_is_public_body() clause from the view.
-- ============================================================================

-- ---- P150a -----------------------------------------------------------------
DELETE FROM public.lcc_property_owner_evidence v
 USING public.entities l
 WHERE v.candidate_owner_entity = l.id
   AND l.merged_into_entity_id IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM public.lcc_property_owner_evidence w
      WHERE w.entity_id = v.entity_id
        AND w.candidate_owner_entity = l.merged_into_entity_id
        AND w.source = v.source);

UPDATE public.lcc_property_owner_evidence v
   SET candidate_owner_entity = l.merged_into_entity_id,
       detail = coalesce(v.detail,'{}'::jsonb)
             || jsonb_build_object('p150_repointed_from', v.candidate_owner_entity::text)
  FROM public.entities l
 WHERE v.candidate_owner_entity = l.id
   AND l.merged_into_entity_id IS NOT NULL;

-- ---- P151 ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_owner_name_is_public_body(p_name text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  select coalesce(p_name,'') ~* '(\m(city|county|town|village|borough|parish)\s+(of|and)\M|,\s*(city|county|town)\s+of\M|^(city|county|state)\s+of\M|\mstate of\M|\mtax collector\M|\mschool district\M|county regional\M|\mmunicipal\M|\mport authority\M|\mtransit authority\M|\mhousing authority\M)';
$$;

COMMENT ON FUNCTION public.lcc_owner_name_is_public_body(text) IS
  'P151. Is this owner a municipality / state / public body? Scott: those are '
  'not seller prospects. Matches the governmental FORM ("City of X", "X, County '
  'Of", "State of X"), NOT the bare word "city" -- Space Center Kansas City Inc, '
  'Oklahoma City Partners LLC, Salt Lake City Investments LLC and Jersey City '
  'Holdings LP are private companies and must not match.';

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
    AND NOT lcc_owner_name_is_brokerage(e.name)
    AND NOT lcc_is_operator_owner_name(e.name)
    AND NOT lcc_owner_name_is_public_body(e.name)          -- P151
    AND COALESCE(e.metadata ->> 'junk_name_flagged'::text, ''::text) <> 'true'::text;
