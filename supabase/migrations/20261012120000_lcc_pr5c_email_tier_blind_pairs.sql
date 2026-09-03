-- PR5c-entities-c — make the EMAIL tier's domain blindness visible (and keep it).
--
-- PR5c-entities-b-dupes removed a hard `&domain=eq.<domain>` filter from
-- ensureEntityLink()'s canonical_name tier, because `entities.domain` is a
-- PROVENANCE TAG (it legitimately carries lcc / cre beside dia / gov), not part
-- of identity. It fixed ONE tier. The sibling tier -- R39 Unit 1's EMAIL tier,
-- the fallback that exists precisely to catch what the canonical tier misses --
-- carries the IDENTICAL filter at entity-link.js:1168, and nobody checked it.
-- That is the documented "the hazard travels with the TECHNIQUE, not the name"
-- pattern (P189), one round later, in the same function.
--
-- THE FILTER IS DELIBERATELY LEFT IN PLACE, and this view is why. Removing it
-- was the obvious fix; it was measured on named rows and REFUSED:
--
--   55 live cross-domain person pairs share a non-generic email and carry
--   DIFFERENT canonical names (so the canonical tier cannot catch them either).
--   Read on named rows: 15 are the same person under a name variant
--   (Andy/Andrew Nathan, Carl/Carl J. Verstandig, Nicholas/Nick Borrelli,
--   Steven/Steve Karlson, Vince/Vincent Curran, Ravi/Ravindra G. Gangavaram...).
--   40 are NOT: two different real brokers on one mailbox
--   (Phillip Kelly / Toby Scrivner @northmarq.com; Jack Minter / Creighton
--   Stark; David Gellner / Matthew Dodson), a FIRM filed as a person
--   ("Marcus & Millichap", "Kidder Mathews", "Global Net Lease"), and P131
--   document row-labels ("Income & Expenses", "Per SF", "Condo Size",
--   "First Vice President", "This was an all-cash deal.").
--
--   PRECISION 27% (15/55). This codebase has twice measured a signal in that
--   band and rejected it: P189's domain-keyed merge grouping at 25%, P198's
--   co-proposal at 7%. Dropping the filter would auto-ATTACH 40 wrong parties
--   at the identity choke point -- strictly worse than the 15 duplicates it
--   would prevent, because an attach is not reversible by leaving it alone.
--
--   There is no safe corroboration available here. The canonical tier matches
--   on NAME and can require EMAIL to agree cross-domain. The email tier matches
--   on EMAIL, so the symmetric corroboration would be a NAME test -- and fuzzy
--   name matching is banned for identity throughout this codebase.
--
-- So the 15 genuine pairs are surfaced for a HUMAN, and the blindness is stated
-- rather than left as absence (I4 / B6a: a skipped step must emit, not vanish).
-- Read-only. NO `auto_mergeable` column, deliberately: lcc_apply_fuzzy_merges()
-- loops on that flag and would merge the 40 wrong pairs unattended (P198).

-- Mirrors GENERIC_INBOX_LOCALPARTS in api/_shared/entity-link.js. Two copies of
-- one list is the normaliser drift this repo warns about, so the JS Set and this
-- array are pinned token-for-token by
-- test/pr5c-entities-c-email-tier-domain-scope.test.mjs -- if one gains a word
-- and the other does not, that test goes RED.
create or replace function lcc_is_generic_inbox_localpart(p_email text)
returns boolean
language sql
immutable
as $$
  select case
    when p_email is null then false
    -- normalizeEmail(): must have the basic local@domain.tld shape, else it is
    -- not a resolution key at all. Plus-addressing reduces to the base local.
    when lower(btrim(p_email)) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then false
    else split_part(split_part(lower(btrim(p_email)), '@', 1), '+', 1) = any (array[
      'info','sales','leasing','admin','contact','contacts','office','hello',
      'support','team','marketing','hr','jobs','careers','noreply','no-reply',
      'donotreply','accounting','billing','legal','mail','email','general',
      'inquiries','enquiries','help','service','services','webmaster','postmaster'
    ])
  end;
$$;

comment on function lcc_is_generic_inbox_localpart(text) is
  'PR5c-entities-c. SQL mirror of isGenericInboxEmail() in api/_shared/entity-link.js. '
  'Pinned token-for-token by test/pr5c-entities-c-email-tier-domain-scope.test.mjs.';

create or replace view v_lcc_entity_email_tier_blind_pairs as
with pairs as (
  select
    a.id            as entity_a_id,
    b.id            as entity_b_id,
    a.name          as name_a,
    b.name          as name_b,
    a.domain        as domain_a,
    b.domain        as domain_b,
    lower(btrim(a.email)) as shared_email,
    a.canonical_name as canonical_a,
    b.canonical_name as canonical_b,
    a.created_at    as created_a,
    b.created_at    as created_b
  from entities a
  join entities b
    on lower(btrim(a.email)) = lower(btrim(b.email))
   and a.workspace_id = b.workspace_id
   and a.id < b.id
  where a.entity_type = 'person'
    and b.entity_type = 'person'
    and a.merged_into_entity_id is null
    and b.merged_into_entity_id is null
    and a.email is not null
    and b.email is not null
    -- the email tier never auto-attaches a shared firm/role inbox
    and not lcc_is_generic_inbox_localpart(a.email)
    -- DIFFERENT canonical key => the canonical_name tier cannot resolve this
    -- pair either, so the email tier is the only one that could have
    and a.canonical_name is distinct from b.canonical_name
    -- DIFFERENT domain => `&domain=eq.` excludes the counterpart from the
    -- email tier's candidate set. This is the blindness.
    and a.domain is distinct from b.domain
)
select
  entity_a_id, entity_b_id, name_a, name_b, domain_a, domain_b,
  shared_email, canonical_a, canonical_b, created_a, created_b,
  'cross_domain_email_tier_blind'::text as blind_reason
from pairs;

comment on view v_lcc_entity_email_tier_blind_pairs is
  'PR5c-entities-c. Live person pairs sharing a non-generic email that NEITHER '
  'ensureEntityLink tier can resolve: different canonical_name (canonical tier '
  'cannot match) and different domain (email tier''s &domain=eq. excludes them). '
  'Measured 27% same-person precision (15 of 55) -- MOST ROWS ARE NOT DUPLICATES: '
  'two real people on one mailbox, firms filed as persons, and P131 document row '
  'labels. HUMAN REVIEW ONLY. Never auto-merge, never auto-attach; there is '
  'deliberately no auto_mergeable column (P198).';

grant select on v_lcc_entity_email_tier_blind_pairs to anon, authenticated, service_role;
