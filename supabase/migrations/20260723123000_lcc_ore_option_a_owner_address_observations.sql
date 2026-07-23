-- ============================================================================
-- ORE Option A — capture & store ALL owner addresses (append-only) + surface
-- them + record the unverified CoStar recorded↔true link. LCC Opps
-- (xengecqvemvfknjvbvrq). Additive · reversible · never-collapse · reuse-not-fork.
-- ----------------------------------------------------------------------------
-- Build 1 (deed byte-capture) is live + draining; Build 2 (the multi-signal
-- reconcile engine + v_lcc_owner_address_dimension + the continuous review sweep)
-- is live but STARVED: owner-address coverage in LCC is ~0 (entities.address only,
-- 42 owners) while 302 owners carry a domain registered/notice address whose
-- STRING is not reachable in LCC (the boolean-only Slice-1 PII posture).
--
-- Scott's doctrine (2026-07-22): "Grab and store ALL different addresses and
-- reconcile or make connections later. The CoStar recorded↔true-owner association
-- is another datapoint to collect and verify — never ingest as truth; CoStar
-- mis-identifies constantly."
--
-- This round unblocks Build 2's real value with an append-only OBSERVATIONS store
-- (the raw material), extends the domain-address mirror to carry the STRING (the
-- 302-owner unlock, Scott-approved), and records the CoStar recorded↔true link as
-- an unverified datapoint (never written to true_owner_id).
--
-- REVERSAL: drop the two observation tables + the recorder RPCs + the mirror
-- reg_address column, and re-create the prior bodies of the three CREATE OR
-- REPLACE'd functions/views (the Build 2 / evidence-cache bodies quoted inline
-- below) → zero trace. No curated write path or PII table is touched.
-- ============================================================================

-- ============================================================================
-- UNIT 1 — the append-only owner-address OBSERVATIONS store (the raw material)
-- One row per (owner, normalized address, source surface). Never overwrite,
-- never collapse: the SAME owner's DIFFERENT addresses across surfaces all
-- coexist; only an exact (owner, addr_norm, surface) repeat is deduped.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.lcc_owner_address_observations (
  id                        bigserial PRIMARY KEY,
  owner_entity_id           uuid,          -- LCC owner entity when resolvable (else backfilled by the resolver)
  owner_name                text,          -- the owner name as observed (drives entity resolution)
  source_domain             text,          -- 'dia' | 'gov' | 'cre' | null
  source_recorded_owner_id  text,          -- domain recorded_owner id when known
  address_raw               text NOT NULL, -- the address exactly as observed
  addr_norm                 text NOT NULL, -- public.lcc_normalize_address(address_raw); a row is only stored when this is non-null
  city                      text,
  state                     text,
  source_surface            text NOT NULL, -- costar_owner_panel / costar_contacts / sales_comp_contact / deed_grantee / deed_grantor / sos_registry / salesforce / assessor_parcel / recorded_owner_domain
  address_kind              text,          -- notice / mailing / registered_agent / principal / situs
  matchable                 boolean NOT NULL DEFAULT true,  -- a notice/owner address feeds the same-address reconcile signal; a situs (property) address does NOT
  authority                 int  NOT NULL DEFAULT 50,       -- surface authority (recorded_owner_domain 90 … sales_comp 40); higher wins when one address must be picked
  confidence                numeric,
  source_url                text,
  source_context            jsonb,
  captured_at               timestamptz NOT NULL DEFAULT now()
);

-- Dedupe: same owner + same normalized address + same surface is not duplicated.
-- The owner key is (owner_entity_id, source_domain, source_recorded_owner_id) —
-- any of which may be null at capture — so the composite coalesces them.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lcc_owner_addr_obs
  ON public.lcc_owner_address_observations (
    coalesce(owner_entity_id::text, ''),
    coalesce(source_domain, ''),
    coalesce(source_recorded_owner_id, ''),
    addr_norm,
    source_surface);
CREATE INDEX IF NOT EXISTS ix_lcc_owner_addr_obs_entity
  ON public.lcc_owner_address_observations (owner_entity_id) WHERE owner_entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_lcc_owner_addr_obs_addr
  ON public.lcc_owner_address_observations (addr_norm);
CREATE INDEX IF NOT EXISTS ix_lcc_owner_addr_obs_owner_name
  ON public.lcc_owner_address_observations (lower(owner_name)) WHERE owner_entity_id IS NULL;

COMMENT ON TABLE public.lcc_owner_address_observations IS
  'ORE Option A Unit 1: append-only store of EVERY owner address observed on EVERY surface (never collapsed). One row per (owner, normalized address, source_surface). matchable=false for a situs/property address (never feeds the same-address reconcile signal). Feeds Build 2''s address dimension + the reconcile evidence cache. Drop the table → zero trace.';

-- ── UNIT 4 — the CoStar recorded↔true-owner LINK observations (unverified) ────
-- CoStar asserts a recorded-owner → true-owner association; the pipeline forms it
-- with implicit trust. Capture it here as a datapoint to VERIFY, never as truth:
-- NEVER written to properties.true_owner_id / recorded_owners.true_owner_id from
-- this store. verified=false until a deed/domain-derived link corroborates it.
CREATE TABLE IF NOT EXISTS public.lcc_owner_link_observations (
  id                        bigserial PRIMARY KEY,
  source_domain             text,
  recorded_owner_id         text,
  recorded_owner_name       text NOT NULL,
  asserted_true_owner_id    text,
  asserted_true_owner_name  text NOT NULL,
  source                    text NOT NULL DEFAULT 'costar',
  verified                  boolean NOT NULL DEFAULT false,
  source_context            jsonb,
  captured_at               timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lcc_owner_link_obs
  ON public.lcc_owner_link_observations (
    coalesce(source_domain, ''),
    coalesce(recorded_owner_id, ''),
    lower(recorded_owner_name),
    lower(asserted_true_owner_name),
    source);

COMMENT ON TABLE public.lcc_owner_link_observations IS
  'ORE Option A Unit 4: append-only, UNVERIFIED CoStar recorded-owner→true-owner assertions. A datapoint to collect + verify — NEVER written to true_owner_id. A costar link that AGREES with a deed/domain-derived link corroborates; one that DISAGREES is a review flag. Drop the table → zero trace.';

-- ============================================================================
-- UNIT 2 (recorders) — the recorder RPCs the capture path calls (service_role).
-- Server-side normalize + dedupe + entity-resolve so the JS emitter stays thin.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_record_owner_address_observation(
  p_owner_entity_id          uuid,
  p_owner_name               text,
  p_source_domain            text,
  p_source_recorded_owner_id text,
  p_address                  text,
  p_city                     text,
  p_state                    text,
  p_source_surface           text,
  p_address_kind             text DEFAULT NULL,
  p_confidence               numeric DEFAULT NULL,
  p_source_url               text DEFAULT NULL,
  p_source_context           jsonb DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS
$$
DECLARE
  v_norm text := public.lcc_normalize_address(p_address);
  v_entity uuid := p_owner_entity_id;
  v_matchable boolean := coalesce(lower(p_address_kind), '') <> 'situs';
  v_authority int;
  v_id bigint;
BEGIN
  IF v_norm IS NULL OR p_source_surface IS NULL THEN RETURN NULL; END IF;  -- un-normalizable / no surface → not a linkage observation
  -- Resolve the owner entity by name when not supplied (the same normalized-name
  -- match ensureEntityLink dedupes on) — best-effort, may stay null.
  IF v_entity IS NULL AND nullif(btrim(p_owner_name), '') IS NOT NULL THEN
    SELECT e.id INTO v_entity
    FROM public.entities e
    WHERE e.entity_type = 'organization' AND e.merged_into_entity_id IS NULL
      AND public.lcc_normalize_entity_name(e.name) = public.lcc_normalize_entity_name(p_owner_name)
    ORDER BY e.created_at ASC LIMIT 1;
  END IF;
  v_authority := CASE p_source_surface
    WHEN 'recorded_owner_domain' THEN 90
    WHEN 'deed_grantee'          THEN 80
    WHEN 'deed_grantor'          THEN 80
    WHEN 'sos_registry'          THEN 70
    WHEN 'salesforce'            THEN 65
    WHEN 'costar_owner_panel'    THEN 60
    WHEN 'costar_contacts'       THEN 55
    WHEN 'assessor_parcel'       THEN 50
    WHEN 'sales_comp_contact'    THEN 40
    ELSE 45 END;
  INSERT INTO public.lcc_owner_address_observations (
    owner_entity_id, owner_name, source_domain, source_recorded_owner_id,
    address_raw, addr_norm, city, state, source_surface, address_kind,
    matchable, authority, confidence, source_url, source_context)
  VALUES (
    v_entity, nullif(btrim(p_owner_name), ''), nullif(p_source_domain,''),
    nullif(p_source_recorded_owner_id,''),
    btrim(p_address), v_norm, nullif(btrim(p_city),''), nullif(upper(btrim(p_state)),''),
    p_source_surface, nullif(p_address_kind,''), v_matchable, v_authority,
    p_confidence, nullif(p_source_url,''), p_source_context)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.lcc_record_owner_link_observation(
  p_source_domain            text,
  p_recorded_owner_id        text,
  p_recorded_owner_name      text,
  p_asserted_true_owner_name text,
  p_asserted_true_owner_id   text DEFAULT NULL,
  p_source                   text DEFAULT 'costar',
  p_source_context           jsonb DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS
$$
DECLARE v_id bigint;
BEGIN
  IF nullif(btrim(p_recorded_owner_name),'') IS NULL
     OR nullif(btrim(p_asserted_true_owner_name),'') IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.lcc_owner_link_observations (
    source_domain, recorded_owner_id, recorded_owner_name,
    asserted_true_owner_id, asserted_true_owner_name, source, verified, source_context)
  VALUES (
    nullif(p_source_domain,''), nullif(p_recorded_owner_id,''), btrim(p_recorded_owner_name),
    nullif(p_asserted_true_owner_id,''), btrim(p_asserted_true_owner_name),
    coalesce(nullif(p_source,''),'costar'), false, p_source_context)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Backfill owner_entity_id on observation rows minted before the entity existed
-- (name-resolved). Cron-friendly; empty ⇒ no-op.
CREATE OR REPLACE FUNCTION public.lcc_resolve_owner_address_observation_entities(p_limit int DEFAULT 2000)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS
$$
DECLARE n int;
BEGIN
  WITH cand AS (
    SELECT o.id,
           (SELECT e.id FROM public.entities e
             WHERE e.entity_type = 'organization' AND e.merged_into_entity_id IS NULL
               AND public.lcc_normalize_entity_name(e.name) = public.lcc_normalize_entity_name(o.owner_name)
             ORDER BY e.created_at ASC LIMIT 1) AS eid
    FROM public.lcc_owner_address_observations o
    WHERE o.owner_entity_id IS NULL AND o.owner_name IS NOT NULL
    LIMIT greatest(1, least(coalesce(p_limit,2000), 20000))
  )
  UPDATE public.lcc_owner_address_observations o
     SET owner_entity_id = cand.eid
  FROM cand WHERE cand.id = o.id AND cand.eid IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- ============================================================================
-- UNIT 3 — surface the DOMAIN address STRING into LCC (the 302-owner unlock).
-- Extend the owner-contact-signals mirror to carry the reg_address STRING, then
-- feed it into the observations store (source recorded_owner_domain).
-- ============================================================================

ALTER TABLE public.lcc_owner_contact_signals
  ADD COLUMN IF NOT EXISTS reg_address text;

-- Sync — add reg_address to the pg_net select list (the gov/dia anon views gain
-- the column in the companion domain migrations). Byte-identical to the prior
-- body except the select list.
CREATE OR REPLACE FUNCTION public.lcc_sync_owner_contact_signals(p_domain text DEFAULT 'both'::text)
RETURNS TABLE(domain text, pages_fired integer)
LANGUAGE plpgsql SECURITY DEFINER AS
$function$
DECLARE
  v_url text; v_anon_key text; v_page int; v_request_id bigint;
  v_pages_fired int; v_domain text; v_domains text[]; v_max_pages int;
BEGIN
  IF p_domain = 'both' THEN v_domains := ARRAY['gov','dia'];
  ELSE v_domains := ARRAY[p_domain]; END IF;
  FOREACH v_domain IN ARRAY v_domains LOOP
    SELECT decrypted_secret INTO v_url      FROM vault.decrypted_secrets WHERE name = v_domain || '_supabase_url';
    SELECT decrypted_secret INTO v_anon_key FROM vault.decrypted_secrets WHERE name = v_domain || '_supabase_anon_key';
    IF v_url IS NULL OR v_anon_key IS NULL THEN
      RAISE NOTICE 'lcc_sync_owner_contact_signals(%): missing vault secret, skipping', v_domain;
      CONTINUE;
    END IF;
    v_max_pages := 5;
    v_pages_fired := 0;
    FOR v_page IN 0..v_max_pages LOOP
      SELECT net.http_get(
        url := v_url || '/rest/v1/v_owner_contact_signals_portfolio'
          || '?select=true_owner_id,true_owner_name,candidates,has_reg_address,reg_address'
          || '&order=true_owner_id.asc&limit=1000&offset=' || (v_page * 1000),
        headers := jsonb_build_object('apikey', v_anon_key, 'Authorization', 'Bearer ' || v_anon_key)
      ) INTO v_request_id;
      INSERT INTO public.lcc_owner_signal_sync_inflight (request_id, source_domain, page_offset)
      VALUES (v_request_id, v_domain, v_page * 1000);
      v_pages_fired := v_pages_fired + 1;
    END LOOP;
    domain := v_domain; pages_fired := v_pages_fired; RETURN NEXT;
  END LOOP;
END;
$function$;

-- Finalize — carry reg_address into the mirror (append-only column; a view that
-- doesn't yet expose reg_address returns null → the column stays null, graceful).
CREATE OR REPLACE FUNCTION public.lcc_finalize_owner_contact_signals()
RETURNS TABLE(finalized_requests integer, rows_upserted integer)
LANGUAGE plpgsql SECURITY DEFINER AS
$function$
DECLARE v_finalized int; v_upserted int;
BEGIN
  WITH consumed AS (
    SELECT i.request_id, i.source_domain, r.content
    FROM public.lcc_owner_signal_sync_inflight i
    JOIN net._http_response r ON r.id = i.request_id
    WHERE r.status_code = 200
  ),
  rows AS (
    SELECT source_domain, jsonb_array_elements(content::jsonb) AS row FROM consumed
  ),
  upsert AS (
    INSERT INTO public.lcc_owner_contact_signals (
      source_domain, source_true_owner_id, true_owner_name, candidates, has_reg_address, reg_address, updated_at)
    SELECT source_domain, (row->>'true_owner_id')::text,
           NULLIF(row->>'true_owner_name',''),
           COALESCE(row->'candidates', '[]'::jsonb),
           COALESCE((row->>'has_reg_address')::boolean, false),
           NULLIF(btrim(row->>'reg_address'), ''),
           now()
    FROM rows WHERE row->>'true_owner_id' IS NOT NULL
    ON CONFLICT (source_domain, source_true_owner_id) DO UPDATE SET
      true_owner_name = EXCLUDED.true_owner_name,
      candidates      = EXCLUDED.candidates,
      has_reg_address = EXCLUDED.has_reg_address,
      reg_address     = EXCLUDED.reg_address,
      updated_at      = now()
    RETURNING 1
  ),
  cleanup AS (
    DELETE FROM public.lcc_owner_signal_sync_inflight
    WHERE request_id IN (SELECT request_id FROM consumed) RETURNING 1
  )
  SELECT (SELECT count(*) FROM consumed), (SELECT count(*) FROM upsert)
  INTO v_finalized, v_upserted;
  DELETE FROM public.lcc_owner_signal_sync_inflight WHERE issued_at < now() - interval '24 hours';
  ANALYZE public.lcc_owner_contact_signals;
  finalized_requests := v_finalized; rows_upserted := v_upserted; RETURN NEXT;
END;
$function$;

-- Feed the mirror's reg_address STRING into the observations store. Resolves the
-- owner entity via the true_owner bridge (external_identities <domain>/true_owner
-- keyed on the domain true_owner id). Idempotent (the observation dedupe key).
CREATE OR REPLACE FUNCTION public.lcc_feed_owner_signal_addresses(p_limit int DEFAULT 5000)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS
$$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT s.source_domain, s.source_true_owner_id, s.true_owner_name, s.reg_address,
           (SELECT xi.entity_id FROM public.external_identities xi
             WHERE xi.source_system = s.source_domain AND xi.source_type = 'true_owner'
               AND xi.external_id = s.source_true_owner_id LIMIT 1) AS entity_id
    FROM public.lcc_owner_contact_signals s
    WHERE nullif(btrim(s.reg_address), '') IS NOT NULL
      AND public.lcc_normalize_address(s.reg_address) IS NOT NULL
    LIMIT greatest(1, least(coalesce(p_limit,5000), 50000))
  LOOP
    IF public.lcc_record_owner_address_observation(
         r.entity_id, r.true_owner_name, r.source_domain, r.source_true_owner_id,
         r.reg_address, NULL, NULL, 'recorded_owner_domain', 'notice', 0.85,
         NULL, jsonb_build_object('true_owner_id', r.source_true_owner_id)) IS NOT NULL
    THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END;
$$;

-- ============================================================================
-- FEED BUILD 2 — the observations reach the reconcile engine + the dimension.
-- ============================================================================

-- (a0) The per-entity TARGET gatherer must coalesce symmetrically with the cache,
--      else the target's addr_key stays null (entities.address) and the
--      shared_mailing_address signal never fires. Reversal: restore the addr_key
--      column to `public.lcc_normalize_address(e.address)`.
CREATE OR REPLACE FUNCTION public.lcc_owner_evidence(p_entity_id uuid)
 RETURNS TABLE(entity_id uuid, name text, name_core text, name_canon text, phone_key text, email_key text, addr_key text, city_key text, state_key text, sponsor_norm text, sf_account text, is_usable boolean)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_name text; v_sponsor text;
BEGIN
  SELECT e.name INTO v_name FROM public.entities e
   WHERE e.id = p_entity_id AND e.merged_into_entity_id IS NULL;
  IF v_name IS NULL THEN RETURN; END IF;
  SELECT pof.true_owner_name INTO v_sponsor
  FROM public.lcc_entity_portfolio_facts pf
  JOIN public.lcc_property_owner_facts pof
    ON pof.source_domain = pf.source_domain AND pof.source_property_id = pf.source_property_id
  WHERE pf.entity_id = p_entity_id AND pf.is_current = true
    AND pof.true_owner_name IS NOT NULL AND public.lcc_owner_name_usable(pof.true_owner_name)
  LIMIT 1;
  RETURN QUERY
  SELECT e.id, e.name,
    public.lcc_normalize_entity_name(e.name),
    public.lcc_canonicalize_owner_name(e.name),
    public.lcc_normalize_phone(e.phone),
    public.lcc_reconcile_email_key(e.email),
    COALESCE(public.lcc_normalize_address(e.address),
      (SELECT o.addr_norm FROM public.lcc_owner_address_observations o
        WHERE o.owner_entity_id = e.id AND o.matchable
        ORDER BY o.authority DESC, o.captured_at DESC, o.addr_norm LIMIT 1)),
    nullif(lower(btrim(e.city)), ''),
    nullif(upper(btrim(e.state)), ''),
    public.lcc_institution_norm(v_sponsor),
    (SELECT xi.external_id FROM public.external_identities xi
      WHERE xi.entity_id = e.id AND xi.source_system = 'salesforce' AND xi.source_type = 'Account'
      ORDER BY xi.created_at ASC LIMIT 1),
    public.lcc_owner_name_usable(e.name)
  FROM public.entities e WHERE e.id = p_entity_id;
END;
$function$;

-- (a) Reconcile evidence cache: addr_key now COALESCEs entities.address with the
--     owner's best MATCHABLE observation address, so the weight-50
--     shared_mailing_address signal lights up for the 302 domain-address owners
--     (and every multi-surface CoStar owner) WITHOUT touching entities.address.
--     Empty observations ⇒ byte-identical to the prior body (cache-or-live safe).
--     Reversal: re-create the body with `public.lcc_normalize_address(e.address)`
--     for the addr_key column (drop the COALESCE + LEFT JOIN).
CREATE OR REPLACE FUNCTION public.lcc_refresh_owner_evidence_cache()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS
$function$
DECLARE n int;
BEGIN
  TRUNCATE public.lcc_owner_evidence_cache;
  INSERT INTO public.lcc_owner_evidence_cache
  SELECT
    e.id, e.name,
    public.lcc_normalize_entity_name(e.name),
    split_part(public.lcc_normalize_entity_name(e.name), ' ', 1),
    public.lcc_normalize_phone(e.phone),
    public.lcc_reconcile_email_key(e.email),
    COALESCE(public.lcc_normalize_address(e.address), obs.addr_norm),
    nullif(lower(btrim(e.city)), ''),
    nullif(upper(btrim(e.state)), ''),
    (SELECT public.lcc_institution_norm(pof.true_owner_name)
       FROM public.lcc_entity_portfolio_facts pf
       JOIN public.lcc_property_owner_facts pof
         ON pof.source_domain = pf.source_domain AND pof.source_property_id = pf.source_property_id
      WHERE pf.entity_id = e.id AND pf.is_current = true
        AND public.lcc_owner_name_usable(pof.true_owner_name)
      LIMIT 1),
    (SELECT xi.external_id FROM public.external_identities xi
      WHERE xi.entity_id = e.id AND xi.source_system = 'salesforce' AND xi.source_type = 'Account'
      ORDER BY xi.created_at ASC LIMIT 1)
  FROM public.entities e
  LEFT JOIN LATERAL (
    SELECT o.addr_norm
    FROM public.lcc_owner_address_observations o
    WHERE o.owner_entity_id = e.id AND o.matchable
    ORDER BY o.authority DESC, o.captured_at DESC, o.addr_norm
    LIMIT 1
  ) obs ON true
  WHERE e.entity_type = 'organization'
    AND e.merged_into_entity_id IS NULL
    AND coalesce((e.metadata->>'junk_name_flagged'), 'false') <> 'true';
  GET DIAGNOSTICS n = ROW_COUNT;
  ANALYZE public.lcc_owner_evidence_cache;
  RETURN n;
END;
$function$;

-- (b) Build 2 dimension: add an OBSERVATION leg (every observed matchable address
--     that resolves to an owner entity). Reversal: drop the third UNION ALL leg.
CREATE OR REPLACE VIEW public.v_lcc_owner_address_dimension AS
SELECT
  e.id                                       AS owner_entity_id,
  e.name                                     AS owner_name,
  'entity_capture'::text                     AS source,
  50                                         AS authority,
  true                                       AS matchable,
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
SELECT
  e.id, e.name, 'asset_location'::text, 10, false,
  btrim(pa.address), public.lcc_normalize_address(pa.address),
  nullif(lower(btrim(pa.city)), ''), nullif(upper(btrim(pa.state)), '')
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
  AND public.lcc_owner_name_usable(e.name)
UNION ALL
-- OPTION A: every observed owner address (all surfaces), resolved to an owner
-- entity. matchable rides the observation (situs = not matchable). This is the
-- surface that makes cross-surface + domain addresses visible + reconcilable.
SELECT
  o.owner_entity_id, e.name, ('observation:' || o.source_surface)::text,
  o.authority, o.matchable,
  o.address_raw, o.addr_norm,
  coalesce(nullif(lower(btrim(o.city)),''), nullif(lower(btrim(e.city)),'')),
  coalesce(nullif(upper(btrim(o.state)),''), nullif(upper(btrim(e.state)),''))
FROM public.lcc_owner_address_observations o
JOIN public.entities e
  ON e.id = o.owner_entity_id AND e.entity_type = 'organization' AND e.merged_into_entity_id IS NULL
WHERE o.owner_entity_id IS NOT NULL
  AND public.lcc_owner_name_usable(e.name);

COMMENT ON VIEW public.v_lcc_owner_address_dimension IS
  'ORE Build 2 + Option A: unified owner-address dimension. entity_capture (entities.address) + asset_location (context, not matchable) + observation:<surface> (Option A — every observed owner address across all surfaces, resolved to an owner entity). matchable rides each source. Reversible.';

-- (c) Build 2 shared-address candidate source (the sweep fingerprint): now unions
--     the matchable OBSERVATION addresses, so the review sweep fires when a
--     cross-surface / domain shared address appears. Reversal: drop the observation
--     UNION in the owner_addr CTE.
CREATE OR REPLACE VIEW public.v_lcc_owner_shared_address AS
WITH owner_addr AS (
  SELECT e.id AS owner_entity_id,
         public.lcc_normalize_address(e.address) AS addr_norm
  FROM public.entities e
  WHERE e.entity_type = 'organization'
    AND e.merged_into_entity_id IS NULL
    AND public.lcc_normalize_address(e.address) IS NOT NULL
    AND public.lcc_owner_name_usable(e.name)
  UNION
  SELECT o.owner_entity_id, o.addr_norm
  FROM public.lcc_owner_address_observations o
  JOIN public.entities e
    ON e.id = o.owner_entity_id AND e.entity_type = 'organization' AND e.merged_into_entity_id IS NULL
  WHERE o.owner_entity_id IS NOT NULL AND o.matchable
    AND public.lcc_owner_name_usable(e.name)
),
grp AS (
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
  'ORE Build 2 + Option A: owners sharing a normalized notice address with >=1 other owner — now including matchable OBSERVATION addresses (all surfaces + domain), so the review sweep re-reviews when a cross-surface shared address appears.';

-- (d) Coverage: add observation counts. Append-only columns (COR-view rule).
CREATE OR REPLACE VIEW public.v_lcc_owner_address_coverage AS
SELECT
  (SELECT count(DISTINCT owner_entity_id) FROM public.v_lcc_owner_address_dimension WHERE source = 'entity_capture')                 AS owners_entity_capture,
  (SELECT count(DISTINCT owner_entity_id) FROM public.v_lcc_owner_address_dimension WHERE source = 'asset_location')                 AS owners_asset_location,
  (SELECT count(DISTINCT addr_norm)       FROM public.v_lcc_owner_address_dimension WHERE matchable)                                 AS distinct_matchable_addresses,
  (SELECT count(*)                        FROM public.v_lcc_owner_shared_address)                                                    AS owners_in_shared_address,
  (SELECT count(*)                        FROM public.lcc_owner_contact_signals WHERE has_reg_address)                               AS owners_domain_addr_not_in_lcc,
  (SELECT count(*)                        FROM public.lcc_owner_address_observations)                                                AS owner_address_observations,
  (SELECT count(DISTINCT owner_entity_id) FROM public.lcc_owner_address_observations WHERE owner_entity_id IS NOT NULL)             AS owners_with_observation,
  (SELECT count(*)                        FROM public.lcc_owner_contact_signals WHERE nullif(btrim(reg_address),'') IS NOT NULL)     AS owners_domain_addr_string_in_lcc;

COMMENT ON VIEW public.v_lcc_owner_address_coverage IS
  'ORE Build 2 + Option A: owner-address coverage. owners_domain_addr_not_in_lcc = owners with a domain reg address (boolean); owners_domain_addr_string_in_lcc = of those, the ones whose STRING is now mirrored into LCC (Option A Unit 3). owner_address_observations / owners_with_observation = the append-only capture store.';

-- ── UNIT 4 — the recorded↔true link review surface ───────────────────────────
-- Unverified CoStar assertions, newest first, with a corroboration flag: a
-- non-costar (deed/domain-derived) assertion for the SAME recorded owner that
-- AGREES corroborates; a costar-only assertion awaits verification.
CREATE OR REPLACE VIEW public.v_lcc_owner_link_review AS
SELECT
  l.id, l.source_domain, l.recorded_owner_id, l.recorded_owner_name,
  l.asserted_true_owner_name, l.asserted_true_owner_id, l.source, l.verified,
  EXISTS (
    SELECT 1 FROM public.lcc_owner_link_observations c
    WHERE c.source <> 'costar'
      AND coalesce(c.source_domain,'') = coalesce(l.source_domain,'')
      AND lower(c.recorded_owner_name) = lower(l.recorded_owner_name)
      AND public.lcc_normalize_entity_name(c.asserted_true_owner_name)
        = public.lcc_normalize_entity_name(l.asserted_true_owner_name)
  ) AS corroborated,
  EXISTS (
    SELECT 1 FROM public.lcc_owner_link_observations d
    WHERE d.source <> 'costar'
      AND coalesce(d.source_domain,'') = coalesce(l.source_domain,'')
      AND lower(d.recorded_owner_name) = lower(l.recorded_owner_name)
      AND public.lcc_normalize_entity_name(d.asserted_true_owner_name)
        <> public.lcc_normalize_entity_name(l.asserted_true_owner_name)
  ) AS disagrees,
  l.captured_at
FROM public.lcc_owner_link_observations l
WHERE l.source = 'costar' AND NOT l.verified
ORDER BY l.captured_at DESC;

COMMENT ON VIEW public.v_lcc_owner_link_review IS
  'ORE Option A Unit 4: unverified CoStar recorded↔true assertions to review. corroborated = a deed/domain-derived assertion agrees (upgrade candidate); disagrees = a non-costar assertion names a different true owner (review flag). Never written to true_owner_id.';

-- Grants (mirror the sibling ORE artifacts).
GRANT SELECT ON
  public.lcc_owner_address_observations,
  public.lcc_owner_link_observations,
  public.v_lcc_owner_link_review
  TO anon, authenticated, service_role;
GRANT INSERT ON public.lcc_owner_address_observations, public.lcc_owner_link_observations TO service_role;
GRANT EXECUTE ON FUNCTION public.lcc_record_owner_address_observation(uuid,text,text,text,text,text,text,text,text,numeric,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.lcc_record_owner_link_observation(text,text,text,text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.lcc_resolve_owner_address_observation_entities(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.lcc_feed_owner_signal_addresses(int) TO service_role;
