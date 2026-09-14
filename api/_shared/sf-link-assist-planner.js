// ============================================================================
// W9.3 WS1 — SF-link candidate ASSIST planner (pure, dependency-free brain).
//
// The `sf_link_candidate` review lane (~3.3k needs_review rows) is workable but
// dead-slow at Scott's pace: each card demands un-aided judgment of "is this owner
// the same party as this Salesforce account?". This ports the prompt-80 assist
// pattern: a nightly bounded Ollama pass RANKS each candidate's same-party
// likelihood (verdict + confidence + one-line evidence), stored as an ANNOTATION in
// lcc_clean_assist_proposals (the federated-lane assist store the lane already
// renders/attaches for `sf_link_candidate`) — NEVER a verdict. The lane then sorts
// easy-first (high assist confidence), one-click "assist agrees" rides the EXISTING
// human verdict path, and each verdict self-measures agree/disagree into U4.
//
// Doctrine: the local model ANNOTATES, the human DECIDES, nothing auto-applies. The
// assist is metadata; it structurally cannot flip a queue row or write a canonical
// SF id.
//
// Pure: no IO, no throws. IO side: api/admin.js::handleSfLinkAssistTick.
// ============================================================================

export const SF_ASSIST_SOURCE = 'w9_3_sf_assist';
export const SF_ASSIST_KIND = 'review_triage';          // fits lcc_clean_assist_proposals CHECK
export const SF_ASSIST_DECISION_TYPE = 'sf_link_candidate';

// Allowed verdicts (the review_triage vocabulary the clean-assist store already
// accepts + renders). merge = same party; not = distinct; uncertain = thin/ambiguous.
const SF_ASSIST_VERDICTS = new Set(['merge', 'not', 'research', 'uncertain']);

// Build the Ollama prompt for one candidate. Grounds ONLY on the card's own facts
// (owner name/canonical/state/property_count vs the resolved SF account
// name/id/score + any conflict), and forbids fabrication.
export function buildSfAssistPrompt(ctx) {
  const c = ctx || {};
  const payload = {
    owner_name: c.owner_name || null,
    owner_canonical_name: c.canonical_name || null,
    owner_state: c.state || null,
    owner_property_count: c.property_count != null ? c.property_count : null,
    candidate_sf_account_name: c.sf_account_name_resolved || null,
    candidate_sf_account_id: c.sf_account_id_resolved || null,
    machine_score: c.score_resolved != null ? c.score_resolved : null,
    conflict_existing_sf_id: c.conflict_existing_id || null,
  };
  return [
    'You are the LCC Ollama SF-link assist agent.',
    'You only PROPOSE a ranking. You never decide truth, never link records, never write data, and never invent facts.',
    'Decide whether the property owner and the Salesforce account below are the SAME real-world party.',
    'Judge on the visible name/state/portfolio evidence ONLY. If a real match is not clearly supported, return "not". If evidence is too thin either way, return "uncertain".',
    'Return ONLY strict JSON with keys: verdict, confidence, reason.',
    '- verdict: one of "merge" (same party), "not" (different party), "uncertain".',
    '- confidence: number 0..1 (your certainty in the verdict).',
    '- reason: ONE short sentence citing the specific same-party or distinct evidence (<= 160 chars).',
    JSON.stringify({ candidate: payload }, null, 2),
  ].join('\n');
}

export function parseSfAssistJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  try { return JSON.parse(candidate); } catch (_e) { /* fall through */ }
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(candidate.slice(first, last + 1)); } catch (_e) { /* fall through */ }
  }
  return null;
}

// Normalize a raw model proposal into the stored assist shape. Unknown/absent
// verdict -> 'uncertain'; confidence clamped [0,1]; reason trimmed.
export function normalizeSfAssistProposal(raw) {
  const obj = raw && typeof raw === 'object' ? raw : {};
  let verdict = String(obj.verdict || '').toLowerCase().trim();
  if (!SF_ASSIST_VERDICTS.has(verdict)) verdict = 'uncertain';
  const n = Number(obj.confidence);
  const confidence = Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
  const reason = String(obj.reason || '').replace(/\s+/g, ' ').trim().slice(0, 240)
    || 'No grounded reason supplied.';
  return { verdict, confidence, reason };
}

// The lane orders easy-first by an assist SORT KEY: a confident "merge" or "not"
// ranks above "uncertain"; higher confidence first. Returns a number (higher =
// earlier in the lane). No assist => 0 (falls to the rank_value tiebreak).
export function sfAssistSortKey(assist) {
  if (!assist) return 0;
  const v = String(assist.verdict || '').toLowerCase();
  const conf = Math.max(0, Math.min(1, Number(assist.confidence) || 0));
  if (v === 'merge' || v === 'not') return 1 + conf;   // decisive calls: 1..2
  return conf;                                         // uncertain: 0..1
}

// Map the human verdict path -> the entity_match_labels verdict the sf_link lane
// records (approve/switch => same_party; reject/keep_existing => distinct), then
// compare to the assist to self-measure agreement. Returns:
//   { measured: bool, agreed: bool|null, assist_verdict, human_verdict }
// Only decisive assist verdicts (merge/not) are measured; 'uncertain'/'research'
// are not counted (measured=false) — an honest accuracy denominator.
export function sfAssistAgreement(assistVerdict, humanLabelVerdict) {
  const a = String(assistVerdict || '').toLowerCase();
  const h = String(humanLabelVerdict || '').toLowerCase();     // 'same_party' | 'distinct'
  if (a !== 'merge' && a !== 'not') return { measured: false, agreed: null, assist_verdict: a, human_verdict: h };
  if (h !== 'same_party' && h !== 'distinct') return { measured: false, agreed: null, assist_verdict: a, human_verdict: h };
  const assistSays = a === 'merge' ? 'same_party' : 'distinct';
  return { measured: true, agreed: assistSays === h, assist_verdict: a, human_verdict: h };
}
