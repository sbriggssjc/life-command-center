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

  // Build the originalMatch snapshot from two sources, in order:
  //   1. Fields provided by the caller in the POST body (preferred — fresh
  //      from the extract response the UI just saw).
  //   2. staged_intake_matches lookup (fallback — useful for out-of-band
  //      callers like Power Automate flows that don't have the match in hand).
  let originalMatch = null;

  if (match_reason || match_domain || match_property_id != null || match_confidence != null) {
    originalMatch = {
      id:           match_id || null,
      reason:       match_reason     || null,
      property_id:  match_property_id != null ? String(match_property_id) : null,
      confidence:   typeof match_confidence === 'number' ? match_confidence : null,
      match_result: { domain: match_domain || null },
    };
  } else {
    const matchLookup = await opsQuery('GET',
      `staged_intake_matches?intake_id=eq.${pgFilterVal(intake_id)}` +
      `&select=id,reason,property_id,confidence,match_result` +
      `&order=id.desc&limit=1`
    );
    if (matchLookup.ok && Array.isArray(matchLookup.data) && matchLookup.data.length) {
      originalMatch = matchLookup.data[0];
    } else {
      // Log the exact state so we can debug silent failures (either the
      // matcher never wrote, or the query fell afoul of a schema mismatch).
      console.warn('[intake-feedback] match snapshot lookup empty or failed:',
        JSON.stringify({
          ok:     matchLookup.ok,
          status: matchLookup.status,
          rowCount: Array.isArray(matchLookup.data) ? matchLookup.data.length : null,
          detail: JSON.stringify(matchLookup.data || {}).slice(0, 200),
        }));
    }
  }

  const row = {
    workspace_id:          workspaceId,
    intake_id,
    match_id:              match_id || originalMatch?.id || null,
    user_id:               user.id,
    decision,
    original_match_reason: originalMatch?.reason                       || null,
    original_domain:       originalMatch?.match_result?.domain         || null,
    original_property_id:  originalMatch?.property_id != null
                             ? String(originalMatch.property_id)
                             : null,
    original_confidence:   originalMatch?.confidence                   ?? null,
    corrected_domain:      corrected_domain                            || null,
    corrected_property_id: corrected_property_id != null
                             ? String(corrected_property_id)
                             : null,
    reason_text:           reason_text || null,
    metadata:              metadata && typeof metadata === 'object' ? metadata : {},
  };

  // Use resolution=merge-duplicates so a second vote from the same user on
  // the same intake updates the previous row (respects uq_sif_intake_user).
  // PostgREST requires `on_conflict=col1,col2` in the URL to know which
  // unique index to target; without it the INSERT fails with 409 instead of
  // upserting.
  const insertResult = await opsQuery(
    'POST',
    'staged_intake_feedback?on_conflict=intake_id,user_id',
    row,
    { Prefer: 'return=representation,resolution=merge-duplicates' }
  );

  // If the partial unique index (WHERE user_id IS NOT NULL) prevents
  // on_conflict from resolving on some deployments, fall back to an
  // explicit PATCH on the matching row.
  if (!insertResult.ok && insertResult.status === 409) {
    const patchResult = await opsQuery(
      'PATCH',
      `staged_intake_feedback?intake_id=eq.${pgFilterVal(intake_id)}` +
        `&user_id=eq.${pgFilterVal(user.id)}`,
      row,
      { Prefer: 'return=representation' }
    );
    if (patchResult.ok) {
      const patched = Array.isArray(patchResult.data) ? patchResult.data[0] : patchResult.data;
      return res.status(200).json({
        ok: true,
        feedback: patched,
        intake_status: await updateIntakeStatus(intake_id, decision),
        upserted: true,
      });
    }
    // Fall through to the generic error below if PATCH also failed.
  }

  if (!insertResult.ok) {
    return res.status(insertResult.status || 500).json({
      error: 'insert_failed',
      detail: insertResult.data,
    });
  }

  const inserted = Array.isArray(insertResult.data)
    ? insertResult.data[0]
    : insertResult.data;

  const newStatus = await updateIntakeStatus(intake_id, decision);

  return res.status(200).json({
    ok: true,
    feedback: inserted,
    intake_status: newStatus,
  });
}

// Map a feedback decision to a staged_intake_items.status and persist it.
// Returns the applied status (or null if decision doesn't dictate one).
async function updateIntakeStatus(intake_id, decision) {
  const newStatus =
      decision === 'approved'  ? 'matched'
    : decision === 'corrected' ? 'matched'
    : decision === 'rejected'  ? 'review_needed'
    : decision === 'no_match'  ? 'no_match'
    : decision === 'deferred'  ? 'review_needed'
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
