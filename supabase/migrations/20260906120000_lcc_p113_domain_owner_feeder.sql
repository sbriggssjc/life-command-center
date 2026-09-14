-- ============================================================================
-- Prompt 113 / BREAK-3 — owner-resolution feeder: domain true_owner -> evidence
-- ============================================================================
--
-- BASELINE (LCC Opps, 2026-08-15, §3.2 leg-1 of panel-redesign-verification.md):
--   assets 3,886 | with a reconciled owner 1,396 (35.9%) | owner entities 690
--
-- WHERE THE 2,490 UNRESOLVED ASSETS ACTUALLY ARE (measured, not assumed):
--   1,699  have a DOMAIN owner (dia/gov properties.true_owner_id) that never
--          became lcc_property_owner_evidence            <- THIS MIGRATION
--     876  already have evidence but fail the 0.55 confidence gate because the
--          resolver scores an ownership CHAIN as competing claims  <- reported,
--          NOT changed here (see the note at the foot of this file)
--     634  have neither
--
-- WHAT THIS IS. P0.3 from property-tab-ux-review.md Part 4, built as the brief
-- suspected: "the likely gap is promotion, not capture". No new external data is
-- acquired. The domain DBs already hold the owner; LCC already mirrors the
-- property; the only missing link was the owner's IDENTITY.
--
-- WHY BY ID, NOT BY NAME. The companion domain migrations
-- (supabase/migrations/{government,dialysis}/20260906120000_*_owner_facts_portfolio_ids.sql)
-- append true_owner_id / true_owner_effective_id to v_property_owner_facts_portfolio,
-- so the candidate owner is resolved through the canonical identity scheme
--   external_identities(source_system=<dia|gov>, source_type='true_owner',
--                       external_id = true_owners.true_owner_id)
-- and NEVER by matching an owner name. This is deliberate: CLAUDE.md records that
-- name cores are for FUZZY PAIRING and are catastrophic for IDENTITY ("Realty
-- Income Corporation" reduces to the empty string and fails to match itself;
-- "Agree Realty Corp" and "Agree Holdings LLC" both score 1.0). Going through
-- external_identities also means the join follows entity merges for free -- 227 of
-- the 15,481 domain-owner identities already point at a merge SURVIVOR whose id
-- differs from the original true_owner_id.
--
-- THE OPERATOR TRAP (the reason this feeder is guarded, not a plain INSERT..SELECT).
-- dia conflates the OPERATOR with the owner at scale. On the currently-unresolved
-- assets the top domain owner names are "DaVita Inc." (348), "Fresenius Medical
-- Care" (334), "DaVita Kidney Care" (67), "U.S. Renal Care" (31) -- the TENANT, not
-- the landlord. Promoting those would stamp the operator as the building owner on
-- hundreds of assets, which is exactly what the P0.1 display guard exists to stop.
-- The guard here reads the SAME flag that guard reads
-- (dia.true_owners.is_operator_not_owner, surfaced as own.true_owner_is_operator in
-- detail.js) rather than inventing a second, drifting definition.
--
-- DISCIPLINE: additive - fill-blanks-only (an asset that already has a resolved
-- owner is never touched) - conservative/unambiguous (two competing candidates ->
-- review lane, never a guess) - authority-ladder-aware - provenance-tagged -
-- reversible by batch tag - idempotent - DRY-RUN BY DEFAULT.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- PART 1 — mirror the owner IDs (+ the operator flag) into LCC
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.lcc_property_owner_facts
  ADD COLUMN IF NOT EXISTS recorded_owner_id       uuid,
  ADD COLUMN IF NOT EXISTS true_owner_id           uuid,
  ADD COLUMN IF NOT EXISTS true_owner_effective_id uuid,
  ADD COLUMN IF NOT EXISTS true_owner_is_operator  boolean;

COMMENT ON COLUMN public.lcc_property_owner_facts.true_owner_effective_id IS
  'Domain true_owner_id with one merge hop applied (COALESCE(merged_into_true_owner_id, true_owner_id)). Join to external_identities(source_system=source_domain, source_type=''true_owner'', external_id=<this>::text) to get the LCC owner entity.';
COMMENT ON COLUMN public.lcc_property_owner_facts.true_owner_is_operator IS
  'dia only (gov is always false): the domain true_owner is the OPERATOR/tenant, not the landlord. Same flag the P0.1 property-panel display guard reads. Never promote one of these to owner.';

CREATE INDEX IF NOT EXISTS idx_lcc_pof_true_owner_effective
  ON public.lcc_property_owner_facts (true_owner_effective_id)
  WHERE true_owner_effective_id IS NOT NULL;


-- Apply-page: map the four new keys. Unchanged behaviour for every existing key.
CREATE OR REPLACE FUNCTION public.lcc_apply_property_owner_facts_page(p_domain text, p_content jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_applied int := 0;
BEGIN
  WITH rows AS (SELECT jsonb_array_elements(p_content) AS row),
  up AS (
    INSERT INTO public.lcc_property_owner_facts (
      source_domain, source_property_id, recorded_owner_name, true_owner_name, developer_name,
      recorded_owner_id, true_owner_id, true_owner_effective_id, true_owner_is_operator,
      source_updated_at, updated_at)
    SELECT p_domain, (row->>'property_id')::text,
      NULLIF(row->>'recorded_owner_name',''), NULLIF(row->>'true_owner_name',''),
      NULLIF(row->>'developer_name',''),
      NULLIF(row->>'recorded_owner_id','')::uuid,
      NULLIF(row->>'true_owner_id','')::uuid,
      NULLIF(row->>'true_owner_effective_id','')::uuid,
      (row->>'true_owner_is_operator')::boolean,
      NULLIF(row->>'updated_at','')::timestamptz, now()
    FROM rows WHERE row->>'property_id' IS NOT NULL
    ON CONFLICT (source_domain, source_property_id) DO UPDATE SET
      recorded_owner_name=EXCLUDED.recorded_owner_name,
      true_owner_name=EXCLUDED.true_owner_name,
      developer_name=EXCLUDED.developer_name,
      recorded_owner_id=EXCLUDED.recorded_owner_id,
      true_owner_id=EXCLUDED.true_owner_id,
      true_owner_effective_id=EXCLUDED.true_owner_effective_id,
      true_owner_is_operator=EXCLUDED.true_owner_is_operator,
      source_updated_at=EXCLUDED.source_updated_at, updated_at=now()
    WHERE public.lcc_property_owner_facts.source_updated_at IS NULL
       OR EXCLUDED.source_updated_at IS NULL
       OR EXCLUDED.source_updated_at >= public.lcc_property_owner_facts.source_updated_at
    RETURNING 1)
  SELECT count(*) INTO v_applied FROM up;
  RETURN v_applied;
END $function$;


-- Bulk backfill pair (fires every page at once; used for the one-time re-walk that
-- populates the new columns -- the incremental mirror_tick below only re-pulls rows
-- whose source updated_at moved, so it would take weeks to fill them on its own).
CREATE OR REPLACE FUNCTION public.lcc_sync_property_owner_facts(p_domain text DEFAULT 'both'::text)
 RETURNS TABLE(domain text, pages_fired integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_url text; v_anon_key text; v_page int; v_request_id bigint;
  v_pages_fired int; v_domain text; v_domains text[]; v_max_pages int; v_page_size int;
BEGIN
  IF p_domain = 'both' THEN v_domains := ARRAY['gov','dia']; ELSE v_domains := ARRAY[p_domain]; END IF;

  FOREACH v_domain IN ARRAY v_domains LOOP
    IF v_domain NOT IN ('gov','dia') THEN
      RAISE NOTICE 'lcc_sync_property_owner_facts(%): unknown domain, skipping', v_domain; CONTINUE;
    END IF;

    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = v_domain || '_supabase_url';
    SELECT decrypted_secret INTO v_anon_key FROM vault.decrypted_secrets WHERE name = v_domain || '_supabase_anon_key';
    IF v_url IS NULL OR v_anon_key IS NULL THEN
      RAISE NOTICE 'lcc_sync_property_owner_facts(%): missing vault secret, skipping', v_domain; CONTINUE;
    END IF;

    -- PostgREST caps every response at 1000 rows regardless of `limit`, so the
    -- stride MUST stay 1000 -- a larger one silently SKIPS rows (CLAUDE.md).
    v_page_size := 1000;
    IF v_domain = 'gov' THEN v_max_pages := 24; ELSE v_max_pages := 16; END IF;

    v_pages_fired := 0;
    FOR v_page IN 0..v_max_pages LOOP
      SELECT net.http_get(
        url := v_url || '/rest/v1/v_property_owner_facts_portfolio'
          || '?select=property_id,recorded_owner_name,true_owner_name,developer_name,updated_at,'
          || 'recorded_owner_id,true_owner_id,true_owner_effective_id,true_owner_is_operator'
          || '&order=property_id.asc'
          || '&limit=' || v_page_size || '&offset=' || (v_page * v_page_size),
        headers := jsonb_build_object('apikey', v_anon_key, 'Authorization', 'Bearer ' || v_anon_key)
      ) INTO v_request_id;

      INSERT INTO public.lcc_owner_facts_sync_inflight (request_id, source_domain, page_offset)
      VALUES (v_request_id, v_domain, v_page * v_page_size);
      v_pages_fired := v_pages_fired + 1;
    END LOOP;

    domain := v_domain; pages_fired := v_pages_fired; RETURN NEXT;
  END LOOP;
END;
$function$;


CREATE OR REPLACE FUNCTION public.lcc_finalize_property_owner_facts()
 RETURNS TABLE(domain text, finalized_requests integer, rows_upserted integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_domains text[]; v_domain text; v_finalized int; v_upserted int;
BEGIN
  SELECT array_agg(DISTINCT source_domain) INTO v_domains FROM public.lcc_owner_facts_sync_inflight;
  IF v_domains IS NULL THEN v_domains := ARRAY[]::text[]; END IF;

  FOREACH v_domain IN ARRAY v_domains LOOP
    WITH consumed AS (
      SELECT i.request_id, r.content
      FROM public.lcc_owner_facts_sync_inflight i
      JOIN net._http_response r ON r.id = i.request_id
      WHERE i.source_domain = v_domain AND r.status_code = 200
    ),
    rows AS (SELECT jsonb_array_elements(content::jsonb) AS row FROM consumed),
    upsert AS (
      INSERT INTO public.lcc_property_owner_facts (
        source_domain, source_property_id, recorded_owner_name, true_owner_name, developer_name,
        recorded_owner_id, true_owner_id, true_owner_effective_id, true_owner_is_operator, updated_at)
      SELECT v_domain, (row->>'property_id')::text,
        NULLIF(row->>'recorded_owner_name',''), NULLIF(row->>'true_owner_name',''),
        NULLIF(row->>'developer_name',''),
        NULLIF(row->>'recorded_owner_id','')::uuid,
        NULLIF(row->>'true_owner_id','')::uuid,
        NULLIF(row->>'true_owner_effective_id','')::uuid,
        (row->>'true_owner_is_operator')::boolean,
        now()
      FROM rows WHERE row->>'property_id' IS NOT NULL
      ON CONFLICT (source_domain, source_property_id) DO UPDATE SET
        recorded_owner_name = EXCLUDED.recorded_owner_name,
        true_owner_name     = EXCLUDED.true_owner_name,
        developer_name      = EXCLUDED.developer_name,
        recorded_owner_id   = EXCLUDED.recorded_owner_id,
        true_owner_id       = EXCLUDED.true_owner_id,
        true_owner_effective_id = EXCLUDED.true_owner_effective_id,
        true_owner_is_operator  = EXCLUDED.true_owner_is_operator,
        updated_at          = now()
      RETURNING 1
    ),
    cleanup AS (
      DELETE FROM public.lcc_owner_facts_sync_inflight
      WHERE request_id IN (SELECT request_id FROM consumed) RETURNING 1
    )
    SELECT (SELECT COUNT(*) FROM consumed), (SELECT COUNT(*) FROM upsert) INTO v_finalized, v_upserted;

    domain := v_domain; finalized_requests := COALESCE(v_finalized,0); rows_upserted := COALESCE(v_upserted,0);
    RETURN NEXT;
  END LOOP;

  DELETE FROM public.lcc_owner_facts_sync_inflight WHERE issued_at < NOW() - interval '24 hours';
  ANALYZE public.lcc_property_owner_facts;
END;
$function$;


-- ─────────────────────────────────────────────────────────────────────────────
-- PART 1b — keep the INCREMENTAL mirror carrying the new columns
--
-- ⚠️ THE ONE REAL FOOTGUN IN THIS MIGRATION. lcc_mirror_tick is the live keyset
-- mirror; it builds an explicit PostgREST `select=` list per leg, and
-- lcc_apply_property_owner_facts_page writes NULL for any key ABSENT from the
-- payload. So leaving the property_owner_facts select list untouched would not
-- merely fail to refresh the new columns -- the very next incremental page would
-- NULL true_owner_effective_id / true_owner_is_operator on every row it touched,
-- silently starving the feeder AND disarming the operator guard. The select list
-- below is the whole change; every other line is reproduced verbatim from the
-- live definition.
--
-- The function has no seam to patch, so it is re-created in full in the companion
-- file 20260906120100_lcc_p113_mirror_tick_owner_ids.sql (kept separate purely so
-- this file stays readable). Apply that one too -- order does not matter.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─────────────────────────────────────────────────────────────────────────────
-- PART 2 — the promotable-owner name guard
--
-- NOTE ON SCOPE. Because the candidate is resolved by ID, this guard is NOT an
-- identity test -- it never decides *which* party a name refers to. It only asks
-- "is this party a plausible LANDLORD at all", and rejects three kinds that the
-- domain DBs demonstrably file in the owner slot:
--   * placeholders ("Independent" 11, "Other" 6)
--   * the federal TENANT ("U.S. Department of Veterans Affairs") -- in a
--     government-LEASED asset the United States is by definition the lessee
--   * brokerage houses captured as a comp party ("Marcus & Millichap",
--     "Jim Anthony - Colliers")
-- Deliberately NOT rejected: short acronym owners ("RMR", "GIP", "NGP", "DCI" --
-- all real owners/managers, and a length rule would have dropped 12 legitimate
-- assets), and names that merely CONTAIN a government word ("Federal Building
-- LLC" and "City Of Bellevue Nebraska" are private/municipal landlords, not the
-- federal tenant). Operators are handled by the authoritative flag, not here.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.lcc_owner_name_promotable(p_name text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_name IS NULL THEN false
    WHEN length(regexp_replace(lower(trim(p_name)), '[^a-z0-9]', '', 'g')) < 2 THEN false
    WHEN lower(trim(p_name)) = ANY (ARRAY[
      'independent','other','unknown','unk','n/a','na','n.a.','none','various',
      'various owners','tbd','undisclosed','confidential','private','individual',
      'owner','owners','not available','no owner','multiple','misc','miscellaneous'
    ]) THEN false
    WHEN lower(p_name) ~ '(^|[^a-z])(united states|u\.s\. department of|us department of|general services administration|department of veterans affairs|federal government)([^a-z]|$)' THEN false
    WHEN lower(p_name) ~ '(^|[^a-z])(cbre|jll|jones lang lasalle|colliers|marcus & millichap|marcus and millichap|cushman ?& ?wakefield|newmark|northmarq|savills|avison young|kidder mathews|lee & associates|transwestern|stream realty)([^a-z]|$)' THEN false
    ELSE true
  END;
$function$;

COMMENT ON FUNCTION public.lcc_owner_name_promotable(text) IS
  'Prompt 113: is this domain owner name a plausible LANDLORD? Placeholder / federal-tenant / brokerage rejects only. NOT an identity test -- the owner entity is resolved by id via external_identities, never by name.';


-- ─────────────────────────────────────────────────────────────────────────────
-- PART 3 — the candidate view (this IS the dry-run surface)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_lcc_domain_owner_candidates AS
WITH asset AS (
  SELECT DISTINCT ei.entity_id, ei.source_system AS source_domain, ei.external_id AS source_property_id
    FROM public.external_identities ei
    JOIN public.entities e ON e.id = ei.entity_id
   WHERE ei.source_system IN ('dia','gov')
     AND ei.source_type = 'asset'
     AND e.entity_type = 'asset'
     AND e.domain IN ('dia','gov')
),
unresolved AS (          -- FILL-BLANKS ONLY: a resolved owner is never restated
  SELECT a.* FROM asset a
   WHERE NOT EXISTS (
     SELECT 1 FROM public.lcc_property_owner po
      WHERE po.entity_id = a.entity_id AND po.owner_entity_id IS NOT NULL)
),
joined AS (
  SELECT u.entity_id, u.source_domain, u.source_property_id,
         f.true_owner_effective_id, f.true_owner_name,
         COALESCE(f.true_owner_is_operator, false) AS true_owner_is_operator,
         f.source_updated_at,
         (SELECT oi.entity_id FROM public.external_identities oi
           WHERE oi.source_system = u.source_domain
             AND oi.source_type = 'true_owner'
             AND oi.external_id = f.true_owner_effective_id::text
           ORDER BY oi.entity_id LIMIT 1) AS candidate_owner_entity
    FROM unresolved u
    JOIN public.lcc_property_owner_facts f
      ON f.source_domain = u.source_domain AND f.source_property_id = u.source_property_id
   WHERE f.true_owner_effective_id IS NOT NULL
),
classified AS (
  SELECT j.*,
    CASE
      WHEN j.true_owner_is_operator THEN 'operator_blocked'
      WHEN NOT public.lcc_owner_name_promotable(j.true_owner_name) THEN 'name_blocked'
      WHEN j.candidate_owner_entity IS NULL THEN 'no_owner_entity'
      WHEN j.candidate_owner_entity = j.entity_id THEN 'self_reference'
      WHEN EXISTS (SELECT 1 FROM public.lcc_owner_operator_block b
                    WHERE b.owner_entity_id = j.candidate_owner_entity) THEN 'operator_blocked'
      ELSE 'eligible'
    END AS base_status
  FROM joined j
),
amb AS (   -- one asset entity can carry two domain property identities; if they
           -- disagree on the owner that is genuine ambiguity, never a guess
  SELECT entity_id, count(DISTINCT candidate_owner_entity) AS n_candidates
    FROM classified WHERE base_status = 'eligible' GROUP BY entity_id
)
SELECT c.entity_id, c.source_domain, c.source_property_id,
       c.true_owner_effective_id, c.true_owner_name, c.true_owner_is_operator,
       c.candidate_owner_entity, c.source_updated_at,
       CASE WHEN c.base_status = 'eligible' AND COALESCE(a.n_candidates,1) > 1
            THEN 'ambiguous' ELSE c.base_status END AS status
  FROM classified c
  LEFT JOIN amb a ON a.entity_id = c.entity_id;

COMMENT ON VIEW public.v_lcc_domain_owner_candidates IS
  'Prompt 113 dry-run surface. One row per (unresolved asset entity, domain property). status: eligible | ambiguous | operator_blocked | name_blocked | no_owner_entity | self_reference. SELECT status, count(*) ... GROUP BY 1 is the dry run.';

GRANT SELECT ON public.v_lcc_domain_owner_candidates TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- PART 4 — reversal ledger + ambiguity review lane
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.lcc_domain_owner_evidence_log (
  id                      bigserial PRIMARY KEY,
  batch_tag               text        NOT NULL,
  entity_id               uuid        NOT NULL,
  source_domain           text        NOT NULL,
  source_property_id      text        NOT NULL,
  true_owner_effective_id uuid,
  candidate_owner_entity  uuid        NOT NULL,
  outcome                 text        NOT NULL,   -- 'resolved' | 'evidence_only'
  owner_entity_id         uuid,                   -- what lcc_property_owner holds after
  confidence              numeric,
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lcc_dom_owner_log_batch ON public.lcc_domain_owner_evidence_log (batch_tag);
CREATE INDEX IF NOT EXISTS idx_lcc_dom_owner_log_entity ON public.lcc_domain_owner_evidence_log (entity_id);

COMMENT ON TABLE public.lcc_domain_owner_evidence_log IS
  'Prompt 113 reversal ledger: every domain_true_owner evidence row written, and whether it resolved lcc_property_owner. Reverse a batch with the REVERSAL RUNBOOK in migration 20260906120000.';

CREATE TABLE IF NOT EXISTS public.lcc_domain_owner_ambiguous (
  entity_id     uuid PRIMARY KEY,
  candidates    jsonb       NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  resolution    text
);
COMMENT ON TABLE public.lcc_domain_owner_ambiguous IS
  'Prompt 113 review lane: an asset entity whose two domain property identities name DIFFERENT owners. Never auto-resolved -- pin the winner with lcc_pin_property_owner(entity, owner, note) and stamp resolved_at.';

CREATE OR REPLACE VIEW public.v_lcc_domain_owner_ambiguous_worklist AS
SELECT amb.entity_id,
       e.name AS asset_name,
       amb.candidates,
       amb.first_seen_at,
       (SELECT max(COALESCE(pa.annual_rent, pa.noi))
          FROM public.lcc_property_attributes pa
          JOIN public.external_identities ei
            ON ei.source_system = pa.source_domain AND ei.source_type = 'asset'
           AND ei.external_id = pa.source_property_id
         WHERE ei.entity_id = amb.entity_id) AS value_rank
  FROM public.lcc_domain_owner_ambiguous amb
  LEFT JOIN public.entities e ON e.id = amb.entity_id
 WHERE amb.resolved_at IS NULL
 ORDER BY value_rank DESC NULLS LAST, amb.first_seen_at;

GRANT SELECT ON public.v_lcc_domain_owner_ambiguous_worklist TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- PART 5 — the feeder
--
-- AUTHORITY LADDER. property-owner-source-authority-and-doctrine.md orders
--   manual > deed > rel_purchase > sf_seller > rel_owns
-- and the live evidence weights are manual 8.0, rel_purchase 4.0, sf_seller 3.5,
-- rel_owns 3.0. `domain_true_owner` is placed at 5.0 -- ABOVE rel_purchase,
-- BELOW manual. Justification: rel_purchase is ONE historical transaction that a
-- later sale may have superseded, whereas the domain true_owner is the curated
-- CURRENT owner-of-record maintained in the domain DB (gov: the Excel master
-- "TRUE OWNER" column; dia: the sidebar/deed resolver). It is not manual, so it
-- must not outrank an operator's explicit pin.
--
-- ONLY the true owner is fed. The RECORDED owner was measured and skipped: exactly
-- 2 unresolved assets have a recorded owner but no true owner, and recorded_owners
-- has no entry in the external_identities scheme at all, so promoting it would
-- require the name matching this design exists to avoid. Two assets does not
-- justify that risk.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.lcc_ingest_domain_owner_evidence(
  p_dry_run   boolean DEFAULT true,
  p_limit     integer DEFAULT NULL,
  p_batch_tag text    DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tag        text := COALESCE(p_batch_tag, 'p113_dom_owner_' || to_char(now(),'YYYYMMDD'));
  v_weight     numeric := 5.0;
  v_counts     jsonb;
  v_eligible   int := 0;
  v_written    int := 0;
  v_resolved   int := 0;
  v_amb_logged int := 0;
  r            record;
  v_res        jsonb;
BEGIN
  SELECT jsonb_object_agg(status, n) INTO v_counts
    FROM (SELECT status, count(*) AS n FROM public.v_lcc_domain_owner_candidates GROUP BY status) s;

  SELECT count(DISTINCT entity_id) INTO v_eligible
    FROM public.v_lcc_domain_owner_candidates WHERE status = 'eligible';

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'ok', true, 'dry_run', true, 'batch_tag', v_tag,
      'by_status', COALESCE(v_counts,'{}'::jsonb),
      'eligible_assets', v_eligible,
      'sample', COALESCE((
        SELECT jsonb_agg(x) FROM (
          SELECT source_domain, source_property_id, true_owner_name, candidate_owner_entity
            FROM public.v_lcc_domain_owner_candidates
           WHERE status='eligible' ORDER BY source_domain, source_property_id LIMIT 10) x),
        '[]'::jsonb));
  END IF;

  -- Ambiguity is recorded, never guessed. Idempotent on entity_id.
  WITH amb AS (
    SELECT entity_id,
           jsonb_agg(jsonb_build_object('domain', source_domain, 'property_id', source_property_id,
                                        'owner_name', true_owner_name,
                                        'candidate', candidate_owner_entity)
                     ORDER BY source_domain, source_property_id) AS candidates
      FROM public.v_lcc_domain_owner_candidates
     WHERE status = 'ambiguous' GROUP BY entity_id
  ), ins AS (
    INSERT INTO public.lcc_domain_owner_ambiguous (entity_id, candidates)
    SELECT entity_id, candidates FROM amb
    ON CONFLICT (entity_id) DO UPDATE SET candidates = EXCLUDED.candidates, updated_at = now()
    RETURNING 1
  ) SELECT count(*) INTO v_amb_logged FROM ins;

  FOR r IN
    SELECT DISTINCT ON (entity_id)
           entity_id, source_domain, source_property_id,
           true_owner_effective_id, candidate_owner_entity, source_updated_at
      FROM public.v_lcc_domain_owner_candidates
     WHERE status = 'eligible'
     ORDER BY entity_id, source_updated_at DESC NULLS LAST, source_property_id
     LIMIT COALESCE(p_limit, 2147483647)
  LOOP
    PERFORM public.lcc_record_property_owner_evidence(
      r.entity_id, r.candidate_owner_entity, 'domain_true_owner', v_weight,
      COALESCE(r.source_updated_at, now()),
      jsonb_build_object('batch_tag', v_tag, 'domain', r.source_domain,
                         'property_id', r.source_property_id,
                         'true_owner_id', r.true_owner_effective_id));
    v_written := v_written + 1;

    v_res := public.lcc_reconcile_property_owner(r.entity_id);

    INSERT INTO public.lcc_domain_owner_evidence_log (
      batch_tag, entity_id, source_domain, source_property_id, true_owner_effective_id,
      candidate_owner_entity, outcome, owner_entity_id, confidence)
    VALUES (v_tag, r.entity_id, r.source_domain, r.source_property_id, r.true_owner_effective_id,
            r.candidate_owner_entity,
            CASE WHEN COALESCE((v_res->>'wrote')::boolean,false) THEN 'resolved' ELSE 'evidence_only' END,
            NULLIF(v_res->>'owner','')::uuid, NULLIF(v_res->>'confidence','')::numeric);

    IF COALESCE((v_res->>'wrote')::boolean,false) THEN v_resolved := v_resolved + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'dry_run', false, 'batch_tag', v_tag,
    'by_status', COALESCE(v_counts,'{}'::jsonb),
    'evidence_written', v_written, 'assets_resolved', v_resolved,
    'ambiguous_logged', v_amb_logged);
END $function$;

COMMENT ON FUNCTION public.lcc_ingest_domain_owner_evidence(boolean,integer,text) IS
  'Prompt 113 / BREAK-3 P0.3 feeder. Promotes the domain true_owner to lcc_property_owner_evidence (source domain_true_owner, weight 5.0) by ID via external_identities, for UNRESOLVED assets only. Dry-run by default. Guards: operator flag, placeholder/federal-tenant/brokerage names, operator block list, self-reference, ambiguity -> lcc_domain_owner_ambiguous.';


-- ─────────────────────────────────────────────────────────────────────────────
-- PART 6 — register the authority ladder
--
-- lcc_property_owner is LCC-internal (not a curated cross-DB target), so this
-- feeder writes NO field_provenance rows and v_field_provenance_unranked is
-- unaffected by it -- that view stands at 35 rows of PRE-EXISTING drift on other
-- tables, unchanged by this migration. These rows exist so the property-owner
-- ladder is written down in the canonical place rather than living only in the
-- evidence weights and a design doc.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.field_source_priority (target_table, field_name, source, priority, enforce_mode, notes)
VALUES
  ('lcc.lcc_property_owner','owner_entity_id','manual',            1,  'record_only','operator pin via lcc_pin_property_owner (evidence weight 8.0)'),
  ('lcc.lcc_property_owner','owner_entity_id','domain_true_owner', 10, 'record_only','Prompt 113: dia/gov properties.true_owner_id, id-joined, operator-guarded (weight 5.0)'),
  ('lcc.lcc_property_owner','owner_entity_id','rel_purchase',      20, 'record_only','entity_relationships purchases edge - ONE historical transaction (weight 4.0)'),
  ('lcc.lcc_property_owner','owner_entity_id','sf_seller',         30, 'record_only','Salesforce seller (weight 3.5)'),
  ('lcc.lcc_property_owner','owner_entity_id','rel_owns',          40, 'record_only','entity_relationships owns edge (weight 3.0)')
ON CONFLICT DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────────
-- PART 7 — schedule
-- 05:50 UTC: after the owner-facts mirror (04:50/04:55) so the ids are fresh, and
-- after the owner-contact chain (05:00-05:45) so a newly resolved owner is picked
-- up by the NEXT day's contact pass rather than racing it.
-- ─────────────────────────────────────────────────────────────────────────────

SELECT cron.schedule('lcc-domain-owner-feeder', '50 5 * * *',
  $$SELECT public.lcc_ingest_domain_owner_evidence(false, 400)$$);


-- ============================================================================
-- REVERSAL RUNBOOK (per batch tag)
--   -- 1. drop the evidence this batch wrote
--   DELETE FROM public.lcc_property_owner_evidence
--    WHERE source = 'domain_true_owner' AND detail->>'batch_tag' = '<TAG>';
--   -- 2. clear the owner rows the batch resolved, then re-reconcile from the
--   --    remaining evidence (an asset with no other evidence goes back to unresolved)
--   DELETE FROM public.lcc_property_owner po
--    USING public.lcc_domain_owner_evidence_log l
--    WHERE l.batch_tag = '<TAG>' AND l.outcome = 'resolved' AND po.entity_id = l.entity_id;
--   SELECT public.lcc_reconcile_property_owner(e.entity_id)
--     FROM (SELECT DISTINCT entity_id FROM public.lcc_domain_owner_evidence_log
--            WHERE batch_tag = '<TAG>') e;
--   -- 3. drop the ledger rows
--   DELETE FROM public.lcc_domain_owner_evidence_log WHERE batch_tag = '<TAG>';
--   -- Full teardown additionally: DROP the two tables, the two views, the three
--   -- functions, the cron job, and the field_source_priority rows; the mirror
--   -- columns are additive and safe to leave.
--
-- NOT DONE HERE, AND WHY (measured 2026-08-15, reported in the round write-up):
--   876 unresolved assets DO have evidence but fail the 0.55 confidence gate.
--   lcc_reconcile_property_owner scores candidates by summed weight with a decay
--   FLOORED at 0.25, so a building sold three times yields three near-equal
--   candidates and confidence lands at 0.33-0.50. That is an ownership CHAIN being
--   scored as competing claims, when the later purchase in fact SUPERSEDES the
--   earlier one. A strict-latest-purchase supersession tier would resolve 465 of
--   them (439 with a strictly-latest dated purchase + 26 single-candidate) and
--   correctly abstain on the 360 that tie. That is a change to the shared
--   CONSUMER, not a feeder, so it is sized and reported rather than bundled into
--   a feeder migration.
-- ============================================================================
