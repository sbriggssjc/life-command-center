-- ============================================================================
-- P134 — the note-lead attach rule, corrected after Scott's validation
-- Applied live to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-18.
-- ----------------------------------------------------------------------------
-- WHY THIS EXISTS
--   P132 surfaced 294 owners with a note-derived contact candidate. Scott's
--   row-by-row validation of a 10-row sample says only ~1 in 10 is the CURRENT
--   contact; the rest are prior owners, developers, brokers and tenants -- the
--   notes are an ownership-CHAIN record, not a contact list.
--
--   I proposed "email domain matches the owner" as the discriminator and
--   measured it with a naive substring test. That test was wrong in the most
--   embarrassing possible way: 'me.com' (Apple consumer mail) matched the
--   literal 'me' inside 'governmentincomeproperties', so my "domain-confirmed"
--   set contained Lee Elman / Government Properties Income Trust at $31M --
--   the single highest-value row, and the exact row Scott rejected FIRST.
--   The corrected rule cuts the claim from "16 owners / $50.3M" to
--   "11 owners / $17.6M".
--
-- THE CORRECTED RULE (single-sourced here so seed and view cannot drift)
--   1. free-mail domains are never corroboration      (me/gmail/yahoo/...)
--   2. the domain root must be >= 4 chars             (kills 'me', 'aol')
--   3. it must EQUAL a token of the owner's strict core, or be a prefix
--      extension of the concatenated core             (stoltzfusm ~ stoltzfus,
--                                                      alteradevco ~ alteradev)
--   No substring containment. 'me' inside 'income' is exactly the class of
--   false positive rule 3 exists to refuse.
--
--   lcc_owner_strict_core is deliberate: lcc_normalize_entity_name and
--   dup-pair-planner.ownerCore both strip semantic tokens and are BANNED for
--   identity (CLAUDE.md). Strict core strips only legal-entity forms.
--
-- REVERSAL: DROP FUNCTION public.lcc_email_domain_confirms_owner(text, text);
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_email_domain_confirms_owner(
  p_email text,
  p_owner_name text
) RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  with parts as (
    select
      lower(split_part(split_part(coalesce(p_email,''), '@', 2), '.', 1)) as email_root,
      coalesce(lower(public.lcc_owner_strict_core(p_owner_name)), '')     as core
  ), shaped as (
    select
      email_root,
      core,
      replace(core, ' ', '')          as core_concat,
      string_to_array(core, ' ')      as core_tokens
    from parts
  )
  select
    email_root <> ''
    and length(email_root) >= 4
    and core_concat <> ''
    -- (1) never treat consumer mail as corroboration of a company
    and email_root not in (
      'gmail','yahoo','hotmail','outlook','icloud','aol','msn','live','mail',
      'comcast','verizon','sbcglobal','bellsouth','earthlink','cox','ymail',
      'protonmail','proton','gmx','zoho','me','mac','att','att-net','rocketmail',
      'juno','netzero','optonline','roadrunner','charter','windstream','frontier'
    )
    and (
      -- (2) the domain root IS one of the owner's own name tokens
      email_root = any(core_tokens)
      -- (3) or the root extends the whole core (stoltzfusm / alteradevco)
      or email_root like core_concat || '%'
    )
  from shaped;
$$;

COMMENT ON FUNCTION public.lcc_email_domain_confirms_owner(text, text) IS
  'P134. Single source of the "this person''s email domain IS this owner" test. '
  'Token-equality or whole-core prefix ONLY -- never substring containment, which '
  'matched me.com into "government INCOME properties" and would have attached the '
  'wrong contact to a $31M prospect. Free-mail domains are never corroboration.';

GRANT EXECUTE ON FUNCTION public.lcc_email_domain_confirms_owner(text, text)
  TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Live gate (14/14 on 2026-08-18) -- accepts the real ones, refuses the two
-- Scott rejected:
--
--   select n, em, lcc_email_domain_confirms_owner(em, n) from (values
--     ('UIRC','biz@uirc.com'),                      -- true
--     ('Stoltzfus LLC','donna@stoltzfusm.com'),     -- true  (prefix rule)
--     ('Altera Dev','tq@alteradevco.com'),          -- true  (prefix rule)
--     ('Government Properties Income Trust','lee.eii@me.com'),   -- FALSE
--     ('COARRA WASHINGTON INVESTMENTS LLC','johnandvonda@me.com')-- FALSE
--   ) v(n,em);
-- ---------------------------------------------------------------------------
