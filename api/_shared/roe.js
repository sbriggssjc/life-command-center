// api/_shared/roe.js
// ============================================================================
// Rules of Engagement (ROE) — the "don't step on another broker" guard.
// ----------------------------------------------------------------------------
// Pure, deps-free computation used by the Contact 360 panel (GET /api/entities?
// action=contact360). It answers, at a glance, whether a contact/account is
// SAFE to call, needs CAUTION, or is off-limits because a colleague owns it.
//
// Signal sources (best-effort, honest about what we have):
//   * accountOwnerName — the SF Account OwnerId resolved to a Northmarq rep
//     (captured on the SF sync going forward; null today → fall back below).
//   * dealAssignees    — [{name, date}] from dia salesforce_activities.assigned_to
//     (the broker who logged each touch — the deal-level "who's working it"
//     signal that exists today).
//   * The listing-broker classifier (sf-nm-classifier.js) tells NM-team vs
//     another-NM-broker vs an outside/competitor firm.
//
// Doctrine: surface the risk, never fabricate. When we have no owner + no
// conflicting broker activity, the honest verdict is "safe". A named colleague
// on the account is "do not call". These functions are unit-tested.
// ============================================================================

import { isNorthmarqListingBroker, isCompetitorBroker } from './sf-nm-classifier.js';

// The operator's own team. Deal-book convention spells Team Briggs deals as
// "Scott Briggs" / "SJC; Briggs" (never literally "Team Briggs"), so a fuzzy
// briggs|sjc match is the reliable self-signal. Overridable via env for a
// different operator/team without a code change.
const TEAM_SELF_RE = (() => {
  const raw = (typeof process !== 'undefined' && process.env && process.env.ROE_TEAM_NAME_RE) || 'briggs|sjc';
  try { return new RegExp('\\b(' + raw + ')\\b', 'i'); }
  catch { return /\b(briggs|sjc)\b/i; }
})();

// Recent-activity window: an unassigned account with a colleague's touch inside
// this window is a CAUTION (they may be actively working it), not a hard block.
const RECENT_TOUCH_DAYS = Number(
  (typeof process !== 'undefined' && process.env && process.env.ROE_RECENT_TOUCH_DAYS) || 180
);

/**
 * Classify a broker/rep name into one of:
 *   'self'      — the operator's own team (Team Briggs / SJC)
 *   'nm_other'  — another Northmarq broker (internal poaching risk)
 *   'outside'   — a named competitor / outside firm
 *   'unknown'   — a name we can't classify
 * Returns 'none' for an empty/blank name. Pure.
 */
export function brokerClass(name) {
  const s = String(name || '').trim();
  if (!s) return 'none';
  if (TEAM_SELF_RE.test(s)) return 'self';
  // isNorthmarqListingBroker already excludes Team-Briggs names via TEAM_SELF's
  // superset, but we've handled 'self' first so an NM match here is a colleague.
  if (isNorthmarqListingBroker(s)) return 'nm_other';
  if (isCompetitorBroker(s)) return 'outside';
  return 'unknown';
}

function daysSince(dateStr) {
  const t = Date.parse(dateStr);
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / 86400000;
}

/**
 * Compute the Rules-of-Engagement verdict for a contact/account.
 *
 * @param {object} args
 *   @param {string|null} args.accountOwnerName  SF Account OwnerId → rep name (or null)
 *   @param {Array<{name:string,date?:string}>} args.dealAssignees  most-recent-first
 *   @param {boolean} [args.accountClosedWon]    the account has a closed/won deal
 * @returns {{
 *   verdict:'safe'|'caution'|'do_not_call',
 *   assigned_broker:string|null,
 *   assigned_broker_class:string,
 *   assigned_broker_source:'sf_owner'|'deal_assignee'|null,
 *   account_status:string|null,
 *   last_firm_touch:{date:string,broker:string}|null,
 *   headline:string,
 *   reasons:string[]
 * }}
 */
export function computeRoe(args = {}) {
  const accountOwnerName = (args.accountOwnerName && String(args.accountOwnerName).trim()) || null;
  const dealAssignees = Array.isArray(args.dealAssignees)
    ? args.dealAssignees.filter(a => a && String(a.name || '').trim())
    : [];
  const accountClosedWon = !!args.accountClosedWon;

  // Most-recent firm touch (the assignees are provided most-recent-first).
  const lastTouch = dealAssignees.length
    ? { date: dealAssignees[0].date || null, broker: String(dealAssignees[0].name).trim() }
    : null;

  // Pick the assigned broker: the SF Account owner is authoritative; else fall
  // back to the most-recent person who logged a touch (the deal-level signal).
  let assigned = null;
  let assignedSource = null;
  if (accountOwnerName) { assigned = accountOwnerName; assignedSource = 'sf_owner'; }
  else if (lastTouch && lastTouch.broker) { assigned = lastTouch.broker; assignedSource = 'deal_assignee'; }

  const cls = brokerClass(assigned);
  const reasons = [];
  let verdict = 'safe';
  let headline = 'Safe to call';

  if (cls === 'nm_other') {
    verdict = 'do_not_call';
    headline = 'Do not call — assigned to ' + assigned;
    reasons.push('Assigned to ' + assigned + ' (Northmarq) — a colleague owns this account.');
  } else if (cls === 'self') {
    verdict = 'safe';
    headline = 'Safe to call — your team';
    reasons.push((assignedSource === 'sf_owner' ? 'SF account owner' : 'Recent activity by') + ' ' + assigned + ' (Team Briggs).');
  } else if (cls === 'outside') {
    verdict = 'caution';
    headline = 'Caution — handled by ' + assigned;
    reasons.push(assigned + ' (outside broker) is on this account.');
  } else if (cls === 'unknown') {
    verdict = 'caution';
    headline = 'Caution — worked by ' + assigned;
    reasons.push('Worked by ' + assigned + ' — confirm ownership before outreach.');
  } else {
    // No assigned broker. Look for a recent colleague touch that warrants caution.
    const recentColleague = dealAssignees.find(a =>
      brokerClass(a.name) === 'nm_other' && daysSince(a.date) <= RECENT_TOUCH_DAYS);
    if (recentColleague) {
      verdict = 'caution';
      headline = 'Caution — recent Northmarq activity';
      reasons.push('Recent touch by ' + String(recentColleague.name).trim() + ' — confirm before outreach.');
    } else {
      verdict = 'safe';
      headline = 'Safe to call';
      reasons.push('No conflicting broker assignment.');
    }
  }

  if (accountClosedWon) {
    reasons.push('Account has a closed/won deal.');
    // A closed/won by a colleague is already do_not_call; by self stays safe.
  }

  return {
    verdict,
    assigned_broker: assigned,
    assigned_broker_class: cls,
    assigned_broker_source: assignedSource,
    account_status: accountClosedWon ? 'closed_won' : null,
    last_firm_touch: lastTouch,
    headline,
    reasons,
  };
}

// Map a dia salesforce_activities row to a coarse activity category, mirroring
// the sf-activity-ingest deriveSfCategory intent (email vs call vs meeting vs note).
export function sfActivityCategory(row) {
  const t = String((row && (row.task_subtype || row.nm_type)) || '').toLowerCase();
  const subj = String((row && row.subject) || '').toLowerCase();
  if (/email|\bre:|\bfw:|\bfwd:|sent\b/.test(t) || /^re:|^fw:|^fwd:|\bsent\b/.test(subj)) return 'email';
  if (/call|voicemail|\bvm\b|dial|phone/.test(t) || /\bcall\b|voicemail/.test(subj)) return 'call';
  if (/meet|event|visit|tour|showing/.test(t) || /\bmeeting\b|\btour\b|\bvisit\b/.test(subj)) return 'meeting';
  if (/note/.test(t)) return 'note';
  return 'note';
}

/**
 * Merge the LCC activity_events timeline with the dia salesforce_activities
 * timeline into ONE chronological, broker-labeled view. Pure.
 *   lccEvents: activity_events rows ({occurred_at, category, title, body,
 *              source_type, users:{display_name}})
 *   sfRows:    salesforce_activities rows ({activity_date, subject, nm_notes,
 *              assigned_to, status, nm_type, task_subtype})
 * Each item carries `source` ('lcc'|'sf') and `broker` (the owning NM broker,
 * from assigned_to on SF rows / the actor on LCC rows). Sorted newest-first,
 * capped at `limit`.
 */
export function mergeTimeline(lccEvents, sfRows, opts = {}) {
  const limit = Number.isFinite(opts.limit) ? opts.limit : 40;
  const items = [];

  for (const a of (Array.isArray(lccEvents) ? lccEvents : [])) {
    const ts = a.occurred_at || a.created_at || null;
    items.push({
      source: 'lcc',
      ts,
      category: a.category || 'note',
      title: a.title || '(untitled)',
      body: a.body || null,
      broker: (a.users && a.users.display_name) || null,
      via: (a.source_type && a.source_type !== 'manual') ? a.source_type : null,
      status: null,
    });
  }

  for (const r of (Array.isArray(sfRows) ? sfRows : [])) {
    const ts = r.activity_date || r.created_at || null;
    items.push({
      source: 'sf',
      ts,
      category: sfActivityCategory(r),
      title: r.subject || '(no subject)',
      body: r.nm_notes || null,
      broker: (r.assigned_to && String(r.assigned_to).trim()) || null,
      via: 'salesforce',
      status: r.status || null,
    });
  }

  items.sort((x, y) => {
    const tx = Date.parse(x.ts || '') || 0;
    const ty = Date.parse(y.ts || '') || 0;
    return ty - tx;
  });

  return items.slice(0, limit);
}
