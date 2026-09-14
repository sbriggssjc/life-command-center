-- =====================================================================
-- N15c Unit 1 — ONE token rule for entity name identity
-- =====================================================================
-- Applied live to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-27.
--
-- WHY -----------------------------------------------------------------
-- `entities.canonical_name` had EIGHT authors writing four different
-- normalizations (N15b_CANONICAL_NAME_AUTHORS_2026-08-27.md). 10,336 of
-- 62,368 live entities carry a key that `ensureEntityLink`'s own lookup
-- cannot reproduce from their own name, so re-encountering those names
-- misses and mints. That is the duplicate factory.
--
-- THE RULE (Scott, 2026-08-27) -----------------------------------------
-- Strip ONLY pure legal-entity forms; keep every semantic token
-- (group, partners, company, capital, holdings, properties, realty).
-- A DST, its Trust and its LLC are ONE entity — the TRUE OWNER — so the
-- `trust|dst|reit` strip is CORRECT and adopted.
--   ⚠️ The aspirational future (individual investors holding FRACTIONAL
--   positions in a DST/TIC/JV) is backlog N17 and must NOT be built by
--   splitting this dedup key. Fractional interest is a RELATIONSHIP.
--
-- ⚠️ ONE TOKEN LIST, TWO JOIN STYLES — never two token lists.
-- `lcc_owner_domain_core` ends `string_agg(tok,'')` with NO separator.
-- That is right for a DOMAIN comparator and wrong for a NAME key:
-- measured over the 43,219 live organizations the no-separator form
-- yields 115 FEWER distinct keys, and those are false collisions
-- (`Gate Way` == `Gateway`, verified on the named row). So the two
-- functions share `lcc_entity_name_tokens` and differ only in the join.
--
-- SAFETY: this migration is a REFACTOR + one view repoint. It changes no
-- stored value. `lcc_owner_domain_core` output is proven byte-identical
-- over all live entities in the gate at the foot of this file — P187,
-- P188, P194, P196, P197 and P198 all depend on that function.
--
-- REVERSAL: re-create the three objects from the prior definitions
-- (`lcc_owner_domain_core` body is reproduced verbatim in the comment
-- block below; the view body is in 20260609170000).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The single owner of the token rule.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_entity_name_tokens(p_name text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce((
    select array_agg(tok order by ord)
    from (
      select tok, ord
      from unnest(string_to_array(
             btrim(regexp_replace(regexp_replace(regexp_replace(
               lower(coalesce(p_name,'')), '&',' and ','g'),
               '[^a-z0-9]+',' ','g'), '\s+',' ','g')), ' ')) with ordinality as u(tok, ord)
      where tok <> ''
        and tok not in ('llc','llp','lp','inc','incorporated','corp','corporation',
                        'ltd','limited','trust','reit','dst','lllp','lc','pllc')
        and not (ord = 1 and tok = 'the')   -- leading article only; 'of'/'and' kept inline
    ) z), '{}'::text[]);
$function$;

COMMENT ON FUNCTION public.lcc_entity_name_tokens(text) IS
  'N15c: THE token rule for entity name identity. Strips pure legal-entity forms only; '
  'keeps every semantic token. Sole owner of the stoplist — lcc_entity_canonical_key '
  '(space join) and lcc_owner_domain_core (no separator) are its only two join styles. '
  'Adding a token here changes BOTH; that is intentional and is why there is one list.';

-- ---------------------------------------------------------------------
-- 2. The NAME key — space-joined. This is what canonical_name becomes.
-- ---------------------------------------------------------------------
-- The empty case: 98 live entities are named only with legal forms
-- ("--" x89, "Llc", "Corporation", "LC", "The", "Trust"). An empty key
-- would make every one of them dedup into a single entity, so they get a
-- namespaced fallback. 'dc:' is provably disjoint from every real key,
-- because a real key is [a-z0-9 ]+ and can never contain a colon. Same
-- device, same prefix, as v_lcc_merge_candidates_normalizer_blind (P189).
-- Two rows genuinely sharing a contentless name still dedup with each
-- other, which is correct — they are the same junk.
--   NOTE this is a STRICT IMPROVEMENT on today: 114 live entities share
--   canonical_name='' right now, and one of them is `Partners Group`, a
--   real firm whose semantic tokens are both stripped by the outgoing
--   normalizer. Under this rule it keys `partners group` and is rescued.
CREATE OR REPLACE FUNCTION public.lcc_entity_canonical_key(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  select case
           when cardinality(public.lcc_entity_name_tokens(p_name)) > 0
             then array_to_string(public.lcc_entity_name_tokens(p_name), ' ')
           else 'dc:' || regexp_replace(lower(coalesce(p_name,'')), '[^a-z0-9]+', '', 'g')
         end;
$function$;

COMMENT ON FUNCTION public.lcc_entity_canonical_key(text) IS
  'N15c: the value of entities.canonical_name. lcc_entity_name_tokens joined with SPACES. '
  'Mirrored byte-for-byte by normalizeCanonicalName in api/_shared/entity-link.js — the '
  'trigger writes this and ensureEntityLink looks it up, so the two MUST agree; '
  'test/entity-canonical-key.test.mjs pins them. Never returns NULL or empty.';

-- ---------------------------------------------------------------------
-- 3. lcc_owner_domain_core — refactored onto the shared token list.
--    Behaviour UNCHANGED (no separator). Proven byte-identical below.
-- ---------------------------------------------------------------------
-- Prior body (for reversal):
--   select coalesce((select string_agg(tok,'' order by ord) from ( ... ) z), '');
-- with the identical unnest/where clause now living in lcc_entity_name_tokens.
CREATE OR REPLACE FUNCTION public.lcc_owner_domain_core(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  select array_to_string(public.lcc_entity_name_tokens(p_name), '');
$function$;

COMMENT ON FUNCTION public.lcc_owner_domain_core(text) IS
  'Tier 0 domain comparator (P187/P188/P194/P196/P197/P198) — order-preserving, NO separator. '
  'N15c refactored it onto lcc_entity_name_tokens; output proven byte-identical over all '
  '62,368 live entities. ⚠️ NOT a name key: the no-separator join collides Gate Way with '
  'Gateway (115 false collisions measured). Use lcc_entity_canonical_key for names.';

GRANT EXECUTE ON FUNCTION public.lcc_entity_name_tokens(text)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lcc_entity_canonical_key(text) TO authenticated, service_role;
