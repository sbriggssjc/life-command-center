// Prompt 80 — Match-disambiguation pre-rank assist.
//
// Pure, dependency-free helpers for the W8 consumption aid that finally makes
// the match_disambiguation lane workable (1,120 open cards, zero ever decided).
// Doctrine (garybuilt-local-model.md §7): the local model ANNOTATES; a human
// DECIDES; nothing here auto-applies. This module is the brain the nightly tick
// (api/admin.js::handleMatchDisambigAssistTick) calls to (1) shape the ranking
// prompt from the card's OWN fields, (2) parse + normalize the model's ranking
// into a bounded annotation that can ONLY reference the card's real candidates
// (never invent one), and (3) score a human verdict as agree/disagree vs the
// assist's top pick. Every function is unit-testable in isolation.
//
// The annotation is written to lcc_decisions.metadata.assist by the SQL function
// lcc_annotate_match_disambig_assist() — a metadata-only writer that structurally
// CANNOT touch verdict/status. The verdict path stays exactly as it is today; the
// assist only adds ordering + inline hints + a one-click "assist agrees" confirm.

const ASSIST_ACTIONS = new Set(['pick', 'create_property', 'uncertain']);

// Stable key for a candidate across the card + the model's ranking. The card
// context carries domain (dia|gov) + property_id; the model echoes them back.
export function candidateKey(c) {
  return String(c && c.domain != null ? c.domain : '') + ':'
    + String(c && c.property_id != null ? c.property_id : '');
}

function clampConfidence(v) {
  const n = Number(v);
  return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
}

// The prompt the local model ranks a single card's candidates with. Grounded on
// ONLY the fields the card already shows (intake address/tenant + each candidate's
// address/tenant/identifiers/fuzzy score) so the model cannot pull in outside
// facts. It is told, in strong terms, to rank ONLY the given candidates.
export function buildMatchDisambigPrompt(card) {
  const cands = Array.isArray(card && card.candidates) ? card.candidates : [];
  const payload = {
    intake_id: card && card.intake_id != null ? String(card.intake_id) : null,
    intake_address: (card && card.address) || null,
    intake_tenant: (card && card.tenant) || null,
    candidates: cands.map((c, i) => ({
      index: i,
      domain: c && c.domain != null ? c.domain : null,
      property_id: c && c.property_id != null ? String(c.property_id) : null,
      address: (c && c.address) || null,
      tenant: (c && c.tenant) || null,
      fuzzy_confidence: c && c.confidence != null ? Number(c.confidence) : null,
      relationship_count: c && c.relationship_count != null ? c.relationship_count : null,
    })),
  };
  return [
    'You are the LCC Ollama match-disambiguation pre-rank agent.',
    'You ONLY annotate. You never decide, never write data, never merge, and never invent a candidate.',
    '',
    'An intake document matched MULTIPLE candidate properties above threshold, so it was parked for a',
    'human to disambiguate. Rank the candidates from BEST match to worst for this intake, using ONLY the',
    'fields provided below — the intake address/tenant vs each candidate address/tenant/identifiers and the',
    'matcher fuzzy_confidence. Do not use any outside knowledge; do not fabricate an address or a tenant.',
    '',
    'Return ONLY strict JSON with keys: ranking, recommended_action, overall_reason.',
    '- ranking: an array, BEST first, of objects { domain, property_id, confidence, reason }.',
    '  * domain + property_id MUST be copied verbatim from a candidate below — NEVER invent one.',
    '  * confidence: 0.0 to 1.0 that THIS candidate is the intake property.',
    '  * reason: one short sentence citing the specific field evidence (address/tenant/identifier match).',
    '- recommended_action: "pick" if one candidate clearly matches; "create_property" if NONE plausibly',
    '  matches the intake; "uncertain" if two or more are indistinguishable on the evidence.',
    '- overall_reason: one short sentence for the recommended_action.',
    'If unsure, use "uncertain" with modest confidences — a human makes the call; you only sort the lane.',
    '',
    JSON.stringify({ card: payload }, null, 2),
  ].join('\n');
}

// Tolerant JSON extraction (fenced ```json, then first-brace/last-brace fallback) —
// same shape as the clean-assist / junk-prescreen parsers.
export function parseAssistJson(text) {
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

// Normalize the model's raw ranking into the annotation stored on the decision
// row. HARD INVARIANT: the ranking may reference ONLY the card's real candidates
// (a hallucinated domain:property_id is dropped, never persisted). Every card
// candidate the model omitted is appended at the end at confidence 0 so the card
// can always render a rank for each candidate. The result is sorted best-first and
// rank-numbered. NEVER a verdict — this is an annotation object only.
export function normalizeAssistRanking(raw, card, meta = {}) {
  const cands = Array.isArray(card && card.candidates) ? card.candidates : [];
  const byKey = new Map(cands.map((c) => [candidateKey(c), c]));
  const obj = raw && typeof raw === 'object' ? raw : {};
  const rawRanking = Array.isArray(obj.ranking) ? obj.ranking : [];
  const seen = new Set();
  const ranking = [];
  for (const r of rawRanking) {
    const key = candidateKey(r);
    if (!byKey.has(key) || seen.has(key)) continue; // never invent / never dup a candidate
    seen.add(key);
    const c = byKey.get(key);
    ranking.push({
      domain: c.domain != null ? c.domain : null,
      property_id: c.property_id != null ? String(c.property_id) : null,
      confidence: clampConfidence(r.confidence),
      reason: String(r && r.reason != null ? r.reason : '').replace(/\s+/g, ' ').trim().slice(0, 240),
    });
  }
  // Append any candidate the model left out (confidence 0), so the card always
  // has a rank for every option; then sort best-first (stable) and number.
  for (const c of cands) {
    const key = candidateKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    ranking.push({
      domain: c.domain != null ? c.domain : null,
      property_id: c.property_id != null ? String(c.property_id) : null,
      confidence: 0,
      reason: 'Not ranked by the assist.',
    });
  }
  ranking.sort((a, b) => b.confidence - a.confidence);
  ranking.forEach((r, i) => { r.rank = i + 1; });

  let action = String(obj.recommended_action || '').toLowerCase().trim();
  if (!ASSIST_ACTIONS.has(action)) action = 'uncertain';
  const top = ranking[0] || null;
  return {
    ranking,
    recommended_action: action,
    overall_reason: String(obj.overall_reason || '').replace(/\s+/g, ' ').trim().slice(0, 300) || null,
    top_pick: top ? { domain: top.domain, property_id: top.property_id } : null,
    top_confidence: top ? top.confidence : 0,
    candidate_count: cands.length,
    model: meta.model || null,
    provider: meta.provider || null,
    at: meta.at || null,
  };
}

// Read the disambiguation card fields off a lcc_decisions row's context (the
// producer stores { intake_id, address, tenant, candidates:[…] }).
export function cardFromDecision(decision) {
  const ctx = decision && decision.context && typeof decision.context === 'object' ? decision.context : {};
  return {
    intake_id: ctx.intake_id != null ? String(ctx.intake_id) : null,
    address: ctx.address != null ? ctx.address : null,
    tenant: ctx.tenant != null ? ctx.tenant : null,
    candidates: Array.isArray(ctx.candidates) ? ctx.candidates : [],
  };
}

// Score a human verdict as agree/disagree vs the assist's top pick (self-measuring
// loop — feeds the U4 assist-accuracy metric). Only pick / create_property are
// measurable DECISIONS on the assist's recommendation; research is a defer and is
// not measured (measured=false). An absent assist ⇒ not measured.
//   humanPick = { action: 'pick'|'create_property'|'research', domain, property_id }
export function assistAgreement(assist, humanPick) {
  const a = assist && typeof assist === 'object' ? assist : null;
  const action = String(humanPick && humanPick.action || '').toLowerCase();
  if (!a) return { measured: false, agreed: null };
  if (action !== 'pick' && action !== 'create_property') return { measured: false, agreed: null };
  const rec = String(a.recommended_action || 'uncertain');
  if (action === 'create_property') {
    return { measured: true, agreed: rec === 'create_property', human_action: action, assist_action: rec };
  }
  // pick — agree only when the assist also recommended pick AND its top pick is the SAME candidate.
  const top = a.top_pick || null;
  const same = !!top
    && String(top.domain != null ? top.domain : '') === String(humanPick.domain != null ? humanPick.domain : '')
    && String(top.property_id != null ? top.property_id : '') === String(humanPick.property_id != null ? humanPick.property_id : '');
  return {
    measured: true, agreed: rec === 'pick' && same, human_action: action, assist_action: rec,
    assist_top: top,
    human_pick: {
      domain: humanPick.domain != null ? humanPick.domain : null,
      property_id: humanPick.property_id != null ? String(humanPick.property_id) : null,
    },
  };
}
