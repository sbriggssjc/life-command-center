-- OWN-T0c / N15c: trailing "The" adopted into the canonical key, plus the
-- general fuzzy-merge sweep it unblocked (Scott, 2026-09-15).
--
-- Decision (verbatim): "Good question. I'm not sure I care so long as we are
-- getting to truth and accuracy as the priority. If they are the same
-- entities, merge. I don't have a preference about the naming structure."
--
-- This re-applies a change that was built, sized, and FULLY REVERTED in an
-- earlier session (batch own_t0c_trailing_the_2026-09-14) for lack of
-- authorization. It is now adopted permanently with Scott's explicit sign-off
-- the next day.
--
-- What changed: lcc_entity_name_tokens now strips a trailing "The" token
-- (not just a leading one), using a `count(*) over ()` window column to know
-- the last surviving token position. KNOWN QUIRK, carried over verbatim into
-- the JS mirror (api/_shared/entity-link.js, see its comment): `ord` is the
-- token's RAW pre-stoplist position, `total` is the POST-stoplist survivor
-- count -- not a re-numbered position. So "Penstar Group, The" (no stoplist
-- word ahead of "The") strips to 'penstar group', but "Edwin Mcintyre Co.,
-- Inc., The" does NOT strip, because "Inc." is removed by the stoplist first
-- and shifts total below ord. Do not "fix" this without re-running the N15c
-- backfill and the merge-candidate sweep below -- this is the intentionally
-- shipped, live-verified behavior.
--
-- Applied and verified live on xengecqvemvfknjvbvrq (this migration mirrors
-- what was already run there via mcp__Supabase__apply_migration /
-- execute_sql, since RLS/ownership on this project means Cowork's Supabase
-- tools are the actual execution path, not `supabase db push`):
--   1. lcc_entity_name_tokens / lcc_entity_canonical_key redefined (below).
--   2. lcc_n15c_backfill_canonical_names(dry_run=false,
--      batch_tag='own_t0c_trailing_the_adopted_2026-09-15'): 25 rows
--      rewritten, 18 held stale (conservative guard -- stored value predated
--      even the old leading-only rule), ~67,3xx already correct.
--   3. 10 of those 18 held-stale rows, corresponding to 5 of 12 confirmed
--      merge-target collision groups (Buncher Company, Carrington Company,
--      Lund Company, North Dakota Guaranty and Title Co, State-Whitehall
--      Company LP), were manually corrected: UPDATE entities SET
--      canonical_name = lcc_entity_canonical_key(name), logged to
--      lcc_n15c_canonical_backfill_log with batch_tag
--      'own_t0c_trailing_the_adopted_2026-09-15_manual'.
--   4. 12 confirmed trailing-"The" collision groups (16 entities) merged via
--      lcc_merge_entity in a single DO block. Effect on the
--      property-conflict-scoped duplicate_entity class: 1,183 -> 1,177
--      (only -6) -- most of that population is a SEPARATE collision class,
--      not explained by trailing-"The" alone.
--   5. Measured the FULL canonical_name collision population (not scoped to
--      property conflicts): 6,636 groups / 14,007 entities -- this is the
--      true scope of "if they are the same entities, merge."
--   6. Reviewed existing machinery before building anything new (per
--      standing doctrine) and found v_lcc_merge_candidates + the dormant
--      lcc_apply_fuzzy_merges(dry_run, [limit]) already implement exactly
--      this: role-priority survivor selection, Salesforce-account-aware
--      guards, name-similarity gating, and a "pinned" protection for bridged
--      unknown-role entities, applying through the same guarded
--      lcc_merge_entity primitive. Dry run: 3,021 groups / 3,305 entities
--      auto_mergeable, sane on inspection (short-code LLC names, DBA/legal
--      variants, no generic/ambiguous collisions). RAN LIVE:
--      lcc_apply_fuzzy_merges(false) -- 3,021 groups applied, 3,305 entities
--      merged, 0 failures, fully logged to lcc_entity_merge_log (reversible
--      per-row via the same snapshot mechanism lcc_merge_entity always uses).
--   7. Re-measured after the sweep: canonical_name collision population
--      6,636/14,007 -> 3,772/8,005 groups/entities. duplicate_entity
--      (property-conflict-scoped) class: 1,177 -> 930.
--   8. Remaining 3,772/8,005 population is the harder, review-gated tail
--      v_lcc_merge_candidates already routes to human review:
--      bridged_unknown_pinned (1,644g/3,538e), no_role_or_sf_signal
--      (337g/682e), multiple_sf_accounts (89g/193e), low_name_similarity
--      (64g/143e), normalizer_blind_review_only (64g/175e). This tail is NOT
--      swept by this migration -- it needs its own review pass, since the
--      view's own gates exist precisely because same-canonical-name alone
--      isn't proof of same-entity in these cases (multiple distinct
--      Salesforce accounts, or an entity bridged in with an unknown role that
--      hasn't been confirmed).
--
-- This file is DDL-only (the function redefinition); steps 2-7 above were
-- data operations run directly against the live database and are not
-- re-playable by re-running this migration -- they are documented here so
-- the audit trail is complete and so the JS mirror's comment makes sense
-- without needing this file's history.

create or replace function public.lcc_entity_name_tokens(p_name text)
returns text[]
language sql
immutable
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce((
    select array_agg(tok order by ord)
    from (
      select tok, ord, count(*) over () as total
      from unnest(string_to_array(
             btrim(regexp_replace(regexp_replace(regexp_replace(
               lower(coalesce(p_name,'')), '&',' and ','g'),
               '[^a-z0-9]+',' ','g'), '\s+',' ','g')), ' ')) with ordinality as u(tok, ord)
      where tok <> ''
        and tok not in ('llc','llp','lp','inc','incorporated','corp','corporation',
                        'ltd','limited','trust','reit','dst','lllp','lc','pllc')
    ) z
    where not (z.ord = 1 and z.tok = 'the')
      and not (z.ord = z.total and z.tok = 'the')
  ), '{}'::text[]);
$function$;

comment on function public.lcc_entity_name_tokens(text) is
  'Scott 2026-09-15: strips a leading OR trailing "The" token (previously '
  'leading-only). "If they are the same entities, merge. I dont have a '
  'preference about the naming structure." KNOWN QUIRK: the trailing strip '
  'compares the RAW pre-stoplist token position against the POST-stoplist '
  'survivor count, so a legal-form word (Inc./Co./LLC/...) appearing before a '
  'trailing "The" prevents the strip (e.g. "Edwin Mcintyre Co., Inc., The" '
  'keeps its trailing "the"). Mirrored verbatim, quirk included, in '
  'api/_shared/entity-link.js entityNameTokens() -- do not diverge without '
  're-running lcc_n15c_backfill_canonical_names and the fuzzy-merge sweep.';

create or replace function public.lcc_entity_canonical_key(p_name text)
returns text
language sql
immutable
set search_path to 'public', 'pg_temp'
as $function$
  select case
           when cardinality(public.lcc_entity_name_tokens(p_name)) > 0
             then array_to_string(public.lcc_entity_name_tokens(p_name), ' ')
           else 'dc:' || regexp_replace(lower(coalesce(p_name,'')), '[^a-z0-9]+', '', 'g')
         end;
$function$;
