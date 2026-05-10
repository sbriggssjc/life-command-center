// ============================================================================
// Cadence-engine alerts — daily cross-data sweep over engagement + competitive touches
// Life Command Center — Phase 4
// ----------------------------------------------------------------------------
// Distinct from `cadence-engine.js` (per-contact touchpoint scheduling).
// This module answers "which contacts/accounts need attention RIGHT NOW?"
// by reading the views populated by Phases 1–3:
//
//   v_contact_engagement   — going_cold rule  (no email/call/meeting in N days)
//   v_competitive_touches  — heating_up rule  (another rep hammering an account)
//
// Each detected alert is upserted into `cadence_alerts` with a daily-dedupe
// guard, and on first sight (insert returns the row) a Teams card is sent
// via the existing `sendTeamsAlert` helper.
//
// Phase 5+: stale_opportunity + silent_account rules will plug into the same
// `runCadenceTick` aggregator without touching the route layer.
// ============================================================================

import { opsQuery, isOpsConfigured, pgFilterVal } from './ops-db.js';
import { sendTeamsAlert } from './teams-alert.js';

const DEFAULTS = {
  cold_days:         30,
  heat_min_touches:  5,
  heat_recency_days: 7,
  max_emit_per_type: 25
};

const APP_BASE_URL = process.env.LCC_APP_BASE_URL || '';

function entityUrl(entityId)   { return APP_BASE_URL && entityId  ? `${APP_BASE_URL.replace(/\/+$/, '')}/entity/${entityId}`   : null; }
function contactUrl(unifiedId) { return APP_BASE_URL && unifiedId ? `${APP_BASE_URL.replace(/\/+$/, '')}/contact/${unifiedId}` : null; }

/**
 * Try to insert a cadence_alerts row. Returns true if newly inserted, false
 * if the daily-dedupe unique index blocked it (already alerted today).
 *
 * Uses Prefer=resolution=ignore-duplicates so duplicates return [] instead
 * of the existing row — easy "did we just insert?" check.
 */
async function tryEmitAlert(row) {
  const r = await opsQuery('POST',
    'cadence_alerts?on_conflict=workspace_id,alert_type,subject_kind,subject_id,emitted_on_date',
    row,
    { headers: { Prefer: 'return=representation,resolution=ignore-duplicates' } }
  );
  return r.ok && Array.isArray(r.data) && r.data.length > 0;
}

// ---- going_cold ------------------------------------------------------------

async function detectGoingCold(workspaceId, opts) {
  const days = opts.cold_days || DEFAULTS.cold_days;
  const max  = opts.max_emit  || DEFAULTS.max_emit_per_type;

  const r = await opsQuery('GET',
    `v_contact_engagement?days_since_last_touch=gte.${days}` +
    `&sf_contact_id=not.is.null` +
    `&order=days_since_last_touch.desc&limit=${Math.max(max, 100)}`,
    null, { countMode: 'none' }
  );
  const detected = (r.ok && Array.isArray(r.data)) ? r.data : [];

  let emitted = 0;
  const teamsCards = [];

  for (const c of detected.slice(0, max)) {
    const label  = c.full_name || c.email || c.unified_id;
    const message = `${label} hasn't been contacted in ${c.days_since_last_touch} days`;
    const severity = c.days_since_last_touch >= 60 ? 'high' : 'info';

    const inserted = await tryEmitAlert({
      workspace_id:  workspaceId,
      alert_type:    'going_cold',
      subject_kind:  'contact',
      subject_id:    c.unified_id,
      subject_label: label,
      severity,
      message,
      details: {
        days_since_last_touch: c.days_since_last_touch,
        last_call_date:    c.last_call_date,
        last_email_date:   c.last_email_date,
        last_meeting_date: c.last_meeting_date,
        company_name:      c.company_name,
        sf_contact_id:     c.sf_contact_id
      }
    });
    if (!inserted) continue;
    emitted++;

    teamsCards.push({
      title:    'Contact going cold',
      summary:  message,
      severity,
      facts: [
        ['Contact',  label],
        ['Company',  c.company_name || '—'],
        ['Days since last touch', String(c.days_since_last_touch)],
        ['Last channel', c.last_email_date ? 'email'
                       : c.last_call_date ? 'call'
                       : c.last_meeting_date ? 'meeting' : '—']
      ],
      actions: contactUrl(c.unified_id)
        ? [{ label: 'Open contact', url: contactUrl(c.unified_id) }]
        : []
    });
  }

  return { detected: detected.length, emitted, teamsCards };
}

// ---- heating_up ------------------------------------------------------------

/**
 * Resolve a quick display name for an entity by id. Returns the name or
 * '(unknown)' on miss. Cached lightly per call to avoid a query per row.
 */
async function resolveEntityName(workspaceId, entityId, cache) {
  if (!entityId) return '(unknown)';
  if (cache.has(entityId)) return cache.get(entityId);
  const r = await opsQuery('GET',
    `entities?id=eq.${entityId}&workspace_id=eq.${pgFilterVal(workspaceId)}&select=name&limit=1`,
    null, { countMode: 'none' }
  );
  const name = (r.ok && r.data?.length) ? r.data[0].name : '(unknown)';
  cache.set(entityId, name);
  return name;
}

async function detectHeatingUp(workspaceId, opts) {
  const minTouches  = opts.heat_min_touches  || DEFAULTS.heat_min_touches;
  const recencyDays = opts.heat_recency_days || DEFAULTS.heat_recency_days;
  const max         = opts.max_emit          || DEFAULTS.max_emit_per_type;
  const since       = new Date(Date.now() - recencyDays * 86400000).toISOString();

  const r = await opsQuery('GET',
    `v_competitive_touches?workspace_id=eq.${pgFilterVal(workspaceId)}` +
    `&touches_90d=gte.${minTouches}` +
    `&last_touch_at=gte.${encodeURIComponent(since)}` +
    `&account_entity_id=not.is.null` +
    `&order=touches_90d.desc&limit=${Math.max(max, 100)}`,
    null, { countMode: 'none' }
  );
  const detected = (r.ok && Array.isArray(r.data)) ? r.data : [];

  // The view groups by (account, owner) — so a single hot account being
  // touched by multiple reps will surface multiple rows. That's fine —
  // each rep on the same account is a distinct alert.
  let emitted = 0;
  const teamsCards = [];
  const nameCache  = new Map();

  for (const t of detected.slice(0, max)) {
    const accountName = await resolveEntityName(workspaceId, t.account_entity_id, nameCache);
    const repName     = t.sf_owner_name || t.sf_owner_email || 'Unknown rep';
    const message     = `${repName} has ${t.touches_90d} recent touches with ${accountName}`;
    const severity    = t.touches_90d >= 10 ? 'high' : 'info';

    // Dedupe key uses the ACCOUNT as subject — if multiple reps are heating
    // up the same account on the same day, only the first emits. The
    // details payload records which rep triggered the emission. To get
    // per-rep alerts, change subject_kind to a synthetic "account+rep"
    // discriminator in v2.
    const inserted = await tryEmitAlert({
      workspace_id:  workspaceId,
      alert_type:    'heating_up',
      subject_kind:  'account',
      subject_id:    t.account_entity_id,
      subject_label: accountName,
      severity,
      message,
      details: {
        sf_owner_id:    t.sf_owner_id,
        sf_owner_name:  t.sf_owner_name,
        sf_owner_email: t.sf_owner_email,
        actor_user_id:  t.actor_user_id,    // Phase 1.5 mapping if available
        touches_90d:    t.touches_90d,
        calls_90d:      t.calls_90d,
        emails_90d:     t.emails_90d,
        meetings_90d:   t.meetings_90d,
        last_touch_at:  t.last_touch_at
      }
    });
    if (!inserted) continue;
    emitted++;

    teamsCards.push({
      title:    'Account heating up',
      summary:  message,
      severity,
      facts: [
        ['Account',       accountName],
        ['Rep',           repName],
        ['Touches (90d)', String(t.touches_90d)],
        ['Last touch',    t.last_touch_at ? t.last_touch_at.slice(0, 10) : '—'],
        ['Mix',           `${t.calls_90d}c / ${t.emails_90d}e / ${t.meetings_90d}m / ${t.tasks_90d}t`]
      ],
      actions: entityUrl(t.account_entity_id)
        ? [{ label: 'Open account', url: entityUrl(t.account_entity_id) }]
        : []
    });
  }

  return { detected: detected.length, emitted, teamsCards };
}

// ---- top-level tick --------------------------------------------------------

/**
 * Run all detection rules for a workspace. Detected rows are upserted into
 * `cadence_alerts` (deduped per day). Newly-emitted rows trigger Teams cards
 * via TEAMS_CADENCE_WEBHOOK_URL (or TEAMS_INTAKE_WEBHOOK_URL as fallback).
 *
 * Returns a summary object suitable for direct response from the route.
 */
export async function runCadenceTick(workspaceId, options = {}) {
  if (!isOpsConfigured()) return { ok: false, error: 'ops_not_configured' };
  if (!workspaceId)       return { ok: false, error: 'workspace_required' };

  const startedAt = Date.now();

  const [goingCold, heatingUp] = await Promise.all([
    detectGoingCold(workspaceId, options),
    detectHeatingUp(workspaceId, options)
  ]);

  // Send Teams cards for newly-emitted rows. Fire-and-forget per card.
  const teamsCards = [...goingCold.teamsCards, ...heatingUp.teamsCards];
  const teamsWebhook =
    process.env.TEAMS_CADENCE_WEBHOOK_URL ||
    process.env.TEAMS_INTAKE_WEBHOOK_URL ||
    null;

  let teamsSent = 0;
  let teamsFailed = 0;
  if (teamsWebhook && teamsCards.length) {
    for (const card of teamsCards) {
      const r = await sendTeamsAlert({ ...card, webhookUrl: teamsWebhook });
      if (r.ok) teamsSent++;
      else      teamsFailed++;
    }
  }

  return {
    ok: true,
    workspace_id: workspaceId,
    duration_ms:  Date.now() - startedAt,
    going_cold:   { detected: goingCold.detected, emitted: goingCold.emitted },
    heating_up:   { detected: heatingUp.detected, emitted: heatingUp.emitted },
    teams_alerts: {
      sent:                teamsSent,
      failed:              teamsFailed,
      webhook_configured:  !!teamsWebhook
    }
  };
}
