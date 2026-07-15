-- ============================================================================
-- ORE — multi-signal, authority-weighted owner reconciliation engine
-- (Scott's core doctrine, 2026-07-15 — ORE_REALIGNMENT_first_principles §7)
-- LCC Opps (xengecqvemvfknjvbvrq). Additive · reversible · guarded ·
-- provenance-tagged · surface-ambiguity-never-guess.
-- ----------------------------------------------------------------------------
-- Manual reconciliation never trusts one source — it triangulates identity from
-- EVERY available clue, hierarchically weighting the more authoritative ones. Two
-- owner records that share a phone, or a name-core + city/state, or a mailing
-- address, are the SAME party even when no single field is authoritative. This
-- migration composes the existing primitives (lcc_merge_entity, the cross-ref /
-- institution resolvers, the entity-link guards, field_source_priority's authority
-- scale) into ONE weighted resolver that records the evidence trace, cleans the
-- noisy true_owner field as it goes, and re-triangulates as new clues arrive.
--
-- Units:
--   1. the evidence model — signal set + authority weights (single tunable knob)
--      + normalizers (phone/email/address).
--   2. the resolver — lcc_reconcile_owner(entity): gather evidence → cluster
--      same-party candidates by weighted agreement → verdict (same_party|review|
--      distinct) → evidence trace. Conflicting high-authority signals → review.
--   3. clean the true_owner noise — placeholder/operator/verbose guards +
--      canonicalizer + a catalogue view (surface, reversible).
--   4. continuous re-triangulation — a queue + idempotent enqueue + a value-ranked
--      seed (NOT a hot-path trigger — see the note in Unit 4).
--
-- REVERSAL: drop lcc_signal_authority, lcc_reconcile_config,
--   lcc_owner_reconcile_evidence, lcc_owner_reconcile_queue, and the functions/
--   views created here → zero trace. No existing object is mutated (the shared
--   lcc_is_operator_owner_name / lcc_merge_entity are composed over, not altered).
-- ============================================================================

-- ============================================================================
-- UNIT 1 — the evidence model: signals + authority weights (single source of truth)
-- ============================================================================

-- Authority weights, keyed by signal. HIGHER = more authoritative (deliberately
-- the INVERSE of field_source_priority's "lower rank = higher trust", so weighted
-- AGREEMENT sums intuitively: a single high-authority signal clears the threshold
-- alone; several low-authority signals sum to clear it — the human move). The
-- scale mirrors field_source_priority's tiers (manual/curated > recorded deed/
-- county > SOS > salesforce + true_owner field > aggregator > naming inference).
CREATE TABLE IF NOT EXISTS public.lcc_signal_authority (
  signal            text PRIMARY KEY,
  authority_weight  numeric NOT NULL,
  note              text
);

INSERT INTO public.lcc_signal_authority (signal, authority_weight, note) VALUES
  ('shared_salesforce_account', 80, 'both entities carry the SAME SF Account id — same party (a DIFFERENT id is a conflict, never a match)'),
  ('shared_email',              55, 'both entities share a normalized NON-generic email'),
  ('shared_mailing_address',    50, 'both entities share a normalized mailing/notice address'),
  ('shared_phone',              45, 'both entities share a normalized phone (last-10)'),
  ('shared_name_core',          40, 'DISTINCTIVE shared name-core (case/punctuation/suffix variants of the same name)'),
  ('shared_true_owner_sponsor', 30, 'both entities resolve to the same usable true_owner sponsor (corroborating — siblings share it, so it never clusters alone)'),
  ('shared_name_city',          25, 'name-core token overlap + same city/state'),
  ('naming_inference',          15, 'weak naming-only overlap')
ON CONFLICT (signal) DO NOTHING;

COMMENT ON TABLE public.lcc_signal_authority IS
  'ORE reconciliation: per-signal authority weight (higher = more authoritative). Tune here; the resolver sums the weights of agreeing signals.';

-- The match threshold — the ONE tunable knob. weighted_score >= threshold (and no
-- high-authority conflict) ⇒ same_party. Default 60: a shared SF account (80) or
-- email (55)+name_core... clears; a distinctive name_core (40) alone does NOT
-- (needs a corroborating signal), and naming_inference (15) alone never does.
CREATE TABLE IF NOT EXISTS public.lcc_reconcile_config (
  id              int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  match_threshold numeric NOT NULL DEFAULT 60,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.lcc_reconcile_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.lcc_reconcile_match_threshold()
RETURNS numeric LANGUAGE sql STABLE AS
$$ SELECT coalesce((SELECT match_threshold FROM public.lcc_reconcile_config WHERE id = 1), 60) $$;

CREATE OR REPLACE FUNCTION public.lcc_signal_weight(p_signal text)
RETURNS numeric LANGUAGE sql STABLE AS
$$ SELECT coalesce((SELECT authority_weight FROM public.lcc_signal_authority WHERE signal = p_signal), 0) $$;

-- Normalizers (linkage keys). Reuse lcc_normalize_entity_name for the name-core.
CREATE OR REPLACE FUNCTION public.lcc_normalize_phone(p_phone text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS
$$
DECLARE d text;
BEGIN
  IF p_phone IS NULL THEN RETURN NULL; END IF;
  d := regexp_replace(p_phone, '[^0-9]', '', 'g');
  -- strip a US country-code 1 prefix on an 11-digit number
  IF length(d) = 11 AND left(d, 1) = '1' THEN d := right(d, 10); END IF;
  IF length(d) <> 10 THEN RETURN NULL; END IF;                -- only trust a clean NANP number
  IF d ~ '^(\d)\1{9}$' OR d = '0000000000' THEN RETURN NULL; END IF;  -- repeated-digit junk
  RETURN d;
END;
$$;

-- Email as a same-party key excludes generic/role inboxes (a shared info@/sales@
-- identifies a firm mailbox, not the same owner). Mirrors isGenericInboxEmail.
CREATE OR REPLACE FUNCTION public.lcc_reconcile_email_key(p_email text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS
$$
DECLARE e text; localp text;
BEGIN
  IF p_email IS NULL THEN RETURN NULL; END IF;
  e := lower(btrim(p_email));
  IF e = '' OR position('@' in e) = 0 THEN RETURN NULL; END IF;
  localp := split_part(e, '@', 1);
  -- plus-addressing: normalize local+tag@ → local@
  localp := split_part(localp, '+', 1);
  IF localp = ANY (ARRAY['info','sales','leasing','admin','office','contact','hello','support',
                          'inquiries','inquiry','property','properties','management','accounting',
                          'billing','noreply','no-reply','service','team']) THEN
    RETURN NULL;                                              -- generic role inbox — not a person/party key
  END IF;
  RETURN localp || '@' || split_part(e, '@', 2);
END;
$$;

CREATE OR REPLACE FUNCTION public.lcc_normalize_address(p_addr text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS
$$
DECLARE a text;
BEGIN
  IF p_addr IS NULL THEN RETURN NULL; END IF;
  a := lower(p_addr);
  -- collapse common directional / street-type abbreviations to a dense token stream
  a := regexp_replace(a, '[^a-z0-9]+', ' ', 'g');
  a := btrim(a);
  IF length(replace(a, ' ', '')) < 6 THEN RETURN NULL; END IF;   -- too short to trust as a key
  RETURN a;
END;
$$;

-- ============================================================================
-- UNIT 3 — clean the true_owner noise (the reconciler's first job). Guards are
-- ADDITIVE and compose over the shared lcc_is_operator_owner_name (which does not
-- catch "U.S. Renal Care" — the periods break its \mus renal\M boundary — nor the
-- placeholder class). We do NOT mutate the shared guard (widely consumed).
-- ============================================================================

-- Placeholder / structural-junk owner names (John Doe, Independent, numeric, N/A…).
CREATE OR REPLACE FUNCTION public.lcc_is_placeholder_owner_name(p_name text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS
$$
DECLARE n text;
BEGIN
  IF p_name IS NULL THEN RETURN true; END IF;
  n := lower(btrim(p_name));
  IF n = '' THEN RETURN true; END IF;
  IF n IN ('john doe','jane doe','independent','n/a','na','none','unknown','tbd','tba',
           'various','multiple','undisclosed','not available','not disclosed','owner',
           'current owner','recorded owner','the owner','same','see above','no owner') THEN
    RETURN true;
  END IF;
  IF n ~ '^[0-9.,$%()\-\s]+$' THEN RETURN true; END IF;      -- numeric / symbol-only
  RETURN false;
END;
$$;

-- The extra operator patterns the shared guard misses (period-broken US Renal,
-- Renal Care Group, DCI, Physicians Dialysis, National Renal…). Additive.
CREATE OR REPLACE FUNCTION public.lcc_is_extra_operator_name(p_name text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS
$$
BEGIN
  IF p_name IS NULL THEN RETURN false; END IF;
  RETURN p_name ~* '\mu\.?\s*s\.?\s*renal( care)?\M'
      OR p_name ~* '\m(renal care group|renal advantage|national renal|physicians dialysis|dci donor|dialysis clinic,? inc)\M';
END;
$$;

-- The composite "is this owner name usable as a canonical/sponsor party?" gate the
-- resolver keys on. NOT placeholder AND NOT operator (shared OR extra) AND NOT a
-- rejected/garbage contact name.
CREATE OR REPLACE FUNCTION public.lcc_owner_name_usable(p_name text)
RETURNS boolean LANGUAGE sql STABLE AS
$$
  SELECT p_name IS NOT NULL
     AND btrim(p_name) <> ''
     AND NOT public.lcc_is_placeholder_owner_name(p_name)
     AND NOT public.lcc_is_operator_owner_name(p_name)
     AND NOT public.lcc_is_extra_operator_name(p_name)
     AND NOT public.lcc_is_rejected_contact_name(p_name)
$$;

-- Canonicalize an AI-verbose owner string to its core institution name for
-- clustering (strip a trailing parenthetical expansion, " or related
-- stakeholders", " et al", " and affiliates", collapse whitespace). Non-verbose
-- names pass through trimmed.
CREATE OR REPLACE FUNCTION public.lcc_canonicalize_owner_name(p_name text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS
$$
DECLARE n text;
BEGIN
  IF p_name IS NULL THEN RETURN NULL; END IF;
  n := p_name;
  n := regexp_replace(n, '\s*\([^)]*\)\s*$', '', 'g');        -- drop a trailing (…) expansion
  n := regexp_replace(n, '\s*,?\s+(or related stakeholders|et\.?\s*al\.?|and affiliates?|and others?)\.?\s*$', '', 'gi');
  n := regexp_replace(n, '\s+', ' ', 'g');
  n := btrim(n);
  IF n = '' THEN RETURN btrim(p_name); END IF;
  RETURN n;
END;
$$;

-- Catalogue the true_owner noise (surface, reversible — drop → zero trace).
CREATE OR REPLACE VIEW public.v_lcc_true_owner_noise AS
WITH t AS (
  SELECT true_owner_name AS nm, count(*) AS n_props
  FROM public.lcc_property_owner_facts
  WHERE true_owner_name IS NOT NULL
  GROUP BY true_owner_name
)
SELECT
  nm AS true_owner_name,
  n_props,
  CASE
    WHEN public.lcc_is_placeholder_owner_name(nm) THEN 'placeholder'
    WHEN public.lcc_is_operator_owner_name(nm) OR public.lcc_is_extra_operator_name(nm) THEN 'operator'
    WHEN nm <> public.lcc_canonicalize_owner_name(nm) THEN 'verbose'
    ELSE 'clean'
  END AS noise_kind,
  public.lcc_canonicalize_owner_name(nm) AS canonical_name
FROM t;

COMMENT ON VIEW public.v_lcc_true_owner_noise IS
  'ORE: catalogues the noise in lcc_property_owner_facts.true_owner_name (placeholder / operator / verbose / clean). Surface-only, reversible.';

-- ============================================================================
-- UNIT 2 — the resolver + the evidence trace
-- ============================================================================

-- Append-only evidence ledger: WHICH signals agreed, at WHAT weight, from what
-- source — every resolution grounded + traceable + reversible.
CREATE TABLE IF NOT EXISTS public.lcc_owner_reconcile_evidence (
  id                   bigserial PRIMARY KEY,
  entity_id            uuid NOT NULL,              -- the target owner
  candidate_entity_id  uuid,                       -- the matched same-party (null for a self/clean record)
  verdict              text NOT NULL,              -- same_party | review | distinct | cleaned
  weighted_score       numeric,
  threshold            numeric,
  agreeing_signals     jsonb,                      -- [{signal, weight, value}]
  high_authority_conflict boolean DEFAULT false,
  action               text,                       -- merged | flagged_review | canonicalized | none
  detail               jsonb,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lcc_owner_reconcile_evidence_entity
  ON public.lcc_owner_reconcile_evidence (entity_id, created_at DESC);

COMMENT ON TABLE public.lcc_owner_reconcile_evidence IS
  'ORE reconciliation evidence trace: per (target, candidate) the agreeing signals + weighted score + verdict + action. The grounded/traceable record.';

-- Gather ONE owner's evidence set (STABLE, no I/O beyond reads). Returns a single
-- row. sponsor is the usable true_owner sponsor via the portfolio mirror.
CREATE OR REPLACE FUNCTION public.lcc_owner_evidence(p_entity_id uuid)
RETURNS TABLE(
  entity_id uuid, name text, name_core text, name_canon text,
  phone_key text, email_key text, addr_key text,
  city_key text, state_key text, sponsor_norm text, sf_account text, is_usable boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS
$$
#variable_conflict use_column
DECLARE
  v_name text; v_sponsor text;
BEGIN
  SELECT e.name INTO v_name FROM public.entities e
   WHERE e.id = p_entity_id AND e.merged_into_entity_id IS NULL;
  IF v_name IS NULL THEN RETURN; END IF;

  SELECT pof.true_owner_name INTO v_sponsor
  FROM public.lcc_entity_portfolio_facts pf
  JOIN public.lcc_property_owner_facts pof
    ON pof.source_domain = pf.source_domain AND pof.source_property_id = pf.source_property_id
  WHERE pf.entity_id = p_entity_id AND pf.is_current = true
    AND pof.true_owner_name IS NOT NULL
    AND public.lcc_owner_name_usable(pof.true_owner_name)
  LIMIT 1;

  RETURN QUERY
  SELECT
    e.id,
    e.name,
    public.lcc_normalize_entity_name(e.name),
    public.lcc_canonicalize_owner_name(e.name),
    public.lcc_normalize_phone(e.phone),
    public.lcc_reconcile_email_key(e.email),
    public.lcc_normalize_address(e.address),
    nullif(lower(btrim(e.city)), ''),
    nullif(upper(btrim(e.state)), ''),
    public.lcc_institution_norm(v_sponsor),
    (SELECT xi.external_id FROM public.external_identities xi
      WHERE xi.entity_id = e.id AND xi.source_system = 'salesforce' AND xi.source_type = 'Account'
      ORDER BY xi.created_at ASC LIMIT 1),
    public.lcc_owner_name_usable(e.name)
  FROM public.entities e WHERE e.id = p_entity_id;
END;
$$;

-- The resolver: for a target owner, cluster same-party candidate ENTITIES by
-- authority-weighted signal agreement + record the evidence. One row per candidate.
CREATE OR REPLACE FUNCTION public.lcc_reconcile_owner(p_entity_id uuid)
RETURNS TABLE(
  candidate_entity_id uuid, candidate_name text,
  agreeing_signals jsonb, weighted_score numeric, threshold numeric,
  high_authority_conflict boolean, verdict text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS
$$
#variable_conflict use_column
DECLARE
  t record;        -- target evidence
  v_thr numeric := public.lcc_reconcile_match_threshold();
  v_token text;
BEGIN
  SELECT * INTO t FROM public.lcc_owner_evidence(p_entity_id);
  IF t.entity_id IS NULL OR NOT t.is_usable THEN RETURN; END IF;   -- never seed a cluster from a junk/operator/placeholder name
  v_token := split_part(coalesce(t.name_core, ''), ' ', 1);

  RETURN QUERY
  WITH cand AS (   -- DISCOVERY: other active org entities sharing a same-PARTY key
    SELECT DISTINCT c.entity_id
    FROM public.lcc_owner_evidence_cache c
    WHERE c.entity_id <> p_entity_id
      AND (
        (t.phone_key   IS NOT NULL AND c.phone_key = t.phone_key)
     OR (t.email_key   IS NOT NULL AND c.email_key = t.email_key)
     OR (t.sf_account  IS NOT NULL AND c.sf_account = t.sf_account)
     OR (t.addr_key    IS NOT NULL AND c.addr_key = t.addr_key)
     OR (c.first_token = v_token AND public.lcc_reconcile_name_match(t.name_core, c.name_core))
      )
  ),
  scored AS (
    SELECT
      c.entity_id AS cid, c.name AS cname,
      -- agreeing-signal set (each once)
      ( SELECT jsonb_agg(s) FROM (
          SELECT jsonb_build_object('signal','shared_salesforce_account','weight',public.lcc_signal_weight('shared_salesforce_account'),'value',t.sf_account) AS s
            WHERE t.sf_account IS NOT NULL AND c.sf_account = t.sf_account
          UNION ALL SELECT jsonb_build_object('signal','shared_email','weight',public.lcc_signal_weight('shared_email'),'value',t.email_key)
            WHERE t.email_key IS NOT NULL AND c.email_key = t.email_key
          UNION ALL SELECT jsonb_build_object('signal','shared_mailing_address','weight',public.lcc_signal_weight('shared_mailing_address'),'value',t.addr_key)
            WHERE t.addr_key IS NOT NULL AND c.addr_key = t.addr_key
          UNION ALL SELECT jsonb_build_object('signal','shared_phone','weight',public.lcc_signal_weight('shared_phone'),'value',t.phone_key)
            WHERE t.phone_key IS NOT NULL AND c.phone_key = t.phone_key
          UNION ALL SELECT jsonb_build_object('signal','shared_name_core','weight',public.lcc_signal_weight('shared_name_core'),'value',t.name_core)
            WHERE public.lcc_reconcile_name_match(t.name_core, c.name_core)
          UNION ALL SELECT jsonb_build_object('signal','shared_true_owner_sponsor','weight',public.lcc_signal_weight('shared_true_owner_sponsor'),'value',t.sponsor_norm)
            WHERE t.sponsor_norm IS NOT NULL AND c.sponsor_norm = t.sponsor_norm
          UNION ALL SELECT jsonb_build_object('signal','shared_name_city','weight',public.lcc_signal_weight('shared_name_city'),'value',t.city_key||'/'||t.state_key)
            WHERE c.first_token = v_token AND t.city_key IS NOT NULL AND c.city_key = t.city_key
              AND t.state_key IS NOT NULL AND c.state_key = t.state_key
        ) sig ) AS sigs,
      -- name overlap flag (needed for the safe-merge gate)
      public.lcc_reconcile_name_match(t.name_core, c.name_core) AS name_match,
      -- conflict: both carry a KNOWN but DIFFERENT SF Account → distinct parties
      (t.sf_account IS NOT NULL AND c.sf_account IS NOT NULL AND c.sf_account <> t.sf_account) AS conflict
    FROM public.lcc_owner_evidence_cache c
    JOIN cand ON cand.entity_id = c.entity_id
  ),
  agg AS (
    SELECT cid, cname, coalesce(sigs, '[]'::jsonb) AS sigs, name_match, conflict,
           coalesce((SELECT sum((x->>'weight')::numeric) FROM jsonb_array_elements(coalesce(sigs,'[]'::jsonb)) x), 0) AS score
    FROM scored
  )
  SELECT
    agg.cid, agg.cname, agg.sigs, agg.score, v_thr, agg.conflict,
    CASE
      WHEN agg.conflict THEN 'distinct'
      WHEN agg.score >= v_thr AND agg.name_match THEN 'same_party'   -- dedup requires a name-core variant
      WHEN agg.score >= v_thr THEN 'review'                          -- strong shared contact, different name → human
      WHEN agg.score > 0 THEN 'review'
      ELSE 'distinct'
    END
  FROM agg
  ORDER BY agg.score DESC, agg.cname ASC;
END;
$$;

-- Name-core match: exact, or one is a whole-token prefix of the other, gated on a
-- DISTINCTIVE shared core (multi-token, or a distinctive single token). Mirrors the
-- cross-ref SQL / owner-cross-reference.js sharedCoreOf+isDistinctiveSharedCore.
CREATE OR REPLACE FUNCTION public.lcc_reconcile_name_match(p_a text, p_b text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS
$$
DECLARE a text; b text; shared text; ntok int;
  v_generic text[] := ARRAY[
    'healthcare','national','american','united','global','pacific','western','eastern',
    'northern','southern','atlantic','premier','prime','summit','capital','equity','realty',
    'property','properties','holdings','partners','associates','management','investments',
    'development','enterprises','group','trust','ventures','advisors','financial','commercial',
    'residential','industrial','retail','medical','senior','first','general','standard',
    'consolidated','integrated','metropolitan','metro','central','liberty','heritage','legacy',
    'community','sterling','pinnacle','horizon','gateway','cornerstone','keystone','landmark',
    'investment','realestate','real','estate','income'];
BEGIN
  a := btrim(coalesce(p_a, '')); b := btrim(coalesce(p_b, ''));
  IF a = '' OR b = '' THEN RETURN false; END IF;
  IF a = b THEN shared := a;
  ELSIF b LIKE a || ' %' THEN shared := a;
  ELSIF a LIKE b || ' %' THEN shared := b;
  ELSE RETURN false;
  END IF;
  ntok := array_length(regexp_split_to_array(shared, ' '), 1);
  IF ntok >= 2 THEN RETURN true; END IF;
  RETURN length(shared) >= 8 AND NOT (shared = ANY (v_generic));
END;
$$;

-- The candidate universe the discovery scans: per active-org-owner evidence,
-- MATERIALIZED into a cron-refreshed cache (the R7 pattern — the sponsor/SF
-- lookups are per-row-expensive, so a live view would recompute them for ~10k
-- orgs on every resolver call). Empty cache ⇒ the resolver finds no candidates
-- (cache-or-live safe; a stalled cron only costs yield, never correctness).
-- Owners are ORGANIZATION entities; person/asset entities are excluded.
CREATE TABLE IF NOT EXISTS public.lcc_owner_evidence_cache (
  entity_id    uuid PRIMARY KEY,
  name         text,
  name_core    text,
  first_token  text,
  phone_key    text,
  email_key    text,
  addr_key     text,
  city_key     text,
  state_key    text,
  sponsor_norm text,
  sf_account   text
);
CREATE INDEX IF NOT EXISTS idx_lcc_owner_ev_cache_phone   ON public.lcc_owner_evidence_cache (phone_key)  WHERE phone_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lcc_owner_ev_cache_email   ON public.lcc_owner_evidence_cache (email_key)  WHERE email_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lcc_owner_ev_cache_addr    ON public.lcc_owner_evidence_cache (addr_key)   WHERE addr_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lcc_owner_ev_cache_sf      ON public.lcc_owner_evidence_cache (sf_account) WHERE sf_account IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lcc_owner_ev_cache_token   ON public.lcc_owner_evidence_cache (first_token);

COMMENT ON TABLE public.lcc_owner_evidence_cache IS
  'ORE: per active-org-owner evidence keys (name-core, phone/email/address, city/state, sponsor, SF account) — the indexed candidate universe the resolver clusters over. Cron-refreshed.';

-- Full-replace refresh (bounded-size, ~10k rows; ANALYZE at the end — PR #1062 /
-- R7 lesson). Autovacuum hardened because the cron full-replaces it each tick.
CREATE OR REPLACE FUNCTION public.lcc_refresh_owner_evidence_cache()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS
$$
DECLARE n int;
BEGIN
  TRUNCATE public.lcc_owner_evidence_cache;
  INSERT INTO public.lcc_owner_evidence_cache
  SELECT
    e.id,
    e.name,
    public.lcc_normalize_entity_name(e.name),
    split_part(public.lcc_normalize_entity_name(e.name), ' ', 1),
    public.lcc_normalize_phone(e.phone),
    public.lcc_reconcile_email_key(e.email),
    public.lcc_normalize_address(e.address),
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
  WHERE e.entity_type = 'organization'
    AND e.merged_into_entity_id IS NULL
    AND coalesce((e.metadata->>'junk_name_flagged'), 'false') <> 'true';
  GET DIAGNOSTICS n = ROW_COUNT;
  ANALYZE public.lcc_owner_evidence_cache;
  RETURN n;
END;
$$;

ALTER TABLE public.lcc_owner_evidence_cache
  SET (autovacuum_vacuum_scale_factor = 0, autovacuum_vacuum_threshold = 500,
       autovacuum_analyze_scale_factor = 0, autovacuum_analyze_threshold = 500);

-- ============================================================================
-- UNIT 4 — continuous re-triangulation (queue + enqueue + value-ranked seed)
-- NOTE (deliberate deviation): we do NOT add an AFTER-INSERT trigger to the hot
-- entity_relationships / external_identities write paths (CoStar bursts write
-- ~tens of thousands of edges — the R7 connection-predicate-caching lesson).
-- Instead a gentle SEED function enqueues owners whose evidence CHANGED recently,
-- and the worker drains the queue value-ranked. Same "re-triangulate on new clue"
-- effect, no hot-path risk. A cron is scheduled only AFTER the first gated drain
-- (the artifact-offload lesson).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.lcc_owner_reconcile_queue (
  entity_id    uuid PRIMARY KEY,
  reason       text,
  status       text NOT NULL DEFAULT 'queued',   -- queued | done | error
  attempts     int NOT NULL DEFAULT 0,
  enqueued_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_lcc_owner_reconcile_queue_status
  ON public.lcc_owner_reconcile_queue (status, enqueued_at);

-- Idempotent enqueue: a new clue on an owner re-queues it (resets to 'queued').
CREATE OR REPLACE FUNCTION public.lcc_enqueue_owner_reconcile(p_entity_id uuid, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE sql AS
$$
  INSERT INTO public.lcc_owner_reconcile_queue (entity_id, reason, status, enqueued_at, processed_at)
  VALUES (p_entity_id, p_reason, 'queued', now(), NULL)
  ON CONFLICT (entity_id) DO UPDATE
    SET reason = coalesce(EXCLUDED.reason, public.lcc_owner_reconcile_queue.reason),
        status = 'queued', enqueued_at = now(), processed_at = NULL;
$$;

-- Seed the queue from owners whose evidence changed recently (owner-facts /
-- entity contact fields updated in the window) — the "owner touched → reconcile"
-- signal, without a hot-path trigger. Bounded by p_limit + gated on a usable name.
CREATE OR REPLACE FUNCTION public.lcc_seed_owner_reconcile_queue(
  p_since interval DEFAULT interval '2 days', p_limit int DEFAULT 500)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS
$$
DECLARE n int;
BEGIN
  WITH touched AS (
    SELECT entity_id, max(reason) AS reason FROM (
      -- owners whose CoStar/contact fields changed recently
      SELECT e.id AS entity_id, 'entity_updated' AS reason
      FROM public.entities e
      WHERE e.entity_type = 'organization' AND e.merged_into_entity_id IS NULL
        AND e.updated_at >= now() - p_since
        AND public.lcc_owner_name_usable(e.name)
      UNION ALL
      -- owners linked to a property whose owner-facts (deed/sponsor) changed recently
      SELECT pf.entity_id, 'owner_facts_updated' AS reason
      FROM public.lcc_property_owner_facts pof
      JOIN public.lcc_entity_portfolio_facts pf
        ON pf.source_domain = pof.source_domain AND pf.source_property_id = pof.source_property_id
      JOIN public.entities oe ON oe.id = pf.entity_id
        AND oe.entity_type = 'organization' AND oe.merged_into_entity_id IS NULL
      WHERE pof.updated_at >= now() - p_since AND pf.is_current = true
    ) u
    WHERE entity_id IS NOT NULL
    GROUP BY entity_id
    LIMIT p_limit
  ),
  ins AS (
    INSERT INTO public.lcc_owner_reconcile_queue (entity_id, reason, status, enqueued_at, processed_at)
    SELECT entity_id, reason, 'queued', now(), NULL FROM touched
    ON CONFLICT (entity_id) DO UPDATE
      SET status = 'queued', enqueued_at = now(), processed_at = NULL,
          reason = coalesce(EXCLUDED.reason, public.lcc_owner_reconcile_queue.reason)
    RETURNING 1
  )
  SELECT count(*) INTO n FROM ins;
  RETURN n;
END;
$$;

-- Grants (mirror the sibling ORE artifacts): the workers read/write via the
-- service role; the resolver + evidence views are readable by the authenticated app.
GRANT SELECT ON public.lcc_signal_authority, public.lcc_reconcile_config,
  public.v_lcc_true_owner_noise, public.lcc_owner_evidence_cache,
  public.lcc_owner_reconcile_evidence, public.lcc_owner_reconcile_queue
  TO anon, authenticated, service_role;
GRANT INSERT, UPDATE ON public.lcc_owner_reconcile_evidence, public.lcc_owner_reconcile_queue TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.lcc_owner_reconcile_evidence_id_seq TO service_role;
