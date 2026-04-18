// ============================================================================
// Cadence Engine — Touchpoint Scheduling & Auto-Select
// Life Command Center
//
// Implements the 7-touch prospecting sequence (6 months) + quarterly
// maintenance cadence from touchpoint_cadence_spec.md.
//
// Key responsibilities:
//   1. getCadenceState()   — fetch or initialize a contact's cadence record
//   2. recommendNextTouch() — compute what template/channel to use next
//   3. advanceCadence()     — move the cadence forward after a touchpoint
//   4. checkCoolDowns()     — enforce buffer rules (flyer, meeting, phone decline)
//   5. getCadenceForDraft() — one-call summary for the draft UI
// ============================================================================

import { opsQuery, pgFilterVal } from './ops-db.js';

// ============================================================================
// CADENCE SEQUENCE DEFINITION
// ============================================================================

/**
 * The 7-touch prospecting sequence.
 * touch_number: 1-7
 * type: email | phone
 * template: template_id to use (null for phone — use voicemail script)
 * days_after_prev: recommended spacing from previous touch
 */
const PROSPECTING_SEQUENCE = [
  { touch: 1, type: 'email',  template: 'T-001', days_after_prev: 0,  label: 'First Touch (Intro + Report + BOV)' },
  { touch: 2, type: 'phone',  template: null,     days_after_prev: 10, label: 'Phone Follow-Up (confirm email receipt)' },
  { touch: 3, type: 'email',  template: 'T-003', days_after_prev: 15, label: 'Capital Markets Update' },
  { touch: 4, type: 'phone',  template: null,     days_after_prev: 10, label: 'Phone Follow-Up (quarterly report)' },
  { touch: 5, type: 'email',  template: 'T-004', days_after_prev: 12, label: 'Listing Announcement or Comp Share' },
  { touch: 6, type: 'phone',  template: null,     days_after_prev: 10, label: 'Phone Follow-Up (listing/comp)' },
  { touch: 7, type: 'email',  template: 'T-002', days_after_prev: 10, label: 'Direct Ask (schedule meeting)' }
];

/** Priority tier cadence multipliers (Tier A = faster, Tier C = slower) */
const TIER_MULTIPLIERS = {
  A: 0.7,   // 30% faster cadence
  B: 1.0,   // standard
  C: 2.0    // 2x slower (quarterly-only for Tier C)
};

/** Cool-down buffer durations in milliseconds */
const COOLDOWNS = {
  flyer_buffer_ms:         3 * 24 * 60 * 60 * 1000,   // 3 days after marketing flyer
  meeting_buffer_ms:       2 * 24 * 60 * 60 * 1000,   // 48 hours after meeting
  phone_decline_buffer_ms: 30 * 24 * 60 * 60 * 1000,  // 30 days after phone decline
  quarterly_interval_ms:   90 * 24 * 60 * 60 * 1000    // ~90 days for quarterly
};

// ============================================================================
// FETCH / INITIALIZE CADENCE STATE
// ============================================================================

/**
 * Retrieve or initialize a cadence record for a contact+property pair.
 *
 * @param {object} ids - At least one of: { entity_id, sf_contact_id, contact_id }
 * @param {object} [propertyInfo] - { property_id, property_address, domain }
 * @returns {object} The cadence record (existing or newly created)
 */
export async function getCadenceState(ids, propertyInfo = {}) {
  // Build filter to find existing record
  const filters = [];
  if (ids.entity_id) filters.push(`entity_id=eq.${pgFilterVal(ids.entity_id)}`);
  if (ids.sf_contact_id) filters.push(`sf_contact_id=eq.${pgFilterVal(ids.sf_contact_id)}`);
  if (propertyInfo.property_id) filters.push(`property_id=eq.${pgFilterVal(propertyInfo.property_id)}`);

  if (filters.length === 0) {
    return { ok: false, error: 'At least one contact identifier required' };
  }

  // Try to fetch existing record
  const path = `touchpoint_cadence?${filters.join('&')}&limit=1`;
  const result = await opsQuery('GET', path);

  if (result.ok && Array.isArray(result.data) && result.data.length > 0) {
    return { ok: true, cadence: result.data[0], is_new: false };
  }

  // No existing record — initialize a new one
  const newRecord = {
    entity_id: ids.entity_id || null,
    contact_id: ids.contact_id || null,
    sf_contact_id: ids.sf_contact_id || null,
    property_id: propertyInfo.property_id || null,
    property_address: propertyInfo.property_address || null,
    domain: propertyInfo.domain || null,
    priority_tier: 'B',
    phase: 'prospecting',
    current_touch: 0,
    next_touch_type: 'email',
    next_touch_template: 'T-001',
    next_touch_due: new Date().toISOString()
  };

  const insertResult = await opsQuery('POST', 'touchpoint_cadence', newRecord);

  if (insertResult.ok && Array.isArray(insertResult.data) && insertResult.data.length > 0) {
    return { ok: true, cadence: insertResult.data[0], is_new: true };
  }

  // Insert might fail on unique constraint if race condition — try fetch again
  const retryResult = await opsQuery('GET', path);
  if (retryResult.ok && Array.isArray(retryResult.data) && retryResult.data.length > 0) {
    return { ok: true, cadence: retryResult.data[0], is_new: false };
  }

  return { ok: false, error: 'Failed to initialize cadence record', detail: insertResult.data };
}

// ============================================================================
// RECOMMEND NEXT TOUCH
// ============================================================================

/**
 * Given a cadence record, compute the recommended next action.
 *
 * @param {object} cadence - A touchpoint_cadence row
 * @param {object} [options] - { now, escalationFlags }
 * @returns {object} Recommendation: { touch_number, type, template, label, due_at, is_overdue, cool_down_active, cool_down_reason }
 */
export function recommendNextTouch(cadence, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();

  // Check for opt-out / paused
  if (cadence.unsubscribe_status !== 'active') {
    return { touch_number: null, type: null, template: null, label: 'Contact is opted out or paused', blocked: true, reason: cadence.unsubscribe_status };
  }

  // Check phase
  if (cadence.phase === 'dormant') {
    return { touch_number: null, type: null, template: null, label: 'Contact is dormant — annual check-in only', blocked: true, reason: 'dormant' };
  }

  if (cadence.phase === 'converted') {
    return { touch_number: null, type: null, template: null, label: 'Contact converted — active engagement', blocked: true, reason: 'converted' };
  }

  // ── Escalation overrides ──────────────────────────────────────────────

  // New lease award → T-013 immediately
  if (cadence.new_award_flag) {
    const coolDown = checkCoolDowns(cadence, 'email', now);
    return {
      touch_number: cadence.current_touch,
      type: 'email',
      template: 'T-013',
      label: 'GSA Lease Award Congratulations (escalation)',
      due_at: coolDown.blocked ? coolDown.available_at : now.toISOString(),
      is_overdue: false,
      cool_down_active: coolDown.blocked,
      cool_down_reason: coolDown.reason || null,
      is_escalation: true
    };
  }

  // Lease expiration approaching → accelerate with T-002
  if (cadence.lease_expiry_flag && cadence.phase === 'maintenance') {
    const coolDown = checkCoolDowns(cadence, 'email', now);
    return {
      touch_number: cadence.current_touch,
      type: 'email',
      template: 'T-002',
      label: 'Lease Expiration Follow-Up (escalation)',
      due_at: coolDown.blocked ? coolDown.available_at : now.toISOString(),
      is_overdue: false,
      cool_down_active: coolDown.blocked,
      cool_down_reason: coolDown.reason || null,
      is_escalation: true
    };
  }

  // ── Consecutive unopened → switch to phone ────────────────────────────

  if (cadence.consecutive_unopened >= 2 && cadence.phase === 'prospecting') {
    const coolDown = checkCoolDowns(cadence, 'phone', now);
    return {
      touch_number: cadence.current_touch + 1,
      type: 'phone',
      template: null,
      label: 'Phone recovery (2+ consecutive unopened emails)',
      due_at: coolDown.blocked ? coolDown.available_at : now.toISOString(),
      is_overdue: false,
      cool_down_active: coolDown.blocked,
      cool_down_reason: coolDown.reason || null,
      is_recovery: true
    };
  }

  // ── Standard prospecting sequence ─────────────────────────────────────

  if (cadence.phase === 'prospecting') {
    const nextTouchNum = cadence.current_touch + 1;

    // If we're past touch 7, move to maintenance
    if (nextTouchNum > 7) {
      return recommendQuarterlyTouch(cadence, now);
    }

    const step = PROSPECTING_SEQUENCE.find(s => s.touch === nextTouchNum);
    if (!step) {
      return recommendQuarterlyTouch(cadence, now);
    }

    // Compute due date
    const tierMult = TIER_MULTIPLIERS[cadence.priority_tier] || 1;
    const spacingMs = step.days_after_prev * 24 * 60 * 60 * 1000 * tierMult;
    const lastTouch = cadence.last_touch_at ? new Date(cadence.last_touch_at) : now;
    const dueAt = new Date(lastTouch.getTime() + spacingMs);
    const isOverdue = now > dueAt;

    // Check cool-downs for the recommended channel
    const coolDown = checkCoolDowns(cadence, step.type, now);

    // For Touch 7 (final), set is_final_touch flag for T-002 template
    const extraFlags = {};
    if (nextTouchNum === 7) {
      extraFlags.is_final_touch = true;
    }

    return {
      touch_number: nextTouchNum,
      type: step.type,
      template: step.template,
      label: step.label,
      due_at: dueAt.toISOString(),
      is_overdue: isOverdue,
      overdue_days: isOverdue ? Math.floor((now - dueAt) / (24 * 60 * 60 * 1000)) : 0,
      cool_down_active: coolDown.blocked,
      cool_down_reason: coolDown.reason || null,
      phase: 'prospecting',
      ...extraFlags
    };
  }

  // ── Quarterly maintenance ─────────────────────────────────────────────

  return recommendQuarterlyTouch(cadence, now);
}

/**
 * Build a quarterly maintenance touch recommendation.
 */
function recommendQuarterlyTouch(cadence, now) {
  const lastTouch = cadence.last_touch_at ? new Date(cadence.last_touch_at) : null;
  const quarterlyMs = COOLDOWNS.quarterly_interval_ms;
  const dueAt = lastTouch ? new Date(lastTouch.getTime() + quarterlyMs) : now;
  const isOverdue = now > dueAt;

  const coolDown = checkCoolDowns(cadence, 'email', now);

  // Seasonal variation
  const quarter = Math.ceil((now.getMonth() + 1) / 3);
  let label = `Quarterly Capital Markets Update (Q${quarter})`;
  if (quarter === 4) label = `Year-End Portfolio Review (Q4)`;
  if (quarter === 1) label = `New Year Disposition/Refinance Planning (Q1)`;

  return {
    touch_number: cadence.current_touch,
    type: 'email',
    template: 'T-003',
    label,
    due_at: dueAt.toISOString(),
    is_overdue: isOverdue,
    overdue_days: isOverdue ? Math.floor((now - dueAt) / (24 * 60 * 60 * 1000)) : 0,
    cool_down_active: coolDown.blocked,
    cool_down_reason: coolDown.reason || null,
    phase: 'maintenance'
  };
}

// ============================================================================
// COOL-DOWN CHECKS
// ============================================================================

/**
 * Check if any cool-down rules block a touchpoint of the given type.
 *
 * @param {object} cadence - The cadence record
 * @param {string} touchType - 'email' or 'phone'
 * @param {Date} now
 * @returns {{ blocked: boolean, reason?: string, available_at?: string }}
 */
export function checkCoolDowns(cadence, touchType, now) {
  now = now || new Date();

  // Flyer buffer: no personal email within 3 days of marketing flyer
  if (touchType === 'email' && cadence.last_flyer_at) {
    const flyerTime = new Date(cadence.last_flyer_at).getTime();
    const bufferEnd = flyerTime + COOLDOWNS.flyer_buffer_ms;
    if (now.getTime() < bufferEnd) {
      return { blocked: true, reason: 'Marketing flyer sent recently — 3-day buffer', available_at: new Date(bufferEnd).toISOString() };
    }
  }

  // Meeting buffer: no follow-up within 48 hours of meeting
  if (cadence.last_meeting_at) {
    const meetingTime = new Date(cadence.last_meeting_at).getTime();
    const bufferEnd = meetingTime + COOLDOWNS.meeting_buffer_ms;
    if (now.getTime() < bufferEnd) {
      return { blocked: true, reason: 'Recent meeting — 48-hour buffer', available_at: new Date(bufferEnd).toISOString() };
    }
  }

  // Phone decline: no calls for 30 days
  if (touchType === 'phone' && cadence.phone_declined_at) {
    const declineTime = new Date(cadence.phone_declined_at).getTime();
    const bufferEnd = declineTime + COOLDOWNS.phone_decline_buffer_ms;
    if (now.getTime() < bufferEnd) {
      return { blocked: true, reason: 'Phone declined — 30-day buffer', available_at: new Date(bufferEnd).toISOString() };
    }
  }

  return { blocked: false };
}

// ============================================================================
// ADVANCE CADENCE (after a touchpoint is executed)
// ============================================================================

/**
 * Advance the cadence state after a touchpoint has been executed.
 * Called by record_send and manual touchpoint logging.
 *
 * @param {string} cadenceId - UUID of the touchpoint_cadence row
 * @param {object} touchData - { type, template_id, outcome, opened }
 * @returns {object} Updated cadence record
 */
export async function advanceCadence(cadenceId, touchData) {
  // Fetch current state
  const result = await opsQuery('GET', `touchpoint_cadence?id=eq.${pgFilterVal(cadenceId)}&limit=1`);
  if (!result.ok || !result.data?.[0]) {
    return { ok: false, error: 'Cadence record not found' };
  }

  const cadence = result.data[0];
  const now = new Date();

  // Build update payload
  const update = {
    last_touch_at: now.toISOString(),
    last_touch_type: touchData.type || 'email',
    last_touch_template: touchData.template_id || null
  };

  // Advance touch counter for prospecting phase
  if (cadence.phase === 'prospecting') {
    const nextTouch = cadence.current_touch + 1;
    update.current_touch = nextTouch;

    // If we just completed touch 7, transition to maintenance
    if (nextTouch >= 7) {
      update.phase = 'maintenance';
    }
  }

  // Update engagement counters
  if (touchData.type === 'email') {
    update.emails_sent = (cadence.emails_sent || 0) + 1;
    if (touchData.opened) {
      update.emails_opened = (cadence.emails_opened || 0) + 1;
      update.consecutive_unopened = 0;
    } else {
      update.consecutive_unopened = (cadence.consecutive_unopened || 0) + 1;
    }
  } else if (touchData.type === 'phone') {
    update.calls_made = (cadence.calls_made || 0) + 1;
    if (touchData.outcome === 'connected') {
      update.calls_connected = (cadence.calls_connected || 0) + 1;
    }
    if (touchData.outcome === 'declined') {
      update.phone_declined_at = now.toISOString();
    }
  } else if (touchData.type === 'meeting') {
    update.meetings_scheduled = (cadence.meetings_scheduled || 0) + 1;
    update.last_meeting_at = now.toISOString();
  }

  // If contact replied, consider conversion
  if (touchData.outcome === 'replied') {
    update.emails_replied = (cadence.emails_replied || 0) + 1;
  }

  // Clear escalation flags if addressed
  if (touchData.template_id === 'T-013' && cadence.new_award_flag) {
    update.new_award_flag = false;
  }

  // Compute next recommended touch
  const updatedCadence = { ...cadence, ...update };
  const nextRec = recommendNextTouch(updatedCadence);
  if (nextRec.template) {
    update.next_touch_template = nextRec.template;
    update.next_touch_type = nextRec.type;
    update.next_touch_due = nextRec.due_at;
  }

  // Persist
  const patchResult = await opsQuery(
    'PATCH',
    `touchpoint_cadence?id=eq.${pgFilterVal(cadenceId)}`,
    update
  );

  if (!patchResult.ok) {
    return { ok: false, error: 'Failed to update cadence', detail: patchResult.data };
  }

  return {
    ok: true,
    cadence: patchResult.data?.[0] || { ...cadence, ...update },
    recommendation: nextRec
  };
}

// ============================================================================
// HIGH-LEVEL: GET CADENCE STATE FOR DRAFT UI
// ============================================================================

/**
 * One-call convenience for the Draft Email button:
 * Returns current cadence state + next recommendation + context flags.
 *
 * @param {object} ids - { entity_id, sf_contact_id, contact_id }
 * @param {object} propertyInfo - { property_id, property_address, domain }
 * @returns {object} { cadence, recommendation, context_flags }
 */
export async function getCadenceForDraft(ids, propertyInfo = {}) {
  const stateResult = await getCadenceState(ids, propertyInfo);
  if (!stateResult.ok) {
    return stateResult;
  }

  const cadence = stateResult.cadence;
  const recommendation = recommendNextTouch(cadence);

  // Build context flags that the template renderer needs
  const contextFlags = {};

  // Touch 7 = final touch (T-002 needs is_final_touch)
  if (recommendation.touch_number === 7 || recommendation.is_final_touch) {
    contextFlags.is_final_touch = 'true';
  } else if (recommendation.phase === 'prospecting' && recommendation.touch_number >= 2) {
    contextFlags.is_standard_touch = 'true';
  }

  // T-003 mode flags
  if (recommendation.template === 'T-003') {
    if (propertyInfo.domain && (recommendation.touch_number <= 7)) {
      contextFlags.is_outbound_anchored = 'true';
    } else {
      contextFlags.is_mass_broadcast = 'true';
    }
  }

  return {
    ok: true,
    cadence,
    recommendation,
    context_flags: contextFlags,
    is_new: stateResult.is_new,
    summary: buildCadenceSummary(cadence, recommendation)
  };
}

/**
 * Build a human-readable summary for the UI.
 */
function buildCadenceSummary(cadence, recommendation) {
  const parts = [];

  // Phase + touch position
  if (cadence.phase === 'prospecting') {
    parts.push(`Touch ${cadence.current_touch}/7 completed`);
  } else if (cadence.phase === 'maintenance') {
    parts.push('Quarterly maintenance cadence');
  } else {
    parts.push(`Status: ${cadence.phase}`);
  }

  // Tier
  parts.push(`Tier ${cadence.priority_tier}`);

  // Engagement stats
  const stats = [];
  if (cadence.emails_sent > 0) stats.push(`${cadence.emails_sent} emails`);
  if (cadence.calls_made > 0) stats.push(`${cadence.calls_made} calls`);
  if (cadence.meetings_scheduled > 0) stats.push(`${cadence.meetings_scheduled} meetings`);
  if (stats.length > 0) parts.push(stats.join(', '));

  // Next action
  if (recommendation && !recommendation.blocked) {
    const overdue = recommendation.is_overdue ? ' (OVERDUE)' : '';
    parts.push(`Next: ${recommendation.label}${overdue}`);
  } else if (recommendation?.blocked) {
    parts.push(`Blocked: ${recommendation.reason}`);
  }

  return parts.join(' · ');
}

// ============================================================================
// EXPORTS
// ============================================================================

export { PROSPECTING_SEQUENCE, TIER_MULTIPLIERS, COOLDOWNS };
