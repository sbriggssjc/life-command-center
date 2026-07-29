// api/_handlers/intake-feedback.js
// ============================================================================
// Intake Matcher Feedback — human decisions on matcher suggestions.
// Life Command Center
//
// Routes (mounted via api/intake.js):
//   POST /api/intake/feedback    — record a human decision on an intake match
//   GET  /api/intake/feedback?intake_id=UUID — list feedback for an intake
//   GET  /api/intake/accuracy?days=30         — recent matcher accuracy stats
//
// Schema lives in supabase/migrations/20260422150000_staged_intake_feedback.sql.
//
// The feedback substrate is the first step toward self-learning: every time a
// human triages an intake, we snapshot what the matcher suggested AND what the
// human decided. Nightly pg_cron rollup (compute_matcher_accuracy) aggregates
// approval rates by (match_reason × domain × confidence_band) so we can:
//   - surface "this matcher rule is unreliable" signals to ops dashboards
//   - later, adjust matcher default confidence based on empirical approval
//   - retrain fuzzy thresholds offline
// ============================================================================

import { opsQuery, pgFilterVal } from '../_shared/ops-db.js';
import { authenticate, requireRole } from '../_shared/auth.js';

const VALID_DECISIONS = new Set([
  'approved', 'rejected', 'corrected', 'deferred', 'no_match',
]);

// ============================================================================
// writeIntakeFeedback — the CANONICAL matcher-feedback writer.
//
// This is the single place that snapshots the matcher's suggestion and
// persists one staged_intake_feedback row. The HTTP handler (recordFeedback)
// and every internal caller (Decision Center match_disambiguation verdicts in
// api/admin.js, the human promote path in api/intake.js) go through this so we
// never duplicate the snapshot/upsert/409-fallback logic (audit finding 3.4.3,
// W1.1). It performs NO auth and returns a plain result object — callers own
// their own req/res + authorization.
//
// Snapshot sourcing (in order):
//   1. Caller-provided matcher fields (matchReason/matchDomain/matchPropertyId/
//      matchConfidence) — preferred when the caller already read the machine's
//      row (e.g. admin.js reads the machine row to decide approved-vs-corrected).
//   2. staged_intake_matches lookup — latest row for the intake. Pass
//      excludeManualInLookup:true to skip the confidence-1.0 manual pick rows
//      so the accuracy bands reflect the MACHINE's real confidence, not the
//      human's 1.0.
//
// Returns { ok, status, feedback?, originalMatch?, upserted?, error?, detail? }.
// ============================================================================

export async function writeIntakeFeedback(params = {}) {
  const {
    workspaceId,
    intakeId,
    matchId = null,
    userId = null,
    decision,
    correctedDomain = null,
    correctedPropertyId = null,
    reasonText = null,
    metadata = {},
    // Caller-provided matcher snapshot (preferred). If none are supplied, the
    // machine's latest match row is looked up below.
    matchReason,
    matchDomain,
    matchPropertyId,
    matchConfidence,
    excludeManualInLookup = false,
  } = params;

  if (!workspaceId) return { ok: false, status: 400, error: 'workspace_required' };
  if (!intakeId || typeof intakeId !== 'string') {
    return { ok: false, status: 400, error: 'intake_id_required' };
  }
  if (!decision || !VALID_DECISIONS.has(decision)) {
    return { ok: false, status: 400, error: 'invalid_decision', valid: [...VALID_DECISIONS] };
  }

  let originalMatch = null;
  if (matchReason || matchDomain || matchPropertyId != null || matchConfidence != null) {
    originalMatch = {
      id:           matchId || null,
      reason:       matchReason     || null,
      property_id:  matchPropertyId != null ? String(matchPropertyId) : null,
      confidence:   typeof matchConfidence === 'number' ? matchConfidence : null,
      match_result: { domain: matchDomain || null },
    };
  } else {
    // Exclude the manual/decision-center pick rows (confidence 1.0) when asked,
    // so we snapshot the matcher's real output for the accuracy bands.
    const manualFilter = excludeManualInLookup ? '&decision=neq.manual_match' : '';
    const matchLookup = await opsQuery('GET',
      `staged_intake_matches?intake_id=eq.${pgFilterVal(intakeId)}${manualFilter}` +
      `&select=id,reason,property_id,confidence,match_result` +
      `&order=created_at.desc,id.desc&limit=1`
    );
    if (matchLookup.ok && Array.isArray(matchLookup.data) && matchLookup.data.length) {
      originalMatch = matchLookup.data[0];
    } else {
      console.warn('[intake-feedback] match snapshot lookup empty or failed:',
        JSON.stringify({
          ok:       matchLookup.ok,
          status:   matchLookup.status,
          rowCount: Array.isArray(matchLookup.data) ? matchLookup.data.length : null,
        }));
    }
  }

  const row = {
    workspace_id:          workspaceId,
    intake_id:             intakeId,
    match_id:              matchId || originalMatch?.id || null,
    user_id:               userId || null,
    decision,
    original_match_reason: originalMatch?.reason               || null,
    original_domain:       originalMatch?.match_result?.domain || null,
    original_property_id:  originalMatch?.property_id != null
                             ? String(originalMatch.property_id)
                             : null,
    original_confidence:   originalMatch?.confidence           ?? null,
    corrected_domain:      correctedDomain                     || null,
    corrected_property_id: correctedPropertyId != null
                             ? String(correctedPropertyId)
                             : null,
    reason_text:           reasonText || null,
    metadata:              metadata && typeof metadata === 'object' ? metadata : {},
  };

  // resolution=merge-duplicates so a repeat vote from the same user on the same
  // intake updates the prior row (respects uq_sif_intake_user).
  const insertResult = await opsQuery(
    'POST',
    'staged_intake_feedback?on_conflict=intake_id,user_id',
    row,
    { Prefer: 'return=representation,resolution=merge-duplicates' }
  );

  // If on_conflict can't resolve against the partial unique index on some
  // deployments, fall back to an explicit PATCH (only meaningful when a user is
  // attached — the partial index is WHERE user_id IS NOT NULL).
  if (!insertResult.ok && insertResult.status === 409 && userId) {
    const patchResult = await opsQuery(
      'PATCH',
      `staged_intake_feedback?intake_id=eq.${pgFilterVal(intakeId)}` +
        `&user_id=eq.${pgFilterVal(userId)}`,
      row,
      { Prefer: 'return=representation' }
    );
    if (patchResult.ok) {
      const patched = Array.isArray(patchResult.data) ? patchResult.data[0] : patchResult.data;
      return { ok: true, status: 200, feedback: patched, originalMatch, upserted: true };
    }
  }

  if (!insertResult.ok) {
    return { ok: false, status: insertResult.status || 500, error: 'insert_failed', detail: insertResult.data };
  }

  const inserted = Array.isArray(insertResult.data) ? insertResult.data[0] : insertResult.data;
  return { ok: true, status: 200, feedback: inserted, originalMatch };
}

// ============================================================================
// POST /api/intake/feedback — record a decision
// GET  /api/intake/feedback?intake_id=UUID — list history for an intake
// ============================================================================

export async function handleIntakeFeedback(req, res) {
  if (req.method === 'POST') return recordFeedback(req, res);
  if (req.method === 'GET')  return listFeedback(req, res);
  return res.status(405).json({ error: `Method ${req.method} not allowed` });
}

async function recordFeedback(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;

  const workspaceId = req.headers['x-lcc-workspace']
    || user.memberships?.[0]?.workspace_id
    || process.env.LCC_DEFAULT_WORKSPACE_ID;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context' });

  if (!requireRole(user, 'operator', workspaceId)) {
    return res.status(403).json({ error: 'Operator role required' });
  }

  const body = req.body || {};
  const {
    intake_id,
    match_id,
    decision,
    corrected_domain,
    corrected_property_id,
    reason_text,
    metadata,
    // Caller-provided matcher snapshot fields — a triage UI already has the
    // match from its extract response, so it should pass these directly
    // instead of forcing a DB roundtrip. Falls back to DB lookup below.
    match_reason,
    match_domain,
    match_property_id,
    match_confidence,
  } = body;

  if (!intake_id || typeof intake_id !== 'string') {
    return res.status(400).json({ error: 'intake_id (UUID string) required' });
  }
  if (!decision || !VALID_DECISIONS.has(decision)) {
    return res.status(400).json({
      error: 'decision required',
      valid: [...VALID_DECISIONS],
    });
  }
  if (decision === 'corrected' && !corrected_property_id) {
    return res.status(400).json({
      error: 'corrected_property_id required when decision=corrected',
    });
  }

  // Delegate to the canonical writer. The HTTP path keeps its historical
  // snapshot behavior (latest match row, manual rows NOT excluded) so this
  // refactor is behavior-neutral for existing triage-UI callers.
  const result = await writeIntakeFeedback({
    workspaceId,
    intakeId:            intake_id,
    matchId:             match_id || null,
    userId:              user.id,
    decision,
    correctedDomain:     corrected_domain,
    correctedPropertyId: corrected_property_id,
    reasonText:          reason_text,
    metadata,
    matchReason:         match_reason,
    matchDomain:         match_domain,
    matchPropertyId:     match_property_id,
    matchConfidence:     match_confidence,
  });

  if (!result.ok) {
    return res.status(result.status || 500).json({
      error:  result.error || 'insert_failed',
      detail: result.detail,
    });
  }

  const newStatus = await updateIntakeStatus(intake_id, decision);

  return res.status(200).json({
    ok: true,
    feedback: result.feedback,
    intake_status: newStatus,
    ...(result.upserted ? { upserted: true } : {}),
  });
}

// Map a feedback decision to a staged_intake_items.status and persist it.
// Returns the applied status (or null if decision doesn't dictate one).
async function updateIntakeStatus(intake_id, decision) {
  // Bug-fix #3 (2026-05-17): 'review_needed' was a typo of the canonical
  // 'review_required' status. The paired migration expands the CHECK to
  // accept 'matched' and 'no_match' as well, so this mapping is now
  // schema-valid for every decision path.
  const newStatus =
      decision === 'approved'  ? 'matched'
    : decision === 'corrected' ? 'matched'
    : decision === 'rejected'  ? 'review_required'
    : decision === 'no_match'  ? 'no_match'
    : decision === 'deferred'  ? 'review_required'
    : null;

  if (newStatus) {
    await opsQuery(
      'PATCH',
      `staged_intake_items?intake_id=eq.${pgFilterVal(intake_id)}`,
      { status: newStatus }
    ).catch(err =>
      console.error('[intake-feedback] status update failed:', intake_id, err.message)
    );
  }
  return newStatus;
}

async function listFeedback(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;

  const workspaceId = req.headers['x-lcc-workspace']
    || user.memberships?.[0]?.workspace_id
    || process.env.LCC_DEFAULT_WORKSPACE_ID;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context' });

  const intakeId = req.query.intake_id;
  if (!intakeId) {
    return res.status(400).json({ error: 'intake_id query param required' });
  }

  const result = await opsQuery('GET',
    `staged_intake_feedback?intake_id=eq.${pgFilterVal(intakeId)}` +
    `&workspace_id=eq.${pgFilterVal(workspaceId)}` +
    `&select=id,decision,original_match_reason,original_domain,` +
            `original_property_id,original_confidence,corrected_domain,` +
            `corrected_property_id,reason_text,user_id,created_at` +
    `&order=created_at.desc&limit=25`
  );

  if (!result.ok) {
    return res.status(result.status || 500).json({
      error: 'list_failed',
      detail: result.data,
    });
  }

  return res.status(200).json({
    ok: true,
    intake_id: intakeId,
    feedback: result.data || [],
  });
}

// ============================================================================
// GET /api/intake/accuracy?days=30 — matcher accuracy rollup
// ============================================================================

export async function handleMatcherAccuracy(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const user = await authenticate(req, res);
  if (!user) return;

  // Accuracy stats are workspace-global (cross-workspace for now since the
  // rollup doesn't partition on workspace_id). Revisit if multi-tenant
  // isolation becomes important.
  const days = parseInt(req.query.days || '90', 10);
  const safeDays = Number.isFinite(days) && days > 0 && days <= 365 ? days : 90;

  // Two sources: the nightly-rolled stats table (fast, stable) and a live
  // over-the-window read (fresh, slower). Prefer the view for the default
  // case; if ?fresh=true is passed, compute from raw feedback.
  if (req.query.fresh === 'true') {
    const computeResult = await opsQuery('POST',
      'rpc/compute_matcher_accuracy',
      { p_days: safeDays }
    );
    if (!computeResult.ok) {
      return res.status(computeResult.status || 500).json({
        error: 'recompute_failed',
        detail: computeResult.data,
      });
    }
  }

  const statsResult = await opsQuery('GET',
    `v_matcher_accuracy_recent?select=*`
  );
  if (!statsResult.ok) {
    return res.status(statsResult.status || 500).json({
      error: 'stats_fetch_failed',
      detail: statsResult.data,
    });
  }

  // Also return a simple summary: overall approval rate + counts of each
  // decision across the window. Useful for a "how is the matcher doing?"
  // widget without drilling into per-reason bands.
  const summaryResult = await opsQuery('GET',
    `staged_intake_feedback?` +
    `created_at=gte.${new Date(Date.now() - safeDays * 86400_000).toISOString()}` +
    `&select=decision`
  );
  let summary = null;
  if (summaryResult.ok && Array.isArray(summaryResult.data)) {
    const counts = { approved: 0, rejected: 0, corrected: 0, deferred: 0, no_match: 0 };
    for (const row of summaryResult.data) {
      if (row.decision in counts) counts[row.decision]++;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    summary = {
      window_days:     safeDays,
      total_decisions: total,
      counts,
      approval_rate:   total > 0 ? Math.round((counts.approved / total) * 1000) / 1000 : null,
    };
  }

  return res.status(200).json({
    ok:       true,
    summary,
    by_band:  statsResult.data || [],
    computed: req.query.fresh === 'true',
  });
}
