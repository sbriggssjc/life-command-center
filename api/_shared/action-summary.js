// ============================================================================
// W7.5 — Per-action Ollama summary (Scott's ask; proposal-only, flag-gated)
// ----------------------------------------------------------------------------
// After a spine-stamped comm advances/completes a deal's to-dos, append a
// ONE-LINE "action taken" narration to the activity event's metadata
// (metadata.action_summary), surfaced in the deal timeline + dossier
// correspondence section.
//
// Discipline:
//   - Flag-gated: W75_ACTION_SUMMARY must equal 'true' (default OFF). Registered
//     in feature_flags_registry (migration) so "off" is visible in the briefing.
//   - No fabrication: the narration may only reference the subject/body and the
//     to-dos ACTUALLY touched (passed into the prompt). The model returns
//     { summary, referenced_todos }; the validator drops the summary if any
//     referenced to-do label is not one of the touched labels — never blocks
//     the pipeline (a dropped summary is simply absent).
//   - Failure = no summary, never an error (Ollama via the invokeExtractionAI
//     seam; any throw/timeout → null).
// ============================================================================

const FLAG = 'W75_ACTION_SUMMARY';

export function actionSummaryEnabled() {
  return process.env[FLAG] === 'true';
}

// Map an lcc_advance_todos result to the set of human-readable to-do labels it
// actually touched (resolved or created). This is the authoritative "touched"
// set the narration is allowed to reference.
export function touchedActionLabels(advanceResult) {
  const labels = new Set();
  if (!advanceResult || typeof advanceResult !== 'object') return [];
  if (advanceResult.resolved_offer_review) labels.add('offer_review');
  if (advanceResult.resolved_reach_follow_up) labels.add('follow_up');
  if (advanceResult.resolved_awaiting) labels.add('seller_follow_up');
  const created = Array.isArray(advanceResult.created) ? advanceResult.created : [];
  for (const c of created) {
    const t = c && (c.action_type || c.type);
    if (t) labels.add(String(t));
  }
  return [...labels];
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// Parse the model's JSON reply tolerantly (it may wrap in prose / code fences).
function parseModelJson(text) {
  if (!text) return null;
  const raw = String(text);
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : (raw.match(/\{[\s\S]*\}/) || [raw])[0];
  try { return JSON.parse(candidate); } catch { return null; }
}

/**
 * Generate + validate a one-line action summary. Returns the string, or null
 * (flag off, no touched to-dos, AI failure, or a validation drop).
 *
 * @param invokeExtractionAI  the _shared/ai.js seam (Ollama primary)
 * @param touchedLabels       to-do labels the send actually touched (allow-list)
 */
export async function generateActionSummary({
  invokeExtractionAI,
  subject = '',
  body = '',
  touchedLabels = [],
  direction = 'outbound',
}) {
  if (!actionSummaryEnabled()) return null;
  if (typeof invokeExtractionAI !== 'function') return null;
  const allow = (Array.isArray(touchedLabels) ? touchedLabels : []).map(norm).filter(Boolean);
  if (!allow.length) return null; // nothing was actually completed — nothing to narrate

  const prompt = [
    'You narrate CRM actions in ONE short factual line (max 20 words).',
    `A ${direction} email was logged on a deal and it completed/updated these to-do items: ${touchedLabels.join(', ')}.`,
    'Write a single past-tense line describing what the email did to those to-dos.',
    'You may ONLY reference the to-do items listed above and the email subject. Invent nothing.',
    `Email subject: ${JSON.stringify(String(subject || '').slice(0, 200))}`,
    `Email body (truncated): ${JSON.stringify(String(body || '').slice(0, 400))}`,
    'Respond with STRICT JSON only: {"summary": "<one line>", "referenced_todos": ["<label>", ...]}',
    'referenced_todos MUST be a subset of the listed to-do items.',
  ].join('\n');

  let resp = null;
  try {
    resp = await invokeExtractionAI({ prompt });
  } catch (_e) {
    return null; // failure = no summary, never an error
  }
  if (!resp || !resp.ok) return null;
  const text = resp.data?.response ?? resp.data?.choices?.[0]?.message?.content ?? '';
  const parsed = parseModelJson(text);
  if (!parsed || typeof parsed.summary !== 'string') return null;

  const summary = parsed.summary.trim().replace(/\s+/g, ' ').slice(0, 240);
  if (!summary) return null;

  // Validator: every referenced to-do must be one of the touched labels.
  // A single fabricated reference drops the whole summary (never-fabricate).
  const allowSet = new Set(allow);
  const referenced = Array.isArray(parsed.referenced_todos) ? parsed.referenced_todos : [];
  for (const r of referenced) {
    if (!allowSet.has(norm(r))) return null;
  }
  return summary;
}

/**
 * Best-effort: generate the summary and PATCH it onto the activity event's
 * metadata. The caller passes the metadata object it already inserted so we
 * merge in-memory and write it back in one PATCH (no read, no race). Any
 * failure is swallowed — the summary is a proposal layer, never load-bearing.
 *
 * Returns { attached: true, summary } or { skipped: <reason> }.
 */
export async function maybeAttachActionSummary({
  opsQuery,
  invokeExtractionAI,
  activityId,
  metadata = {},
  subject = '',
  body = '',
  touchedLabels = [],
  direction = 'outbound',
}) {
  if (!actionSummaryEnabled()) return { skipped: 'flag_off' };
  if (!activityId || typeof opsQuery !== 'function') return { skipped: 'no_activity' };
  const summary = await generateActionSummary({ invokeExtractionAI, subject, body, touchedLabels, direction });
  if (!summary) return { skipped: 'no_summary' };
  try {
    const merged = { ...(metadata || {}), action_summary: summary };
    await opsQuery('PATCH', `activity_events?id=eq.${encodeURIComponent(String(activityId))}`,
      { metadata: merged }, { headers: { Prefer: 'return=minimal' } });
    return { attached: true, summary };
  } catch (_e) {
    return { skipped: 'patch_failed' };
  }
}
