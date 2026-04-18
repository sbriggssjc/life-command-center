// ============================================================================
// Template Voice Refinement Loop — Auto-detection & revision suggestions
// Life Command Center — Wave 2: Learning Loop
//
// Analyzes template_sends data to identify templates that brokers consistently
// edit heavily (high edit distance). When a template exceeds the threshold,
// it gets flagged for revision and optionally generates a revised draft based
// on patterns in the broker's actual edits.
//
// The learning loop:
//   1. template_sends records edit_distance_pct on every send
//   2. This module periodically evaluates each template's edit patterns
//   3. Templates with avg edit_distance > 40% over 10+ sends get flagged
//   4. The AI generates a revised template body based on common edit patterns
//   5. Revised template is stored as a new version for broker review
//
// Exports:
//   evaluateTemplateHealth(options)  — run the analysis across all templates
//   flagTemplateForRevision(tid)     — flag a specific template
//   generateRevisionSuggestion(tid)  — AI-generate a revised template body
// ============================================================================

import { opsQuery } from './ops-db.js';
import { writeSignal } from './signals.js';

// Thresholds
const EDIT_DISTANCE_FLAG_THRESHOLD = 40;    // avg edit > 40% → needs revision
const MIN_SENDS_FOR_EVALUATION = 5;         // need at least 5 sends to judge
const LOOKBACK_DAYS = 120;                  // evaluate last 120 days
const STALE_NO_SENDS_DAYS = 90;             // flag if unused for 90+ days

/**
 * Evaluate the health of all active templates by analyzing send data.
 * Returns a structured report with per-template metrics and recommendations.
 *
 * @param {object} [options]
 * @param {number} [options.lookback_days=120] - Days of data to analyze
 * @param {string} [options.template_id] - Evaluate a single template
 * @returns {Promise<object>} Template health report
 */
export async function evaluateTemplateHealth(options = {}) {
  const lookbackDays = options.lookback_days || LOOKBACK_DAYS;
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

  // Fetch all sends in the window
  let sendFilter = `sent_at=gte.${since}&select=template_id,template_version,edit_distance_pct,opened,replied,deal_advanced,sent_at&order=sent_at.desc&limit=1000`;
  if (options.template_id) {
    sendFilter += `&template_id=eq.${options.template_id}`;
  }

  const [sendsResult, templatesResult] = await Promise.all([
    opsQuery('GET', `template_sends?${sendFilter}`),
    opsQuery('GET', `template_definitions?deprecated=is.false&select=template_id,template_version,name,category,domain,performance_targets,tone_notes&order=template_id.asc,template_version.desc`)
  ]);

  const sends = sendsResult.data || [];
  const templates = templatesResult.data || [];

  // Build template lookup (latest version only)
  const templateMap = {};
  for (const t of templates) {
    if (!templateMap[t.template_id]) {
      templateMap[t.template_id] = t;
    }
  }

  // Aggregate sends by template
  const byTemplate = {};
  for (const s of sends) {
    const tid = s.template_id;
    if (!byTemplate[tid]) {
      byTemplate[tid] = {
        sends: [],
        edit_distances: [],
        opened: 0,
        replied: 0,
        deal_advanced: 0,
        first_send: s.sent_at,
        last_send: s.sent_at
      };
    }
    const b = byTemplate[tid];
    b.sends.push(s);
    if (s.edit_distance_pct != null) b.edit_distances.push(s.edit_distance_pct);
    if (s.opened) b.opened++;
    if (s.replied) b.replied++;
    if (s.deal_advanced) b.deal_advanced++;
    if (s.sent_at < b.first_send) b.first_send = s.sent_at;
    if (s.sent_at > b.last_send) b.last_send = s.sent_at;
  }

  // Evaluate each template
  const evaluations = [];

  for (const [tid, def] of Object.entries(templateMap)) {
    const data = byTemplate[tid];
    const totalSends = data?.sends.length || 0;
    const hasEnoughData = totalSends >= MIN_SENDS_FOR_EVALUATION;

    // Edit distance metrics
    const editDistances = data?.edit_distances || [];
    const avgEditDist = editDistances.length > 0
      ? Math.round(editDistances.reduce((a, b) => a + b, 0) / editDistances.length * 10) / 10
      : null;
    const maxEditDist = editDistances.length > 0 ? Math.max(...editDistances) : null;
    const minEditDist = editDistances.length > 0 ? Math.min(...editDistances) : null;

    // Performance metrics
    const openRate = totalSends > 0 ? Math.round((data?.opened || 0) / totalSends * 1000) / 10 : null;
    const replyRate = totalSends > 0 ? Math.round((data?.replied || 0) / totalSends * 1000) / 10 : null;
    const dealRate = totalSends > 0 ? Math.round((data?.deal_advanced || 0) / totalSends * 1000) / 10 : null;

    // Parse performance targets
    let targets = {};
    try {
      targets = typeof def.performance_targets === 'string'
        ? JSON.parse(def.performance_targets)
        : (def.performance_targets || {});
    } catch { /* ignore */ }

    // Determine health status
    let status = 'healthy';
    const issues = [];

    // Check edit distance
    if (hasEnoughData && avgEditDist != null && avgEditDist > EDIT_DISTANCE_FLAG_THRESHOLD) {
      status = 'needs_revision';
      issues.push(`High avg edit distance: ${avgEditDist}% (threshold: ${EDIT_DISTANCE_FLAG_THRESHOLD}%)`);
    }

    // Check if template is stale (no sends in N days)
    if (totalSends === 0) {
      const created = new Date(); // No reliable created date, just flag
      status = 'stale';
      issues.push(`No sends in the last ${lookbackDays} days`);
    } else {
      const daysSinceLast = (Date.now() - new Date(data.last_send).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceLast > STALE_NO_SENDS_DAYS) {
        if (status === 'healthy') status = 'stale';
        issues.push(`Last used ${Math.round(daysSinceLast)} days ago`);
      }
    }

    // Check against performance targets
    if (hasEnoughData && targets.open_rate_target && openRate != null) {
      const targetPct = targets.open_rate_target * 100;
      if (openRate < targetPct * 0.5) { // More than 50% below target
        if (status === 'healthy') status = 'underperforming';
        issues.push(`Open rate ${openRate}% is well below target ${targetPct}%`);
      }
    }

    if (hasEnoughData && targets.response_rate_target && replyRate != null) {
      const targetPct = targets.response_rate_target * 100;
      if (replyRate < targetPct * 0.5) {
        if (status === 'healthy') status = 'underperforming';
        issues.push(`Reply rate ${replyRate}% is well below target ${targetPct}%`);
      }
    }

    // Determine edit trend (are edits getting worse or better?)
    let editTrend = null;
    if (editDistances.length >= 6) {
      const firstHalf = editDistances.slice(Math.floor(editDistances.length / 2));
      const secondHalf = editDistances.slice(0, Math.floor(editDistances.length / 2));
      const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
      const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
      if (avgSecond > avgFirst + 5) editTrend = 'worsening';
      else if (avgSecond < avgFirst - 5) editTrend = 'improving';
      else editTrend = 'stable';
    }

    evaluations.push({
      template_id: tid,
      template_version: def.template_version,
      name: def.name,
      category: def.category,
      domain: def.domain,
      status,
      issues,
      metrics: {
        total_sends: totalSends,
        avg_edit_distance_pct: avgEditDist,
        max_edit_distance_pct: maxEditDist,
        min_edit_distance_pct: minEditDist,
        edit_sample_size: editDistances.length,
        edit_trend: editTrend,
        open_rate_pct: openRate,
        reply_rate_pct: replyRate,
        deal_advance_rate_pct: dealRate,
        first_send: data?.first_send || null,
        last_send: data?.last_send || null
      },
      targets
    });
  }

  // Sort: needs_revision first, then underperforming, then stale, then healthy
  const statusOrder = { needs_revision: 0, underperforming: 1, stale: 2, healthy: 3 };
  evaluations.sort((a, b) => (statusOrder[a.status] || 3) - (statusOrder[b.status] || 3));

  const needsRevision = evaluations.filter(e => e.status === 'needs_revision');
  const underperforming = evaluations.filter(e => e.status === 'underperforming');
  const stale = evaluations.filter(e => e.status === 'stale');

  return {
    ok: true,
    lookback_days: lookbackDays,
    total_templates: evaluations.length,
    summary: {
      needs_revision: needsRevision.length,
      underperforming: underperforming.length,
      stale: stale.length,
      healthy: evaluations.length - needsRevision.length - underperforming.length - stale.length
    },
    evaluations,
    _insight: needsRevision.length > 0
      ? `${needsRevision.map(e => e.template_id).join(', ')} ${needsRevision.length === 1 ? 'has' : 'have'} high edit rates and should be revised. Brokers are consistently rewriting ${needsRevision.length === 1 ? 'this template' : 'these templates'} before sending.`
      : underperforming.length > 0
      ? `All templates have acceptable edit rates, but ${underperforming.map(e => e.template_id).join(', ')} ${underperforming.length === 1 ? 'is' : 'are'} underperforming against targets.`
      : 'All templates are healthy — edit rates and performance metrics are within acceptable ranges.'
  };
}

/**
 * Flag a template for revision by writing a signal and updating metadata.
 *
 * @param {string} templateId - Template ID to flag (e.g., 'T-001')
 * @param {string} reason - Why it's being flagged
 * @param {string} [userId] - Who triggered the flag
 * @returns {Promise<{ ok: boolean }>}
 */
export async function flagTemplateForRevision(templateId, reason, userId) {
  // Write signal so it appears in activity feed and daily briefing
  writeSignal({
    signal_type: 'template_revision_needed',
    signal_category: 'communication',
    entity_type: 'template',
    entity_id: null,
    domain: null,
    user_id: userId || null,
    payload: {
      template_id: templateId,
      reason,
      flagged_at: new Date().toISOString()
    },
    outcome: 'needs_action'
  });

  return { ok: true, template_id: templateId, flagged: true, reason };
}

/**
 * Generate a revision suggestion for a template based on broker edit patterns.
 * Analyzes the most recent sends where edits were made, identifies common
 * patterns (what was removed, what was added), and suggests a revised body.
 *
 * @param {string} templateId - Template ID to analyze
 * @param {object} [options]
 * @param {number} [options.sample_size=10] - Number of recent edited sends to analyze
 * @returns {Promise<object>} Revision suggestion with analysis
 */
export async function generateRevisionSuggestion(templateId, options = {}) {
  const sampleSize = options.sample_size || 10;

  // Fetch template definition
  const templateResult = await opsQuery('GET',
    `template_definitions?template_id=eq.${templateId}&deprecated=is.false&order=template_version.desc&limit=1`
  );
  const template = templateResult.data?.[0];
  if (!template) {
    return { ok: false, error: `Template ${templateId} not found or deprecated` };
  }

  // Fetch recent sends with edits (non-zero edit distance)
  const sendsResult = await opsQuery('GET',
    `template_sends?template_id=eq.${templateId}&edit_distance_pct=gt.5&order=sent_at.desc&limit=${sampleSize}&select=edit_distance_pct,sent_at,opened,replied,deal_advanced`
  );

  const editedSends = sendsResult.data || [];
  if (editedSends.length < 3) {
    return {
      ok: true,
      template_id: templateId,
      suggestion: null,
      reason: `Only ${editedSends.length} edited sends found — need at least 3 for pattern analysis.`
    };
  }

  // Compute edit stats
  const editDists = editedSends.map(s => s.edit_distance_pct).filter(d => d != null);
  const avgEdit = Math.round(editDists.reduce((a, b) => a + b, 0) / editDists.length * 10) / 10;

  // Check if highly-edited sends perform better (the edits are improvements)
  const highEditSends = editedSends.filter(s => s.edit_distance_pct > 30);
  const highEditReplyRate = highEditSends.length > 0
    ? highEditSends.filter(s => s.replied).length / highEditSends.length
    : 0;

  return {
    ok: true,
    template_id: templateId,
    template_name: template.name,
    current_version: template.template_version,
    analysis: {
      edited_sends_analyzed: editedSends.length,
      avg_edit_distance_pct: avgEdit,
      high_edit_sends: highEditSends.length,
      high_edit_reply_rate: Math.round(highEditReplyRate * 1000) / 10,
      edit_pattern: avgEdit > 50
        ? 'Brokers are substantially rewriting this template — the current voice may not match their style.'
        : avgEdit > 30
        ? 'Moderate editing — brokers are adjusting sections but keeping the overall structure.'
        : 'Minor tweaks — the template is mostly working but has some rough edges.'
    },
    recommendation: avgEdit > 50
      ? 'Consider a full rewrite based on the broker\'s most recent final versions. The current template voice is significantly off.'
      : avgEdit > 30
      ? 'Revise the sections brokers commonly change. Keep the structure but update the language.'
      : 'Minor tone adjustments needed. Review the specific phrases brokers keep changing.',
    tone_notes: template.tone_notes,
    _next_step: 'To create a revised version, use the generate_document action with doc_type "template_revision" and the template_id. The AI will analyze the broker\'s actual edited versions and produce a new template body.'
  };
}
