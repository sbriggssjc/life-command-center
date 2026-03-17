// ============================================================================
// Unified Queue API — My Work, Team Queue, Inbox Triage, Work Counts
// Life Command Center — Phase 2
//
// GET /api/queue?view=my_work         — actions + inbox + research for current user
// GET /api/queue?view=team            — all shared active work
// GET /api/queue?view=inbox           — inbox triage queue
// GET /api/queue?view=sync_exceptions — failed syncs and errors
// GET /api/queue?view=research        — prioritized research tasks
// GET /api/queue?view=counts          — badge counts for nav
// GET /api/queue?view=entity_timeline&entity_id=<uuid> — entity history
// ============================================================================

import { authenticate, requireRole, handleCors } from './_shared/auth.js';
import { opsQuery, paginationParams, requireOps, withErrorHandler } from './_shared/ops-db.js';

export default withErrorHandler(async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (requireOps(res)) return;

  const user = await authenticate(req, res);
  if (!user) return;

  const workspaceId = req.headers['x-lcc-workspace'] || user.memberships[0]?.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context' });

  const membership = user.memberships.find(m => m.workspace_id === workspaceId);
  if (!membership) return res.status(403).json({ error: 'Not a member of this workspace' });

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Only GET is supported on the queue endpoint' });
  }

  const { view, entity_id, domain } = req.query;

  switch (view) {
    // ---- MY WORK ----
    case 'my_work': {
      // Filter the v_my_work view to items owned/assigned to current user
      let path = `v_my_work?workspace_id=eq.${workspaceId}&or=(user_id.eq.${user.id},assigned_to.eq.${user.id})`;
      if (domain) path += `&domain=eq.${domain}`;
      path += paginationParams({ ...req.query, order: req.query.order || 'sort_date.asc.nullslast' });

      const result = await opsQuery('GET', path);
      return res.status(200).json({ items: result.data || [], count: result.count, view: 'my_work' });
    }

    // ---- TEAM QUEUE ----
    case 'team': {
      let path = `v_team_queue?workspace_id=eq.${workspaceId}`;
      if (domain) path += `&domain=eq.${domain}`;
      if (req.query.assigned_to) path += `&assigned_to=eq.${req.query.assigned_to}`;
      if (req.query.status) path += `&status=eq.${req.query.status}`;
      path += paginationParams({ ...req.query, order: req.query.order || 'due_date.asc.nullslast,created_at.desc' });

      const result = await opsQuery('GET', path);
      return res.status(200).json({ items: result.data || [], count: result.count, view: 'team' });
    }

    // ---- INBOX TRIAGE ----
    case 'inbox': {
      let path = `v_inbox_triage?workspace_id=eq.${workspaceId}`;
      if (domain) path += `&domain=eq.${domain}`;
      if (req.query.source_type) path += `&source_type=eq.${req.query.source_type}`;
      if (req.query.assigned_to) path += `&assigned_to=eq.${req.query.assigned_to}`;
      path += paginationParams({ ...req.query, order: req.query.order || 'received_at.desc' });

      const result = await opsQuery('GET', path);
      return res.status(200).json({ items: result.data || [], count: result.count, view: 'inbox' });
    }

    // ---- SYNC EXCEPTIONS ----
    case 'sync_exceptions': {
      let path = `v_sync_exceptions?workspace_id=eq.${workspaceId}`;
      if (req.query.connector_type) path += `&connector_type=eq.${req.query.connector_type}`;
      if (req.query.is_retryable) path += `&is_retryable=eq.${req.query.is_retryable}`;
      path += paginationParams({ ...req.query, order: req.query.order || 'created_at.desc' });

      const result = await opsQuery('GET', path);
      return res.status(200).json({ items: result.data || [], count: result.count, view: 'sync_exceptions' });
    }

    // ---- RESEARCH QUEUE ----
    case 'research': {
      let path = `v_research_queue?workspace_id=eq.${workspaceId}`;
      if (domain) path += `&domain=eq.${domain}`;
      if (req.query.assigned_to) path += `&assigned_to=eq.${req.query.assigned_to}`;
      if (req.query.research_type) path += `&research_type=eq.${req.query.research_type}`;
      path += paginationParams({ ...req.query, order: req.query.order || 'priority.asc,created_at.asc' });

      const result = await opsQuery('GET', path);
      return res.status(200).json({ items: result.data || [], count: result.count, view: 'research' });
    }

    // ---- ENTITY TIMELINE ----
    case 'entity_timeline': {
      if (!entity_id) {
        return res.status(400).json({ error: 'entity_id is required for entity_timeline view' });
      }

      let path = `v_entity_timeline?entity_id=eq.${entity_id}&workspace_id=eq.${workspaceId}`;
      path += paginationParams({ ...req.query, order: req.query.order || 'occurred_at.desc' });

      const result = await opsQuery('GET', path);
      return res.status(200).json({ events: result.data || [], count: result.count, view: 'entity_timeline' });
    }

    // ---- WORK COUNTS (for badges) ----
    case 'counts': {
      const result = await opsQuery('GET', `v_work_counts?workspace_id=eq.${workspaceId}`);
      const counts = result.data?.[0] || {
        open_actions: 0, new_inbox: 0, triaged_inbox: 0,
        active_research: 0, unresolved_sync_errors: 0, overdue_actions: 0
      };

      // Also get user-specific counts
      const myActions = await opsQuery('GET',
        `action_items?workspace_id=eq.${workspaceId}&or=(owner_id.eq.${user.id},assigned_to.eq.${user.id})&status=in.(open,in_progress,waiting)&select=id&limit=0`
      );
      const myInbox = await opsQuery('GET',
        `inbox_items?workspace_id=eq.${workspaceId}&or=(source_user_id.eq.${user.id},assigned_to.eq.${user.id})&status=in.(new,triaged)&select=id&limit=0`
      );

      return res.status(200).json({
        view: 'counts',
        workspace: counts,
        user: {
          my_actions: myActions.count || 0,
          my_inbox: myInbox.count || 0
        }
      });
    }

    default:
      return res.status(400).json({
        error: 'Invalid view. Must be one of: my_work, team, inbox, sync_exceptions, research, entity_timeline, counts'
      });
  }
});
