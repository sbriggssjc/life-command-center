-- ============================================================================
-- P134 part 2 — feed the domain-confirmed note leads into the EXISTING P114
--               owner-contact review lane. No new writer.
-- Applied live to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-18.
-- ----------------------------------------------------------------------------
-- P114 already owns the confirm path: it re-runs the shape gate server-side
-- (owner-contact-verdict-planner.validateVerdict), mints/resolves the person via
-- ensureEntityLink, links with linkPersonToEntity, ledgers the edge id for
-- reversal, and offers reject as a terminal verdict. Forking a second writer for
-- 12 rows would duplicate every one of those guards. So this seeds PROPOSALS.
--
-- The human verdict stays a human verdict. Scott's validation is exactly why:
-- an auto-attach on the un-narrowed lane would have written ~277 wrong contacts,
-- and the naive version of my own domain rule would have written the $31M one.
--
-- LIVE RESULT 2026-08-18: 12 proposals, 11 distinct owner entities, 8 distinct
-- people, $17.6M annual rent. entity_relationships rows written: 0 (by design).
--
-- REVERSAL:
--   delete from lcc_owner_contact_propagate_review
--    where batch_tag = 'p134_note_domain_confirmed' and status = 'pending';
--   -- rows already confirmed reverse through the P114 ledger (applied_log_id),
--   -- which records the exact entity_relationships edge id to drop.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_p134_seed_note_domain_confirmed(
  p_dry_run boolean DEFAULT true
) RETURNS TABLE (
  action text,
  owner_name text,
  contact_name text,
  contact_email text,
  annual_rent numeric
)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
declare
  v_batch text := 'p134_note_domain_confirmed';
begin
  create temp table _p134_cand on commit drop as
  select distinct on (r.candidate_sf_id, r.owner_entity_id)
    ('note:' || r.candidate_sf_id || ':' || r.owner_entity_id::text) as subject_ref,
    r.owner_entity_id,
    r.owner_name,
    r.source_domain,
    r.candidate_sf_id,
    r.candidate_name,
    r.candidate_email,
    r.candidate_phone,
    r.annual_rent,
    r.matched_on_note,
    r.note_authors,
    r.note_last_written,
    r.lcc_tenant, r.city, r.state
  from public.v_lcc_note_lead_attach_review r
  where public.lcc_email_domain_confirms_owner(r.candidate_email, r.owner_name)
  order by r.candidate_sf_id, r.owner_entity_id, r.annual_rent desc nulls last;

  if p_dry_run then
    return query
      select
        case when x.subject_ref is null then 'would_insert' else 'already_present' end::text,
        c.owner_name::text, c.candidate_name::text, c.candidate_email::text, c.annual_rent
      from _p134_cand c
      left join public.lcc_owner_contact_propagate_review x using (subject_ref)
      order by c.annual_rent desc nulls last;
    return;
  end if;

  insert into public.lcc_owner_contact_propagate_review (
    subject_ref, batch_tag, owner_entity_id, owner_name, source_domain,
    source_contact_id, source_bound_by, contact_name, contact_email, contact_phone,
    contact_type, data_source, reason, evidence, rank_value, status
  )
  select
    c.subject_ref, v_batch, c.owner_entity_id, c.owner_name, c.source_domain,
    c.candidate_sf_id, 'salesforce_note', c.candidate_name, c.candidate_email,
    c.candidate_phone, 'decision_maker', 'sf_note_2024',
    'note_lead_domain_confirmed',
    jsonb_build_object(
      'note_title',        c.matched_on_note,
      'note_authors',      c.note_authors,
      'note_last_written', c.note_last_written,
      'tenant',            c.lcc_tenant,
      'city',              c.city,
      'state',             c.state,
      'email_domain',      split_part(c.candidate_email, '@', 2),
      'rule',              'lcc_email_domain_confirms_owner',
      -- the honest caveat travels WITH the proposal, so whoever works the card
      -- knows the base rate of the population it came from
      'caveat',            'Scott validated a 10-row sample of the un-narrowed '
                        || 'note lane: ~1 in 10 was the current contact; the rest '
                        || 'were prior owners, developers, brokers, tenants. '
                        || 'This row additionally passes the email-domain test.'
    ),
    c.annual_rent, 'pending'
  from _p134_cand c
  on conflict (subject_ref) do nothing;

  return query
    select 'inserted'::text, c.owner_name::text, c.candidate_name::text,
           c.candidate_email::text, c.annual_rent
    from _p134_cand c
    join public.lcc_owner_contact_propagate_review p using (subject_ref)
    where p.batch_tag = v_batch
    order by c.annual_rent desc nulls last;
end;
$$;

COMMENT ON FUNCTION public.lcc_p134_seed_note_domain_confirmed(boolean) IS
  'P134. Seeds the domain-confirmed note leads as PROPOSALS in the P114 lane. '
  'Dry-run default, idempotent on subject_ref. REVERSAL: delete from '
  'lcc_owner_contact_propagate_review where batch_tag=''p134_note_domain_confirmed'' '
  'and status=''pending'';  -- confirmed rows reverse via the P114 ledger.';

GRANT EXECUTE ON FUNCTION public.lcc_p134_seed_note_domain_confirmed(boolean) TO service_role;
