// ============================================================================
// Lifecycle — State machines for inbox items, action items, and sync jobs
// Life Command Center — Phase 2: Canonical Data and Queue Model
//
// Defines valid states, transitions, and side-effects for all operational types.
// Used by API endpoints to validate status changes and trigger activity logging.
// ============================================================================

// ============================================================================
// INBOX ITEM LIFECYCLE
//
//   new → triaged → promoted (→ creates action_item)
//                 → dismissed
//                 → archived
//   new → dismissed
//   triaged → archived
//   dismissed → archived
// ============================================================================

export const INBOX_STATES = ['new', 'triaged', 'promoted', 'dismissed', 'archived'];

export const INBOX_TRANSITIONS = {
  new:       ['triaged', 'dismissed'],
  triaged:   ['promoted', 'dismissed', 'archived'],
  promoted:  ['archived'],
  dismissed: ['archived', 'triaged'],  // allow un-dismiss
  archived:  []                         // terminal
};

export function canTransitionInbox(from, to) {
  return (INBOX_TRANSITIONS[from] || []).includes(to);
}

/**
 * Get side-effects for an inbox transition.
 * Returns { action, activity_category, activity_title } or null.
 */
export function inboxTransitionEffects(from, to, item) {
  const effects = [];

  if (to === 'promoted') {
    effects.push({
      action: 'create_action',
      activity_category: 'status_change',
      activity_title: `Promoted inbox item "${item.title}" to action`
    });
  }

  if (to === 'triaged') {
    effects.push({
      action: 'log_activity',
      activity_category: 'status_change',
      activity_title: `Triaged inbox item "${item.title}"`
    });
  }

  if (to === 'dismissed') {
    effects.push({
      action: 'log_activity',
      activity_category: 'status_change',
      activity_title: `Dismissed inbox item "${item.title}"`
    });
  }

  return effects;
}

// ============================================================================
// ACTION ITEM LIFECYCLE
//
//   open → in_progress → completed
//                      → waiting → in_progress
//                      → cancelled
//   open → waiting
//   open → cancelled
//   waiting → cancelled
//   in_progress → open (reopen / reassign)
//   completed → open (reopen)
//   cancelled → open (reopen)
// ============================================================================

export const ACTION_STATES = ['open', 'in_progress', 'waiting', 'completed', 'cancelled'];

export const ACTION_TRANSITIONS = {
  open:        ['in_progress', 'waiting', 'completed', 'cancelled'],
  in_progress: ['open', 'waiting', 'completed', 'cancelled'],
  waiting:     ['in_progress', 'open', 'cancelled'],
  completed:   ['open'],      // reopen
  cancelled:   ['open']       // reopen
};

export function canTransitionAction(from, to) {
  return (ACTION_TRANSITIONS[from] || []).includes(to);
}

export function actionTransitionEffects(from, to, item) {
  const effects = [];

  if (to === 'completed') {
    effects.push({
      action: 'log_activity',
      activity_category: 'status_change',
      activity_title: `Completed action "${item.title}"`
    });
  }

  if (to === 'in_progress' && from === 'open') {
    effects.push({
      action: 'log_activity',
      activity_category: 'status_change',
      activity_title: `Started working on "${item.title}"`
    });
  }

  if (to === 'open' && (from === 'completed' || from === 'cancelled')) {
    effects.push({
      action: 'log_activity',
      activity_category: 'status_change',
      activity_title: `Reopened action "${item.title}"`
    });
  }

  if (to === 'cancelled') {
    effects.push({
      action: 'log_activity',
      activity_category: 'status_change',
      activity_title: `Cancelled action "${item.title}"`
    });
  }

  return effects;
}

// ============================================================================
// RESEARCH TASK LIFECYCLE
//
//   queued → in_progress → completed
//                        → skipped
//   queued → skipped
// ============================================================================

export const RESEARCH_STATES = ['queued', 'in_progress', 'completed', 'skipped'];

export const RESEARCH_TRANSITIONS = {
  queued:      ['in_progress', 'skipped'],
  in_progress: ['completed', 'skipped', 'queued'],  // can re-queue
  completed:   [],
  skipped:     ['queued']  // can un-skip
};

export function canTransitionResearch(from, to) {
  return (RESEARCH_TRANSITIONS[from] || []).includes(to);
}

// ============================================================================
// SYNC JOB LIFECYCLE
//
//   pending → running → completed
//                     → failed
//                     → partial
//   running is set by the sync process itself
// ============================================================================

export const SYNC_STATES = ['pending', 'running', 'completed', 'failed', 'partial'];

export const SYNC_TRANSITIONS = {
  pending:   ['running'],
  running:   ['completed', 'failed', 'partial'],
  completed: [],
  failed:    ['pending'],  // retry
  partial:   ['pending']   // retry
};

export function canTransitionSync(from, to) {
  return (SYNC_TRANSITIONS[from] || []).includes(to);
}

// ============================================================================
// VALID ENUM VALUES (mirrors SQL enums)
// ============================================================================

export const ENTITY_TYPES = ['person', 'organization', 'asset'];
export const VISIBILITY_SCOPES = ['private', 'assigned', 'shared'];
export const PRIORITIES = ['urgent', 'high', 'normal', 'low'];
export const ACTION_TYPES = ['call', 'email', 'research', 'follow_up', 'site_visit', 'data_entry', 'review'];
export const ACTIVITY_CATEGORIES = ['call', 'email', 'meeting', 'note', 'status_change', 'assignment', 'sync', 'research', 'system'];
export const INBOX_SOURCE_TYPES = ['flagged_email', 'sf_task', 'sync_error', 'research', 'manual'];
export const RESEARCH_TYPES = ['ownership', 'lease_backfill', 'clinic_lead', 'entity_enrichment'];
export const CONNECTOR_TYPES = ['salesforce', 'outlook', 'power_automate', 'supabase_domain', 'webhook'];
export const EXECUTION_METHODS = ['direct_api', 'power_automate', 'webhook', 'manual'];
export const DOMAINS = ['government', 'dialysis'];  // expandable

// ============================================================================
// HELPER: validate a value against an allowed set
// ============================================================================

export function isValidEnum(value, allowed) {
  return allowed.includes(value);
}

/**
 * Build an activity event record for a state transition.
 */
export function buildTransitionActivity({ user, workspace_id, entity_id, category, title, item_type, item_id, domain }) {
  return {
    workspace_id,
    actor_id: user.id,
    category: category || 'status_change',
    title,
    entity_id: entity_id || null,
    action_item_id: item_type === 'action' ? item_id : null,
    inbox_item_id: item_type === 'inbox' ? item_id : null,
    source_type: 'system',
    domain: domain || null,
    visibility: 'shared',
    occurred_at: new Date().toISOString()
  };
}
