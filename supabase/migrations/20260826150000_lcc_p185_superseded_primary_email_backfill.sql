-- ============================================================================
-- P185 — repoint contacts whose PRIMARY email is a dead firm to the live one
--        already on file (2026-08-26). APPLIED LIVE, batch p185-swap-20260826.
--
-- The forward fix (pickBestEmail preferring a live domain over a superseded one) only
-- affects NEW ingests. Measured: **101 contacts carry a dead `@stanjohnsonco.com` primary**
-- (Stan Johnson Company, acquired by Northmarq) and **52 already hold a live
-- `@northmarq.com` address in email_aliases**. Those can be corrected deterministically —
-- the live address is already on the row, so nothing is inferred, guessed or fetched.
--
-- ⚠️ EMAIL IS THE IDENTITY KEY, so a swap can COLLIDE with a row that already holds the
-- live address. Measured before writing: **51 clean, 1 collision.** The collision is
--     Amy Dane <adane@stanjohnsonco.com>   vs   Amy Moyer <adane@northmarq.com>
-- — same local-part, different surname: one person after a name change, held as two rows.
-- That is a MERGE requiring a human, not a swap, and it is left for review.
--
-- ⚠️ AND IT IS THE FUZZY-NAME LESSON RUNNING BACKWARDS. This codebase repeatedly warns that
-- name similarity produces false POSITIVES for identity. Here it would produce a false
-- NEGATIVE: "Dane" vs "Moyer" scores low and a name matcher would miss a real duplicate
-- entirely. The email LOCAL-PART is what identifies them. **A local-part collision across a
-- superseded/live domain pair is a strong duplicate signal** and deserves its own detector.
--
-- The 49 dead primaries with NO live address on file are deliberately untouched — there is
-- nothing to swap to and inventing one would be fabrication.
--
-- Fill-blanks discipline does not apply (this REPLACES a value), so the guard is instead:
-- only ever swap to an address the row ALREADY carries, and keep the old one as an alias —
-- the employer trail is the "where did this person go" signal, never discarded.
--
-- GATES (all PASS): dead primaries 101 -> 50; 51/51 kept the dead address as an alias;
-- 0 duplicate primary emails created; re-run yields 0; Ken Hedrick now reads
-- khedrick@northmarq.com.
--
-- REVERSAL: select * from lcc_p185_unswap('p185-swap-20260826');
-- ============================================================================

create table if not exists lcc_p185_primary_email_swap_log (
  id            bigserial primary key,
  batch_tag     text not null,
  unified_id    uuid not null,
  full_name     text,
  prior_email   text not null,
  new_email     text not null,
  prior_aliases text[],
  swapped_at    timestamptz not null default now(),
  reverted_at   timestamptz
);

create or replace function lcc_p185_swap_superseded_primary_email(
  p_dry_run boolean default true,
  p_batch   text default null
) returns table(action text, contacts bigint)
language plpgsql as $$
declare v_batch text := coalesce(p_batch, 'p185-' || to_char(now(),'YYYYMMDDHH24MI'));
begin
  drop table if exists _swap;
  create temp table _swap on commit drop as
  select u.unified_id, u.full_name, u.email as prior_email, u.email_aliases as prior_aliases,
         (select a from unnest(u.email_aliases) a where lower(a) like '%@northmarq.com' limit 1) as new_email
  from unified_contacts u
  where u.email ilike '%@stanjohnsonco.com'
    and exists (select 1 from unnest(coalesce(u.email_aliases,'{}')) a where lower(a) like '%@northmarq.com');

  -- A row that already holds the live address is a DUPLICATE PERSON, not a swap target.
  delete from _swap s
   where exists (select 1 from unified_contacts u2
                  where lower(u2.email) = lower(s.new_email) and u2.unified_id <> s.unified_id);

  if p_dry_run then
    return query select 'DRY-RUN swap primary to the live domain'::text, count(*)::bigint from _swap;
    return;
  end if;

  insert into lcc_p185_primary_email_swap_log(batch_tag, unified_id, full_name, prior_email, new_email, prior_aliases)
  select v_batch, s.unified_id, s.full_name, s.prior_email, s.new_email, s.prior_aliases from _swap s;

  update unified_contacts u
     set email = s.new_email,
         email_aliases = (
           select array_agg(distinct x) from unnest(
             array_remove(coalesce(s.prior_aliases,'{}'), s.new_email) || array[s.prior_email]
           ) x where x is not null and x <> ''
         ),
         updated_at = now()
  from _swap s where u.unified_id = s.unified_id;

  return query select 'SWAPPED (batch ' || v_batch || ')', count(*)::bigint from _swap;
end $$;

create or replace function lcc_p185_unswap(p_batch text)
returns table(action text, contacts bigint) language plpgsql as $$
begin
  update unified_contacts u
     set email = l.prior_email, email_aliases = l.prior_aliases, updated_at = now()
  from lcc_p185_primary_email_swap_log l
  where l.batch_tag = p_batch and l.reverted_at is null and u.unified_id = l.unified_id;
  update lcc_p185_primary_email_swap_log set reverted_at = now()
   where batch_tag = p_batch and reverted_at is null;
  return query select 'REVERTED ' || p_batch, count(*)::bigint
               from lcc_p185_primary_email_swap_log where batch_tag = p_batch and reverted_at is not null;
end $$;
