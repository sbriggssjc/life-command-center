-- ============================================================================
-- 20260729140000_actor_identity_foundation.sql   (OPS xengecqvemvfknjvbvrq)
-- Applied live 2026-07-29. B2 Phase 1 (attribution) foundation.
--
-- CONTEXT: public.users is the actor registry that activity_events.actor_id FKs to.
-- Only two consumers read it: v_entity_timeline (actor_name = users.display_name) and
-- v_manager_overview (per-member last_activity_at = max activity_events.occurred_at by actor).
-- Every users.display_name was hardcoded "Scott Briggs" (brokers AND external senders), because
-- the sender-resolution path (api/_shared/intake-om-pipeline.js ~L265) writes
-- display_name = auth.name (the CALLER token's name = Scott's) for every row it mints. Result:
-- both views render every actor as "Scott Briggs".
--
-- KNOWN LIMITATION (intentional): users.email is UNIQUE and Scott's identity == the SYSTEM_ACTOR
-- sentinel (b0000…001, email sabriggs@). We do NOT split Scott from the sentinel here (needs freeing
-- that email; larger, separate change). Consequence: Scott's own mail stays system-attributed, while
-- Kelly/Sarah/Nate attribute distinctly — which is what per-broker cadence/visibility needs.
-- ============================================================================

-- 1. Correct broker display names.
update public.users set display_name='Kelly Largent', updated_at=now() where lower(email)='klargent@northmarq.com';
update public.users set display_name='Sarah Martin',  updated_at=now() where lower(email)='smartin@northmarq.com';

-- 2. Nate had no actor identity — create it + workspace membership.
with nate as (
  insert into public.users (id, email, display_name, is_active, created_at, updated_at)
  values (gen_random_uuid(), 'nberwaldt@northmarq.com', 'Nate Berwaldt', true, now(), now())
  on conflict (email) do update set display_name='Nate Berwaldt', is_active=true, updated_at=now()
  returning id
)
insert into public.workspace_memberships (workspace_id, user_id, role)
select 'a0000000-0000-0000-0000-000000000001', id, 'operator' from nate
on conflict (workspace_id, user_id) do nothing;

-- 3. De-pollute every OTHER "Scott Briggs" row: derive a name from the email local-part
--    (initcap, dots/underscores -> spaces). Scott's own aliases stay "Scott Briggs".
update public.users u
set display_name = nullif(initcap(replace(replace(split_part(u.email,'@',1),'.',' '),'_',' ')), ''),
    updated_at = now()
where u.display_name = 'Scott Briggs'
  and u.id <> 'b0000000-0000-0000-0000-000000000001'
  and lower(u.email) not in ('klargent@northmarq.com','smartin@northmarq.com','nberwaldt@northmarq.com')
  and u.email not ilike '%sabriggs%'
  and lower(u.email) not in ('teambriggs@northmarq.com','northmarqlistings@rcm1.com');

-- 4. Mailbox -> actor helper the intake promoter will call going forward.
--    Given the ingesting mailbox address, return that broker's actor id; SYSTEM_ACTOR fallback.
create or replace function public.lcc_actor_for_mailbox(p_email text)
returns uuid language sql stable security definer set search_path to 'public'
as $$
  select coalesce(
    (select id from public.users
      where lower(email) = lower(btrim(coalesce(p_email,''))) and is_active
      order by (id <> 'b0000000-0000-0000-0000-000000000001') desc
      limit 1),
    'b0000000-0000-0000-0000-000000000001'::uuid
  );
$$;
revoke all on function public.lcc_actor_for_mailbox(text) from anon, authenticated;
