-- ============================================================================
-- v_my_work_scoped — action items with the DEAL's point-person resolved, so
-- My Work can scope to "work I'm the point person on" instead of "any system-
-- owned to-do." point-person = lcc_entity_owner_override.owner_user_id (an
-- lcc_user: Scott/Kelly/Sarah/Nate), the FK-safe ownership channel (action_items
-- owner_id/assigned_to FK the auth users table, which doesn't hold the reps).
-- Callers map the logged-in user -> lcc_user_id by email (lcc_users.email).
--
-- Scoping model:
--   My Work (any user)     = rows where pointperson_user_id = my lcc_user_id
--   Team Queue (lead only) = all rows (+ unassigned where pointperson is null)
-- Additive; v_my_work / v_team_queue are untouched. See
-- docs/architecture/access-scoping-and-my-work.md.
-- ============================================================================
create or replace view public.v_my_work_scoped as
select
  'action'::text            as item_type,
  a.id,
  a.workspace_id,
  a.title,
  a.description             as body,
  a.status::text            as status,
  a.priority,
  a.action_type             as sub_type,
  a.due_date,
  a.owner_id                as user_id,
  a.assigned_to,
  a.entity_id,
  e.name                    as entity_name,
  a.domain,
  a.source_type,
  a.external_url,
  a.created_at,
  a.updated_at,
  a.due_date                as sort_date,
  ov.owner_user_id          as pointperson_user_id,
  lu.display_name           as pointperson_name
from public.action_items a
  left join public.entities e                  on e.id = a.entity_id
  left join public.lcc_entity_owner_override ov on ov.entity_id = a.entity_id
  left join public.lcc_users lu                on lu.lcc_user_id = ov.owner_user_id
where a.status in ('open'::action_status,'in_progress'::action_status,'waiting'::action_status);

comment on view public.v_my_work_scoped is
'Action items with the deal point-person (lcc_entity_owner_override.owner_user_id) resolved. My Work filters pointperson_user_id = the logged-in user''s lcc_user_id (mapped by email); Team Queue (lead only) shows all. Additive; does not replace v_my_work.';
