-- ============================================================================
-- UX-T0 / UX48 (2026-09-02) — the Metrics roster showed mailbox aliases as
-- team members. APPLIED LIVE to LCC Opps (xengecqvemvfknjvbvrq) 2026-09-02.
--
-- MEASURED live before this change: v_manager_overview returns 42 rows for the
-- one workspace. Read on named rows they are dominated by email local-parts
-- title-cased into a display name (Aaminov, Alynn, Amartin, Bruces, Ccouch,
-- Frankm, Hking, Jdehorty, Jerxleben, Lbeck, Mmckenzie, Ntaylor, Pgarcia,
-- Plamb, Pmahjoory, Pward, Sburgess, Sesau, Sjgilman, Soderio, Tscrivner),
-- three system mailboxes (Noreply, Powerautomatenoreply, Support), one row
-- whose display_name is the literal string " <>", and FOUR separate
-- "Scott Briggs" rows — three operators at zero and one owner carrying all
-- 58 active / 49 overdue actions. Correspondence counterparties were minted
-- into public.users and given a workspace_memberships row.
--
-- The RECORDED FACT about who the team is already exists: public.lcc_users,
-- the LCC person registry (4 active rows — Kelly Largent, Nate Berwaldt,
-- Scott Briggs, Sarah Martin). Exactly 4 public.users rows match it by email.
-- Email is the sanctioned bridge between the two id-spaces (the same bridge
-- v_lcc_entity_point_person / lcc_cadence_point_person already use).
--
-- ⚠️ auth.users is NOT usable as the discriminator here — measured, 0 of the 42
-- memberships carry an auth identity, INCLUDING the real owner row. The obvious
-- "only show people who can sign in" test returns an empty roster.
--
-- This is deliberately a FLAG, not a filter, and deliberately APPENDED
-- (CREATE OR REPLACE VIEW is append-only for columns):
--   * nothing is deleted and no membership is revoked — access is unchanged,
--     and a bad judgement here costs a label, never a permission;
--   * the surface shows the real team and states how many rows it is not
--     showing and why, rather than suppressing them silently;
--   * it reads a recorded registry, never a name heuristic. A name-shaped test
--     ("looks like an email local-part") is the guess this repo bans and would
--     misclassify a real single-word display name.
--
-- ⚠️ The 42-row population itself is a PRODUCER defect — something mints users
-- + workspace_memberships from correspondence. NOT fixed here (backlog UX48a);
-- this migration stops the roster lying about it, it does not stop the minting.
--
-- Verify:  select count(*) total, count(*) filter (where is_team_member) team
--            from v_manager_overview;      -- expect 42 / 4
-- Reverse: re-run the previous body (this file minus the is_team_member column).
-- ============================================================================

CREATE OR REPLACE VIEW public.v_manager_overview AS
 SELECT wm.workspace_id,
    u.id AS user_id,
    u.display_name,
    u.email,
    wm.role,
    ( SELECT count(*) AS count
           FROM action_items a
          WHERE a.workspace_id = wm.workspace_id AND (a.owner_id = u.id OR a.assigned_to = u.id) AND (a.status = ANY (ARRAY['open'::action_status, 'in_progress'::action_status, 'waiting'::action_status]))) AS active_actions,
    ( SELECT count(*) AS count
           FROM action_items a
          WHERE a.workspace_id = wm.workspace_id AND (a.owner_id = u.id OR a.assigned_to = u.id) AND (a.status = ANY (ARRAY['open'::action_status, 'in_progress'::action_status])) AND a.due_date < CURRENT_DATE) AS overdue_actions,
    ( SELECT count(*) AS count
           FROM action_items a
          WHERE a.workspace_id = wm.workspace_id AND (a.owner_id = u.id OR a.assigned_to = u.id) AND a.status = 'completed'::action_status AND a.completed_at > (now() - '7 days'::interval)) AS completed_this_week,
    ( SELECT count(*) AS count
           FROM inbox_items i
          WHERE i.workspace_id = wm.workspace_id AND (i.source_user_id = u.id OR i.assigned_to = u.id) AND i.status = 'new'::inbox_status) AS untriaged_inbox,
    ( SELECT count(*) AS count
           FROM research_tasks r
          WHERE r.workspace_id = wm.workspace_id AND r.assigned_to = u.id AND (r.status = ANY (ARRAY['queued'::research_status, 'in_progress'::research_status]))) AS active_research,
    ( SELECT count(*) AS count
           FROM escalations e
          WHERE e.workspace_id = wm.workspace_id AND e.escalated_to = u.id AND e.resolved_at IS NULL) AS open_escalations,
    ( SELECT count(*) AS count
           FROM connector_accounts ca
          WHERE ca.workspace_id = wm.workspace_id AND ca.user_id = u.id AND (ca.status = ANY (ARRAY['error'::connector_status, 'degraded'::connector_status]))) AS unhealthy_connectors,
    ( SELECT max(ae.occurred_at) AS max
           FROM activity_events ae
          WHERE ae.workspace_id = wm.workspace_id AND ae.actor_id = u.id) AS last_activity_at,
    -- APPENDED (UX48). TRUE only when this user is in the LCC person registry.
    EXISTS (
      SELECT 1 FROM public.lcc_users l
       WHERE lower(l.email) = lower(u.email)
         AND COALESCE(l.active, true)
    ) AS is_team_member
   FROM workspace_memberships wm
     JOIN users u ON u.id = wm.user_id
  WHERE u.is_active = true;

COMMENT ON VIEW public.v_manager_overview IS
  'Manager oversight roster. is_team_member (UX48, 2026-09-02) is TRUE only for
   users present in lcc_users, the LCC person registry — the recorded fact about
   who the team is. Rows where it is FALSE are overwhelmingly mailbox aliases and
   system mailboxes minted into users/workspace_memberships by correspondence
   ingestion (42 rows live, 4 real people). The flag labels; it never filters and
   never revokes access.';
